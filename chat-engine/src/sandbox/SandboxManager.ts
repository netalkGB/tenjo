import * as fs from 'node:fs';
import * as path from 'node:path';
import defaultLogger from '../logger.js';
import { type Sandbox } from './Sandbox.js';
import { runDocker, ok, type DockerResult } from './dockerCli.js';
import { DockerSandbox } from './DockerSandbox.js';
import {
  DockerUnavailableError,
  SandboxConfigurationError,
  SandboxGuiError,
  SandboxResourceExhaustedError,
  SandboxSetupError,
} from './errors.js';
import {
  SANDBOX_USER,
  SANDBOX_UID,
  SETPRIV_PREFIX,
  buildPodmanExecArgs,
  type SandboxMode,
} from './podmanExec.js';
import { parsePublishedHostRanges, type PortRange } from './portRanges.js';

// Bump these tags when the corresponding Dockerfile changes.
const DEFAULT_IMAGE = 'tenjo-agent-sandbox:10';
const DEFAULT_INNER_IMAGE = 'tenjo-agent-toolchain:18';
const DEFAULT_CONTAINER_NAME = 'tenjo-sandbox';
const DEFAULT_VOLUME_NAME = 'tenjo-sandbox-data';
const DEFAULT_WORKSPACES_ROOT = '/workspaces';
const PODMAN_STORAGE_DIR_NAME = '.tenjo-podman-storage';
const PODMAN_STORAGE_MOUNT_POINT = `/home/${SANDBOX_USER}/.local/share/containers`;
/**
 * Short, fixed workspace path inside each project pod. DockerSandbox translates
 * file ops between this and the outer `/workspaces/<id>` path.
 */
const POD_WORKSPACE_DIR = '/workspace';
const DEFAULT_LABEL = 'tenjo.sandbox';
const DEFAULT_EXEC_TIMEOUT_MS = 120_000;
/** Host dev ports each project pod gets from the published range. */
const DEFAULT_PORTS_PER_PROJECT = 5;
/** In-container scratch dir used to feed the toolchain Dockerfile to podman. */
const INNER_BUILD_DIR = `/home/${SANDBOX_USER}/.toolchain-build`;
/** Ready stamp written by start-desktop (in the project container) once VNC accepts connections. */
const GUI_READY_FILE = '/tmp/.gui-ready';
/** How long startGui waits for the desktop's ready stamp. */
const GUI_START_TIMEOUT_MS = 60_000;

export interface SandboxManagerOptions {
  /** Base image tag built/used for the outer sandbox container. */
  image?: string;
  /** Toolchain image tag podman builds inside for project containers (also hosts the GUI desktop). */
  innerImage?: string;
  /**
   * xkb layout for the GUI's VNC keymap (wayvnc --keyboard), for example 'jp', 'us'
   * or 'de-nodeadkeys'. Default: the image's default ('jp' — it contains every
   * ASCII keysym, so US clients lose nothing while JIS keys become typable).
   */
  guiKeyboard?: string;
  /** Path/name of the docker binary. Default 'docker'. */
  dockerPath?: string;
  /** Name of the single shared sandbox container. */
  containerName?: string;
  /** Name of the single shared volume holding project workspaces and podman state. */
  volumeName?: string;
  /** Mount point of the shared volume; each project is a subdir below it. */
  workspacesRoot?: string;
  /** Docker label key used to find/reap the shared container. */
  labelKey?: string;
  /** `--cpus` limit for the shared container (shared by all projects). */
  cpus?: string;
  /** `--memory` limit for the shared container (shared by all projects). */
  memory?: string;
  /** `--pids-limit` for the shared container. */
  pidsLimit?: number;
  /** Container network. 'bridge' (default) lets npm/pip reach the internet. */
  network?: string;
  /**
   * Host port mappings published on the shared container, using docker `-p`
   * specs. Changing this recreates the container.
   */
  publishPorts?: string[];
  /**
   * Number of published ports allocated per project pod. Ignored in
   * 'vnc-single' {@link portMode}, which always allocates one VNC port.
   */
  portsPerProject?: number;
  /**
   * How published ports are assigned: dev-server blocks, or one VNC-only port
   * per project for the server GUI preview.
   */
  portMode?: SandboxPortMode;
  /** Default per-command wall-clock cap passed to each DockerSandbox. */
  execTimeoutMs?: number;
  /** Dockerfile for the outer image. Defaults to the shipped one. */
  dockerfile?: string;
  /** Dockerfile for the inner toolchain image. Defaults to the shipped one. */
  innerDockerfile?: string;
  /** Seccomp profile passed at container creation. Defaults to the shipped one. */
  seccompProfile?: string;
  /** Build context for the outer image. Defaults to chat-engine's docker/. */
  buildContext?: string;
}

export type SandboxPortMode = 'dev-block' | 'vnc-single';

type ContainerState = 'running' | 'exited' | 'created' | 'missing';

/** Coarse step of {@link SandboxManager.prewarm}, for progress reporting. */
export type SandboxPrewarmPhase =
  'building-image' | 'starting-container' | 'building-toolchain';

/** Lifecycle of a project's GUI preview desktop, as seen by {@link SandboxManager.getGuiStatus}. */
export type SandboxGuiStatus = 'stopped' | 'starting' | 'running';

function sanitizeName(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_.-]/g, '-');
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return 'default';
  return cleaned;
}

/**
 * Manages the shared Docker sandbox container, its nested podman toolchain, and
 * per-project pods used by agent sandboxes.
 */
export class SandboxManager {
  private readonly image: string;
  private readonly innerImage: string;
  private readonly guiKeyboard: string | undefined;
  private readonly dockerPath: string;
  private readonly containerName: string;
  private readonly volumeName: string;
  private readonly podmanStorageRoot: string;
  private readonly workspacesRoot: string;
  private readonly labelKey: string;
  private readonly cpus: string;
  private readonly memory: string;
  private readonly pidsLimit: number;
  private readonly network: string;
  private readonly publishPorts: string[];
  private readonly portsPerProject: number;
  private readonly portMode: SandboxPortMode;
  private readonly execTimeoutMs: number;
  private readonly dockerfile: string;
  private readonly innerDockerfile: string;
  private readonly seccompProfile: string;
  private readonly buildContext: string;

  private dockerAvailable: boolean | null = null;
  private imageReady = false;
  private imageBuild: Promise<void> | null = null;
  private innerImageReady = false;
  private innerImageBuild: Promise<void> | null = null;
  /** Mode the running container was created with (set by ensureContainer). */
  private mode: SandboxMode | null = null;
  /** `docker info` SecurityOptions, cached for LSM flag selection. */
  private securityOptions: string | null = null;
  /** Serializes container start so concurrent calls don't race. */
  private startLock: Promise<void> | null = null;
  /** Serializes project dir + pod setup so port allocation can't race. */
  private setupLock: Promise<unknown> | null = null;
  private lastUsedAt = 0;

  constructor(options: SandboxManagerOptions = {}) {
    this.image = options.image ?? DEFAULT_IMAGE;
    this.innerImage = options.innerImage ?? DEFAULT_INNER_IMAGE;
    this.guiKeyboard = options.guiKeyboard;
    this.dockerPath = options.dockerPath ?? 'docker';
    this.containerName = options.containerName ?? DEFAULT_CONTAINER_NAME;
    this.volumeName = options.volumeName ?? DEFAULT_VOLUME_NAME;
    this.workspacesRoot = options.workspacesRoot ?? DEFAULT_WORKSPACES_ROOT;
    this.podmanStorageRoot = `${this.workspacesRoot}/${PODMAN_STORAGE_DIR_NAME}`;
    this.labelKey = options.labelKey ?? DEFAULT_LABEL;
    this.cpus = options.cpus ?? '2';
    this.memory = options.memory ?? '2g';
    this.pidsLimit = options.pidsLimit ?? 4096;
    this.network = options.network ?? 'bridge';
    this.publishPorts = options.publishPorts ?? [];
    this.portMode = options.portMode ?? 'dev-block';
    this.portsPerProject =
      this.portMode === 'vnc-single'
        ? 1
        : (options.portsPerProject ?? DEFAULT_PORTS_PER_PROJECT);
    this.execTimeoutMs = options.execTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    // Runtime __dirname is dist/sandbox/, while docker/ lives at package root.
    this.buildContext =
      options.buildContext ?? path.join(__dirname, '..', '..', 'docker');
    this.dockerfile =
      options.dockerfile ??
      path.join(this.buildContext, 'agent-sandbox.Dockerfile');
    this.innerDockerfile =
      options.innerDockerfile ??
      path.join(this.buildContext, 'agent-toolchain.Dockerfile');
    this.seccompProfile =
      options.seccompProfile ??
      path.join(this.buildContext, 'agent-sandbox-seccomp.json');
  }

  /** Absolute path of a project's workspace inside the shared container. */
  private projectDir(projectId: string): string {
    return `${this.workspacesRoot}/${this.projectName(projectId)}`;
  }

  /** Podman pod name for a project. */
  private podName(projectId: string): string {
    return `proj-${this.projectName(projectId)}`;
  }

  /** Name of the project's main (toolchain) container inside its pod. */
  private projectContainerName(projectId: string): string {
    return `${this.podName(projectId)}-main`;
  }

  private projectName(projectId: string): string {
    const name = sanitizeName(projectId);
    if (this.internalWorkspaceNames().has(name)) {
      return `${name}-project`;
    }
    return name;
  }

  /**
   * Names reserved directly under the workspace root for sandbox internals.
   * `reapOrphans` must not treat these as deleted projects.
   */
  private internalWorkspaceNames(): Set<string> {
    const relative = path.posix.relative(
      this.workspacesRoot,
      this.podmanStorageRoot
    );
    if (
      relative === '' ||
      relative.startsWith('..') ||
      path.posix.isAbsolute(relative)
    ) {
      return new Set();
    }
    return new Set([relative.split('/')[0]]);
  }

  /** Split a project's published block into dev-server ports and a VNC port. */
  private splitPortBlock(block: PortRange | undefined): {
    devPorts: PortRange | undefined;
    guiPort: number | undefined;
  } {
    if (!block) {
      return { devPorts: undefined, guiPort: undefined };
    }
    if (this.portMode === 'vnc-single') {
      return { devPorts: undefined, guiPort: block.start };
    }
    if (block.end - block.start + 1 < 2) {
      return { devPorts: block, guiPort: undefined };
    }
    return {
      devPorts: { start: block.start, end: block.end - 1 },
      guiPort: block.end,
    };
  }

  /** Whether the Docker daemon is reachable (cached after the first check). */
  async isDockerAvailable(): Promise<boolean> {
    if (this.dockerAvailable !== null) return this.dockerAvailable;
    const result = await runDocker(
      ['version', '--format', '{{.Server.Version}}'],
      { dockerPath: this.dockerPath, timeoutMs: 15_000 }
    );
    this.dockerAvailable = ok(result);
    return this.dockerAvailable;
  }

  private async requireDocker(): Promise<void> {
    if (!(await this.isDockerAvailable())) {
      throw new DockerUnavailableError();
    }
  }

  /** Build the outer image if it is not already present (single-flight). */
  async ensureImage(): Promise<void> {
    if (this.imageReady) return;
    if (!this.imageBuild) {
      this.imageBuild = this.buildImageIfMissing().finally(() => {
        this.imageBuild = null;
      });
    }
    await this.imageBuild;
    this.imageReady = true;
  }

  private async buildImageIfMissing(): Promise<void> {
    await this.requireDocker();
    const inspect = await runDocker(['image', 'inspect', this.image], {
      dockerPath: this.dockerPath,
      timeoutMs: 15_000,
    });
    if (ok(inspect)) return;
    defaultLogger.info(
      `building sandbox image ${this.image} (first run only)…`
    );
    const build = await runDocker(
      ['build', '-t', this.image, '-f', this.dockerfile, this.buildContext],
      { dockerPath: this.dockerPath } // no timeout: a build can take minutes
    );
    if (!ok(build)) {
      throw new SandboxSetupError(
        `failed to build sandbox image: ${build.stderr.trim() || build.spawnError || 'unknown error'}`
      );
    }
    defaultLogger.info(`sandbox image ${this.image} ready`);
  }

  /** Prepare shared sandbox resources before the first project task. */
  async prewarm(onPhase?: (phase: SandboxPrewarmPhase) => void): Promise<void> {
    onPhase?.('building-image');
    await this.ensureImage();
    onPhase?.('starting-container');
    await this.ensureContainer();
    onPhase?.('building-toolchain');
    await this.ensureInnerImage();
  }

  /**
   * Ensure the shared container is running, the toolchain image and the
   * project's pod exist, then return a {@link Sandbox} for that project.
   */
  async getSandbox(projectId: string): Promise<Sandbox> {
    await this.ensureImage();
    await this.ensureContainer();
    await this.ensureInnerImage();
    const block = await this.ensureProject(projectId);
    this.lastUsedAt = Date.now();
    return new DockerSandbox({
      containerName: this.containerName,
      workspaceDir: this.projectDir(projectId),
      podWorkspaceDir: POD_WORKSPACE_DIR,
      projectContainerName: this.projectContainerName(projectId),
      mode: this.requireMode(),
      devPorts: this.splitPortBlock(block).devPorts,
      dockerPath: this.dockerPath,
      defaultTimeoutMs: this.execTimeoutMs,
    });
  }

  private requireMode(): SandboxMode {
    if (!this.mode) {
      throw new SandboxConfigurationError(
        'sandbox container is not ready (no mode selected)'
      );
    }
    return this.mode;
  }

  /** Run a podman command inside the container in the selected mode. */
  private async runPodman(
    podmanArgv: readonly string[],
    opts?: { timeoutMs?: number; input?: string }
  ): Promise<DockerResult> {
    return runDocker(
      buildPodmanExecArgs(this.containerName, this.requireMode(), podmanArgv, {
        interactive: opts?.input !== undefined,
      }),
      {
        dockerPath: this.dockerPath,
        timeoutMs: opts?.timeoutMs,
        input: opts?.input,
      }
    );
  }

  /** Chain container-start work so concurrent calls serialize. */
  private async ensureContainer(): Promise<void> {
    const previous = this.startLock ?? Promise.resolve();
    const run = (): Promise<void> => this.ensureContainerOnce();
    const next = previous.then(run, run);
    // Store a never-rejecting tail so a failure does not poison the chain.
    this.startLock = next.then(
      () => undefined,
      () => undefined
    );
    await next;
  }

  private async ensureContainerOnce(): Promise<void> {
    const existing = await this.inspectContainer();
    if (existing) {
      const upToDate =
        existing.ports === this.publishPorts.join(',') &&
        existing.image === this.image &&
        existing.storage === this.storageConfigLabel() &&
        (existing.mode === 'normal' || existing.mode === 'compat') &&
        existing.init;
      if (!upToDate) {
        defaultLogger.info(
          'sandbox container is out of date (ports, image, storage layout, mode or init changed) — recreating it (files in the volume are kept)'
        );
        await this.removeContainer();
      } else {
        if (existing.state !== 'running') {
          const start = await runDocker(['start', this.containerName], {
            dockerPath: this.dockerPath,
            timeoutMs: 30_000,
          });
          if (!ok(start)) {
            // Exists but won't start (for example removed underneath us): recreate.
            await this.removeContainer();
            await this.createContainerWithProbe();
            return;
          }
          await this.postStartSetup();
        }
        // Host userns policy can change between runs.
        const mode = existing.mode as SandboxMode;
        if (await this.probeMode(mode)) {
          this.mode = mode;
          return;
        }
        defaultLogger.info(
          `sandbox container mode "${mode}" no longer works on this host — recreating`
        );
        await this.removeContainer();
      }
    }
    await this.createContainerWithProbe();
  }

  private async inspectContainer(): Promise<{
    state: ContainerState;
    ports: string;
    mode: string;
    image: string;
    storage: string;
    init: boolean;
  } | null> {
    const result = await runDocker(
      [
        'inspect',
        '-f',
        `{{.State.Status}}|{{index .Config.Labels "${this.labelKey}.ports"}}|{{index .Config.Labels "${this.labelKey}.mode"}}|{{.Config.Image}}|{{index .Config.Labels "${this.labelKey}.storage"}}|{{.HostConfig.Init}}`,
        this.containerName,
      ],
      { dockerPath: this.dockerPath, timeoutMs: 15_000 }
    );
    if (!ok(result)) return null;
    const [status, ports, mode, image, storage, init] = result.stdout
      .trim()
      .split('|');
    const state: ContainerState =
      status === 'running' || status === 'created' ? status : 'exited';
    return {
      state,
      ports: ports ?? '',
      mode: mode ?? '',
      image: image ?? '',
      storage: storage ?? '',
      init: init === 'true',
    };
  }

  private async removeContainer(): Promise<void> {
    await runDocker(['rm', '-f', this.containerName], {
      dockerPath: this.dockerPath,
      timeoutMs: 30_000,
    });
  }

  /**
   * Create the container with the least privilege that works on this host.
   */
  private async createContainerWithProbe(): Promise<void> {
    await this.ensureVolumes();
    await this.runContainer('normal');
    await this.postStartSetup();
    if (await this.probeMode('normal')) {
      this.mode = 'normal';
      return;
    }
    defaultLogger.info(
      'host blocks unprivileged user namespaces — recreating the sandbox container with CAP_SYS_ADMIN (compat mode)'
    );
    await this.removeContainer();
    await this.runContainer('compat');
    await this.postStartSetup();
    if (await this.probeMode('compat')) {
      this.mode = 'compat';
      return;
    }
    throw new SandboxSetupError(
      'sandbox container cannot create user namespaces even with CAP_SYS_ADMIN — the agent sandbox is unavailable on this Docker host'
    );
  }

  /**
   * Probe root mapping too; some hosts allow namespace creation but reject the
   * uid_map write needed by rootless podman.
   */
  private async probeMode(mode: SandboxMode): Promise<boolean> {
    const args =
      mode === 'compat'
        ? [
            'exec',
            '-u',
            'root',
            this.containerName,
            ...SETPRIV_PREFIX,
            'unshare',
            '-Ur',
            'true',
          ]
        : [
            'exec',
            '-u',
            SANDBOX_USER,
            this.containerName,
            'unshare',
            '-Ur',
            'true',
          ];
    const result = await runDocker(args, {
      dockerPath: this.dockerPath,
      timeoutMs: 15_000,
    });
    return ok(result);
  }

  /** LSM-specific `--security-opt` flags, from `docker info` (cached). */
  private async lsmFlags(): Promise<string[]> {
    if (this.securityOptions === null) {
      const result = await runDocker(
        ['info', '--format', '{{.SecurityOptions}}'],
        { dockerPath: this.dockerPath, timeoutMs: 15_000 }
      );
      this.securityOptions = ok(result) ? result.stdout : '';
    }
    const flags: string[] = [];
    // docker-default AppArmor denies mounts required by the nested runtime.
    if (this.securityOptions.includes('name=apparmor')) {
      flags.push('--security-opt', 'apparmor=unconfined');
    }
    // SELinux relabeling breaks nested container storage.
    if (this.securityOptions.includes('name=selinux')) {
      flags.push('--security-opt', 'label=disable');
    }
    return flags;
  }

  private async ensureVolumes(): Promise<void> {
    const result = await runDocker(['volume', 'create', this.volumeName], {
      dockerPath: this.dockerPath,
      timeoutMs: 15_000,
    });
    if (!ok(result)) {
      throw new SandboxSetupError(
        `failed to create volume ${this.volumeName}: ${result.stderr.trim() || result.spawnError || 'unknown error'}`
      );
    }
  }

  private volumeMountArgs(): string[] {
    return ['-v', `${this.volumeName}:${this.workspacesRoot}`];
  }

  private storageConfigLabel(): string {
    return JSON.stringify([
      this.volumeName,
      this.workspacesRoot,
      this.podmanStorageRoot,
    ]);
  }

  private async runContainer(mode: SandboxMode): Promise<void> {
    const lsm = await this.lsmFlags();
    const result = await runDocker(
      [
        'run',
        '-d',
        // Reap orphaned podman/conmon processes so the PID limit is not
        // exhausted during long agent sessions.
        '--init',
        '--name',
        this.containerName,
        '--label',
        `${this.labelKey}=shared`,
        // Docker can only set ports/capabilities at creation.
        '--label',
        `${this.labelKey}.ports=${this.publishPorts.join(',')}`,
        '--label',
        `${this.labelKey}.mode=${mode}`,
        '--label',
        `${this.labelKey}.storage=${this.storageConfigLabel()}`,
        ...this.volumeMountArgs(),
        '-w',
        this.workspacesRoot,
        '--cpus',
        this.cpus,
        '--memory',
        this.memory,
        '--pids-limit',
        String(this.pidsLimit),
        '--shm-size',
        '512m',
        // Rootless podman needs userns, unmasked /proc, fuse-overlayfs, and
        // pasta networking. no-new-privileges would break setuid newuidmap.
        '--security-opt',
        `seccomp=${this.seccompProfile}`,
        '--security-opt',
        'systempaths=unconfined',
        ...lsm,
        '--device',
        '/dev/fuse',
        '--device',
        '/dev/net/tun',
        ...(mode === 'compat' ? ['--cap-add', 'SYS_ADMIN'] : []),
        '--network',
        this.network,
        ...this.publishPorts.flatMap((spec) => ['-p', spec]),
        this.image,
        'sleep',
        'infinity',
      ],
      { dockerPath: this.dockerPath, timeoutMs: 60_000 }
    );
    if (!ok(result)) {
      throw new SandboxSetupError(
        `failed to start sandbox container ${this.containerName}: ${result.stderr.trim() || result.spawnError || 'unknown error'}`
      );
    }
    defaultLogger.info(
      `started shared sandbox container ${this.containerName} (${mode})`
    );
  }

  /**
   * Root-side setup after every (re)start. /run is persistent here, so podman
   * needs a fresh runtime dir.
   */
  private async postStartSetup(): Promise<void> {
    const script = [
      'set -e',
      'WORKSPACES="$1"; PODMAN_STORAGE="$2"; PODMAN_MOUNT="$3"; USER_NAME="$4"',
      'mkdir -p "$WORKSPACES" "$PODMAN_STORAGE" "$(dirname "$PODMAN_MOUNT")"',
      `chown ${SANDBOX_USER}:${SANDBOX_USER} "$PODMAN_STORAGE"`,
      'chmod 700 "$PODMAN_STORAGE"',
      'if [ "$PODMAN_STORAGE" != "$PODMAN_MOUNT" ]; then',
      '  if [ -e "$PODMAN_MOUNT" ] && [ ! -L "$PODMAN_MOUNT" ]; then rm -rf "$PODMAN_MOUNT"; fi',
      '  ln -sfn "$PODMAN_STORAGE" "$PODMAN_MOUNT"',
      '  chown -h "$USER_NAME:$USER_NAME" "$PODMAN_MOUNT"',
      'fi',
      `rm -rf /run/user/${SANDBOX_UID}`,
      `mkdir -p /run/user/${SANDBOX_UID}`,
      `chown ${SANDBOX_USER}:${SANDBOX_USER} /run/user/${SANDBOX_UID}`,
      `chmod 700 /run/user/${SANDBOX_UID}`,
      `chmod 711 ${this.workspacesRoot}`,
    ].join('\n');
    const result = await runDocker(
      [
        'exec',
        '-u',
        'root',
        this.containerName,
        'sh',
        '-c',
        script,
        'sh',
        this.workspacesRoot,
        this.podmanStorageRoot,
        PODMAN_STORAGE_MOUNT_POINT,
        SANDBOX_USER,
      ],
      { dockerPath: this.dockerPath, timeoutMs: 15_000 }
    );
    if (!ok(result)) {
      throw new SandboxSetupError(
        `failed to prepare sandbox container: ${result.stderr.trim() || result.spawnError || 'unknown error'}`
      );
    }
  }

  /** Build the toolchain image inside podman if missing (single-flight). */
  private async ensureInnerImage(): Promise<void> {
    if (this.innerImageReady) return;
    if (!this.innerImageBuild) {
      this.innerImageBuild = this.buildPodmanImageIfMissing(
        this.innerImage,
        this.innerDockerfile,
        INNER_BUILD_DIR,
        'project toolchain'
      ).finally(() => {
        this.innerImageBuild = null;
      });
    }
    await this.innerImageBuild;
    this.innerImageReady = true;
  }

  /** Build an image with the podman INSIDE the container, if it is missing. */
  private async buildPodmanImageIfMissing(
    image: string,
    dockerfilePath: string,
    buildDir: string,
    label: string
  ): Promise<void> {
    const exists = await this.runPodman(['image', 'exists', image], {
      timeoutMs: 30_000,
    });
    if (ok(exists)) return;
    defaultLogger.info(
      `building ${label} image ${image} inside the sandbox (first run only)…`
    );
    // Keep the build context dedicated because podman tars the whole directory.
    const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
    const prep = await runDocker(
      [
        'exec',
        '-i',
        '-u',
        'root',
        this.containerName,
        'sh',
        '-c',
        `mkdir -p ${buildDir} && cat > ${buildDir}/Dockerfile && chown -R ${SANDBOX_USER}:${SANDBOX_USER} ${buildDir}`,
      ],
      { dockerPath: this.dockerPath, input: dockerfile, timeoutMs: 15_000 }
    );
    if (!ok(prep)) {
      throw new SandboxSetupError(
        `failed to stage ${label} Dockerfile: ${prep.stderr.trim() || prep.spawnError || 'unknown error'}`
      );
    }
    const build = await this.runPodman([
      'build',
      '-t',
      image,
      '-f',
      `${buildDir}/Dockerfile`,
      buildDir,
    ]); // no timeout: a build can take minutes
    if (!ok(build)) {
      throw new SandboxSetupError(
        `failed to build ${label} image: ${build.stderr.trim() || build.spawnError || 'unknown error'}`
      );
    }
    defaultLogger.info(`${label} image ${image} ready`);
  }

  /**
   * Serialized per-project setup: workspace dir + pod. Serialization keeps the
   * dev-port block allocation race-free when two NEW projects arrive at once.
   */
  private async ensureProject(
    projectId: string
  ): Promise<PortRange | undefined> {
    const previous = this.setupLock ?? Promise.resolve();
    const run = async (): Promise<PortRange | undefined> => {
      await this.ensureProjectDir(projectId);
      return this.ensurePod(projectId);
    };
    const next = previous.then(run, run);
    this.setupLock = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  /**
   * Ensure the workspace exists and is writable by the project container's
   * root user after user-namespace mapping.
   */
  private async ensureProjectDir(projectId: string): Promise<void> {
    const dir = this.projectDir(projectId);
    const script = [
      'set -e',
      'D="$1"; UID_WANT="$2"',
      'mkdir -p "$D"',
      'owner=$(stat -c %u "$D")',
      'if [ "$owner" != "$UID_WANT" ]; then chown -R "$UID_WANT:$UID_WANT" "$D"; fi',
      'chmod 700 "$D"',
    ].join('\n');
    const result = await runDocker(
      [
        'exec',
        '-u',
        'root',
        this.containerName,
        'sh',
        '-c',
        script,
        'sh',
        dir,
        String(SANDBOX_UID),
      ],
      { dockerPath: this.dockerPath, timeoutMs: 60_000 }
    );
    if (!ok(result)) {
      throw new SandboxSetupError(
        `failed to prepare project workspace ${dir}: ${result.stderr.trim() || result.spawnError || 'unknown error'}`
      );
    }
  }

  /**
   * Ensure the project's pod exists, runs the current toolchain image, and is
   * started. Returns the pod's port block, if any.
   */
  private async ensurePod(projectId: string): Promise<PortRange | undefined> {
    const pod = this.podName(projectId);
    const main = this.projectContainerName(projectId);
    const inspect = await this.runPodman(
      ['pod', 'inspect', '--format', '{{.State}}', pod],
      { timeoutMs: 30_000 }
    );
    if (ok(inspect)) {
      const image = await this.runPodman(
        ['container', 'inspect', '--format', '{{.ImageName}}', main],
        { timeoutMs: 30_000 }
      );
      const imageName = ok(image) ? image.stdout.trim() : '';
      if (
        imageName === this.innerImage ||
        imageName === `localhost/${this.innerImage}`
      ) {
        if (inspect.stdout.trim() !== 'Running') {
          const start = await this.runPodman(['pod', 'start', pod], {
            timeoutMs: 60_000,
          });
          if (!ok(start)) {
            throw new SandboxSetupError(
              `failed to start project pod ${pod}: ${start.stderr.trim() || 'unknown error'}`
            );
          }
        }
        return this.podPorts(pod);
      }
      defaultLogger.info(
        `project pod ${pod} is out of date — recreating it (workspace files are kept)`
      );
      await this.runPodman(['pod', 'rm', '-f', pod], { timeoutMs: 60_000 });
    }
    const ports = await this.allocateDevPortsWithReclaim(pod);
    const createArgs = ['pod', 'create', '--name', pod];
    if (ports) {
      createArgs.push(
        '--label',
        `${this.labelKey}.ports=${ports.start}-${ports.end}`
      );
      for (let p = ports.start; p <= ports.end; p++) {
        // Bind eth0 so docker's host-side -p forwards can reach the pod.
        createArgs.push('-p', `0.0.0.0:${p}:${p}`);
      }
    }
    let create = await this.runPodman(createArgs, { timeoutMs: 60_000 });
    if (!ok(create) && /in use|already exists/i.test(create.stderr)) {
      // Recover from a stale reserved pod name; workspace files are separate.
      defaultLogger.info(
        `project pod ${pod} name was already in use but uninspectable — force-removing and recreating`
      );
      await this.runPodman(['pod', 'rm', '-f', pod], { timeoutMs: 60_000 });
      create = await this.runPodman(createArgs, { timeoutMs: 60_000 });
    }
    if (!ok(create)) {
      throw new SandboxSetupError(
        `failed to create project pod ${pod}: ${create.stderr.trim() || 'unknown error'}`
      );
    }
    const dir = this.projectDir(projectId);
    const run = await this.runPodman(
      [
        'run',
        '-d',
        // Reap GUI/helper processes so nested PIDs do not exhaust the shared
        // outer container limit.
        '--init',
        '--pod',
        pod,
        '--name',
        main,
        '--shm-size',
        '512m',
        // Keep paths compact inside the pod; DockerSandbox handles translation.
        '-v',
        `${dir}:${POD_WORKSPACE_DIR}`,
        '-w',
        POD_WORKSPACE_DIR,
        this.innerImage,
        'sleep',
        'infinity',
      ],
      { timeoutMs: 120_000 }
    );
    if (!ok(run)) {
      // Do not leave a half-built pod behind.
      await this.runPodman(['pod', 'rm', '-f', pod], { timeoutMs: 60_000 });
      throw new SandboxSetupError(
        `failed to start project container ${main}: ${run.stderr.trim() || 'unknown error'}`
      );
    }
    defaultLogger.info(
      `project pod ${pod} ready${ports ? ` (ports ${ports.start}-${ports.end})` : ''}`
    );
    return ports ?? undefined;
  }

  /** Read a pod's allocated dev-port block back from its label. */
  private async podPorts(pod: string): Promise<PortRange | undefined> {
    const result = await this.runPodman(
      [
        'pod',
        'inspect',
        '--format',
        `{{index .Labels "${this.labelKey}.ports"}}`,
        pod,
      ],
      { timeoutMs: 30_000 }
    );
    if (!ok(result)) return undefined;
    const match = result.stdout.trim().match(/^(\d+)-(\d+)$/);
    if (!match) return undefined;
    return { start: Number(match[1]), end: Number(match[2]) };
  }

  /** Allocate the lowest free published port block, or null if none is configured. */
  private async allocateDevPorts(): Promise<PortRange | null> {
    const ranges = parsePublishedHostRanges(this.publishPorts);
    if (ranges.length === 0) return null;
    const used = new Set<number>();
    const list = await this.runPodman(['pod', 'ps', '--format', 'json'], {
      timeoutMs: 30_000,
    });
    if (ok(list)) {
      try {
        const pods = JSON.parse(list.stdout) as Array<{
          Labels?: Record<string, string>;
        }>;
        for (const pod of pods) {
          const label = pod.Labels?.[`${this.labelKey}.ports`];
          const match = label?.match(/^(\d+)-(\d+)$/);
          if (!match) continue;
          for (let p = Number(match[1]); p <= Number(match[2]); p++) {
            used.add(p);
          }
        }
      } catch {
        // A collision still fails safely during pod creation.
      }
    }
    for (const range of ranges) {
      const size = Math.min(this.portsPerProject, range.end - range.start + 1);
      for (
        let start = range.start;
        start + size - 1 <= range.end;
        start += size
      ) {
        const end = start + size - 1;
        let free = true;
        for (let p = start; p <= end; p++) {
          if (used.has(p)) {
            free = false;
            break;
          }
        }
        if (free) return { start, end };
      }
    }
    throw new SandboxResourceExhaustedError(
      'no free dev-server ports left for a new project — stop or delete another project, or widen publishPorts'
    );
  }

  /**
   * Allocate a port block, reclaiming the oldest other project pod when the
   * finite published range is full.
   */
  private async allocateDevPortsWithReclaim(
    excludePod: string
  ): Promise<PortRange | null> {
    try {
      return await this.allocateDevPorts();
    } catch (exhausted) {
      if (!(await this.reclaimOldestPod(excludePod))) {
        throw exhausted;
      }
      return this.allocateDevPorts();
    }
  }

  /**
   * Remove the oldest other labelled project pod to free its port block.
   * Workspace data is not touched.
   */
  private async reclaimOldestPod(excludePod: string): Promise<boolean> {
    const list = await this.runPodman(['pod', 'ps', '--format', 'json'], {
      timeoutMs: 30_000,
    });
    if (!ok(list)) return false;
    let pods: Array<{
      Name?: string;
      Created?: string;
      Labels?: Record<string, string>;
    }>;
    try {
      pods = JSON.parse(list.stdout);
    } catch {
      return false;
    }
    const candidates = pods
      .filter(
        (pod) =>
          typeof pod.Name === 'string' &&
          pod.Name.startsWith('proj-') &&
          pod.Name !== excludePod &&
          typeof pod.Created === 'string' &&
          Boolean(pod.Labels?.[`${this.labelKey}.ports`])
      )
      // RFC3339 timestamps sort lexicographically by time; oldest first.
      .sort((a, b) => (a.Created as string).localeCompare(b.Created as string));
    const oldest = candidates[0]?.Name;
    if (!oldest) return false;
    const removed = await this.runPodman(['pod', 'rm', '-f', oldest], {
      timeoutMs: 60_000,
    });
    if (!ok(removed)) return false;
    defaultLogger.info(
      `dev-server ports exhausted — reclaimed the oldest idle project pod ${oldest} (its files are kept; reopening it recreates the pod)`
    );
    return true;
  }

  // ---- GUI preview desktop ----

  /**
   * Start the project's GUI preview desktop inside its main container.
   * Idempotent unless the requested IME setting changes.
   */
  async startGui(
    projectId: string,
    opts?: {
      /** Page the browser opens first (for example the project's dev-server URL). */
      url?: string;
      /**
       * Whether the desktop gets the Japanese IME (fcitx5 + Mozc) and the jp
       * VNC keymap. False gives the plain desktop with a us keymap (unless
       * {@link SandboxManagerOptions.guiKeyboard} overrides it). Default true.
       */
      ime?: boolean;
    }
  ): Promise<{ vncPort: number }> {
    await this.ensureImage();
    await this.ensureContainer();
    const block = await this.ensureProject(projectId);
    const { guiPort } = this.splitPortBlock(block);
    if (!guiPort) {
      throw new SandboxConfigurationError(
        'no port is reserved for the GUI — publish a port range of at least 2 ports per project'
      );
    }
    const main = this.projectContainerName(projectId);
    // Restart on IME changes so direct input and Japanese input do not share
    // stale desktop state.
    const imeWanted = opts?.ime === false ? '0' : '1';
    if ((await this.getGuiStatus(projectId)) !== 'stopped') {
      const imeNow = await this.readGuiImeMarker(main);
      if (imeNow === imeWanted) {
        await this.waitForGuiReady(main);
        if (opts?.url) {
          await this.tryOpenGuiUrl(projectId, opts.url);
        }
        return { vncPort: guiPort };
      }
      await this.stopDesktop(main);
    }
    const env = [
      '-e',
      `VNC_PORT=${guiPort}`,
      '-e',
      `GUI_IME=${imeWanted}`,
      ...(this.guiKeyboard
        ? ['-e', `GUI_KEYBOARD=${this.guiKeyboard}`]
        : opts?.ime === false
          ? ['-e', 'GUI_KEYBOARD=us']
          : []),
    ];
    const start = await this.runPodman(
      ['exec', ...env, main, '/usr/local/bin/start-desktop'],
      { timeoutMs: GUI_START_TIMEOUT_MS }
    );
    if (!ok(start)) {
      throw new SandboxGuiError(
        `failed to start the GUI desktop: ${start.stderr.trim() || 'unknown error'}`
      );
    }
    await this.waitForGuiReady(main);
    defaultLogger.info(
      `GUI desktop for ${projectId} ready (VNC on port ${guiPort})`
    );
    if (opts?.url) {
      await this.tryOpenGuiUrl(projectId, opts.url);
    }
    return { vncPort: guiPort };
  }

  /**
   * Open a URL in the desktop browser without failing an already-started GUI.
   */
  private async tryOpenGuiUrl(projectId: string, url: string): Promise<void> {
    try {
      await this.openGuiUrl(projectId, url);
    } catch (error) {
      defaultLogger.info(
        `GUI desktop is up but opening ${url} failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      );
    }
  }

  /** Read the IME marker start-desktop wrote ('0'|'1'), or null if absent. */
  private async readGuiImeMarker(main: string): Promise<string | null> {
    const result = await this.runPodman(
      ['exec', main, 'cat', '/tmp/.gui-ime'],
      { timeoutMs: 15_000 }
    );
    return ok(result) ? result.stdout.trim() : null;
  }

  /** Tear down the desktop processes in a project container (best-effort). */
  private async stopDesktop(main: string): Promise<void> {
    // Clear compositor stamps and the fcitx runtime bus for clean restarts.
    const script =
      'pkill -x chromium; pkill -x fcitx5; pkill -x mozc_server; ' +
      'pkill -x wayvnc; pkill -x sway; pkill -u fcitx -x dbus-daemon; ' +
      'rm -rf /tmp/fcitx-rt; rm -f /tmp/.gui-ready /tmp/.gui-ime; exit 0';
    await this.runPodman(['exec', main, 'bash', '-c', script], {
      timeoutMs: 15_000,
    });
  }

  /** Poll for the desktop's ready stamp; on compositor death or timeout, throw. */
  private async waitForGuiReady(main: string): Promise<void> {
    const deadline = Date.now() + GUI_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const ready = await this.runPodman(
        ['exec', main, 'test', '-f', GUI_READY_FILE],
        { timeoutMs: 15_000 }
      );
      if (ok(ready)) return;
      // The container stays alive; sway is the desktop liveness signal.
      const alive = await this.runPodman(
        ['exec', main, 'pgrep', '-x', 'sway'],
        {
          timeoutMs: 15_000,
        }
      );
      if (!ok(alive)) {
        await this.stopDesktop(main);
        throw new SandboxGuiError(
          'GUI desktop compositor exited during startup'
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await this.stopDesktop(main);
    throw new SandboxGuiError('GUI desktop did not become ready in time');
  }

  /**
   * Open a page in the running GUI desktop's browser.
   */
  async openGuiUrl(projectId: string, url: string): Promise<void> {
    const result = await this.runPodman(
      [
        'exec',
        this.projectContainerName(projectId),
        '/usr/local/bin/open-url',
        url,
      ],
      { timeoutMs: 30_000 }
    );
    if (!ok(result)) {
      throw new SandboxGuiError(
        `failed to open URL in the GUI browser: ${result.stderr.trim() || 'unknown error'}`
      );
    }
  }

  /**
   * Launch a native GUI app on the running desktop and record its pid.
   */
  async launchGuiApp(
    projectId: string,
    pidFile: string,
    cwd: string,
    command: string
  ): Promise<void> {
    const result = await this.runPodman(
      [
        'exec',
        this.projectContainerName(projectId),
        '/usr/local/bin/launch-gui-app',
        pidFile,
        cwd,
        command,
      ],
      { timeoutMs: 30_000 }
    );
    if (!ok(result)) {
      throw new SandboxGuiError(
        `failed to launch the GUI app: ${result.stderr.trim() || 'unknown error'}`
      );
    }
  }

  /**
   * Toggle fcitx5/Mozc outside the VNC keyboard path, using the non-root fcitx
   * user's own session bus.
   */
  async toggleGuiIme(projectId: string): Promise<void> {
    const script = [
      'export FCITX_RT=/tmp/fcitx-rt',
      'if ! pgrep -x sway >/dev/null 2>&1; then',
      '  echo "the GUI desktop is not running" >&2',
      '  exit 1',
      'fi',
      'if ! pgrep -u fcitx -x fcitx5 >/dev/null 2>&1; then',
      '  if [ -x /usr/local/bin/start-fcitx ]; then',
      '    /usr/local/bin/start-fcitx >/tmp/fcitx5.log 2>&1 || true',
      '  else',
      '    COMPOSITOR_RUNTIME_DIR=/tmp/xdg',
      '    SOCKET=$(ls "$COMPOSITOR_RUNTIME_DIR" 2>/dev/null | grep -m1 "^wayland-[0-9]*$" || true)',
      '    if [ -n "$SOCKET" ]; then',
      '      chmod 711 "$COMPOSITOR_RUNTIME_DIR" 2>/dev/null || true',
      '      chmod 666 "$COMPOSITOR_RUNTIME_DIR/$SOCKET" 2>/dev/null || true',
      '      install -d -o fcitx -g fcitx -m 700 "$FCITX_RT" 2>/dev/null || true',
      '      BUS="unix:path=$FCITX_RT/bus"',
      '      if ! pgrep -u fcitx -x dbus-daemon >/dev/null 2>&1; then',
      '        rm -f "$FCITX_RT/bus"',
      '        setpriv --reuid fcitx --regid fcitx --init-groups env HOME=/home/fcitx XDG_RUNTIME_DIR="$FCITX_RT" DBUS_SESSION_BUS_ADDRESS="$BUS" dbus-daemon --session --address="$BUS" --fork || true',
      '      fi',
      '      setpriv --reuid fcitx --regid fcitx --init-groups env HOME=/home/fcitx XDG_RUNTIME_DIR="$FCITX_RT" WAYLAND_DISPLAY="$COMPOSITOR_RUNTIME_DIR/$SOCKET" DISPLAY=:0 DBUS_SESSION_BUS_ADDRESS="$BUS" fcitx5 -d >/tmp/fcitx5.log 2>&1 || true',
      '    fi',
      '  fi',
      'fi',
      'for _ in 1 2 3 4 5; do',
      '  pgrep -u fcitx -x fcitx5 >/dev/null 2>&1 && break',
      '  sleep 0.2',
      'done',
      'if ! pgrep -u fcitx -x fcitx5 >/dev/null 2>&1; then',
      '  echo "the IME is not available; try restarting the GUI preview" >&2',
      '  exit 1',
      'fi',
      'setpriv --reuid fcitx --regid fcitx --init-groups env HOME=/home/fcitx XDG_RUNTIME_DIR="$FCITX_RT" DISPLAY=:0 DBUS_SESSION_BUS_ADDRESS="unix:path=$FCITX_RT/bus" fcitx5-remote -t 2>/dev/null && exit 0',
      'echo "could not reach the IME; try restarting the GUI preview" >&2',
      'exit 1',
    ].join('\n');
    const result = await this.runPodman(
      ['exec', this.projectContainerName(projectId), 'bash', '-c', script],
      { timeoutMs: 15_000 }
    );
    if (!ok(result)) {
      throw new SandboxGuiError(
        `failed to toggle the GUI IME: ${result.stderr.trim() || 'unknown error'}`
      );
    }
  }

  /** Stop the project's GUI desktop processes (best-effort, idempotent). */
  async stopGui(projectId: string): Promise<void> {
    if (!this.mode) return;
    await this.stopDesktop(this.projectContainerName(projectId));
  }

  /**
   * Read-only GUI status without triggering container setup.
   */
  async getGuiStatus(projectId: string): Promise<SandboxGuiStatus> {
    if (!this.mode) return 'stopped';
    const main = this.projectContainerName(projectId);
    const alive = await this.runPodman(['exec', main, 'pgrep', '-x', 'sway'], {
      timeoutMs: 15_000,
    });
    if (!ok(alive)) return 'stopped';
    const ready = await this.runPodman(
      ['exec', main, 'test', '-f', GUI_READY_FILE],
      { timeoutMs: 15_000 }
    );
    return ok(ready) ? 'running' : 'starting';
  }

  /**
   * Return the project's VNC host port without starting anything.
   */
  async getGuiVncPort(projectId: string): Promise<number | undefined> {
    if (!this.mode) return undefined;
    const block = await this.podPorts(this.podName(projectId));
    return this.splitPortBlock(block).guiPort;
  }

  /** Record that the sandbox was just used (input to an idle-shutdown sweep). */
  markIdle(): void {
    this.lastUsedAt = Date.now();
  }

  /** When the sandbox was last used (epoch ms), or 0 if never this session. */
  getLastUsedAt(): number {
    return this.lastUsedAt;
  }

  /** Stop the shared container; the volume (all projects' state) persists. */
  async stop(): Promise<void> {
    await runDocker(['stop', this.containerName], {
      dockerPath: this.dockerPath,
      timeoutMs: 30_000,
    });
  }

  /** Delete a project's pod and workspace directory (irreversible). */
  async destroy(projectId: string): Promise<void> {
    await this.ensureContainer();
    await this.runPodman(['pod', 'rm', '-f', this.podName(projectId)], {
      timeoutMs: 60_000,
    });
    const dir = this.projectDir(projectId);
    await runDocker(
      ['exec', '-u', 'root', this.containerName, 'rm', '-rf', dir],
      { dockerPath: this.dockerPath, timeoutMs: 30_000 }
    );
  }

  /**
   * Stop a project's pod to free resources while keeping its workspace and pod
   * filesystem for later restart.
   */
  async stopProject(projectId: string): Promise<void> {
    if (!this.mode) return;
    const result = await this.runPodman(
      ['pod', 'stop', this.podName(projectId)],
      { timeoutMs: 60_000 }
    );
    if (ok(result)) {
      defaultLogger.info(`stopped idle project pod for ${projectId}`);
    }
  }

  /** Remove the shared container AND volume (deletes ALL projects' state). */
  async reset(): Promise<void> {
    await this.removeContainer();
    await runDocker(['volume', 'rm', this.volumeName], {
      dockerPath: this.dockerPath,
      timeoutMs: 15_000,
    });
    this.mode = null;
    this.lastUsedAt = 0;
  }

  /**
   * Remove project pods/workspaces that no longer correspond to known projects.
   */
  async reapOrphans(knownProjectIds: readonly string[]): Promise<void> {
    const existing = await this.inspectContainer();
    if (!existing || existing.state !== 'running' || !this.mode) return;
    const known = new Set(knownProjectIds.map((id) => this.projectName(id)));
    const internal = this.internalWorkspaceNames();
    const podList = await this.runPodman(
      ['pod', 'ps', '--format', '{{.Name}}'],
      { timeoutMs: 30_000 }
    );
    if (ok(podList)) {
      for (const name of podList.stdout.split('\n').map((n) => n.trim())) {
        if (!name.startsWith('proj-')) continue;
        if (known.has(name.slice('proj-'.length))) continue;
        await this.runPodman(['pod', 'rm', '-f', name], { timeoutMs: 60_000 });
        defaultLogger.info(`removed orphan project pod ${name}`);
      }
    }
    const result = await runDocker(
      [
        'exec',
        this.containerName,
        'sh',
        '-c',
        'ls -1 "$0"',
        this.workspacesRoot,
      ],
      { dockerPath: this.dockerPath, timeoutMs: 15_000 }
    );
    if (!ok(result)) return;
    for (const name of result.stdout.split('\n').map((n) => n.trim())) {
      if (!name || known.has(name) || internal.has(name)) continue;
      await runDocker(
        [
          'exec',
          '-u',
          'root',
          this.containerName,
          'rm',
          '-rf',
          `${this.workspacesRoot}/${name}`,
        ],
        { dockerPath: this.dockerPath, timeoutMs: 30_000 }
      );
      defaultLogger.info(`removed orphan project workspace ${name}`);
    }
  }
}

import { spawn } from 'node:child_process';
import { jailRelative } from './pathJail.js';
import {
  DEFAULT_SNAPSHOT_EXCLUDE,
  SANDBOX_SKILLS_DIR,
  isUnderAbsoluteRoot,
  normalizePosixAbsolute,
  type Sandbox,
  type ExecResult,
  type ExecOptions,
  type ReadFileResult,
  type DirEntry,
  type FileSnapshot,
  type SnapshotOptions,
  type FileChange,
  type WatchOptions,
  type SandboxWatcher,
} from './Sandbox.js';
import { runDocker, ok } from './dockerCli.js';
import { SandboxCommandError, SandboxFileOperationError } from './errors.js';
import {
  SANDBOX_USER,
  buildPodmanExecArgs,
  type SandboxMode,
} from './podmanExec.js';
import { type PortRange } from './portRanges.js';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DEFAULT_TIMEOUT_MS = 120_000;
const TIMEOUT_EXIT_CODE = 124;
const READ_BINARY_MAX_BYTES = 64 * 1024 * 1024;

export interface DockerSandboxOptions {
  /** Name of the already-running outer container. */
  containerName: string;
  /** Absolute workspace root on the outer filesystem. */
  workspaceDir: string;
  /** Absolute workspace root inside the project pod. */
  podWorkspaceDir?: string;
  /** Project container name inside the pod. */
  projectContainerName: string;
  /** Podman entry mode. */
  mode: SandboxMode;
  /** Host dev ports allocated to this project, when published. */
  devPorts?: PortRange;
  /** Docker binary path or command name. */
  dockerPath?: string;
  /** Default wall-clock cap for each command. */
  defaultTimeoutMs?: number;
}

/**
 * Sandbox implementation for one Docker-isolated agent workspace.
 *
 * It provides the agent's command execution, file access, snapshots, and file
 * watching by bridging between the project pod and the outer workspace mount.
 */
export class DockerSandbox implements Sandbox {
  private readonly containerName: string;
  private readonly workspaceDir: string;
  private readonly podWorkspaceDir: string;
  private readonly projectContainerName: string;
  private readonly mode: SandboxMode;
  private readonly dockerPath: string;
  private readonly defaultTimeoutMs: number;
  readonly devPorts?: PortRange;
  private workingDir: string | null = null;

  constructor(options: DockerSandboxOptions) {
    this.containerName = options.containerName;
    this.workspaceDir = options.workspaceDir;
    this.podWorkspaceDir = options.podWorkspaceDir ?? options.workspaceDir;
    this.projectContainerName = options.projectContainerName;
    this.mode = options.mode;
    this.devPorts = options.devPorts;
    this.dockerPath = options.dockerPath ?? 'docker';
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private toolRootPod(): string {
    return this.workingDir ?? this.podWorkspaceDir;
  }

  private toolRootHost(): string {
    return this.toHostPath(this.toolRootPod());
  }

  setWorkingDir(absPath: string | null): void {
    this.workingDir = absPath;
  }

  getWorkspaceDir(): string {
    return this.podWorkspaceDir;
  }

  /** Skills root inside the project pod — outside `/workspace`. */
  getSkillsRoot(): string {
    return SANDBOX_SKILLS_DIR;
  }

  /**
   * Materialize a skill file into the project pod at an absolute path under
   * {@link SANDBOX_SKILLS_DIR}. Does not touch the workspace volume.
   */
  async writeOutsideWorkspace(
    absolutePath: string,
    content: Buffer
  ): Promise<{ bytesWritten: number }> {
    const root = this.getSkillsRoot();
    let target: string;
    try {
      target = normalizePosixAbsolute(absolutePath);
    } catch {
      throw new SandboxFileOperationError(
        'write',
        absolutePath,
        `invalid absolute path: ${absolutePath}`
      );
    }
    if (!isUnderAbsoluteRoot(root, target)) {
      throw new SandboxFileOperationError(
        'write',
        absolutePath,
        `path escapes skills root: ${absolutePath}`
      );
    }
    const result = await runDocker(
      buildPodmanExecArgs(
        this.containerName,
        this.mode,
        [
          'exec',
          '-i',
          this.projectContainerName,
          'sh',
          '-c',
          'mkdir -p "$(dirname -- "$0")" && base64 -d > "$0"',
          target,
        ],
        { interactive: true }
      ),
      {
        dockerPath: this.dockerPath,
        input: content.toString('base64'),
        timeoutMs: this.defaultTimeoutMs,
      }
    );
    if (result.spawnError) {
      throw new SandboxCommandError(`docker exec failed: ${result.spawnError}`);
    }
    if (!ok(result)) {
      throw new SandboxFileOperationError(
        'write',
        absolutePath,
        result.stderr.trim() || `cannot write ${absolutePath}`
      );
    }
    return { bytesWritten: content.length };
  }

  private toHostPath(podAbs: string): string {
    if (podAbs === this.podWorkspaceDir) return this.workspaceDir;
    if (podAbs.startsWith(`${this.podWorkspaceDir}/`)) {
      return `${this.workspaceDir}${podAbs.slice(this.podWorkspaceDir.length)}`;
    }
    return podAbs;
  }

  private insideWorkspace(relPath: string): string | null {
    for (const root of [this.podWorkspaceDir, this.workspaceDir]) {
      const bare = root.replace(/^\/+/, '');
      for (const prefix of [root, bare]) {
        if (relPath === prefix || relPath.startsWith(`${prefix}/`)) {
          return jailRelative(relPath.slice(prefix.length));
        }
      }
    }
    return null;
  }

  private podPath(relPath: string): string {
    const inside = this.insideWorkspace(relPath);
    if (inside !== null) {
      return inside === ''
        ? this.podWorkspaceDir
        : `${this.podWorkspaceDir}/${inside}`;
    }
    const root = this.toolRootPod();
    const jailed = jailRelative(relPath);
    return jailed === '' ? root : `${root}/${jailed}`;
  }

  private hostPath(relPath: string): string {
    const inside = this.insideWorkspace(relPath);
    if (inside !== null) {
      return inside === ''
        ? this.workspaceDir
        : `${this.workspaceDir}/${inside}`;
    }
    const root = this.toolRootHost();
    const jailed = jailRelative(relPath);
    return jailed === '' ? root : `${root}/${jailed}`;
  }

  private fileOpsPrefix(opts?: {
    interactive?: boolean;
    write?: boolean;
  }): string[] {
    const args = ['exec'];
    if (opts?.interactive) args.push('-i');
    args.push('-u', opts?.write ? SANDBOX_USER : 'root', this.containerName);
    return args;
  }

  async exec(command: string, opts?: ExecOptions): Promise<ExecResult> {
    const cwd =
      opts?.cwd === undefined ? this.toolRootPod() : this.podPath(opts.cwd);
    const result = await runDocker(
      buildPodmanExecArgs(this.containerName, this.mode, [
        'exec',
        '-w',
        cwd,
        this.projectContainerName,
        'bash',
        '-lc',
        command,
      ]),
      {
        dockerPath: this.dockerPath,
        timeoutMs: opts?.timeoutMs ?? this.defaultTimeoutMs,
        maxBytes: opts?.maxBuffer,
        signal: opts?.signal,
      }
    );
    if (result.spawnError) {
      return {
        stdout: result.stdout,
        stderr: `docker exec failed: ${result.spawnError}`,
        exit_code: 1,
      };
    }
    if (result.timedOut) {
      return {
        stdout: result.stdout,
        stderr: `${result.stderr}\n[command timed out]`,
        exit_code: TIMEOUT_EXIT_CODE,
      };
    }
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exitCode ?? 1,
    };
  }

  async readFile(relPath: string): Promise<ReadFileResult> {
    const target = this.hostPath(relPath);
    const result = await runDocker(
      [...this.fileOpsPrefix(), 'sh', '-c', 'cat -- "$0"', target],
      { dockerPath: this.dockerPath, timeoutMs: this.defaultTimeoutMs }
    );
    if (result.spawnError) {
      throw new SandboxCommandError(`docker exec failed: ${result.spawnError}`);
    }
    if (!ok(result)) {
      throw new SandboxFileOperationError(
        'read',
        relPath,
        result.stderr.trim() || `cannot read ${relPath}`
      );
    }
    const content = result.stdout;
    return { content, totalLines: content.split('\n').length };
  }

  async readBinary(relPath: string): Promise<Buffer> {
    const target = this.hostPath(relPath);
    const result = await runDocker(
      [...this.fileOpsPrefix(), 'sh', '-c', 'cat -- "$0"', target],
      {
        dockerPath: this.dockerPath,
        timeoutMs: this.defaultTimeoutMs,
        stdout: 'buffer',
        maxBytes: READ_BINARY_MAX_BYTES,
      }
    );
    if (result.spawnError) {
      throw new SandboxCommandError(`docker exec failed: ${result.spawnError}`);
    }
    if (!ok(result)) {
      throw new SandboxFileOperationError(
        'read',
        relPath,
        result.stderr.trim() || `cannot read ${relPath}`
      );
    }
    return result.stdoutBuffer ?? Buffer.alloc(0);
  }

  async writeFile(
    relPath: string,
    content: string
  ): Promise<{ bytesWritten: number }> {
    const target = this.hostPath(relPath);
    const result = await runDocker(
      [
        ...this.fileOpsPrefix({ interactive: true, write: true }),
        'sh',
        '-c',
        'mkdir -p "$(dirname -- "$0")" && cat > "$0"',
        target,
      ],
      {
        dockerPath: this.dockerPath,
        input: content,
        timeoutMs: this.defaultTimeoutMs,
      }
    );
    if (result.spawnError) {
      throw new SandboxCommandError(`docker exec failed: ${result.spawnError}`);
    }
    if (!ok(result)) {
      throw new SandboxFileOperationError(
        'write',
        relPath,
        result.stderr.trim() || `cannot write ${relPath}`
      );
    }
    return { bytesWritten: Buffer.byteLength(content) };
  }

  async writeBinary(
    relPath: string,
    content: Buffer
  ): Promise<{ bytesWritten: number }> {
    const target = this.hostPath(relPath);
    const result = await runDocker(
      [
        ...this.fileOpsPrefix({ interactive: true, write: true }),
        'sh',
        '-c',
        'mkdir -p "$(dirname -- "$0")" && base64 -d > "$0"',
        target,
      ],
      {
        dockerPath: this.dockerPath,
        input: content.toString('base64'),
        timeoutMs: this.defaultTimeoutMs,
      }
    );
    if (result.spawnError) {
      throw new SandboxCommandError(`docker exec failed: ${result.spawnError}`);
    }
    if (!ok(result)) {
      throw new SandboxFileOperationError(
        'write',
        relPath,
        result.stderr.trim() || `cannot write ${relPath}`
      );
    }
    return { bytesWritten: content.length };
  }

  async listDir(relPath: string): Promise<DirEntry[]> {
    const dir = this.hostPath(relPath);
    const result = await runDocker(
      [
        ...this.fileOpsPrefix(),
        'find',
        dir,
        '-maxdepth',
        '1',
        '-mindepth',
        '1',
        '-printf',
        '%y\t%s\t%f\n',
      ],
      { dockerPath: this.dockerPath, timeoutMs: this.defaultTimeoutMs }
    );
    if (result.spawnError) {
      throw new SandboxCommandError(`docker exec failed: ${result.spawnError}`);
    }
    if (!ok(result) && result.stdout.trim() === '') {
      throw new SandboxFileOperationError(
        'list',
        relPath,
        result.stderr.trim() || `cannot list ${relPath}`
      );
    }
    const entries: DirEntry[] = [];
    for (const line of result.stdout.split('\n')) {
      if (!line) continue;
      const [typeChar, sizeStr, ...nameParts] = line.split('\t');
      const name = nameParts.join('\t');
      if (!name) continue;
      entries.push({
        name,
        type: typeChar === 'd' ? 'dir' : typeChar === 'f' ? 'file' : 'other',
        size: Number.parseInt(sizeStr, 10) || 0,
      });
    }
    return entries.sort((a, b) => {
      if (a.type !== b.type) {
        if (a.type === 'dir') return -1;
        if (b.type === 'dir') return 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  async snapshot(opts?: SnapshotOptions): Promise<FileSnapshot> {
    const exclude = opts?.exclude ?? DEFAULT_SNAPSHOT_EXCLUDE;
    const args = [...this.fileOpsPrefix(), 'find', this.workspaceDir];
    if (exclude.length > 0) {
      args.push('(');
      exclude.forEach((name, index) => {
        if (index > 0) args.push('-o');
        args.push('-name', name);
      });
      args.push(')', '-prune', '-o');
    }
    args.push('-type', 'f', '-printf', '%T@\t%s\t%P\n');
    const result = await runDocker(args, {
      dockerPath: this.dockerPath,
      timeoutMs: this.defaultTimeoutMs,
    });
    if (result.spawnError) {
      throw new SandboxCommandError(`docker exec failed: ${result.spawnError}`);
    }
    const snapshot: FileSnapshot = new Map();
    for (const line of result.stdout.split('\n')) {
      if (!line) continue;
      const [mtimeStr, sizeStr, ...pathParts] = line.split('\t');
      const path = pathParts.join('\t');
      if (!path) continue;
      snapshot.set(path, {
        size: Number.parseInt(sizeStr, 10) || 0,
        mtimeMs: Math.round(Number.parseFloat(mtimeStr) * 1000) || 0,
      });
    }
    return snapshot;
  }

  watch(
    onEvent: (event: FileChange) => void,
    opts?: WatchOptions
  ): SandboxWatcher {
    const exclude = opts?.exclude ?? DEFAULT_SNAPSHOT_EXCLUDE;
    const args = [
      ...this.fileOpsPrefix(),
      'inotifywait',
      '-m',
      '-q',
      '-r',
      '-e',
      'create',
      '-e',
      'close_write',
      '-e',
      'delete',
      '-e',
      'moved_from',
      '-e',
      'moved_to',
    ];
    if (exclude.length > 0) {
      args.push(
        '--exclude',
        `(^|/)(${exclude.map(escapeRegExp).join('|')})(/|$)`
      );
    }
    args.push('--format', '%e|%w%f', this.workspaceDir);

    const child = spawn(this.dockerPath, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let buffer = '';
    child.stdout.on('data', (data: Buffer) => {
      buffer += data.toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const event = this.parseInotifyLine(line);
        if (event) onEvent(event);
        newline = buffer.indexOf('\n');
      }
    });
    child.on('error', () => {});
    return {
      stop: (): void => {
        child.kill('SIGTERM');
      },
    };
  }

  private parseInotifyLine(line: string): FileChange | null {
    const separator = line.indexOf('|');
    if (separator < 0) return null;
    const events = line.slice(0, separator).split(',');
    const full = line.slice(separator + 1);
    let rel =
      full === this.workspaceDir
        ? ''
        : full.startsWith(`${this.workspaceDir}/`)
          ? full.slice(this.workspaceDir.length + 1)
          : full;
    if (!rel) return null;
    if (events.includes('ISDIR')) rel += '/';
    if (events.includes('CREATE') || events.includes('MOVED_TO')) {
      return { path: rel, kind: 'created' };
    }
    if (events.includes('DELETE') || events.includes('MOVED_FROM')) {
      return { path: rel, kind: 'deleted' };
    }
    return { path: rel, kind: 'updated' };
  }
}

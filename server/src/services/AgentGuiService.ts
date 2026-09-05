import type { Sandbox } from 'tenjo-chat-engine';
import { agentEventBus } from '../events/AgentEventBus';
import { SANDBOX_PUBLISH_PORTS, sandboxManager } from './AgentSandboxService';
import {
  resolveSandboxVncHost,
  resolveSandboxVncPort
} from '../utils/sandboxVncTarget';
import logger from '../logger';
import type { AgentProject } from '../repositories/AgentProjectRepository';

/** Status reported to clients for a project's GUI preview lifecycle. */
export type AgentGuiStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error';

interface WebPreviewEntry {
  kind?: 'web';
  port: number;
  command: string;
  cwd?: string;
  path?: string;
}
interface GuiPreviewEntry {
  kind: 'gui';
  command: string;
  cwd?: string;
  name?: string;
}
type PreviewEntry = WebPreviewEntry | GuiPreviewEntry;

const MANIFEST_PATH = '.tenjo/dev-servers.json';
const DEV_SERVER_LOG = '.tenjo/dev-server.log';
const STATIC_PREVIEW_PORT_START = 8000;
const STATIC_PREVIEW_PORT_END = 8099;
const GUI_APP_PID = '.tenjo/gui-app.pid';
const GUI_APP_LOG = '/tmp/gui-app.log';
const GUI_COMPOSITOR_RUNTIME_DIR = '/tmp/xdg';
const GUI_APP_RUNTIME_DIR = '/tmp/tenjo-gui-app-runtime';
const GUI_APP_PROBE_MS = 1500;
const DEV_SERVER_START_TIMEOUT_MS = 30_000;
const FIT_GUI_WINDOW_SCRIPT = [
  '(',
  `  COMPOSITOR_RUNTIME_DIR=${GUI_COMPOSITOR_RUNTIME_DIR}`,
  '  SWAYSOCK=$(ls "$COMPOSITOR_RUNTIME_DIR"/sway-ipc.*.sock 2>/dev/null | head -n1 || true)',
  '  [ -n "$SWAYSOCK" ] || exit 0',
  '  export SWAYSOCK',
  '  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do',
  '    swaymsg "[class=\\".*\\"] floating disable" >/dev/null 2>&1 || true',
  '    swaymsg "[class=\\".*\\"] border pixel 2" >/dev/null 2>&1 || true',
  '    swaymsg "[app_id=\\".*\\"] floating disable" >/dev/null 2>&1 || true',
  '    swaymsg "[app_id=\\".*\\"] border pixel 2" >/dev/null 2>&1 || true',
  '    sleep 0.5',
  '  done',
  ') &'
].join('\n');

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Resolves a manifest cwd into an absolute sandbox workspace path. */
export function resolvePreviewCwd(workspace: string, cwd?: string): string {
  const root = workspace.replace(/\/+$/, '') || '/';
  const raw = cwd?.trim();
  if (!raw || raw === '.') {
    return root;
  }
  const value = raw.replace(/\/+$/, '') || '/';
  if (value === root || value.startsWith(`${root}/`)) {
    return value;
  }
  if (value === '/workspace' || value.startsWith('/workspace/')) {
    return `${root}${value.slice('/workspace'.length)}`;
  }
  const bareRoot = root.replace(/^\/+/, '');
  if (value === bareRoot || value.startsWith(`${bareRoot}/`)) {
    return `${root}${value.slice(bareRoot.length)}`;
  }
  if (value.startsWith('/')) {
    return `${root}/${value.replace(/^\/+/, '')}`;
  }
  return `${root}/${value.replace(/^\.\//, '')}`;
}

const SCRIPT_INTERPRETERS = new Set([
  'python',
  'python3',
  'node',
  'nodejs',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'deno',
  'ruby',
  'perl',
  'php',
  'java',
  'dotnet',
  'mono',
  'sh',
  'bash'
]);

function escapeEre(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function previewKillPattern(command: string): string | null {
  const core = command
    .replace(/^(\s*[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '')
    .trim();
  if (!core) {
    return null;
  }
  const tokens = core.split(/\s+/);
  const program = tokens[0];
  const base = program.replace(/.*\//, '');
  const pattern =
    SCRIPT_INTERPRETERS.has(base) && tokens[1]
      ? `${program} ${tokens[1]}`
      : program;
  return escapeEre(pattern);
}

function isPreviewEntry(value: unknown): value is PreviewEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as {
    kind?: unknown;
    port?: unknown;
    command?: unknown;
    cwd?: unknown;
    path?: unknown;
  };
  if (typeof entry.command !== 'string' || entry.command.trim() === '') {
    return false;
  }
  if (entry.cwd !== undefined && typeof entry.cwd !== 'string') {
    return false;
  }
  if (entry.path !== undefined && typeof entry.path !== 'string') {
    return false;
  }
  if (entry.kind === 'gui') {
    return true;
  }
  if (entry.kind !== undefined && entry.kind !== 'web') {
    return false;
  }
  return (
    typeof entry.port === 'number' &&
    Number.isInteger(entry.port) &&
    entry.port >= 1 &&
    entry.port <= 65535
  );
}

/** Parses a localhost URL into the sanitized target used by the preview. */
export function parseLocalUrl(
  raw: string
): { port: number; url: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }
  if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    return null;
  }
  const port = parsed.port
    ? Number(parsed.port)
    : parsed.protocol === 'http:'
      ? 80
      : 443;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  // This localhost is resolved inside the sandbox GUI desktop, not in the
  // user's browser or on the public server host.
  return {
    port,
    url: `${parsed.protocol}//localhost:${port}${parsed.pathname}${parsed.search}`
  };
}

function previewPathInput(path: string): string {
  const withoutHash = path.trim().split('#')[0] ?? '';
  if (!withoutHash) {
    return '/';
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(withoutHash)) {
    return `/${withoutHash.replace(/^\/+/, '')}`;
  }
  if (withoutHash.startsWith('/')) {
    return `.${withoutHash}`;
  }
  return withoutHash;
}

/** Builds the localhost URL opened for a recorded web preview. */
export function buildWebPreviewUrl(port: number, path?: string): string {
  // This localhost is resolved inside the sandbox GUI desktop, not in the
  // user's browser or on the public server host.
  const base = `http://localhost:${port}/`;
  if (!path?.trim()) {
    return base;
  }
  const parsed = new URL(previewPathInput(path), base);
  return `http://localhost:${port}${parsed.pathname}${parsed.search}`;
}

function isStaticHttpServerCommand(command: string): boolean {
  return (
    /\bpython(?:3(?:\.\d+)?)?\s+-m\s+http\.server\b/.test(command) ||
    /\bhttp-server\b/.test(command)
  );
}

function staticHtmlPathFromListing(listing: string): string | undefined {
  const files = listing
    .split('\n')
    .map((file) => file.trim())
    .filter((file) => file.length > 0);
  const indexFile = files.find((file) => /^index\.html?$/i.test(file));
  if (indexFile) {
    return undefined;
  }
  return files.length === 1 ? files[0] : undefined;
}

class AgentGuiService {
  private readonly busy = new Set<string>();

  private emit(
    projectId: string,
    status: AgentGuiStatus,
    detail?: string
  ): void {
    agentEventBus.emit(projectId, { type: 'gui-status', status, detail });
  }

  private launchError(projectId: string, message: string): void {
    agentEventBus.emit(projectId, { type: 'preview-launch-error', message });
  }

  /** Starts the GUI desktop without opening a recorded preview. */
  start(project: AgentProject, ime?: boolean): void {
    this.runExclusive(project, () => this.launch(project, undefined, ime));
  }

  /** Opens the recorded preview or a provided localhost URL in the GUI desktop. */
  open(project: AgentProject, rawUrl?: string, ime?: boolean): void {
    this.runExclusive(project, () => this.openInner(project, rawUrl, ime));
  }

  private runExclusive(project: AgentProject, work: () => Promise<void>): void {
    if (this.busy.has(project.id)) {
      return;
    }
    this.busy.add(project.id);
    void work()
      .catch((error: unknown) => {
        logger.error('[agent-gui] GUI operation failed', {
          projectId: project.id,
          error: error instanceof Error ? (error.stack ?? error.message) : error
        });
        this.emit(
          project.id,
          'error',
          error instanceof Error ? error.message : 'Failed to start the GUI.'
        );
      })
      .finally(() => {
        this.busy.delete(project.id);
      });
  }

  private async launch(
    project: AgentProject,
    url: string | undefined,
    ime: boolean | undefined
  ): Promise<void> {
    this.emit(project.id, 'starting');
    await sandboxManager.startGui(project.id, { url, ime });
    this.emit(project.id, 'running');
  }

  private async openInner(
    project: AgentProject,
    rawUrl: string | undefined,
    ime: boolean | undefined
  ): Promise<void> {
    const key = project.id;
    const sandbox = await sandboxManager.getSandbox(key);
    const manifest = await this.readManifest(sandbox);
    const last = manifest[manifest.length - 1];

    if (!rawUrl && last?.kind === 'gui') {
      await this.announceStarting(project, key);
      await sandboxManager.startGui(key, { ime });
      await this.ensureGuiApp(project, sandbox, last);
      this.emit(project.id, 'running');
      return;
    }

    const target = rawUrl
      ? parseLocalUrl(rawUrl)
      : last && last.kind !== 'gui'
        ? await this.targetFromWebEntry(sandbox, last)
        : null;
    if (target) {
      await this.ensureDevServer(project, sandbox, manifest, target);
    } else {
      this.launchError(
        project.id,
        'No preview is set up for this project yet. The agent can start one and record how to launch it.'
      );
    }
    await this.announceStarting(project, key);
    await sandboxManager.startGui(key, { url: target?.url, ime });
    this.emit(project.id, 'running');
  }

  private async targetFromWebEntry(
    sandbox: Sandbox,
    entry: WebPreviewEntry
  ): Promise<{ port: number; url: string }> {
    const inferredPath =
      entry.path ?? (await this.inferStaticHtmlPath(sandbox, entry));
    return {
      port: entry.port,
      url: buildWebPreviewUrl(entry.port, inferredPath)
    };
  }

  private async inferStaticHtmlPath(
    sandbox: Sandbox,
    entry: WebPreviewEntry
  ): Promise<string | undefined> {
    if (!isStaticHttpServerCommand(entry.command)) {
      return undefined;
    }
    const workspace = sandbox.getWorkspaceDir?.() ?? '.';
    const cwd = resolvePreviewCwd(workspace, entry.cwd);
    const result = await sandbox.exec(
      [
        `cd ${shellQuote(cwd)} 2>/dev/null || exit 0`,
        'if [ -f index.html ] || [ -f index.htm ]; then exit 0; fi',
        'find . -maxdepth 1 -type f \\( -iname "*.html" -o -iname "*.htm" \\) -printf "%P\\n" | sort'
      ].join('\n'),
      { timeoutMs: 15_000, maxBuffer: 4096 }
    );
    if (result.exit_code !== 0) {
      return undefined;
    }
    const htmlFiles = result.stdout
      .split('\n')
      .map((file) => file.trim())
      .filter((file) => file.length > 0);
    return htmlFiles.length === 1 ? htmlFiles[0] : undefined;
  }

  private async announceStarting(
    project: AgentProject,
    key: string
  ): Promise<void> {
    if ((await sandboxManager.getGuiStatus(key)) !== 'running') {
      this.emit(project.id, 'starting');
    }
  }

  private async ensureGuiApp(
    project: AgentProject,
    sandbox: Sandbox,
    entry: GuiPreviewEntry
  ): Promise<void> {
    const workspace = sandbox.getWorkspaceDir?.() ?? '.';
    const pidFile = `${workspace}/${GUI_APP_PID}`;
    const cwd = resolvePreviewCwd(workspace, entry.cwd);
    const command = entry.command;
    const killPattern = previewKillPattern(entry.command);
    const script = [
      `COMPOSITOR_RUNTIME_DIR=${shellQuote(GUI_COMPOSITOR_RUNTIME_DIR)}`,
      `APP_RUNTIME_DIR=${shellQuote(GUI_APP_RUNTIME_DIR)}`,
      'export DBUS_SESSION_BUS_ADDRESS="unix:path=$COMPOSITOR_RUNTIME_DIR/bus"',
      'WD=$(ls "$COMPOSITOR_RUNTIME_DIR" 2>/dev/null | grep -m1 "^wayland-[0-9]*$" || true)',
      '[ -n "$WD" ] || { echo "GUI desktop is not running" >&2; exit 1; }',
      'install -d -m 700 "$APP_RUNTIME_DIR"',
      'chmod 700 "$APP_RUNTIME_DIR"',
      'export XDG_RUNTIME_DIR="$APP_RUNTIME_DIR"',
      'export WAYLAND_DISPLAY="$COMPOSITOR_RUNTIME_DIR/$WD"',
      // X11-only toolkits connect through Xwayland. Prefer the active socket
      // when present, but always provide the conventional :0 display so the app
      // does not decide it is headless while Xwayland is still mapping.
      'export DISPLAY=:0',
      'for _ in 1 2 3 4 5 6 7 8 9 10; do [ -S /tmp/.X11-unix/X0 ] && break; sleep 0.2; done',
      'X=$(ls /tmp/.X11-unix 2>/dev/null | grep -m1 "^X[0-9]*$" || true)',
      '[ -n "$X" ] && export DISPLAY=":$(printf %s "$X" | cut -c2-)" || true',
      'export GDK_BACKEND=wayland,x11',
      'export QT_QPA_PLATFORM="wayland;xcb"',
      'export SDL_VIDEODRIVER=wayland',
      `WORKSPACE_DIR=${shellQuote(workspace)}`,
      `LAUNCH_CWD=${shellQuote(cwd)}`,
      `COMMAND=${shellQuote(command)}`,
      'cd "$LAUNCH_CWD" 2>/dev/null || cd /',
      'set -- $COMMAND',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in *=*) shift ;; *) break ;; esac',
      'done',
      'PROGRAM="$' + '{1:-}"',
      'if [ -n "$PROGRAM" ]; then',
      '  shift || true',
      '  PROGRAM_ARGS="$*"',
      '  case "$PROGRAM" in',
      '    "$WORKSPACE_DIR"|"$WORKSPACE_DIR"/*) PROGRAM_PATH="$PROGRAM" ;;',
      '    /workspace) PROGRAM_PATH="$WORKSPACE_DIR" ;;',
      '    /workspace/*) PROGRAM_PATH="$WORKSPACE_DIR/$' +
        '{PROGRAM#/workspace/}" ;;',
      '    workspace) PROGRAM_PATH="$WORKSPACE_DIR" ;;',
      '    workspace/*) PROGRAM_PATH="$WORKSPACE_DIR/$' +
        '{PROGRAM#workspace/}" ;;',
      '    */*) PROGRAM_PATH="$PROGRAM" ;;',
      '    *) PROGRAM_PATH=$(command -v "$PROGRAM" 2>/dev/null || true) ;;',
      '  esac',
      '  if [ -n "$PROGRAM_PATH" ] && [ "$PROGRAM_PATH" != "$PROGRAM" ] && [ -e "$PROGRAM_PATH" ]; then',
      '    COMMAND="$PROGRAM_PATH$' + '{PROGRAM_ARGS:+ $PROGRAM_ARGS}"',
      '  fi',
      '  if [ -n "$PROGRAM_PATH" ] && [ -e "$PROGRAM_PATH" ] && [ ! -d "$PROGRAM_PATH" ] && [ ! -x "$PROGRAM_PATH" ]; then',
      '    chmod +x "$PROGRAM_PATH" 2>/dev/null || true',
      '  fi',
      '  if { [ -z "$PROGRAM_PATH" ] || [ ! -e "$PROGRAM_PATH" ]; } && [ -n "$PROGRAM" ]; then',
      '    BASE=$(basename "$PROGRAM")',
      '    for CANDIDATE in "$LAUNCH_CWD/$BASE" "$WORKSPACE_DIR/$BASE" "$WORKSPACE_DIR/build/$BASE" "$WORKSPACE_DIR"/*/"$BASE"; do',
      '      if [ -f "$CANDIDATE" ]; then',
      '        chmod +x "$CANDIDATE" 2>/dev/null || true',
      '        cd "$(dirname "$CANDIDATE")"',
      '        COMMAND="./$BASE$' + '{PROGRAM_ARGS:+ $PROGRAM_ARGS}"',
      '        PROGRAM_PATH="./$BASE"',
      '        break',
      '      fi',
      '    done',
      '  fi',
      '  if [ "$#" -eq 0 ] && [ -n "$PROGRAM_PATH" ] && [ -d "$PROGRAM_PATH" ]; then',
      '    BASE=$(basename "$PROGRAM_PATH")',
      '    if [ -f "$PROGRAM_PATH/$BASE" ]; then',
      '      chmod +x "$PROGRAM_PATH/$BASE" 2>/dev/null || true',
      '      cd "$PROGRAM_PATH"',
      '      COMMAND="./$BASE"',
      '    fi',
      '  fi',
      'fi',
      `OLD=$(cat ${shellQuote(pidFile)} 2>/dev/null || true)`,
      '[ -n "$OLD" ] && kill -- -"$OLD" 2>/dev/null || true',
      ...(killPattern
        ? [
            'for _ in 1 2 3 4 5 6 7 8 9 10; do',
            '  alive=',
            `  for p in $(pgrep -f ${shellQuote(killPattern)} 2>/dev/null); do`,
            '    case "$p" in "$$"|"$PPID") continue ;; esac',
            '    kill -- -"$p" 2>/dev/null || true',
            '    kill "$p" 2>/dev/null || true',
            '    alive=1',
            '  done',
            '  [ -n "$alive" ] || break',
            '  sleep 0.2',
            'done'
          ]
        : []),
      `setsid sh -c "$COMMAND" </dev/null >${GUI_APP_LOG} 2>&1 &`,
      `echo $! > ${shellQuote(pidFile)}`,
      FIT_GUI_WINDOW_SCRIPT
    ].join('\n');
    const result = await sandbox.exec(script, { timeoutMs: 15_000 });
    if (result.exit_code !== 0) {
      this.launchError(
        project.id,
        `Failed to launch the GUI app: ${result.stderr.trim() || 'unknown error'}`
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, GUI_APP_PROBE_MS));
    if (await this.isGuiAppAlive(sandbox, pidFile)) {
      return;
    }
    const log = await sandbox.exec(`tail -n 30 ${GUI_APP_LOG} 2>/dev/null`, {
      timeoutMs: 15_000
    });
    this.launchError(
      project.id,
      `The GUI app (${entry.command}) exited right after launch. Log:\n${
        log.stdout.trim() || '(no output)'
      }`
    );
  }

  private async isGuiAppAlive(
    sandbox: Sandbox,
    pidFile: string
  ): Promise<boolean> {
    const result = await sandbox.exec(
      `kill -0 "$(cat ${shellQuote(pidFile)} 2>/dev/null)" 2>/dev/null`,
      { timeoutMs: 15_000 }
    );
    return result.exit_code === 0;
  }

  private async ensureDevServer(
    project: AgentProject,
    sandbox: Sandbox,
    manifest: PreviewEntry[],
    target: { port: number; url: string }
  ): Promise<void> {
    if (await this.isHttpResponsive(sandbox, target.url)) {
      return;
    }
    const entry = [...manifest]
      .reverse()
      .find(
        (e): e is WebPreviewEntry => e.kind !== 'gui' && e.port === target.port
      );
    if (!entry) {
      this.launchError(
        project.id,
        `No HTTP response came back from port ${target.port} and no start command for it is recorded — the agent can start the server again.`
      );
      return;
    }
    const workspace = sandbox.getWorkspaceDir?.() ?? '.';
    const cwd = resolvePreviewCwd(workspace, entry.cwd);
    const log = `${workspace}/${DEV_SERVER_LOG}`;
    await this.stopPortListeners(sandbox, target.port);
    const result = await sandbox.exec(
      `mkdir -p ${shellQuote(`${workspace}/.tenjo`)} && cd ${shellQuote(cwd)} && nohup sh -c ${shellQuote(entry.command)} </dev/null >>${shellQuote(log)} 2>&1 &`,
      { timeoutMs: 15_000 }
    );
    if (result.exit_code !== 0) {
      this.launchError(
        project.id,
        `Failed to restart the dev server for port ${target.port}: ${result.stderr.trim() || 'unknown error'}`
      );
      return;
    }
    const deadline = Date.now() + DEV_SERVER_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.isHttpResponsive(sandbox, target.url)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const serverLog = await sandbox.exec(`tail -n 30 ${shellQuote(log)}`, {
      timeoutMs: 15_000,
      maxBuffer: 4096
    });
    this.launchError(
      project.id,
      `The dev server for port ${target.port} was restarted but did not return an HTTP response — the agent can check its log and fix it.\n${
        serverLog.stdout.trim() || '(no dev-server log output)'
      }`
    );
  }

  private async isHttpResponsive(
    sandbox: Sandbox,
    url: string
  ): Promise<boolean> {
    const script = [
      `python3 - ${shellQuote(url)} <<'PY'`,
      'import sys',
      'import urllib.error',
      'import urllib.request',
      'try:',
      '    with urllib.request.urlopen(sys.argv[1], timeout=2) as response:',
      '        response.read(1)',
      'except urllib.error.HTTPError:',
      '    sys.exit(0)',
      'except Exception:',
      '    sys.exit(1)',
      'sys.exit(0)',
      'PY'
    ].join('\n');
    const result = await sandbox.exec(script, {
      timeoutMs: 5_000,
      maxBuffer: 1024
    });
    return result.exit_code === 0;
  }

  private async stopPortListeners(
    sandbox: Sandbox,
    port: number
  ): Promise<void> {
    await sandbox.exec(
      [
        `PORT=${port}`,
        'pids=$(ss -ltnp "sport = :$PORT" 2>/dev/null | sed -n "s/.*pid=\\([0-9][0-9]*\\).*/\\1/p" | sort -u)',
        '[ -n "$pids" ] || exit 0',
        'kill $pids 2>/dev/null || true',
        'sleep 0.2',
        'kill -9 $pids 2>/dev/null || true'
      ].join('\n'),
      { timeoutMs: 15_000, maxBuffer: 1024 }
    );
  }

  /** Returns whether the project has a recorded preview and its latest kind. */
  async previewInfo(sandbox: Sandbox): Promise<{
    available: boolean;
    kind: 'web' | 'gui' | null;
  }> {
    const manifest = await this.readManifest(sandbox);
    const last = manifest[manifest.length - 1];
    return {
      available: manifest.length > 0,
      kind: last ? (last.kind === 'gui' ? 'gui' : 'web') : null
    };
  }

  /** Returns the raw preview manifest content, or an empty string when absent. */
  async previewSignature(sandbox: Sandbox): Promise<string> {
    try {
      const { content } = await sandbox.readFile(MANIFEST_PATH);
      return content;
    } catch {
      return '';
    }
  }

  /** Creates a simple static HTML preview manifest when no preview is recorded. */
  async ensureStaticHtmlPreview(sandbox: Sandbox): Promise<boolean> {
    if (await this.previewSignature(sandbox)) {
      return false;
    }
    const workspace = sandbox.getWorkspaceDir?.() ?? '.';
    const htmlResult = await sandbox.exec(
      [
        `cd ${shellQuote(workspace)} 2>/dev/null || exit 0`,
        'find . -maxdepth 1 -type f \\( -iname "*.html" -o -iname "*.htm" \\) -printf "%P\\n" | sort'
      ].join('\n'),
      { timeoutMs: 15_000, maxBuffer: 4096 }
    );
    if (htmlResult.exit_code !== 0) {
      return false;
    }
    const path = staticHtmlPathFromListing(htmlResult.stdout);
    const htmlFiles = htmlResult.stdout
      .split('\n')
      .map((file) => file.trim())
      .filter((file) => file.length > 0);
    const hasIndex = htmlFiles.some((file) => /^index\.html?$/i.test(file));
    if (!hasIndex && path === undefined) {
      return false;
    }
    const portResult = await sandbox.exec(
      [
        `for p in $(seq ${STATIC_PREVIEW_PORT_START} ${STATIC_PREVIEW_PORT_END}); do`,
        '  if ! ss -ltn | grep -Eq ":$p([[:space:]]|$)"; then echo "$p"; exit 0; fi',
        'done',
        'exit 1'
      ].join('\n'),
      { timeoutMs: 15_000, maxBuffer: 256 }
    );
    if (portResult.exit_code !== 0) {
      return false;
    }
    const port = Number(portResult.stdout.trim());
    if (!Number.isInteger(port)) {
      return false;
    }
    const entry: WebPreviewEntry = {
      port,
      command: `python3 -m http.server ${port}`,
      cwd: ''
    };
    if (path) {
      entry.path = path;
    }
    await sandbox.writeFile(
      MANIFEST_PATH,
      `${JSON.stringify([entry], null, 2)}\n`
    );
    return true;
  }

  private async readManifest(sandbox: Sandbox): Promise<PreviewEntry[]> {
    try {
      const { content } = await sandbox.readFile(MANIFEST_PATH);
      const parsed: unknown = JSON.parse(content);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(isPreviewEntry);
    } catch {
      return [];
    }
  }

  /** Toggles the GUI desktop IME for the project. */
  async toggleIme(project: AgentProject): Promise<void> {
    await sandboxManager.toggleGuiIme(project.id);
  }

  /** Stops the GUI desktop and emits lifecycle events for connected clients. */
  async stop(project: AgentProject): Promise<void> {
    this.emit(project.id, 'stopping');
    try {
      await sandboxManager.stopGui(project.id);
    } catch (error) {
      this.emit(
        project.id,
        'error',
        error instanceof Error ? error.message : 'Failed to stop the GUI.'
      );
      throw error;
    }
    this.emit(project.id, 'stopped');
  }

  /** Returns the current GUI status, including in-flight operations. */
  async status(project: AgentProject): Promise<AgentGuiStatus> {
    if (this.busy.has(project.id)) {
      return 'starting';
    }
    return sandboxManager.getGuiStatus(project.id);
  }

  /** Returns the host VNC port for the project's GUI desktop. */
  async vncPort(project: AgentProject): Promise<number | undefined> {
    return sandboxManager.getGuiVncPort(project.id);
  }

  /**
   * TCP host and port the VNC relay should dial. Prefers the sandbox
   * container address so GUI preview does not require host port publish.
   */
  async vncTarget(
    project: AgentProject
  ): Promise<{ host: string; port: number } | undefined> {
    const containerPort = await sandboxManager.getGuiVncPort(project.id);
    if (!containerPort) {
      return undefined;
    }
    const host = resolveSandboxVncHost(
      process.env.AGENT_SANDBOX_VNC_HOST || process.env.AGENT_SANDBOX_HOST,
      await sandboxManager.getContainerIp()
    );
    return {
      host,
      port: resolveSandboxVncPort(host, containerPort, SANDBOX_PUBLISH_PORTS)
    };
  }
}

export const agentGuiService = new AgentGuiService();

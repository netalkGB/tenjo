/**
 * Execution environment the coding tools (bash / read_file / str_replace /
 * write_file) run against. The tools never touch the filesystem or spawn a
 * process directly — they go through a Sandbox, so the SAME tools work whether
 * the work happens on the host (LocalSandbox, dev/test) or inside an isolated
 * Docker container (DockerSandbox).
 *
 * All paths are workspace-relative and pass through the path jail
 * (see pathJail.ts): a model-supplied path can never escape the workspace root.
 * `exec` runs a shell command and is intentionally NOT path-jailed — it is the
 * container/host shell and may touch anything the sandbox itself can reach;
 * the isolation boundary for `exec` is the sandbox (a container), not the path.
 */
export interface ExecResult {
  stdout: string;
  stderr: string;
  /** Process exit code; 0 = success. Non-zero is surfaced to the model as-is. */
  exit_code: number;
}

export interface ExecOptions {
  /** Working directory for the command, workspace-relative (jailed). */
  cwd?: string;
  /** Wall-clock cap; the command is killed when it elapses. */
  timeoutMs?: number;
  /** Cap on captured stdout/stderr so a runaway command can't blow up context. */
  maxBuffer?: number;
  /** Aborts the command (wired from the caller's generation abort signal). */
  signal?: AbortSignal;
}

export interface ReadFileResult {
  /** Raw file contents (no line numbering — the tool layer formats them). */
  content: string;
  /** Total number of lines in the file. */
  totalLines: number;
}

/** One entry returned by {@link Sandbox.listDir}. */
export interface DirEntry {
  /** Base name of the entry. */
  name: string;
  type: 'file' | 'dir' | 'other';
  /** Size in bytes (0 for directories). */
  size: number;
}

/** Size + mtime of a single file, used to detect changes between snapshots. */
export interface FileStat {
  size: number;
  mtimeMs: number;
}

/**
 * A point-in-time view of the workspace's files: workspace-relative POSIX path
 * → {@link FileStat}. Diff two of these with {@link diffSnapshots} to see what
 * an agent turn created / updated / deleted (incl. files produced by `bash`,
 * which the edit-tool calls do not surface).
 */
export type FileSnapshot = Map<string, FileStat>;

export interface FileChange {
  /** Workspace-relative POSIX path. */
  path: string;
  kind: 'created' | 'updated' | 'deleted';
}

export interface SnapshotOptions {
  /**
   * Directory names pruned from the walk at any depth. Defaults to
   * `['node_modules', '.git']` so dependency/VCS churn doesn't drown the diff.
   */
  exclude?: string[];
}

export interface WatchOptions {
  /**
   * Directory names excluded from the watch (and its recursive setup). Defaults
   * to `['node_modules', '.git']`.
   */
  exclude?: string[];
}

/** Handle to stop a {@link Sandbox.watch} stream. */
export interface SandboxWatcher {
  stop(): void;
}

export interface Sandbox {
  /**
   * Host dev-server ports allocated to this sandbox, when the backend publishes
   * any — what the dev-server prompt hint is built from. Optional: backends
   * without port publishing omit it.
   */
  readonly devPorts?: { readonly start: number; readonly end: number };
  /** Run a shell command. Not path-jailed — the sandbox itself is the boundary. */
  exec(command: string, opts?: ExecOptions): Promise<ExecResult>;
  /** Read a text file as UTF-8 (workspace-relative path, jailed). */
  readFile(relPath: string): Promise<ReadFileResult>;
  /** Read a file as raw bytes (for download/preview of PDFs, images, etc.). */
  readBinary(relPath: string): Promise<Buffer>;
  /** Create or overwrite a file (parent dirs created); path jailed. */
  writeFile(
    relPath: string,
    content: string
  ): Promise<{ bytesWritten: number }>;
  /**
   * Create or overwrite a file from raw bytes (parent dirs created); path
   * jailed. Use this for non-text uploads (images, PDFs, …) where routing the
   * content through {@link writeFile}'s UTF-8 string path would corrupt it.
   * Optional: backends that can't write binary omit it and callers fall back.
   */
  writeBinary?(
    relPath: string,
    content: Buffer
  ): Promise<{ bytesWritten: number }>;
  /** List the immediate entries of a directory (for a file explorer). */
  listDir(relPath: string): Promise<DirEntry[]>;
  /** Snapshot every file in the workspace for before/after change detection. */
  snapshot(opts?: SnapshotOptions): Promise<FileSnapshot>;
  /**
   * Stream file changes in REAL TIME as `{ path, kind }` events — catching
   * writes from any source (a tool, a `bash`-spawned dev server, a `--watch`
   * build), not just at tool boundaries. Optional: backends that can't watch
   * (for example the host LocalSandbox) omit it, and callers fall back to snapshots.
   * Returns a handle; call `stop()` to end the stream.
   */
  watch?(
    onEvent: (event: FileChange) => void,
    opts?: WatchOptions
  ): SandboxWatcher;
  /**
   * Redirect the working directory the TOOL operations (exec / read / write /
   * list) resolve against, to an absolute in-sandbox path, or back to the
   * workspace root with `null`. `snapshot`/`watch` stay rooted at the workspace
   * root regardless, so the file explorer still sees the whole project. This is
   * what lets the document workspace run a turn entirely inside a hidden scratch
   * dir without hiding the published result. Optional: backends that can't
   * redirect omit it (the document workspace then no-ops).
   */
  setWorkingDir?(absPath: string | null): void;
  /** Absolute in-sandbox path of the workspace root (for {@link setWorkingDir}). */
  getWorkspaceDir?(): string;
  /**
   * Absolute root for Punch skill packages — on the sandbox filesystem but
   * OUTSIDE the workspace. Model path-jailed file tools cannot reach here;
   * agents use bash/exec (or paths returned by the punch tool). Optional only
   * for minimal test doubles; DockerSandbox and LocalSandbox implement it.
   */
  getSkillsRoot?(): string;
  /**
   * Write a file at an absolute path under {@link getSkillsRoot} (parent dirs
   * created). Service-layer only — not exposed as a model tool. Rejects paths
   * that escape the skills root.
   */
  writeOutsideWorkspace?(
    absolutePath: string,
    content: Buffer
  ): Promise<{ bytesWritten: number }>;
  /**
   * Release any resources held by this sandbox handle. The underlying
   * container lifecycle is owned by the manager, not the handle, so this is a
   * no-op for DockerSandbox — present for symmetry / future backends.
   */
  dispose?(): Promise<void>;
}

/**
 * Per-project document scratch dir, kept inside the project's own 0700
 * workspace so generated-document intermediates stay private and out of the
 * visible file tree.
 */
export const PRIVATE_TMP_DIR = '.tmp';

/**
 * Internal Tenjo bookkeeping dir inside a project's workspace (for example the
 * dev-server manifest and its log). Hidden from the user — pruned from
 * snapshots so it never shows in the file tree or the change feed.
 */
export const AGENT_INTERNAL_DIR = '.tenjo';

/**
 * Absolute skills root inside a Docker project pod (outside `/workspace`).
 * LocalSandbox uses a sibling `.skills` directory next to the workspace root.
 */
export const SANDBOX_SKILLS_DIR = '/skills';

/** Directory names pruned from {@link Sandbox.snapshot} by default. */
export const DEFAULT_SNAPSHOT_EXCLUDE = [
  'node_modules',
  '.git',
  PRIVATE_TMP_DIR,
  AGENT_INTERNAL_DIR,
];

/**
 * True when `absolutePath` is `root` or a path under it (POSIX absolute paths).
 * Used to keep skill materialization inside the skills root.
 */
export function isUnderAbsoluteRoot(
  root: string,
  absolutePath: string
): boolean {
  const normRoot = normalizePosixAbsolute(root);
  const normPath = normalizePosixAbsolute(absolutePath);
  return normPath === normRoot || normPath.startsWith(`${normRoot}/`);
}

/** Normalize a POSIX absolute path (collapse `.` / `..`, strip trailing slash). */
export function normalizePosixAbsolute(input: string): string {
  const raw = input.replace(/\\/g, '/');
  if (!raw.startsWith('/')) {
    throw new Error(`expected absolute path, got: ${input}`);
  }
  const segments: string[] = [];
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) {
        throw new Error(`path escapes filesystem root: ${input}`);
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

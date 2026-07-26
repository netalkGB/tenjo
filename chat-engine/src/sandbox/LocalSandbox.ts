import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { jailRelative } from './pathJail.js';
import {
  DEFAULT_SNAPSHOT_EXCLUDE,
  isUnderAbsoluteRoot,
  type Sandbox,
  type ExecResult,
  type ExecOptions,
  type ReadFileResult,
  type DirEntry,
  type FileSnapshot,
  type SnapshotOptions,
} from './Sandbox.js';
import { SandboxFileOperationError } from './errors.js';

const execAsync = promisify(exec);

/** Wall-clock cap for a single command when the caller gives none. */
const DEFAULT_TIMEOUT_MS = 120_000;
/** Cap captured stdout/stderr so a runaway command cannot blow up context. */
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Host-backed {@link Sandbox}: runs commands and file ops directly on the
 * machine, rooted at a directory. There is NO isolation here — it exists for the
 * CLI example and unit tests, NOT as a secure default. For real per-project
 * isolation use DockerSandbox.
 *
 * `root` may be a function so a caller can swap the effective root at a turn
 * boundary (the CLI's document mode does this); it is evaluated per operation.
 */
export class LocalSandbox implements Sandbox {
  private readonly resolveRoot: () => string;

  constructor(root: string | (() => string)) {
    this.resolveRoot = typeof root === 'function' ? root : () => root;
  }

  /** Resolve a jailed workspace-relative path to an absolute host path. */
  private hostPath(relPath: string): string {
    const jailed = jailRelative(relPath);
    const root = this.resolveRoot();
    return jailed === '' ? root : path.join(root, jailed);
  }

  /**
   * Skills sit next to the workspace root (sibling `.skills/`), not inside it,
   * so snapshots and user deliverables never include skill packages.
   */
  getSkillsRoot(): string {
    return path.resolve(this.resolveRoot(), '..', '.skills');
  }

  async writeOutsideWorkspace(
    absolutePath: string,
    content: Buffer
  ): Promise<{ bytesWritten: number }> {
    const root = this.getSkillsRoot();
    const resolved = path.resolve(absolutePath);
    if (!isUnderAbsoluteRoot(root, resolved)) {
      throw new SandboxFileOperationError(
        'write',
        absolutePath,
        `path escapes skills root: ${absolutePath}`
      );
    }
    await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
    await fs.promises.writeFile(resolved, content);
    return { bytesWritten: content.length };
  }

  async exec(command: string, opts?: ExecOptions): Promise<ExecResult> {
    const cwd =
      opts?.cwd === undefined ? this.resolveRoot() : this.hostPath(opts.cwd);
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: opts?.maxBuffer ?? DEFAULT_MAX_BUFFER,
        signal: opts?.signal,
      });
      return { stdout, stderr, exit_code: 0 };
    } catch (error) {
      // exec rejects on a non-zero exit; the rejection still carries the
      // captured output and the real exit code, so surface them verbatim.
      const err = error as {
        stdout?: string;
        stderr?: string;
        code?: number;
        message?: string;
      };
      return {
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? err.message ?? 'Command failed',
        exit_code: typeof err.code === 'number' ? err.code : 1,
      };
    }
  }

  async readFile(relPath: string): Promise<ReadFileResult> {
    const content = await fs.promises.readFile(this.hostPath(relPath), 'utf-8');
    return { content, totalLines: content.split('\n').length };
  }

  async readBinary(relPath: string): Promise<Buffer> {
    return fs.promises.readFile(this.hostPath(relPath));
  }

  async writeFile(
    relPath: string,
    content: string
  ): Promise<{ bytesWritten: number }> {
    const filePath = this.hostPath(relPath);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, content);
    return { bytesWritten: Buffer.byteLength(content) };
  }

  async writeBinary(
    relPath: string,
    content: Buffer
  ): Promise<{ bytesWritten: number }> {
    const filePath = this.hostPath(relPath);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, content);
    return { bytesWritten: content.length };
  }

  async listDir(relPath: string): Promise<DirEntry[]> {
    const dir = this.hostPath(relPath);
    const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
    const entries = await Promise.all(
      dirents.map(async (dirent): Promise<DirEntry> => {
        const type = dirent.isDirectory()
          ? 'dir'
          : dirent.isFile()
            ? 'file'
            : 'other';
        let size = 0;
        if (type === 'file') {
          try {
            size = (await fs.promises.stat(path.join(dir, dirent.name))).size;
          } catch {
            // best-effort: a file vanishing mid-listing just reports size 0
          }
        }
        return { name: dirent.name, type, size };
      })
    );
    return sortEntries(entries);
  }

  async snapshot(opts?: SnapshotOptions): Promise<FileSnapshot> {
    const root = this.resolveRoot();
    const exclude = new Set(opts?.exclude ?? DEFAULT_SNAPSHOT_EXCLUDE);
    const snapshot: FileSnapshot = new Map();
    const walk = async (dir: string, prefix: string): Promise<void> => {
      let dirents: fs.Dirent[];
      try {
        dirents = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return; // unreadable dir: skip rather than fail the whole snapshot
      }
      for (const dirent of dirents) {
        const rel = prefix ? `${prefix}/${dirent.name}` : dirent.name;
        if (dirent.isDirectory()) {
          if (exclude.has(dirent.name)) continue;
          await walk(path.join(dir, dirent.name), rel);
        } else if (dirent.isFile()) {
          try {
            const stat = await fs.promises.stat(path.join(dir, dirent.name));
            snapshot.set(rel, { size: stat.size, mtimeMs: stat.mtimeMs });
          } catch {
            // best-effort
          }
        }
      }
    };
    await walk(root, '');
    return snapshot;
  }
}

/** Sort a directory listing: directories first, then by name. */
function sortEntries(entries: DirEntry[]): DirEntry[] {
  return entries.sort((a, b) => {
    if (a.type !== b.type) {
      if (a.type === 'dir') return -1;
      if (b.type === 'dir') return 1;
    }
    return a.name.localeCompare(b.name);
  });
}

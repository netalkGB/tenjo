import { spawn } from 'node:child_process';

export interface DockerResult {
  /** UTF-8 decoded stdout (empty when `stdout: 'buffer'` was requested). */
  stdout: string;
  /** Raw stdout bytes; present only when `stdout: 'buffer'` was requested. */
  stdoutBuffer?: Buffer;
  stderr: string;
  /** Process exit code, or null if the process was killed / never spawned. */
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** True when the call was killed by its own timeout. */
  timedOut: boolean;
  /** Set when `docker` itself could not be spawned (for example not on PATH). */
  spawnError?: string;
}

export interface DockerOptions {
  /** Path/name of the docker binary. Default 'docker'. */
  dockerPath?: string;
  /** Written to the child's stdin (used by writeFile to stream file content). */
  input?: string;
  /** Wall-clock cap; the child is SIGKILLed when it elapses. Omit for no cap. */
  timeoutMs?: number;
  /** Cap on captured stdout/stderr so a runaway command can't blow up memory. */
  maxBytes?: number;
  /** Capture stdout as a UTF-8 string (default) or as raw bytes (for binary). */
  stdout?: 'string' | 'buffer';
  /** Aborts the call (wired from a generation abort signal). */
  signal?: AbortSignal;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Run the `docker` CLI and capture its output. This is the ONLY way the sandbox
 * talks to Docker — no SDK, no socket handling. The CLI transparently selects
 * the transport (unix socket on Linux/macOS, named pipe on Windows, or the
 * `DOCKER_HOST` TCP endpoint when set), which is exactly what keeps the same
 * code working cross-platform and in a future socket-proxy deployment.
 *
 * The full process environment is inherited so `DOCKER_HOST` /
 * `DOCKER_TLS_VERIFY` / `DOCKER_CERT_PATH` flow through untouched.
 *
 * Command-injection safety: this spawns WITHOUT a shell (`shell: false`), so
 * every element of `args` is passed straight to execve as a literal argv token —
 * an untrusted value (a path, a project id, a find pattern) placed in `args` can
 * never be re-parsed as shell syntax. Callers that genuinely need a shell inside
 * the container build a fixed `sh -c '<literal script>'` and pass any untrusted
 * value as a SEPARATE argv referenced through a quoted positional (`"$0"`), which
 * the shell does not re-evaluate. Never assemble a shell string from input.
 *
 * stdout is collected as raw bytes and decoded to UTF-8 at the end (so a
 * multibyte char split across chunks is never corrupted); pass `stdout:
 * 'buffer'` to get the raw bytes instead — used to read binary files.
 */
export function runDocker(
  args: string[],
  options: DockerOptions = {}
): Promise<DockerResult> {
  const {
    dockerPath = 'docker',
    input,
    timeoutMs,
    maxBytes = DEFAULT_MAX_BYTES,
    signal,
  } = options;
  const wantBuffer = options.stdout === 'buffer';

  return new Promise((resolve) => {
    const child = spawn(dockerPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    const stdoutChunks: Buffer[] = [];
    let stdoutLen = 0;
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const appendStdout = (data: Buffer): void => {
      if (stdoutLen >= maxBytes) return;
      const slice =
        data.length > maxBytes - stdoutLen
          ? data.subarray(0, maxBytes - stdoutLen)
          : data;
      stdoutChunks.push(slice);
      stdoutLen += slice.length;
    };
    const appendStderr = (chunk: string): void => {
      if (stderr.length >= maxBytes) return;
      stderr += chunk.slice(0, maxBytes - stderr.length);
    };
    child.stdout.on('data', (data: Buffer) => appendStdout(data));
    child.stderr.on('data', (data: Buffer) =>
      appendStderr(data.toString('utf8'))
    );

    const killTimer =
      timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, timeoutMs)
        : null;

    const onAbort = (): void => {
      child.kill('SIGKILL');
    };
    if (signal) {
      if (signal.aborted) {
        child.kill('SIGKILL');
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    const cleanup = (): void => {
      if (killTimer) clearTimeout(killTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    const finish = (extra: Partial<DockerResult>): void => {
      if (settled) return;
      settled = true;
      cleanup();
      const buffer = Buffer.concat(stdoutChunks, stdoutLen);
      resolve({
        stdout: wantBuffer ? '' : buffer.toString('utf8'),
        stdoutBuffer: wantBuffer ? buffer : undefined,
        stderr,
        exitCode: null,
        signal: null,
        timedOut,
        ...extra,
      });
    };

    child.on('error', (err) => finish({ spawnError: err.message }));
    child.on('close', (code, sig) => finish({ exitCode: code, signal: sig }));

    // EPIPE here just means the child exited before we finished writing; it is
    // already surfaced via the close/error handlers, so swallow it.
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '', 'utf8');
  });
}

/** True when a docker invocation spawned and exited 0. */
export function ok(result: DockerResult): boolean {
  return !result.spawnError && result.exitCode === 0;
}

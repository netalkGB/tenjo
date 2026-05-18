import { spawn } from 'node:child_process';
import logger from '../../logger';

export interface CodeExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
}

const EXECUTION_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1_000_000;

/**
 * Runs the given JavaScript source via the same Node.js binary that hosts
 * this process (process.execPath). The source is piped over stdin instead of
 * being written to a temp file, so there is nothing to clean up afterwards.
 *
 * Sandbox: --permission denies filesystem writes / child processes / workers
 * / native addons by default. Reading the script itself is unnecessary
 * because we feed it through stdin (`-` argument with --input-type=module),
 * so we don't have to grant --allow-fs-read either. Network access is
 * unrestricted by the permission model (browser-equivalent capability).
 */
export function executeCode(code: string): Promise<CodeExecutionResult> {
  return new Promise((resolve) => {
    const startedAt = performance.now();

    // Detect Electron at runtime. Under Electron, process.execPath points at
    // the app binary (not a node binary), so spawning it without
    // ELECTRON_RUN_AS_NODE would launch a second renderer/window instead of
    // running our code. Only set the flag when needed; under plain Node it
    // would just be noise.
    const isElectron = typeof process.versions.electron === 'string';
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '',
      NODE_OPTIONS: '',
    };
    if (isElectron) {
      env.ELECTRON_RUN_AS_NODE = '1';
    }

    const child = spawn(
      process.execPath,
      ['--permission', '--input-type=module', '-'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        // Minimal env so untrusted code can't read host secrets.
        env,
      }
    );

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const appendCapped = (current: string, chunk: string): string => {
      if (current.length >= MAX_OUTPUT_BYTES) return current;
      const remaining = MAX_OUTPUT_BYTES - current.length;
      return current + chunk.slice(0, remaining);
    };

    child.stdout.on('data', (data: Buffer) => {
      stdout = appendCapped(stdout, data.toString('utf8'));
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr = appendCapped(stderr, data.toString('utf8'));
    });

    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, EXECUTION_TIMEOUT_MS);

    const elapsedMs = (): number => Math.round(performance.now() - startedAt);

    child.on('error', (err) => {
      clearTimeout(killTimer);
      resolve({
        stdout,
        stderr: `${stderr}\n[spawn error] ${err.message}`,
        exitCode: null,
        signal: null,
        timedOut,
        durationMs: elapsedMs(),
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(killTimer);
      const durationMs = elapsedMs();
      logger.debug('Code execution finished', { durationMs });
      resolve({
        stdout,
        stderr: timedOut
          ? `${stderr}\n[execution timed out after ${EXECUTION_TIMEOUT_MS / 1000}s]`
          : stderr,
        exitCode: code,
        signal,
        timedOut,
        durationMs,
      });
    });

    // Write user code to stdin and close the stream so node finishes parsing.
    child.stdin.on('error', (err) => {
      // EPIPE just means the child exited before we finished writing —
      // already surfaced via the exit/error handlers, no need to re-raise.
      logger.debug('stdin write error (likely child already exited)', {
        error: err.message,
      });
    });
    child.stdin.end(code, 'utf8');
  });
}

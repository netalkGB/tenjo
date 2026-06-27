import { EventEmitter } from 'node:events';
import { pool } from '../db/client';
import type { PoolClient, Notification } from 'pg';

const CHANNEL = 'agent_question';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const CANCEL_PREFIX = '__cancel__:';

export class QuestionTimeoutError extends Error {
  constructor(questionId: string) {
    super(`Question answer timed out: ${questionId}`);
    this.name = 'QuestionTimeoutError';
  }
}

export class QuestionCancelledError extends Error {
  constructor(questionId: string) {
    super(`Question answer cancelled: ${questionId}`);
    this.name = 'QuestionCancelledError';
  }
}

/**
 * Cross-instance transport for the coding agent's ask_user_question round-trip,
 * mirroring {@link ToolApprovalEmitter}. The agent owner blocks on
 * {@link waitForAnswer}; the answer arrives via a Postgres NOTIFY (sent by
 * POST /api/agent/projects/:id/questions/:questionId/answer) so the answering
 * client may be connected to ANY instance.
 */
class QuestionEmitter extends EventEmitter {
  private client: PoolClient | null = null;

  /** Called once at startup: LISTEN on a dedicated connection. */
  async start(): Promise<void> {
    this.setMaxListeners(0);
    this.client = await pool.connect();

    this.client.on('notification', (msg: Notification) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;

      const data = JSON.parse(msg.payload) as {
        questionId: string;
        answer: string;
      };

      this.emit(data.questionId, data.answer);
    });

    await this.client.query(`LISTEN ${CHANNEL}`);
  }

  /** Waits for the answer of a given questionId. Rejects on timeout/cancel. */
  private awaitAnswer(
    questionId: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const cancelEvent = `${CANCEL_PREFIX}${questionId}`;

      const cleanup = () => {
        clearTimeout(timer);
        this.removeAllListeners(questionId);
        this.removeAllListeners(cancelEvent);
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new QuestionTimeoutError(questionId));
      }, timeoutMs);

      this.once(cancelEvent, () => {
        cleanup();
        reject(new QuestionCancelledError(questionId));
      });

      this.once(questionId, (answer: string) => {
        cleanup();
        resolve(answer);
      });
    });
  }

  /**
   * Wait for the user's answer, cancelling the wait when the given signal
   * aborts. A timeout or cancellation (turn abort) resolves to `null`, which the
   * caller treats as "no answer — proceed with a default".
   */
  async waitForAnswer(
    questionId: string,
    signal?: AbortSignal,
    timeoutMs?: number
  ): Promise<string | null> {
    const onAbort = () => this.cancelAnswer(questionId);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await this.awaitAnswer(questionId, timeoutMs);
    } catch {
      return null;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Cancels a pending wait (called on turn abort / SSE disconnect). */
  cancelAnswer(questionId: string): void {
    this.emit(`${CANCEL_PREFIX}${questionId}`);
  }

  /** Sends the answer for a given questionId to whichever instance owns it. */
  async sendAnswer(questionId: string, answer: string): Promise<void> {
    const payload = JSON.stringify({ questionId, answer });
    await pool.query(`NOTIFY ${CHANNEL}, '${payload.replace(/'/g, "''")}'`);
  }

  /** Releases the connection on shutdown. */
  async stop(): Promise<void> {
    if (this.client) {
      await this.client.query(`UNLISTEN ${CHANNEL}`);
      this.client.release();
      this.client = null;
    }
    this.removeAllListeners();
  }
}

export const questionEmitter = new QuestionEmitter();

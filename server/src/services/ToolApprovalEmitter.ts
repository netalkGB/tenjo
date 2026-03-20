import { EventEmitter } from 'node:events';
import { pool } from '../db/client';
import type { PoolClient, Notification } from 'pg';

const CHANNEL = 'tool_approval';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const CANCEL_PREFIX = '__cancel__:';

export class ToolApprovalTimeoutError extends Error {
  constructor(toolCallId: string) {
    super(`Tool approval timed out: ${toolCallId}`);
    this.name = 'ToolApprovalTimeoutError';
  }
}

export class ToolApprovalCancelledError extends Error {
  constructor(toolCallId: string) {
    super(`Tool approval cancelled: ${toolCallId}`);
    this.name = 'ToolApprovalCancelledError';
  }
}

class ToolApprovalEmitter extends EventEmitter {
  private client: PoolClient | null = null;

  /**
   * Called once at startup.
   * LISTENs on a single channel via a dedicated connection,
   * and emits the toolCallId as an event name when a NOTIFY arrives.
   */
  async start(): Promise<void> {
    this.setMaxListeners(0);
    this.client = await pool.connect();

    this.client.on('notification', (msg: Notification) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;

      const data = JSON.parse(msg.payload) as {
        toolCallId: string;
        approved: boolean;
      };

      this.emit(data.toolCallId, data.approved);
    });

    await this.client.query(`LISTEN ${CHANNEL}`);
  }

  /**
   * Waits for approval of a given toolCallId.
   * Rejects on timeout or cancellation.
   */
  waitForApproval(
    toolCallId: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const cancelEvent = `${CANCEL_PREFIX}${toolCallId}`;

      const cleanup = () => {
        clearTimeout(timer);
        this.removeAllListeners(toolCallId);
        this.removeAllListeners(cancelEvent);
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new ToolApprovalTimeoutError(toolCallId));
      }, timeoutMs);

      this.once(cancelEvent, () => {
        cleanup();
        reject(new ToolApprovalCancelledError(toolCallId));
      });

      this.once(toolCallId, (approved: boolean) => {
        cleanup();
        resolve(approved);
      });
    });
  }

  /**
   * Cancels a pending approval (called on SSE disconnect).
   */
  cancelApproval(toolCallId: string): void {
    this.emit(`${CANCEL_PREFIX}${toolCallId}`);
  }

  /**
   * Sends the approval result for a given toolCallId.
   */
  async sendApproval(toolCallId: string, approved: boolean): Promise<void> {
    const payload = JSON.stringify({ toolCallId, approved });
    await pool.query(`NOTIFY ${CHANNEL}, '${payload.replace(/'/g, "''")}'`);
  }

  /**
   * Releases the connection on shutdown.
   */
  async stop(): Promise<void> {
    if (this.client) {
      await this.client.query(`UNLISTEN ${CHANNEL}`);
      this.client.release();
      this.client = null;
    }
    this.removeAllListeners();
  }
}

export const toolApprovalEmitter = new ToolApprovalEmitter();

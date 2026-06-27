import { pool } from '../db/client';
import type { PoolClient, Notification } from 'pg';
import logger from '../logger';

/**
 * Cluster-aware registry for aborting in-flight chat generations.
 *
 * AbortController instances are inherently process-local, so each Node
 * process keeps a Map of the generations it owns. Cross-process abort is
 * fanned out via Postgres LISTEN/NOTIFY: any instance can send a stop
 * request and only the instance running that thread's generation will act
 * on it (others see the notify but don't have it in their map).
 */
const CHANNEL = 'generation_abort';

interface AbortPayload {
  threadId: string;
}

class GenerationAbortRegistry {
  private map = new Map<string, AbortController>();
  private client: PoolClient | null = null;

  async start(): Promise<void> {
    this.client = await pool.connect();

    this.client.on('notification', (msg: Notification) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;
      try {
        const { threadId } = JSON.parse(msg.payload) as AbortPayload;
        const controller = this.map.get(threadId);
        if (controller) controller.abort();
      } catch (err) {
        logger.warn('Failed to handle generation_abort notification', err);
      }
    });

    await this.client.query(`LISTEN ${CHANNEL}`);
  }

  async stop(): Promise<void> {
    if (!this.client) return;
    await this.client.query(`UNLISTEN ${CHANNEL}`);
    this.client.release();
    this.client = null;
  }

  register(threadId: string, controller: AbortController): void {
    this.map.set(threadId, controller);
  }

  unregister(threadId: string, controller: AbortController): void {
    // Only remove if the stored entry is still ours; avoids clearing a
    // newer generation's controller after a fast retry on the same thread.
    if (this.map.get(threadId) === controller) {
      this.map.delete(threadId);
    }
  }

  /**
   * Broadcasts a stop request to every server instance. The instance that
   * actually owns the controller for this thread will abort it; others
   * silently no-op. Returns immediately — fire-and-forget semantics.
   */
  async requestAbort(threadId: string): Promise<void> {
    const payload = JSON.stringify({ threadId } satisfies AbortPayload);
    await pool.query(`NOTIFY ${CHANNEL}, '${payload.replace(/'/g, "''")}'`);
  }
}

export const generationAbortRegistry = new GenerationAbortRegistry();

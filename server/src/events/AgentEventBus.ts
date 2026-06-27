import type { PoolClient, Notification } from 'pg';
import { pool } from '../db/client';
import logger from '../logger';
import { agentMessageRepo } from '../repositories/registry';
import {
  toAgentMessageView,
  type AgentServerEvent,
  type AgentBusEvent,
  type AgentClientCommand
} from '../types/agentProtocol';

/**
 * A connected event subscriber sink. Transport-neutral: `send` receives the
 * JSON-encoded event; `isOpen` reports whether the underlying connection is
 * still writable.
 */
export interface AgentSubscriber {
  send(data: string): void;
  isOpen(): boolean;
}

const EVENT_CHANNEL = 'agent_event';
const COMMAND_CHANNEL = 'agent_command';
/** Postgres rejects a NOTIFY payload of 8000+ bytes; stay just under it. */
const NOTIFY_PAYLOAD_MAX_BYTES = 7900;

type CommandHandler = (projectId: string, command: AgentClientCommand) => void;

/**
 * Cluster-aware pub/sub for the coding agent, modeled on
 * {@link GenerationAbortRegistry}. Two Postgres LISTEN/NOTIFY channels:
 *
 * - `agent_event` (owner → all): every streaming/file event is NOTIFYed by the
 *   instance running the agent; ALL instances (including the owner) forward it to
 *   their local WebSocket subscribers. `message-added` is fanned out as an id
 *   reference — receivers read the already-persisted row — so a large tool result
 *   never exceeds the 8 KB NOTIFY payload limit.
 * - `agent_command` (any → owner): a command from a client connected to a
 *   non-owning instance is NOTIFYed; only the instance holding that project's live
 *   session acts on it (others no-op).
 */
class AgentEventBus {
  private client: PoolClient | null = null;
  private readonly subscribers = new Map<string, Set<AgentSubscriber>>();
  private commandHandler: CommandHandler | null = null;
  // Emission/delivery order must match event order. Each NOTIFY goes through
  // pool.query() on whichever connection is free, so two rapid emits (for example the
  // queued→running queue-changed pair fired within the same tick) can commit —
  // and therefore arrive — out of order, leaving a phantom pending-send item on the
  // client. Chaining publishes guarantees NOTIFY N commits before N+1 is sent.
  private publishChain: Promise<void> = Promise.resolve();
  // Same on the inbound side: expanding a message-ref awaits a DB read, which
  // would let later (synchronously deliverable) events overtake it.
  private deliverChain: Promise<void> = Promise.resolve();

  async start(): Promise<void> {
    if (this.client) {
      return;
    }
    this.client = await pool.connect();
    this.client.on('notification', (msg: Notification) => {
      this.deliverChain = this.deliverChain.then(() =>
        this.onNotification(msg)
      );
    });
    await this.client.query(`LISTEN ${EVENT_CHANNEL}`);
    await this.client.query(`LISTEN ${COMMAND_CHANNEL}`);
  }

  async stop(): Promise<void> {
    if (!this.client) {
      return;
    }
    await this.client.query(`UNLISTEN ${EVENT_CHANNEL}`);
    await this.client.query(`UNLISTEN ${COMMAND_CHANNEL}`);
    this.client.release();
    this.client = null;
  }

  /** Register the single handler that applies routed commands (owner only). */
  onCommand(handler: CommandHandler): void {
    this.commandHandler = handler;
  }

  // ---- local subscriber registry ------------------------------------------

  subscribe(projectId: string, subscriber: AgentSubscriber): void {
    let set = this.subscribers.get(projectId);
    if (!set) {
      set = new Set();
      this.subscribers.set(projectId, set);
    }
    set.add(subscriber);
  }

  /** Remove a subscriber from every project it subscribed to (on disconnect). */
  unsubscribe(subscriber: AgentSubscriber): void {
    for (const [projectId, set] of this.subscribers) {
      if (set.delete(subscriber) && set.size === 0) {
        this.subscribers.delete(projectId);
      }
    }
  }

  /** Number of locally-connected subscribers for a project. */
  localSubscriberCount(projectId: string): number {
    return this.subscribers.get(projectId)?.size ?? 0;
  }

  /** Send one event to a single subscriber (initial state, errors). */
  sendToSubscriber(subscriber: AgentSubscriber, event: AgentServerEvent): void {
    if (subscriber.isOpen()) {
      subscriber.send(JSON.stringify(event));
    }
  }

  /**
   * Push an event to THIS instance's subscribers for a project, bypassing
   * NOTIFY. Used for payloads too large for NOTIFY's ~8 KB limit (the full file
   * tree). Mirrors connect-time delivery: the sandbox and its subscribers are
   * co-located on the owning instance.
   */
  sendToProjectSubscribers(projectId: string, event: AgentServerEvent): void {
    const set = this.subscribers.get(projectId);
    if (!set) {
      return;
    }
    for (const subscriber of set) {
      this.sendToSubscriber(subscriber, event);
    }
  }

  // ---- publishing ----------------------------------------------------------

  /** Fan out a server event to every instance via NOTIFY. */
  emit(projectId: string, event: AgentServerEvent): void {
    this.publish(projectId, { kind: 'event', event });
  }

  /** Fan out a freshly-persisted message by id (receivers load the row). */
  emitMessageRef(projectId: string, messageId: string): void {
    this.publish(projectId, { kind: 'message-ref', messageId });
  }

  /** Route a client command to the owning instance via NOTIFY. */
  publishCommand(projectId: string, command: AgentClientCommand): void {
    this.enqueueNotify(COMMAND_CHANNEL, { projectId, command });
  }

  private publish(projectId: string, payload: AgentBusEvent): void {
    this.enqueueNotify(EVENT_CHANNEL, { projectId, payload });
  }

  /** Serialize NOTIFYs so they commit (and deliver) in emission order. */
  private enqueueNotify(channel: string, body: unknown): void {
    this.publishChain = this.publishChain.then(() =>
      this.notify(channel, body)
    );
  }

  private async notify(channel: string, body: unknown): Promise<void> {
    try {
      const json = JSON.stringify(body).replace(/'/g, "''");
      // Postgres caps a NOTIFY payload at 8000 bytes (error 22023 above that).
      // Upstream emitters already byte-cap their content; this is a last-resort
      // backstop so an oversize payload is dropped quietly instead of throwing.
      if (Buffer.byteLength(json) > NOTIFY_PAYLOAD_MAX_BYTES) {
        logger.warn(`[agent-bus] dropped oversize NOTIFY on ${channel}`, {
          bytes: Buffer.byteLength(json)
        });
        return;
      }
      await pool.query(`NOTIFY ${channel}, '${json}'`);
    } catch (error) {
      logger.warn(`[agent-bus] failed to NOTIFY ${channel}`, { error });
    }
  }

  // ---- inbound -------------------------------------------------------------

  private async onNotification(msg: Notification): Promise<void> {
    if (!msg.payload) {
      return;
    }
    try {
      if (msg.channel === EVENT_CHANNEL) {
        const { projectId, payload } = JSON.parse(msg.payload) as {
          projectId: string;
          payload: AgentBusEvent;
        };
        await this.deliver(projectId, payload);
      } else if (msg.channel === COMMAND_CHANNEL) {
        const { projectId, command } = JSON.parse(msg.payload) as {
          projectId: string;
          command: AgentClientCommand;
        };
        this.commandHandler?.(projectId, command);
      }
    } catch (error) {
      logger.warn('[agent-bus] failed to handle notification', { error });
    }
  }

  private async deliver(
    projectId: string,
    payload: AgentBusEvent
  ): Promise<void> {
    const set = this.subscribers.get(projectId);
    if (!set || set.size === 0) {
      return;
    }
    const event =
      payload.kind === 'event'
        ? payload.event
        : await this.expandMessageRef(payload.messageId);
    if (!event) {
      return;
    }
    const data = JSON.stringify(event);
    for (const subscriber of set) {
      if (subscriber.isOpen()) {
        subscriber.send(data);
      }
    }
  }

  private async expandMessageRef(
    messageId: string
  ): Promise<AgentServerEvent | null> {
    const row = await agentMessageRepo.findById(messageId);
    if (!row) {
      return null;
    }
    return { type: 'message-added', message: toAgentMessageView(row) };
  }
}

export const agentEventBus = new AgentEventBus();

import { randomUUID } from 'crypto';
import {
  ChatClient,
  MessageRole,
  type MessageRequest,
  type ChatStatus,
  type ToolCallStreamEvent,
} from './ChatClient';
import { AgentTurnAbortedError, AgentUnknownError } from './AgentError';
import type { CompactionState } from './ContextManager';

/** Tool call returned by ChatClient.getToolCallPlan(). */
export interface AgentToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Host-requested tool call to run after the user message and before the model,
 * through the same executeTool path as model-initiated calls.
 */
export interface ForcedToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** Lifecycle status of a queued prompt. */
export type QueuedItemStatus =
  'queued' | 'running' | 'done' | 'error' | 'aborted';

/** A user prompt tracked by the queue. */
export interface QueuedItem {
  /** Stable id returned by submit(). */
  id: string;
  /** User-visible prompt text. May be empty when only images are sent. */
  text: string;
  /** Image URLs/paths passed through to ChatClient.sendMessage. */
  imageUrls?: string[];
  /**
   * Tools the host forces after this user message, before the model runs
   * (for example Punch slash force-load). Executed via executeTool.
   */
  forcedToolCalls?: ForcedToolCall[];
  status: QueuedItemStatus;
  /** Populated when status === 'error'. */
  error?: Error;
  /** Epoch ms when submit() was called. */
  enqueuedAt: number;
  /** Epoch ms when the turn began running (status -> 'running'). */
  startedAt?: number;
  /** Epoch ms when the turn finished (status -> 'done' | 'error'). */
  finishedAt?: number;
}

/** How queued prompts are drained into turns. */
export type DrainStrategy = 'coalesce' | 'sequential';

/**
 * Result of approving/executing a single tool call.
 *
 * `{ approved: false }` rejects the call, cancels the rest of the batch, and
 * stops the current turn's tool loop.
 */
export interface ToolExecutionDecision {
  approved: boolean;
  /** Result payload when approved; stringified by ChatClient.addToolCallResult. */
  result?: unknown;
  /** Optional override for the rejection result payload. */
  rejectionResult?: unknown;
}

/** Consumer-injected tool executor. */
export type ExecuteToolFn = (
  toolCall: AgentToolCall,
  context: { itemIds: string[]; signal: AbortSignal }
) => Promise<ToolExecutionDecision>;

export interface TextOnlyNudgeContext {
  /** Whether this turn already executed one of the configured action tools. */
  actedThisTurn: boolean;
  /** Whether the last text answer looked like malformed plain-text tool markup. */
  malformedToolText: boolean;
}

export type TextOnlyNudgeInstruction =
  string | ((context: TextOnlyNudgeContext) => string | null);

export interface ChatAgentOptions {
  /** Executes and optionally approves a single tool call. */
  executeTool: ExecuteToolFn;
  /** How queued prompts are batched into turns. Default 'coalesce'. */
  drainStrategy?: DrainStrategy;
  /**
   * When true, a queued prompt may start after the current tool-call batch is
   * recorded, before the model continues the old turn. Default false.
   */
  drainQueuedAtToolBoundary?: boolean;
  /**
   * Separator used when drainStrategy is 'coalesce'. Default '\n'.
   */
  coalesceSeparator?: string;
  /** Safety cap on tool-loop iterations per turn. Default 100. */
  maxToolIterations?: number;
  /**
   * Forwarded to ChatClient.sendMessage options. Approvals are still decided
   * inside executeTool. Default false.
   */
  requireToolApproval?: boolean;
  /**
   * How many times a turn may auto-continue after an empty assistant message.
   * Default 0.
   */
  autoContinueOnEmpty?: number;
  /**
   * Follow-up instruction for text-only turns where the model should have used
   * a tool. Default undefined.
   */
  nudgeOnTextOnlyTurn?: {
    /** Max follow-up nudges per turn. Default 1. */
    maxNudges?: number;
    /** The follow-up user message appended to push the model to act. */
    instruction: TextOnlyNudgeInstruction;
    /** Tool names that count as "taking action" (for example file-editing tools). */
    actionToolNames?: string[];
  };
  /**
   * Optional hook awaited before each turn starts. Intended for compaction.
   * Errors are swallowed. Default undefined.
   */
  beforeTurn?: (client: ChatClient) => Promise<void>;
}

/** The outcome of a completed turn, surfaced to onTurnComplete. */
export interface TurnResult {
  /**
   * Final assistant message produced by this turn, or null if the turn produced
   * none.
   */
  assistantMessage: MessageRequest | null;
}

/** Serializable agent state. */
export interface ChatAgentSnapshot {
  /** Full linear conversation history. */
  messages: MessageRequest[];
  /** Prompts that were still queued at export time. */
  queue: QueuedItem[];
  /** Rolling-summary compaction state, omitted when compaction is disabled. */
  compaction?: CompactionState;
}

export type QueueChangedHandler = (queue: readonly QueuedItem[]) => void;
export type TurnStartHandler = (items: readonly QueuedItem[]) => void;
export type TurnCompleteHandler = (
  items: readonly QueuedItem[],
  result: TurnResult
) => void | Promise<void>;
export type IdleHandler = () => void;
export type AgentErrorHandler = (
  error: Error,
  items: readonly QueuedItem[]
) => void;
/** Fired when a turn is interrupted by abort() — a clean stop, not a failure. */
export type AgentAbortHandler = (items: readonly QueuedItem[]) => void;

const DEFAULT_MAX_TOOL_ITERATIONS = 100;
const DEFAULT_COALESCE_SEPARATOR = '\n';

const REPEATED_TOOL_NUDGE_THRESHOLD = 3;
const REPEATED_TOOL_HARD_LIMIT = 6;
const REPEATED_TOOL_GUARD_MESSAGE =
  'You have already issued this exact tool call several times with identical ' +
  'arguments and no new outcome. Do NOT call it again the same way. Take a ' +
  'different action — call the appropriate dedicated tool to actually make ' +
  'progress, or finish with a short summary.';
const MALFORMED_TOOL_TEXT_NUDGE =
  'Your previous assistant message appears to contain a tool call serialized as ' +
  'plain text (for example XML/JSON-like tool-call markup). Plain text is NOT ' +
  'executed. Call the actual tool now with valid tool arguments, then verify the ' +
  'result.';
export const CHAT_AGENT_EMPTY_RESPONSE_NUDGE =
  'Your previous assistant response was empty. Continue now with a concrete ' +
  'next step. If this is a plan-mode task, call present_plan with a concise ' +
  'actionable plan; otherwise call the appropriate tool or provide the final ' +
  'answer.';

/**
 * Orchestrates queued user prompts around a ChatClient tool-calling loop.
 */
export class ChatAgent {
  public readonly client: ChatClient;
  private readonly executeTool: ExecuteToolFn;
  private readonly drainStrategy: DrainStrategy;
  private readonly drainQueuedAtToolBoundary: boolean;
  private readonly coalesceSeparator: string;
  private readonly maxToolIterations: number;
  private readonly requireToolApproval: boolean;
  private readonly autoContinueOnEmpty: number;
  private readonly textOnlyNudge: {
    maxNudges: number;
    instruction: TextOnlyNudgeInstruction;
    actionToolNames: Set<string> | null;
  } | null;
  private readonly beforeTurn: ((client: ChatClient) => Promise<void>) | null;

  private queue: QueuedItem[] = [];
  private running: QueuedItem[] = [];
  private pumpActive = false;
  private abortController = new AbortController();
  private idleWaiters: Array<() => void> = [];

  private queueChangedHandler: QueueChangedHandler = () => {};
  private turnStartHandler: TurnStartHandler = () => {};
  private turnCompleteHandler: TurnCompleteHandler = () => {};
  private idleHandler: IdleHandler = () => {};
  private errorHandler: AgentErrorHandler = () => {};
  private abortHandler: AgentAbortHandler = () => {};
  // Full history stays in ChatClient; this only tracks its compacted view.
  private compaction: CompactionState = { summary: '', coveredCount: 0 };
  private compactionChangedHandler: (state: CompactionState) => void = () => {};

  constructor(client: ChatClient, options: ChatAgentOptions) {
    this.client = client;
    this.executeTool = options.executeTool;
    this.drainStrategy = options.drainStrategy ?? 'coalesce';
    this.drainQueuedAtToolBoundary = options.drainQueuedAtToolBoundary ?? false;
    this.coalesceSeparator =
      options.coalesceSeparator ?? DEFAULT_COALESCE_SEPARATOR;
    this.maxToolIterations =
      options.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    this.requireToolApproval = options.requireToolApproval ?? false;
    this.autoContinueOnEmpty = Math.max(0, options.autoContinueOnEmpty ?? 0);
    const nudge = options.nudgeOnTextOnlyTurn;
    this.textOnlyNudge = nudge
      ? {
          maxNudges: Math.max(1, nudge.maxNudges ?? 1),
          instruction: nudge.instruction,
          actionToolNames:
            nudge.actionToolNames && nudge.actionToolNames.length > 0
              ? new Set(nudge.actionToolNames)
              : null,
        }
      : null;
    this.beforeTurn = options.beforeTurn ?? null;
  }

  public submit(
    message: string,
    imageUrls?: string[],
    options?: { forcedToolCalls?: ForcedToolCall[] }
  ): string {
    const item: QueuedItem = {
      id: randomUUID(),
      text: message,
      imageUrls,
      forcedToolCalls: options?.forcedToolCalls,
      status: 'queued',
      enqueuedAt: Date.now(),
    };
    this.queue.push(item);
    this.fireQueueChanged();
    this.ensurePump();
    return item.id;
  }

  public exportState(): ChatAgentSnapshot {
    return {
      messages: [...this.client.getMessages()],
      queue: this.getQueue().filter((item) => item.status === 'queued'),
      compaction: { ...this.compaction },
    };
  }

  public restoreState(snapshot: ChatAgentSnapshot): string[] {
    this.client.setMessages([...snapshot.messages]);
    // Avoid notifying persistence while loading from persistence.
    this.compaction = snapshot.compaction
      ? { ...snapshot.compaction }
      : { summary: '', coveredCount: 0 };
    this.clearQueue();
    return this.restoreQueue(snapshot.queue ?? []);
  }

  public restoreQueue(
    items: Array<
      Pick<QueuedItem, 'text'> &
        Partial<
          Pick<
            QueuedItem,
            'id' | 'imageUrls' | 'enqueuedAt' | 'forcedToolCalls'
          >
        >
    >
  ): string[] {
    const ids: string[] = [];
    for (const source of items) {
      const item: QueuedItem = {
        id: source.id ?? randomUUID(),
        text: source.text,
        imageUrls: source.imageUrls,
        forcedToolCalls: source.forcedToolCalls,
        status: 'queued',
        enqueuedAt: source.enqueuedAt ?? Date.now(),
      };
      this.queue.push(item);
      ids.push(item.id);
    }
    if (ids.length > 0) {
      this.fireQueueChanged();
      this.ensurePump();
    }
    return ids;
  }

  public getQueue(): readonly QueuedItem[] {
    return [...this.running, ...this.queue].map((item) => ({ ...item }));
  }

  public isRunning(): boolean {
    return this.running.length > 0;
  }

  public getRunningItems(): readonly QueuedItem[] {
    return this.running.map((item) => ({ ...item }));
  }

  public removeFromQueue(id: string): boolean {
    const index = this.queue.findIndex((item) => item.id === id);
    if (index === -1) {
      return false;
    }
    this.queue.splice(index, 1);
    this.fireQueueChanged();
    return true;
  }

  public clearQueue(): void {
    if (this.queue.length === 0) {
      return;
    }
    this.queue = [];
    this.fireQueueChanged();
  }

  public abort(options: { clearQueue?: boolean } = {}): void {
    const clearQueue = options.clearQueue ?? true;
    if (clearQueue) {
      this.clearQueue();
    }
    // runTurn uses this controller; ChatClient keeps its own abort state too.
    this.abortController.abort();
    this.client.abort();
  }

  public waitForIdle(): Promise<void> {
    if (
      !this.pumpActive &&
      this.queue.length === 0 &&
      this.running.length === 0
    ) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  public onQueueChanged(handler: QueueChangedHandler): void {
    this.queueChangedHandler = handler;
  }

  public onTurnStart(handler: TurnStartHandler): void {
    this.turnStartHandler = handler;
  }

  public onTurnComplete(handler: TurnCompleteHandler): void {
    this.turnCompleteHandler = handler;
  }

  public onIdle(handler: IdleHandler): void {
    this.idleHandler = handler;
  }

  public onError(handler: AgentErrorHandler): void {
    this.errorHandler = handler;
  }

  public onAbort(handler: AgentAbortHandler): void {
    this.abortHandler = handler;
  }

  public getCompactionState(): CompactionState {
    return { ...this.compaction };
  }

  public setCompactionState(state: CompactionState): void {
    this.compaction = { ...state };
    this.compactionChangedHandler(this.getCompactionState());
  }

  public onCompactionChanged(handler: (state: CompactionState) => void): void {
    this.compactionChangedHandler = handler;
  }

  public getMessages(): MessageRequest[] {
    return this.client.getMessages();
  }

  public onMessage(handler: (message: string) => void): void {
    this.client.setMessageHandler(handler);
  }

  public onThinking(handler: (message: string) => void): void {
    this.client.setThinkingHandler(handler);
  }

  public onReasoning(handler: (message: string) => void): void {
    this.client.setReasoningHandler(handler);
  }

  public onStatus(handler: (status: ChatStatus) => void): void {
    this.client.setStatusHandler(handler);
  }

  public onToolCallStream(handler: (event: ToolCallStreamEvent) => void): void {
    this.client.setToolCallStreamHandler(handler);
  }

  public onMessageAdded(
    handler: (message: MessageRequest, allMessages: MessageRequest[]) => void
  ): void {
    this.client.onMessageAdded(handler);
  }

  private fireQueueChanged(): void {
    this.queueChangedHandler(this.getQueue());
  }

  private snapshot(items: QueuedItem[]): readonly QueuedItem[] {
    return items.map((item) => ({ ...item }));
  }

  private ensurePump(): void {
    if (this.pumpActive) {
      return;
    }
    this.pumpActive = true;
    void this.pump();
  }

  private dequeueBatch(): QueuedItem[] {
    if (this.drainStrategy === 'coalesce') {
      return this.queue.splice(0, this.queue.length);
    }
    return [this.queue.shift() as QueuedItem];
  }

  private async pump(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const batch = this.dequeueBatch();
        this.running = batch;
        const startedAt = Date.now();
        for (const item of batch) {
          item.status = 'running';
          item.startedAt = startedAt;
        }
        this.turnStartHandler(this.snapshot(batch));
        this.fireQueueChanged();

        await this.runBeforeTurn();

        try {
          const result = await this.runTurn(batch);
          const finishedAt = Date.now();
          for (const item of batch) {
            item.status = 'done';
            item.finishedAt = finishedAt;
          }
          await this.turnCompleteHandler(this.snapshot(batch), result);
        } catch (error) {
          const wasAborted = this.abortController.signal.aborted;
          const err = this.toError(error);
          const finishedAt = Date.now();
          for (const item of batch) {
            item.status = wasAborted ? 'aborted' : 'error';
            item.error = err;
            item.finishedAt = finishedAt;
          }
          // Reset abort state so later turns can run.
          this.client.clearAbort();
          this.abortController = new AbortController();
          if (wasAborted) {
            this.abortHandler(this.snapshot(batch));
          } else {
            this.errorHandler(err, this.snapshot(batch));
          }
        } finally {
          this.running = [];
          this.fireQueueChanged();
        }
      }
    } finally {
      this.pumpActive = false;
    }

    // A submit may land after the loop exits but before pumpActive is reset.
    if (this.queue.length > 0) {
      this.ensurePump();
      return;
    }

    this.idleHandler();
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }

  private async runBeforeTurn(): Promise<void> {
    if (!this.beforeTurn) return;
    try {
      await this.beforeTurn(this.client);
    } catch {
      // Compaction is an optimization, not part of turn success.
    }
  }

  private async runTurn(batch: QueuedItem[]): Promise<TurnResult> {
    const signal = this.abortController.signal;
    const itemIds = batch.map((item) => item.id);

    const text = batch
      .map((item) => item.text)
      .filter((value) => value.length > 0)
      .join(this.coalesceSeparator);
    const imageUrls = batch.flatMap((item) => item.imageUrls ?? []);
    const forcedToolCalls = batch.flatMap((item) => item.forcedToolCalls ?? []);

    if (forcedToolCalls.length > 0) {
      // Host-forced tools share the real executeTool path with model calls.
      this.client.appendUserMessage(
        text,
        imageUrls.length > 0 ? imageUrls : undefined
      );
      const planned = this.client.appendAssistantToolCalls(forcedToolCalls);
      const rejected = await this.runToolBatch(planned, itemIds, signal);
      if (rejected) {
        return { assistantMessage: this.getLastAssistantMessage() };
      }
      await this.client.validateToolCallResult(signal);
    } else {
      await this.client.sendMessage(
        text,
        imageUrls.length > 0 ? imageUrls : undefined,
        {
          requireToolApproval: this.requireToolApproval,
          signal,
        }
      );
    }

    let iteration = 0;
    let emptyContinues = 0;
    let nudges = 0;
    let actedThisTurn = false;
    let lastToolSignature: string | null = null;
    let repeatCount = 0;
    while (iteration < this.maxToolIterations) {
      const toolCalls = this.client.getToolCallPlan();

      if (toolCalls && toolCalls.length > 0) {
        iteration++;
        const signature = JSON.stringify(
          toolCalls.map((call) => [
            call.function.name,
            call.function.arguments ?? '',
          ])
        );
        if (signature === lastToolSignature) {
          repeatCount++;
        } else {
          repeatCount = 0;
          lastToolSignature = signature;
        }
        // Every tool_call must receive a tool result, even when hard-stopping.
        if (repeatCount >= REPEATED_TOOL_HARD_LIMIT) {
          for (const call of toolCalls) {
            this.client.addToolCallResult(call.id, {
              error: REPEATED_TOOL_GUARD_MESSAGE,
            });
          }
          break;
        }
        // Repeated identical calls get a corrective result instead of executing.
        if (repeatCount >= REPEATED_TOOL_NUDGE_THRESHOLD) {
          for (const call of toolCalls) {
            this.client.addToolCallResult(call.id, {
              error: REPEATED_TOOL_GUARD_MESSAGE,
            });
          }
          await this.client.validateToolCallResult(signal);
          continue;
        }
        if (this.isActionToolBatch(toolCalls)) {
          actedThisTurn = true;
        }
        const rejected = await this.runToolBatch(toolCalls, itemIds, signal);
        if (rejected) {
          break;
        }
        if (this.drainQueuedAtToolBoundary && this.queue.length > 0) {
          break;
        }
        await this.client.validateToolCallResult(signal);
        continue;
      }

      if (
        emptyContinues < this.autoContinueOnEmpty &&
        this.isEmptyAssistantTurn()
      ) {
        emptyContinues++;
        await this.client.sendMessage(
          CHAT_AGENT_EMPTY_RESPONSE_NUDGE,
          undefined,
          {
            requireToolApproval: this.requireToolApproval,
            signal,
          }
        );
        continue;
      }

      const malformedToolText = this.isMalformedToolCallTextTurn();
      if (
        this.textOnlyNudge &&
        nudges < this.textOnlyNudge.maxNudges &&
        (!actedThisTurn || malformedToolText) &&
        !this.isEmptyAssistantTurn()
      ) {
        const baseInstruction =
          typeof this.textOnlyNudge.instruction === 'function'
            ? this.textOnlyNudge.instruction({
                actedThisTurn,
                malformedToolText,
              })
            : this.textOnlyNudge.instruction;
        if (!baseInstruction) {
          break;
        }
        nudges++;
        const instruction = malformedToolText
          ? `${baseInstruction}\n\n${MALFORMED_TOOL_TEXT_NUDGE}`
          : baseInstruction;
        await this.client.sendMessage(instruction, undefined, {
          requireToolApproval: this.requireToolApproval,
          signal,
        });
        continue;
      }

      break;
    }

    return { assistantMessage: this.getLastAssistantMessage() };
  }

  private isMalformedToolCallTextTurn(): boolean {
    const last = this.getLastAssistantMessage();
    if (!last || (last.tool_calls && last.tool_calls.length > 0)) {
      return false;
    }
    if (typeof last.content !== 'string') {
      return false;
    }
    return /<\/?(tool_call|function|parameter)\b|"\s*tool_calls?\s*"|"\s*reasoning\s*"\s*:/.test(
      last.content
    );
  }

  private isActionToolBatch(toolCalls: AgentToolCall[]): boolean {
    const action = this.textOnlyNudge?.actionToolNames;
    if (!action) {
      return true;
    }
    return toolCalls.some((call) => action.has(call.function.name));
  }

  private async runToolBatch(
    toolBatch: AgentToolCall[],
    itemIds: string[],
    signal: AbortSignal
  ): Promise<boolean> {
    for (let i = 0; i < toolBatch.length; i++) {
      const toolCall = toolBatch[i];
      if (signal.aborted) {
        this.cancelToolCalls(toolBatch.slice(i));
        throw new AgentTurnAbortedError();
      }
      try {
        const decision = await this.raceAbort(
          this.executeTool(
            { id: toolCall.id, function: toolCall.function },
            { itemIds, signal }
          ),
          signal
        );

        if (!decision.approved) {
          this.client.addToolCallResult(
            toolCall.id,
            decision.rejectionResult ?? {
              error: 'Tool execution rejected by user',
            }
          );
          for (let j = i + 1; j < toolBatch.length; j++) {
            this.client.addToolCallResult(toolBatch[j].id, {
              error:
                'Tool execution cancelled because a prior tool was rejected',
            });
          }
          return true;
        }

        this.client.addToolCallResult(toolCall.id, decision.result);
      } catch (error) {
        if (signal.aborted) {
          this.cancelToolCalls(toolBatch.slice(i));
          throw error;
        }
        this.client.addToolCallResult(toolCall.id, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return false;
  }

  private cancelToolCalls(calls: AgentToolCall[]): void {
    for (const call of calls) {
      this.client.addToolCallResult(call.id, {
        error: 'Tool execution cancelled: the user stopped the task',
      });
    }
  }

  private raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
      promise.catch(() => undefined);
      return Promise.reject(new AgentTurnAbortedError());
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        promise.catch(() => undefined);
        reject(new AgentTurnAbortedError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        }
      );
    });
  }

  private isEmptyAssistantTurn(): boolean {
    const last = this.getLastAssistantMessage();
    if (!last) {
      return false;
    }
    if (last.tool_calls && last.tool_calls.length > 0) {
      return false;
    }
    const content = last.content;
    if (typeof content === 'string') {
      return content.trim().length === 0;
    }
    if (Array.isArray(content)) {
      return content.length === 0;
    }
    return true;
  }

  private getLastAssistantMessage(): MessageRequest | null {
    const messages = this.client.getMessages();
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === MessageRole.ASSISTANT) {
        return messages[i];
      }
    }
    return null;
  }

  private toError(error: unknown): Error {
    return error instanceof Error
      ? error
      : new AgentUnknownError(String(error));
  }
}

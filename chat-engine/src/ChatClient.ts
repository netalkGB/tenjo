import { randomUUID } from 'crypto';
import {
  type ChatApiClient,
  type ChatApiImageDetail,
  type ChatApiResponse,
  type ChatApiStatus,
  type ChatApiToolCallStreamEvent,
} from './ChatApiClient';

export type ToolCallStreamEvent = ChatApiToolCallStreamEvent;

import { OpenAIChatApiClient } from './OpenAIChatApiClient';
import { THINKING_CLOSE_TAG, THINKING_OPEN_TAG } from './thinkingUtils';

export const MessageRole = {
  USER: 'user',
  ASSISTANT: 'assistant',
  TOOL: 'tool',
  SYSTEM: 'system',
} as const;

// Provider-agnostic types (ChatClient layer)
// These decouple consumers from LmStudioChatApiClient-specific types.

export interface MessageTextContent {
  type: 'text';
  text: string;
}

export interface MessageImageContent {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: ChatApiImageDetail;
  };
}

export type MessageContent = MessageTextContent | MessageImageContent;

interface ToolCallResponse {
  type: string;
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Domain chat message. After provider conversion, `content` is always set
 * (empty string for pure tool-call assistant turns).
 */
export interface MessageRequest {
  role: string;
  content: string | MessageContent[];
  reasoning?: string;
  tool_call_id?: string;
  tool_calls?: ToolCallResponse[];
}

export interface PendingToolCall {
  toolCallId: string;
  toolName: string;
  toolArgs: string;
}

export type ChatStatus =
  'unknown' | 'message' | 'thinking' | 'reasoning' | 'tool_call' | 'done';

export class ChatClient {
  private chatApiClient: ChatApiClient;
  private messageHandler: (message: string) => void = () => {};
  private thinkingHandler: (message: string) => void = () => {};
  private reasoningHandler: (message: string) => void = () => {};
  private statusHandler: (status: ChatStatus) => void = () => {};
  private currentStatus: ChatStatus = 'unknown';
  private messageAddedHandler: (
    message: MessageRequest,
    allMessages: MessageRequest[]
  ) => void = () => {};
  private toolApprovalRequestHandler: (
    pendingTools: PendingToolCall[]
  ) => void = () => {};
  private toolCallStreamHandler: (event: ToolCallStreamEvent) => void =
    () => {};
  public _messages: MessageRequest[] = [];
  private _pendingToolCalls: PendingToolCall[] = [];
  private abortController = new AbortController();
  // Identity by default: the messages sent to the API equal the stored history.
  // A consumer can install a transform (for example context compaction) to reshape the
  // OUTGOING messages without mutating the persisted history. See
  // setOutgoingMessageTransform.
  private outgoingMessageTransform: (
    messages: MessageRequest[]
  ) => MessageRequest[] = (messages) => messages;

  constructor(chatApiClient: ChatApiClient) {
    this.chatApiClient = chatApiClient;

    this.setupStreamHandlers();

    this.chatApiClient.setToolCallStreamHandler?.(
      (event: ChatApiToolCallStreamEvent) => {
        this.toolCallStreamHandler(event);
      }
    );
  }

  private setupStreamHandlers(): void {
    const needsThinkingDetection =
      this.chatApiClient.constructor !== OpenAIChatApiClient;

    if (needsThinkingDetection) {
      // Non-OpenAI clients may use <think> tags (e.g. Qwen on LM Studio/Ollama)
      const state = { contentBuffer: '', pendingChunks: [] as string[] };

      this.chatApiClient.setMessageHandler((msg: string) => {
        this.handleStreamChunk(msg, state);
      });

      this.chatApiClient.setReasoningHandler((msg: string) => {
        this.reasoningHandler(msg);
      });

      this.chatApiClient.setStatusHandler((status: ChatApiStatus) => {
        this.handleApiStatus(status, state);
      });
    } else {
      // OpenAIChatApiClient (ChatGPT) does not use <think> tags
      this.chatApiClient.setMessageHandler((msg: string) => {
        this.messageHandler(msg);
      });

      this.chatApiClient.setReasoningHandler((msg: string) => {
        this.reasoningHandler(msg);
      });

      this.chatApiClient.setStatusHandler((status: ChatApiStatus) => {
        this.statusHandler(status);
      });
    }
  }

  private handleStreamChunk(
    msg: string,
    state: { contentBuffer: string; pendingChunks: string[] }
  ): void {
    state.contentBuffer += msg;

    if (this.currentStatus === 'thinking') {
      this.thinkingHandler(msg);
      const isThinkingEnd = state.contentBuffer.includes(THINKING_CLOSE_TAG);
      if (isThinkingEnd) {
        state.contentBuffer = '';
        this.fireStatusHandler('message');
      }
      return;
    }

    if (this.currentStatus === 'message') {
      this.messageHandler(msg);
      return;
    }

    // Status is 'unknown' — buffer chunks until we can decide
    state.pendingChunks.push(msg);

    const isThinkingStart =
      THINKING_OPEN_TAG.startsWith(state.contentBuffer) ||
      state.contentBuffer.startsWith(THINKING_OPEN_TAG);
    if (isThinkingStart) {
      if (state.contentBuffer.length < THINKING_OPEN_TAG.length) {
        // Partial prefix match, keep buffering
        return;
      }
      // Confirmed thinking — flush pending to thinkingHandler
      for (const chunk of state.pendingChunks) {
        this.thinkingHandler(chunk);
      }
      state.pendingChunks = [];
      this.fireStatusHandler('thinking');
    } else {
      // Not thinking — flush pending to messageHandler
      for (const chunk of state.pendingChunks) {
        this.messageHandler(chunk);
      }
      state.pendingChunks = [];
      this.fireStatusHandler('message');
    }
  }

  private handleApiStatus(
    status: ChatApiStatus,
    state: { contentBuffer: string; pendingChunks: string[] }
  ): void {
    switch (status) {
      case 'message':
        break;
      case 'tool_call':
        this.fireStatusHandler('tool_call');
        state.contentBuffer = '';
        state.pendingChunks = [];
        break;
      case 'done':
        this.fireStatusHandler('done');
        state.contentBuffer = '';
        state.pendingChunks = [];
        break;
      case 'reasoning':
        this.fireStatusHandler('reasoning');
        state.contentBuffer = '';
        state.pendingChunks = [];
        break;
      default:
        this.fireStatusHandler('unknown');
        state.contentBuffer = '';
        state.pendingChunks = [];
    }
  }

  private fireStatusHandler(status: ChatStatus) {
    if (status !== this.currentStatus) {
      this.statusHandler(status);
    }
    this.currentStatus = status;
  }

  /** Append a user message without invoking the model. */
  public appendUserMessage(message?: string, imageUrls?: string[]): void {
    const content: MessageContent[] = [
      ...(message ? [{ type: 'text' as const, text: message }] : []),
      ...(imageUrls?.map((url) => ({
        type: 'image_url' as const,
        image_url: { url },
      })) ?? []),
    ];
    this.addMessage({
      role: MessageRole.USER,
      content,
    });
  }

  /**
   * Append an assistant message that requests tool calls (results not yet set).
   * Hosts run these through the normal tool executor before the model continues.
   */
  public appendAssistantToolCalls(
    calls: ReadonlyArray<{
      name: string;
      args: Record<string, unknown>;
      id?: string;
    }>
  ): ToolCallResponse[] {
    const tool_calls: ToolCallResponse[] = calls.map((call) => ({
      type: 'function',
      id: call.id ?? randomUUID(),
      function: {
        name: call.name,
        arguments: JSON.stringify(call.args),
      },
    }));
    this.addMessage({
      role: MessageRole.ASSISTANT,
      content: '',
      tool_calls,
    });
    return tool_calls;
  }

  public async sendMessage(
    message?: string,
    imageUrls?: string[],
    options: {
      requireToolApproval?: boolean;
      signal?: AbortSignal;
    } = {}
  ): Promise<void> {
    this.appendUserMessage(message, imageUrls);
    const res = await this.chatApiClient.chatStream(
      this.outgoingMessageTransform(this._messages),
      options.signal ?? this.abortController.signal
    );
    const assistantMessage = this.toMessageRequest(res);
    this.addMessage(assistantMessage);

    // If tool approval is required, set to pending state
    if (options.requireToolApproval && assistantMessage.tool_calls) {
      this._pendingToolCalls = assistantMessage.tool_calls.map((toolCall) => ({
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        toolArgs: toolCall.function.arguments,
      }));
      this.toolApprovalRequestHandler(this._pendingToolCalls);
    }
  }

  public getToolCallPlan(): ToolCallResponse[] | null {
    return this._messages[this._messages.length - 1].tool_calls || [];
  }

  public setMessageHandler(handler: (message: string) => void) {
    this.messageHandler = handler;
  }

  public setThinkingHandler(handler: (message: string) => void) {
    this.thinkingHandler = handler;
  }

  public setReasoningHandler(handler: (message: string) => void) {
    this.reasoningHandler = handler;
  }

  public setStatusHandler(handler: (status: ChatStatus) => void) {
    this.statusHandler = handler;
  }

  public setToolCallStreamHandler(
    handler: (event: ToolCallStreamEvent) => void
  ) {
    this.toolCallStreamHandler = handler;
  }

  public onMessageAdded(
    handler: (message: MessageRequest, allMessages: MessageRequest[]) => void
  ) {
    this.messageAddedHandler = handler;
  }

  public onToolApprovalRequest(
    handler: (pendingTools: PendingToolCall[]) => void
  ) {
    this.toolApprovalRequestHandler = handler;
  }

  public getPendingToolCalls(): PendingToolCall[] {
    return this._pendingToolCalls;
  }

  public hasPendingToolCalls(): boolean {
    return this._pendingToolCalls.length > 0;
  }

  public clearPendingToolCalls(): void {
    this._pendingToolCalls = [];
  }

  public addToolCallResult(toolCallId: string, toolResult: unknown) {
    this.addMessage({
      role: MessageRole.TOOL,
      tool_call_id: toolCallId,
      content: JSON.stringify(toolResult),
    });
  }

  public async validateToolCallResult(signal?: AbortSignal) {
    const res = await this.chatApiClient.validateToolCallResult(
      this.outgoingMessageTransform(this._messages),
      signal ?? this.abortController.signal
    );
    this.addMessage(this.toMessageRequest(res));
  }

  /**
   * Install a transform applied to the message history right before each API
   * request (chatStream / validateToolCallResult). The stored history is left
   * untouched — the transform only reshapes the OUTGOING copy. Use it for
   * context-window compaction. Pass an identity function to reset.
   */
  public setOutgoingMessageTransform(
    transform: (messages: MessageRequest[]) => MessageRequest[]
  ): void {
    this.outgoingMessageTransform = transform;
  }

  /**
   * Cancel the in-flight chat request. The internal AbortController is kept
   * aborted, so every subsequent sendMessage / validateToolCallResult that
   * relies on it also short-circuits — call clearAbort() to start fresh.
   * No-op for calls that pass their own explicit AbortSignal.
   */
  public abort(): void {
    this.abortController.abort();
  }

  /** Swap in a fresh AbortController so the client is usable again after abort(). */
  public clearAbort(): void {
    this.abortController = new AbortController();
  }

  public setSystemPrompt(systemPrompt: MessageRequest) {
    if (this._messages.length === 0) {
      this._messages.push(systemPrompt);
      return;
    }
    this._messages[0] = systemPrompt;
  }

  /** Map a provider response into a domain MessageRequest (`content` defaults to ""). */
  private toMessageRequest(res: ChatApiResponse): MessageRequest {
    return {
      role: res.role ?? MessageRole.ASSISTANT,
      content: res.content ?? '',
      reasoning: res.reasoning,
      tool_calls: res.tool_calls?.map((tc) => ({
        type: tc.type,
        id: tc.id,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })),
    };
  }

  private addMessage(message: MessageRequest) {
    this._messages.push(message);
    this.messageAddedHandler(message, this._messages);
  }

  public getMessages() {
    return this._messages;
  }

  public setMessages(messages: MessageRequest[]) {
    this._messages = messages;
  }
}

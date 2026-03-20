import {
  type ChatApiClient,
  type ChatApiResponse,
  type ChatApiStatus,
} from './ChatApiClient';

import { OpenAIChatApiClient } from './OpenAIChatApiClient';

const QWEN_THINKING_START_TAG = '<think>';
const QWEN_THINKING_END_TAG = '</think>';

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
    detail?: 'auto' | 'high' | 'low';
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
  | 'unknown'
  | 'message'
  | 'thinking'
  | 'reasoning'
  | 'tool_call'
  | 'done';

export class ChatClient {
  private chatApiClient: ChatApiClient;
  private messageHandler: (message: string) => void = () => {};
  private thinkingHandler: (message: string) => void = () => {};
  private reasoningHandler: (message: string) => void = () => {};
  private statusHandler: (status: ChatStatus) => void = () => {};
  private currentStatus: ChatStatus = 'unknown';
  private contextAddedHandler: (
    message: MessageRequest,
    allMessages: MessageRequest[]
  ) => void = () => {};
  private toolApprovalRequestHandler: (
    pendingTools: PendingToolCall[]
  ) => void = () => {};
  public _messages: MessageRequest[] = [];
  private _pendingToolCalls: PendingToolCall[] = [];

  constructor(chatApiClient: ChatApiClient) {
    this.chatApiClient = chatApiClient;

    this.setupStreamHandlers();
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
      const isThinkingEnd = state.contentBuffer.includes(QWEN_THINKING_END_TAG);
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
      QWEN_THINKING_START_TAG.startsWith(state.contentBuffer) ||
      state.contentBuffer.startsWith(QWEN_THINKING_START_TAG);
    if (isThinkingStart) {
      if (state.contentBuffer.length < QWEN_THINKING_START_TAG.length) {
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

  public async sendMessage(
    message?: string,
    imageUrls?: string[],
    options: { requireToolApproval?: boolean; signal?: AbortSignal } = {}
  ): Promise<void> {
    const content: MessageContent[] = [
      ...(message ? [{ type: 'text' as const, text: message }] : []),
      ...(imageUrls?.map((url) => ({
        type: 'image_url' as const,
        image_url: { url },
      })) ?? []),
    ];

    this.addMessage({
      role: 'user',
      content: content,
    });
    const res = await this.chatApiClient.chatStream(
      this._messages,
      options.signal
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

  public onContextAdded(
    handler: (message: MessageRequest, allMessages: MessageRequest[]) => void
  ) {
    this.contextAddedHandler = handler;
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
      role: 'tool',
      tool_call_id: toolCallId,
      content: JSON.stringify(toolResult),
    });
  }

  public async validateToolCallResult(signal?: AbortSignal) {
    const res = await this.chatApiClient.validateToolCallResult(
      this._messages,
      signal
    );
    this.addMessage(this.toMessageRequest(res));
  }

  public setSystemPrompt(systemPrompt: MessageRequest) {
    if (this._messages.length === 0) {
      this._messages.push(systemPrompt);
      return;
    }
    this._messages[0] = systemPrompt;
  }

  private toMessageRequest(res: ChatApiResponse): MessageRequest {
    return {
      role: res.role as string,
      content: res.content as string,
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
    this.contextAddedHandler(message, this._messages);
  }

  public getMessages() {
    return this._messages;
  }

  public setMessages(messages: MessageRequest[]) {
    this._messages = messages;
  }
}

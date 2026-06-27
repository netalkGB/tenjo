import {
  type ChatApiClient,
  type ChatApiImageDetail,
  type ChatApiStatus,
  type ChatApiToolCallStreamEvent,
} from './ChatApiClient';
import { ChatApiHttpError, type ChatStreamGuardError } from './ChatApiError';
import { MessageRole } from './ChatClient';
import { resolveImageUrls } from './openaiImageMessageUtils';
import { OpenAIStreamGuard, type StreamGuardOptions } from './StreamGuard';

export type { StreamGuardOptions, StreamProgress } from './StreamGuard';

export type Status = ChatApiStatus;

export interface ChatCompletionMessageRepsonse {
  role?: string;
  content?: string;
  reasoning?: string;
  tool_calls?: ToolCallResponse[];
}

export interface ToolCallResponse {
  type: string;
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export type ChatCompletionMessageContent =
  | ChatCompletionMessageTextContent
  | ChatCompletionMessageImageContent;

export interface ChatCompletionMessageTextContent {
  type: 'text';
  text: string;
}

export interface ChatCompletionMessageImageContent {
  type: 'image_url';
  image_url: {
    url: string; // Paths with non-HTTP(S) protocols are base64-encoded for transmission.
    detail?: ChatApiImageDetail;
  };
}

export interface ChatCompletionMessageRequest {
  role: string;
  content: string | ChatCompletionMessageContent[];
  tool_call_id?: string;
  tool_calls?: ToolCallResponse[];
}

type ChatCompletionRequestOptions = Record<string, unknown>;

export interface ToolDefinitionRequest {
  type: string;
  function: {
    name: string;
    description?: string;
    parameters: {
      type: string;
      properties?: unknown;
      required?: string[];
      additionalProperties?: boolean;
      $schema?: string;
    };
  };
}

export interface ModelInfo {
  id: string;
  owned_by: string;
}

export class OpenAIChatApiClient implements ChatApiClient {
  protected apiBaseUrl: string;
  protected model: string;
  protected apiKey: string | null;
  private tools: ToolDefinitionRequest[] = [];
  private readonly streamGuard: OpenAIStreamGuard | null;

  private onMessage: (data: string) => void = () => {};
  private onReasoning: (data: string) => void = () => {};
  private onStatusChanged: (status: Status) => void = () => {};
  private onToolCallStream: (event: ChatApiToolCallStreamEvent) => void =
    () => {};
  private currentStatus: Status = 'unknown';
  constructor(params: {
    apiBaseUrl: string;
    apiKey: string | null;
    model: string;
    tools: ToolDefinitionRequest[];
    /** Optional watchdog to abort a never-ending stream (reasoning loop). */
    streamGuard?: StreamGuardOptions;
  }) {
    // apiBaseUrl is stored as-is without including /v1
    this.apiBaseUrl = params.apiBaseUrl.replace(/\/?$/, '');
    this.model = params.model;
    this.apiKey = params.apiKey;
    this.tools = params.tools;
    this.streamGuard = params.streamGuard
      ? this.createStreamGuard(params.streamGuard)
      : null;
  }

  /**
   * Replace the advertised tool definitions. Takes effect on the next request —
   * used by long-lived sessions (the coding agent) to re-apply the user's tool
   * selection per turn, where chat builds a fresh client per request instead.
   */
  setTools(tools: ToolDefinitionRequest[]): void {
    this.tools = tools;
  }

  protected buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    return headers;
  }

  protected async getChatCompletionRequestOptions(): Promise<ChatCompletionRequestOptions> {
    return {};
  }

  protected createStreamGuard(
    streamGuard: StreamGuardOptions
  ): OpenAIStreamGuard {
    return new OpenAIStreamGuard(streamGuard);
  }

  public async chatRequest(
    messages: ChatCompletionMessageRequest[]
  ): Promise<Response> {
    const resolvedMessages = resolveImageUrls(messages);
    const apiUrl = this.apiBaseUrl + '/v1/chat/completions';
    const headers = this.buildHeaders();

    const requestBody = {
      model: this.model,
      messages: resolvedMessages,
      stream: false,
      tools: this.tools.length > 0 ? this.tools : undefined,
      tool_choice: this.tools.length > 0 ? 'auto' : undefined,
      ...(await this.getChatCompletionRequestOptions()),
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
      throw await ChatApiHttpError.fromResponse(response, {
        url: apiUrl,
        method: 'POST',
      });
    }
    return response;
  }

  public async chatStream(
    messages: ChatCompletionMessageRequest[],
    signal?: AbortSignal
  ): Promise<ChatCompletionMessageRepsonse> {
    const response = await this.createStreamRequest(messages, signal);
    return this.processStreamResponse(response);
  }

  public async validateToolCallResult(
    messages: ChatCompletionMessageRequest[],
    signal?: AbortSignal
  ): Promise<ChatCompletionMessageRepsonse> {
    const response = await this.createStreamRequest(messages, signal);
    return this.processStreamResponse(response);
  }

  private async createStreamRequest(
    messages: ChatCompletionMessageRequest[],
    signal?: AbortSignal
  ): Promise<Response> {
    const resolvedMessages = resolveImageUrls(messages);
    const apiUrl = this.apiBaseUrl + '/v1/chat/completions';
    const headers = this.buildHeaders();

    const requestBody = {
      model: this.model,
      messages: resolvedMessages,
      stream: true,
      tools: this.tools.length > 0 ? this.tools : undefined,
      tool_choice: this.tools.length > 0 ? 'auto' : undefined,
      ...(await this.getChatCompletionRequestOptions()),
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      throw await ChatApiHttpError.fromResponse(response, {
        url: apiUrl,
        method: 'POST',
      });
    }

    return response;
  }

  private async processStreamResponse(
    response: Response
  ): Promise<ChatCompletionMessageRepsonse> {
    const message: ChatCompletionMessageRepsonse = {
      role: MessageRole.ASSISTANT,
      content: undefined,
      tool_calls: undefined,
    };
    const toolCallsTmp = new Map<number, ToolCallResponse>();
    const pendingToolCallArgs = new Map<number, string>();

    const reader = response.body!.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    const startedAt = Date.now();
    let guardError: ChatStreamGuardError | null = null;

    // Hard read deadline. The stream guard is normally evaluated after a read
    // resolves, so a stalled connection needs reader cancellation to unblock.
    const maxDurationMs = this.streamGuard?.getMaxDurationMs() ?? 0;
    let deadlineHit = false;
    const deadlineTimer = maxDurationMs
      ? setTimeout(() => {
          deadlineHit = true;
          void reader.cancel().catch(() => {});
        }, maxDurationMs)
      : null;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        if (value) {
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            const json = line.replace('data: ', '').trim();
            if (json === '[DONE]') {
              this.fireStatusChanged('done');
              continue;
            }

            try {
              this.processStreamDelta(
                json,
                message,
                toolCallsTmp,
                pendingToolCallArgs
              );
            } catch {
              // Invalid JSON - ignore
            }
          }
        }

        guardError =
          this.streamGuard?.check(message, toolCallsTmp, startedAt) ?? null;
        if (guardError) break;
      }
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      reader.releaseLock();
    }

    if (deadlineHit && !guardError) {
      guardError = this.streamGuard?.createDeadlineError() ?? null;
    }

    if (guardError) {
      await response.body?.cancel().catch(() => {});
      throw guardError;
    }

    if (toolCallsTmp.size > 0) {
      message.tool_calls = Array.from(toolCallsTmp.values());
    }

    return message;
  }

  private processStreamDelta(
    json: string,
    message: ChatCompletionMessageRepsonse,
    toolCallsTmp: Map<number, ToolCallResponse>,
    pendingArgs: Map<number, string>
  ): void {
    const delta = JSON.parse(json);
    const choice = delta.choices?.[0]?.delta;
    if (!choice) return;

    if (choice.role) {
      message.role = choice.role;
    }

    // OpenAI-style servers stream reasoning under `reasoning`, while LM Studio
    // and DeepSeek-style servers use `reasoning_content`.
    const reasoningDelta = choice.reasoning ?? choice.reasoning_content;
    if (reasoningDelta) {
      if (!message.reasoning) message.reasoning = '';
      message.reasoning += reasoningDelta;
      this.fireStatusChanged('reasoning');
      this.fireReasoningAdded(reasoningDelta);
    }

    if (choice.content) {
      if (!message.content) message.content = '';
      message.content += choice.content;
      this.fireStatusChanged('message');
      this.fireMessageAdded(choice.content);
    }

    if (choice.tool_calls) {
      this.fireStatusChanged('tool_call');
      for (const toolCall of choice.tool_calls) {
        const existingToolCall = toolCallsTmp.get(toolCall.index) ?? {
          type: '',
          id: '',
          function: { name: '', arguments: '' },
        };
        const hadIdAndName =
          existingToolCall.id !== '' && existingToolCall.function.name !== '';

        existingToolCall.id += toolCall.id ?? '';
        existingToolCall.type = toolCall.type ?? '';

        const newArgsDelta = toolCall.function?.arguments ?? '';
        if (toolCall.function) {
          existingToolCall.function.name += toolCall.function.name ?? '';
          existingToolCall.function.arguments += newArgsDelta;
        }

        toolCallsTmp.set(toolCall.index, existingToolCall);

        const hasIdAndName =
          existingToolCall.id !== '' && existingToolCall.function.name !== '';
        if (!hasIdAndName) {
          if (newArgsDelta) {
            pendingArgs.set(
              toolCall.index,
              (pendingArgs.get(toolCall.index) ?? '') + newArgsDelta
            );
          }
          continue;
        }

        const buffered = pendingArgs.get(toolCall.index);
        if (!hadIdAndName && buffered !== undefined) {
          pendingArgs.delete(toolCall.index);
          this.onToolCallStream({
            toolCallId: existingToolCall.id,
            toolName: existingToolCall.function.name,
            argumentsDelta: buffered + newArgsDelta,
          });
        } else if (newArgsDelta) {
          this.onToolCallStream({
            toolCallId: existingToolCall.id,
            toolName: existingToolCall.function.name,
            argumentsDelta: newArgsDelta,
          });
        }
      }
    }
  }

  private fireStatusChanged(status: Status) {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    this.onStatusChanged?.(this.currentStatus);
  }

  private fireMessageAdded(message: string) {
    this.onMessage?.(message);
  }

  private fireReasoningAdded(reasoning: string) {
    this.onReasoning?.(reasoning);
  }

  public setMessageHandler(onMessage: (message: string) => void) {
    this.onMessage = onMessage;
  }

  public setReasoningHandler(onReasoning: (reasoning: string) => void) {
    this.onReasoning = onReasoning;
  }

  public setStatusHandler(onStatusChanged: (status: Status) => void) {
    this.onStatusChanged = onStatusChanged;
  }

  public setToolCallStreamHandler(
    onToolCallStream: (event: ChatApiToolCallStreamEvent) => void
  ) {
    this.onToolCallStream = onToolCallStream;
  }

  getStatus(): ChatApiStatus {
    return this.currentStatus;
  }

  /**
   * Fetch the list of available models from an OpenAI-compatible server.
   */
  static async listModels(
    baseUrl: string,
    apiKey: string | null
  ): Promise<ModelInfo[]> {
    const normalizedUrl = baseUrl.replace(/\/?$/, '');
    const apiUrl = normalizedUrl + '/v1/models';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(apiUrl, { method: 'GET', headers });
    if (!response.ok) {
      throw await ChatApiHttpError.fromResponse(response, {
        url: apiUrl,
        method: 'GET',
      });
    }

    const json = (await response.json()) as { data: ModelInfo[] };
    return json.data.map((m) => ({ id: m.id, owned_by: m.owned_by }));
  }
}

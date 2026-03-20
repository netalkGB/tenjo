import * as fs from 'fs';
import * as path from 'path';
import { type ChatApiClient, type ChatApiStatus } from './ChatApiClient';

export type Status = ChatApiStatus;

const SUPPORTED_IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

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
    detail?: 'auto' | 'high' | 'low';
  };
}

export interface ChatCompletionMessageRequest {
  role: string;
  content: string | ChatCompletionMessageContent[];
  tool_call_id?: string;
  tool_calls?: ToolCallResponse[];
}

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
  private apiBaseUrl: string;
  private model: string;
  private apiKey: string | null;
  private tools: ToolDefinitionRequest[] = [];

  private onMessage: (data: string) => void = () => {};
  private onReasoning: (data: string) => void = () => {};
  private onStatusChanged: (status: Status) => void = () => {};
  private currentStatus: Status = 'unknown';
  constructor(params: {
    apiBaseUrl: string;
    apiKey: string | null;
    model: string;
    tools: ToolDefinitionRequest[];
  }) {
    // apiBaseUrl is stored as-is without including /v1
    this.apiBaseUrl = params.apiBaseUrl.replace(/\/?$/, '');
    this.model = params.model;
    this.apiKey = params.apiKey;
    this.tools = params.tools;
  }

  private convertFilePathToDataUri(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = SUPPORTED_IMAGE_EXTENSIONS[ext];
    if (!mimeType) {
      throw new Error(`Unsupported image format: ${ext}`);
    }
    const fileBuffer = fs.readFileSync(filePath);
    const base64 = fileBuffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  }

  private isFilePath(url: string): boolean {
    return (
      !url.startsWith('data:') &&
      !url.startsWith('http://') &&
      !url.startsWith('https://')
    );
  }

  private resolveImageUrls(
    messages: ChatCompletionMessageRequest[]
  ): ChatCompletionMessageRequest[] {
    return messages.map((msg) => {
      if (!Array.isArray(msg.content)) return msg;

      const resolvedContent = msg.content.map((part) => {
        if (part.type !== 'image_url' || !this.isFilePath(part.image_url.url)) {
          return part;
        }
        return {
          ...part,
          image_url: {
            ...part.image_url,
            url: this.convertFilePathToDataUri(part.image_url.url),
          },
        };
      });

      return { ...msg, content: resolvedContent };
    });
  }

  public async chatRequest(
    messages: ChatCompletionMessageRequest[]
  ): Promise<Response> {
    const resolvedMessages = this.resolveImageUrls(messages);
    const apiUrl = this.apiBaseUrl + '/v1/chat/completions';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const requestBody = {
      model: this.model,
      messages: resolvedMessages,
      stream: false,
      tools: this.tools.length > 0 ? this.tools : undefined,
      tool_choice: this.tools.length > 0 ? 'auto' : undefined,
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
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
    const resolvedMessages = this.resolveImageUrls(messages);
    const apiUrl = this.apiBaseUrl + '/v1/chat/completions';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const requestBody = {
      model: this.model,
      messages: resolvedMessages,
      stream: true,
      tools: this.tools.length > 0 ? this.tools : undefined,
      tool_choice: this.tools.length > 0 ? 'auto' : undefined,
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response;
  }

  private async processStreamResponse(
    response: Response
  ): Promise<ChatCompletionMessageRepsonse> {
    const message: ChatCompletionMessageRepsonse = {
      role: undefined,
      content: undefined,
      tool_calls: undefined,
    };
    const toolCallsTmp = new Map<number, ToolCallResponse>();

    const reader = response.body!.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        if (value) {
          buffer += decoder.decode(value, { stream: true });

          // Process complete lines
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            const json = line.replace('data: ', '').trim();
            if (json === '[DONE]') {
              this.fireStatusChanged('done');
              continue;
            }

            try {
              this.processStreamDelta(json, message, toolCallsTmp);
            } catch {
              // Invalid JSON - ignore
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (toolCallsTmp.size > 0) {
      message.tool_calls = Array.from(toolCallsTmp.values());
    }

    return message;
  }

  private processStreamDelta(
    json: string,
    message: ChatCompletionMessageRepsonse,
    toolCallsTmp: Map<number, ToolCallResponse>
  ): void {
    const delta = JSON.parse(json);
    const choice = delta.choices?.[0]?.delta;
    if (!choice) return;

    // Handle role
    if (choice.role) {
      message.role = choice.role;
    }

    // Handle reasoning
    if (choice.reasoning) {
      if (!message.reasoning) message.reasoning = '';
      message.reasoning += choice.reasoning;
      this.fireStatusChanged('reasoning');
      this.fireReasoningAdded(choice.reasoning);
    }

    // Handle content
    if (choice.content) {
      if (!message.content) message.content = '';
      message.content += choice.content;
      this.fireStatusChanged('message');
      this.fireMessageAdded(choice.content);
    }

    // Handle tool calls
    if (choice.tool_calls) {
      this.fireStatusChanged('tool_call');
      for (const toolCall of choice.tool_calls) {
        const existingToolCall = toolCallsTmp.get(toolCall.index) ?? {
          type: '',
          id: '',
          function: { name: '', arguments: '' },
        };

        existingToolCall.id += toolCall.id ?? '';
        existingToolCall.type = toolCall.type ?? '';

        if (toolCall.function) {
          existingToolCall.function.name += toolCall.function.name ?? '';
          existingToolCall.function.arguments +=
            toolCall.function.arguments ?? '';
        }

        toolCallsTmp.set(toolCall.index, existingToolCall);
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
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const json = (await response.json()) as { data: ModelInfo[] };
    return json.data.map((m) => ({ id: m.id, owned_by: m.owned_by }));
  }
}

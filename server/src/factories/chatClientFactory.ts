import {
  ChatClient,
  OpenAIChatApiClient,
  LmStudioChatApiClient,
  OllamaChatApiClient,
  type ToolDefinitionRequest,
  type MessageRequest,
  type StreamGuardOptions
} from 'tenjo-chat-engine';
import type { ModelConfig } from '../repositories/GlobalSettingRepository';

/**
 * Build a provider chat client. `streamGuard` is optional and OFF by default so
 * web chat is unaffected — only the coding agent passes it, to abort a model
 * that streams reasoning forever without producing output/a tool call (the CLI
 * agent has always had this watchdog; the GUI agent now matches it).
 */
export function createChatApiClient(
  config: ModelConfig,
  tools: ToolDefinitionRequest[],
  streamGuard?: StreamGuardOptions
) {
  switch (config.type) {
    case 'lmstudio':
      return new LmStudioChatApiClient({
        apiBaseUrl: config.baseUrl,
        apiKey: config.token,
        model: config.model,
        tools,
        streamGuard
      });
    case 'ollama':
      return new OllamaChatApiClient({
        apiBaseUrl: config.baseUrl,
        apiKey: config.token,
        model: config.model,
        tools,
        streamGuard
      });
    case 'openai':
    case 'openai-compatible':
      return new OpenAIChatApiClient({
        apiBaseUrl: config.baseUrl,
        apiKey: config.token,
        model: config.model,
        tools,
        streamGuard
      });
  }
}

interface CreateChatClientOptions {
  config: ModelConfig;
  tools?: ToolDefinitionRequest[];
  systemPrompt: MessageRequest;
  contextMessages?: MessageRequest[];
}

/**
 * Creates a fully initialized ChatClient with system prompt and context messages.
 * The system prompt is always preserved at index 0, even when context messages are provided.
 * Build the systemPrompt with `SystemPromptBuilder` so all conditional pieces
 * (knowledge, optional tool nudges, etc.) live in one place.
 */
export function createChatClient({
  config,
  tools = [],
  systemPrompt,
  contextMessages
}: CreateChatClientOptions): ChatClient {
  const chatClient = new ChatClient(createChatApiClient(config, tools));

  if (contextMessages && contextMessages.length > 0) {
    chatClient.setMessages([systemPrompt, ...contextMessages]);
  } else {
    chatClient.setMessages([systemPrompt]);
  }

  return chatClient;
}

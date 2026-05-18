import {
  ChatClient,
  OpenAIChatApiClient,
  LmStudioChatApiClient,
  OllamaChatApiClient,
  type ToolDefinitionRequest,
  type MessageRequest
} from 'tenjo-chat-engine';
import type { ModelConfig } from '../repositories/GlobalSettingRepository';

export function createChatApiClient(
  config: ModelConfig,
  tools: ToolDefinitionRequest[]
) {
  switch (config.type) {
    case 'lmstudio':
      return new LmStudioChatApiClient({
        apiBaseUrl: config.baseUrl,
        apiKey: config.token,
        model: config.model,
        tools
      });
    case 'ollama':
      return new OllamaChatApiClient({
        apiBaseUrl: config.baseUrl,
        apiKey: config.token,
        model: config.model,
        tools
      });
    default:
      return new OpenAIChatApiClient({
        apiBaseUrl: config.baseUrl,
        apiKey: config.token,
        model: config.model,
        tools
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

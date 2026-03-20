import {
  ChatClient,
  OpenAIChatApiClient,
  LmStudioChatApiClient,
  OllamaChatApiClient,
  type ToolDefinitionRequest
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

export function createChatClient(
  config: ModelConfig,
  tools: ToolDefinitionRequest[] = []
): ChatClient {
  const chatClient = new ChatClient(createChatApiClient(config, tools));
  chatClient.setSystemPrompt({
    role: 'system',
    content: [{ type: 'text', text: 'You are a helpful AI assistant.' }]
  });
  return chatClient;
}

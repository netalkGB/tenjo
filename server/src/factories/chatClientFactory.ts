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

function buildSystemPrompt(knowledgeContent?: string): MessageRequest {
  let text = 'You are a helpful AI assistant.';
  if (knowledgeContent) {
    text +=
      '\n\nI have been informed about and am aware of the following in advance.\n' +
      knowledgeContent;
  }
  return {
    role: 'system',
    content: [{ type: 'text', text }]
  };
}

interface CreateChatClientOptions {
  config: ModelConfig;
  tools?: ToolDefinitionRequest[];
  knowledgeContent?: string;
  contextMessages?: MessageRequest[];
}

/**
 * Creates a fully initialized ChatClient with system prompt and context messages.
 * The system prompt is always preserved at index 0, even when context messages are provided.
 */
export function createChatClient({
  config,
  tools = [],
  knowledgeContent,
  contextMessages
}: CreateChatClientOptions): ChatClient {
  const chatClient = new ChatClient(createChatApiClient(config, tools));
  const systemPrompt = buildSystemPrompt(knowledgeContent);

  if (contextMessages && contextMessages.length > 0) {
    chatClient.setMessages([systemPrompt, ...contextMessages]);
  } else {
    chatClient.setMessages([systemPrompt]);
  }

  return chatClient;
}

import { OpenAIChatApiClient } from './OpenAIChatApiClient';

export class OllamaChatApiClient extends OpenAIChatApiClient {}

export type {
  Status,
  ChatCompletionMessageRepsonse,
  ToolCallResponse,
  ChatCompletionMessageContent,
  ChatCompletionMessageTextContent,
  ChatCompletionMessageImageContent,
  ChatCompletionMessageRequest,
  ToolDefinitionRequest,
} from './OpenAIChatApiClient';

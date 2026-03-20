export type ChatApiStatus =
  | 'unknown'
  | 'message'
  | 'reasoning'
  | 'tool_call'
  | 'done';

export interface ChatApiToolCallResponse {
  type: string;
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatApiResponse {
  role?: string;
  content?: string;
  reasoning?: string;
  tool_calls?: ChatApiToolCallResponse[];
}

export type ChatApiMessageContent =
  | ChatApiMessageTextContent
  | ChatApiMessageImageContent;

export interface ChatApiMessageTextContent {
  type: 'text';
  text: string;
}

export interface ChatApiMessageImageContent {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'high' | 'low';
  };
}

export interface ChatApiMessageRequest {
  role: string;
  content: string | ChatApiMessageContent[];
  tool_call_id?: string;
  tool_calls?: ChatApiToolCallResponse[];
}

export interface ChatApiClient {
  chatStream(
    messages: ChatApiMessageRequest[],
    signal?: AbortSignal
  ): Promise<ChatApiResponse>;
  validateToolCallResult(
    messages: ChatApiMessageRequest[],
    signal?: AbortSignal
  ): Promise<ChatApiResponse>;
  setMessageHandler(onMessage: (message: string) => void): void;
  setReasoningHandler(onReasoning: (reasoning: string) => void): void;
  setStatusHandler(onStatusChanged: (status: ChatApiStatus) => void): void;
  getStatus(): ChatApiStatus;
}

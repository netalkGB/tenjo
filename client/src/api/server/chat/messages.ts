import axios from 'axios';
import { ApiError } from '../../errors/ApiError';
import { handleApiError } from '../../errors/handleApiError';
import {
  NewChatRequestSchema,
  SSEChunkSchema,
  ThreadMessagesResponseSchema
} from './schemas';
import type { ThreadMessagesResponse, SendMessageCallbacks } from './schemas';

export async function getThreadMessages(
  threadId: string
): Promise<ThreadMessagesResponse> {
  try {
    const response = await axios.get<ThreadMessagesResponse>(
      `/api/chat/threads/${threadId}/messages`
    );

    const validatedResponse = ThreadMessagesResponseSchema.parse(response.data);
    return validatedResponse;
  } catch (error) {
    handleApiError(error);
  }
}

/**
 * Reads an SSE stream and dispatches parsed chunks to the provided callbacks.
 */
async function processSSEStream(
  response: Response,
  callbacks: SendMessageCallbacks
): Promise<void> {
  if (!response.body) {
    throw new ApiError('Response body is null', null);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');

    // Keep the last line in the buffer as it may be incomplete
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);

        const parsed = JSON.parse(data);
        const validated = SSEChunkSchema.parse(parsed);

        if (validated.error) {
          if (callbacks.onError) {
            callbacks.onError(validated.error);
          }
          throw new ApiError(validated.error, null);
        }

        if (validated.chunk && callbacks.onChunk) {
          callbacks.onChunk(validated.chunk);
        }

        if (validated.thinking && callbacks.onThinking) {
          callbacks.onThinking(validated.thinking);
        }

        if (validated.reasoning && callbacks.onReasoning) {
          callbacks.onReasoning(validated.reasoning);
        }

        if (validated.generatingTitle && callbacks.onGeneratingTitle) {
          callbacks.onGeneratingTitle();
        }

        if (validated.processing && callbacks.onProcessing) {
          callbacks.onProcessing();
        }

        if (validated.analyzingImages && callbacks.onAnalyzingImages) {
          callbacks.onAnalyzingImages();
        }

        if (validated.done && callbacks.onComplete) {
          callbacks.onComplete(
            validated.title,
            validated.userMessageId,
            validated.assistantMessageId,
            validated.model,
            validated.provider
          );
        }

        if (validated.toolCall && callbacks.onToolCall) {
          callbacks.onToolCall(validated.toolCall);
        }
      }
    }
  }
}

function buildHeaders(): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json'
  };
  const csrfToken = document.body.dataset.csrfToken;
  if (csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }
  return headers;
}

export async function editAndResendMessage(
  threadId: string,
  messageId: string,
  message: string,
  callbacks: SendMessageCallbacks,
  modelId?: string,
  enabledTools?: string[],
  imageUrls?: string[],
  knowledgeIds?: string[]
): Promise<void> {
  try {
    const requestData = {
      message,
      modelId,
      enabledTools,
      imageUrls: imageUrls && imageUrls.length > 0 ? imageUrls : undefined,
      knowledgeIds:
        knowledgeIds && knowledgeIds.length > 0 ? knowledgeIds : undefined
    };

    const response = await fetch(
      `/api/chat/threads/${threadId}/messages/${messageId}/edit`,
      {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(requestData),
        credentials: 'include',
        signal: callbacks.signal
      }
    );

    if (!response.ok) {
      throw new ApiError(
        `HTTP error! status: ${response.status}`,
        response.status
      );
    }

    await processSSEStream(response, callbacks);
  } catch (error) {
    handleApiError(error);
  }
}

export async function sendMessageToThread(
  threadId: string,
  message: string,
  parentMessageId: string | undefined,
  callbacks: SendMessageCallbacks,
  modelId?: string,
  enabledTools?: string[],
  imageUrls?: string[],
  knowledgeIds?: string[]
): Promise<void> {
  try {
    const requestData = NewChatRequestSchema.parse({
      message,
      parentMessageId,
      modelId,
      enabledTools,
      imageUrls: imageUrls && imageUrls.length > 0 ? imageUrls : undefined,
      knowledgeIds:
        knowledgeIds && knowledgeIds.length > 0 ? knowledgeIds : undefined
    });

    const response = await fetch(`/api/chat/threads/${threadId}/messages`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(requestData),
      credentials: 'include',
      signal: callbacks.signal
    });

    if (!response.ok) {
      throw new ApiError(
        `HTTP error! status: ${response.status}`,
        response.status
      );
    }

    await processSSEStream(response, callbacks);
  } catch (error) {
    handleApiError(error);
  }
}

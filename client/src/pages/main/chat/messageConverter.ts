import type { ThreadMessage } from '@/api/server/chat';
import type { Message } from '@/state/chatTypes';
import type { ToolCallInfo } from '@/components/chat';

type ContentArray = (
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
)[];

const THINK_TAG_REGEX = /^<think>([\s\S]*?)<\/think>\s*/;

/**
 * Split text content into thinking and message parts.
 * Returns [thinkingContent, messageContent].
 */
export function splitThinkingContent(
  text: string
): [string | undefined, string] {
  const match = text.match(THINK_TAG_REGEX);
  if (!match) return [undefined, text];
  const thinking = match[1].trim();
  const message = text.slice(match[0].length);
  return [thinking || undefined, message];
}

export function extractTextContent(
  content: string | ContentArray | null | undefined
): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  const textContent = content.find(c => c.type === 'text');
  return textContent && textContent.type === 'text' ? textContent.text : '';
}

function extractImageUrls(
  content: string | ContentArray | null | undefined
): string[] {
  if (!content || typeof content === 'string') return [];
  return content
    .filter(
      (c): c is { type: 'image_url'; image_url: { url: string } } =>
        c.type === 'image_url'
    )
    .map(c => c.image_url.url);
}

function safeJsonParse(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

/**
 * Convert DB-stored message sequences into UI Message[].
 * Merges the sequence of assistant (with tool_calls) -> tool -> ... -> assistant (final response)
 * by attaching toolCalls to the final assistant message.
 */
export function convertThreadMessages(
  threadMessages: ThreadMessage[]
): Message[] {
  const result: Message[] = [];
  let pendingToolCalls: ToolCallInfo[] = [];
  // Track the original user message ID during a tool flow.
  // The parent of assistant(tool_calls) = user message ID
  let toolFlowUserMessageId: string | null = null;

  for (const msg of threadMessages) {
    const { role, content, tool_calls, tool_call_id } = msg.data;

    if (role === 'assistant' && tool_calls && tool_calls.length > 0) {
      // Assistant message requesting tool calls -> accumulate in pendingToolCalls.
      // Remember that this assistant's parent is a user message.
      toolFlowUserMessageId = msg.parent_message_id;
      pendingToolCalls = tool_calls.map(tc => ({
        toolCallId: tc.id,
        toolName: tc.function.name,
        toolArgs: safeJsonParse(tc.function.arguments) as
          | Record<string, unknown>
          | undefined,
        status: 'calling' as const
      }));
      // If this message has content, add it for display (text before the tool call).
      if (content) {
        result.push({
          id: msg.id,
          type: 'assistant',
          content: extractTextContent(content),
          currentCount: msg.currentCount,
          totalCount: msg.totalCount,
          siblings: msg.siblings ?? undefined,
          parentMessageId: msg.parent_message_id,
          model: msg.model,
          provider: msg.provider
        });
      }
      continue;
    }

    if (role === 'tool' && tool_call_id) {
      // Tool execution result -> update the corresponding pendingToolCall.
      const idx = pendingToolCalls.findIndex(
        tc => tc.toolCallId === tool_call_id
      );
      if (idx !== -1) {
        const contentText = extractTextContent(content);
        const parsed = safeJsonParse(contentText);
        const hasError =
          parsed !== null &&
          typeof parsed === 'object' &&
          'error' in (parsed as Record<string, unknown>);
        pendingToolCalls[idx] = {
          ...pendingToolCalls[idx],
          result: parsed,
          success: !hasError,
          status: 'completed'
        };
      }
      continue;
    }

    // Regular user/assistant message.
    const rawText = extractTextContent(content);
    // Prefer reasoning field over <think> tags
    const [thinkingContent, messageText] =
      role === 'assistant' && msg.data.reasoning
        ? [msg.data.reasoning, rawText]
        : role === 'assistant'
          ? splitThinkingContent(rawText)
          : [undefined, rawText];
    const message: Message = {
      id: msg.id,
      type: role === 'user' ? 'user' : 'assistant',
      content: messageText,
      thinkingContent,
      imageUrls: extractImageUrls(content),
      currentCount: msg.currentCount,
      totalCount: msg.totalCount,
      siblings: msg.siblings ?? undefined,
      parentMessageId: msg.parent_message_id,
      model: role === 'assistant' ? msg.model : undefined,
      provider: role === 'assistant' ? msg.provider : undefined
    };

    // If there are accumulated toolCalls, attach them to this assistant message.
    // Reset parentMessageId to the user message ID from before the tool flow.
    if (role === 'assistant' && pendingToolCalls.length > 0) {
      message.toolCalls = pendingToolCalls;
      if (toolFlowUserMessageId) {
        message.parentMessageId = toolFlowUserMessageId;
      }
      pendingToolCalls = [];
      toolFlowUserMessageId = null;
    }

    result.push(message);
  }

  return result;
}

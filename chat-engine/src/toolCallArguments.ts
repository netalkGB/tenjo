import type { ChatCompletionMessageRequest } from './OpenAIChatApiClient';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Tool-call `arguments` must be a JSON object string. Some OpenAI-compatible
 * servers (Strata / Qwen) `json.loads` that string while applying the chat
 * template, and a stream that ended mid-call leaves an unterminated string in
 * history. Replaying it makes every later turn fail with HTTP 400
 * ("Unterminated string starting at: line 1 column 12").
 *
 * Valid object JSON is returned unchanged. Blank stays blank (those servers
 * treat it as {}). Anything else is wrapped so the request stays valid and the
 * raw text is still visible to the model.
 */
export function coerceToolCallArguments(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return raw;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isPlainObject(parsed)) {
      return raw;
    }
  } catch {
    // Truncated or otherwise invalid. Wrap below.
  }
  return JSON.stringify({ _unparsed: raw });
}

/** Rewrite tool-call arguments that are not a JSON object. Same array if unchanged. */
export function coerceMessageToolArguments(
  messages: ChatCompletionMessageRequest[]
): ChatCompletionMessageRequest[] {
  let changed = false;
  const next = messages.map((message) => {
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message;
    }
    let callsChanged = false;
    const tool_calls = message.tool_calls.map((call) => {
      const coerced = coerceToolCallArguments(call.function.arguments);
      if (coerced === call.function.arguments) {
        return call;
      }
      callsChanged = true;
      return {
        ...call,
        function: { ...call.function, arguments: coerced },
      };
    });
    if (!callsChanged) {
      return message;
    }
    changed = true;
    return { ...message, tool_calls };
  });
  return changed ? next : messages;
}

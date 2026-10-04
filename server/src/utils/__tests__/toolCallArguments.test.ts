import { describe, expect, it } from 'vitest';
import {
  coerceMessageToolArguments,
  coerceToolCallArguments,
  type ChatCompletionMessageRequest
} from 'tenjo-chat-engine';

const truncatedBash =
  '{"command":"cd /workspace && cmake --build build -j 2>&1 | grep -E \\"error|warning\\" | head -5; QT_QPA_PLATFORM';

describe('coerceToolCallArguments', () => {
  it('keeps a JSON object string', () => {
    const raw = '{"command":"ls"}';
    expect(coerceToolCallArguments(raw)).toBe(raw);
  });

  it('keeps blank arguments', () => {
    expect(coerceToolCallArguments('')).toBe('');
    expect(coerceToolCallArguments('   ')).toBe('   ');
  });

  it('wraps an unterminated tool-call string so it parses as an object', () => {
    const coerced = coerceToolCallArguments(truncatedBash);
    const parsed: unknown = JSON.parse(coerced);
    expect(parsed).toEqual({ _unparsed: truncatedBash });
  });

  it('wraps JSON that is not an object', () => {
    expect(JSON.parse(coerceToolCallArguments('["a"]'))).toEqual({
      _unparsed: '["a"]'
    });
  });
});

describe('coerceMessageToolArguments', () => {
  it('rewrites only the broken call and leaves the rest of the history', () => {
    const messages: ChatCompletionMessageRequest[] = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            type: 'function',
            id: 'call_ok',
            function: { name: 'bash', arguments: '{"command":"pwd"}' }
          },
          {
            type: 'function',
            id: 'call_bad',
            function: { name: 'bash', arguments: truncatedBash }
          }
        ]
      }
    ];

    const next = coerceMessageToolArguments(messages);
    expect(next[0]).toBe(messages[0]);
    expect(next[1]?.tool_calls?.[0]?.function.arguments).toBe(
      '{"command":"pwd"}'
    );
    expect(
      JSON.parse(next[1]?.tool_calls?.[1]?.function.arguments ?? '')
    ).toEqual({ _unparsed: truncatedBash });
  });

  it('returns the same array when every call is already valid', () => {
    const messages: ChatCompletionMessageRequest[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            type: 'function',
            id: 'call_ok',
            function: { name: 'bash', arguments: '{}' }
          }
        ]
      }
    ];
    expect(coerceMessageToolArguments(messages)).toBe(messages);
  });
});

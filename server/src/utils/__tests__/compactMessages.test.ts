import { describe, expect, it } from 'vitest';
import {
  compactMessages,
  estimateMessagesTokens,
  type MessageRequest
} from 'tenjo-chat-engine';

describe('compactMessages', () => {
  it('shortens tool arguments when content truncation cannot meet the budget', () => {
    const huge = JSON.stringify({ command: 'x'.repeat(20000) });
    const messages: MessageRequest[] = [
      { role: 'system', content: 'system' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            type: 'function',
            id: 'call_old',
            function: { name: 'bash', arguments: huge }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'call_old',
        content: 'ok'
      },
      { role: 'user', content: 'continue' }
    ];

    const result = compactMessages(messages, {
      maxContextTokens: 500,
      reservedOutputTokens: 100,
      compactThresholdRatio: 0.5,
      targetRatio: 0.4,
      recentMessagesToKeep: 1
    });

    const call = result.messages[1]?.tool_calls?.[0];
    expect(call?.id).toBe('call_old');
    expect(call?.function.name).toBe('bash');
    const parsed: unknown = JSON.parse(call?.function.arguments ?? '');
    expect(parsed).toEqual(
      expect.objectContaining({ _omitted: expect.any(String) })
    );
    expect(call?.function.arguments.length ?? 0).toBeLessThan(huge.length);
    expect(estimateMessagesTokens(result.messages)).toBeLessThanOrEqual(400);
  });

  it('keeps shortening until the target ratio when enforceTarget is set', () => {
    const huge = JSON.stringify({ command: 'y'.repeat(20000) });
    const messages: MessageRequest[] = [
      { role: 'system', content: 'system' },
      {
        role: 'assistant',
        content: 'done',
        tool_calls: [
          {
            type: 'function',
            id: 'call_old',
            function: { name: 'bash', arguments: huge }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'call_old', content: 'ok' },
      { role: 'user', content: 'continue' }
    ];
    const options = {
      maxContextTokens: 10000,
      reservedOutputTokens: 1000,
      compactThresholdRatio: 0.3,
      targetRatio: 0.3,
      recentMessagesToKeep: 1
    };

    const untouched = compactMessages(messages, options);
    expect(untouched.messages[1]?.tool_calls?.[0]?.function.arguments).toBe(
      huge
    );

    const enforced = compactMessages(messages, {
      ...options,
      enforceTarget: true
    });
    expect(
      enforced.messages[1]?.tool_calls?.[0]?.function.arguments.length ?? 0
    ).toBeLessThan(huge.length);
    expect(estimateMessagesTokens(enforced.messages)).toBeLessThanOrEqual(3000);
  });
});

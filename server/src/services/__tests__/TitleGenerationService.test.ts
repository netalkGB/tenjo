import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFallbackTitle, generateTitle } from '../TitleGenerationService';
import type { ModelConfig } from '../../repositories/GlobalSettingRepository';

// Mock logger
vi.mock('../../logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('../../factories/chatClientFactory', () => ({
  createChatClient: vi.fn()
}));

import { createChatClient } from '../../factories/chatClientFactory';

type MockChatClient = {
  setThinkingHandler: ReturnType<typeof vi.fn>;
  setMessageHandler: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
};

const makeModelConfig = (
  overrides: Partial<ModelConfig> = {}
): ModelConfig => ({
  type: 'openai',
  baseUrl: 'http://localhost:1234',
  model: 'gpt-4',
  token: 'test-token',
  ...overrides
});

const createMockChatClient = (): MockChatClient => ({
  setThinkingHandler: vi.fn(),
  setMessageHandler: vi.fn(),
  sendMessage: vi.fn()
});

const asChatClientFactory = (
  client: MockChatClient
): ReturnType<typeof createChatClient> =>
  client as unknown as ReturnType<typeof createChatClient>;

describe('TitleGenerationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createFallbackTitle', () => {
    it('should trim short messages', () => {
      const result = createFallbackTitle('  Short title  ');

      expect(result).toBe('Short title');
    });

    it('should truncate long messages to 30 characters with ellipsis', () => {
      const result = createFallbackTitle(
        'This is a very long message that should be truncated'
      );

      expect(result).toBe('This is a very long message th...');
      expect(result).toHaveLength(33);
    });
  });

  describe('generateTitle', () => {
    it('should return fallback title when no model config is provided', async () => {
      const result = await generateTitle('A short message', null);

      expect(result).toBe('A short message');
      expect(createChatClient).not.toHaveBeenCalled();
    });

    it('should generate title via LLM when model config is provided', async () => {
      const config = makeModelConfig();
      const mockedCreateChatClient = vi.mocked(createChatClient);
      mockedCreateChatClient.mockImplementation(() => {
        const client = createMockChatClient();
        client.sendMessage.mockImplementation(async () => {
          const handler = client.setMessageHandler.mock.calls[0]?.[0] as
            | ((chunk: string) => void)
            | undefined;
          handler?.('Generated ');
          handler?.('Title');
        });
        return asChatClientFactory(client);
      });

      const result = await generateTitle('Some long user message', config);

      expect(result).toBe('Generated Title');
      expect(mockedCreateChatClient).toHaveBeenCalledWith({
        config,
        systemPrompt: {
          role: 'system',
          content: [
            {
              type: 'text',
              text: 'Do not use <think> tags. Respond directly. Summarize.'
            }
          ]
        }
      });
    });

    it('should fall back when LLM returns empty response', async () => {
      const config = makeModelConfig();
      const mockedCreateChatClient = vi.mocked(createChatClient);
      mockedCreateChatClient.mockImplementation(() => {
        const client = createMockChatClient();
        client.sendMessage.mockResolvedValue(undefined);
        return asChatClientFactory(client);
      });

      const result = await generateTitle('Fallback message', config);

      expect(result).toBe('Fallback message');
    });

    it('should fall back when sendMessage throws a non-AbortError', async () => {
      const config = makeModelConfig();
      const mockedCreateChatClient = vi.mocked(createChatClient);
      mockedCreateChatClient.mockImplementation(() => {
        const client = createMockChatClient();
        client.sendMessage.mockRejectedValue(new Error('Network error'));
        return asChatClientFactory(client);
      });

      const result = await generateTitle('Test message', config);

      expect(result).toBe('Test message');
    });

    it('should keep collected text when sendMessage throws AbortError', async () => {
      const config = makeModelConfig();
      const mockedCreateChatClient = vi.mocked(createChatClient);
      mockedCreateChatClient.mockImplementation(() => {
        const client = createMockChatClient();
        client.sendMessage.mockImplementation(async () => {
          const handler = client.setMessageHandler.mock.calls[0]?.[0] as
            | ((chunk: string) => void)
            | undefined;
          handler?.('Partial');
          const abortError = new Error('Aborted');
          abortError.name = 'AbortError';
          throw abortError;
        });
        return asChatClientFactory(client);
      });

      const result = await generateTitle('Message', config);

      expect(result).toBe('Partial');
    });

    it('should truncate LLM-generated title to 150 characters', async () => {
      const config = makeModelConfig();
      const longTitle = 'a'.repeat(200);
      const mockedCreateChatClient = vi.mocked(createChatClient);
      mockedCreateChatClient.mockImplementation(() => {
        const client = createMockChatClient();
        client.sendMessage.mockImplementation(async () => {
          const handler = client.setMessageHandler.mock.calls[0]?.[0] as
            | ((chunk: string) => void)
            | undefined;
          handler?.(longTitle);
        });
        return asChatClientFactory(client);
      });

      const result = await generateTitle('Message', config);

      expect(result).toHaveLength(150);
    });

    it('should abort via timeout and fall back when no text was collected', async () => {
      vi.useFakeTimers();
      const config = makeModelConfig();
      const mockedCreateChatClient = vi.mocked(createChatClient);
      mockedCreateChatClient.mockImplementation(() => {
        const client = createMockChatClient();
        client.sendMessage.mockImplementation(
          async (
            _message: string,
            _images: string[] | undefined,
            options: { signal: AbortSignal }
          ) =>
            new Promise<void>((_resolve, reject) => {
              options.signal.addEventListener('abort', () => {
                const abortError = new Error('Aborted');
                abortError.name = 'AbortError';
                reject(abortError);
              });
            })
        );
        return asChatClientFactory(client);
      });

      const promise = generateTitle('Test message', config);

      await vi.advanceTimersByTimeAsync(30001);

      await expect(promise).resolves.toBe('Test message');
    });
  });
});

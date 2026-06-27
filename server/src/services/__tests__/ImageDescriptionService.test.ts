import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  describeImageToText,
  imageMimeType,
  isImageFileName
} from '../ImageDescriptionService';
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
  model: 'gpt-4o',
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

describe('ImageDescriptionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isImageFileName', () => {
    it('should return true for supported image extensions', () => {
      expect(isImageFileName('sample.PNG')).toBe(true);
      expect(isImageFileName('sample.jpeg')).toBe(true);
      expect(isImageFileName('sample.webp')).toBe(true);
      expect(isImageFileName('sample.svg')).toBe(true);
    });

    it('should return false for unsupported extensions', () => {
      expect(isImageFileName('sample.txt')).toBe(false);
      expect(isImageFileName('sample')).toBe(false);
    });
  });

  describe('imageMimeType', () => {
    it('should return MIME type for supported image extensions', () => {
      expect(imageMimeType('sample.jpg')).toBe('image/jpeg');
      expect(imageMimeType('sample.SVG')).toBe('image/svg+xml');
    });

    it('should default to image/png for unknown extensions', () => {
      expect(imageMimeType('sample.bin')).toBe('image/png');
    });
  });

  describe('describeImageToText', () => {
    it('should return fallback when no model config is provided', async () => {
      const result = await describeImageToText(
        Buffer.from('image-bytes'),
        'image/png',
        null
      );

      expect(result.ok).toBe(false);
      expect(result.text).toContain('could NOT be read as text');
      expect(createChatClient).not.toHaveBeenCalled();
    });

    it('should describe image via LLM when model config is provided', async () => {
      const config = makeModelConfig();
      const bytes = Buffer.from('image-bytes');
      const mockedCreateChatClient = vi.mocked(createChatClient);
      mockedCreateChatClient.mockImplementation(() => {
        const client = createMockChatClient();
        client.sendMessage.mockImplementation(async () => {
          const handler = client.setMessageHandler.mock.calls[0]?.[0] as
            | ((chunk: string) => void)
            | undefined;
          handler?.('A dashboard ');
          handler?.('screenshot');
        });
        return asChatClientFactory(client);
      });

      const result = await describeImageToText(bytes, 'image/png', config);

      expect(result).toEqual({
        text: 'A dashboard screenshot',
        ok: true
      });
      const client = mockedCreateChatClient.mock.results[0]
        ?.value as MockChatClient;
      expect(client.sendMessage).toHaveBeenCalledWith(
        'Describe this image in detail as plain text.',
        [`data:image/png;base64,${bytes.toString('base64')}`],
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('should return fallback when LLM returns empty response', async () => {
      const config = makeModelConfig();
      const mockedCreateChatClient = vi.mocked(createChatClient);
      mockedCreateChatClient.mockImplementation(() => {
        const client = createMockChatClient();
        client.sendMessage.mockResolvedValue(undefined);
        return asChatClientFactory(client);
      });

      const result = await describeImageToText(
        Buffer.from('image-bytes'),
        'image/png',
        config
      );

      expect(result.ok).toBe(false);
      expect(result.text).toContain('could NOT be read as text');
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
          handler?.('Partial description');
          const abortError = new Error('Aborted');
          abortError.name = 'AbortError';
          throw abortError;
        });
        return asChatClientFactory(client);
      });

      const result = await describeImageToText(
        Buffer.from('image-bytes'),
        'image/png',
        config
      );

      expect(result).toEqual({
        text: 'Partial description',
        ok: true
      });
    });

    it('should fall back when sendMessage throws a non-AbortError', async () => {
      const config = makeModelConfig();
      const mockedCreateChatClient = vi.mocked(createChatClient);
      mockedCreateChatClient.mockImplementation(() => {
        const client = createMockChatClient();
        client.sendMessage.mockRejectedValue(new Error('Network error'));
        return asChatClientFactory(client);
      });

      const result = await describeImageToText(
        Buffer.from('image-bytes'),
        'image/png',
        config
      );

      expect(result.ok).toBe(false);
      expect(result.text).toContain('could NOT be read as text');
    });
  });
});

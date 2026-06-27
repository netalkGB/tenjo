import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MessageService,
  MessageNotFoundError,
  MessageValidationError
} from '../MessageService';
import type { StreamWriter } from '../MessageService';
import type {
  MessageRepository,
  Message
} from '../../repositories/MessageRepository';
import type { ThreadRepository } from '../../repositories/ThreadRepository';
import type { ToolApprovalRuleRepository } from '../../repositories/ToolApprovalRuleRepository';
import type { FileUploadService } from '../FileUploadService';
import type { ModelConfig } from '../../repositories/GlobalSettingRepository';
import type {
  ChatClient,
  McpClientManager,
  MessageRequest
} from 'tenjo-chat-engine';
import type { ProcessMessageStreamParams } from '../MessageService';

// ToolCallResponse is not exported from the package root, define locally
interface ToolCallResponse {
  type: string;
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

// --- Mock external modules ---

vi.mock('../../logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('../../events/ToolApprovalEmitter', () => ({
  toolApprovalEmitter: {
    waitForApproval: vi.fn(),
    cancelApproval: vi.fn()
  }
}));

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn()
  }
}));

vi.mock('../../utils/env', () => ({
  getDataDir: vi.fn(() => '/tmp/test-data')
}));

import { toolApprovalEmitter } from '../../events/ToolApprovalEmitter';
import fs from 'node:fs/promises';

const mockChatClient = {
  setSystemPrompt: vi.fn(),
  setThinkingHandler: vi.fn(),
  setMessageHandler: vi.fn(),
  sendMessage: vi.fn()
};

vi.mock('../../factories/chatClientFactory', () => ({
  createChatClient: vi.fn(() => mockChatClient)
}));

import { createChatClient } from '../../factories/chatClientFactory';

// --- Mock factories ---

const createMockMessageRepo = () => ({
  findById: vi.fn(),
  findByIdAndUser: vi.fn(),
  findPath: vi.fn(),
  getBranchStatus: vi.fn(),
  switchBranch: vi.fn(),
  addMessage: vi.fn()
});

const createMockThreadRepo = () => ({
  update: vi.fn()
});

const createMockToolApprovalRuleRepo = () => ({
  shouldAutoApprove: vi.fn()
});

// --- Test data helpers ---

const makeMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 'msg-1',
  thread_id: 'thread-1',
  parent_message_id: null,
  selected_child_id: null,
  data: { role: 'user', content: 'Hello' },
  source: 'user',
  model: null,
  provider: null,
  created_by: 'user-1',
  updated_by: 'user-1',
  created_at: new Date('2025-01-01'),
  updated_at: new Date('2025-01-01'),
  ...overrides
});

const makeModelConfig = (
  overrides: Partial<ModelConfig> = {}
): ModelConfig => ({
  type: 'openai',
  baseUrl: 'http://localhost:1234',
  model: 'gpt-4',
  token: 'test-token',
  ...overrides
});

// Helper to build a mock title-generation client with a typed return
type TitleMockClient = {
  setSystemPrompt: ReturnType<typeof vi.fn>;
  setThinkingHandler: ReturnType<typeof vi.fn>;
  setMessageHandler: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
};

const createMockTitleClient = (): TitleMockClient => ({
  setSystemPrompt: vi.fn(),
  setThinkingHandler: vi.fn(),
  setMessageHandler: vi.fn(),
  sendMessage: vi.fn()
});

// Returns a TitleMockClient cast as the factory return type (single cast location)
const asChatClientFactory = (
  client: TitleMockClient
): ReturnType<typeof createChatClient> =>
  client as unknown as ReturnType<typeof createChatClient>;

const createMockFileUploadService = () => ({
  save: vi.fn(),
  read: vi.fn().mockResolvedValue(Buffer.from('file-data')),
  readText: vi.fn(),
  delete: vi.fn(),
  getPath: vi.fn()
});

describe('MessageService', () => {
  let service: MessageService;
  let messageRepo: ReturnType<typeof createMockMessageRepo>;
  let threadRepo: ReturnType<typeof createMockThreadRepo>;
  let toolApprovalRuleRepo: ReturnType<typeof createMockToolApprovalRuleRepo>;
  let fileUploadServiceMock: ReturnType<typeof createMockFileUploadService>;

  beforeEach(() => {
    vi.clearAllMocks();
    messageRepo = createMockMessageRepo();
    threadRepo = createMockThreadRepo();
    toolApprovalRuleRepo = createMockToolApprovalRuleRepo();
    fileUploadServiceMock = createMockFileUploadService();
    service = new MessageService(
      messageRepo as unknown as MessageRepository,
      threadRepo as unknown as ThreadRepository,
      toolApprovalRuleRepo as unknown as ToolApprovalRuleRepository,
      fileUploadServiceMock as unknown as FileUploadService
    );
  });

  // --- verifyMessageExists ---

  describe('verifyMessageExists', () => {
    it('should return the message when it exists', async () => {
      const message = makeMessage();
      messageRepo.findById.mockResolvedValue(message);

      const result = await service.verifyMessageExists('msg-1');

      expect(result).toBe(message);
      expect(messageRepo.findById).toHaveBeenCalledWith('msg-1');
    });

    it('should throw MessageNotFoundError when message does not exist', async () => {
      messageRepo.findById.mockResolvedValue(undefined);

      await expect(service.verifyMessageExists('nonexistent')).rejects.toThrow(
        MessageNotFoundError
      );
    });
  });

  // --- getMessagesForThread ---

  describe('getMessagesForThread', () => {
    it('should return an empty array when leafMessageId is null', async () => {
      const result = await service.getMessagesForThread('thread-1', null);

      expect(result).toEqual([]);
      expect(messageRepo.findPath).not.toHaveBeenCalled();
    });

    it('should build message path from leaf and enrich with branch status', async () => {
      const msg1 = makeMessage({ id: 'msg-1', parent_message_id: null });
      const msg2 = makeMessage({
        id: 'msg-2',
        parent_message_id: 'msg-1',
        source: 'assistant',
        data: { role: 'assistant', content: 'Hi there' }
      });

      messageRepo.findPath.mockResolvedValue([msg1, msg2]);
      messageRepo.getBranchStatus
        .mockResolvedValueOnce({ current: 1, total: 1, siblings: ['msg-1'] })
        .mockResolvedValueOnce({
          current: 1,
          total: 2,
          siblings: ['msg-2', 'msg-3']
        });

      const result = await service.getMessagesForThread('thread-1', 'msg-2');

      expect(messageRepo.findPath).toHaveBeenCalledWith('msg-2');
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'msg-1',
        currentCount: 1,
        totalCount: 1
      });
      expect(result[1]).toMatchObject({
        id: 'msg-2',
        currentCount: 1,
        totalCount: 2
      });
    });

    it('should normalize legacy artifact URLs in returned messages', async () => {
      const msg = makeMessage({
        id: 'msg-1',
        thread_id: 'thread-1',
        data: {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: '/api/upload/artifacts/legacy-image.png'
              }
            }
          ]
        }
      });
      messageRepo.findPath.mockResolvedValue([msg]);
      messageRepo.getBranchStatus.mockResolvedValue(null);

      const result = await service.getMessagesForThread('thread-1', 'msg-1');

      expect(result[0]?.data).toEqual({
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: '/api/chat/threads/thread-1/artifacts/legacy-image.png'
            }
          }
        ]
      });
    });

    it('should handle messages with null branch status', async () => {
      const msg = makeMessage();
      messageRepo.findPath.mockResolvedValue([msg]);
      messageRepo.getBranchStatus.mockResolvedValue(null);

      const result = await service.getMessagesForThread('thread-1', 'msg-1');

      expect(result).toHaveLength(1);
      expect(result[0].currentCount).toBeNull();
      expect(result[0].totalCount).toBeNull();
    });
  });

  // --- getBranchStatuses ---

  describe('getBranchStatuses', () => {
    it('should return branch status info for each message', async () => {
      const msg1 = makeMessage({ id: 'msg-1', parent_message_id: 'parent-1' });
      const msg2 = makeMessage({ id: 'msg-2', parent_message_id: 'parent-1' });

      messageRepo.findByIdAndUser
        .mockResolvedValueOnce(msg1)
        .mockResolvedValueOnce(msg2);
      messageRepo.getBranchStatus
        .mockResolvedValueOnce({
          current: 1,
          total: 2,
          siblings: ['msg-1', 'msg-2']
        })
        .mockResolvedValueOnce({
          current: 2,
          total: 2,
          siblings: ['msg-1', 'msg-2']
        });

      const result = await service.getBranchStatuses('user-1', [
        'msg-1',
        'msg-2'
      ]);

      expect(result['msg-1']).toEqual({
        currentCount: 1,
        totalCount: 2,
        siblings: ['msg-1', 'msg-2']
      });
      expect(result['msg-2']).toEqual({
        currentCount: 2,
        totalCount: 2,
        siblings: ['msg-1', 'msg-2']
      });
    });

    it('should return an empty object for an empty array', async () => {
      const result = await service.getBranchStatuses('user-1', []);
      expect(result).toEqual({});
    });

    it('should skip messages that do not exist', async () => {
      messageRepo.findByIdAndUser.mockResolvedValue(undefined);

      const result = await service.getBranchStatuses('user-1', ['nonexistent']);

      expect(result).toEqual({});
    });

    it('should skip messages with null branch status', async () => {
      const msg = makeMessage({ id: 'msg-1' });
      messageRepo.findByIdAndUser.mockResolvedValue(msg);
      messageRepo.getBranchStatus.mockResolvedValue(null);

      const result = await service.getBranchStatuses('user-1', ['msg-1']);

      expect(result).toEqual({});
    });

    it('should skip messages outside the requested user', async () => {
      messageRepo.findByIdAndUser.mockResolvedValue(undefined);

      const result = await service.getBranchStatuses('user-1', ['msg-1']);

      expect(result).toEqual({});
      expect(messageRepo.getBranchStatus).not.toHaveBeenCalled();
    });
  });

  // --- switchBranch ---

  describe('switchBranch', () => {
    it('should switch branch and return new messages with leaf', async () => {
      const parentMsg = makeMessage({
        id: 'msg-1',
        parent_message_id: 'parent-1'
      });
      const targetMsg = makeMessage({
        id: 'msg-target',
        parent_message_id: 'parent-1'
      });
      const leafMsg = makeMessage({
        id: 'msg-leaf',
        parent_message_id: 'msg-target'
      });

      messageRepo.findByIdAndUser
        .mockResolvedValueOnce(parentMsg)
        .mockResolvedValueOnce(targetMsg);
      messageRepo.switchBranch.mockResolvedValue(undefined);
      messageRepo.findPath.mockResolvedValue([targetMsg, leafMsg]);
      messageRepo.getBranchStatus
        .mockResolvedValueOnce({
          current: 2,
          total: 2,
          siblings: ['msg-1', 'msg-target']
        })
        .mockResolvedValueOnce({
          current: 1,
          total: 1,
          siblings: ['msg-leaf']
        });

      const result = await service.switchBranch(
        'thread-1',
        'user-1',
        'msg-1',
        'msg-target'
      );

      expect(messageRepo.switchBranch).toHaveBeenCalledWith(
        'parent-1',
        'msg-target'
      );
      expect(threadRepo.update).toHaveBeenCalledWith('thread-1', {
        current_leaf_message_id: 'msg-leaf'
      });
      expect(result.leafMessageId).toBe('msg-leaf');
      expect(result.messages).toHaveLength(2);
    });

    it('should throw MessageNotFoundError when message does not exist', async () => {
      messageRepo.findByIdAndUser.mockResolvedValue(undefined);

      await expect(
        service.switchBranch('thread-1', 'user-1', 'nonexistent', 'target')
      ).rejects.toThrow(MessageNotFoundError);
    });

    it('should not call switchBranch when parent_message_id is null', async () => {
      const rootMsg = makeMessage({
        id: 'msg-root',
        parent_message_id: null
      });
      const targetMsg = makeMessage({ id: 'msg-target' });

      messageRepo.findByIdAndUser
        .mockResolvedValueOnce(rootMsg)
        .mockResolvedValueOnce(targetMsg);
      messageRepo.findPath.mockResolvedValue([targetMsg]);
      messageRepo.getBranchStatus.mockResolvedValue({
        current: 1,
        total: 1,
        siblings: ['msg-target']
      });

      await service.switchBranch(
        'thread-1',
        'user-1',
        'msg-root',
        'msg-target'
      );

      expect(messageRepo.switchBranch).not.toHaveBeenCalled();
    });

    it('should not update thread leaf when findPath returns empty', async () => {
      const msg = makeMessage({
        id: 'msg-1',
        parent_message_id: 'parent-1'
      });

      const targetMsg = makeMessage({ id: 'msg-target' });
      messageRepo.findByIdAndUser
        .mockResolvedValueOnce(msg)
        .mockResolvedValueOnce(targetMsg);
      messageRepo.switchBranch.mockResolvedValue(undefined);
      messageRepo.findPath.mockResolvedValue([]);

      const result = await service.switchBranch(
        'thread-1',
        'user-1',
        'msg-1',
        'msg-target'
      );

      expect(threadRepo.update).not.toHaveBeenCalled();
      expect(result.leafMessageId).toBeUndefined();
      expect(result.messages).toEqual([]);
    });

    it('should reject a target sibling outside the user', async () => {
      const msg = makeMessage({
        id: 'msg-1',
        parent_message_id: 'parent-1'
      });
      messageRepo.findByIdAndUser
        .mockResolvedValueOnce(msg)
        .mockResolvedValueOnce(undefined);

      await expect(
        service.switchBranch('thread-1', 'user-1', 'msg-1', 'msg-target')
      ).rejects.toThrow(MessageNotFoundError);
    });
  });

  // --- getContextMessages ---

  describe('getContextMessages', () => {
    it('should return filtered context messages without system role', async () => {
      const systemMsg = makeMessage({
        id: 'sys-1',
        data: { role: 'system', content: 'You are helpful' }
      });
      const userMsg = makeMessage({
        id: 'user-1',
        data: { role: 'user', content: 'Hello' }
      });
      const assistantMsg = makeMessage({
        id: 'asst-1',
        data: { role: 'assistant', content: 'Hi there' }
      });

      messageRepo.findPath.mockResolvedValue([
        systemMsg,
        userMsg,
        assistantMsg
      ]);
      messageRepo.findByIdAndUser.mockResolvedValue(assistantMsg);

      const result = await service.getContextMessages('user-1', 'asst-1');

      expect(messageRepo.findPath).toHaveBeenCalledWith('asst-1');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(result[1]).toEqual({ role: 'assistant', content: 'Hi there' });
    });

    it('should preserve images in messages for downstream processing', async () => {
      const userMsg = makeMessage({
        id: 'user-1',
        data: {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,...' }
            }
          ]
        }
      });

      messageRepo.findPath.mockResolvedValue([userMsg]);
      messageRepo.findByIdAndUser.mockResolvedValue(userMsg);

      const result = await service.getContextMessages('user-1', 'user-1');

      expect(result).toHaveLength(1);
      expect(result[0].content).toEqual([
        { type: 'text', text: 'Describe this' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,...' }
        }
      ]);
    });

    it('should filter out messages with null data', async () => {
      const msgWithData = makeMessage({
        id: 'msg-1',
        data: { role: 'user', content: 'Hello' }
      });
      const msgNoData = makeMessage({ id: 'msg-2', data: null });

      messageRepo.findPath.mockResolvedValue([msgWithData, msgNoData]);
      messageRepo.findByIdAndUser.mockResolvedValue(msgNoData);

      const result = await service.getContextMessages('user-1', 'msg-2');

      expect(result).toHaveLength(1);
    });

    it('should reject a context message outside the user', async () => {
      messageRepo.findByIdAndUser.mockResolvedValue(undefined);

      await expect(
        service.getContextMessages('user-1', 'msg-1')
      ).rejects.toThrow(MessageNotFoundError);
    });
  });

  // --- getUserPrompt ---

  describe('getUserPrompt', () => {
    it('should return the text content of the parent user message', async () => {
      const assistantMsg = makeMessage({
        id: 'asst-1',
        parent_message_id: 'user-1',
        source: 'assistant',
        data: { role: 'assistant', content: 'Response' }
      });
      const userMsg = makeMessage({
        id: 'user-1',
        data: { role: 'user', content: 'What is TypeScript?' }
      });

      messageRepo.findByIdAndUser.mockResolvedValueOnce(assistantMsg);
      messageRepo.findById.mockResolvedValueOnce(userMsg);

      const result = await service.getUserPrompt('user-1', 'asst-1');

      expect(result).toBe('What is TypeScript?');
    });

    it('should extract text from array content', async () => {
      const assistantMsg = makeMessage({
        id: 'asst-1',
        parent_message_id: 'user-1',
        source: 'assistant'
      });
      const userMsg = makeMessage({
        id: 'user-1',
        data: {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image' },
            { type: 'image_url', image_url: { url: 'data:...' } }
          ]
        }
      });

      messageRepo.findByIdAndUser.mockResolvedValueOnce(assistantMsg);
      messageRepo.findById.mockResolvedValueOnce(userMsg);

      const result = await service.getUserPrompt('user-1', 'asst-1');

      expect(result).toBe('Describe this image');
    });

    it('should throw MessageNotFoundError when assistant message does not exist', async () => {
      messageRepo.findByIdAndUser.mockResolvedValue(undefined);

      await expect(
        service.getUserPrompt('user-1', 'nonexistent')
      ).rejects.toThrow(MessageNotFoundError);
    });

    it('should throw MessageValidationError when assistant message has no parent', async () => {
      const assistantMsg = makeMessage({
        id: 'asst-1',
        parent_message_id: null
      });

      messageRepo.findByIdAndUser.mockResolvedValue(assistantMsg);

      await expect(service.getUserPrompt('user-1', 'asst-1')).rejects.toThrow(
        MessageValidationError
      );
    });

    it('should throw MessageNotFoundError when parent user message does not exist', async () => {
      const assistantMsg = makeMessage({
        id: 'asst-1',
        parent_message_id: 'user-1'
      });

      messageRepo.findByIdAndUser.mockResolvedValueOnce(assistantMsg);
      messageRepo.findById.mockResolvedValueOnce(undefined);

      await expect(service.getUserPrompt('user-1', 'asst-1')).rejects.toThrow(
        MessageNotFoundError
      );
    });

    it('should return empty string when user message content is null', async () => {
      const assistantMsg = makeMessage({
        id: 'asst-1',
        parent_message_id: 'user-1'
      });
      const userMsg = makeMessage({
        id: 'user-1',
        data: { role: 'user', content: null }
      });

      messageRepo.findByIdAndUser.mockResolvedValueOnce(assistantMsg);
      messageRepo.findById.mockResolvedValueOnce(userMsg);

      const result = await service.getUserPrompt('user-1', 'asst-1');

      expect(result).toBe('');
    });

    it('should return a parent prompt from another thread owned by the same user', async () => {
      const assistantMsg = makeMessage({
        id: 'asst-1',
        parent_message_id: 'user-1'
      });
      const userMsg = makeMessage({
        id: 'user-1',
        thread_id: 'thread-2',
        data: { role: 'user', content: 'Other thread' }
      });

      messageRepo.findByIdAndUser.mockResolvedValueOnce(assistantMsg);
      messageRepo.findById.mockResolvedValueOnce(userMsg);

      await expect(service.getUserPrompt('user-1', 'asst-1')).resolves.toBe(
        'Other thread'
      );
    });
  });

  // --- generateTitle ---

  describe('generateTitle', () => {
    it('should generate title via LLM when model config is provided', async () => {
      const config = makeModelConfig();

      // Simulate the message handler collecting a title
      const mockedCreateChatClient = vi.mocked(createChatClient);
      mockedCreateChatClient.mockImplementation(() => {
        const client = createMockTitleClient();
        // When sendMessage is called, invoke the message handler with the title
        client.sendMessage.mockImplementation(async () => {
          const handler = client.setMessageHandler.mock.calls[0][0] as (
            chunk: string
          ) => void;
          handler('Generated Title');
        });
        return asChatClientFactory(client);
      });

      const result = await service.generateTitle(
        'Some long user message',
        config
      );

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

    it('should return fallback title when no model config', async () => {
      const result = await service.generateTitle('A short message', null);

      expect(result).toBe('A short message');
    });

    it('should truncate fallback title to 30 chars with ellipsis', async () => {
      const longMessage =
        'This is a very long message that should be truncated in fallback mode';

      const result = await service.generateTitle(longMessage, null);

      expect(result).toBe('This is a very long message th...');
      expect(result).toHaveLength(33);
    });

    it('should fall back gracefully when LLM throws an error', async () => {
      const config = makeModelConfig();
      const mockedCreateChatClient = vi.mocked(createChatClient);
      mockedCreateChatClient.mockImplementation(() => {
        throw new Error('Connection refused');
      });

      const result = await service.generateTitle('Test message', config);

      expect(result).toBe('Test message');
    });

    it('should fall back when LLM returns empty response', async () => {
      const config = makeModelConfig();
      const mockedCreateChatClient = vi.mocked(createChatClient);
      mockedCreateChatClient.mockImplementation(() => {
        const client = createMockTitleClient();
        client.sendMessage.mockResolvedValue(undefined);
        return asChatClientFactory(client);
      });

      const result = await service.generateTitle('Fallback message', config);

      // Empty collected string -> fallback
      expect(result).toBe('Fallback message');
    });

    it('should truncate LLM-generated title to 150 chars', async () => {
      const config = makeModelConfig();
      const longTitle = 'A'.repeat(200);
      const mockedCreateChatClient = vi.mocked(createChatClient);
      mockedCreateChatClient.mockImplementation(() => {
        const client = createMockTitleClient();
        client.sendMessage.mockImplementation(async () => {
          const handler = client.setMessageHandler.mock.calls[0][0] as (
            chunk: string
          ) => void;
          handler(longTitle);
        });
        return asChatClientFactory(client);
      });

      const result = await service.generateTitle('Message', config);

      // The abort controller aborts at 50 chars, but the mock pushes the full string.
      // The service slices to 150.
      expect(result).toHaveLength(150);
    });

    it('should abort via timeout when sendMessage takes too long', async () => {
      vi.useFakeTimers();
      const config = makeModelConfig();
      const mockedCreateChatClient = vi.mocked(createChatClient);
      mockedCreateChatClient.mockImplementation(() => {
        const client = createMockTitleClient();
        // sendMessage returns a promise that never resolves on its own,
        // but respects the abort signal
        client.sendMessage.mockImplementation(
          async (
            _msg: unknown,
            _images: unknown,
            options: { signal: AbortSignal }
          ) => {
            return new Promise<void>((_resolve, reject) => {
              options.signal.addEventListener('abort', () => {
                const abortError = new Error('Aborted');
                abortError.name = 'AbortError';
                reject(abortError);
              });
            });
          }
        );
        return asChatClientFactory(client);
      });

      const promise = service.generateTitle('Test message', config);

      // Advance past the 30s timeout to trigger the setTimeout callback
      await vi.advanceTimersByTimeAsync(30001);

      const result = await promise;

      // No text was collected, so it falls back
      expect(result).toBe('Test message');
      vi.useRealTimers();
    });

    it('should fall back when sendMessage throws a non-AbortError', async () => {
      const config = makeModelConfig();
      const mockedCreateChatClient = vi.mocked(createChatClient);
      mockedCreateChatClient.mockImplementation(() => {
        const client = createMockTitleClient();
        // sendMessage throws a regular Error (not AbortError)
        client.sendMessage.mockRejectedValue(new Error('Network error'));
        return asChatClientFactory(client);
      });

      const result = await service.generateTitle('Test message', config);

      // The inner throw re-throws to the outer catch, which falls back
      expect(result).toBe('Test message');
    });

    it('should handle AbortError from sendMessage without throwing', async () => {
      const config = makeModelConfig();
      const mockedCreateChatClient = vi.mocked(createChatClient);
      mockedCreateChatClient.mockImplementation(() => {
        const client = createMockTitleClient();
        client.sendMessage.mockImplementation(async () => {
          // Simulate collecting some text then aborting
          const handler = client.setMessageHandler.mock.calls[0][0] as (
            chunk: string
          ) => void;
          handler('Partial');
          const abortError = new Error('Aborted');
          abortError.name = 'AbortError';
          throw abortError;
        });
        return asChatClientFactory(client);
      });

      const result = await service.generateTitle('Message', config);

      expect(result).toBe('Partial');
    });
  });

  // --- processMessageStream ---

  describe('processMessageStream', () => {
    // Helper to create a mock ChatClient for streaming tests
    const createMockChatClientForStream = () => {
      let messageAddedCb:
        | ((msg: MessageRequest, all: MessageRequest[]) => void)
        | undefined;

      const client = {
        onMessageAdded: vi.fn(
          (cb: (msg: MessageRequest, all: MessageRequest[]) => void) => {
            messageAddedCb = cb;
          }
        ),
        setMessageHandler: vi.fn(),
        setThinkingHandler: vi.fn(),
        setReasoningHandler: vi.fn(),
        setToolCallStreamHandler: vi.fn(),
        sendMessage: vi.fn(),
        getToolCallPlan: vi.fn().mockReturnValue(null),
        addToolCallResult: vi.fn(),
        validateToolCallResult: vi.fn()
      };

      const triggerMessageAdded = (msg: MessageRequest) => {
        if (messageAddedCb) messageAddedCb(msg, []);
      };

      return { client, triggerMessageAdded };
    };

    const createMockWriter = () => {
      let closeCb: (() => void) | undefined;
      const writer: {
        write: ReturnType<typeof vi.fn>;
        onClose: ReturnType<typeof vi.fn>;
        triggerClose: () => void;
      } = {
        write: vi.fn(),
        onClose: vi.fn((cb: () => void) => {
          closeCb = cb;
        }),
        triggerClose: () => {
          if (closeCb) closeCb();
        }
      };
      return writer;
    };

    const createMockMcpClientManager = () => ({
      callTool: vi.fn()
    });

    let savedMessageCounter: number;

    const setupAddMessage = () => {
      savedMessageCounter = 0;
      messageRepo.findByIdAndUser.mockResolvedValue(
        makeMessage({ id: 'parent-1', thread_id: 'thread-1' })
      );
      messageRepo.addMessage.mockImplementation(async () => {
        savedMessageCounter++;
        return {
          id: `saved-msg-${savedMessageCounter}`,
          thread_id: 'thread-1',
          parent_message_id: null,
          selected_child_id: null,
          data: { role: 'user', content: '' },
          source: 'user',
          model: null,
          provider: null,
          created_by: 'user-1',
          updated_by: 'user-1',
          created_at: new Date(),
          updated_at: new Date()
        } satisfies Message;
      });
      threadRepo.update.mockResolvedValue(undefined);
    };

    // Centralizes the `as unknown as` casts for processMessageStream params
    const makeStreamParams = (
      overrides: {
        client?: ReturnType<typeof createMockChatClientForStream>['client'];
        writer?: ReturnType<typeof createMockWriter>;
        mcpManager?: ReturnType<typeof createMockMcpClientManager>;
      } & Partial<
        Pick<
          ProcessMessageStreamParams,
          | 'threadId'
          | 'message'
          | 'imageUrls'
          | 'parentMessageId'
          | 'userId'
          | 'modelConfig'
          | 'localToolHandlers'
        >
      > = {}
    ): ProcessMessageStreamParams => ({
      threadId: overrides.threadId ?? 'thread-1',
      message: overrides.message ?? 'Hello',
      parentMessageId:
        'parentMessageId' in overrides ? overrides.parentMessageId : 'parent-1',
      userId: overrides.userId ?? 'user-1',
      mcpClientManager: (overrides.mcpManager ??
        createMockMcpClientManager()) as unknown as McpClientManager,
      chatClient: (overrides.client ??
        createMockChatClientForStream().client) as unknown as ChatClient,
      writer: (overrides.writer ??
        createMockWriter()) as unknown as StreamWriter,
      modelConfig: overrides.modelConfig ?? makeModelConfig(),
      abortSignal: new AbortController().signal,
      ...('imageUrls' in overrides ? { imageUrls: overrides.imageUrls } : {}),
      ...('localToolHandlers' in overrides
        ? { localToolHandlers: overrides.localToolHandlers }
        : {})
    });

    it('should send message and save user+assistant messages via onMessageAdded', async () => {
      setupAddMessage();
      const { client, triggerMessageAdded } = createMockChatClientForStream();
      const writer = createMockWriter();
      messageRepo.findByIdAndUser.mockResolvedValue(
        makeMessage({ id: 'parent-1', thread_id: 'thread-1' })
      );

      // When sendMessage is called, simulate context added callbacks
      client.sendMessage.mockImplementation(async () => {
        triggerMessageAdded({
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }]
        });
        triggerMessageAdded({ role: 'assistant', content: 'Hi there' });
      });

      const result = await service.processMessageStream(
        makeStreamParams({ client, writer })
      );

      // Two messages saved (user + assistant)
      expect(messageRepo.addMessage).toHaveBeenCalledTimes(2);
      expect(result.userMessageId).toBe('saved-msg-1');
      expect(result.assistantMessageId).toBe('saved-msg-2');
      // Thread updated for each saved message
      expect(threadRepo.update).toHaveBeenCalledTimes(2);
    });

    it('should resolve local image URLs to data URIs and restore originals when saving', async () => {
      setupAddMessage();
      const { client, triggerMessageAdded } = createMockChatClientForStream();
      const writer = createMockWriter();
      const mockReadFile = vi.mocked(fs.readFile);
      mockReadFile.mockResolvedValue(Buffer.from('fake-image-data'));

      const imageUrl = '/api/chat/threads/thread-1/artifacts/test-image.png';

      client.sendMessage.mockImplementation(
        async (_msg: unknown, imageUrls: string[] | undefined) => {
          // The image URL should have been resolved to a data URI
          expect(imageUrls).toBeDefined();
          expect(imageUrls![0]).toMatch(/^data:image\/png;base64,/);

          // Simulate saving user message with the data URI content
          triggerMessageAdded({
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this' },
              { type: 'image_url', image_url: { url: imageUrls![0] } }
            ]
          });
          triggerMessageAdded({ role: 'assistant', content: 'A nice image' });
        }
      );

      await service.processMessageStream(
        makeStreamParams({
          client,
          writer,
          message: 'Describe this',
          imageUrls: [imageUrl],
          parentMessageId: null
        })
      );

      // The saved user message should have the original URL, not the data URI
      const savedUserMessage = messageRepo.addMessage.mock.calls[0][0] as {
        data: MessageRequest;
      };
      const content = savedUserMessage.data.content;
      expect(Array.isArray(content)).toBe(true);
      const imageContent = (
        content as Array<{
          type: string;
          image_url?: { url: string };
        }>
      ).find((c) => c.type === 'image_url');
      expect(imageContent?.image_url?.url).toBe(imageUrl);
    });

    it('should pass external image URLs through without resolution', async () => {
      setupAddMessage();
      const { client, triggerMessageAdded } = createMockChatClientForStream();
      const writer = createMockWriter();

      const externalUrl = 'https://example.com/image.png';

      client.sendMessage.mockImplementation(
        async (_msg: unknown, imageUrls: string[] | undefined) => {
          // External URL should be passed through as-is
          expect(imageUrls).toBeDefined();
          expect(imageUrls![0]).toBe(externalUrl);
          triggerMessageAdded({ role: 'user', content: 'Hello' });
          triggerMessageAdded({ role: 'assistant', content: 'Hi' });
        }
      );

      await service.processMessageStream(
        makeStreamParams({
          client,
          writer,
          imageUrls: [externalUrl],
          parentMessageId: null
        })
      );

      expect(messageRepo.addMessage).toHaveBeenCalledTimes(2);
    });

    it('should fall back to original URL when file read fails during image resolution', async () => {
      setupAddMessage();
      const { client, triggerMessageAdded } = createMockChatClientForStream();
      const writer = createMockWriter();
      fileUploadServiceMock.read.mockRejectedValue(
        new Error('ENOENT: no such file')
      );

      const imageUrl = '/api/chat/threads/thread-1/artifacts/missing-image.png';

      client.sendMessage.mockImplementation(
        async (_msg: unknown, imageUrls: string[] | undefined) => {
          // Should fall back to original URL when file read fails
          expect(imageUrls).toBeDefined();
          expect(imageUrls![0]).toBe(imageUrl);
          triggerMessageAdded({ role: 'user', content: 'Hello' });
          triggerMessageAdded({ role: 'assistant', content: 'Hi' });
        }
      );

      await service.processMessageStream(
        makeStreamParams({
          client,
          writer,
          imageUrls: [imageUrl],
          parentMessageId: null
        })
      );

      expect(fileUploadServiceMock.read).toHaveBeenCalled();
      expect(messageRepo.addMessage).toHaveBeenCalledTimes(2);
    });

    it('should handle auto-approved tool calls', async () => {
      setupAddMessage();
      const { client, triggerMessageAdded } = createMockChatClientForStream();
      const writer = createMockWriter();
      const mcpManager = createMockMcpClientManager();

      const toolCallPlan: ToolCallResponse[] = [
        {
          type: 'function',
          id: 'tc-1',
          function: { name: 'test_tool', arguments: '{"key":"value"}' }
        }
      ];

      // First call returns tool plan, second returns null (done)
      client.getToolCallPlan
        .mockReturnValueOnce(toolCallPlan)
        .mockReturnValueOnce(null);

      toolApprovalRuleRepo.shouldAutoApprove.mockResolvedValue(true);
      mcpManager.callTool.mockResolvedValue({ result: 'tool output' });
      client.validateToolCallResult.mockResolvedValue(undefined);

      client.sendMessage.mockImplementation(async () => {
        triggerMessageAdded({
          role: 'user',
          content: [{ type: 'text', text: 'Use the tool' }]
        });
      });

      await service.processMessageStream(
        makeStreamParams({
          client,
          writer,
          mcpManager,
          message: 'Use the tool',
          parentMessageId: null
        })
      );

      // Tool was called
      expect(mcpManager.callTool).toHaveBeenCalledWith('test_tool', {
        key: 'value'
      });
      // Result was added to the client
      expect(client.addToolCallResult).toHaveBeenCalledWith('tc-1', {
        result: 'tool output'
      });
      // Writer received the tool call events
      const writtenData = (writer.write.mock.calls as [string][]).map(
        (c) => JSON.parse(c[0].replace('data: ', '')) as unknown
      );
      const toolCallEvents = writtenData.filter(
        (d: unknown) => typeof d === 'object' && d !== null && 'toolCall' in d
      );
      expect(toolCallEvents.length).toBeGreaterThanOrEqual(2); // calling + result
    });

    it('should wait for manual approval and execute when approved', async () => {
      setupAddMessage();
      const { client, triggerMessageAdded } = createMockChatClientForStream();
      const writer = createMockWriter();
      const mcpManager = createMockMcpClientManager();

      const toolCallPlan: ToolCallResponse[] = [
        {
          type: 'function',
          id: 'tc-manual-1',
          function: { name: 'risky_tool', arguments: '{}' }
        }
      ];

      client.getToolCallPlan
        .mockReturnValueOnce(toolCallPlan)
        .mockReturnValueOnce(null);

      toolApprovalRuleRepo.shouldAutoApprove.mockResolvedValue(false);
      vi.mocked(toolApprovalEmitter.waitForApproval).mockResolvedValue(true);
      mcpManager.callTool.mockResolvedValue({ data: 'approved result' });
      client.validateToolCallResult.mockResolvedValue(undefined);

      client.sendMessage.mockImplementation(async () => {
        triggerMessageAdded({
          role: 'user',
          content: [{ type: 'text', text: 'Do risky thing' }]
        });
      });

      await service.processMessageStream(
        makeStreamParams({
          client,
          writer,
          mcpManager,
          message: 'Do risky thing',
          parentMessageId: null
        })
      );

      // Approval was requested
      expect(toolApprovalEmitter.waitForApproval).toHaveBeenCalledWith(
        'tc-manual-1'
      );
      // Tool was executed after approval
      expect(mcpManager.callTool).toHaveBeenCalledWith('risky_tool', {});
      // Writer got approval_request event
      const writtenData = (writer.write.mock.calls as [string][]).map(
        (c) => JSON.parse(c[0].replace('data: ', '')) as unknown
      );
      const approvalRequests = writtenData.filter(
        (d: unknown) =>
          typeof d === 'object' &&
          d !== null &&
          'toolCall' in d &&
          (d as { toolCall: { type: string } }).toolCall.type ===
            'approval_request'
      );
      expect(approvalRequests).toHaveLength(1);
    });

    it('should cancel remaining tools when manual approval is rejected', async () => {
      setupAddMessage();
      const { client, triggerMessageAdded } = createMockChatClientForStream();
      const writer = createMockWriter();
      const mcpManager = createMockMcpClientManager();

      const toolCallPlan: ToolCallResponse[] = [
        {
          type: 'function',
          id: 'tc-reject-1',
          function: { name: 'tool_a', arguments: '{}' }
        },
        {
          type: 'function',
          id: 'tc-reject-2',
          function: { name: 'tool_b', arguments: '{}' }
        }
      ];

      client.getToolCallPlan.mockReturnValueOnce(toolCallPlan);

      toolApprovalRuleRepo.shouldAutoApprove.mockResolvedValue(false);
      // First tool is rejected
      vi.mocked(toolApprovalEmitter.waitForApproval).mockResolvedValue(false);

      client.sendMessage.mockImplementation(async () => {
        triggerMessageAdded({
          role: 'user',
          content: [{ type: 'text', text: 'Do stuff' }]
        });
      });

      await service.processMessageStream(
        makeStreamParams({
          client,
          writer,
          mcpManager,
          message: 'Do stuff',
          parentMessageId: null
        })
      );

      // No tool was actually called
      expect(mcpManager.callTool).not.toHaveBeenCalled();
      // Both tools got rejection/cancellation results
      expect(client.addToolCallResult).toHaveBeenCalledWith('tc-reject-1', {
        error: 'Tool execution rejected by user'
      });
      expect(client.addToolCallResult).toHaveBeenCalledWith('tc-reject-2', {
        error: 'Tool execution cancelled because a prior tool was rejected'
      });
      // Writer received result events for both
      const writtenData = (writer.write.mock.calls as [string][]).map(
        (c) => JSON.parse(c[0].replace('data: ', '')) as unknown
      );
      const resultEvents = writtenData.filter(
        (d: unknown) =>
          typeof d === 'object' &&
          d !== null &&
          'toolCall' in d &&
          (d as { toolCall: { type: string } }).toolCall.type === 'result'
      );
      expect(resultEvents).toHaveLength(2);
    });

    it('should handle AbortError by waiting for pending saves and returning partial result', async () => {
      setupAddMessage();
      const { client, triggerMessageAdded } = createMockChatClientForStream();
      const writer = createMockWriter();

      client.sendMessage.mockImplementation(async () => {
        // Simulate saving user message before abort
        triggerMessageAdded({
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }]
        });
        const abortError = new Error('Aborted');
        abortError.name = 'AbortError';
        throw abortError;
      });

      const result = await service.processMessageStream(
        makeStreamParams({ client, writer, parentMessageId: null })
      );

      // User message was saved, assistant was not
      expect(result.userMessageId).toBe('saved-msg-1');
      expect(result.assistantMessageId).toBeUndefined();
      // DB save completed
      expect(messageRepo.addMessage).toHaveBeenCalledTimes(1);
    });

    it('should handle tool execution errors gracefully', async () => {
      setupAddMessage();
      const { client, triggerMessageAdded } = createMockChatClientForStream();
      const writer = createMockWriter();
      const mcpManager = createMockMcpClientManager();

      const toolCallPlan: ToolCallResponse[] = [
        {
          type: 'function',
          id: 'tc-err-1',
          function: { name: 'failing_tool', arguments: '{}' }
        }
      ];

      client.getToolCallPlan
        .mockReturnValueOnce(toolCallPlan)
        .mockReturnValueOnce(null);

      toolApprovalRuleRepo.shouldAutoApprove.mockResolvedValue(true);
      mcpManager.callTool.mockRejectedValue(new Error('Connection refused'));
      client.validateToolCallResult.mockResolvedValue(undefined);

      client.sendMessage.mockImplementation(async () => {
        triggerMessageAdded({
          role: 'user',
          content: [{ type: 'text', text: 'Use broken tool' }]
        });
      });

      await service.processMessageStream(
        makeStreamParams({
          client,
          writer,
          mcpManager,
          message: 'Use broken tool',
          parentMessageId: null
        })
      );

      // Error result was sent to chat client
      expect(client.addToolCallResult).toHaveBeenCalledWith('tc-err-1', {
        error: 'Connection refused'
      });
      // Writer received error result
      const writtenData = (writer.write.mock.calls as [string][]).map(
        (c) => JSON.parse(c[0].replace('data: ', '')) as unknown
      );
      const errorResults = writtenData.filter(
        (d: unknown) =>
          typeof d === 'object' &&
          d !== null &&
          'toolCall' in d &&
          (d as { toolCall: { type: string; success: boolean } }).toolCall
            .type === 'result' &&
          (d as { toolCall: { type: string; success: boolean } }).toolCall
            .success === false
      );
      expect(errorResults).toHaveLength(1);
    });

    it('should write chunk data via setMessageHandler callback', async () => {
      setupAddMessage();
      const { client, triggerMessageAdded } = createMockChatClientForStream();
      const writer = createMockWriter();

      // Capture and invoke the message handler during sendMessage
      client.sendMessage.mockImplementation(async () => {
        const messageHandler = client.setMessageHandler.mock.calls[0][0] as (
          chunk: string
        ) => void;
        messageHandler('Hello ');
        messageHandler('world');
        triggerMessageAdded({
          role: 'user',
          content: [{ type: 'text', text: 'Hi' }]
        });
        triggerMessageAdded({ role: 'assistant', content: 'Hello world' });
      });

      await service.processMessageStream(
        makeStreamParams({
          client,
          writer,
          message: 'Hi',
          parentMessageId: null
        })
      );

      const writeCalls = writer.write.mock.calls as [string][];
      const chunkWrites = writeCalls.filter((c) => c[0].includes('"chunk"'));
      expect(chunkWrites).toHaveLength(2);
      expect(chunkWrites[0][0]).toBe(
        `data: ${JSON.stringify({ chunk: 'Hello ' })}\n\n`
      );
      expect(chunkWrites[1][0]).toBe(
        `data: ${JSON.stringify({ chunk: 'world' })}\n\n`
      );
    });

    it('should write thinking data via setThinkingHandler callback', async () => {
      setupAddMessage();
      const { client, triggerMessageAdded } = createMockChatClientForStream();
      const writer = createMockWriter();

      client.sendMessage.mockImplementation(async () => {
        const thinkingHandler = client.setThinkingHandler.mock.calls[0][0] as (
          chunk: string
        ) => void;
        thinkingHandler('Let me think...');
        triggerMessageAdded({
          role: 'user',
          content: [{ type: 'text', text: 'Question' }]
        });
        triggerMessageAdded({ role: 'assistant', content: 'Answer' });
      });

      await service.processMessageStream(
        makeStreamParams({
          client,
          writer,
          message: 'Question',
          parentMessageId: null
        })
      );

      const writeCalls = writer.write.mock.calls as [string][];
      const thinkingWrites = writeCalls.filter((c) =>
        c[0].includes('"thinking"')
      );
      expect(thinkingWrites).toHaveLength(1);
      expect(thinkingWrites[0][0]).toBe(
        `data: ${JSON.stringify({ thinking: 'Let me think...' })}\n\n`
      );
    });

    it('should write reasoning data via setReasoningHandler callback', async () => {
      setupAddMessage();
      const { client, triggerMessageAdded } = createMockChatClientForStream();
      const writer = createMockWriter();

      client.sendMessage.mockImplementation(async () => {
        const reasoningHandler = client.setReasoningHandler.mock
          .calls[0][0] as (chunk: string) => void;
        reasoningHandler('Step 1: analyze');
        reasoningHandler('Step 2: conclude');
        triggerMessageAdded({
          role: 'user',
          content: [{ type: 'text', text: 'Reason about this' }]
        });
        triggerMessageAdded({ role: 'assistant', content: 'Result' });
      });

      await service.processMessageStream(
        makeStreamParams({
          client,
          writer,
          message: 'Reason about this',
          parentMessageId: null
        })
      );

      const writeCalls = writer.write.mock.calls as [string][];
      const reasoningWrites = writeCalls.filter((c) =>
        c[0].includes('"reasoning"')
      );
      expect(reasoningWrites).toHaveLength(2);
      expect(reasoningWrites[0][0]).toBe(
        `data: ${JSON.stringify({ reasoning: 'Step 1: analyze' })}\n\n`
      );
      expect(reasoningWrites[1][0]).toBe(
        `data: ${JSON.stringify({ reasoning: 'Step 2: conclude' })}\n\n`
      );
    });

    it('should cancel pending tool approvals when writer closes mid-approval', async () => {
      setupAddMessage();
      const { client, triggerMessageAdded } = createMockChatClientForStream();
      const writer = createMockWriter();
      const mcpManager = createMockMcpClientManager();

      const toolCallPlan: ToolCallResponse[] = [
        {
          type: 'function',
          id: 'tc-pending-1',
          function: { name: 'slow_tool', arguments: '{}' }
        }
      ];

      client.getToolCallPlan.mockReturnValueOnce(toolCallPlan);
      toolApprovalRuleRepo.shouldAutoApprove.mockResolvedValue(false);

      // waitForApproval will not resolve — simulate the writer closing during wait
      vi.mocked(toolApprovalEmitter.waitForApproval).mockImplementation(
        async () => {
          // Trigger the SSE close mid-approval
          writer.triggerClose();
          return false;
        }
      );

      client.sendMessage.mockImplementation(async () => {
        triggerMessageAdded({
          role: 'user',
          content: [{ type: 'text', text: 'Use slow tool' }]
        });
      });

      await service.processMessageStream(
        makeStreamParams({
          client,
          writer,
          mcpManager,
          message: 'Use slow tool',
          parentMessageId: null
        })
      );

      // cancelApproval should have been called for the pending tool call
      expect(toolApprovalEmitter.cancelApproval).toHaveBeenCalledWith(
        'tc-pending-1'
      );
    });

    it('should propagate non-AbortError from sendMessage', async () => {
      setupAddMessage();
      const { client } = createMockChatClientForStream();
      const writer = createMockWriter();

      client.sendMessage.mockRejectedValue(new Error('Internal server error'));

      await expect(
        service.processMessageStream(
          makeStreamParams({ client, writer, parentMessageId: null })
        )
      ).rejects.toThrow('Internal server error');
    });

    // --- localToolHandlers ---

    it('should dispatch local tools to the in-process handler instead of MCP', async () => {
      setupAddMessage();
      const { client, triggerMessageAdded } = createMockChatClientForStream();
      const writer = createMockWriter();
      const mcpManager = createMockMcpClientManager();

      const localHandler = vi.fn().mockResolvedValue({ stdout: '42\n' });
      const localToolHandlers = new Map<
        string,
        (args: Record<string, unknown>) => Promise<unknown>
      >([['tenjo_execute_code', localHandler]]);

      const toolCallPlan: ToolCallResponse[] = [
        {
          type: 'function',
          id: 'tc-local-1',
          function: {
            name: 'tenjo_execute_code',
            arguments: '{"code":"console.log(42)"}'
          }
        }
      ];

      client.getToolCallPlan
        .mockReturnValueOnce(toolCallPlan)
        .mockReturnValueOnce(null);
      client.validateToolCallResult.mockResolvedValue(undefined);

      client.sendMessage.mockImplementation(async () => {
        triggerMessageAdded({
          role: 'user',
          content: [{ type: 'text', text: 'compute' }]
        });
      });

      await service.processMessageStream(
        makeStreamParams({
          client,
          writer,
          mcpManager,
          localToolHandlers,
          parentMessageId: null
        })
      );

      expect(localHandler).toHaveBeenCalledWith({ code: 'console.log(42)' });
      expect(mcpManager.callTool).not.toHaveBeenCalled();
      expect(client.addToolCallResult).toHaveBeenCalledWith('tc-local-1', {
        stdout: '42\n'
      });
    });

    it('should bypass approval workflow for local tools', async () => {
      setupAddMessage();
      const { client, triggerMessageAdded } = createMockChatClientForStream();
      const writer = createMockWriter();
      const mcpManager = createMockMcpClientManager();

      const localHandler = vi.fn().mockResolvedValue({ stdout: 'ok' });
      const localToolHandlers = new Map<
        string,
        (args: Record<string, unknown>) => Promise<unknown>
      >([['tenjo_execute_code', localHandler]]);

      client.getToolCallPlan
        .mockReturnValueOnce([
          {
            type: 'function',
            id: 'tc-local-2',
            function: { name: 'tenjo_execute_code', arguments: '{}' }
          }
        ])
        .mockReturnValueOnce(null);
      client.validateToolCallResult.mockResolvedValue(undefined);

      client.sendMessage.mockImplementation(async () => {
        triggerMessageAdded({
          role: 'user',
          content: [{ type: 'text', text: 'run' }]
        });
      });

      await service.processMessageStream(
        makeStreamParams({
          client,
          writer,
          mcpManager,
          localToolHandlers,
          parentMessageId: null
        })
      );

      // Approval rule lookup must be skipped entirely for local tools so the
      // user-facing "auto-approve" rules can't accidentally gate them.
      expect(toolApprovalRuleRepo.shouldAutoApprove).not.toHaveBeenCalled();
      expect(toolApprovalEmitter.waitForApproval).not.toHaveBeenCalled();
      // The frontend should see a regular `calling` event (no approval_request).
      const writtenData = (writer.write.mock.calls as [string][]).map(
        (c) => JSON.parse(c[0].replace('data: ', '')) as unknown
      );
      const approvalRequests = writtenData.filter(
        (d: unknown) =>
          typeof d === 'object' &&
          d !== null &&
          'toolCall' in d &&
          (d as { toolCall: { type: string } }).toolCall.type ===
            'approval_request'
      );
      expect(approvalRequests).toHaveLength(0);
    });

    it('should still route non-local tool calls to MCP even when localToolHandlers is set', async () => {
      setupAddMessage();
      const { client, triggerMessageAdded } = createMockChatClientForStream();
      const writer = createMockWriter();
      const mcpManager = createMockMcpClientManager();

      const localHandler = vi.fn();
      const localToolHandlers = new Map<
        string,
        (args: Record<string, unknown>) => Promise<unknown>
      >([['tenjo_execute_code', localHandler]]);

      client.getToolCallPlan
        .mockReturnValueOnce([
          {
            type: 'function',
            id: 'tc-mcp-1',
            function: { name: 'mcp_search', arguments: '{"q":"hi"}' }
          }
        ])
        .mockReturnValueOnce(null);
      toolApprovalRuleRepo.shouldAutoApprove.mockResolvedValue(true);
      mcpManager.callTool.mockResolvedValue({ result: 'mcp output' });
      client.validateToolCallResult.mockResolvedValue(undefined);

      client.sendMessage.mockImplementation(async () => {
        triggerMessageAdded({
          role: 'user',
          content: [{ type: 'text', text: 'search' }]
        });
      });

      await service.processMessageStream(
        makeStreamParams({
          client,
          writer,
          mcpManager,
          localToolHandlers,
          parentMessageId: null
        })
      );

      expect(localHandler).not.toHaveBeenCalled();
      expect(mcpManager.callTool).toHaveBeenCalledWith('mcp_search', {
        q: 'hi'
      });
    });

    it('should surface local tool errors as a tool result event', async () => {
      setupAddMessage();
      const { client, triggerMessageAdded } = createMockChatClientForStream();
      const writer = createMockWriter();
      const mcpManager = createMockMcpClientManager();

      const localHandler = vi
        .fn()
        .mockRejectedValue(new Error('execution failed'));
      const localToolHandlers = new Map<
        string,
        (args: Record<string, unknown>) => Promise<unknown>
      >([['tenjo_execute_code', localHandler]]);

      client.getToolCallPlan
        .mockReturnValueOnce([
          {
            type: 'function',
            id: 'tc-local-err',
            function: { name: 'tenjo_execute_code', arguments: '{}' }
          }
        ])
        .mockReturnValueOnce(null);
      client.validateToolCallResult.mockResolvedValue(undefined);

      client.sendMessage.mockImplementation(async () => {
        triggerMessageAdded({
          role: 'user',
          content: [{ type: 'text', text: 'broken' }]
        });
      });

      await service.processMessageStream(
        makeStreamParams({
          client,
          writer,
          mcpManager,
          localToolHandlers,
          parentMessageId: null
        })
      );

      expect(client.addToolCallResult).toHaveBeenCalledWith('tc-local-err', {
        error: 'execution failed'
      });
    });

    // --- saveQueue serialization ---

    it('should serialize concurrent onMessageAdded saves so parent_message_id chains correctly', async () => {
      threadRepo.update.mockResolvedValue(undefined);
      messageRepo.findByIdAndUser.mockResolvedValue(
        makeMessage({ id: 'parent-1', thread_id: 'thread-1' })
      );

      // Track the order in which addMessage *resolves*. The user-message save
      // is intentionally slower than the assistant-message save would be,
      // so without serialization the assistant save would resolve first
      // and observe a stale `lastSavedMessageId`.
      const observedParentIds: (string | null)[] = [];
      let counter = 0;
      let userSaveResolve: ((id: string) => void) | undefined;
      messageRepo.addMessage.mockImplementation(
        async (input: { parent_message_id: string | null }) => {
          counter++;
          observedParentIds.push(input.parent_message_id);
          const id = `saved-msg-${counter}`;

          if (counter === 1) {
            // Block until the test releases this save.
            return await new Promise<{
              id: string;
              thread_id: string;
              parent_message_id: string | null;
              selected_child_id: null;
              data: MessageRequest;
              source: string;
              model: null;
              provider: null;
              created_by: string;
              updated_by: string;
              created_at: Date;
              updated_at: Date;
            }>((resolve) => {
              userSaveResolve = (savedId: string) =>
                resolve({
                  id: savedId,
                  thread_id: 'thread-1',
                  parent_message_id: null,
                  selected_child_id: null,
                  data: { role: 'user', content: '' },
                  source: 'user',
                  model: null,
                  provider: null,
                  created_by: 'user-1',
                  updated_by: 'user-1',
                  created_at: new Date(),
                  updated_at: new Date()
                });
            });
          }

          return {
            id,
            thread_id: 'thread-1',
            parent_message_id: input.parent_message_id,
            selected_child_id: null,
            data: { role: 'assistant', content: '' },
            source: 'assistant',
            model: null,
            provider: null,
            created_by: 'user-1',
            updated_by: 'user-1',
            created_at: new Date(),
            updated_at: new Date()
          } satisfies Message;
        }
      );

      const { client, triggerMessageAdded } = createMockChatClientForStream();
      const writer = createMockWriter();

      client.sendMessage.mockImplementation(async () => {
        // Fire two onMessageAdded events back-to-back. Without saveQueue
        // serialization, the second handler would see lastSavedMessageId =
        // null and write parent_message_id = null instead of the user's id.
        triggerMessageAdded({
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }]
        });
        triggerMessageAdded({ role: 'assistant', content: 'Hi' });

        // Let microtasks flush so the first addMessage actually runs and
        // captures userSaveResolve. Then release the queue.
        await new Promise<void>((resolve) => setImmediate(resolve));
        userSaveResolve?.('saved-msg-1');
      });

      const result = await service.processMessageStream(
        makeStreamParams({ client, writer, parentMessageId: 'parent-1' })
      );

      // Both saves ran; user first, then assistant chained behind it.
      expect(messageRepo.addMessage).toHaveBeenCalledTimes(2);
      // First save uses the seed parent_message_id from the request.
      expect(observedParentIds[0]).toBe('parent-1');
      // Critical: the assistant save must observe the user's saved id —
      // proving the queue waited for the slow user save to resolve before
      // running the assistant save (otherwise it would still be 'parent-1').
      expect(observedParentIds[1]).toBe('saved-msg-1');
      expect(result.userMessageId).toBe('saved-msg-1');
      expect(result.assistantMessageId).toBe('saved-msg-2');
    });

    it('should keep the saveQueue alive after a single failed save', async () => {
      threadRepo.update.mockResolvedValue(undefined);

      let counter = 0;
      messageRepo.addMessage.mockImplementation(async () => {
        counter++;
        if (counter === 1) {
          throw new Error('transient db error');
        }
        return {
          id: `saved-msg-${counter}`,
          thread_id: 'thread-1',
          parent_message_id: null,
          selected_child_id: null,
          data: { role: 'assistant', content: '' },
          source: 'assistant',
          model: null,
          provider: null,
          created_by: 'user-1',
          updated_by: 'user-1',
          created_at: new Date(),
          updated_at: new Date()
        } satisfies Message;
      });

      const { client, triggerMessageAdded } = createMockChatClientForStream();
      const writer = createMockWriter();

      client.sendMessage.mockImplementation(async () => {
        triggerMessageAdded({
          role: 'user',
          content: [{ type: 'text', text: 'first' }]
        });
        triggerMessageAdded({ role: 'assistant', content: 'second' });
      });

      // The first save rejects; processMessageStream awaits all queued saves
      // and surfaces the failure. We just want to confirm the second save
      // wasn't skipped — it should have been attempted before the rejection
      // bubbled up through Promise.all.
      await expect(
        service.processMessageStream(
          makeStreamParams({ client, writer, parentMessageId: null })
        )
      ).rejects.toThrow('transient db error');

      expect(messageRepo.addMessage).toHaveBeenCalledTimes(2);
    });
  });
});

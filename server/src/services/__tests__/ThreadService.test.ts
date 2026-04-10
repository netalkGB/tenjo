import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ThreadService,
  ThreadNotFoundError,
  ThreadValidationError,
  ThreadOperationError
} from '../ThreadService';
import type {
  ThreadRepository,
  Thread,
  PaginatedThreadsResult
} from '../../repositories/ThreadRepository';
import type { MessageRepository } from '../../repositories/MessageRepository';
import type { ImageAnalysisCacheRepository } from '../../repositories/ImageAnalysisCacheRepository';
import type { FileUploadService } from '../FileUploadService';

// --- Mock factories ---

const createMockThreadRepo = () => ({
  findByIdAndUser: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findPaginated: vi.fn(),
  findPinned: vi.fn(),
  pin: vi.fn()
});

const createMockMessageRepo = () => ({
  deleteByThreadId: vi.fn(),
  getImageFilenamesByThreadId: vi.fn()
});

const createMockFileUploadService = () => ({
  save: vi.fn(),
  read: vi.fn(),
  readText: vi.fn(),
  delete: vi.fn(),
  getPath: vi.fn()
});

const createMockImageAnalysisCacheRepo = () => ({
  deleteByThreadId: vi.fn()
});

const makeThread = (overrides: Partial<Thread> = {}): Thread => ({
  id: 'thread-1',
  title: 'Test Thread',
  current_leaf_message_id: null,
  pinned: false,
  created_by: 'user-1',
  updated_by: 'user-1',
  created_at: new Date('2025-01-01'),
  updated_at: new Date('2025-01-01'),
  generating_since: null,
  ...overrides
});

describe('ThreadService', () => {
  let service: ThreadService;
  let threadRepo: ReturnType<typeof createMockThreadRepo>;
  let messageRepo: ReturnType<typeof createMockMessageRepo>;
  let fileUploadServiceMock: ReturnType<typeof createMockFileUploadService>;
  let imageAnalysisCacheRepoMock: ReturnType<
    typeof createMockImageAnalysisCacheRepo
  >;

  beforeEach(() => {
    threadRepo = createMockThreadRepo();
    messageRepo = createMockMessageRepo();
    fileUploadServiceMock = createMockFileUploadService();
    imageAnalysisCacheRepoMock = createMockImageAnalysisCacheRepo();
    service = new ThreadService(
      threadRepo as unknown as ThreadRepository,
      messageRepo as unknown as MessageRepository,
      fileUploadServiceMock as unknown as FileUploadService,
      imageAnalysisCacheRepoMock as unknown as ImageAnalysisCacheRepository
    );
  });

  // --- verifyThreadOwnership ---

  describe('verifyThreadOwnership', () => {
    it('should return the thread when ownership matches', async () => {
      const thread = makeThread();
      threadRepo.findByIdAndUser.mockResolvedValue(thread);

      const result = await service.verifyThreadOwnership('thread-1', 'user-1');

      expect(result).toEqual(thread);
      expect(threadRepo.findByIdAndUser).toHaveBeenCalledWith(
        'thread-1',
        'user-1'
      );
    });

    it('should throw ThreadNotFoundError when thread does not exist', async () => {
      threadRepo.findByIdAndUser.mockResolvedValue(undefined);

      await expect(
        service.verifyThreadOwnership('nonexistent', 'user-1')
      ).rejects.toThrow(ThreadNotFoundError);
    });

    it('should throw ThreadNotFoundError when user does not own the thread', async () => {
      // findByIdAndUser returns undefined when user doesn't match
      threadRepo.findByIdAndUser.mockResolvedValue(undefined);

      await expect(
        service.verifyThreadOwnership('thread-1', 'other-user')
      ).rejects.toThrow(ThreadNotFoundError);
    });
  });

  // --- createThread ---

  describe('createThread', () => {
    it('should create a thread with empty title and correct user fields', async () => {
      const createdThread = makeThread({ title: '' });
      threadRepo.create.mockResolvedValue(createdThread);

      const result = await service.createThread('user-1');

      expect(result).toEqual(createdThread);
      expect(threadRepo.create).toHaveBeenCalledWith({
        title: '',
        created_by: 'user-1',
        updated_by: 'user-1'
      });
    });

    it('should return undefined when repository returns undefined', async () => {
      threadRepo.create.mockResolvedValue(undefined);

      const result = await service.createThread('user-1');

      expect(result).toBeUndefined();
    });
  });

  // --- renameThread ---

  describe('renameThread', () => {
    it('should rename the thread and return the updated thread', async () => {
      const thread = makeThread();
      const updatedThread = makeThread({ title: 'New Title' });
      threadRepo.findByIdAndUser.mockResolvedValue(thread);
      threadRepo.update.mockResolvedValue(updatedThread);

      const result = await service.renameThread(
        'thread-1',
        'user-1',
        'New Title'
      );

      expect(result).toEqual(updatedThread);
      expect(threadRepo.update).toHaveBeenCalledWith('thread-1', {
        title: 'New Title'
      });
    });

    it('should trim whitespace from the title', async () => {
      const thread = makeThread();
      const updatedThread = makeThread({ title: 'Trimmed' });
      threadRepo.findByIdAndUser.mockResolvedValue(thread);
      threadRepo.update.mockResolvedValue(updatedThread);

      await service.renameThread('thread-1', 'user-1', '  Trimmed  ');

      expect(threadRepo.update).toHaveBeenCalledWith('thread-1', {
        title: 'Trimmed'
      });
    });

    it('should throw ThreadValidationError when title is empty string', async () => {
      await expect(
        service.renameThread('thread-1', 'user-1', '')
      ).rejects.toThrow(ThreadValidationError);
      expect(threadRepo.findByIdAndUser).not.toHaveBeenCalled();
    });

    it('should throw ThreadValidationError when title is only whitespace', async () => {
      await expect(
        service.renameThread('thread-1', 'user-1', '   ')
      ).rejects.toThrow(ThreadValidationError);
      expect(threadRepo.findByIdAndUser).not.toHaveBeenCalled();
    });

    it('should throw ThreadNotFoundError when thread does not exist', async () => {
      threadRepo.findByIdAndUser.mockResolvedValue(undefined);

      await expect(
        service.renameThread('nonexistent', 'user-1', 'Title')
      ).rejects.toThrow(ThreadNotFoundError);
      expect(threadRepo.update).not.toHaveBeenCalled();
    });

    it('should throw ThreadNotFoundError when user does not own the thread', async () => {
      threadRepo.findByIdAndUser.mockResolvedValue(undefined);

      await expect(
        service.renameThread('thread-1', 'other-user', 'Title')
      ).rejects.toThrow(ThreadNotFoundError);
      expect(threadRepo.update).not.toHaveBeenCalled();
    });

    it('should throw ThreadOperationError when update returns undefined', async () => {
      const thread = makeThread();
      threadRepo.findByIdAndUser.mockResolvedValue(thread);
      threadRepo.update.mockResolvedValue(undefined);

      await expect(
        service.renameThread('thread-1', 'user-1', 'Title')
      ).rejects.toThrow(ThreadOperationError);
    });
  });

  // --- deleteThread ---

  describe('deleteThread', () => {
    it('should delete DB records first, then image files via FileUploadService', async () => {
      const thread = makeThread();
      threadRepo.findByIdAndUser.mockResolvedValue(thread);
      messageRepo.getImageFilenamesByThreadId.mockResolvedValue([
        'img1.jpg',
        'img2.png'
      ]);

      const callOrder: string[] = [];
      imageAnalysisCacheRepoMock.deleteByThreadId.mockImplementation(
        async () => {
          callOrder.push('deleteAnalysisCache');
          return 0;
        }
      );
      fileUploadServiceMock.delete.mockImplementation(async () => {
        callOrder.push('deleteArtifact');
      });
      messageRepo.deleteByThreadId.mockImplementation(async () => {
        callOrder.push('deleteMessages');
        return 5;
      });
      threadRepo.delete.mockImplementation(async () => {
        callOrder.push('deleteThread');
        return true;
      });

      await service.deleteThread('thread-1', 'user-1');

      expect(callOrder).toEqual([
        'deleteAnalysisCache',
        'deleteMessages',
        'deleteThread',
        'deleteArtifact',
        'deleteArtifact'
      ]);
      expect(imageAnalysisCacheRepoMock.deleteByThreadId).toHaveBeenCalledWith(
        'thread-1'
      );
      expect(fileUploadServiceMock.delete).toHaveBeenCalledWith('img1.jpg');
      expect(fileUploadServiceMock.delete).toHaveBeenCalledWith('img2.png');
      expect(messageRepo.deleteByThreadId).toHaveBeenCalledWith('thread-1');
      expect(threadRepo.delete).toHaveBeenCalledWith('thread-1');
    });

    it('should proceed even when no images exist', async () => {
      const thread = makeThread();
      threadRepo.findByIdAndUser.mockResolvedValue(thread);
      messageRepo.getImageFilenamesByThreadId.mockResolvedValue([]);
      imageAnalysisCacheRepoMock.deleteByThreadId.mockResolvedValue(0);
      messageRepo.deleteByThreadId.mockResolvedValue(0);
      threadRepo.delete.mockResolvedValue(true);

      await service.deleteThread('thread-1', 'user-1');

      expect(fileUploadServiceMock.delete).not.toHaveBeenCalled();
      expect(imageAnalysisCacheRepoMock.deleteByThreadId).toHaveBeenCalledWith(
        'thread-1'
      );
      expect(messageRepo.deleteByThreadId).toHaveBeenCalledWith('thread-1');
      expect(threadRepo.delete).toHaveBeenCalledWith('thread-1');
    });

    it('should throw ThreadNotFoundError when thread does not exist', async () => {
      threadRepo.findByIdAndUser.mockResolvedValue(undefined);

      await expect(
        service.deleteThread('nonexistent', 'user-1')
      ).rejects.toThrow(ThreadNotFoundError);
      expect(messageRepo.deleteByThreadId).not.toHaveBeenCalled();
      expect(threadRepo.delete).not.toHaveBeenCalled();
    });

    it('should throw ThreadNotFoundError when user does not own the thread', async () => {
      threadRepo.findByIdAndUser.mockResolvedValue(undefined);

      await expect(
        service.deleteThread('thread-1', 'other-user')
      ).rejects.toThrow(ThreadNotFoundError);
      expect(messageRepo.deleteByThreadId).not.toHaveBeenCalled();
    });

    it('should throw ThreadOperationError when thread deletion fails', async () => {
      const thread = makeThread();
      threadRepo.findByIdAndUser.mockResolvedValue(thread);
      messageRepo.getImageFilenamesByThreadId.mockResolvedValue([]);
      imageAnalysisCacheRepoMock.deleteByThreadId.mockResolvedValue(0);
      messageRepo.deleteByThreadId.mockResolvedValue(0);
      threadRepo.delete.mockResolvedValue(false);

      await expect(service.deleteThread('thread-1', 'user-1')).rejects.toThrow(
        ThreadOperationError
      );
    });
  });

  // --- findPaginated ---

  describe('findPaginated', () => {
    it('should delegate to repository with correct parameters', async () => {
      const paginatedResult: PaginatedThreadsResult = {
        threads: [makeThread()],
        totalPages: 1,
        currentPage: 1,
        totalCount: 1
      };
      threadRepo.findPaginated.mockResolvedValue(paginatedResult);

      const result = await service.findPaginated('user-1', 10, 1);

      expect(result).toEqual(paginatedResult);
      expect(threadRepo.findPaginated).toHaveBeenCalledWith(
        'user-1',
        10,
        1,
        undefined,
        undefined
      );
    });

    it('should pass searchWord to repository', async () => {
      const paginatedResult: PaginatedThreadsResult = {
        threads: [],
        totalPages: 0,
        currentPage: 1,
        totalCount: 0
      };
      threadRepo.findPaginated.mockResolvedValue(paginatedResult);

      await service.findPaginated('user-1', 10, 1, undefined, 'search term');

      expect(threadRepo.findPaginated).toHaveBeenCalledWith(
        'user-1',
        10,
        1,
        undefined,
        'search term'
      );
    });

    it('should pass lastThreadId to repository', async () => {
      const paginatedResult: PaginatedThreadsResult = {
        threads: [makeThread()],
        totalPages: 2,
        currentPage: 1,
        totalCount: 15
      };
      threadRepo.findPaginated.mockResolvedValue(paginatedResult);

      await service.findPaginated('user-1', 10, 1, 'last-thread-id');

      expect(threadRepo.findPaginated).toHaveBeenCalledWith(
        'user-1',
        10,
        1,
        'last-thread-id',
        undefined
      );
    });

    it('should pass both lastThreadId and searchWord to repository', async () => {
      const paginatedResult: PaginatedThreadsResult = {
        threads: [],
        totalPages: 0,
        currentPage: 2,
        totalCount: 0
      };
      threadRepo.findPaginated.mockResolvedValue(paginatedResult);

      await service.findPaginated('user-1', 20, 2, 'last-id', 'keyword');

      expect(threadRepo.findPaginated).toHaveBeenCalledWith(
        'user-1',
        20,
        2,
        'last-id',
        'keyword'
      );
    });
  });

  // --- findPinned ---

  describe('findPinned', () => {
    it('should return pinned threads for the user', async () => {
      const pinnedThreads = [
        makeThread({ id: 'thread-1', pinned: true }),
        makeThread({ id: 'thread-2', pinned: true })
      ];
      threadRepo.findPinned.mockResolvedValue(pinnedThreads);

      const result = await service.findPinned('user-1');

      expect(result).toEqual(pinnedThreads);
      expect(threadRepo.findPinned).toHaveBeenCalledWith('user-1');
    });

    it('should return empty array when no pinned threads exist', async () => {
      threadRepo.findPinned.mockResolvedValue([]);

      const result = await service.findPinned('user-1');

      expect(result).toEqual([]);
    });
  });

  // --- togglePin ---

  describe('togglePin', () => {
    it('should pin a thread', async () => {
      const thread = makeThread();
      const pinnedThread = makeThread({ pinned: true });
      threadRepo.findByIdAndUser.mockResolvedValue(thread);
      threadRepo.pin.mockResolvedValue(pinnedThread);

      const result = await service.togglePin('thread-1', 'user-1', true);

      expect(result).toEqual(pinnedThread);
      expect(threadRepo.pin).toHaveBeenCalledWith('thread-1', true);
    });

    it('should unpin a thread', async () => {
      const thread = makeThread({ pinned: true });
      const unpinnedThread = makeThread({ pinned: false });
      threadRepo.findByIdAndUser.mockResolvedValue(thread);
      threadRepo.pin.mockResolvedValue(unpinnedThread);

      const result = await service.togglePin('thread-1', 'user-1', false);

      expect(result).toEqual(unpinnedThread);
      expect(threadRepo.pin).toHaveBeenCalledWith('thread-1', false);
    });

    it('should throw ThreadNotFoundError when thread does not exist', async () => {
      threadRepo.findByIdAndUser.mockResolvedValue(undefined);

      await expect(
        service.togglePin('nonexistent', 'user-1', true)
      ).rejects.toThrow(ThreadNotFoundError);
      expect(threadRepo.pin).not.toHaveBeenCalled();
    });

    it('should throw ThreadNotFoundError when user does not own the thread', async () => {
      threadRepo.findByIdAndUser.mockResolvedValue(undefined);

      await expect(
        service.togglePin('thread-1', 'other-user', true)
      ).rejects.toThrow(ThreadNotFoundError);
      expect(threadRepo.pin).not.toHaveBeenCalled();
    });

    it('should throw ThreadOperationError when pin update fails', async () => {
      const thread = makeThread();
      threadRepo.findByIdAndUser.mockResolvedValue(thread);
      threadRepo.pin.mockResolvedValue(undefined);

      await expect(
        service.togglePin('thread-1', 'user-1', true)
      ).rejects.toThrow(ThreadOperationError);
    });

    it('should throw ThreadValidationError when pinned is not a boolean', async () => {
      await expect(
        service.togglePin('thread-1', 'user-1', 'true' as unknown as boolean)
      ).rejects.toThrow(ThreadValidationError);
    });
  });
});

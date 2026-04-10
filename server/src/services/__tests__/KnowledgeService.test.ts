import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  Knowledge,
  PaginatedKnowledgeResult,
  KnowledgeRepository
} from '../../repositories/KnowledgeRepository';

vi.mock('node:crypto', () => ({
  default: {
    randomUUID: vi.fn(() => 'test-uuid-1234')
  }
}));

vi.mock('../../logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

import {
  KnowledgeService,
  KnowledgeNotFoundError,
  KnowledgeValidationError,
  KNOWLEDGE_MAX_FILE_SIZE
} from '../KnowledgeService';
import type { FileUploadService } from '../FileUploadService';

const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';

function makeKnowledge(overrides: Partial<Knowledge> = {}): Knowledge {
  return {
    id: 'k-1',
    name: 'test.txt',
    display_path: 'test.txt',
    fs_path: '/mock/data/artifacts/test-uuid.txt',
    created_by: USER_ID,
    updated_by: USER_ID,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...overrides
  };
}

function createMockRepo() {
  return {
    findByUserId: vi.fn(),
    findByUserIdAndName: vi.fn(),
    findPaginated: vi.fn(),
    findById: vi.fn(),
    findByIds: vi.fn(),
    existsByUserIdAndExactName: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  };
}

const createMockFileUploadService = () => ({
  save: vi.fn().mockResolvedValue('/mock/data/artifacts/test-uuid-1234.txt'),
  read: vi.fn(),
  readText: vi.fn(),
  delete: vi.fn(),
  getPath: vi.fn()
});

describe('KnowledgeService', () => {
  let service: KnowledgeService;
  let mockRepo: ReturnType<typeof createMockRepo>;
  let mockFileUploadService: ReturnType<typeof createMockFileUploadService>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo = createMockRepo();
    mockFileUploadService = createMockFileUploadService();
    service = new KnowledgeService(
      mockRepo as unknown as KnowledgeRepository,
      mockFileUploadService as unknown as FileUploadService
    );
  });

  describe('list', () => {
    it('should return all knowledge entries for a user', async () => {
      const entries = [makeKnowledge(), makeKnowledge({ id: 'k-2' })];
      mockRepo.findByUserId.mockResolvedValue(entries);

      const result = await service.list(USER_ID);

      expect(result).toEqual(entries);
      expect(mockRepo.findByUserId).toHaveBeenCalledWith(USER_ID);
    });
  });

  describe('search', () => {
    it('should return matching knowledge entries', async () => {
      const entries = [makeKnowledge({ name: 'search-match.txt' })];
      mockRepo.findByUserIdAndName.mockResolvedValue(entries);

      const result = await service.search(USER_ID, 'search');

      expect(result).toEqual(entries);
      expect(mockRepo.findByUserIdAndName).toHaveBeenCalledWith(
        USER_ID,
        'search'
      );
    });
  });

  describe('findPaginated', () => {
    it('should return paginated results', async () => {
      const paginatedResult: PaginatedKnowledgeResult = {
        entries: [makeKnowledge()],
        totalPages: 1,
        currentPage: 1,
        totalCount: 1
      };
      mockRepo.findPaginated.mockResolvedValue(paginatedResult);

      const result = await service.findPaginated(USER_ID, 10, 1, 'test');

      expect(result).toEqual(paginatedResult);
      expect(mockRepo.findPaginated).toHaveBeenCalledWith(
        USER_ID,
        10,
        1,
        'test'
      );
    });
  });

  describe('getById', () => {
    it('should return knowledge when found and owned by user', async () => {
      const knowledge = makeKnowledge();
      mockRepo.findById.mockResolvedValue(knowledge);

      const result = await service.getById('k-1', USER_ID);

      expect(result).toEqual(knowledge);
    });

    it('should throw KnowledgeNotFoundError when entry does not exist', async () => {
      mockRepo.findById.mockResolvedValue(undefined);

      await expect(service.getById('nonexistent', USER_ID)).rejects.toThrow(
        KnowledgeNotFoundError
      );
    });

    it('should throw KnowledgeNotFoundError when user does not own entry', async () => {
      const knowledge = makeKnowledge({ created_by: OTHER_USER_ID });
      mockRepo.findById.mockResolvedValue(knowledge);

      await expect(service.getById('k-1', USER_ID)).rejects.toThrow(
        KnowledgeNotFoundError
      );
    });
  });

  describe('getContent', () => {
    it('should read and return file content', async () => {
      const knowledge = makeKnowledge();
      mockRepo.findById.mockResolvedValue(knowledge);
      mockFileUploadService.readText.mockResolvedValue('file content here');

      const result = await service.getContent('k-1', USER_ID);

      expect(result).toBe('file content here');
      expect(mockFileUploadService.readText).toHaveBeenCalledWith(
        'test-uuid.txt'
      );
    });

    it('should throw KnowledgeNotFoundError when entry does not exist', async () => {
      mockRepo.findById.mockResolvedValue(undefined);

      await expect(service.getContent('nonexistent', USER_ID)).rejects.toThrow(
        KnowledgeNotFoundError
      );
    });
  });

  describe('getContentsByIds', () => {
    it('should return contents for owned entries', async () => {
      const entries = [
        makeKnowledge({ id: 'k-1', name: 'a.txt', fs_path: '/path/a.txt' }),
        makeKnowledge({ id: 'k-2', name: 'b.txt', fs_path: '/path/b.txt' })
      ];
      mockRepo.findByIds.mockResolvedValue(entries);
      mockFileUploadService.readText
        .mockResolvedValueOnce('content A')
        .mockResolvedValueOnce('content B');

      const result = await service.getContentsByIds(['k-1', 'k-2'], USER_ID);

      expect(result).toEqual([
        { name: 'a.txt', content: 'content A' },
        { name: 'b.txt', content: 'content B' }
      ]);
    });

    it('should filter out entries not owned by user', async () => {
      const entries = [
        makeKnowledge({
          id: 'k-1',
          name: 'mine.txt',
          fs_path: '/path/mine.txt'
        }),
        makeKnowledge({
          id: 'k-2',
          name: 'theirs.txt',
          fs_path: '/path/theirs.txt',
          created_by: OTHER_USER_ID
        })
      ];
      mockRepo.findByIds.mockResolvedValue(entries);
      mockFileUploadService.readText.mockResolvedValueOnce('my content');

      const result = await service.getContentsByIds(['k-1', 'k-2'], USER_ID);

      expect(result).toEqual([{ name: 'mine.txt', content: 'my content' }]);
      expect(mockFileUploadService.readText).toHaveBeenCalledTimes(1);
    });

    it('should skip entries where file read fails', async () => {
      const entries = [
        makeKnowledge({ id: 'k-1', name: 'ok.txt', fs_path: '/path/ok.txt' }),
        makeKnowledge({
          id: 'k-2',
          name: 'broken.txt',
          fs_path: '/path/broken.txt'
        })
      ];
      mockRepo.findByIds.mockResolvedValue(entries);
      mockFileUploadService.readText
        .mockResolvedValueOnce('good content')
        .mockRejectedValueOnce(new Error('ENOENT'));

      const result = await service.getContentsByIds(['k-1', 'k-2'], USER_ID);

      expect(result).toEqual([{ name: 'ok.txt', content: 'good content' }]);
    });
  });

  describe('create', () => {
    it('should create knowledge entry and save file via FileUploadService', async () => {
      const created = makeKnowledge({
        fs_path: '/mock/data/artifacts/test-uuid-1234.txt'
      });
      mockRepo.existsByUserIdAndExactName.mockResolvedValue(false);
      mockRepo.create.mockResolvedValue(created);

      const result = await service.create(USER_ID, 'test', 'content');

      expect(result).toEqual(created);
      expect(mockFileUploadService.save).toHaveBeenCalledWith(
        'test-uuid-1234.txt',
        'content',
        'utf-8'
      );
      expect(mockRepo.create).toHaveBeenCalledWith({
        name: 'test.txt',
        display_path: 'test.txt',
        fs_path: '/mock/data/artifacts/test-uuid-1234.txt',
        created_by: USER_ID,
        updated_by: USER_ID
      });
    });

    it('should preserve existing .txt extension', async () => {
      mockRepo.existsByUserIdAndExactName.mockResolvedValue(false);
      mockRepo.create.mockResolvedValue(makeKnowledge());

      await service.create(USER_ID, 'already.txt', 'content');

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'already.txt' })
      );
    });

    it('should throw KnowledgeValidationError when content exceeds size limit', async () => {
      mockRepo.existsByUserIdAndExactName.mockResolvedValue(false);
      const largeContent = 'x'.repeat(KNOWLEDGE_MAX_FILE_SIZE + 1);

      await expect(
        service.create(USER_ID, 'large', largeContent)
      ).rejects.toThrow(KnowledgeValidationError);
      expect(mockFileUploadService.save).not.toHaveBeenCalled();
    });

    it('should throw KnowledgeValidationError when name already exists', async () => {
      mockRepo.existsByUserIdAndExactName.mockResolvedValue(true);

      await expect(
        service.create(USER_ID, 'dup.txt', 'content')
      ).rejects.toThrow(KnowledgeValidationError);
      expect(mockFileUploadService.save).not.toHaveBeenCalled();
    });
  });

  describe('upload', () => {
    it('should upload file buffer and create entry', async () => {
      const created = makeKnowledge({
        fs_path: '/mock/data/artifacts/test-uuid-1234.txt'
      });
      mockRepo.existsByUserIdAndExactName.mockResolvedValue(false);
      mockRepo.create.mockResolvedValue(created);
      const buffer = Buffer.from('uploaded content');

      const result = await service.upload(USER_ID, 'upload', buffer);

      expect(result).toEqual(created);
      expect(mockFileUploadService.save).toHaveBeenCalledWith(
        'test-uuid-1234.txt',
        buffer
      );
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'upload.txt' })
      );
    });

    it('should throw KnowledgeValidationError when buffer exceeds size limit', async () => {
      const largeBuffer = Buffer.alloc(KNOWLEDGE_MAX_FILE_SIZE + 1);

      await expect(
        service.upload(USER_ID, 'large', largeBuffer)
      ).rejects.toThrow(KnowledgeValidationError);
      expect(mockFileUploadService.save).not.toHaveBeenCalled();
    });

    it('should throw KnowledgeValidationError when name already exists', async () => {
      mockRepo.existsByUserIdAndExactName.mockResolvedValue(true);
      const buffer = Buffer.from('content');

      await expect(service.upload(USER_ID, 'dup.txt', buffer)).rejects.toThrow(
        KnowledgeValidationError
      );
      expect(mockFileUploadService.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update content and metadata', async () => {
      const existing = makeKnowledge();
      const updated = makeKnowledge({ name: 'renamed.txt' });
      mockRepo.findById.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(updated);

      const result = await service.update(
        'k-1',
        USER_ID,
        'renamed',
        'new content'
      );

      expect(result).toEqual(updated);
      expect(mockFileUploadService.save).toHaveBeenCalledWith(
        'test-uuid.txt',
        'new content',
        'utf-8'
      );
      expect(mockRepo.update).toHaveBeenCalledWith('k-1', {
        name: 'renamed.txt',
        display_path: 'renamed.txt',
        updated_by: USER_ID
      });
    });

    it('should throw KnowledgeNotFoundError when entry does not exist', async () => {
      mockRepo.findById.mockResolvedValue(undefined);

      await expect(
        service.update('nonexistent', USER_ID, 'name', 'content')
      ).rejects.toThrow(KnowledgeNotFoundError);
    });

    it('should throw KnowledgeNotFoundError when user does not own entry', async () => {
      const knowledge = makeKnowledge({ created_by: OTHER_USER_ID });
      mockRepo.findById.mockResolvedValue(knowledge);

      await expect(
        service.update('k-1', USER_ID, 'name', 'content')
      ).rejects.toThrow(KnowledgeNotFoundError);
    });

    it('should throw KnowledgeValidationError when content exceeds size limit', async () => {
      const existing = makeKnowledge();
      mockRepo.findById.mockResolvedValue(existing);
      const largeContent = 'x'.repeat(KNOWLEDGE_MAX_FILE_SIZE + 1);

      await expect(
        service.update('k-1', USER_ID, 'name', largeContent)
      ).rejects.toThrow(KnowledgeValidationError);
    });

    it('should throw KnowledgeNotFoundError when repo update returns undefined', async () => {
      const existing = makeKnowledge();
      mockRepo.findById.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(undefined);

      await expect(
        service.update('k-1', USER_ID, 'name', 'content')
      ).rejects.toThrow(KnowledgeNotFoundError);
    });
  });

  describe('delete', () => {
    it('should delete DB entry first, then file via FileUploadService', async () => {
      const knowledge = makeKnowledge();
      mockRepo.findById.mockResolvedValue(knowledge);

      const callOrder: string[] = [];
      mockRepo.delete.mockImplementation(async () => {
        callOrder.push('dbDelete');
        return true;
      });
      mockFileUploadService.delete.mockImplementation(async () => {
        callOrder.push('fileDelete');
      });

      await service.delete('k-1', USER_ID);

      expect(callOrder).toEqual(['dbDelete', 'fileDelete']);
      expect(mockRepo.delete).toHaveBeenCalledWith('k-1');
      expect(mockFileUploadService.delete).toHaveBeenCalledWith(
        'test-uuid.txt'
      );
    });

    it('should throw KnowledgeNotFoundError when entry does not exist', async () => {
      mockRepo.findById.mockResolvedValue(undefined);

      await expect(service.delete('nonexistent', USER_ID)).rejects.toThrow(
        KnowledgeNotFoundError
      );
    });

    it('should throw KnowledgeNotFoundError when user does not own entry', async () => {
      const knowledge = makeKnowledge({ created_by: OTHER_USER_ID });
      mockRepo.findById.mockResolvedValue(knowledge);

      await expect(service.delete('k-1', USER_ID)).rejects.toThrow(
        KnowledgeNotFoundError
      );
    });
  });
});

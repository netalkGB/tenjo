import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createImageAnalysisProvider } from '../ImageAnalysisCacheService';
import type {
  ImageAnalysisCacheRepository,
  ImageAnalysisCache
} from '../../repositories/ImageAnalysisCacheRepository';

vi.mock('../../logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

// --- Mock factories ---

const createMockRepo = () => ({
  findByImagePath: vi.fn(),
  create: vi.fn(),
  deleteByThreadId: vi.fn()
});

const makeCacheEntry = (
  overrides: Partial<ImageAnalysisCache> = {}
): ImageAnalysisCache => ({
  id: 'cache-1',
  image_path: '/uploads/image.png',
  model: 'gpt-4o',
  description: 'A photo of a cat',
  thread_id: 'thread-1',
  created_at: new Date('2025-01-01'),
  updated_at: new Date('2025-01-01'),
  ...overrides
});

describe('createImageAnalysisProvider', () => {
  let repo: ReturnType<typeof createMockRepo>;

  beforeEach(() => {
    repo = createMockRepo();
  });

  describe('getCachedDescription', () => {
    it('returns description when cache entry exists', async () => {
      const entry = makeCacheEntry();
      repo.findByImagePath.mockResolvedValue(entry);

      const provider = createImageAnalysisProvider(
        repo as unknown as ImageAnalysisCacheRepository,
        'thread-1',
        'gpt-4o'
      );
      const result = await provider.getCachedDescription('/uploads/image.png');

      expect(result).toBe('A photo of a cat');
      expect(repo.findByImagePath).toHaveBeenCalledWith('/uploads/image.png');
    });

    it('returns undefined when no cache entry exists', async () => {
      repo.findByImagePath.mockResolvedValue(undefined);

      const provider = createImageAnalysisProvider(
        repo as unknown as ImageAnalysisCacheRepository,
        'thread-1',
        'gpt-4o'
      );
      const result = await provider.getCachedDescription(
        '/uploads/missing.png'
      );

      expect(result).toBeUndefined();
      expect(repo.findByImagePath).toHaveBeenCalledWith('/uploads/missing.png');
    });
  });

  describe('cacheDescription', () => {
    it('creates a cache entry with bound threadId and model', async () => {
      const created = makeCacheEntry();
      repo.create.mockResolvedValue(created);

      const provider = createImageAnalysisProvider(
        repo as unknown as ImageAnalysisCacheRepository,
        'thread-1',
        'gpt-4o'
      );
      await provider.cacheDescription('/uploads/image.png', 'A photo of a cat');

      expect(repo.create).toHaveBeenCalledWith({
        image_path: '/uploads/image.png',
        model: 'gpt-4o',
        description: 'A photo of a cat',
        thread_id: 'thread-1'
      });
    });

    it('propagates repo create errors', async () => {
      repo.create.mockRejectedValue(new Error('DB constraint violation'));

      const provider = createImageAnalysisProvider(
        repo as unknown as ImageAnalysisCacheRepository,
        'thread-1',
        'gpt-4o'
      );

      await expect(
        provider.cacheDescription('/uploads/image.png', 'A photo of a cat')
      ).rejects.toThrow('DB constraint violation');
    });
  });
});

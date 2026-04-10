import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ImageAnalysisCacheRepository } from '../ImageAnalysisCacheRepository';
import { TestDatabaseHelper, getTestDbConfig } from '../../test-utils/testDb';
import { randomUUID } from 'node:crypto';

describe('ImageAnalysisCacheRepository (Integration Tests)', () => {
  let testDb: TestDatabaseHelper;
  let repo: ImageAnalysisCacheRepository;
  const threadId = randomUUID();

  beforeAll(async () => {
    const config = getTestDbConfig();
    testDb = new TestDatabaseHelper({
      ...config,
      schemaSuffix: 'image_analysis_cache'
    });
    await testDb.connect();
    await testDb.createSchema();
    await testDb.createTables();

    repo = new ImageAnalysisCacheRepository(testDb.getPool());
  });

  afterAll(async () => {
    await testDb.dropSchema();
    await testDb.disconnect();
  });

  beforeEach(async () => {
    await testDb.cleanTables();
  });

  const createCache = (
    overrides?: Partial<{
      image_path: string;
      model: string;
      description: string;
      thread_id: string;
    }>
  ) =>
    repo.create({
      image_path: '/images/test.png',
      model: 'gpt-4o',
      description: 'A test image description',
      thread_id: threadId,
      ...overrides
    });

  describe('create', () => {
    it('should create a cache entry and return it with all fields', async () => {
      const entry = await createCache();

      expect(entry).toBeDefined();
      expect(entry.id).toBeDefined();
      expect(entry.image_path).toBe('/images/test.png');
      expect(entry.model).toBe('gpt-4o');
      expect(entry.description).toBe('A test image description');
      expect(entry.thread_id).toBe(threadId);
      expect(entry.created_at).toBeDefined();
      expect(entry.updated_at).toBeDefined();
    });
  });

  describe('findByImagePath', () => {
    it('should return a cached entry when it exists', async () => {
      const created = await createCache();

      const found = await repo.findByImagePath('/images/test.png');

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.image_path).toBe('/images/test.png');
      expect(found?.description).toBe('A test image description');
    });

    it('should return undefined when no match', async () => {
      const result = await repo.findByImagePath('/images/nonexistent.png');
      expect(result).toBeUndefined();
    });

    it('should ignore model and return the first match regardless of model used during creation', async () => {
      await createCache({
        image_path: '/images/shared.png',
        model: 'gpt-4o'
      });
      await createCache({
        image_path: '/images/other.png',
        model: 'claude-3'
      });

      const found = await repo.findByImagePath('/images/shared.png');

      expect(found).toBeDefined();
      expect(found?.image_path).toBe('/images/shared.png');
      expect(found?.model).toBe('gpt-4o');
    });
  });

  describe('deleteByThreadId', () => {
    it('should delete all entries for a thread and return count', async () => {
      await createCache({ image_path: '/images/a.png' });
      await createCache({ image_path: '/images/b.png' });
      await createCache({ image_path: '/images/c.png' });

      const count = await repo.deleteByThreadId(threadId);

      expect(count).toBe(3);

      const remaining = await repo.findByImagePath('/images/a.png');
      expect(remaining).toBeUndefined();
    });

    it('should return 0 when no entries exist for thread', async () => {
      const count = await repo.deleteByThreadId(randomUUID());
      expect(count).toBe(0);
    });

    it('should not delete entries from other threads', async () => {
      const otherThreadId = randomUUID();
      await createCache({
        image_path: '/images/mine.png',
        thread_id: threadId
      });
      await createCache({
        image_path: '/images/other.png',
        thread_id: otherThreadId
      });

      const count = await repo.deleteByThreadId(threadId);

      expect(count).toBe(1);

      const otherEntry = await repo.findByImagePath('/images/other.png');
      expect(otherEntry).toBeDefined();
      expect(otherEntry?.thread_id).toBe(otherThreadId);
    });
  });
});

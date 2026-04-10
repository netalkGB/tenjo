import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { KnowledgeRepository } from '../KnowledgeRepository';
import { TestDatabaseHelper, getTestDbConfig } from '../../test-utils/testDb';
import { randomUUID } from 'node:crypto';

describe('KnowledgeRepository (Integration Tests)', () => {
  let testDb: TestDatabaseHelper;
  let repo: KnowledgeRepository;
  const userId = randomUUID();

  beforeAll(async () => {
    const config = getTestDbConfig();
    testDb = new TestDatabaseHelper({
      ...config,
      schemaSuffix: 'knowledge'
    });
    await testDb.connect();
    await testDb.createSchema();
    await testDb.createTables();

    repo = new KnowledgeRepository(testDb.getPool());
  });

  afterAll(async () => {
    await testDb.dropSchema();
    await testDb.disconnect();
  });

  beforeEach(async () => {
    await testDb.cleanTables();
  });

  const createKnowledge = (overrides?: Record<string, unknown>) =>
    repo.create({
      name: 'Test Document',
      display_path: '/docs/test.md',
      fs_path: '/tmp/knowledge/test.md',
      created_by: userId,
      ...overrides
    });

  describe('create', () => {
    it('should create a knowledge entry and return it', async () => {
      const knowledge = await createKnowledge();

      expect(knowledge).toBeDefined();
      expect(knowledge.id).toBeDefined();
      expect(knowledge.name).toBe('Test Document');
      expect(knowledge.display_path).toBe('/docs/test.md');
      expect(knowledge.fs_path).toBe('/tmp/knowledge/test.md');
      expect(knowledge.created_by).toBe(userId);
      expect(knowledge.created_at).toBeDefined();
    });
  });

  describe('findById', () => {
    it('should return undefined when entry does not exist', async () => {
      const result = await repo.findById(
        '00000000-0000-0000-0000-000000000000'
      );
      expect(result).toBeUndefined();
    });

    it('should return the entry when it exists', async () => {
      const created = await createKnowledge();

      const found = await repo.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe('Test Document');
    });
  });

  describe('findByIds', () => {
    it('should return empty array for empty input', async () => {
      const result = await repo.findByIds([]);
      expect(result).toEqual([]);
    });

    it('should return matching entries', async () => {
      const k1 = await createKnowledge({ name: 'Doc 1', fs_path: '/a' });
      const k2 = await createKnowledge({ name: 'Doc 2', fs_path: '/b' });
      await createKnowledge({ name: 'Doc 3', fs_path: '/c' });

      const result = await repo.findByIds([k1.id, k2.id]);

      expect(result).toHaveLength(2);
      const ids = result.map((r) => r.id);
      expect(ids).toContain(k1.id);
      expect(ids).toContain(k2.id);
    });
  });

  describe('findByUserId', () => {
    it('should return empty array when user has no knowledge', async () => {
      const result = await repo.findByUserId(randomUUID());
      expect(result).toEqual([]);
    });

    it('should return only entries belonging to the given user', async () => {
      const otherUserId = randomUUID();
      await createKnowledge({ name: 'My Doc', fs_path: '/a' });
      await createKnowledge({
        name: 'Other Doc',
        fs_path: '/b',
        created_by: otherUserId
      });

      const result = await repo.findByUserId(userId);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('My Doc');
    });

    it('should return entries ordered by created_at DESC', async () => {
      const k1 = await createKnowledge({ name: 'First', fs_path: '/a' });
      const k2 = await createKnowledge({ name: 'Second', fs_path: '/b' });

      const result = await repo.findByUserId(userId);

      expect(result).toHaveLength(2);
      // Second created should appear first (DESC order)
      expect(result[0].id).toBe(k2.id);
      expect(result[1].id).toBe(k1.id);
    });
  });

  describe('findByUserIdAndName', () => {
    it('should return entries matching the name pattern (case-insensitive)', async () => {
      await createKnowledge({ name: 'React Guide', fs_path: '/a' });
      await createKnowledge({ name: 'Vue Guide', fs_path: '/b' });
      await createKnowledge({ name: 'react Advanced', fs_path: '/c' });

      const result = await repo.findByUserIdAndName(userId, 'react');

      expect(result).toHaveLength(2);
      const names = result.map((r) => r.name);
      expect(names).toContain('React Guide');
      expect(names).toContain('react Advanced');
    });

    it('should return empty array when no match', async () => {
      await createKnowledge({ name: 'Something Else', fs_path: '/a' });

      const result = await repo.findByUserIdAndName(userId, 'nonexistent');
      expect(result).toEqual([]);
    });
  });

  describe('existsByUserIdAndExactName', () => {
    it('should return false when name does not match exactly', async () => {
      await createKnowledge({ name: 'My Document', fs_path: '/a' });

      const result = await repo.existsByUserIdAndExactName(userId, 'My Doc');
      expect(result).toBe(false);
    });

    it('should return true when exact name exists for user', async () => {
      await createKnowledge({ name: 'My Document', fs_path: '/a' });

      const result = await repo.existsByUserIdAndExactName(
        userId,
        'My Document'
      );
      expect(result).toBe(true);
    });

    it('should return false for different user with same name', async () => {
      await createKnowledge({ name: 'My Document', fs_path: '/a' });

      const result = await repo.existsByUserIdAndExactName(
        randomUUID(),
        'My Document'
      );
      expect(result).toBe(false);
    });
  });

  describe('findPaginated', () => {
    it('should return paginated results', async () => {
      for (let i = 0; i < 5; i++) {
        await createKnowledge({ name: `Doc ${i}`, fs_path: `/path/${i}` });
      }

      const result = await repo.findPaginated(userId, 2, 1);

      expect(result.entries).toHaveLength(2);
      expect(result.totalCount).toBe(5);
      expect(result.totalPages).toBe(3);
      expect(result.currentPage).toBe(1);
    });

    it('should return correct page', async () => {
      for (let i = 0; i < 5; i++) {
        await createKnowledge({ name: `Doc ${i}`, fs_path: `/path/${i}` });
      }

      const result = await repo.findPaginated(userId, 2, 3);

      expect(result.entries).toHaveLength(1);
      expect(result.currentPage).toBe(3);
    });

    it('should filter by search term', async () => {
      await createKnowledge({ name: 'React Guide', fs_path: '/a' });
      await createKnowledge({ name: 'Vue Guide', fs_path: '/b' });
      await createKnowledge({ name: 'React Advanced', fs_path: '/c' });

      const result = await repo.findPaginated(userId, 10, 1, 'react');

      expect(result.entries).toHaveLength(2);
      expect(result.totalCount).toBe(2);
    });

    it('should return empty result for page beyond range', async () => {
      await createKnowledge({ name: 'Only Doc', fs_path: '/a' });

      const result = await repo.findPaginated(userId, 10, 5);

      expect(result.entries).toHaveLength(0);
      expect(result.totalCount).toBe(1);
      expect(result.currentPage).toBe(5);
    });
  });

  describe('update', () => {
    it('should return undefined when entry does not exist', async () => {
      const result = await repo.update('00000000-0000-0000-0000-000000000000', {
        name: 'Updated'
      });
      expect(result).toBeUndefined();
    });

    it('should update specified fields', async () => {
      const created = await createKnowledge();

      const updated = await repo.update(created.id, {
        name: 'Updated Name',
        display_path: '/docs/updated.md'
      });

      expect(updated).toBeDefined();
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.display_path).toBe('/docs/updated.md');
      expect(updated?.fs_path).toBe(created.fs_path); // unchanged
    });
  });

  describe('delete', () => {
    it('should return false when entry does not exist', async () => {
      const result = await repo.delete('00000000-0000-0000-0000-000000000000');
      expect(result).toBe(false);
    });

    it('should delete entry and return true', async () => {
      const created = await createKnowledge();

      const result = await repo.delete(created.id);
      expect(result).toBe(true);

      const found = await repo.findById(created.id);
      expect(found).toBeUndefined();
    });
  });
});

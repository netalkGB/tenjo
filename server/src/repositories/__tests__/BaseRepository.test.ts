import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { BaseRepository } from '../BaseRepository';
import { TestDatabaseHelper, getTestDbConfig } from '../../test-utils/testDb';

// Concrete subclass to test protected methods
class TestRepository extends BaseRepository {
  async runTransaction<T>(fn: (client: import('pg').PoolClient) => Promise<T>) {
    return this.withTransaction(fn);
  }

  testBuildInsertQuery(
    tableName: string,
    data: Record<string, unknown>,
    allowedColumns: readonly string[]
  ) {
    return this.buildInsertQuery(tableName, data, allowedColumns);
  }

  testBuildUpdateQuery(
    tableName: string,
    id: string,
    data: Record<string, unknown>,
    allowedColumns: readonly string[]
  ) {
    return this.buildUpdateQuery(tableName, id, data, allowedColumns);
  }

  async testUpdateReturning<T>(
    tableName: string,
    id: string,
    data: Record<string, unknown>,
    allowedColumns: readonly string[]
  ) {
    return this.updateReturning<T>(tableName, id, data, allowedColumns);
  }
}

describe('BaseRepository (Integration Tests)', () => {
  let testDb: TestDatabaseHelper;
  let repo: TestRepository;

  beforeAll(async () => {
    const config = getTestDbConfig();
    testDb = new TestDatabaseHelper({ ...config, schemaSuffix: 'base' });
    await testDb.connect();
    await testDb.createSchema();
    await testDb.createTables();

    repo = new TestRepository(testDb.getPool());
  });

  afterAll(async () => {
    await testDb.dropSchema();
    await testDb.disconnect();
  });

  beforeEach(async () => {
    await testDb.cleanTables();
  });

  describe('withTransaction', () => {
    it('should commit on success', async () => {
      await repo.runTransaction(async (client) => {
        await client.query(
          `INSERT INTO "users" ("full_name", "user_name", "email", "password") VALUES ('Tx User', 'txuser', 'tx@example.com', 'pass')`
        );
      });

      const result = await testDb
        .getPool()
        .query(`SELECT * FROM "users" WHERE "user_name" = 'txuser'`);
      expect(result.rows).toHaveLength(1);
    });

    it('should rollback on error and rethrow', async () => {
      await expect(
        repo.runTransaction(async (client) => {
          await client.query(
            `INSERT INTO "users" ("full_name", "user_name", "email", "password") VALUES ('Fail User', 'failuser', 'fail@example.com', 'pass')`
          );
          throw new Error('intentional error');
        })
      ).rejects.toThrow('intentional error');

      // Verify the insert was rolled back
      const result = await testDb
        .getPool()
        .query(`SELECT * FROM "users" WHERE "user_name" = 'failuser'`);
      expect(result.rows).toHaveLength(0);
    });
  });

  describe('buildUpdateQuery', () => {
    it('should return null when no allowed columns have data', async () => {
      const result = repo.testBuildUpdateQuery(
        'users',
        'some-id',
        { unknown_field: 'value' },
        ['full_name', 'user_name']
      );
      expect(result).toBeNull();
    });
  });

  describe('updateReturning', () => {
    it('should return undefined when no fields to update', async () => {
      const result = await repo.testUpdateReturning(
        'users',
        'some-id',
        { unknown_field: 'value' },
        ['full_name', 'user_name']
      );
      expect(result).toBeUndefined();
    });
  });
});

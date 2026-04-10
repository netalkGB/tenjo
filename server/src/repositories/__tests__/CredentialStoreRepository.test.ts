import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { CredentialStoreRepository } from '../CredentialStoreRepository';
import { TestDatabaseHelper, getTestDbConfig } from '../../test-utils/testDb';

const ENCRYPTION_KEY = 'test-encryption-key-32bytes!!!!!';

describe('CredentialStoreRepository (Integration Tests)', () => {
  let testDb: TestDatabaseHelper;
  let repo: CredentialStoreRepository;

  beforeAll(async () => {
    const config = getTestDbConfig();
    testDb = new TestDatabaseHelper({
      ...config,
      schemaSuffix: 'credential_store'
    });
    await testDb.connect();
    await testDb.createSchema();
    await testDb.createTables();

    repo = new CredentialStoreRepository(testDb.getPool());
  });

  afterAll(async () => {
    await testDb.dropSchema();
    await testDb.disconnect();
  });

  beforeEach(async () => {
    await testDb.cleanTables();
  });

  describe('save', () => {
    it('should save a credential and return a UUID', async () => {
      const id = await repo.save('my-secret', ENCRYPTION_KEY);

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      // UUID format
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('should generate unique ids for each credential', async () => {
      const id1 = await repo.save('secret-1', ENCRYPTION_KEY);
      const id2 = await repo.save('secret-2', ENCRYPTION_KEY);

      expect(id1).not.toBe(id2);
    });
  });

  describe('load', () => {
    it('should return null when credential does not exist', async () => {
      const result = await repo.load(
        '00000000-0000-0000-0000-000000000000',
        ENCRYPTION_KEY
      );
      expect(result).toBeNull();
    });

    it('should decrypt and return the stored plaintext', async () => {
      const plaintext = 'super-secret-token-12345';
      const id = await repo.save(plaintext, ENCRYPTION_KEY);

      const loaded = await repo.load(id, ENCRYPTION_KEY);

      expect(loaded).toBe(plaintext);
    });
  });

  describe('exists', () => {
    it('should return false when credential does not exist', async () => {
      const result = await repo.exists('00000000-0000-0000-0000-000000000000');
      expect(result).toBe(false);
    });

    it('should return true when credential exists', async () => {
      const id = await repo.save('some-value', ENCRYPTION_KEY);

      const result = await repo.exists(id);

      expect(result).toBe(true);
    });
  });

  describe('delete', () => {
    it('should return false when credential does not exist', async () => {
      const result = await repo.delete('00000000-0000-0000-0000-000000000000');
      expect(result).toBe(false);
    });

    it('should delete credential and return true', async () => {
      const id = await repo.save('to-be-deleted', ENCRYPTION_KEY);

      const result = await repo.delete(id);
      expect(result).toBe(true);

      const exists = await repo.exists(id);
      expect(exists).toBe(false);
    });
  });

  describe('update', () => {
    it('should return false when credential does not exist', async () => {
      const result = await repo.update(
        '00000000-0000-0000-0000-000000000000',
        'new-value',
        ENCRYPTION_KEY
      );
      expect(result).toBe(false);
    });

    it('should update the encrypted value and return true', async () => {
      const id = await repo.save('original-value', ENCRYPTION_KEY);

      const result = await repo.update(id, 'updated-value', ENCRYPTION_KEY);
      expect(result).toBe(true);

      const loaded = await repo.load(id, ENCRYPTION_KEY);
      expect(loaded).toBe('updated-value');
    });
  });
});

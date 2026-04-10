import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PendingOAuthFlowRepository } from '../PendingOAuthFlowRepository';
import { CredentialStoreRepository } from '../CredentialStoreRepository';
import { TestDatabaseHelper, getTestDbConfig } from '../../test-utils/testDb';
import { randomUUID } from 'node:crypto';

const ENCRYPTION_KEY = 'test-encryption-key-32bytes!!!!!';

describe('PendingOAuthFlowRepository (Integration Tests)', () => {
  let testDb: TestDatabaseHelper;
  let repo: PendingOAuthFlowRepository;
  let credentialRepo: CredentialStoreRepository;

  beforeAll(async () => {
    const config = getTestDbConfig();
    testDb = new TestDatabaseHelper({
      ...config,
      schemaSuffix: 'pending_oauth'
    });
    await testDb.connect();
    await testDb.createSchema();
    await testDb.createTables();

    const pool = testDb.getPool();
    repo = new PendingOAuthFlowRepository(pool);
    credentialRepo = new CredentialStoreRepository(pool);
  });

  afterAll(async () => {
    await testDb.dropSchema();
    await testDb.disconnect();
  });

  beforeEach(async () => {
    await testDb.cleanTables();
  });

  // Helper to create a credential (required by FK constraint)
  const createCredential = async (): Promise<string> => {
    return await credentialRepo.save('test-credential', ENCRYPTION_KEY);
  };

  describe('save', () => {
    it('should save a pending OAuth flow', async () => {
      const stateId = randomUUID();
      const credentialId = await createCredential();
      const userId = randomUUID();

      await repo.save(stateId, credentialId, userId);

      const loaded = await repo.load(stateId);
      expect(loaded).toBeDefined();
      expect(loaded?.state_id).toBe(stateId);
      expect(loaded?.credential_id).toBe(credentialId);
      expect(loaded?.user_id).toBe(userId);
    });
  });

  describe('load', () => {
    it('should return null when flow does not exist', async () => {
      const result = await repo.load(randomUUID());
      expect(result).toBeNull();
    });

    it('should return the flow with all fields', async () => {
      const stateId = randomUUID();
      const credentialId = await createCredential();
      const userId = randomUUID();
      await repo.save(stateId, credentialId, userId);

      const result = await repo.load(stateId);

      expect(result).not.toBeNull();
      expect(result?.state_id).toBe(stateId);
      expect(result?.credential_id).toBe(credentialId);
      expect(result?.user_id).toBe(userId);
      expect(result?.created_at).toBeDefined();
    });
  });

  describe('delete', () => {
    it('should return null when flow does not exist', async () => {
      const result = await repo.delete(randomUUID());
      expect(result).toBeNull();
    });

    it('should delete the flow and return credential_id', async () => {
      const stateId = randomUUID();
      const credentialId = await createCredential();
      const userId = randomUUID();
      await repo.save(stateId, credentialId, userId);

      const result = await repo.delete(stateId);
      expect(result).toBe(credentialId);

      const loaded = await repo.load(stateId);
      expect(loaded).toBeNull();
    });
  });

  describe('deleteStale', () => {
    it('should return empty array when no stale flows exist', async () => {
      const stateId = randomUUID();
      const credentialId = await createCredential();
      await repo.save(stateId, credentialId, randomUUID());

      // 0 minutes in the future — nothing should be stale right after creation
      const result = await repo.deleteStale(99999);
      expect(result).toEqual([]);
    });

    it('should delete flows older than the given minutes and return credential_ids', async () => {
      const stateId = randomUUID();
      const credentialId = await createCredential();
      const userId = randomUUID();
      await repo.save(stateId, credentialId, userId);

      // Manually backdate the created_at to make it stale
      await testDb
        .getPool()
        .query(
          `UPDATE "pending_oauth_flows" SET "created_at" = now() - interval '30 minutes' WHERE "state_id" = $1`,
          [stateId]
        );

      const result = await repo.deleteStale(15);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(credentialId);

      const loaded = await repo.load(stateId);
      expect(loaded).toBeNull();
    });

    it('should not delete flows that are not yet stale', async () => {
      const stateId = randomUUID();
      const credentialId = await createCredential();
      await repo.save(stateId, credentialId, randomUUID());

      const result = await repo.deleteStale(60);
      expect(result).toEqual([]);

      const loaded = await repo.load(stateId);
      expect(loaded).not.toBeNull();
    });
  });
});

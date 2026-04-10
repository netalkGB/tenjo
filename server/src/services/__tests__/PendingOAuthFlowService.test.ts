import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PendingOAuthFlowService,
  type PendingOAuthFlowData
} from '../PendingOAuthFlowService';
import type { PendingOAuthFlowRepository } from '../../repositories/PendingOAuthFlowRepository';
import type { CredentialStoreService } from '../CredentialStoreService';

function createMockFlowRepo() {
  return {
    save: vi.fn(),
    load: vi.fn(),
    delete: vi.fn(),
    deleteStale: vi.fn()
  };
}

function createMockCredentialStore() {
  return {
    save: vi.fn(),
    load: vi.fn(),
    exists: vi.fn(),
    delete: vi.fn(),
    update: vi.fn()
  };
}

const sampleData: PendingOAuthFlowData = {
  serverName: 'test-server',
  url: 'https://example.com/oauth',
  clientId: 'client-123',
  clientSecret: 'secret-456',
  clientInfo: { client_id: 'dyn-client', client_secret: 'dyn-secret' },
  codeVerifier: 'pkce-verifier-abc'
};

describe('PendingOAuthFlowService', () => {
  let mockFlowRepo: ReturnType<typeof createMockFlowRepo>;
  let mockCredentialStore: ReturnType<typeof createMockCredentialStore>;
  let service: PendingOAuthFlowService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFlowRepo = createMockFlowRepo();
    mockCredentialStore = createMockCredentialStore();
    service = new PendingOAuthFlowService(
      mockFlowRepo as unknown as PendingOAuthFlowRepository,
      mockCredentialStore as unknown as CredentialStoreService
    );
  });

  describe('save', () => {
    it('should serialize data, store in credential store, and create flow record', async () => {
      mockCredentialStore.save.mockResolvedValue('cred-id-1');
      mockFlowRepo.save.mockResolvedValue(undefined);

      await service.save('state-abc', 'user-1', sampleData);

      expect(mockCredentialStore.save).toHaveBeenCalledWith(
        JSON.stringify(sampleData)
      );
      expect(mockFlowRepo.save).toHaveBeenCalledWith(
        'state-abc',
        'cred-id-1',
        'user-1'
      );
    });
  });

  describe('load', () => {
    it('should clean up stale flows, load from repo, deserialize credential data, and return the entry', async () => {
      mockFlowRepo.deleteStale.mockResolvedValue([]);
      mockFlowRepo.load.mockResolvedValue({
        state_id: 'state-abc',
        credential_id: 'cred-id-1',
        user_id: 'user-1',
        created_at: new Date()
      });
      mockCredentialStore.load.mockResolvedValue(JSON.stringify(sampleData));

      const result = await service.load('state-abc');

      expect(mockFlowRepo.deleteStale).toHaveBeenCalledWith(10);
      expect(mockFlowRepo.load).toHaveBeenCalledWith('state-abc');
      expect(mockCredentialStore.load).toHaveBeenCalledWith('cred-id-1');
      expect(result).toEqual({
        stateId: 'state-abc',
        userId: 'user-1',
        data: sampleData
      });
    });

    it('should return null when flow record is not found in repo', async () => {
      mockFlowRepo.deleteStale.mockResolvedValue([]);
      mockFlowRepo.load.mockResolvedValue(null);

      const result = await service.load('nonexistent-state');

      expect(result).toBeNull();
      // Should not attempt to load from credential store
      expect(mockCredentialStore.load).not.toHaveBeenCalled();
    });

    it('should return null when credential data is not found', async () => {
      mockFlowRepo.deleteStale.mockResolvedValue([]);
      mockFlowRepo.load.mockResolvedValue({
        state_id: 'state-abc',
        credential_id: 'cred-id-missing',
        user_id: 'user-1',
        created_at: new Date()
      });
      mockCredentialStore.load.mockResolvedValue(null);

      const result = await service.load('state-abc');

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete the flow record and associated credential', async () => {
      mockFlowRepo.delete.mockResolvedValue('cred-id-1');
      mockCredentialStore.delete.mockResolvedValue(true);

      await service.delete('state-abc');

      expect(mockFlowRepo.delete).toHaveBeenCalledWith('state-abc');
      expect(mockCredentialStore.delete).toHaveBeenCalledWith('cred-id-1');
    });

    it('should skip credential deletion when flow record is not found', async () => {
      mockFlowRepo.delete.mockResolvedValue(null);

      await service.delete('nonexistent-state');

      expect(mockFlowRepo.delete).toHaveBeenCalledWith('nonexistent-state');
      expect(mockCredentialStore.delete).not.toHaveBeenCalled();
    });
  });

  describe('cleanupStale', () => {
    it('should delete stale flows and their associated credentials', async () => {
      mockFlowRepo.deleteStale.mockResolvedValue([
        'cred-id-1',
        'cred-id-2',
        'cred-id-3'
      ]);
      mockCredentialStore.delete.mockResolvedValue(true);

      await service.cleanupStale();

      expect(mockFlowRepo.deleteStale).toHaveBeenCalledWith(10);
      expect(mockCredentialStore.delete).toHaveBeenCalledTimes(3);
      expect(mockCredentialStore.delete).toHaveBeenCalledWith('cred-id-1');
      expect(mockCredentialStore.delete).toHaveBeenCalledWith('cred-id-2');
      expect(mockCredentialStore.delete).toHaveBeenCalledWith('cred-id-3');
    });

    it('should handle no stale flows gracefully', async () => {
      mockFlowRepo.deleteStale.mockResolvedValue([]);

      await service.cleanupStale();

      expect(mockFlowRepo.deleteStale).toHaveBeenCalledWith(10);
      expect(mockCredentialStore.delete).not.toHaveBeenCalled();
    });
  });
});

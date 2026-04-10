import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CredentialStoreService } from '../CredentialStoreService';
import type { CredentialStoreRepository } from '../../repositories/CredentialStoreRepository';

// Mock env utils — getEncryptionKey returns a fixed test key
vi.mock('../../utils/env', () => ({
  getEncryptionKey: vi.fn().mockReturnValue('test-encryption-key-32chars!!')
}));

function createMockRepo() {
  return {
    save: vi.fn(),
    load: vi.fn(),
    exists: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    pool: vi.fn(),
    insertReturning: vi.fn()
  };
}

describe('CredentialStoreService', () => {
  let mockRepo: ReturnType<typeof createMockRepo>;
  let service: CredentialStoreService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo = createMockRepo();
    service = new CredentialStoreService(
      mockRepo as unknown as CredentialStoreRepository
    );
  });

  describe('save', () => {
    it('should delegate to repository and return the generated ID', async () => {
      mockRepo.save.mockResolvedValue('cred-uuid-1');

      const result = await service.save('my-secret-value');

      expect(result).toBe('cred-uuid-1');
      expect(mockRepo.save).toHaveBeenCalledWith(
        'my-secret-value',
        'test-encryption-key-32chars!!'
      );
    });
  });

  describe('load', () => {
    it('should return the decrypted value when credential exists', async () => {
      mockRepo.load.mockResolvedValue('decrypted-secret');

      const result = await service.load('cred-uuid-1');

      expect(result).toBe('decrypted-secret');
      expect(mockRepo.load).toHaveBeenCalledWith(
        'cred-uuid-1',
        'test-encryption-key-32chars!!'
      );
    });

    it('should return null when credential is not found', async () => {
      mockRepo.load.mockResolvedValue(null);

      const result = await service.load('nonexistent-id');

      expect(result).toBeNull();
    });
  });

  describe('exists', () => {
    it('should return true when credential exists', async () => {
      mockRepo.exists.mockResolvedValue(true);

      const result = await service.exists('cred-uuid-1');

      expect(result).toBe(true);
      expect(mockRepo.exists).toHaveBeenCalledWith('cred-uuid-1');
    });

    it('should return false when credential does not exist', async () => {
      mockRepo.exists.mockResolvedValue(false);

      const result = await service.exists('nonexistent-id');

      expect(result).toBe(false);
    });
  });

  describe('delete', () => {
    it('should return true when credential is deleted', async () => {
      mockRepo.delete.mockResolvedValue(true);

      const result = await service.delete('cred-uuid-1');

      expect(result).toBe(true);
      expect(mockRepo.delete).toHaveBeenCalledWith('cred-uuid-1');
    });

    it('should return false when credential is not found', async () => {
      mockRepo.delete.mockResolvedValue(false);

      const result = await service.delete('nonexistent-id');

      expect(result).toBe(false);
    });
  });

  describe('update', () => {
    it('should return true when credential is updated', async () => {
      mockRepo.update.mockResolvedValue(true);

      const result = await service.update('cred-uuid-1', 'new-secret');

      expect(result).toBe(true);
      expect(mockRepo.update).toHaveBeenCalledWith(
        'cred-uuid-1',
        'new-secret',
        'test-encryption-key-32chars!!'
      );
    });

    it('should return false when credential is not found', async () => {
      mockRepo.update.mockResolvedValue(false);

      const result = await service.update('nonexistent-id', 'new-secret');

      expect(result).toBe(false);
    });
  });
});

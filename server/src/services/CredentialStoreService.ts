import type { CredentialStoreRepository } from '../repositories/CredentialStoreRepository';
import { getEncryptionKey } from '../utils/env';

/**
 * Wraps CredentialStoreRepository with automatic encryption key resolution.
 */
export class CredentialStoreService {
  constructor(
    private readonly credentialStoreRepo: CredentialStoreRepository
  ) {}

  async save(plaintext: string): Promise<string> {
    return this.credentialStoreRepo.save(plaintext, getEncryptionKey());
  }

  async load(id: string): Promise<string | null> {
    return this.credentialStoreRepo.load(id, getEncryptionKey());
  }

  async exists(id: string): Promise<boolean> {
    return this.credentialStoreRepo.exists(id);
  }

  async delete(id: string): Promise<boolean> {
    return this.credentialStoreRepo.delete(id);
  }

  async update(id: string, plaintext: string): Promise<boolean> {
    return this.credentialStoreRepo.update(id, plaintext, getEncryptionKey());
  }
}

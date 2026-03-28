import type { PendingOAuthFlowRepository } from '../repositories/PendingOAuthFlowRepository';
import type { CredentialStoreService } from './CredentialStoreService';

const STALE_FLOW_MINUTES = 10;

/** Serializable data stored (encrypted) in credential_store */
export interface PendingOAuthFlowData {
  serverName: string;
  url: string;
  clientId?: string;
  clientSecret?: string;
  /** Client information obtained during OAuth flow (may differ from clientId/clientSecret if dynamic registration was used) */
  clientInfo?: { client_id: string; client_secret?: string };
  /** PKCE code verifier generated during OAuth flow */
  codeVerifier?: string;
}

export interface PendingOAuthFlowEntry {
  stateId: string;
  userId: string;
  data: PendingOAuthFlowData;
}

export class PendingOAuthFlowService {
  constructor(
    private readonly flowRepo: PendingOAuthFlowRepository,
    private readonly credentialStoreService: CredentialStoreService
  ) {}

  /**
   * Persist a pending OAuth flow. The flow data (serverName, url, clientId,
   * clientSecret) is encrypted in credential_store.
   */
  async save(
    stateId: string,
    userId: string,
    data: PendingOAuthFlowData
  ): Promise<void> {
    const credentialId = await this.credentialStoreService.save(
      JSON.stringify(data)
    );
    await this.flowRepo.save(stateId, credentialId, userId);
  }

  /**
   * Load a pending flow by stateId. Returns null if not found.
   * Also cleans up stale flows.
   */
  async load(stateId: string): Promise<PendingOAuthFlowEntry | null> {
    await this.cleanupStale();

    const row = await this.flowRepo.load(stateId);
    if (!row) return null;

    const json = await this.credentialStoreService.load(row.credential_id);
    if (!json) return null;

    return {
      stateId: row.state_id,
      userId: row.user_id,
      data: JSON.parse(json) as PendingOAuthFlowData
    };
  }

  /**
   * Delete a pending flow and its associated credential_store entry.
   */
  async delete(stateId: string): Promise<void> {
    const credentialId = await this.flowRepo.delete(stateId);
    if (credentialId) {
      await this.credentialStoreService.delete(credentialId);
    }
  }

  /**
   * Remove flows older than STALE_FLOW_MINUTES and their credential_store entries.
   * Uses DB server time (now()) to avoid Node.js/PostgreSQL timezone mismatch.
   */
  async cleanupStale(): Promise<void> {
    const credentialIds = await this.flowRepo.deleteStale(STALE_FLOW_MINUTES);
    await Promise.all(
      credentialIds.map((id) => this.credentialStoreService.delete(id))
    );
  }
}

import { BaseRepository } from './BaseRepository';

export interface PendingOAuthFlowRow {
  state_id: string;
  credential_id: string;
  user_id: string;
  created_at: Date | null;
}

export class PendingOAuthFlowRepository extends BaseRepository {
  async save(
    stateId: string,
    credentialId: string,
    userId: string
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO "pending_oauth_flows" ("state_id", "credential_id", "user_id") VALUES ($1, $2, $3)`,
      [stateId, credentialId, userId]
    );
  }

  async load(stateId: string): Promise<PendingOAuthFlowRow | null> {
    const result = await this.pool.query<PendingOAuthFlowRow>(
      `SELECT "state_id", "credential_id", "user_id", "created_at" FROM "pending_oauth_flows" WHERE "state_id" = $1`,
      [stateId]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  /**
   * Delete a pending flow and return the credential_id so the caller can
   * clean up the associated credential_store entry.
   */
  async delete(stateId: string): Promise<string | null> {
    const result = await this.pool.query<{ credential_id: string }>(
      `DELETE FROM "pending_oauth_flows" WHERE "state_id" = $1 RETURNING "credential_id"`,
      [stateId]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].credential_id;
  }

  /**
   * Delete flows older than the given number of minutes (using DB server time)
   * and return their credential_ids so the caller can clean up credential_store entries.
   */
  async deleteStale(minutes: number): Promise<string[]> {
    const result = await this.pool.query<{ credential_id: string }>(
      `DELETE FROM "pending_oauth_flows" WHERE "created_at" < now() - $1::int * interval '1 minute' RETURNING "credential_id"`,
      [minutes]
    );
    return result.rows.map((r) => r.credential_id);
  }
}

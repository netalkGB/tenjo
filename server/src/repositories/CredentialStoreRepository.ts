import { BaseRepository } from './BaseRepository';

export interface CredentialStoreRow {
  id: string;
  created_at: Date | null;
  updated_at: Date | null;
}

export class CredentialStoreRepository extends BaseRepository {
  /**
   * Insert a new encrypted credential and return its generated UUID.
   */
  async save(plaintext: string, encryptionKey: string): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO "credential_store" ("value") VALUES (pgp_sym_encrypt($1, $2)) RETURNING "id"`,
      [plaintext, encryptionKey]
    );
    return result.rows[0].id;
  }

  /**
   * Load and decrypt a credential by id. Returns null if not found.
   */
  async load(id: string, encryptionKey: string): Promise<string | null> {
    const result = await this.pool.query<{ decrypted_value: string }>(
      `SELECT pgp_sym_decrypt("value", $2) as "decrypted_value" FROM "credential_store" WHERE "id" = $1`,
      [id, encryptionKey]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].decrypted_value;
  }

  /**
   * Check if a credential exists by id (without decrypting).
   */
  async exists(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM "credential_store" WHERE "id" = $1`,
      [id]
    );
    return result.rows.length > 0;
  }

  /**
   * Delete a credential by id. Returns true if a row was deleted.
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM "credential_store" WHERE "id" = $1 RETURNING "id"`,
      [id]
    );
    return result.rows.length > 0;
  }

  /**
   * Update the encrypted value of an existing credential. Returns true if updated.
   */
  async update(
    id: string,
    plaintext: string,
    encryptionKey: string
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE "credential_store" SET "value" = pgp_sym_encrypt($1, $2), "updated_at" = now() WHERE "id" = $3 RETURNING "id"`,
      [plaintext, encryptionKey, id]
    );
    return result.rows.length > 0;
  }
}

import { BaseRepository } from './BaseRepository';
import type { UserRole } from '../types/api';

export interface InvitationCode {
  id: string;
  code: string;
  user_role: UserRole;
  used: boolean;
  used_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export interface InsertInvitationCode {
  id?: string;
  code?: string;
  user_role?: UserRole;
  used?: boolean;
  used_by?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: Date | null;
  updated_at?: Date | null;
}

const COLUMNS = [
  'id',
  'code',
  'user_role',
  'used',
  'used_by',
  'created_by',
  'updated_by',
  'created_at',
  'updated_at'
] as const;

export class InvitationCodeRepository extends BaseRepository {
  async findByCode(code: string): Promise<InvitationCode | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM "invitation_codes" WHERE "code" = $1`,
      [code]
    );
    return result.rows[0] as InvitationCode | undefined;
  }

  async findAll(): Promise<InvitationCode[]> {
    const result = await this.pool.query(`SELECT * FROM "invitation_codes"`);
    return result.rows as InvitationCode[];
  }

  async create(data: InsertInvitationCode): Promise<InvitationCode> {
    return await this.insertReturning<InvitationCode>(
      'invitation_codes',
      { ...data, updated_by: data.updated_by ?? data.created_by },
      COLUMNS
    );
  }

  async markUsed(code: string, userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE "invitation_codes"
          SET "used" = true,
              "used_by" = $1,
              "updated_by" = $1,
              "updated_at" = now()
        WHERE "code" = $2`,
      [userId, code]
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM "invitation_codes" WHERE "id" = $1 RETURNING *`,
      [id]
    );
    return result.rows.length > 0;
  }
}

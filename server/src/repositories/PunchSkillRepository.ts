import { BaseRepository } from './BaseRepository';

export interface PunchSkill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  fs_path: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export interface InsertPunchSkill {
  name: string;
  description: string;
  enabled?: boolean;
  fs_path: string;
  created_by?: string | null;
  updated_by?: string | null;
}

export interface UpdatePunchSkill {
  name?: string;
  description?: string;
  enabled?: boolean;
  fs_path?: string;
  updated_by?: string | null;
  updated_at?: Date;
}

const COLUMNS = [
  'id',
  'name',
  'description',
  'enabled',
  'fs_path',
  'created_by',
  'updated_by',
  'created_at',
  'updated_at'
] as const;

export interface PaginatedPunchSkillResult {
  skills: PunchSkill[];
  totalPages: number;
  currentPage: number;
  totalCount: number;
}

export type PunchSkillEnabledFilter = 'all' | 'enabled' | 'disabled';

export interface PunchSkillListOptions {
  search?: string;
  enabled?: PunchSkillEnabledFilter;
}

function buildListWhere(
  userId: string,
  options: PunchSkillListOptions = {}
): { clause: string; params: unknown[] } {
  const params: unknown[] = [userId];
  const conditions = ['"created_by" = $1'];

  const search = options.search?.trim();
  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `("name" ILIKE $${params.length} OR "description" ILIKE $${params.length})`
    );
  }

  if (options.enabled === 'enabled') {
    conditions.push('"enabled" = true');
  } else if (options.enabled === 'disabled') {
    conditions.push('"enabled" = false');
  }

  return {
    clause: conditions.join(' AND '),
    params
  };
}

export class PunchSkillRepository extends BaseRepository {
  async findByUserId(userId: string): Promise<PunchSkill[]> {
    const result = await this.pool.query(
      `SELECT * FROM "punch_skills" WHERE "created_by" = $1 ORDER BY "name" ASC`,
      [userId]
    );
    return result.rows as PunchSkill[];
  }

  async findEnabledByUserId(userId: string): Promise<PunchSkill[]> {
    const result = await this.pool.query(
      `SELECT * FROM "punch_skills" WHERE "created_by" = $1 AND "enabled" = true ORDER BY "name" ASC`,
      [userId]
    );
    return result.rows as PunchSkill[];
  }

  async findByUserIdFiltered(
    userId: string,
    options: PunchSkillListOptions = {}
  ): Promise<PunchSkill[]> {
    const { clause, params } = buildListWhere(userId, options);
    const result = await this.pool.query(
      `SELECT * FROM "punch_skills" WHERE ${clause} ORDER BY "name" ASC`,
      params
    );
    return result.rows as PunchSkill[];
  }

  /** @deprecated Prefer findByUserIdFiltered with search option. */
  async findByUserIdAndSearch(
    userId: string,
    query: string
  ): Promise<PunchSkill[]> {
    return this.findByUserIdFiltered(userId, { search: query });
  }

  async findPaginated(
    userId: string,
    pageSize: number,
    pageNumber: number,
    options: PunchSkillListOptions = {}
  ): Promise<PaginatedPunchSkillResult> {
    const { clause, params } = buildListWhere(userId, options);

    const countResult = await this.pool.query(
      `SELECT COUNT(*) as count FROM "punch_skills" WHERE ${clause}`,
      params
    );
    const totalCount = Number(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / pageSize);

    const offset = (pageNumber - 1) * pageSize;
    const limitParam = params.length + 1;
    const offsetParam = params.length + 2;
    const result = await this.pool.query(
      `SELECT * FROM "punch_skills"
       WHERE ${clause}
       ORDER BY "name" ASC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, pageSize, offset]
    );

    return {
      skills: result.rows as PunchSkill[],
      totalPages,
      currentPage: pageNumber,
      totalCount
    };
  }

  async findById(id: string): Promise<PunchSkill | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM "punch_skills" WHERE "id" = $1`,
      [id]
    );
    return result.rows[0] as PunchSkill | undefined;
  }

  async findByUserIdAndName(
    userId: string,
    name: string
  ): Promise<PunchSkill | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM "punch_skills" WHERE "created_by" = $1 AND "name" = $2 LIMIT 1`,
      [userId, name]
    );
    return result.rows[0] as PunchSkill | undefined;
  }

  async create(data: InsertPunchSkill): Promise<PunchSkill> {
    return await this.insertReturning<PunchSkill>(
      'punch_skills',
      { ...data },
      COLUMNS
    );
  }

  async update(
    id: string,
    data: UpdatePunchSkill
  ): Promise<PunchSkill | undefined> {
    return await this.updateReturning<PunchSkill>(
      'punch_skills',
      id,
      { ...data },
      COLUMNS
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM "punch_skills" WHERE "id" = $1 RETURNING *`,
      [id]
    );
    return result.rows.length > 0;
  }

  /** Delete all skills for a user and return the removed rows. */
  async deleteByUserId(userId: string): Promise<PunchSkill[]> {
    const result = await this.pool.query(
      `DELETE FROM "punch_skills" WHERE "created_by" = $1 RETURNING *`,
      [userId]
    );
    return result.rows as PunchSkill[];
  }

  async listAllFsPaths(): Promise<string[]> {
    const result = await this.pool.query<{ fs_path: string }>(
      `SELECT "fs_path" FROM "punch_skills"`
    );
    return result.rows.map((row) => row.fs_path);
  }
}

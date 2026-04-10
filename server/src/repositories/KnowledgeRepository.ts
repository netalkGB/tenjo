import { BaseRepository } from './BaseRepository';

export interface Knowledge {
  id: string;
  name: string;
  display_path: string;
  fs_path: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export interface InsertKnowledge {
  name: string;
  display_path: string;
  fs_path: string;
  created_by?: string | null;
  updated_by?: string | null;
}

export interface UpdateKnowledge {
  name?: string;
  display_path?: string;
  updated_by?: string | null;
  updated_at?: Date;
}

const COLUMNS = [
  'id',
  'name',
  'display_path',
  'fs_path',
  'created_by',
  'updated_by',
  'created_at',
  'updated_at'
] as const;

export interface PaginatedKnowledgeResult {
  entries: Knowledge[];
  totalPages: number;
  currentPage: number;
  totalCount: number;
}

export class KnowledgeRepository extends BaseRepository {
  async findByUserId(userId: string): Promise<Knowledge[]> {
    const result = await this.pool.query(
      `SELECT * FROM "knowledge" WHERE "created_by" = $1 ORDER BY "created_at" DESC`,
      [userId]
    );
    return result.rows as Knowledge[];
  }

  async findByUserIdAndName(
    userId: string,
    query: string
  ): Promise<Knowledge[]> {
    const result = await this.pool.query(
      `SELECT * FROM "knowledge" WHERE "created_by" = $1 AND "name" ILIKE $2 ORDER BY "created_at" DESC`,
      [userId, `%${query}%`]
    );
    return result.rows as Knowledge[];
  }

  async findPaginated(
    userId: string,
    pageSize: number,
    pageNumber: number,
    search?: string
  ): Promise<PaginatedKnowledgeResult> {
    const searchPattern = `%${search || ''}%`;

    const countResult = await this.pool.query(
      `SELECT COUNT(*) as count FROM "knowledge" WHERE "created_by" = $1 AND "name" ILIKE $2`,
      [userId, searchPattern]
    );
    const totalCount = Number(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / pageSize);

    const offset = (pageNumber - 1) * pageSize;
    const result = await this.pool.query(
      `SELECT * FROM "knowledge" WHERE "created_by" = $1 AND "name" ILIKE $2 ORDER BY "created_at" DESC LIMIT $3 OFFSET $4`,
      [userId, searchPattern, pageSize, offset]
    );

    return {
      entries: result.rows as Knowledge[],
      totalPages,
      currentPage: pageNumber,
      totalCount
    };
  }

  async existsByUserIdAndExactName(
    userId: string,
    name: string
  ): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM "knowledge" WHERE "created_by" = $1 AND "name" = $2 LIMIT 1`,
      [userId, name]
    );
    return result.rowCount !== null && result.rowCount > 0;
  }

  async findById(id: string): Promise<Knowledge | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM "knowledge" WHERE "id" = $1`,
      [id]
    );
    return result.rows[0] as Knowledge | undefined;
  }

  async findByIds(ids: string[]): Promise<Knowledge[]> {
    if (ids.length === 0) return [];
    const result = await this.pool.query(
      `SELECT * FROM "knowledge" WHERE "id" = ANY($1)`,
      [ids]
    );
    return result.rows as Knowledge[];
  }

  async create(data: InsertKnowledge): Promise<Knowledge> {
    return await this.insertReturning<Knowledge>(
      'knowledge',
      { ...data },
      COLUMNS
    );
  }

  async update(
    id: string,
    data: UpdateKnowledge
  ): Promise<Knowledge | undefined> {
    return await this.updateReturning<Knowledge>(
      'knowledge',
      id,
      { ...data },
      COLUMNS
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM "knowledge" WHERE "id" = $1 RETURNING *`,
      [id]
    );
    return result.rows.length > 0;
  }
}

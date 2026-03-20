import { BaseRepository } from './BaseRepository';

export interface Thread {
  id: string;
  title: string;
  current_leaf_message_id: string | null;
  pinned: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export interface InsertThread {
  id?: string;
  title: string;
  current_leaf_message_id?: string | null;
  pinned?: boolean;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: Date | null;
  updated_at?: Date | null;
}

export type UpdateThread = Partial<InsertThread>;

export type PaginatedThreadsResult = {
  threads: Thread[];
  totalPages: number;
  currentPage: number;
  totalCount: number;
};

const COLUMNS = [
  'id',
  'title',
  'current_leaf_message_id',
  'pinned',
  'created_by',
  'updated_by',
  'created_at',
  'updated_at'
] as const;

export class ThreadRepository extends BaseRepository {
  async findAll(): Promise<Thread[]> {
    const result = await this.pool.query(`SELECT * FROM "threads"`);
    return result.rows as Thread[];
  }

  async findById(id: string): Promise<Thread | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM "threads" WHERE "id" = $1`,
      [id]
    );
    return result.rows[0] as Thread | undefined;
  }

  async findByIdAndUser(
    id: string,
    userId: string
  ): Promise<Thread | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM "threads" WHERE "id" = $1 AND "created_by" = $2`,
      [id, userId]
    );
    return result.rows[0] as Thread | undefined;
  }

  async create(threadData: InsertThread): Promise<Thread | undefined> {
    return await this.insertReturning<Thread>(
      'threads',
      { ...threadData },
      COLUMNS
    );
  }

  async update(
    id: string,
    threadData: UpdateThread
  ): Promise<Thread | undefined> {
    return await this.updateReturning<Thread>(
      'threads',
      id,
      { ...threadData },
      COLUMNS
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM "threads" WHERE "id" = $1 RETURNING *`,
      [id]
    );
    return result.rows.length > 0;
  }

  async findPinned(userId: string): Promise<Thread[]> {
    const result = await this.pool.query(
      `SELECT * FROM "threads" WHERE "pinned" = true AND "created_by" = $1 ORDER BY "created_at" DESC`,
      [userId]
    );
    return result.rows as Thread[];
  }

  async pin(id: string, pinned: boolean): Promise<Thread | undefined> {
    const result = await this.pool.query(
      `UPDATE "threads" SET "pinned" = $1 WHERE "id" = $2 RETURNING *`,
      [pinned, id]
    );
    return result.rows[0] as Thread | undefined;
  }

  async findPaginated(
    userId: string,
    pageSize: number,
    pageNumber: number,
    lastThreadId?: string,
    searchWord?: string
  ): Promise<PaginatedThreadsResult> {
    const searchPattern = `%${searchWord || ''}%`;

    // Get total count (with search criteria applied)
    const countResult = await this.pool.query(
      `SELECT COUNT(*) as count FROM "threads" WHERE "created_by" = $1 AND "title" LIKE $2`,
      [userId, searchPattern]
    );
    const totalCount = Number(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / pageSize);

    let threadsList: Thread[];

    // If lastThreadId is specified, get threads older than that thread
    if (lastThreadId) {
      const lastThread = await this.findByIdAndUser(lastThreadId, userId);
      if (lastThread?.created_at) {
        const result = await this.pool.query(
          `SELECT * FROM "threads" WHERE "created_by" = $1 AND "created_at" < $2 AND "title" LIKE $3 ORDER BY "created_at" DESC LIMIT $4`,
          [userId, lastThread.created_at, searchPattern, pageSize]
        );
        threadsList = result.rows as Thread[];
      } else {
        // Return empty array if lastThreadId is not found
        threadsList = [];
      }
    } else {
      // Standard pagination
      const offset = (pageNumber - 1) * pageSize;
      const result = await this.pool.query(
        `SELECT * FROM "threads" WHERE "created_by" = $1 AND "title" LIKE $2 ORDER BY "created_at" DESC LIMIT $3 OFFSET $4`,
        [userId, searchPattern, pageSize, offset]
      );
      threadsList = result.rows as Thread[];
    }

    return {
      threads: threadsList,
      totalPages,
      currentPage: pageNumber,
      totalCount
    };
  }
}

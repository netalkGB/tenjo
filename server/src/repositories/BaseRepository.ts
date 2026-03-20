import type { Pool, PoolClient } from 'pg';

type QueryExecutor = Pool | PoolClient;

export abstract class BaseRepository {
  protected pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  protected async withTransaction<T>(
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Build a parameterized INSERT query.
   * Column names are taken only from the hardcoded allowedColumns whitelist.
   */
  protected buildInsertQuery(
    tableName: string,
    data: Record<string, unknown>,
    allowedColumns: readonly string[]
  ): { text: string; values: unknown[] } {
    const entries: { col: string; val: unknown }[] = [];
    for (const col of allowedColumns) {
      if (col in data && data[col] !== undefined) {
        entries.push({ col, val: data[col] });
      }
    }
    const columns = entries.map((e) => `"${e.col}"`).join(', ');
    const placeholders = entries.map((_, i) => `$${i + 1}`).join(', ');
    const values = entries.map((e) => e.val);
    const text = `INSERT INTO "${tableName}" (${columns}) VALUES (${placeholders}) RETURNING *`;
    return { text, values };
  }

  /**
   * Build a parameterized UPDATE query.
   * Column names are taken only from the hardcoded allowedColumns whitelist.
   */
  protected buildUpdateQuery(
    tableName: string,
    id: string,
    data: Record<string, unknown>,
    allowedColumns: readonly string[]
  ): { text: string; values: unknown[] } | null {
    const entries: { col: string; val: unknown }[] = [];
    for (const col of allowedColumns) {
      if (col in data && data[col] !== undefined) {
        entries.push({ col, val: data[col] });
      }
    }
    if (entries.length === 0) return null;

    const setClauses = entries
      .map((e, i) => `"${e.col}" = $${i + 1}`)
      .join(', ');
    const values = [...entries.map((e) => e.val), id];
    const text = `UPDATE "${tableName}" SET ${setClauses} WHERE "id" = $${values.length} RETURNING *`;
    return { text, values };
  }

  protected async insertReturning<T>(
    tableName: string,
    data: Record<string, unknown>,
    allowedColumns: readonly string[],
    executor?: QueryExecutor
  ): Promise<T> {
    const query = this.buildInsertQuery(tableName, data, allowedColumns);
    const result = await (executor ?? this.pool).query(
      query.text,
      query.values
    );
    return result.rows[0] as T;
  }

  protected async updateReturning<T>(
    tableName: string,
    id: string,
    data: Record<string, unknown>,
    allowedColumns: readonly string[],
    executor?: QueryExecutor
  ): Promise<T | undefined> {
    const query = this.buildUpdateQuery(tableName, id, data, allowedColumns);
    if (!query) return undefined;
    const result = await (executor ?? this.pool).query(
      query.text,
      query.values
    );
    return result.rows[0] as T | undefined;
  }
}

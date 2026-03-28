import { Pool } from 'pg';
import { ensureDatabaseExists, runAllMigrations } from '../db/runMigration';

export interface TestDbConfig {
  url: string;
  schema: string;
  schemaSuffix?: string;
}

export class TestDatabaseHelper {
  private pool: Pool | null = null;
  private config: TestDbConfig;
  private fullSchemaName: string;

  constructor(config: TestDbConfig) {
    this.config = config;
    this.fullSchemaName = config.schemaSuffix
      ? `${config.schema}_${config.schemaSuffix}`
      : config.schema;
  }

  async connect(): Promise<Pool> {
    await ensureDatabaseExists(this.config.url);

    this.pool = new Pool({
      connectionString: this.config.url,
      options: `-c search_path=${this.fullSchemaName}`
    });

    return this.pool;
  }

  async createSchema(): Promise<void> {
    if (!this.pool) {
      throw new Error('Database not connected. Call connect() first.');
    }
    await this.pool.query(
      `CREATE SCHEMA IF NOT EXISTS "${this.fullSchemaName}"`
    );
  }

  async dropSchema(): Promise<void> {
    if (!this.pool) {
      throw new Error('Database not connected. Call connect() first.');
    }
    await this.pool.query(
      `DROP SCHEMA IF EXISTS "${this.fullSchemaName}" CASCADE`
    );
  }

  async createTables(): Promise<void> {
    if (!this.pool) {
      throw new Error('Database not connected. Call connect() first.');
    }
    // Create extensions before migrations. Extensions are database-level objects,
    // so concurrent CREATE EXTENSION in parallel tests causes race conditions.
    try {
      await this.pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    } catch (err) {
      if ((err as { code?: string }).code !== '23505') throw err;
    }
    await runAllMigrations(this.pool, { isTest: true });
  }

  async cleanTables(): Promise<void> {
    if (!this.pool) {
      throw new Error('Database not connected. Call connect() first.');
    }
    await this.dropSchema();
    await this.createSchema();
    await this.createTables();
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  getPool(): Pool {
    if (!this.pool) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.pool;
  }
}

export const getTestDbConfig = (): TestDbConfig => {
  const url = process.env.DATABASE_URL || '';
  const schema = process.env.DATABASE_SCHEMA || '';

  return { url, schema };
};

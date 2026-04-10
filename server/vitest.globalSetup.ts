import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Pool, Client } from 'pg';

/**
 * Vitest global setup — runs once before any test worker starts.
 * Ensures the test database exists and pgcrypto extension is available.
 * Individual test files create their own schemas (unique per file)
 * for parallel execution safety.
 */
export async function setup(): Promise<void> {
  config({ path: resolve(__dirname, '.env.test') });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be set in .env.test');
  }

  // Ensure database exists (connect to "postgres" DB to check/create)
  const parsed = new Client({ connectionString: databaseUrl });
  const adminPool = new Pool({
    host: parsed.host,
    port: parsed.port,
    user: parsed.user,
    password: parsed.password,
    database: 'postgres'
  });

  try {
    const result = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [parsed.database]
    );
    if (result.rows.length === 0) {
      try {
        await adminPool.query(`CREATE DATABASE "${parsed.database}"`);
      } catch (err) {
        if ((err as { code?: string }).code !== '23505') throw err;
      }
    }
  } finally {
    await adminPool.end();
  }

  // Ensure pgcrypto extension exists (database-level, safe to do once)
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  } catch (err) {
    if ((err as { code?: string }).code !== '23505') throw err;
  } finally {
    await pool.end();
  }
}

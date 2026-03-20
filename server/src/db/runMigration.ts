import { Pool, Client } from 'pg';
import { getDatabaseUrl, getDatabaseSchema } from '../utils/env';
import { migrations } from './migrations';

let databaseCreated = false;

/**
 * Ensure the target database exists. Connects to "postgres" DB to check/create.
 * Cached per process to avoid race conditions in parallel test execution.
 */
export async function ensureDatabaseExists(databaseUrl: string): Promise<void> {
  if (databaseCreated) return;

  const parsed = new Client({ connectionString: databaseUrl });

  const tempPool = new Pool({
    host: parsed.host,
    port: parsed.port,
    user: parsed.user,
    password: parsed.password,
    database: 'postgres'
  });

  try {
    const result = await tempPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [parsed.database]
    );
    if (result.rows.length === 0) {
      try {
        await tempPool.query(`CREATE DATABASE "${parsed.database}"`);
      } catch (err) {
        // Ignore duplicate error from parallel execution
        if ((err as { code?: string }).code !== '23505') throw err;
      }
    }
    databaseCreated = true;
  } finally {
    await tempPool.end();
  }
}

/**
 * Run all unapplied migrations in order, tracking history in "_migrations" table.
 * All pending migrations run in a single transaction.
 */
export async function runMigrations(pool: Pool): Promise<number> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "_migrations" (
      "version" integer PRIMARY KEY,
      "name" varchar(255) NOT NULL,
      "applied_at" timestamp DEFAULT now()
    )
  `);

  const applied = await pool.query(
    `SELECT "version" FROM "_migrations" ORDER BY "version"`
  );
  const appliedVersions = new Set(
    applied.rows.map((r: { version: number }) => r.version)
  );

  const pending = migrations.filter((m) => !appliedVersions.has(m.version));
  if (pending.length === 0) return 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const m of pending) {
      await client.query(m.up);
      await client.query(
        `INSERT INTO "_migrations" ("version", "name") VALUES ($1, $2)`,
        [m.version, m.name]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return pending.length;
}

/**
 * Run all migrations from scratch (no history tracking).
 * Used by test setup where schema is dropped and recreated each time.
 */
export async function runAllMigrations(pool: Pool): Promise<void> {
  for (const m of migrations) {
    await pool.query(m.up);
  }
}

async function main() {
  const databaseUrl = getDatabaseUrl();
  const schemaName = getDatabaseSchema();

  await ensureDatabaseExists(databaseUrl);

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    await pool.query(`SET search_path TO "${schemaName}"`);
    const count = await runMigrations(pool);
    // eslint-disable-next-line no-console
    console.log(
      `Migration completed for schema "${schemaName}" (${count} applied)`
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

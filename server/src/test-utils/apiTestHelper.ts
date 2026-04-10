import { Pool } from 'pg';
import supertest from 'supertest';
import { runAllMigrations } from '../db/runMigration';
import type { InsertUser } from '../repositories/UserRepository';
import type { UserRole } from '../types/api';

// Common test user credentials
export const TEST_ADMIN = {
  userName: 'admin',
  password: 'password123',
  email: 'admin@test.com',
  userRole: 'admin' as UserRole
};

export const TEST_STANDARD = {
  userName: 'standard',
  password: 'password123',
  email: 'standard@test.com',
  userRole: 'standard' as UserRole
};

/**
 * Creates the unique test schema and runs migrations.
 * Must be called in beforeAll BEFORE any app module imports,
 * so that the singleton pool (created on first import) connects
 * to an existing schema.
 */
export async function setupApiTestSchema(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL || '';
  const schemaName = process.env.DATABASE_SCHEMA || '';

  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schemaName},public`
  });

  try {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    // Ensure pgcrypto extension exists (database-level, idempotent)
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    } catch (err) {
      if ((err as { code?: string }).code !== '23505') throw err;
    }
    await runAllMigrations(pool, { isTest: true });
  } finally {
    await pool.end();
  }
}

/**
 * Drops the test schema and closes the app's singleton pool.
 * Must be called in afterAll.
 */
export async function teardownApiTestSchema(): Promise<void> {
  const { pool } = await import('../db/client');
  const schemaName = process.env.DATABASE_SCHEMA || '';
  await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await pool.end();
}

/**
 * Creates a supertest agent with cookie persistence (session is carried across requests).
 */
export async function createApiAgent(): Promise<supertest.Agent> {
  const { app } = await import('../index');
  return supertest.agent(app);
}

interface SeedUserOptions {
  userName?: string;
  password?: string;
  email?: string;
  fullName?: string;
  userRole?: UserRole;
}

/**
 * Inserts a user directly into the database with a plain-text password.
 * Plain-text passwords are supported by the login route in non-production mode.
 */
export async function seedTestUser(options?: SeedUserOptions) {
  const { userRepo } = await import('../repositories/registry');
  const data: InsertUser = {
    full_name: options?.fullName ?? 'Test User',
    user_name: options?.userName ?? 'testuser',
    email: options?.email ?? 'test@example.com',
    password: options?.password ?? 'testpassword',
    user_role: options?.userRole ?? 'standard'
  };
  return userRepo.create(data);
}

/**
 * Logs in via the API and returns the response.
 * The agent's cookie jar retains the session cookie for subsequent requests.
 */
export async function loginAgent(
  agent: supertest.Agent,
  username: string,
  password: string
) {
  return agent.post('/api/login').send({ username, password }).expect(200);
}

/**
 * Truncates all application tables (CASCADE) in the test schema.
 * Preserves the schema and table structure; only removes data.
 */
export async function cleanAllTables(): Promise<void> {
  const { pool } = await import('../db/client');
  const schema = process.env.DATABASE_SCHEMA || '';
  await pool.query(`
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN (
        SELECT tablename FROM pg_tables
        WHERE schemaname = '${schema}'
          AND tablename != '_migrations'
      ) LOOP
        EXECUTE 'TRUNCATE TABLE "' || '${schema}' || '"."' || r.tablename || '" CASCADE';
      END LOOP;
    END $$;
  `);
}

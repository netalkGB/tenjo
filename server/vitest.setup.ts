import path from 'node:path';
import crypto from 'node:crypto';
import { config } from 'dotenv';

// Load test environment variables FIRST (before dotenv/config)
config({ path: path.resolve(__dirname, '.env.test'), quiet: true });

// Generate a unique schema suffix per test file execution.
// With pool: 'forks' and isolate: true, this file runs before each test file
// and module cache is cleared between files. This means each test file gets
// its own DATABASE_SCHEMA → its own singleton pool → parallel-safe execution.
const suffix = crypto.randomUUID().slice(0, 8);
process.env.DATABASE_SCHEMA = `${process.env.DATABASE_SCHEMA}_${suffix}`;

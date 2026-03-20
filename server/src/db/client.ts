import { Pool } from 'pg';
import { getDatabaseUrl, getDatabaseSchema } from '../utils/env';

export const pool = new Pool({
  connectionString: getDatabaseUrl(),
  // Set search_path at connection level via PostgreSQL startup parameter
  options: `-c search_path=${getDatabaseSchema()}`
});

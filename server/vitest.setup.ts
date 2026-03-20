import path from 'node:path';
import { config } from 'dotenv';

// Load test environment variables FIRST (before dotenv/config)
config({ path: path.resolve(__dirname, '.env.test') });

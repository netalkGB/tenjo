import { defineConfig } from '@playwright/test';
import { execSync } from 'child_process';
import crypto from 'crypto';

const seed = process.env.E2E_SEED ?? crypto.randomUUID();
process.env.E2E_SEED = seed;

if (!process.env.E2E_PORT) {
  process.env.E2E_PORT = execSync(
    'node -e "const s=require(\'net\').createServer();s.listen(0,()=>{process.stdout.write(String(s.address().port));s.close()})"'
  )
    .toString()
    .trim();
}
const port = Number(process.env.E2E_PORT);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'html',
  projects: [
    {
      name: 'setup',
      testDir: './e2e/tests/setup',
      fullyParallel: false,
      workers: 1
    },
    {
      name: 'flows',
      testDir: './e2e/tests/flows',
      fullyParallel: true,
      dependencies: ['setup']
    }
  ],
  webServer: {
    command: 'node scripts/e2e-test-setup.js',
    url: `http://localhost:${port}`,
    timeout: 120000,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: `postgresql://postgres:postgres@localhost:5432/llm_chat_e2e_test_${seed}`,
      DATABASE_SCHEMA: `llm_chat_e2e_test_${seed}`,
      SESSION_SECRET: `${seed}`,
      LISTEN_HOST: '0.0.0.0',
      LISTEN_PORT: String(port),
      SINGLE_USER_MODE: 'false',
      ENCRYPTION_KEY: `${seed}`,
      BASE_URL: `http://localhost:${port}/`
    }
  },
  use: {
    trace: 'on-first-retry',
    baseURL: `http://localhost:${port}`,
    headless: false
    // launchOptions: { slowMo: 500 },
  }
});

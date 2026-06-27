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
      // The agent suite runs in its own project (below) so it can stay serial
      // while the regular flow specs remain fully parallel.
      testIgnore: /agent\.spec\.ts/,
      fullyParallel: true,
      dependencies: ['setup']
    },
    {
      // Agent E2E: serial because the coding-agent sandbox is shared by the
      // agent tests. It uses a dedicated agent admin and disables MCP tools only
      // for that user, so it can run alongside the chat/settings admin flows.
      name: 'agent',
      testDir: './e2e/tests/flows',
      testMatch: /agent\.spec\.ts/,
      fullyParallel: false,
      workers: 1,
      // Agent turns drive a real local model, which is occasionally slow/stuck on
      // a turn — retry so a single transient miss doesn't fail (and, in a serial
      // block, skip) the suite.
      retries: 2,
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
    headless: process.env.E2E_HEADLESS === 'true' ? true : false
    // launchOptions: { slowMo: 500 },
  }
});

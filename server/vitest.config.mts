import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    exclude: ['node_modules/**', 'dist/**'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/__tests__/**']
    },
    env: {
      NODE_ENV: 'test'
    },
    globalSetup: [path.resolve(__dirname, 'vitest.globalSetup.ts')],
    setupFiles: [path.resolve(__dirname, 'vitest.setup.ts')],
    pool: 'forks',
    slowTestThreshold: 1000,
    silent: 'passed-only',
    retry: 2
  },
  esbuild: {
    sourcemap: true
  }
});

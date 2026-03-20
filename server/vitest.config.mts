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
    setupFiles: [path.resolve(__dirname, 'vitest.setup.ts')]
  },
  esbuild: {
    sourcemap: true
  }
});

import path from 'path';
import tailwindcss from '@tailwindcss/vite';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import checker from 'vite-plugin-checker';
import svgr from 'vite-plugin-svgr';
import { spawn } from 'child_process';
import type { HmrContext } from 'vite';

function biomeOnChange() {
  return {
    name: 'biome-on-change',
    handleHotUpdate(ctx: HmrContext) {
      if (ctx.file.match(/\.(ts|tsx|css)$/)) {
        spawn('biome', ['format', '--write', ctx.file], {
          stdio: 'inherit',
        });
      }
    },
  };
}
// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    svgr({
      svgrOptions: {
        dimensions: false,
      },
    }),
    tailwindcss(),
    biomeOnChange(),
    checker({
      typescript: true,
      eslint: {
        lintCommand: 'eslint src --ext .js,.jsx,.ts,.tsx',
        useFlatConfig: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});

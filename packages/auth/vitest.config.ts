import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', '__tests__/**/*.test.ts'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@astroid/core': resolve(__dirname, '../core/src'),
      '@astroid/types': resolve(__dirname, '../types/src'),
      '@astroid/errors': resolve(__dirname, '../errors/src'),
      '@astroid/auth': resolve(__dirname, '../auth/src'),
      '@astroid/utils': resolve(__dirname, '../utils/src'),
    },
  },
});

import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@astroid/core': resolve(__dirname, '../core/src/index.ts'),
      '@astroid/errors': resolve(__dirname, '../errors/src/index.ts'),
      '@astroid/types': resolve(__dirname, '../types/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', '__tests__/**/*.test.ts'],
    passWithNoTests: true,
  },
});

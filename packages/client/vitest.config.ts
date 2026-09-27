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
      '@astroid/analytics': resolve(__dirname, '../analytics/src'),
      '@astroid/wallet': resolve(__dirname, '../wallet/src'),
      '@astroid/agent': resolve(__dirname, '../agent/src'),
      '@astroid/policy': resolve(__dirname, '../policy/src'),
      '@astroid/budget': resolve(__dirname, '../budget/src'),
      '@astroid/transaction': resolve(__dirname, '../transaction/src'),
      '@astroid/notification': resolve(__dirname, '../notification/src'),
      '@astroid/webhook': resolve(__dirname, '../webhook/src'),
      '@stellar/stellar-base': '/workspaces/astroid-sdk/node_modules/.pnpm/@stellar+stellar-base@15.0.0/node_modules/@stellar/stellar-base',
    },
  },
});

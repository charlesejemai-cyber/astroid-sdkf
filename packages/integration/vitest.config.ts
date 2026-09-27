import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Integration tests run against the **source** of every `@astroid/*` package
 * rather than its build output.
 *
 * Individual package suites resolve siblings through the pnpm workspace
 * symlinks (i.e. `dist/`), which makes them order-dependent: they only pass
 * after `pnpm build` has produced fresh declarations and bundles. An
 * integration suite that exists precisely to prove the packages cooperate is
 * far more useful as a hermetic check that runs against a fresh clone with a
 * single `pnpm test`, so every workspace specifier is aliased to its source
 * entrypoint here — the same technique `packages/agent/vitest.config.ts` uses.
 *
 * Aliasing *all* of them (not just the ones a test imports directly) keeps a
 * single module instance per package. A partial alias set would resolve, say,
 * `@astroid/errors` to source while `@astroid/client` used the built copy, and
 * `instanceof` assertions would then fail on duplicated class identities.
 */
const WORKSPACE_PACKAGES = [
  'agent',
  'analytics',
  'auth',
  'budget',
  'client',
  'core',
  'errors',
  'notification',
  'policy',
  'transaction',
  'types',
  'utils',
  'wallet',
  'webhook',
] as const;

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      WORKSPACE_PACKAGES.map((name) => [
        `@astroid/${name}`,
        resolve(__dirname, `../${name}/src/index.ts`),
      ]),
    ),
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});

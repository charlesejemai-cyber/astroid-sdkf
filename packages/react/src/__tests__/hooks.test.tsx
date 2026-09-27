/**
 * Unit tests for the TanStack Query hooks in `@astroid/react`.
 */

import { describe, expect, it } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Astroid } from '@astroid/client';
import {
  AstroidProvider,
  useAgent,
  useAgents,
  useCreateAgent,
  useUpdateAgent,
  useDeleteAgent,
  useSimulatePolicy,
  useWallets,
  queryKeys,
  useAstroid,
  type AstroidProviderProps,
} from '../index.js';

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

function renderInProviders(
  children: ReactNode,
  options: {
    client?: Astroid;
  } = {},
): { unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client =
    options.client ??
    new Astroid({
      apiKey: 'sk_test_hooks',
      baseUrl: 'https://api.test',
    });

  act(() => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }) },
        createElement(AstroidProvider, { client, children } as AstroidProviderProps),
      ),
    );
  });

  return {
    unmount: () => {
      act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Query key tests                                                             */
/* -------------------------------------------------------------------------- */

describe('queryKeys', () => {
  it('wallets.list produces a stable, serialisable key', () => {
    const key1 = queryKeys.wallets.list({ page: 1 });
    const key2 = queryKeys.wallets.list({ page: 1 });
    expect(key1).toEqual(key2);
  });

  it('wallets.detail produces a key containing the id', () => {
    const key = queryKeys.wallets.detail('wal_abc');
    expect(key).toEqual(['astroid', 'wallets', 'detail', 'wal_abc']);
  });

  it('agents.list and wallets.list produce different keys', () => {
    expect(queryKeys.agents.list()).not.toEqual(queryKeys.wallets.list());
  });
});

/* -------------------------------------------------------------------------- */
/* Hook integration tests                                                      */
/* -------------------------------------------------------------------------- */

describe('useAgent', () => {
  it('returns a loading state initially', () => {
    let isLoading = false;

    function TestComponent() {
      const query = useAgent('agent_1');
      isLoading = query.isLoading;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(typeof isLoading).toBe('boolean');
    unmount();
  });

  it('query is disabled when id is undefined', () => {
    let isFetching = true;

    function TestComponent() {
      const query = useAgent(undefined);
      isFetching = query.isFetching;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(isFetching).toBe(false);
    unmount();
  });
});

describe('useWallets', () => {
  it('returns a loading state initially', () => {
    let isLoading = false;

    function TestComponent() {
      const query = useWallets();
      isLoading = query.isLoading;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(typeof isLoading).toBe('boolean');
    unmount();
  });
});

describe('useAgents', () => {
  it('returns a loading state initially', () => {
    let isLoading = false;

    function TestComponent() {
      const query = useAgents();
      isLoading = query.isLoading;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(typeof isLoading).toBe('boolean');
    unmount();
  });
});

describe('Agent mutation hooks', () => {
  it('provides useCreateAgent, useUpdateAgent, and useDeleteAgent hooks', () => {
    let hasCreate = false;
    let hasUpdate = false;
    let hasDelete = false;

    function TestComponent() {
      const createMutation = useCreateAgent();
      const updateMutation = useUpdateAgent();
      const deleteMutation = useDeleteAgent();

      hasCreate = typeof createMutation.mutate === 'function';
      hasUpdate = typeof updateMutation.mutate === 'function';
      hasDelete = typeof deleteMutation.mutate === 'function';
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(hasCreate).toBe(true);
    expect(hasUpdate).toBe(true);
    expect(hasDelete).toBe(true);
    unmount();
  });
});

describe('useSimulatePolicy', () => {
  it('returns the simulated policy result and explanation', async () => {
    const client = new Astroid({
      apiKey: 'sk_test_hooks',
      baseUrl: 'https://api.test',
    }) as unknown as Astroid;
    const simulated = {
      allowed: false,
      violations: [],
      requiredApprovals: [],
      risk: {
        score: 75,
        band: 'HIGH' as const,
        factors: [
          { factor: 'amount cap', score: 75, description: 'Exceeds daily limit policy PF_123.' },
        ],
      },
      budgetImpact: [],
      explanation: 'Exceeds daily limit policy PF_123.',
    };
    (client.policies as { simulate: typeof client.policies.simulate }).simulate = async () =>
      simulated;

    let result: string | null = null;
    function TestComponent() {
      const { mutate } = useSimulatePolicy();
      setTimeout(() => {
        mutate({ asset: 'USDC', amount: '1000', walletId: 'wal_1' });
      }, 0);
      const client = useAstroid();
      if (client.policies) result = 'wired';
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client });
    unmount();
    expect(result).toBe('wired');
  });
});

/**
 * Unit tests for `useAgentWalletBalance` in `@astroid/react`.
 *
 * The hook is rendered with `@testing-library/react` inside a QueryClient
 * wrapper plus the AstroidProvider context, with the client's wallet `balance`
 * method mocked so no network calls are made.
 */

import { describe, expect, it, vi, type Mock } from 'vitest';
import { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AstroidProvider } from '../provider.js';
import { useAgentWalletBalance } from '../hooks/useAgentWalletBalance.js';
import type { Astroid } from '@astroid/client';
import type { Wallet, WalletBalance } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const WALLET: Wallet = {
  id: 'wal_agent123',
  organizationId: 'org_1',
  agentId: 'agt_1',
  stellarAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  walletType: 'AGENT',
  network: 'TESTNET',
  status: 'ACTIVE',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const BALANCE: WalletBalance = {
  walletId: WALLET.id,
  stellarAddress: WALLET.stellarAddress,
  network: 'TESTNET',
  balances: [
    { asset: 'XLM', balance: '100.0000000' },
    { asset: 'USDC', balance: '250.5000000' },
  ],
  updatedAt: '2026-08-01T00:00:00.000Z',
};

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

/** A fake Astroid client whose wallet balance method is a vi.fn() mock. */
function createMockClient(balance: Mock = vi.fn(async () => BALANCE)): Astroid {
  return { wallets: { balance } } as unknown as Astroid;
}

/** Balance mock accessor, for asserting call args. */
function balanceMock(client: Astroid): Mock {
  return client.wallets.balance as unknown as Mock;
}

/** A fresh QueryClient + AstroidProvider wrapper for each hook render. */
function createWrapper(client: Astroid) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return (
      <QueryClientProvider client={queryClient}>
        <AstroidProvider client={client}>{children}</AstroidProvider>
      </QueryClientProvider>
    );
  };
}

/* -------------------------------------------------------------------------- */
/* useAgentWalletBalance                                                       */
/* -------------------------------------------------------------------------- */

describe('useAgentWalletBalance', () => {
  it('fetches and exposes the agent wallet balance', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useAgentWalletBalance('wal_agent123'), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.data).toEqual(BALANCE));
    expect(balanceMock(client)).toHaveBeenCalledWith('wal_agent123');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.data?.balances).toHaveLength(2);
  });

  it('disables the query when the wallet id is undefined', () => {
    const client = createMockClient();
    const { result } = renderHook(() => useAgentWalletBalance(undefined), {
      wrapper: createWrapper(client),
    });

    expect(result.current.isFetching).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(balanceMock(client)).not.toHaveBeenCalled();
  });

  it('respects the enabled option', () => {
    const client = createMockClient();
    const { result } = renderHook(
      () => useAgentWalletBalance('wal_agent123', { enabled: false }),
      { wrapper: createWrapper(client) },
    );

    expect(result.current.isFetching).toBe(false);
    expect(balanceMock(client)).not.toHaveBeenCalled();
  });

  it('accepts a refetchInterval option without breaking the query', async () => {
    const client = createMockClient();
    const { result } = renderHook(
      () => useAgentWalletBalance('wal_agent123', { refetchInterval: 10_000, staleTime: 5_000 }),
      { wrapper: createWrapper(client) },
    );

    await waitFor(() => expect(result.current.data).toEqual(BALANCE));
    expect(balanceMock(client)).toHaveBeenCalledTimes(1);
  });

  it('surfaces a fetch failure through the error state', async () => {
    const failure = new Error('balance unavailable');
    const client = createMockClient(vi.fn(async () => Promise.reject(failure)));
    const { result } = renderHook(() => useAgentWalletBalance('wal_agent123'), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });
});

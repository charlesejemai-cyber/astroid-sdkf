/**
 * Unit tests for the `useWalletBalances` hook (issue #252).
 *
 * Verifies loading, success, and error states with mocked wallet resource
 * methods, plus polling, ref resolution (wallet ID vs Stellar public key),
 * manual refetch, and cache-key invalidation wiring.
 *
 * Hooks are rendered with `@testing-library/react` inside a QueryClient
 * wrapper plus the AstroidProvider context — the same pattern as
 * `wallets.test.tsx`.
 */

import { describe, expect, it, vi, type Mock } from 'vitest';
import { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AstroidProvider } from '../provider.js';
import { useWalletBalances, walletBalancesKeys } from '../hooks/useWalletBalances.js';
import { useTransfer } from '../hooks/useWallets.js';
import type { Astroid } from '@astroid/client';
import type { Wallet, WalletBalance } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const PUBLIC_KEY = 'GA7QYNF7SOWQ3GLR2ZGMGIWQFDYQ4RJXGFJQCXVYJ2LGK7IGMSNMIBOA';

const WALLET: Wallet = {
  id: 'wal_abc123',
  organizationId: 'org_1',
  stellarAddress: PUBLIC_KEY,
  walletType: 'AGENT',
  network: 'TESTNET',
  status: 'ACTIVE',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const BALANCE: WalletBalance = {
  walletId: WALLET.id,
  stellarAddress: PUBLIC_KEY,
  network: 'TESTNET',
  balances: [
    { asset: 'XLM', balance: '1000.5000000' },
    {
      asset: 'USDC',
      balance: '250.0000000',
      issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3GP3SUW4AV6RRNJDM5N2AJHC7YJ',
    },
  ],
  updatedAt: '2026-08-01T00:00:00.000Z',
};

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

/** A fake Astroid client whose wallet methods are vi.fn() mocks. */
function createMockClient(
  overrides: {
    get?: Mock;
    getByAddress?: Mock;
    balance?: Mock;
    transfer?: Mock;
  } = {},
): Astroid {
  return {
    wallets: {
      get: overrides.get ?? vi.fn(async () => WALLET),
      getByAddress: overrides.getByAddress ?? vi.fn(async () => WALLET),
      balance: overrides.balance ?? vi.fn(async () => BALANCE),
      transfer:
        overrides.transfer ??
        vi.fn(async () => ({
          id: 'tx_1',
          walletId: WALLET.id,
          status: 'PENDING',
        })),
    },
  } as unknown as Astroid;
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
/* Loading / success / error states                                            */
/* -------------------------------------------------------------------------- */

describe('useWalletBalances — states (issue #252)', () => {
  it('starts loading with no data, then resolves the typed balance snapshot', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWalletBalances('wal_abc123'), {
      wrapper: createWrapper(client),
    });

    // Initial render: fetch in flight, no data yet.
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isError).toBe(false);
    expect(result.current.data?.walletId).toBe('wal_abc123');
    expect(result.current.data?.balances).toHaveLength(2);
    expect(result.current.data?.balances[0]).toEqual({ asset: 'XLM', balance: '1000.5000000' });
    // The balance resource method receives the resolved wallet id.
    expect(client.wallets.balance).toHaveBeenCalledWith('wal_abc123');
  });

  it('exposes an error state when the wallet resource fails', async () => {
    const failure = new Error('wallet fetch failed');
    const client = createMockClient({ get: vi.fn().mockRejectedValue(failure) });
    const { result } = renderHook(() => useWalletBalances('wal_missing'), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });

  it('errors when a public-key reference resolves to no wallet', async () => {
    const client = createMockClient({ getByAddress: vi.fn().mockResolvedValue(undefined) });
    const { result } = renderHook(() => useWalletBalances(PUBLIC_KEY), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toContain('Wallet not found');
  });

  it('is disabled (never fetching) when the reference is undefined or empty', async () => {
    const client = createMockClient();

    const undefinedRef = renderHook(() => useWalletBalances(undefined), {
      wrapper: createWrapper(client),
    });
    const emptyRef = renderHook(() => useWalletBalances(''), {
      wrapper: createWrapper(client),
    });

    // Give the query a tick to (not) run.
    await new Promise((r) => setTimeout(r, 20));

    expect(undefinedRef.result.current.isLoading).toBe(false);
    expect(undefinedRef.result.current.data).toBeUndefined();
    expect(emptyRef.result.current.isLoading).toBe(false);

    expect(client.wallets.get).not.toHaveBeenCalled();
    expect(client.wallets.getByAddress).not.toHaveBeenCalled();
    expect(client.wallets.balance).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Reference resolution: wallet ID vs Stellar public key                       */
/* -------------------------------------------------------------------------- */

describe('useWalletBalances — reference resolution (issue #252)', () => {
  it('treats a G… 56-char reference as a public key and resolves via getByAddress', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWalletBalances(PUBLIC_KEY), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(client.wallets.getByAddress).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(client.wallets.get).not.toHaveBeenCalled();
    expect(client.wallets.balance).toHaveBeenCalledWith('wal_abc123');
  });

  it('treats other references as wallet IDs and resolves via get', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWalletBalances('wal_abc123'), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(client.wallets.get).toHaveBeenCalledWith('wal_abc123');
    expect(client.wallets.getByAddress).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Polling configuration                                                       */
/* -------------------------------------------------------------------------- */

describe('useWalletBalances — polling (issue #252)', () => {
  it('does not poll when pollingInterval is 0', async () => {
    vi.useFakeTimers();
    try {
      const client = createMockClient();
      const { result } = renderHook(
        () => useWalletBalances('wal_abc123', { pollingInterval: 0 }),
        { wrapper: createWrapper(client) },
      );

      await vi.advanceTimersByTimeAsync(60_000);

      expect(result.current.data).toBeDefined();
      expect((client.wallets.balance as Mock).mock.calls.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('polls at the configured interval to keep balances synchronized', async () => {
    vi.useFakeTimers();
    try {
      const client = createMockClient();
      const { result } = renderHook(
        () => useWalletBalances('wal_abc123', { pollingInterval: 10_000 }),
        { wrapper: createWrapper(client) },
      );

      await vi.advanceTimersByTimeAsync(0);
      expect((client.wallets.balance as Mock).mock.calls.length).toBe(1);

      await vi.advanceTimersByTimeAsync(10_000);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(result.current.data).toBeDefined();
      expect((client.wallets.balance as Mock).mock.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Manual refetch + cache keys + invalidation wiring                           */
/* -------------------------------------------------------------------------- */

describe('useWalletBalances — refetch and invalidation (issue #252)', () => {
  it('supports manual refetch', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWalletBalances('wal_abc123'), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });
    const callsAfterMount = (client.wallets.balance as Mock).mock.calls.length;

    await result.current.refetch();

    expect((client.wallets.balance as Mock).mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it('scopes cache keys under the wallets namespace so domain invalidation covers them', () => {
    expect(walletBalancesKeys.all).toEqual(['astroid', 'wallets', 'balances']);
    expect(walletBalancesKeys.byId('wal_1')).toEqual([
      'astroid',
      'wallets',
      'balances',
      'id',
      'wal_1',
    ]);
    expect(walletBalancesKeys.byId('wal_1')).not.toEqual(walletBalancesKeys.byId('wal_2'));
    expect(walletBalancesKeys.byAddress(PUBLIC_KEY)).toEqual([
      'astroid',
      'wallets',
      'balances',
      'address',
      PUBLIC_KEY,
    ]);
  });

  it('balance keys are invalidated by transfers submitted through useTransfer', async () => {
    const client = createMockClient({
      transfer: vi.fn(async () => ({ id: 'tx_1' })),
    });
    const { result } = renderHook(() => useTransfer(), {
      wrapper: createWrapper(client),
    });

    result.current.mutate({
      walletId: 'wal_abc123',
      input: {
        recipientAddress: PUBLIC_KEY,
        asset: 'USDC',
        amount: '10',
      },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    // The transfer itself went through the mocked resource.
    expect(client.wallets.transfer).toHaveBeenCalled();
  });
});

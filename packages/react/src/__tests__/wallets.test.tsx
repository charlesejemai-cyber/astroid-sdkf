/**
 * Unit tests for the wallet hooks in `@astroid/react` — useWallet, useWallets,
 * useWalletBalance, useTransfer, and useWalletMutation.
 *
 * Hooks are rendered with `@testing-library/react` inside a QueryClient
 * wrapper plus the AstroidProvider context, with the client's wallet methods
 * mocked so no network calls are made.
 */

import { describe, expect, it, vi, type Mock } from 'vitest';
import { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AstroidProvider } from '../provider.js';
import {
  useWallet,
  useWallets,
  useWalletBalance,
  useTransfer,
  useWalletMutation,
} from '../hooks.js';
import type { Astroid } from '@astroid/client';
import type { Paginated, Transaction, Wallet, WalletBalance } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const WALLET: Wallet = {
  id: 'wal_abc123',
  organizationId: 'org_1',
  stellarAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  walletType: 'AGENT',
  network: 'TESTNET',
  status: 'ACTIVE',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const PAGE: Paginated<Wallet> = {
  data: [WALLET],
  meta: {
    page: 1,
    limit: 25,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

const BALANCE: WalletBalance = {
  walletId: WALLET.id,
  stellarAddress: WALLET.stellarAddress,
  network: 'TESTNET',
  balances: [{ asset: 'XLM', balance: '100.0000000' }],
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const TRANSACTION: Transaction = {
  id: 'tx_1',
  organizationId: 'org_1',
  walletId: WALLET.id,
  asset: 'USDC',
  amount: '10',
  recipientAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  status: 'PENDING',
  riskScore: 0,
  riskBand: 'LOW',
  requiresApproval: false,
  confirmationCount: 0,
  metadata: {},
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

/** A fake Astroid client whose wallet methods are all vi.fn() mocks. */
function createMockClient(): Astroid {
  return {
    wallets: {
      get: vi.fn(async () => WALLET),
      list: vi.fn(async () => PAGE),
      balance: vi.fn(async () => BALANCE),
      create: vi.fn(async () => WALLET),
      import: vi.fn(async () => WALLET),
      update: vi.fn(async () => WALLET),
      freeze: vi.fn(async () => WALLET),
      unfreeze: vi.fn(async () => WALLET),
      archive: vi.fn(async () => WALLET),
      transfer: vi.fn(async () => TRANSACTION),
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

/** The mocked wallet resource surface, for asserting call args. */
interface MockWalletResource {
  get: Mock;
  list: Mock;
  balance: Mock;
  create: Mock;
  import: Mock;
  update: Mock;
  freeze: Mock;
  unfreeze: Mock;
  archive: Mock;
  transfer: Mock;
}

function walletMethods(client: Astroid): MockWalletResource {
  return client.wallets as unknown as MockWalletResource;
}

/* -------------------------------------------------------------------------- */
/* useWallet                                                                   */
/* -------------------------------------------------------------------------- */

describe('useWallet', () => {
  it('fetches a single wallet by id', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWallet('wal_abc123'), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.data).toEqual(WALLET));
    expect(walletMethods(client).get).toHaveBeenCalledWith('wal_abc123');
    expect(result.current.isLoading).toBe(false);
  });

  it('is disabled when no id is provided', () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWallet(undefined), {
      wrapper: createWrapper(client),
    });

    expect(result.current.isFetching).toBe(false);
    expect(walletMethods(client).get).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* useWallets                                                                  */
/* -------------------------------------------------------------------------- */

describe('useWallets', () => {
  it('fetches a paginated wallet list', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWallets({ limit: 25 }), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.data?.data).toEqual([WALLET]));
    expect(walletMethods(client).list).toHaveBeenCalledWith({ limit: 25 });
  });

  it('exposes the pagination metadata from the response', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWallets(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.data?.meta.total).toBe(1));
  });
});

/* -------------------------------------------------------------------------- */
/* useWalletBalance                                                            */
/* -------------------------------------------------------------------------- */

describe('useWalletBalance', () => {
  it('fetches live balances for a wallet', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWalletBalance('wal_abc123'), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.data).toEqual(BALANCE));
    expect(walletMethods(client).balance).toHaveBeenCalledWith('wal_abc123');
  });

  it('is disabled when no wallet id is provided', () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWalletBalance(undefined), {
      wrapper: createWrapper(client),
    });

    expect(result.current.isFetching).toBe(false);
    expect(walletMethods(client).balance).not.toHaveBeenCalled();
  });

  it('respects the enabled option', () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWalletBalance('wal_abc123', { enabled: false }), {
      wrapper: createWrapper(client),
    });

    expect(result.current.isFetching).toBe(false);
    expect(walletMethods(client).balance).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* useTransfer                                                                 */
/* -------------------------------------------------------------------------- */

describe('useTransfer', () => {
  it('calls wallets.transfer with the wallet id and payload', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useTransfer(), {
      wrapper: createWrapper(client),
    });

    result.current.mutate({
      walletId: 'wal_abc123',
      input: { recipientAddress: WALLET.stellarAddress, asset: 'USDC', amount: '10' },
    });

    await waitFor(() =>
      expect(walletMethods(client).transfer).toHaveBeenCalledWith(
        'wal_abc123',
        expect.objectContaining({ asset: 'USDC', amount: '10' }),
      ),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(TRANSACTION);
  });

  it('invalidates balance and detail queries on transfer success', async () => {
    const client = createMockClient();
    const { result } = renderHook(
      () => ({
        balance: useWalletBalance('wal_abc123'),
        detail: useWallet('wal_abc123'),
        transfer: useTransfer(),
      }),
      { wrapper: createWrapper(client) },
    );

    await waitFor(() => expect(result.current.balance.data).toEqual(BALANCE));
    await waitFor(() => expect(result.current.detail.data).toEqual(WALLET));
    const balanceCalls = walletMethods(client).balance.mock.calls.length;
    const detailCalls = walletMethods(client).get.mock.calls.length;

    result.current.transfer.mutate({
      walletId: 'wal_abc123',
      input: { recipientAddress: WALLET.stellarAddress, asset: 'USDC', amount: '10' },
    });

    await waitFor(() => expect(result.current.transfer.isSuccess).toBe(true));
    await waitFor(() =>
      expect(walletMethods(client).balance.mock.calls.length).toBeGreaterThan(balanceCalls),
    );
    await waitFor(() =>
      expect(walletMethods(client).get.mock.calls.length).toBeGreaterThan(detailCalls),
    );
  });

  it('supports custom invalidateQueries and onSuccess callback in useTransfer', async () => {
    const client = createMockClient();
    const onSuccess = vi.fn();
    const customKey = ['custom', 'key'] as const;

    const { result } = renderHook(
      () =>
        useTransfer({
          invalidateQueries: [customKey],
          onSuccess,
        }),
      { wrapper: createWrapper(client) },
    );

    result.current.mutate({
      walletId: 'wal_abc123',
      input: { recipientAddress: WALLET.stellarAddress, asset: 'USDC', amount: '10' },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(onSuccess).toHaveBeenCalledWith(
      TRANSACTION,
      expect.objectContaining({ walletId: 'wal_abc123' }),
      undefined,
    );
  });

  it('respects invalidateOnSuccess: false in useTransfer', async () => {
    const client = createMockClient();
    const { result } = renderHook(
      () => ({
        balance: useWalletBalance('wal_abc123'),
        transfer: useTransfer({ invalidateOnSuccess: false }),
      }),
      { wrapper: createWrapper(client) },
    );

    await waitFor(() => expect(result.current.balance.data).toEqual(BALANCE));
    const balanceCalls = walletMethods(client).balance.mock.calls.length;

    result.current.transfer.mutate({
      walletId: 'wal_abc123',
      input: { recipientAddress: WALLET.stellarAddress, asset: 'USDC', amount: '10' },
    });

    await waitFor(() => expect(result.current.transfer.isSuccess).toBe(true));
    expect(walletMethods(client).balance.mock.calls.length).toBe(balanceCalls);
  });
});

/* -------------------------------------------------------------------------- */
/* useWalletMutation                                                           */
/* -------------------------------------------------------------------------- */

describe('useWalletMutation', () => {
  it('dispatches create to wallets.create', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWalletMutation(), {
      wrapper: createWrapper(client),
    });

    result.current.mutate({ action: 'create', input: { label: 'Ops' } });

    await waitFor(() =>
      expect(walletMethods(client).create).toHaveBeenCalledWith({ label: 'Ops' }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(WALLET);
  });

  it('dispatches import to wallets.import', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWalletMutation(), {
      wrapper: createWrapper(client),
    });

    result.current.mutate({
      action: 'import',
      input: { stellarAddress: WALLET.stellarAddress },
    });

    await waitFor(() =>
      expect(walletMethods(client).import).toHaveBeenCalledWith({
        stellarAddress: WALLET.stellarAddress,
      }),
    );
  });

  it('dispatches update to wallets.update with the wallet id and payload', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWalletMutation(), {
      wrapper: createWrapper(client),
    });

    result.current.mutate({ action: 'update', walletId: 'wal_abc123', input: { label: 'Ops' } });

    await waitFor(() =>
      expect(walletMethods(client).update).toHaveBeenCalledWith('wal_abc123', { label: 'Ops' }),
    );
  });

  it('dispatches freeze/unfreeze/archive with the wallet id', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWalletMutation(), {
      wrapper: createWrapper(client),
    });

    result.current.mutate({ action: 'freeze', walletId: 'wal_abc123' });
    await waitFor(() => expect(walletMethods(client).freeze).toHaveBeenCalledWith('wal_abc123'));

    result.current.mutate({ action: 'unfreeze', walletId: 'wal_abc123' });
    await waitFor(() => expect(walletMethods(client).unfreeze).toHaveBeenCalledWith('wal_abc123'));

    result.current.mutate({ action: 'archive', walletId: 'wal_abc123' });
    await waitFor(() => expect(walletMethods(client).archive).toHaveBeenCalledWith('wal_abc123'));
  });

  it('dispatches transfer to wallets.transfer', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWalletMutation(), {
      wrapper: createWrapper(client),
    });

    result.current.mutate({
      action: 'transfer',
      walletId: 'wal_abc123',
      input: { recipientAddress: WALLET.stellarAddress, asset: 'USDC', amount: '10' },
    });

    await waitFor(() =>
      expect(walletMethods(client).transfer).toHaveBeenCalledWith(
        'wal_abc123',
        expect.objectContaining({ asset: 'USDC' }),
      ),
    );
  });

  it('invalidates the wallet balance query after a transfer', async () => {
    const client = createMockClient();
    const { result } = renderHook(
      () => ({
        balance: useWalletBalance('wal_abc123'),
        mutation: useWalletMutation(),
      }),
      { wrapper: createWrapper(client) },
    );

    // Prime the balance query.
    await waitFor(() => expect(result.current.balance.data).toEqual(BALANCE));
    const balanceCalls = walletMethods(client).balance.mock.calls.length;

    result.current.mutation.mutate({
      action: 'transfer',
      walletId: 'wal_abc123',
      input: { recipientAddress: WALLET.stellarAddress, asset: 'USDC', amount: '10' },
    });

    await waitFor(() =>
      expect(walletMethods(client).balance.mock.calls.length).toBeGreaterThan(balanceCalls),
    );
  });

  it('supports custom invalidateQueries function and onSuccess callback in useWalletMutation', async () => {
    const client = createMockClient();
    const onSuccess = vi.fn();
    const customFn = vi.fn((_data, vars) => [
      ['custom', 'key', (vars as { walletId?: string }).walletId ?? 'all'] as const,
    ]);

    const { result } = renderHook(
      () =>
        useWalletMutation({
          invalidateQueries: customFn,
          onSuccess,
        }),
      { wrapper: createWrapper(client) },
    );

    result.current.mutate({
      action: 'freeze',
      walletId: 'wal_abc123',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(customFn).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith(
      WALLET,
      expect.objectContaining({ action: 'freeze', walletId: 'wal_abc123' }),
      undefined,
    );
  });

  it('respects invalidateOnSuccess: false in useWalletMutation', async () => {
    const client = createMockClient();
    const { result } = renderHook(
      () => ({
        balance: useWalletBalance('wal_abc123'),
        mutation: useWalletMutation({ invalidateOnSuccess: false }),
      }),
      { wrapper: createWrapper(client) },
    );

    await waitFor(() => expect(result.current.balance.data).toEqual(BALANCE));
    const balanceCalls = walletMethods(client).balance.mock.calls.length;

    result.current.mutation.mutate({
      action: 'transfer',
      walletId: 'wal_abc123',
      input: { recipientAddress: WALLET.stellarAddress, asset: 'USDC', amount: '10' },
    });

    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
    expect(walletMethods(client).balance.mock.calls.length).toBe(balanceCalls);
  });
});

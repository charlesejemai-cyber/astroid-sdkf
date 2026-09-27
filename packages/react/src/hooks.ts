import { useContext } from 'react';
import { useMutation, useQuery, type QueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { AstroidClientContext } from './provider.js';
import type { Astroid } from '@astroid/client';
import type {
  Agent,
  Paginated,
  PaginationParams,
  PolicySimulationRequest,
  PolicySimulationResult,
} from '@astroid/types';

export { useCreateAgent, useUpdateAgent, useDeleteAgent } from './hooks/useAgents.js';
export {
  useWallet,
  useWallets,
  useWalletBalance,
  useTransfer,
  useWalletMutation,
  type WalletMutationVariables,
  type WalletMutationResult,
  type TransferVariables,
  type UseWalletBalanceOptions,
  type WalletMutationOptions,
  type UseTransferOptions,
  type UseWalletMutationOptions,
} from './hooks/useWallets.js';
export {
  useWalletBalances,
  useInvalidateWalletBalances,
  walletBalancesKeys,
  type UseWalletBalancesOptions,
  type UseWalletBalancesResult,
} from './hooks/useWalletBalances.js';

/**
 * Retrieve the active {@link Astroid} client instance from the React context.
 *
 * @throws Error if called outside an {@link AstroidProvider}.
 */
export function useAstroid(): Astroid {
  const client = useContext(AstroidClientContext);
  if (!client) {
    throw new Error(
      'useAstroid must be used within an <AstroidProvider>. Wrap your component tree with <AstroidProvider client={client}>.',
    );
  }
  return client;
}

/**
 * Alias for {@link useAstroid} to match naming conventions.
 */
export function useAstroidClient(): Astroid {
  return useAstroid();
}

/**
 * Centralized query key factory for TanStack Query caching and invalidation.
 *
 * All keys are prefixed with `'astroid'` and namespaced by resource domain.
 * Keys are stable (`as const`) so TanStack Query's structural equality
 * comparison works correctly for cache lookups and invalidation.
 *
 * @example
 * ```ts
 * // Exact key for a single wallet detail:
 * queryKeys.wallets.detail('wal_abc123')
 * // => ['astroid', 'wallets', 'detail', 'wal_abc123']
 *
 * // Invalidate all wallet queries:
 * queryClient.invalidateQueries({ queryKey: queryKeys.wallets.all });
 *
 * // Invalidate just the wallet list:
 * queryClient.invalidateQueries({ queryKey: queryKeys.wallets.list() });
 * ```
 */
export const queryKeys = {
  wallets: {
    all: ['astroid', 'wallets'] as const,
    list: (params?: PaginationParams) => ['astroid', 'wallets', 'list', params ?? {}] as const,
    detail: (id: string) => ['astroid', 'wallets', 'detail', id] as const,
    balance: (id: string) => ['astroid', 'wallets', 'detail', id, 'balance'] as const,
  },
  agents: {
    all: ['astroid', 'agents'] as const,
    list: (params?: PaginationParams) => ['astroid', 'agents', 'list', params ?? {}] as const,
    detail: (id: string) => ['astroid', 'agents', 'detail', id] as const,
  },
  policies: {
    all: ['astroid', 'policies'] as const,
    list: (params?: PaginationParams) => ['astroid', 'policies', 'list', params ?? {}] as const,
    detail: (id: string) => ['astroid', 'policies', 'detail', id] as const,
  },
  budgets: {
    all: ['astroid', 'budgets'] as const,
    list: (params?: PaginationParams) => ['astroid', 'budgets', 'list', params ?? {}] as const,
    detail: (id: string) => ['astroid', 'budgets', 'detail', id] as const,
    utilization: (id: string) => ['astroid', 'budgets', 'detail', id, 'utilization'] as const,
  },
} as const;

/**
 * Invalidation helpers for typed cache invalidation by resource domain.
 *
 * These helpers provide a clean API for invalidating queries by resource type
 * or specific entity ID, without requiring callers to know the key structure.
 *
 * @example
 * ```ts
 * // After a mutation, invalidate the agents list:
 * await invalidateQueries.agents(queryClient);
 *
 * // Invalidate a specific agent's detail:
 * await invalidateQueries.agent(queryClient, 'agent_abc123');
 * ```
 */
export const invalidateQueries = {
  /** Invalidate all queries for a specific resource domain. */
  all: (queryClient: QueryClient, domain: 'wallets' | 'agents' | 'policies' | 'budgets') => {
    return queryClient.invalidateQueries({ queryKey: queryKeys[domain].all });
  },
  /** Invalidate the list query for a specific resource domain. */
  wallets: (queryClient: QueryClient, params?: PaginationParams) => {
    return queryClient.invalidateQueries({ queryKey: queryKeys.wallets.list(params) });
  },
  agents: (queryClient: QueryClient, params?: PaginationParams) => {
    return queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(params) });
  },
  policies: (queryClient: QueryClient, params?: PaginationParams) => {
    return queryClient.invalidateQueries({ queryKey: queryKeys.policies.list(params) });
  },
  budgets: (queryClient: QueryClient, params?: PaginationParams) => {
    return queryClient.invalidateQueries({ queryKey: queryKeys.budgets.list(params) });
  },
  /** Invalidate a specific wallet's detail and related queries. */
  wallet: (queryClient: QueryClient, id: string) => {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.wallets.detail(id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.wallets.balance(id) }),
    ]);
  },
  /** Invalidate a specific agent's detail and related queries. */
  agent: (queryClient: QueryClient, id: string) => {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.all }),
    ]);
  },
  /** Invalidate a specific policy's detail. */
  policy: (queryClient: QueryClient, id: string) => {
    return queryClient.invalidateQueries({ queryKey: queryKeys.policies.detail(id) });
  },
  /** Invalidate a specific budget's detail and utilization. */
  budget: (queryClient: QueryClient, id: string) => {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.budgets.detail(id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.budgets.utilization(id) }),
    ]);
  },
};

/**
 * Fetch a paginated list of agents.
 */
export function useAgents(params?: PaginationParams): UseQueryResult<Paginated<Agent>, Error> {
  const astroid = useAstroidClient();
  return useQuery({
    queryKey: queryKeys.agents.list(params),
    queryFn: () => astroid.agents.list(params),
  });
}

/**
 * Fetch a single agent by ID.
 */
export function useAgent(id: string | undefined): UseQueryResult<Agent, Error> {
  const astroid = useAstroidClient();
  return useQuery({
    queryKey: queryKeys.agents.detail(id ?? ''),
    queryFn: () => astroid.agents.get(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Mutation hook to simulate a policy against a proposed transaction.
 */
export function useSimulatePolicy(): UseMutationResult<
  PolicySimulationResult,
  Error,
  PolicySimulationRequest
> {
  const astroid = useAstroidClient();
  return useMutation({
    mutationFn: (params: PolicySimulationRequest) => astroid.policies.simulate(params),
  });
}

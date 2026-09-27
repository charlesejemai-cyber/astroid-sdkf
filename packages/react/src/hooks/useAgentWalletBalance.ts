import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAstroidClient } from '../hooks.js';
import type { WalletBalance } from '@astroid/types';

/**
 * Query key factory for an agent wallet's balance snapshot.
 *
 * Keys are namespaced under `agents` (rather than `wallets`) so a balance
 * fetched for an agent can be invalidated independently of the generic wallet
 * balance cache.
 */
export const agentWalletBalanceKeys = {
  /** Exact key for a single agent wallet's balance. */
  all: (walletId: string) => ['astroid', 'agents', 'wallet-balance', walletId] as const,
} as const;

/** Options for the `useAgentWalletBalance` hook. */
export interface UseAgentWalletBalanceOptions {
  /** Whether the query is enabled. Set to `false` to pause. Defaults to `true`. */
  enabled?: boolean;
  /** Polling interval in milliseconds. Set to `0` or omit to disable polling. */
  refetchInterval?: number;
  /** How long (ms) fetched balances stay fresh before a refetch. */
  staleTime?: number;
}

/**
 * Fetch live on-chain balances for an agent's wallet.
 *
 * Reads the balances endpoint through the configured `@astroid/client`
 * instance from {@link useAstroidClient} and caches the result with TanStack
 * Query. The query is disabled until a non-empty `walletId` is provided, so the
 * hook is safe to call with an `undefined` id (e.g. while an agent is still
 * loading).
 *
 * @param walletId The agent wallet whose balances to fetch, or `undefined` to
 *   disable the query.
 * @param options  Optional enabled flag, polling interval and stale time.
 * @returns A TanStack Query result with `data` (a {@link WalletBalance}),
 *   `isLoading`, `error`, etc.
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useAgentWalletBalance(agent.primaryWalletId, {
 *   refetchInterval: 10_000,
 * });
 * if (isLoading) return <p>Loading…</p>;
 * return (
 *   <ul>
 *     {data?.balances.map((b) => (
 *       <li key={b.asset}>{b.asset}: {b.balance}</li>
 *     ))}
 *   </ul>
 * );
 * ```
 */
export function useAgentWalletBalance(
  walletId: string | undefined,
  options: UseAgentWalletBalanceOptions = {},
): UseQueryResult<WalletBalance, Error> {
  const astroid = useAstroidClient();
  const { enabled = true, refetchInterval, staleTime } = options;

  return useQuery({
    queryKey: agentWalletBalanceKeys.all(walletId ?? ''),
    queryFn: () => astroid.wallets.balance(walletId as string),
    enabled: Boolean(walletId) && enabled,
    refetchInterval,
    staleTime,
  });
}

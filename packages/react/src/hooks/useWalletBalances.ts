import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useAstroidClient } from '../hooks.js';
import type { WalletBalance } from '@astroid/types';

/**
 * Query key factory for wallet balance synchronization (issue #252).
 *
 * Scoped under the existing `['astroid', 'wallets']` namespace so
 * `queryClient.invalidateQueries({ queryKey: queryKeys.wallets.all })`
 * also invalidates these multi-asset balance queries.
 */
export const walletBalancesKeys = {
  /** All wallet-balances queries — invalidate everything from here. */
  all: ['astroid', 'wallets', 'balances'] as const,
  /** The multi-asset balance snapshot for one wallet (by wallet id). */
  byId: (walletId: string) => ['astroid', 'wallets', 'balances', 'id', walletId] as const,
  /** The multi-asset balance snapshot for one wallet (by public key). */
  byAddress: (publicKey: string) =>
    ['astroid', 'wallets', 'balances', 'address', publicKey] as const,
} as const;

/** Options for the {@link useWalletBalances} hook. */
export interface UseWalletBalancesOptions {
  /**
   * Polling interval in milliseconds for keeping balances synchronized.
   * Set to `0` to disable polling entirely. Defaults to `15000` (15 seconds).
   */
  pollingInterval?: number;
  /** Whether the query is enabled. Set to `false` to pause. Defaults to `true`. */
  enabled?: boolean;
  /**
   * How long fetched balances stay fresh (ms) before a background refetch on
   * mount/focus. Defaults to the polling interval when polling is enabled,
   * otherwise `0` (always refetch on mount).
   */
  staleTime?: number;
}

/**
 * Synchronize live multi-asset balances for a connected wallet (issue #252).
 *
 * Accepts **either** a wallet ID (`wal_…`) **or** a Stellar public key (`G…`)
 * and resolves the wallet automatically, so agent dashboards can render
 * portfolios regardless of which identifier they hold. Balances are kept
 * synchronized through TanStack Query polling and invalidated automatically
 * when transactions are submitted through other SDK hooks (see
 * `useTransfer` / `useWalletMutation` in `useWallets.ts`).
 *
 * @param walletRef  A wallet ID **or** Stellar public key. `undefined`/empty
 *                   disables the query (safe during wallet loading).
 * @param options    Optional polling interval, enabled flag, and stale time.
 * @returns A TanStack Query result with typed `data`
 *   (`WalletBalance`, i.e. `balances: AssetBalance[]` plus wallet/network
 *   context), `isLoading`, `isError`, `error`, and a `refetch` function.
 *
 * @example
 * ```tsx
 * function WalletPortfolio() {
 *   const { data, isLoading, error, refetch } = useWalletBalances('wal_abc123', {
 *     pollingInterval: 10_000,
 *   });
 *
 *   if (isLoading) return <Spinner />;
 *   if (error) return <ErrorMessage error={error} onRetry={refetch} />;
 *
 *   return (
 *     <ul>
 *       {data?.balances.map((b) => (
 *         <li key={`${b.asset}-${b.issuer ?? 'native'}`}>
 *           {b.asset}: {b.balance}
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useWalletBalances(
  walletRef: string | undefined,
  options: UseWalletBalancesOptions = {},
): UseWalletBalancesResult {
  const astroid = useAstroidClient();
  const { pollingInterval = 15_000, enabled = true, staleTime } = options;

  const query = useQuery<WalletBalance, Error>({
    queryKey: walletBalancesKeys.byId(walletRef ?? ''),
    queryFn: async () => {
      // Resolve the reference: a public key (starts with 'G' and is a Stellar
      // address length) is looked up first; anything else is treated as a
      // wallet ID.
      const isPublicKey = walletRef!.startsWith('G') && walletRef!.length === 56;
      const wallet = isPublicKey
        ? await astroid.wallets.getByAddress(walletRef!)
        : await astroid.wallets.get(walletRef!);
      if (!wallet) {
        throw new Error(`Wallet not found for reference: ${walletRef}`);
      }
      return astroid.wallets.balance(wallet.id);
    },
    enabled: Boolean(walletRef) && enabled,
    refetchInterval: pollingInterval > 0 ? pollingInterval : false,
    staleTime: staleTime ?? (pollingInterval > 0 ? pollingInterval : 0),
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/** The result of the {@link useWalletBalances} hook — a narrowed query view. */
export interface UseWalletBalancesResult {
  /** The latest multi-asset balance snapshot, or `undefined` while loading. */
  data: WalletBalance | undefined;
  /** `true` while the first fetch is in flight. */
  isLoading: boolean;
  /** `true` when the last fetch failed. */
  isError: boolean;
  /** The fetch error, when {@link isError} is `true`. */
  error: Error | null;
  /** Manually trigger a refetch of the balance snapshot. */
  refetch: UseQueryResult<WalletBalance, Error>['refetch'];
}

/**
 * Invalidate all wallet-balance queries (or one wallet's) through the
 * application's `QueryClient`. Exported for advanced compositions — SDK hooks
 * such as `useTransfer` already call this automatically.
 */
export function useInvalidateWalletBalances(): (
  walletId?: string,
) => Promise<void> {
  const queryClient = useQueryClient();
  return async (walletId?: string) => {
    if (walletId) {
      await queryClient.invalidateQueries({
        queryKey: walletBalancesKeys.byId(walletId),
      });
      await queryClient.invalidateQueries({
        queryKey: walletBalancesKeys.byAddress(walletId),
      });
    }
    await queryClient.invalidateQueries({ queryKey: walletBalancesKeys.all });
  };
}

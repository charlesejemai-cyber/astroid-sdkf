/**
 * Paginated resource hooks for `@astroid/react`.
 *
 * `useInfiniteResource` is a generic TanStack Query hook for cursor-paginated
 * list endpoints. It removes the boilerplate around query-key management, page
 * state, and next-page fetching while keeping full type inference over the item
 * and parameter types.
 *
 * `createPaginatedResourceHook` binds a resource descriptor once and returns a
 * ready-to-use hook, so application code can express list views declaratively:
 *
 * ```tsx
 * import { createPaginatedResourceHook, useAstroidClient } from '@astroid/react';
 *
 * const useWalletsPage = createPaginatedResourceHook({
 *   queryKey: ['astroid', 'wallets', 'list'],
 *   fetchPage: (params) => astroid.wallets.list(params),
 *   staleTime: 30_000,
 * });
 *
 * function WalletList() {
 *   const { items, isLoading, isError, error, hasNextPage, isFetchingNextPage, fetchNextPage } =
 *     useWalletsPage();
 *   if (isLoading) return <p>Loading…</p>;
 *   if (isError) return <p>{error?.message}</p>;
 *   return (
 *     <>
 *       <ul>{items.map((w) => <li key={w.id}>{w.label}</li>)}</ul>
 *       {hasNextPage && (
 *         <button onClick={fetchNextPage} disabled={isFetchingNextPage}>
 *           {isFetchingNextPage ? 'Loading…' : 'Load more'}
 *         </button>
 *       )}
 *     </>
 *   );
 * }
 * ```
 *
 * @module
 */

import { useMemo } from 'react';
import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import type { PaginatedResponse, PaginationParams } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Describes a cursor-paginated resource. `TItem` is the item type and `TParams`
 * the resource-specific filter/pagination parameters.
 */
export interface PaginatedResourceConfig<
  TItem,
  TParams extends PaginationParams = PaginationParams,
> {
  /**
   * Base query key for caching. The hook appends the resolved parameters so
   * different filter sets are cached independently.
   *
   * @example ['astroid', 'wallets', 'list']
   */
  queryKey: readonly unknown[];
  /**
   * Fetch a single page. `cursor` is `undefined` for the first page and the
   * previous page's `meta.nextCursor` thereafter.
   */
  fetchPage: (params: TParams & { cursor?: string }) => Promise<PaginatedResponse<TItem>>;
  /**
   * Extract the next cursor from the last page. Defaults to
   * `meta.nextCursor` (honouring `meta.hasMore`).
   */
  getNextPageParam?: (
    lastPage: PaginatedResponse<TItem>,
    allPages: PaginatedResponse<TItem>[],
  ) => string | undefined;
  /** Default stale time in milliseconds applied to the generated hook. */
  staleTime?: number;
  /** Default page size merged into every request. */
  limit?: number;
}

/** Per-instance options for a paginated resource hook. */
export interface UsePaginatedResourceOptions<TParams extends PaginationParams = PaginationParams> {
  /** Resource-specific filters/pagination merged into the query key and request. */
  params?: TParams;
  /** Override the resource's default page size for this instance. */
  limit?: number;
  /** Enable/disable the query. Defaults to `true`. */
  enabled?: boolean;
  /** Override the resource's default stale time (ms). */
  staleTime?: number;
  /** Cache retention time in milliseconds. */
  gcTime?: number;
  /** Refetch when the window regains focus. Defaults to `false`. */
  refetchOnWindowFocus?: boolean;
  /** Initial cursor. Defaults to `undefined` (start at the first page). */
  initialCursor?: string;
  /** Retry policy for the query. Defaults to `false`. */
  retry?: number | boolean;
}

/** The result of a paginated resource hook. */
export interface UsePaginatedResourceResult<TItem> {
  /** Flattened items across every loaded page. */
  items: TItem[];
  /** The raw loaded pages, in fetch order. */
  pages: PaginatedResponse<TItem>[];
  /** Total item count from the latest page metadata, when reported. */
  total: number | undefined;
  /** Whether another page is available. */
  hasNextPage: boolean;
  /** Whether the next page is currently being fetched. */
  isFetchingNextPage: boolean;
  /** Whether the initial page is loading. */
  isLoading: boolean;
  /** Whether the query is in an error state. */
  isError: boolean;
  /** The error, if the query failed. */
  error: Error | null;
  /** Fetch the next page. A no-op when `hasNextPage` is `false`. */
  fetchNextPage: () => void;
  /** Refetch all loaded pages. */
  refetch: () => void;
  /** The underlying TanStack Query result, for advanced use. */
  query: UseInfiniteQueryResult<InfiniteData<PaginatedResponse<TItem>, string | undefined>, Error>;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Default next-page extractor: follow `meta.nextCursor` while the server
 * reports more pages (`meta.hasMore !== false`).
 */
function defaultGetNextPageParam<TItem>(lastPage: PaginatedResponse<TItem>): string | undefined {
  const meta = lastPage.meta;
  if (!meta || meta.hasMore === false) return undefined;
  const nextCursor = meta.nextCursor;
  return typeof nextCursor === 'string' && nextCursor.length > 0 ? nextCursor : undefined;
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Generic infinite-query hook for a cursor-paginated resource.
 *
 * Query caching and stale-time behaviour are inherited from TanStack Query;
 * loading, error, and next-page fetching states are surfaced directly.
 *
 * @param config  The resource descriptor (query key + page fetcher).
 * @param options Per-instance filters, limits, and query tuning.
 *
 * @example
 * ```tsx
 * const { items, fetchNextPage, hasNextPage } = useInfiniteResource({
 *   queryKey: ['astroid', 'agents', 'list'],
 *   fetchPage: (params) => astroid.agents.list(params),
 * });
 * ```
 */
export function useInfiniteResource<TItem, TParams extends PaginationParams = PaginationParams>(
  config: PaginatedResourceConfig<TItem, TParams>,
  options: UsePaginatedResourceOptions<TParams> = {},
): UsePaginatedResourceResult<TItem> {
  const {
    params,
    limit,
    enabled = true,
    staleTime,
    gcTime,
    refetchOnWindowFocus = false,
    initialCursor,
    retry = false,
  } = options;

  const effectiveLimit = limit ?? config.limit;
  const mergedParams = {
    ...(params ?? {}),
    ...(effectiveLimit !== undefined ? { limit: effectiveLimit } : {}),
  } as TParams;

  const query = useInfiniteQuery<
    PaginatedResponse<TItem>,
    Error,
    InfiniteData<PaginatedResponse<TItem>, string | undefined>,
    readonly unknown[],
    string | undefined
  >({
    queryKey: [...config.queryKey, mergedParams],
    initialPageParam: initialCursor,
    queryFn: ({ pageParam }) => {
      const requestParams = {
        ...mergedParams,
        ...(pageParam !== undefined ? { cursor: pageParam } : {}),
      } as TParams & { cursor?: string };
      return config.fetchPage(requestParams);
    },
    getNextPageParam: config.getNextPageParam ?? defaultGetNextPageParam,
    enabled,
    staleTime: staleTime ?? config.staleTime,
    gcTime,
    refetchOnWindowFocus,
    retry,
  });

  const pages = query.data?.pages ?? [];

  const items = useMemo<TItem[]>(() => pages.flatMap((page) => page.data), [pages]);

  const total = pages.length > 0 ? pages[pages.length - 1]?.meta?.total : undefined;

  return {
    items,
    pages,
    total,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    fetchNextPage: () => {
      void query.fetchNextPage();
    },
    refetch: () => {
      void query.refetch();
    },
    query,
  };
}

/**
 * Bind a {@link PaginatedResourceConfig} once and return a reusable hook.
 *
 * The returned hook shares the same signature as {@link useInfiniteResource}
 * minus the config argument, so components only pass per-instance options.
 *
 * @param config The resource descriptor.
 * @returns A hook that fetches and paginates the resource.
 *
 * @example
 * ```tsx
 * const useAgentsPage = createPaginatedResourceHook({
 *   queryKey: ['astroid', 'agents', 'list'],
 *   fetchPage: (params) => astroid.agents.list(params),
 *   staleTime: 15_000,
 * });
 *
 * const { items, fetchNextPage } = useAgentsPage({ params: { order: 'desc' } });
 * ```
 */
export function createPaginatedResourceHook<
  TItem,
  TParams extends PaginationParams = PaginationParams,
>(
  config: PaginatedResourceConfig<TItem, TParams>,
): (options?: UsePaginatedResourceOptions<TParams>) => UsePaginatedResourceResult<TItem> {
  return (options?: UsePaginatedResourceOptions<TParams>) => useInfiniteResource(config, options);
}

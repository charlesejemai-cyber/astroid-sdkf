/**
 * Cursor-based pagination helpers for @astroid/client.
 *
 * These async generators and utilities let callers stream every item across
 * paginated endpoints without manually managing cursors or loop termination.
 *
 * ```ts
 * import { paginateAll, paginateCursor } from '@astroid/client';
 *
 * // Stream every agent:
 * for await (const agent of paginateAll((cursor) => client.agents.list({ cursor }))) {
 *   console.log(agent.id);
 * }
 *
 * // Collect all pages as an array:
 * const allWallets = await paginateAll((cursor) => client.wallets.list({ cursor }));
 * ```
 *
 * @module
 */

import type { ResponseMeta } from '@astroid/types';

/**
 * A function that fetches a single page given an optional cursor.
 *
 * The function receives the current cursor (undefined for the first page) and
 * must return a response containing `data` items and optional pagination `meta`.
 */
export type CursorPageFetcher<TItem> = (cursor?: string) => Promise<{
  data: TItem[];
  meta?: ResponseMeta;
}>;

/** Options for cursor-based pagination helpers. */
export interface CursorPaginationOptions {
  /**
   * Maximum number of items to request per page.
   * Applied as a `limit` parameter forwarded to the fetcher via the
   * `limitOverride` callback when provided.
   */
  limit?: number;
  /**
   * Hard ceiling on the total number of pages to fetch.
   * Prevents accidental infinite loops against a misbehaving API.
   * Defaults to `10_000`.
   */
  maxPages?: number;
}

/**
 * Lazily iterate every item across all pages of a cursor-based paginated
 * endpoint. Stops when:
 * - A page returns an empty `data` array, OR
 * - `meta.hasMore` is `false` / `meta.nextCursor` is `null` or absent.
 *
 * @param fetchPage A function that fetches one page for a given cursor.
 * @param options   Optional page size and safety limits.
 * @yields Individual items from every page.
 *
 * @example
 * ```ts
 * async function* fetchAllAgents(cursor?: string) {
 *   const res = await client.agents.list({ cursor, limit: 50 });
 *   return res;
 * }
 *
 * for await (const agent of paginateCursor(fetchAllAgents)) {
 *   processAgent(agent);
 * }
 * ```
 */
export async function* paginateCursor<TItem>(
  fetchPage: CursorPageFetcher<TItem>,
  options?: CursorPaginationOptions,
): AsyncGenerator<TItem, void, void> {
  const maxPages = options?.maxPages ?? 10_000;
  let cursor: string | undefined;
  let pageCount = 0;

  while (pageCount < maxPages) {
    const response = await fetchPage(cursor);
    const items = response.data ?? [];

    for (const item of items) yield item;

    pageCount++;

    const meta = response.meta;
    if (!meta) {
      if (items.length === 0) return;
      return;
    }

    if (meta.hasMore === false) return;

    const nextCursor = meta.nextCursor ?? meta.cursor;
    if (!nextCursor) return;

    cursor = nextCursor;
  }
}

/**
 * Lazily iterate every item across all pages of a list endpoint that returns
 * a {@link PaginatedResponse} (i.e. `{ data: T[], meta?: ResponseMeta }`).
 *
 * This is the most common shape for Astroid list endpoints.
 *
 * @param fetchPage A function that fetches one page for a given cursor.
 * @param options   Optional page size and safety limits.
 * @yields Individual items from every page.
 *
 * @example
 * ```ts
 * for await (const tx of paginateAll((cursor) =>
 *   client.transactions.list({ cursor, limit: 100 })
 * )) {
 *   console.log(tx.id);
 * }
 * ```
 */
export async function* paginateAll<TItem>(
  fetchPage: CursorPageFetcher<TItem>,
  options?: CursorPaginationOptions,
): AsyncGenerator<TItem, void, void> {
  yield* paginateCursor(fetchPage, options);
}

/**
 * Collect an entire async iterable into an array.
 *
 * Convenience wrapper for callers who prefer a single array over streaming.
 *
 * @param iterable An async iterable (e.g. from {@link paginateAll}).
 * @returns A promise resolving to all collected items.
 *
 * @example
 * ```ts
 * const allItems = await collectPaginated(
 *   paginateAll((cursor) => client.agents.list({ cursor })),
 * );
 * ```
 */
export async function collectPaginated<TItem>(
  iterable: AsyncIterable<TItem>,
): Promise<TItem[]> {
  const out: TItem[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

/**
 * Iterate every item across all pages and invoke a callback for each one.
 *
 * Useful for side-effect processing (logging, metrics, writing to a file)
 * without accumulating all items in memory.
 *
 * @param iterable An async iterable (e.g. from {@link paginateAll}).
 * @param callback  Invoked for each item.
 *
 * @example
 * ```ts
 * await forEachPaginated(
 *   paginateAll((cursor) => client.transactions.list({ cursor })),
 *   (tx) => analytics.track(tx),
 * );
 * ```
 */
export async function forEachPaginated<TItem>(
  iterable: AsyncIterable<TItem>,
  callback: (item: TItem) => void | Promise<void>,
): Promise<void> {
  for await (const item of iterable) {
    await callback(item);
  }
}

/**
 * Take at most `count` items from an async iterable.
 *
 * Useful for sampling or limit-testing without consuming entire result sets.
 *
 * @param iterable An async iterable.
 * @param count    Maximum number of items to yield.
 * @yields Up to `count` items.
 *
 * @example
 * ```ts
 * const first10 = takePaginated(
 *   paginateAll((cursor) => client.agents.list({ cursor })),
 *   10,
 * );
 * ```
 */
export async function* takePaginated<TItem>(
  iterable: AsyncIterable<TItem>,
  count: number,
): AsyncGenerator<TItem, void, void> {
  let taken = 0;
  for await (const item of iterable) {
    if (taken >= count) return;
    yield item;
    taken++;
  }
}

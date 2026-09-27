/**
 * Auto-paginating async iterators over Astroid list endpoints.
 *
 * Two strategies are supported and both stream lazily, so an entire collection
 * never has to be materialised in memory:
 *
 * - {@link paginate} follows 1-based page numbers (`meta.page` / `meta.totalPages`).
 * - {@link paginateCursor} follows the opaque keyset cursor every Astroid list
 *   endpoint returns in `meta.nextCursor`, with `meta.hasMore` as the authoritative
 *   "there is another page" signal.
 *
 * ```ts
 * import { paginate, paginateCursor } from '@astroid/core';
 *
 * // Page-number pagination.
 * for await (const tx of paginate((page) => client.get('/transactions', { query: { page } }))) {
 *   console.log(tx.id);
 * }
 *
 * // Cursor (keyset) pagination — no manual cursor bookkeeping.
 * for await (const wallet of paginateCursor((cursor) =>
 *   client.get('/wallets', { query: cursor ? { cursor } : {} }),
 * )) {
 *   console.log(wallet.id);
 * }
 * ```
 *
 * @module
 */

import type { PaginationMeta, ResponseMeta } from '@astroid/types';
import type { AstroidResponse } from './http-types.js';

/* -------------------------------------------------------------------------- */
/* Utility                                                                     */
/* -------------------------------------------------------------------------- */

/** Collect an entire async iterable into an array (convenience for callers). */
export async function collect<TItem>(iterable: AsyncIterable<TItem>): Promise<TItem[]> {
  const out: TItem[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Offset (page-number) pagination                                             */
/* -------------------------------------------------------------------------- */

/** A function that fetches one page for the given 1-based page number. */
export type PageFetcher<TItem> = (page: number) => Promise<AstroidResponse<TItem[]>>;

/** Derive pagination metadata from a response's `meta`, tolerating omissions. */
function readMeta(response: AstroidResponse<unknown>): PaginationMeta | undefined {
  const meta = response.meta;
  if (!meta) return undefined;
  const { page, limit, total, totalPages } = meta as Partial<PaginationMeta>;
  if (page === undefined || limit === undefined) return undefined;
  const resolvedTotalPages =
    totalPages ?? (total !== undefined && limit > 0 ? Math.ceil(total / limit) : page);
  return {
    page,
    limit,
    total: total ?? 0,
    totalPages: resolvedTotalPages,
    hasNextPage: page < resolvedTotalPages,
    hasPreviousPage: page > 1,
  };
}

/**
 * Lazily iterate every item across all pages. Stops when a page returns no
 * items or the pagination metadata indicates the last page was reached.
 */
export async function* paginate<TItem>(
  fetchPage: PageFetcher<TItem>,
): AsyncGenerator<TItem, void, void> {
  let page = 1;
  // Hard ceiling to avoid an accidental infinite loop against a broken API.
  const maxPages = 10_000;
  while (page <= maxPages) {
    const response = await fetchPage(page);
    const items = response.data ?? [];
    for (const item of items) yield item;

    const meta = readMeta(response);
    if (meta) {
      if (!meta.hasNextPage) return;
    } else if (items.length === 0) {
      return;
    }
    page += 1;
  }
}

/* -------------------------------------------------------------------------- */
/* Cursor (keyset) pagination                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A function that fetches a single cursor page. `undefined` requests the first
 * page; every subsequent call receives the previous page's `nextCursor`.
 */
export type CursorPageFetcher<TItem> = (
  cursor: string | undefined,
) => Promise<AstroidResponse<TItem[]>>;

/** Default ceiling on the number of pages {@link paginateCursor} will fetch. */
export const MAX_CURSOR_PAGES = 10_000;

/** Options accepted by {@link paginateCursor}. */
export interface PaginateCursorOptions {
  /**
   * Hard ceiling on the number of pages fetched. Guards against an API that
   * never stops handing out cursors and therefore never terminates iteration.
   *
   * @default MAX_CURSOR_PAGES
   */
  maxPages?: number;
}

/** A single normalized page of a cursor-paginated endpoint. */
export interface CursorPage<TItem> {
  /** The items on this page. Always an array, never `undefined`. */
  items: TItem[];
  /** Cursor to pass back for the next page, or `null` when the set is exhausted. */
  nextCursor: string | null;
  /** Whether more pages follow this one. */
  hasMore: boolean;
}

/**
 * Normalize a raw list response into a {@link CursorPage}.
 *
 * The `nextCursor` is read from `meta.nextCursor`, falling back to `meta.cursor`
 * for endpoints that only echo a single cursor field. An empty/missing cursor is
 * normalized to `null`, and `hasMore` falls back to `nextCursor !== null` when
 * the API omits it — so a page that returns `{ data, nextCursor }` alone pages
 * correctly.
 *
 * @param response A raw response from the underlying list endpoint.
 * @returns        The items plus a normalized `nextCursor` / `hasMore` pair.
 *
 * @example
 * ```ts
 * const { items, nextCursor, hasMore } = normalizeCursorPage(await client.get('/wallets'));
 * ```
 */
export function normalizeCursorPage<TItem>(response: AstroidResponse<TItem[]>): CursorPage<TItem> {
  const items = Array.isArray(response.data) ? response.data : [];
  const meta = response.meta as Partial<ResponseMeta> | undefined;
  const rawNext = meta?.nextCursor ?? meta?.cursor;
  const nextCursor = typeof rawNext === 'string' && rawNext.length > 0 ? rawNext : null;
  const hasMore = meta?.hasMore ?? nextCursor !== null;
  return { items, nextCursor, hasMore };
}

/**
 * Lazily iterate every item across all cursor-paginated pages of a list endpoint.
 *
 * The generator requests the next page only after the current page's items have
 * been consumed, so peak memory stays at a single page. Iteration stops when the
 * API reports `hasMore: false`, returns no `nextCursor`, or repeats the cursor it
 * was given (a non-advancing cursor, which would otherwise loop forever).
 *
 * Empty pages are not treated as the end: an empty page that still reports a new
 * cursor continues to the next page.
 *
 * @param fetchPage Fetcher invoked once per page with the current cursor.
 * @param options   Optional iteration limits (see {@link PaginateCursorOptions}).
 * @returns         An async generator yielding every item in order.
 *
 * @throws Whatever `fetchPage` throws — errors propagate to the consumer.
 *
 * @example
 * ```ts
 * for await (const wallet of paginateCursor((cursor) =>
 *   client.get('/wallets', { query: { limit: 100, ...(cursor ? { cursor } : {}) } }),
 * )) {
 *   // ...one wallet at a time, across every page
 * }
 * ```
 */
export async function* paginateCursor<TItem>(
  fetchPage: CursorPageFetcher<TItem>,
  options: PaginateCursorOptions = {},
): AsyncGenerator<TItem, void, void> {
  const maxPages = options.maxPages ?? MAX_CURSOR_PAGES;
  let cursor: string | undefined;

  for (let fetched = 0; fetched < maxPages; fetched += 1) {
    const { items, nextCursor, hasMore } = normalizeCursorPage(await fetchPage(cursor));

    // Stream this page straight through — only one page is ever held in memory.
    for (const item of items) yield item;

    // Stop on the last page, a missing cursor, or a cursor that does not advance.
    if (!hasMore || nextCursor === null || nextCursor === cursor) return;
    cursor = nextCursor;
  }
}

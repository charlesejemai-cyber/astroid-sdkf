/**
 * Pagination serialization and helper utilities for @astroid/client.
 */

import type { PaginationParams, PaginatedResponse } from '@astroid/types';
import type { QueryValue } from '@astroid/core';

/**
 * Serializes standard pagination parameters into a query parameter record.
 */
export function serializePaginationParams(
  params?: PaginationParams | null,
): Record<string, QueryValue> {
  if (!params) {
    return {};
  }
  const query: Record<string, QueryValue> = {};
  if (params.cursor !== undefined && params.cursor !== null && params.cursor !== '') {
    query['cursor'] = params.cursor;
  }
  if (params.limit !== undefined && params.limit !== null) {
    query['limit'] = params.limit;
  }
  if (params.order !== undefined && params.order !== null) {
    query['order'] = params.order;
  }
  if (params.page !== undefined && params.page !== null) {
    query['page'] = params.page;
  }
  return query;
}

/**
 * Build a {@link URLSearchParams} instance from standard pagination
 * parameters.
 *
 * Values that are `undefined`, `null`, or an empty string are omitted entirely,
 * so the resulting query never contains literal `""` or dangling `&` / `?`
 * segments. Numeric values are serialised as strings, and `order` is encoded as
 * `asc` / `desc`.
 *
 * @param params Pagination parameters (`cursor`, `limit`, `order`, `page`).
 * @returns A populated `URLSearchParams` (empty when nothing is set).
 *
 * @example
 * ```ts
 * import { buildPaginationQuery } from '@astroid/client';
 *
 * buildPaginationQuery({ cursor: 'cur_1', limit: 50, order: 'desc' }).toString();
 * // => 'cursor=cur_1&limit=50&order=desc'
 *
 * buildPaginationQuery({ cursor: undefined, limit: undefined }).toString();
 * // => ''
 * ```
 */
export function buildPaginationQuery(params?: PaginationParams | null): URLSearchParams {
  const search = new URLSearchParams();
  if (!params) {
    return search;
  }
  if (params.cursor !== undefined && params.cursor !== null && params.cursor !== '') {
    search.set('cursor', params.cursor);
  }
  if (params.limit !== undefined && params.limit !== null) {
    search.set('limit', String(params.limit));
  }
  if (params.order !== undefined && params.order !== null) {
    search.set('order', params.order);
  }
  if (params.page !== undefined && params.page !== null) {
    search.set('page', String(params.page));
  }
  return search;
}

/**
 * Build a URL-encoded pagination query string, including the leading `?`.
 *
 * Returns an empty string when no pagination parameters are set, so it can be
 * concatenated onto a path unconditionally.
 *
 * @param params Pagination parameters (`cursor`, `limit`, `order`, `page`).
 * @returns A query string such as `?cursor=cur_1&limit=50`, or `''`.
 *
 * @example
 * ```ts
 * buildPaginationQueryString({ limit: 25 }); // => '?limit=25'
 * buildPaginationQueryString(); // => ''
 * ```
 */
export function buildPaginationQueryString(params?: PaginationParams | null): string {
  const serialized = buildPaginationQuery(params).toString();
  return serialized ? `?${serialized}` : '';
}

/**
 * Unwraps a paginated response envelope.
 */
export function unwrapPaginatedResponse<T>(response: PaginatedResponse<T>): T[] {
  return response.data;
}

/**
 * Cursor (keyset) pagination utilities.
 *
 * Re-exported from `@astroid/core` so the client package and every resource
 * package share a single auto-pagination implementation.
 *
 * ```ts
 * import { paginateCursor } from '@astroid/client';
 *
 * for await (const wallet of paginateCursor((cursor) =>
 *   astroid.http.get('/wallets', { query: { limit: 100, ...(cursor ? { cursor } : {}) } }),
 * )) {
 *   console.log(wallet.id);
 * }
 * ```
 */
export {
  paginateCursor,
  normalizeCursorPage,
  MAX_CURSOR_PAGES,
  type CursorPage,
  type CursorPageFetcher,
  type PaginateCursorOptions,
} from '@astroid/core';

/**
 * Pagination helpers for working with Astroid list responses.
 */

import type { PaginationMeta, PaginationParams } from '@astroid/types';

/** Sensible default page size. */
export const DEFAULT_PAGE_SIZE = 25;

/** Clamp/normalise raw pagination params before sending them to the API. */
export function normalizePagination(
  params: PaginationParams = {},
): Required<Pick<PaginationParams, 'page' | 'limit'>> & PaginationParams {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const limit = Math.min(100, Math.max(1, Math.floor(params.limit ?? DEFAULT_PAGE_SIZE)));
  return { ...params, page, limit };
}

/** Derive full pagination metadata from a total count and the query params. */
export function buildPaginationMeta(total: number, page: number, limit: number): PaginationMeta {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

/** Whether another page exists after the given metadata. */
export function hasNextPage(meta: Pick<PaginationMeta, 'page' | 'totalPages'>): boolean {
  return meta.page < meta.totalPages;
}

/** The next page number, or `null` if on the last page. */
export function nextPage(meta: Pick<PaginationMeta, 'page' | 'totalPages'>): number | null {
  return hasNextPage(meta) ? meta.page + 1 : null;
}

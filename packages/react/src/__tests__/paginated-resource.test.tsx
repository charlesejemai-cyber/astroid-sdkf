/**
 * Unit tests for the paginated resource hook factory in `@astroid/react`.
 *
 * Covered behaviour:
 * - Initial loading and successful page loading
 * - Flattened items across pages and next-page fetching state
 * - Error propagation
 * - Cache reuse via a shared QueryClient
 * - Factory-bound resources applying parameters and page size
 */

import { describe, expect, it, vi } from 'vitest';
import { type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createPaginatedResourceHook,
  useInfiniteResource,
  type PaginatedResourceConfig,
} from '../hooks/usePaginatedResource.js';
import type { PaginatedResponse } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Fixtures and helpers                                                        */
/* -------------------------------------------------------------------------- */

interface Item {
  id: string;
  label: string;
}

type PageFetcher = PaginatedResourceConfig<Item>['fetchPage'];
type PagedFetcherMock = ReturnType<typeof vi.fn> & PageFetcher;

const PAGE_ONE: PaginatedResponse<Item> = {
  data: [
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Beta' },
  ],
  meta: { nextCursor: 'cur_2', hasMore: true, total: 3 },
};

const PAGE_TWO: PaginatedResponse<Item> = {
  data: [{ id: 'c', label: 'Gamma' }],
  meta: { nextCursor: null, hasMore: false, total: 3 },
};

function createPagedFetcher(): PagedFetcherMock {
  const fn = vi.fn(async (params: { cursor?: string }) =>
    params.cursor === 'cur_2' ? PAGE_TWO : PAGE_ONE,
  );
  return fn as unknown as PagedFetcherMock;
}

function createWrapper(): {
  queryClient: QueryClient;
  Wrapper: (props: { children: ReactNode }) => ReactNode;
} {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return {
    queryClient,
    Wrapper({ children }: { children: ReactNode }): ReactNode {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* useInfiniteResource                                                         */
/* -------------------------------------------------------------------------- */

describe('useInfiniteResource', () => {
  it('starts in a loading state and resolves the first page', async () => {
    const fetchPage = createPagedFetcher();
    const { Wrapper } = createWrapper();

    const { result } = renderHook(
      () => useInfiniteResource({ queryKey: ['astroid', 'items', 'list'], fetchPage }),
      { wrapper: Wrapper },
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.items).toEqual([]);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(result.current.hasNextPage).toBe(true);
    expect(result.current.isFetchingNextPage).toBe(false);
    expect(result.current.total).toBe(3);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith({});
  });

  it('fetches the next page and appends items without losing the first page', async () => {
    const fetchPage = createPagedFetcher();
    const { Wrapper } = createWrapper();

    const { result } = renderHook(
      () => useInfiniteResource({ queryKey: ['astroid', 'items', 'list'], fetchPage }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => {
      result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(3));

    expect(fetchPage).toHaveBeenLastCalledWith({ cursor: 'cur_2' });
    expect(result.current.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.isFetchingNextPage).toBe(false);
  });

  it('surfaces loading, error, and error object cleanly', async () => {
    const fetchPage = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as ReturnType<typeof vi.fn>;
    const { Wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        useInfiniteResource({
          queryKey: ['astroid', 'items', 'list'],
          fetchPage: fetchPage as unknown as PageFetcher,
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.items).toEqual([]);
  });

  it('reuses cached pages when remounted with the same query key', async () => {
    const fetchPage = createPagedFetcher();
    const { Wrapper } = createWrapper();

    const first = renderHook(
      () =>
        useInfiniteResource(
          { queryKey: ['astroid', 'items', 'list'], fetchPage, staleTime: 60_000 },
          { gcTime: 60_000 },
        ),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(first.result.current.items).toHaveLength(2));
    first.unmount();

    const second = renderHook(
      () =>
        useInfiniteResource(
          { queryKey: ['astroid', 'items', 'list'], fetchPage, staleTime: 60_000 },
          { gcTime: 60_000 },
        ),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(second.result.current.items).toHaveLength(2));
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('does not fetch when disabled', () => {
    const fetchPage = createPagedFetcher();
    const { Wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        useInfiniteResource(
          { queryKey: ['astroid', 'items', 'list'], fetchPage },
          { enabled: false },
        ),
      { wrapper: Wrapper },
    );

    expect(result.current.isLoading).toBe(false);
    expect(fetchPage).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* createPaginatedResourceHook                                                 */
/* -------------------------------------------------------------------------- */

describe('createPaginatedResourceHook', () => {
  it('binds a resource descriptor and applies params and page size', async () => {
    const fetchPage = createPagedFetcher();
    const useItems = createPaginatedResourceHook({
      queryKey: ['astroid', 'items', 'list'],
      fetchPage,
      limit: 25,
      staleTime: 1_000,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useItems({ params: { order: 'desc' } }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.items).toHaveLength(2));

    expect(fetchPage).toHaveBeenCalledWith({ order: 'desc', limit: 25 });
    expect(result.current.items.map((item) => item.label)).toEqual(['Alpha', 'Beta']);
  });

  it('isolates cache entries by filter parameters', async () => {
    const fetchPage = createPagedFetcher();
    const useItems = createPaginatedResourceHook({
      queryKey: ['astroid', 'items', 'list'],
      fetchPage,
    });

    const { Wrapper, queryClient } = createWrapper();
    const asc = renderHook(() => useItems({ params: { order: 'asc' } }), { wrapper: Wrapper });
    await waitFor(() => expect(asc.result.current.items).toHaveLength(2));

    const desc = renderHook(() => useItems({ params: { order: 'desc' } }), { wrapper: Wrapper });
    await waitFor(() => expect(desc.result.current.items).toHaveLength(2));

    const cached = queryClient.getQueryCache().findAll({ queryKey: ['astroid', 'items', 'list'] });
    expect(cached).toHaveLength(2);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('honours a custom getNextPageParam', async () => {
    const fetchPage = createPagedFetcher();
    const useItems = createPaginatedResourceHook({
      queryKey: ['astroid', 'items', 'list'],
      fetchPage,
      getNextPageParam: (lastPage) =>
        lastPage.meta?.hasMore ? (lastPage.meta.nextCursor ?? undefined) : undefined,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useItems(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => {
      result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(result.current.hasNextPage).toBe(false);
  });
});

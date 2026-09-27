import { describe, expect, it, vi } from 'vitest';
import {
  paginateCursor,
  paginateAll,
  collectPaginated,
  forEachPaginated,
  takePaginated,
  type CursorPageFetcher,
} from '../pagination-helpers.js';

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

function makePage<T>(items: T[], meta?: { hasMore?: boolean; nextCursor?: string | null; cursor?: string }) {
  return { data: items, meta };
}

/** Creates a page fetcher that returns pre-configured pages. */
function createFetcher(pages: Array<{ data: unknown[]; meta?: Record<string, unknown> }>) {
  let callIndex = 0;
  const fetcher: CursorPageFetcher<unknown> = vi.fn(async (_cursor?: string) => {
    const page = pages[callIndex] ?? { data: [], meta: { hasMore: false } };
    callIndex++;
    return page;
  });
  return fetcher;
}

/* -------------------------------------------------------------------------- */
/* paginateCursor                                                              */
/* -------------------------------------------------------------------------- */

describe('paginateCursor', () => {
  it('iterates all items across multiple pages', async () => {
    const fetcher = createFetcher([
      makePage([{ id: 1 }, { id: 2 }], { hasMore: true, nextCursor: 'cur_2' }),
      makePage([{ id: 3 }, { id: 4 }], { hasMore: true, nextCursor: 'cur_3' }),
      makePage([{ id: 5 }], { hasMore: false, nextCursor: null }),
    ]);

    const items: unknown[] = [];
    for await (const item of paginateCursor(fetcher)) {
      items.push(item);
    }

    expect(items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher).toHaveBeenNthCalledWith(1, undefined);
    expect(fetcher).toHaveBeenNthCalledWith(2, 'cur_2');
    expect(fetcher).toHaveBeenNthCalledWith(3, 'cur_3');
  });

  it('handles empty first page', async () => {
    const fetcher = createFetcher([makePage([], { hasMore: false })]);

    const items: unknown[] = [];
    for await (const item of paginateCursor(fetcher)) {
      items.push(item);
    }

    expect(items).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('stops when meta is missing and data is empty', async () => {
    const fetcher: CursorPageFetcher<unknown> = vi.fn(async () => ({ data: [] }));

    const items: unknown[] = [];
    for await (const item of paginateCursor(fetcher)) {
      items.push(item);
    }

    expect(items).toEqual([]);
  });

  it('stops when meta is missing and data is non-empty (no infinite loop)', async () => {
    const fetcher: CursorPageFetcher<unknown> = vi.fn(async () => ({
      data: [{ id: 1 }],
    }));

    const items: unknown[] = [];
    for await (const item of paginateCursor(fetcher)) {
      items.push(item);
    }

    expect(items).toEqual([{ id: 1 }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('respects maxPages limit', async () => {
    const fetcher: CursorPageFetcher<unknown> = vi.fn(async (cursor) => {
      const pageNum = cursor ? parseInt(cursor.split('_')[1]) : 1;
      return makePage([{ id: pageNum }], {
        hasMore: true,
        nextCursor: `cur_${pageNum + 1}`,
      });
    });

    const items: unknown[] = [];
    for await (const item of paginateCursor(fetcher, { maxPages: 3 })) {
      items.push(item);
    }

    expect(items).toHaveLength(3);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('handles pages without meta gracefully', async () => {
    const fetcher: CursorPageFetcher<unknown> = vi.fn(async () => ({
      data: [{ id: 1 }],
    }));

    const items: unknown[] = [];
    for await (const item of paginateCursor(fetcher)) {
      items.push(item);
    }

    expect(items).toEqual([{ id: 1 }]);
  });
});

/* -------------------------------------------------------------------------- */
/* paginateAll                                                                 */
/* -------------------------------------------------------------------------- */

describe('paginateAll', () => {
  it('behaves identically to paginateCursor', async () => {
    const fetcher = createFetcher([
      makePage([{ id: 1 }, { id: 2 }], { hasMore: true, nextCursor: 'next' }),
      makePage([{ id: 3 }], { hasMore: false }),
    ]);

    const items: unknown[] = [];
    for await (const item of paginateAll(fetcher)) {
      items.push(item);
    }

    expect(items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });
});

/* -------------------------------------------------------------------------- */
/* collectPaginated                                                            */
/* -------------------------------------------------------------------------- */

describe('collectPaginated', () => {
  it('collects all items into an array', async () => {
    const fetcher = createFetcher([
      makePage([{ id: 1 }, { id: 2 }], { hasMore: true, nextCursor: 'next' }),
      makePage([{ id: 3 }], { hasMore: false }),
    ]);

    const items = await collectPaginated(paginateAll(fetcher));
    expect(items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('returns empty array for empty results', async () => {
    const fetcher = createFetcher([makePage([], { hasMore: false })]);
    const items = await collectPaginated(paginateAll(fetcher));
    expect(items).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* forEachPaginated                                                            */
/* -------------------------------------------------------------------------- */

describe('forEachPaginated', () => {
  it('invokes callback for each item', async () => {
    const fetcher = createFetcher([
      makePage([{ id: 1 }, { id: 2 }], { hasMore: true, nextCursor: 'next' }),
      makePage([{ id: 3 }], { hasMore: false }),
    ]);

    const collected: unknown[] = [];
    await forEachPaginated(paginateAll(fetcher), (item: unknown) => {
      collected.push(item);
    });

    expect(collected).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('supports async callbacks', async () => {
    const fetcher = createFetcher([
      makePage([{ id: 1 }], { hasMore: false }),
    ]);

    const collected: number[] = [];
    await forEachPaginated(paginateAll(fetcher), async (item: unknown) => {
      await new Promise((r) => setTimeout(r, 1));
      collected.push((item as { id: number }).id);
    });

    expect(collected).toEqual([1]);
  });
});

/* -------------------------------------------------------------------------- */
/* takePaginated                                                               */
/* -------------------------------------------------------------------------- */

describe('takePaginated', () => {
  it('yields at most count items', async () => {
    const fetcher = createFetcher([
      makePage([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }], {
        hasMore: true,
        nextCursor: 'next',
      }),
      makePage([{ id: 6 }, { id: 7 }], { hasMore: false }),
    ]);

    const items: unknown[] = [];
    for await (const item of takePaginated(paginateAll(fetcher), 3)) {
      items.push(item);
    }

    expect(items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('yields all items when count exceeds total', async () => {
    const fetcher = createFetcher([
      makePage([{ id: 1 }, { id: 2 }], { hasMore: false }),
    ]);

    const items: unknown[] = [];
    for await (const item of takePaginated(paginateAll(fetcher), 100)) {
      items.push(item);
    }

    expect(items).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('handles zero count', async () => {
    const fetcher = createFetcher([
      makePage([{ id: 1 }], { hasMore: false }),
    ]);

    const items: unknown[] = [];
    for await (const item of takePaginated(paginateAll(fetcher), 0)) {
      items.push(item);
    }

    expect(items).toEqual([]);
  });
});

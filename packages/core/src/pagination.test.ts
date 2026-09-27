import { describe, expect, it } from 'vitest';

import type { AstroidResponse } from './http-types.js';
import {
  collect,
  MAX_CURSOR_PAGES,
  normalizeCursorPage,
  paginateCursor,
  type CursorPageFetcher,
} from './pagination.js';

interface Item {
  id: string;
}

function response(data: Item[], meta?: AstroidResponse<Item[]>['meta']): AstroidResponse<Item[]> {
  return { data, meta, requestId: undefined, status: 200, headers: new Headers() };
}

/**
 * A fetcher that replays canned pages in order and records every cursor it was
 * asked for, so tests can assert both the yielded items and the request sequence.
 */
function replay(pages: AstroidResponse<Item[]>[]): {
  fetchPage: CursorPageFetcher<Item>;
  cursors: (string | undefined)[];
} {
  const cursors: (string | undefined)[] = [];
  let index = 0;
  const fetchPage: CursorPageFetcher<Item> = async (cursor) => {
    cursors.push(cursor);
    const page = pages[index];
    index += 1;
    if (!page) throw new Error(`unexpected request for page ${index}`);
    return page;
  };
  return { fetchPage, cursors };
}

async function drain(iterable: AsyncIterable<Item>): Promise<string[]> {
  const ids: string[] = [];
  for await (const item of iterable) ids.push(item.id);
  return ids;
}

describe('paginateCursor', () => {
  it('yields every item across multiple pages and follows nextCursor', async () => {
    const { fetchPage, cursors } = replay([
      response([{ id: 'a' }, { id: 'b' }], { nextCursor: 'c1', hasMore: true }),
      response([{ id: 'c' }], { nextCursor: 'c2', hasMore: true }),
      response([{ id: 'd' }], { nextCursor: null, hasMore: false }),
    ]);

    await expect(drain(paginateCursor(fetchPage))).resolves.toEqual(['a', 'b', 'c', 'd']);
    // First call asks for the head of the collection, then each cursor in turn.
    expect(cursors).toEqual([undefined, 'c1', 'c2']);
  });

  it('falls back to meta.cursor when nextCursor is not supplied', async () => {
    const { fetchPage, cursors } = replay([
      response([{ id: 'a' }], { cursor: 'cur_1', hasMore: true }),
      response([{ id: 'b' }], { cursor: '', hasMore: false }),
    ]);

    await expect(drain(paginateCursor(fetchPage))).resolves.toEqual(['a', 'b']);
    expect(cursors).toEqual([undefined, 'cur_1']);
  });

  it('infers hasMore from nextCursor when the API omits it', async () => {
    const { fetchPage, cursors } = replay([
      response([{ id: 'a' }], { nextCursor: 'n1' }),
      response([{ id: 'b' }], { nextCursor: null }),
    ]);

    await expect(drain(paginateCursor(fetchPage))).resolves.toEqual(['a', 'b']);
    expect(cursors).toEqual([undefined, 'n1']);
  });

  it('stops when hasMore is false even though a cursor is still present', async () => {
    const { fetchPage, cursors } = replay([
      response([{ id: 'only' }], { nextCursor: 'should-be-ignored', hasMore: false }),
    ]);

    await expect(drain(paginateCursor(fetchPage))).resolves.toEqual(['only']);
    expect(cursors).toEqual([undefined]);
  });

  it('treats a response without meta as a single final page', async () => {
    const { fetchPage, cursors } = replay([response([{ id: 'a' }, { id: 'b' }])]);

    await expect(drain(paginateCursor(fetchPage))).resolves.toEqual(['a', 'b']);
    expect(cursors).toEqual([undefined]);
  });

  it('continues past an empty page that still reports a new cursor', async () => {
    const { fetchPage, cursors } = replay([
      response([], { nextCursor: 'c1', hasMore: true }),
      response([{ id: 'a' }], { nextCursor: null, hasMore: false }),
    ]);

    await expect(drain(paginateCursor(fetchPage))).resolves.toEqual(['a']);
    expect(cursors).toEqual([undefined, 'c1']);
  });

  it('stops on an empty page that has no cursor left to follow', async () => {
    const { fetchPage, cursors } = replay([response([], { hasMore: true })]);

    await expect(drain(paginateCursor(fetchPage))).resolves.toEqual([]);
    expect(cursors).toEqual([undefined]);
  });

  it('terminates when the API echoes a non-advancing cursor', async () => {
    const { fetchPage, cursors } = replay([
      response([{ id: 'a' }], { nextCursor: 'stuck', hasMore: true }),
      response([{ id: 'b' }], { nextCursor: 'stuck', hasMore: true }),
    ]);

    await expect(drain(paginateCursor(fetchPage))).resolves.toEqual(['a', 'b']);
    expect(cursors).toEqual([undefined, 'stuck']);
  });

  it('honours the maxPages ceiling', async () => {
    let page = 0;
    const cursors: (string | undefined)[] = [];
    const fetchPage: CursorPageFetcher<Item> = async (cursor) => {
      cursors.push(cursor);
      page += 1;
      return response([{ id: `i${page}` }], { nextCursor: `c${page}`, hasMore: true });
    };

    await expect(drain(paginateCursor(fetchPage, { maxPages: 3 }))).resolves.toEqual([
      'i1',
      'i2',
      'i3',
    ]);
    expect(cursors).toEqual([undefined, 'c1', 'c2']);
  });

  it('fetches pages lazily instead of eagerly resolving the whole collection', async () => {
    const { fetchPage, cursors } = replay([
      response([{ id: 'a' }, { id: 'b' }], { nextCursor: 'c1', hasMore: true }),
      response([{ id: 'c' }], { nextCursor: null, hasMore: false }),
    ]);

    const iterator = paginateCursor(fetchPage);

    const first = await iterator.next();
    expect(first).toEqual({ value: { id: 'a' }, done: false });
    // The second page is untouched until the first page is exhausted.
    expect(cursors).toEqual([undefined]);

    await expect(drain(iterator)).resolves.toEqual(['b', 'c']);
    expect(cursors).toEqual([undefined, 'c1']);
  });

  it('propagates errors thrown by the page fetcher', async () => {
    const failure = new Error('boom');
    const fetchPage: CursorPageFetcher<Item> = async () => {
      throw failure;
    };

    await expect(drain(paginateCursor(fetchPage))).rejects.toBe(failure);
  });

  it('yields nothing when the very first page is empty', async () => {
    const { fetchPage } = replay([response([], { nextCursor: null, hasMore: false })]);
    await expect(collect(paginateCursor(fetchPage))).resolves.toEqual([]);
  });

  it('exposes a sane default page ceiling', () => {
    expect(MAX_CURSOR_PAGES).toBeGreaterThan(0);
  });
});

describe('normalizeCursorPage', () => {
  it('normalizes items, nextCursor and hasMore from a full envelope', () => {
    expect(
      normalizeCursorPage(response([{ id: 'a' }], { nextCursor: 'c1', hasMore: true })),
    ).toEqual({
      items: [{ id: 'a' }],
      nextCursor: 'c1',
      hasMore: true,
    });
  });

  it('normalizes an empty cursor and missing hasMore to a terminal page', () => {
    expect(normalizeCursorPage(response([{ id: 'a' }]))).toEqual({
      items: [{ id: 'a' }],
      nextCursor: null,
      hasMore: false,
    });
  });

  it('normalizes a null/undefined data payload to an empty page', () => {
    expect(normalizeCursorPage(response(undefined as unknown as Item[]))).toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
  });

  it('prefers nextCursor over cursor', () => {
    expect(
      normalizeCursorPage(response([], { cursor: 'echoed', nextCursor: 'real', hasMore: true })),
    ).toEqual({ items: [], nextCursor: 'real', hasMore: true });
  });
});

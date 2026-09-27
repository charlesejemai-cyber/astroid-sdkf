import { describe, expect, it } from 'vitest';
import type { AstroidResponse } from '@astroid/core';
import {
  buildPaginationQuery,
  buildPaginationQueryString,
  paginateCursor,
  serializePaginationParams,
  unwrapPaginatedResponse,
} from '../pagination.js';
import {
  Astroid,
  buildPaginationQuery as buildPaginationQueryFromEntry,
  buildPaginationQueryString as buildPaginationQueryStringFromEntry,
  paginateCursor as paginateCursorFromEntry,
} from '../index.js';

interface Row {
  id: string;
}

function rawPage(data: Row[], meta?: AstroidResponse<Row[]>['meta']): AstroidResponse<Row[]> {
  return { data, meta, requestId: undefined, status: 200, headers: new Headers() };
}

describe('pagination serialization and helpers', () => {
  it('serializes cursor, limit, and order correctly', () => {
    const params = {
      cursor: 'cur_123',
      limit: 50,
      order: 'asc' as const,
    };
    const serialized = serializePaginationParams(params);
    expect(serialized).toEqual({
      cursor: 'cur_123',
      limit: 50,
      order: 'asc',
    });
  });

  it('omits undefined pagination parameters safely', () => {
    const params = {
      cursor: undefined,
      limit: 10,
    };
    const serialized = serializePaginationParams(params);
    expect(serialized).toEqual({
      limit: 10,
    });
  });

  it('returns empty object when params are undefined', () => {
    expect(serializePaginationParams(undefined)).toEqual({});
  });

  it('unwraps paginated responses correctly', () => {
    const response = {
      data: [{ id: '1' }, { id: '2' }],
      meta: { cursor: 'cur_next', hasMore: true },
    };
    const items = unwrapPaginatedResponse(response);
    expect(items).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('buildPaginationQuery serialises cursor, limit, and order', () => {
    const query = buildPaginationQuery({ cursor: 'cur_123', limit: 50, order: 'asc' });
    expect(query).toBeInstanceOf(URLSearchParams);
    expect(query.get('cursor')).toBe('cur_123');
    expect(query.get('limit')).toBe('50');
    expect(query.get('order')).toBe('asc');
    expect(query.toString()).toBe('cursor=cur_123&limit=50&order=asc');
  });

  it('buildPaginationQuery omits undefined, null, and empty values without empty segments', () => {
    const query = buildPaginationQuery({
      cursor: undefined,
      limit: undefined,
      order: undefined,
      page: undefined,
    });
    expect(query.toString()).toBe('');

    const withNulls = buildPaginationQuery({
      cursor: null as unknown as string,
      limit: null as unknown as number,
      order: null as unknown as 'asc',
    });
    expect(withNulls.toString()).toBe('');
  });

  it('buildPaginationQuery encodes a page-based (offset) request', () => {
    expect(buildPaginationQuery({ page: 2, limit: 25 }).toString()).toBe('limit=25&page=2');
  });

  it('buildPaginationQueryString returns a leading-? query string or empty string', () => {
    expect(buildPaginationQueryString({ limit: 25 })).toBe('?limit=25');
    expect(buildPaginationQueryString()).toBe('');
    expect(buildPaginationQueryString({})).toBe('');
  });

  it('exposes the pagination builders from the package entry point', () => {
    expect(buildPaginationQueryFromEntry).toBe(buildPaginationQuery);
    expect(buildPaginationQueryStringFromEntry).toBe(buildPaginationQueryString);
  });

  it('serializePaginationParams omits null/empty cursor values', () => {
    expect(
      serializePaginationParams({ cursor: '' as unknown as string, limit: 10, page: 3 }),
    ).toEqual({ limit: 10, page: 3 });
  });

  it('client buildQuery combines pagination and custom query parameters', () => {
    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test',
    });
    const query = client.buildQuery({
      cursor: 'c_1',
      limit: 20,
      order: 'desc',
      status: 'ACTIVE',
    });
    expect(query).toEqual({
      cursor: 'c_1',
      limit: 20,
      order: 'desc',
      status: 'ACTIVE',
    });
  });
});

describe('cursor pagination exposed by @astroid/client', () => {
  it('re-exports the shared helper from the package entry point', () => {
    expect(paginateCursorFromEntry).toBe(paginateCursor);
  });

  it('iterates a multi-page API response, following each nextCursor', async () => {
    const cursors: (string | undefined)[] = [];
    const fetchPage = async (cursor: string | undefined): Promise<AstroidResponse<Row[]>> => {
      cursors.push(cursor);
      switch (cursor) {
        case undefined:
          return rawPage([{ id: 'w1' }, { id: 'w2' }], { nextCursor: 'cur_2', hasMore: true });
        case 'cur_2':
          return rawPage([{ id: 'w3' }], { nextCursor: 'cur_3', hasMore: true });
        case 'cur_3':
          return rawPage([{ id: 'w4' }], { nextCursor: null, hasMore: false });
        default:
          return rawPage([], { nextCursor: null, hasMore: false });
      }
    };

    const ids: string[] = [];
    for await (const row of paginateCursor(fetchPage)) {
      ids.push(row.id);
    }

    expect(ids).toEqual(['w1', 'w2', 'w3', 'w4']);
    expect(cursors).toEqual([undefined, 'cur_2', 'cur_3']);
  });

  it('surfaces empty pages without stopping the iteration', async () => {
    const fetchPage = async (cursor: string | undefined): Promise<AstroidResponse<Row[]>> =>
      cursor === undefined
        ? rawPage([], { nextCursor: 'cur_2', hasMore: true })
        : rawPage([{ id: 'w1' }], { nextCursor: null, hasMore: false });

    const ids: string[] = [];
    for await (const row of paginateCursor(fetchPage)) {
      ids.push(row.id);
    }

    expect(ids).toEqual(['w1']);
  });
});

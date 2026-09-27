import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  CursorPaginated,
  CursorPaginationParams,
  Paginated,
  PaginatedResponse,
  PaginationMeta,
  PaginationParams,
  ResponseMeta,
} from './index.js';

interface SampleItem {
  id: string;
  name: string;
}

describe('@astroid/types — pagination', () => {
  it('PaginationParams exposes only optional request parameters', () => {
    expectTypeOf<PaginationParams>().toEqualTypeOf<{
      page?: number;
      cursor?: string;
      limit?: number;
      order?: 'asc' | 'desc';
    }>();
  });

  it('PaginationParams accepts offset-, cursor- and empty-shaped params', () => {
    const offset: PaginationParams = { page: 2, limit: 25 };
    const cursor: PaginationParams = { cursor: 'cur_abc', limit: 25, order: 'desc' };
    const empty: PaginationParams = {};
    expect(offset.page).toBe(2);
    expect(cursor.cursor).toBe('cur_abc');
    expect(empty).toEqual({});
  });

  it('PaginatedResponse is generic and wraps an item array with optional metadata', () => {
    expectTypeOf<PaginatedResponse<SampleItem>>().toEqualTypeOf<{
      data: SampleItem[];
      meta?: ResponseMeta;
    }>();
  });

  it('PaginatedResponse compiles with cursor-based metadata', () => {
    const page: PaginatedResponse<SampleItem> = {
      data: [{ id: '1', name: 'one' }],
      meta: { nextCursor: 'cur_next', limit: 25, total: 120, hasMore: true },
    };
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.name).toBe('one');
    expect(page.meta?.nextCursor).toBe('cur_next');
  });

  it('PaginatedResponse compiles with offset-based metadata', () => {
    const page: PaginatedResponse<SampleItem> = {
      data: [{ id: '2', name: 'two' }],
      meta: { page: 1, limit: 25, total: 50 },
    };
    expect(page.meta?.page).toBe(1);
    expect(page.meta?.total).toBe(50);
  });

  it('PaginatedResponse allows an unwrapped response', () => {
    const page: PaginatedResponse<SampleItem> = { data: [] };
    expectTypeOf(page.meta).toEqualTypeOf<ResponseMeta | undefined>();
  });

  it('PaginationMeta requires the full offset-pagination metadata set', () => {
    expectTypeOf<PaginationMeta>().toEqualTypeOf<{
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    }>();
  });

  it('Paginated is generic and requires full pagination metadata', () => {
    expectTypeOf<Paginated<SampleItem>>().toEqualTypeOf<{
      data: SampleItem[];
      meta: PaginationMeta;
    }>();
  });

  it('CursorPaginationParams exposes only cursor, limit and order', () => {
    expectTypeOf<CursorPaginationParams>().toEqualTypeOf<{
      cursor?: string;
      limit?: number;
      order?: 'asc' | 'desc';
    }>();
  });

  it('CursorPaginated is generic and follows a keyset envelope', () => {
    expectTypeOf<CursorPaginated<SampleItem>>().toEqualTypeOf<{
      items: SampleItem[];
      nextCursor: string | null;
      prevCursor?: string | null;
      hasMore: boolean;
    }>();
    const page: CursorPaginated<SampleItem> = { items: [], nextCursor: null, hasMore: false };
    expect(page.nextCursor).toBeNull();

    const withPrev: CursorPaginated<SampleItem> = {
      items: [],
      nextCursor: 'cur_next',
      prevCursor: 'cur_prev',
      hasMore: true,
    };
    expect(withPrev.prevCursor).toBe('cur_prev');
  });

  it('PaginatedResponse is assignable to a generic unwrapping helper', () => {
    const unwrap = <T>(response: PaginatedResponse<T>): T[] => response.data;
    const page: PaginatedResponse<SampleItem> = {
      data: [{ id: '3', name: 'three' }],
      meta: { total: 1 },
    };
    const expected: SampleItem[] = unwrap(page);
    expectTypeOf(expected).toEqualTypeOf<SampleItem[]>();
  });

  it('ResponseMeta surfaces standard pagination fields', () => {
    const meta: ResponseMeta = {
      cursor: 'cur_before',
      nextCursor: 'cur_after',
      prevCursor: 'cur_before',
      page: 3,
      limit: 50,
      total: 250,
      hasMore: true,
    };
    expect(meta.nextCursor).toBe('cur_after');
    expect(meta.prevCursor).toBe('cur_before');
    expectTypeOf(meta.nextCursor).toEqualTypeOf<string | null | undefined>();
    expectTypeOf(meta.prevCursor).toEqualTypeOf<string | null | undefined>();
  });
});

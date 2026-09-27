import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '@astroid/types';

import { AgentResource } from '../index.js';

function createClientMock() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
}

function makeAgent(id: string): Agent {
  return {
    id,
    organizationId: 'org_1',
    name: `Agent ${id}`,
    role: 'OPERATIONS',
    status: 'ACTIVE',
    capabilities: [],
    metadata: {},
    createdAt: '2026-08-29T10:00:00.000Z',
    updatedAt: '2026-08-29T10:00:00.000Z',
  };
}

/** A raw list response as the HTTP client would hand it back (already unwrapped). */
function page(data: Agent[], meta?: Record<string, unknown>) {
  return { data, meta, requestId: undefined, status: 200, headers: new Headers() };
}

async function ids(iterable: AsyncIterable<Agent>): Promise<string[]> {
  const out: string[] = [];
  for await (const agent of iterable) out.push(agent.id);
  return out;
}

describe('AgentResource.iterateByCursor', () => {
  let http: ReturnType<typeof createClientMock>;
  let resource: AgentResource;

  beforeEach(() => {
    http = createClientMock();
    resource = new AgentResource(http as never);
  });

  it('streams every agent across multiple cursor pages', async () => {
    http.get
      .mockResolvedValueOnce(
        page([makeAgent('a1'), makeAgent('a2')], { nextCursor: 'c1', hasMore: true }),
      )
      .mockResolvedValueOnce(page([makeAgent('a3')], { nextCursor: 'c2', hasMore: true }))
      .mockResolvedValueOnce(page([makeAgent('a4')], { nextCursor: null, hasMore: false }));

    await expect(ids(resource.iterateByCursor())).resolves.toEqual(['a1', 'a2', 'a3', 'a4']);

    expect(http.get).toHaveBeenCalledTimes(3);
    expect(http.get).toHaveBeenNthCalledWith(1, '/agents', {});
    expect(http.get).toHaveBeenNthCalledWith(2, '/agents', { query: { cursor: 'c1' } });
    expect(http.get).toHaveBeenNthCalledWith(3, '/agents', { query: { cursor: 'c2' } });
  });

  it('carries the caller filters and page size through every request', async () => {
    http.get
      .mockResolvedValueOnce(page([makeAgent('a1')], { nextCursor: 'c1', hasMore: true }))
      .mockResolvedValueOnce(page([makeAgent('a2')], { nextCursor: null, hasMore: false }));

    await expect(
      ids(resource.iterateByCursor({ status: 'ACTIVE', role: 'OPERATIONS', limit: 2 })),
    ).resolves.toEqual(['a1', 'a2']);

    expect(http.get).toHaveBeenNthCalledWith(1, '/agents', {
      query: { status: 'ACTIVE', role: 'OPERATIONS', limit: 2 },
    });
    expect(http.get).toHaveBeenNthCalledWith(2, '/agents', {
      query: { status: 'ACTIVE', role: 'OPERATIONS', limit: 2, cursor: 'c1' },
    });
  });

  it('resumes from a caller-supplied cursor', async () => {
    http.get.mockResolvedValueOnce(page([makeAgent('a9')], { nextCursor: null, hasMore: false }));

    await expect(ids(resource.iterateByCursor({ cursor: 'resume_here' }))).resolves.toEqual(['a9']);

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get).toHaveBeenCalledWith('/agents', { query: { cursor: 'resume_here' } });
  });

  it('stops after a single page when the API returns no cursor', async () => {
    http.get.mockResolvedValueOnce(page([makeAgent('a1')]));

    await expect(ids(resource.iterateByCursor())).resolves.toEqual(['a1']);
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('skips empty pages that still advertise another cursor', async () => {
    http.get
      .mockResolvedValueOnce(page([], { nextCursor: 'c1', hasMore: true }))
      .mockResolvedValueOnce(page([makeAgent('a1')], { nextCursor: null, hasMore: false }));

    await expect(ids(resource.iterateByCursor())).resolves.toEqual(['a1']);
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('does not issue a follow-up request until the previous page is consumed', async () => {
    http.get.mockResolvedValueOnce(
      page([makeAgent('a1'), makeAgent('a2')], { nextCursor: 'c1', hasMore: true }),
    );
    http.get.mockResolvedValueOnce(page([makeAgent('a3')], { nextCursor: null, hasMore: false }));

    const iterator = resource.iterateByCursor();
    const first = await iterator.next();

    expect(first.done).toBe(false);
    expect(first.value).toEqual(makeAgent('a1'));
    expect(http.get).toHaveBeenCalledTimes(1);

    await expect(ids(iterator)).resolves.toEqual(['a2', 'a3']);
    expect(http.get).toHaveBeenCalledTimes(2);
  });
});

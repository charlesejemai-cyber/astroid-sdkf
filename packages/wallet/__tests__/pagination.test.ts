import { describe, expect, it, vi } from 'vitest';

import { HttpClient } from '@astroid/core';

import { WalletResource } from '../src/index.js';

const WALLETS = [
  {
    id: 'w_1',
    organizationId: 'org_1',
    name: 'Ops',
    walletType: 'TREASURY',
    status: 'ACTIVE',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'w_2',
    organizationId: 'org_1',
    name: 'Payroll',
    walletType: 'TREASURY',
    status: 'ACTIVE',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'w_3',
    organizationId: 'org_1',
    name: 'Escrow',
    walletType: 'ESCROW',
    status: 'ACTIVE',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
];

/** A HTTP 200 response carrying an enveloped `data`/`meta` payload. */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Build a `WalletResource` wired to a fake API that serves three wallets across
 * two cursor pages, recording the URL of every request.
 */
function paginatedClient() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const cursor = url.searchParams.get('cursor');
    if (cursor === null) {
      return jsonResponse({
        data: [WALLETS[0], WALLETS[1]],
        meta: { nextCursor: 'cur_2', hasMore: true },
      });
    }
    if (cursor === 'cur_2') {
      return jsonResponse({
        data: [WALLETS[2]],
        meta: { nextCursor: null, hasMore: false },
      });
    }
    return jsonResponse({ data: [], meta: { nextCursor: null, hasMore: false } });
  });

  const http = new HttpClient({
    apiKey: 'sk_test',
    baseUrl: 'https://api.example.test',
    retry: false,
    fetch: fetchMock as unknown as typeof fetch,
  });

  return { resource: new WalletResource(http), fetch: fetchMock };
}

describe('WalletResource.iterateByCursor', () => {
  it('streams every wallet across cursor pages, sending the cursor back to the API', async () => {
    const { resource, fetch } = paginatedClient();

    const ids: string[] = [];
    for await (const wallet of resource.iterateByCursor({ limit: 2 })) {
      ids.push(wallet.id);
    }

    expect(ids).toEqual(['w_1', 'w_2', 'w_3']);
    expect(fetch).toHaveBeenCalledTimes(2);

    const firstUrl = new URL(String(fetch.mock.calls[0]![0]));
    expect(firstUrl.pathname).toContain('/wallets');
    expect(firstUrl.searchParams.get('limit')).toBe('2');
    expect(firstUrl.searchParams.get('cursor')).toBeNull();

    const secondUrl = new URL(String(fetch.mock.calls[1]![0]));
    expect(secondUrl.searchParams.get('cursor')).toBe('cur_2');
  });

  it('forwards filters on every page request', async () => {
    const { resource, fetch } = paginatedClient();

    const ids: string[] = [];
    for await (const wallet of resource.iterateByCursor({
      status: 'ACTIVE',
      walletType: 'TREASURY',
    })) {
      ids.push(wallet.id);
    }

    expect(ids).toEqual(['w_1', 'w_2', 'w_3']);
    for (const call of fetch.mock.calls) {
      const url = new URL(String(call[0]));
      expect(url.searchParams.get('status')).toBe('ACTIVE');
      expect(url.searchParams.get('walletType')).toBe('TREASURY');
    }
  });

  it('stops after one page when the API returns no cursor', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [WALLETS[0]], meta: { nextCursor: null, hasMore: false } }),
    );
    const http = new HttpClient({
      apiKey: 'sk_test',
      baseUrl: 'https://api.example.test',
      retry: false,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const resource = new WalletResource(http);

    const ids: string[] = [];
    for await (const wallet of resource.iterateByCursor()) {
      ids.push(wallet.id);
    }

    expect(ids).toEqual(['w_1']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches lazily: the second page is only requested once the first is consumed', async () => {
    const { resource, fetch } = paginatedClient();

    const iterator = resource.iterateByCursor();
    const first = await iterator.next();

    expect(first.done).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);

    const rest: string[] = [];
    for await (const wallet of iterator) {
      rest.push(wallet.id);
    }

    expect(rest).toEqual(['w_2', 'w_3']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

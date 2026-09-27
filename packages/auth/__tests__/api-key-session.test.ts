import { describe, expect, it, vi } from 'vitest';

import { AuthenticationError } from '@astroid/errors';
import type { PreparedRequest } from '@astroid/core';
import type { AuthTokens } from '@astroid/types';

import { SessionManager, createSessionMiddleware, type TokenStorage } from '../src/session.js';

/** Minimal prepared-request fixture accepted by the middleware. */
function request(overrides: Partial<PreparedRequest> = {}): PreparedRequest {
  return {
    method: 'GET',
    url: 'https://api.astroid.finance/v1/wallets',
    headers: { accept: 'application/json' },
    body: undefined,
    timeoutMs: 30_000,
    retryable: true,
    signal: undefined,
    options: { method: 'GET', path: '/wallets' },
    ...overrides,
  } as PreparedRequest;
}

function memoryStorage(): { storage: TokenStorage; map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value);
      },
      removeItem: (key) => {
        map.delete(key);
      },
    },
  };
}

describe('SessionManager — API key mode', () => {
  it('infers API key mode when only an apiKey is supplied', () => {
    const session = new SessionManager({ apiKey: 'sk_live_123' });
    expect(session.mode).toBe('apiKey');
    expect(session.getApiKey()).toBe('sk_live_123');
    expect(session.isAuthenticated()).toBe(true);
  });

  it('defaults to JWT mode when access tokens are present', () => {
    const session = new SessionManager({ accessToken: 'a.b.c', apiKey: 'sk_live_123' });
    expect(session.mode).toBe('jwt');
  });

  it('produces the x-api-key header', () => {
    const session = new SessionManager({ apiKey: 'sk_live_123' });
    expect(session.getAuthHeaders()).toEqual({ 'x-api-key': 'sk_live_123' });
    expect(session.applyAuthHeaders({ accept: 'application/json' })).toEqual({
      accept: 'application/json',
      'x-api-key': 'sk_live_123',
    });
  });

  it('supports a custom API key header name', () => {
    const session = new SessionManager({ apiKey: 'sk_live_123', apiKeyHeader: 'x-astroid-key' });
    expect(session.getAuthHeaders()).toEqual({ 'x-astroid-key': 'sk_live_123' });
  });

  it('reports unauthenticated without a key and throws a clear error', () => {
    const session = new SessionManager({ mode: 'apiKey' });
    expect(session.isAuthenticated()).toBe(false);
    expect(session.getAuthHeaders()).toBeUndefined();

    try {
      session.assertAuthenticated();
      expect.unreachable('expected an AuthenticationError');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthenticationError);
      expect((err as AuthenticationError).code).toBe('UNAUTHENTICATED');
    }
  });

  it('does not support token refresh in API key mode', async () => {
    const session = new SessionManager({ apiKey: 'sk_live_123' });
    const refreshFn = vi.fn();

    await expect(session.refreshSession(refreshFn)).rejects.toBeInstanceOf(AuthenticationError);
    expect(refreshFn).not.toHaveBeenCalled();
  });

  it('persists and clears the API key through storage', async () => {
    const { storage, map } = memoryStorage();
    const session = new SessionManager({ storage });

    await session.setApiKey('sk_live_abc');
    expect(map.get('astroid_auth_api_key')).toBe('sk_live_abc');

    await session.clearTokens();
    expect(map.has('astroid_auth_api_key')).toBe(false);
    expect(session.isAuthenticated()).toBe(false);
  });

  it('rejects an empty API key', async () => {
    const session = new SessionManager();
    await expect(session.setApiKey('')).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('injects the API key header via the session middleware', async () => {
    const session = new SessionManager({ apiKey: 'sk_live_123' });
    const middleware = createSessionMiddleware(session, vi.fn() as () => Promise<AuthTokens>);

    const prepared = await middleware.onRequest!(request());
    expect(prepared.headers['x-api-key']).toBe('sk_live_123');
  });

  it('leaves requests untouched when no API key is configured', async () => {
    const session = new SessionManager({ mode: 'apiKey' });
    const middleware = createSessionMiddleware(session, vi.fn() as () => Promise<AuthTokens>);

    const prepared = await middleware.onRequest!(request());
    expect(prepared.headers['x-api-key']).toBeUndefined();
  });
});

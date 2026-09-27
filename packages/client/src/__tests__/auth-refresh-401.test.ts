/**
 * Integration tests for the 401 session-token auto-refresh interceptor.
 *
 * Drives the full `Astroid` client against a mocked `fetch` to verify the
 * pipeline wired by the constructor:
 *
 *   request → 401 → refresh `/auth/refresh` → retry original request → 200
 *
 * Covers the acceptance criteria of issue #251:
 * - a 401 response transparently triggers refresh + retry
 * - the failed request is retried exactly once (no infinite refresh loops)
 * - `/auth/refresh` itself never triggers a second refresh (loop prevention)
 * - when the refresh token is exhausted, the original 401 error is escalated
 * - the new access token is adopted by the shared client and used by the retry
 *
 * The access token is a *valid, unexpired* JWT so the proactive session
 * middleware does not refresh before the request; the server-side 401 is what
 * drives the reactive refresh path under test.
 *
 * All network traffic is mocked; no live API is contacted.
 */

import { describe, expect, it, vi } from 'vitest';
import { AuthenticationError } from '@astroid/errors';
import { Astroid } from '../index.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Build a JWT-shaped token whose `exp` is `offsetSeconds` from now. */
function createTestJwt(offsetSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: 'user_123', exp: Math.floor(Date.now() / 1000) + offsetSeconds }),
  ).toString('base64url');
  return `${header}.${payload}.mock_signature`;
}

function okResponse(data: unknown = { id: 'ok' }): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      error: { code: 'AUTHENTICATION_ERROR', message: 'Access token expired' },
    }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );
}

/** Mock fetch returning queued responses in order; repeats the last one. */
function fetchQueue(...responses: Response[]): ReturnType<typeof vi.fn> {
  let idx = 0;
  return vi.fn().mockImplementation(async () => {
    const res = responses[idx] ?? responses[responses.length - 1]!;
    idx += 1;
    return res;
  });
}

/**
 * Base client config: no retries, explicit mock fetch, an unexpired access
 * token (so the proactive middleware stays idle) and a refresh token so the
 * reactive 401 handler can renew the session.
 */
function baseConfig(fetchMock: ReturnType<typeof vi.fn>, accessToken?: string) {
  return {
    apiKey: 'sk_test_auth_refresh',
    baseUrl: 'https://api.astroid.test',
    retry: false as const,
    fetch: fetchMock as unknown as typeof fetch,
    accessToken: accessToken ?? createTestJwt(3600),
    refreshToken: 'refresh_token_valid',
  };
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe('401 auto-refresh interceptor (client integration)', () => {
  it('refreshes the token and transparently retries the original request on 401', async () => {
    const freshToken = createTestJwt(7200);
    const fetchMock = fetchQueue(
      unauthorizedResponse(), // 1st call to /wallets → 401
      okResponse({ accessToken: freshToken }), // POST /auth/refresh → 200
      okResponse({ id: 'wal_refreshed' }), // retry of /wallets with new token → 200
    );

    const client = new Astroid(
      baseConfig(fetchMock) as ConstructorParameters<typeof Astroid>[0],
    );

    const res = await client.http.get<{ id: string }>('/wallets');

    expect(res.data.id).toBe('wal_refreshed');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(client.sessionManager.getAccessToken()).toBe(freshToken);
    expect(client.http.config.auth.accessToken).toBe(freshToken);
  });

  it('retries the original request exactly once and then escalates if still 401', async () => {
    const fetchMock = fetchQueue(
      unauthorizedResponse(), // /wallets → 401
      okResponse({ accessToken: createTestJwt(3600) }), // refresh succeeds
      unauthorizedResponse(), // retry still 401 → must fail fast, no second refresh
    );

    const client = new Astroid(baseConfig(fetchMock) as ConstructorParameters<typeof Astroid>[0]);

    await expect(client.http.get('/wallets')).rejects.toThrow(AuthenticationError);

    // 3 calls: original + refresh + single retry. A second refresh would make it 4.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not attempt a refresh when the refresh token is absent (single-shot 401)', async () => {
    const fetchMock = fetchQueue(unauthorizedResponse());

    const config = { ...baseConfig(fetchMock), refreshToken: undefined };
    const client = new Astroid(config as ConstructorParameters<typeof Astroid>[0]);

    await expect(client.http.get('/wallets')).rejects.toThrow(AuthenticationError);

    // Only the original request: no refresh endpoint was hit.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('/auth/refresh');
  });

  it('escalates the original 401 as AuthenticationError when the refresh call fails', async () => {
    const fetchMock = fetchQueue(
      unauthorizedResponse(), // /wallets → 401
      unauthorizedResponse(), // POST /auth/refresh itself → 401 (refresh token expired)
    );

    const client = new Astroid(baseConfig(fetchMock) as ConstructorParameters<typeof Astroid>[0]);

    await expect(client.http.get('/wallets')).rejects.toThrow(AuthenticationError);

    // Original + failed refresh; the original request is not retried.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/auth/refresh');
  });

  it('excludes /auth/refresh from the interceptor so a failing refresh cannot loop', async () => {
    const fetchMock = fetchQueue(unauthorizedResponse(), unauthorizedResponse());

    const client = new Astroid(baseConfig(fetchMock) as ConstructorParameters<typeof Astroid>[0]);

    await expect(client.auth.refresh({ refreshToken: 'expired-refresh-token' })).rejects.toThrow(
      AuthenticationError,
    );

    // Exactly one POST to /auth/refresh — a refresh response of 401 must not
    // trigger a second refresh, which would loop forever.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/auth/refresh');
  });

  it('uses the refreshed token for the retried request (no stale credentials replayed)', async () => {
    const freshToken = createTestJwt(3600);
    const fetchMock = fetchQueue(
      unauthorizedResponse(),
      okResponse({ accessToken: freshToken, refreshToken: 'refresh_rotated' }),
      okResponse({ id: 'wal_ok' }),
    );

    const client = new Astroid(baseConfig(fetchMock) as ConstructorParameters<typeof Astroid>[0]);

    await client.http.get('/wallets');

    const retryHeaders = fetchMock.mock.calls[2]?.[1]?.headers as Record<string, string>;
    expect(retryHeaders['authorization']).toBe(`Bearer ${freshToken}`);
    expect(client.sessionManager.getRefreshToken()).toBe('refresh_rotated');
  });
});

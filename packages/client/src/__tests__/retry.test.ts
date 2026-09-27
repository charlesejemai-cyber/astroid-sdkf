/**
 * Unit and integration tests for the retry middleware.
 *
 * Verifies that:
 * - The middleware factory returns a correctly-named middleware.
 * - Retry config and options are injected into request context.
 * - retryAllMethods forces retryable=true on non-idempotent methods.
 * - computeRetryDelay honours Retry-After on 429 and uses backoff otherwise.
 * - The full Astroid client retries on 503 responses.
 * - The full Astroid client retries on 429 responses and eventually succeeds.
 * - Retries are exhausted and the last error is thrown after maxRetries+1 attempts.
 * - The onRetry callback is called with correct attempt/delayMs arguments.
 * - Non-retryable errors (4xx except 429) are not retried.
 * - Network-level errors are retried.
 * - Requests that exceed their timeout are retried, subject to idempotency gating.
 * - retry: false disables retries entirely.
 */

import { describe, expect, it, vi } from 'vitest';
import { RateLimitError, ServerError } from '@astroid/errors';
import { AstroidTimeoutError } from '@astroid/core';
import { Astroid, backoffDelay } from '../index.js';
import {
  createRetryMiddleware,
  retryMiddleware,
  computeRetryDelay,
  type RetryMiddlewareConfig,
} from '../middleware/retry.js';
import type { PreparedRequest } from '@astroid/core';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const BASE_CONFIG = {
  apiKey: 'sk_test_retry_123',
  baseUrl: 'https://api.astroid.test',
  // Disable the default retry so each test controls it explicitly.
  retry: false as const,
};

function okResponse(data: unknown = { id: 'ok' }): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponseWithRetryAfter(
  status: number,
  code: string,
  message: string,
  retryAfter: string,
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json', 'retry-after': retryAfter },
  });
}

/** Build a mock fetch that returns responses from the provided queue in order. */
function fetchQueue(...responses: Response[]): ReturnType<typeof vi.fn> {
  let idx = 0;
  return vi.fn().mockImplementation(async () => {
    const res = responses[idx] ?? responses[responses.length - 1]!;
    idx++;
    return res;
  });
}

/* -------------------------------------------------------------------------- */
/* createRetryMiddleware — factory tests                                       */
/* -------------------------------------------------------------------------- */

describe('createRetryMiddleware', () => {
  it('returns a middleware named "retry"', () => {
    const mw = createRetryMiddleware();
    expect(mw.name).toBe('retry');
  });

  it('injects default retry config into request context', () => {
    const mw = createRetryMiddleware();
    const req = makeRequest('GET');
    const prepared = mw.onRequest!(req) as PreparedRequest;

    const ctx = prepared.options.context as Record<string, unknown>;
    expect(ctx._retryConfig).toMatchObject({
      maxRetries: 3,
      baseDelayMs: 250,
      maxDelayMs: 8000,
    });
  });

  it('injects custom retry config into request context', () => {
    const mw = createRetryMiddleware({ maxRetries: 5, baseDelayMs: 100, maxDelayMs: 5000 });
    const req = makeRequest('GET');
    const prepared = mw.onRequest!(req) as PreparedRequest;

    const ctx = prepared.options.context as Record<string, unknown>;
    expect(ctx._retryConfig).toMatchObject({ maxRetries: 5, baseDelayMs: 100, maxDelayMs: 5000 });
  });

  it('preserves existing context values when injecting retry context', () => {
    const mw = createRetryMiddleware();
    const req = makeRequest('GET', { existing: 'value' });
    const prepared = mw.onRequest!(req) as PreparedRequest;

    const ctx = prepared.options.context as Record<string, unknown>;
    expect(ctx.existing).toBe('value');
    expect(ctx._retryConfig).toBeDefined();
  });

  it('does not override retryable on a GET request (already true)', () => {
    const mw = createRetryMiddleware();
    const req = makeRequest('GET');
    const prepared = mw.onRequest!(req) as PreparedRequest;
    expect(prepared.retryable).toBe(true);
  });

  it('does not force retryable on POST when retryAllMethods is false (default)', () => {
    const mw = createRetryMiddleware({ retryAllMethods: false });
    const req = makeRequest('POST');
    const prepared = mw.onRequest!(req) as PreparedRequest;
    expect(prepared.retryable).toBe(false);
  });

  it('forces retryable=true on POST when retryAllMethods is true', () => {
    const mw = createRetryMiddleware({ retryAllMethods: true });
    const req = makeRequest('POST');
    const prepared = mw.onRequest!(req) as PreparedRequest;
    expect(prepared.retryable).toBe(true);
  });

  it('injects the onRetry callback into _retryOptions', () => {
    const onRetry = vi.fn();
    const mw = createRetryMiddleware({ onRetry });
    const req = makeRequest('GET');
    const prepared = mw.onRequest!(req) as PreparedRequest;

    const ctx = prepared.options.context as Record<string, unknown>;
    const opts = ctx._retryOptions as RetryMiddlewareConfig;
    expect(opts.onRetry).toBe(onRetry);
  });

  it('injects a custom shouldRetryStatus into _retryOptions', () => {
    const shouldRetryStatus = vi.fn().mockReturnValue(true);
    const mw = createRetryMiddleware({ shouldRetryStatus });
    const req = makeRequest('GET');
    const prepared = mw.onRequest!(req) as PreparedRequest;

    const ctx = prepared.options.context as Record<string, unknown>;
    const opts = ctx._retryOptions as RetryMiddlewareConfig;
    expect(opts.shouldRetryStatus).toBe(shouldRetryStatus);
  });
});

/* -------------------------------------------------------------------------- */
/* retryMiddleware alias                                                       */
/* -------------------------------------------------------------------------- */

describe('retryMiddleware', () => {
  it('is the same function reference as createRetryMiddleware', () => {
    expect(retryMiddleware).toBe(createRetryMiddleware);
  });

  it('creates a working middleware instance', () => {
    const mw = retryMiddleware({ maxRetries: 1 });
    expect(mw.name).toBe('retry');
  });
});

/* -------------------------------------------------------------------------- */
/* computeRetryDelay                                                           */
/* -------------------------------------------------------------------------- */

describe('computeRetryDelay', () => {
  const config = { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 2000 };

  it('uses Retry-After header on 429 responses (in ms)', () => {
    // 2 seconds → 2000ms, but capped at maxDelayMs=2000
    expect(computeRetryDelay(1, config, 429, 2)).toBe(2000);
    // 1 second → 1000ms
    expect(computeRetryDelay(1, config, 429, 1)).toBe(1000);
  });

  it('caps Retry-After at maxDelayMs', () => {
    // 10 seconds → 10000ms, capped at 2000
    expect(computeRetryDelay(1, config, 429, 10)).toBe(2000);
  });

  it('returns 0 when Retry-After is 0', () => {
    expect(computeRetryDelay(1, config, 429, 0)).toBe(0);
  });

  it('uses exponential backoff for non-429 statuses', () => {
    // Attempt 1: 100 * 2^0 = 100, random=0.5 → floor(0.5 * 100) = 50
    expect(computeRetryDelay(1, config, 503, undefined, () => 0.5)).toBe(50);
    // Attempt 2: 100 * 2^1 = 200, random=0.5 → floor(0.5 * 200) = 100
    expect(computeRetryDelay(2, config, 503, undefined, () => 0.5)).toBe(100);
  });

  it('uses exponential backoff when Retry-After is absent on 429', () => {
    const delay = computeRetryDelay(1, config, 429, undefined, () => 1.0);
    // Attempt 1: 100 * 2^0 = 100, random=1.0 → floor(1.0 * 100) = 100
    expect(delay).toBe(100);
  });

  it('ignores NaN Retry-After and falls back to backoff', () => {
    const delay = computeRetryDelay(1, config, 429, NaN, () => 0.5);
    expect(delay).toBe(50);
  });

  it('caps backoff at maxDelayMs', () => {
    // Attempt 10: 100 * 2^9 = 51200, capped at 2000, random=1.0 → 2000
    expect(computeRetryDelay(10, config, 503, undefined, () => 1.0)).toBe(2000);
  });
});

/* -------------------------------------------------------------------------- */
/* Integration: Astroid client + retry middleware                             */
/* -------------------------------------------------------------------------- */

describe('Astroid client — retry on 503', () => {
  it('retries once on a transient 503 and returns the successful result', async () => {
    const mockFetch = fetchQueue(
      errorResponse(503, 'SERVER_ERROR', 'Service Unavailable'),
      okResponse({ id: 'w_503', name: 'Recovered' }),
    );

    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: mockFetch as unknown as typeof fetch,
    });
    client.use(createRetryMiddleware({ maxRetries: 2, baseDelayMs: 5, maxDelayMs: 50 }));

    const wallet = await client.wallets.get('w_503');
    expect(wallet).toMatchObject({ id: 'w_503', name: 'Recovered' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries up to maxRetries times and throws ServerError when all attempts fail', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Service Unavailable');
    });

    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: mockFetch as unknown as typeof fetch,
    });
    client.use(createRetryMiddleware({ maxRetries: 2, baseDelayMs: 5, maxDelayMs: 20 }));

    await expect(client.wallets.get('w_fail')).rejects.toBeInstanceOf(ServerError);
    expect(callCount).toBe(3); // initial + 2 retries
  });

  it('calls onRetry for each failed attempt with correct attempt number', async () => {
    const retryCalls: Array<{ attempt: number }> = [];
    const mockFetch = fetchQueue(
      errorResponse(503, 'SERVER_ERROR', 'Fail 1'),
      errorResponse(503, 'SERVER_ERROR', 'Fail 2'),
      okResponse({ id: 'w_final' }),
    );

    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: mockFetch as unknown as typeof fetch,
    });
    client.use(
      createRetryMiddleware({
        maxRetries: 3,
        baseDelayMs: 5,
        maxDelayMs: 50,
        onRetry: (attempt) => {
          retryCalls.push({ attempt });
        },
      }),
    );

    await client.wallets.get('w_retry');

    expect(retryCalls).toHaveLength(2);
    expect(retryCalls[0]!.attempt).toBe(1);
    expect(retryCalls[1]!.attempt).toBe(2);
  });

  it('also retries on 502 and 504 (gateway errors)', async () => {
    const mock502 = fetchQueue(
      errorResponse(502, 'BAD_GATEWAY', 'Bad Gateway'),
      okResponse({ id: 'w_502' }),
    );
    const client502 = new Astroid({
      ...BASE_CONFIG,
      fetch: mock502 as unknown as typeof fetch,
    });
    client502.use(createRetryMiddleware({ maxRetries: 2, baseDelayMs: 5, maxDelayMs: 20 }));
    await expect(client502.wallets.get('w')).resolves.toMatchObject({ id: 'w_502' });

    const mock504 = fetchQueue(
      errorResponse(504, 'GATEWAY_TIMEOUT', 'Gateway Timeout'),
      okResponse({ id: 'w_504' }),
    );
    const client504 = new Astroid({
      ...BASE_CONFIG,
      fetch: mock504 as unknown as typeof fetch,
    });
    client504.use(createRetryMiddleware({ maxRetries: 2, baseDelayMs: 5, maxDelayMs: 20 }));
    await expect(client504.wallets.get('w')).resolves.toMatchObject({ id: 'w_504' });
  });
});

/* -------------------------------------------------------------------------- */
/* Integration: Astroid client + retry on 429                                 */
/* -------------------------------------------------------------------------- */

describe('Astroid client — retry on 429', () => {
  it('retries on 429 and eventually succeeds', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return errorResponse(429, 'RATE_LIMITED', 'Too Many Requests');
      }
      return okResponse({ id: 'w_429', name: 'After Rate Limit' });
    });

    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: mockFetch as unknown as typeof fetch,
    });
    client.use(createRetryMiddleware({ maxRetries: 2, baseDelayMs: 5, maxDelayMs: 50 }));

    const wallet = await client.wallets.get('w_429');
    expect(wallet).toMatchObject({ id: 'w_429', name: 'After Rate Limit' });
    expect(callCount).toBe(2);
  });

  it('honours Retry-After header on 429 response', async () => {
    let callCount = 0;
    const timestamps: number[] = [];

    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      timestamps.push(Date.now());
      if (callCount === 1) {
        return errorResponseWithRetryAfter(
          429,
          'RATE_LIMITED',
          'Too Many Requests',
          '0.05', // 50ms
        );
      }
      return okResponse({ id: 'w_retry_after' });
    });

    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: mockFetch as unknown as typeof fetch,
    });
    client.use(createRetryMiddleware({ maxRetries: 2, baseDelayMs: 1, maxDelayMs: 500 }));

    await client.wallets.get('w_ra');

    expect(callCount).toBe(2);
    // The retry should wait at least the Retry-After duration (~50ms).
    const elapsed = timestamps[1]! - timestamps[0]!;
    expect(elapsed).toBeGreaterThanOrEqual(40); // allow 10ms tolerance
  });

  it('throws RateLimitError after exhausting retries on persistent 429', async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(async () => errorResponse(429, 'RATE_LIMITED', 'Too Many Requests'));

    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: mockFetch as unknown as typeof fetch,
    });
    client.use(createRetryMiddleware({ maxRetries: 1, baseDelayMs: 5, maxDelayMs: 20 }));

    await expect(client.wallets.get('w_429_exhausted')).rejects.toBeInstanceOf(RateLimitError);
    expect(mockFetch).toHaveBeenCalledTimes(2); // initial + 1 retry
  });
});

/* -------------------------------------------------------------------------- */
/* Integration: non-retryable errors                                          */
/* -------------------------------------------------------------------------- */

describe('Astroid client — non-retryable errors', () => {
  it('does not retry on 400 (Bad Request)', async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(async () => errorResponse(400, 'VALIDATION_ERROR', 'Bad Request'));

    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: mockFetch as unknown as typeof fetch,
    });
    client.use(createRetryMiddleware({ maxRetries: 3, baseDelayMs: 5, maxDelayMs: 50 }));

    await expect(client.wallets.get('w_400')).rejects.toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(1); // no retries
  });

  it('does not retry on 404 (Not Found)', async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(async () => errorResponse(404, 'NOT_FOUND', 'Wallet not found'));

    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: mockFetch as unknown as typeof fetch,
    });
    client.use(createRetryMiddleware({ maxRetries: 3, baseDelayMs: 5, maxDelayMs: 50 }));

    await expect(client.wallets.get('w_404')).rejects.toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(1); // no retries
  });

  it('does not retry on 422 (Unprocessable Entity)', async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(async () => errorResponse(422, 'VALIDATION_ERROR', 'Unprocessable'));

    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: mockFetch as unknown as typeof fetch,
    });
    client.use(createRetryMiddleware({ maxRetries: 3, baseDelayMs: 5, maxDelayMs: 50 }));

    await expect(client.wallets.get('w_422')).rejects.toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(1); // no retries
  });

  it('does not retry on 408 (Request Timeout) despite the transient-sounding name', async () => {
    const mockFetch = vi.fn().mockImplementation(async () =>
      errorResponse(408, 'REQUEST_TIMEOUT', 'Request Timeout'),
    );

    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: mockFetch as unknown as typeof fetch,
    });
    client.use(createRetryMiddleware({ maxRetries: 3, baseDelayMs: 5, maxDelayMs: 50 }));

    await expect(client.wallets.get('w_408')).rejects.toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(1); // no retries
  });

  it('does not retry on 425 (Too Early)', async () => {
    const mockFetch = vi.fn().mockImplementation(async () =>
      errorResponse(425, 'TOO_EARLY', 'Too Early'),
    );

    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: mockFetch as unknown as typeof fetch,
    });
    client.use(createRetryMiddleware({ maxRetries: 3, baseDelayMs: 5, maxDelayMs: 50 }));

    await expect(client.wallets.get('w_425')).rejects.toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(1); // no retries
  });
});

/* -------------------------------------------------------------------------- */
/* Integration: network errors                                                 */
/* -------------------------------------------------------------------------- */

describe('Astroid client — network-error retries', () => {
  it('retries on network-level TypeError and succeeds on recovery', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new TypeError('Failed to fetch');
      return okResponse({ id: 'w_network', name: 'Network Recovery' });
    });

    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: mockFetch as unknown as typeof fetch,
    });
    client.use(createRetryMiddleware({ maxRetries: 2, baseDelayMs: 5, maxDelayMs: 50 }));

    const wallet = await client.wallets.get('w_network');
    expect(wallet).toMatchObject({ id: 'w_network', name: 'Network Recovery' });
    expect(callCount).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Integration: request timeouts are retried                                   */
/* -------------------------------------------------------------------------- */

describe('Astroid client — timeout retries', () => {
  /** Simulate a request that hangs until the client aborts it via its timeout. */
  function hangingFetch(init?: RequestInit): Promise<Response> {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('This operation was aborted', 'AbortError'));
      });
    });
  }

  it('retries a request that exceeds its timeout and succeeds on recovery', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) return hangingFetch(init);
      return okResponse({ id: 'w_timeout', name: 'Timeout Recovery' });
    });

    const client = new Astroid({
      ...BASE_CONFIG,
      timeout: 20,
      fetch: mockFetch as unknown as typeof fetch,
    });
    client.use(createRetryMiddleware({ maxRetries: 2, baseDelayMs: 5, maxDelayMs: 50 }));

    const wallet = await client.wallets.get('w_timeout');
    expect(wallet).toMatchObject({ id: 'w_timeout', name: 'Timeout Recovery' });
    expect(callCount).toBe(2);
  });

  it('throws AstroidTimeoutError after exhausting retries on persistent timeouts', async () => {
    const mockFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
      hangingFetch(init),
    );

    const client = new Astroid({
      ...BASE_CONFIG,
      timeout: 20,
      fetch: mockFetch as unknown as typeof fetch,
    });
    client.use(createRetryMiddleware({ maxRetries: 2, baseDelayMs: 5, maxDelayMs: 50 }));

    await expect(client.wallets.get('w_timeout_hard')).rejects.toBeInstanceOf(AstroidTimeoutError);
    // Initial attempt plus two retries.
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry a timeout on a non-idempotent POST', async () => {
    const mockFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
      hangingFetch(init),
    );

    const client = new Astroid({
      ...BASE_CONFIG,
      timeout: 20,
      fetch: mockFetch as unknown as typeof fetch,
    });
    client.use(createRetryMiddleware({ maxRetries: 2, baseDelayMs: 5, maxDelayMs: 50 }));

    await expect(client.wallets.create({ label: 'Nope' })).rejects.toBeInstanceOf(
      AstroidTimeoutError,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Integration: retry: false disables retries                                 */
/* -------------------------------------------------------------------------- */

describe('Astroid client — retry disabled', () => {
  it('does not retry when retry: false is set in config', async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(async () => errorResponse(503, 'SERVER_ERROR', 'Service Unavailable'));

    const client = new Astroid({
      apiKey: 'sk_test_no_retry',
      baseUrl: 'https://api.astroid.test',
      retry: false,
      fetch: mockFetch as unknown as typeof fetch,
    });

    await expect(client.wallets.get('w_noretry')).rejects.toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Integration: retry from client config (retry: { ... })                     */
/* -------------------------------------------------------------------------- */

describe('Astroid client — retry from config', () => {
  it('defaults to 3 retries and a 250ms base delay when no retry config is supplied', () => {
    const client = new Astroid({
      apiKey: 'sk_test_default',
      baseUrl: 'https://api.astroid.test',
      fetch: vi.fn() as unknown as typeof fetch,
    });

    expect(client.http.config.retry).toMatchObject({
      maxRetries: 3,
      baseDelayMs: 250,
    });
  });

  it('retries using config passed to new Astroid()', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return errorResponse(503, 'SERVER_ERROR', 'Unavailable');
      return okResponse({ id: 'w_config' });
    });

    const client = new Astroid({
      apiKey: 'sk_test_config',
      baseUrl: 'https://api.astroid.test',
      retry: { maxRetries: 2, baseDelayMs: 5, maxDelayMs: 50 },
      fetch: mockFetch as unknown as typeof fetch,
    });

    const wallet = await client.wallets.get('w_cfg');
    expect(wallet).toMatchObject({ id: 'w_config' });
    expect(callCount).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Configurable backoff factor                                                */
/* -------------------------------------------------------------------------- */

describe('backoffDelay — configurable factor', () => {
  it('defaults to doubling when backoffFactor is omitted', () => {
    const config = { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 10_000 };
    expect(backoffDelay(1, config, () => 0.5)).toBe(50);
    expect(backoffDelay(2, config, () => 0.5)).toBe(100);
    expect(backoffDelay(3, config, () => 0.5)).toBe(200);
  });

  it('grows by the configured backoffFactor', () => {
    const config = { maxRetries: 4, baseDelayMs: 100, maxDelayMs: 10_000, backoffFactor: 3 };
    expect(backoffDelay(1, config, () => 0.5)).toBe(50); // 100 * 3^0 = 100
    expect(backoffDelay(2, config, () => 0.5)).toBe(150); // 100 * 3^1 = 300
    expect(backoffDelay(3, config, () => 0.5)).toBe(450); // 100 * 3^2 = 900
  });

  it('caps backoff at maxDelayMs regardless of factor', () => {
    const config = { maxRetries: 10, baseDelayMs: 100, maxDelayMs: 500, backoffFactor: 5 };
    expect(backoffDelay(10, config, () => 1)).toBe(500);
  });

  it('honours backoffFactor through computeRetryDelay', () => {
    const config = { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 10_000, backoffFactor: 4 };
    // attempt 2: 100 * 4^1 = 400, jittered by 0.5 → 200
    expect(computeRetryDelay(2, config, 503, undefined, () => 0.5)).toBe(200);
  });
});

/* -------------------------------------------------------------------------- */
/* Configurable retryable status codes                                        */
/* -------------------------------------------------------------------------- */

describe('createRetryMiddleware — configurable retry options', () => {
  it('forwards backoffFactor into the per-request retry config', () => {
    const mw = createRetryMiddleware({ backoffFactor: 4 });
    const prepared = mw.onRequest!(makeRequest('GET')) as PreparedRequest;
    const ctx = prepared.options.context as Record<string, unknown>;
    expect(ctx._retryConfig).toMatchObject({ backoffFactor: 4 });
  });

  it('forwards retryableStatusCodes into the per-request retry options', () => {
    const mw = createRetryMiddleware({ retryableStatusCodes: [429, 503] });
    const prepared = mw.onRequest!(makeRequest('GET')) as PreparedRequest;
    const ctx = prepared.options.context as Record<string, unknown>;
    const opts = ctx._retryOptions as RetryMiddlewareConfig;
    expect(opts.retryableStatusCodes).toEqual([429, 503]);
  });
});

describe('Astroid client — configurable retryable status codes', () => {
  it('retries a configured status code', async () => {
    let calls = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Unavailable');
      return okResponse({ id: 'w_cfg503' });
    });

    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: mockFetch as unknown as typeof fetch,
      retry: { maxRetries: 2, baseDelayMs: 5, maxDelayMs: 20, retryableStatusCodes: [503] },
    });

    await expect(client.wallets.get('w_cfg503')).resolves.toMatchObject({ id: 'w_cfg503' });
    expect(calls).toBe(2);
  });

  it('does not retry a status outside the configured list', async () => {
    let calls = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      calls++;
      return errorResponse(500, 'SERVER_ERROR', 'Server Error');
    });

    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: mockFetch as unknown as typeof fetch,
      retry: { maxRetries: 3, baseDelayMs: 5, maxDelayMs: 20, retryableStatusCodes: [503] },
    });

    await expect(client.wallets.get('w_cfg500')).rejects.toBeDefined();
    expect(calls).toBe(1);
  });

  it('retries every 5xx by default when no status list is configured', async () => {
    let calls = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) return errorResponse(500, 'SERVER_ERROR', 'Server Error');
      return okResponse({ id: 'w_default5xx' });
    });

    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: mockFetch as unknown as typeof fetch,
      retry: { maxRetries: 2, baseDelayMs: 5, maxDelayMs: 20 },
    });

    await expect(client.wallets.get('w_default5xx')).resolves.toMatchObject({ id: 'w_default5xx' });
    expect(calls).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Idempotency gating                                                         */
/* -------------------------------------------------------------------------- */

describe('Astroid client — idempotency gating', () => {
  it('does not retry a non-idempotent POST by default', async () => {
    let calls = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      calls++;
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Unavailable');
    });

    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: mockFetch as unknown as typeof fetch,
      retry: { maxRetries: 3, baseDelayMs: 5, maxDelayMs: 20 },
    });

    await expect(client.http.post('/wallets', { name: 'x' })).rejects.toBeDefined();
    expect(calls).toBe(1);
  });

  it('retries a POST explicitly marked idempotent via idempotencyKey', async () => {
    let calls = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Unavailable');
      return okResponse({ id: 'w_idem' });
    });

    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: mockFetch as unknown as typeof fetch,
      retry: { maxRetries: 2, baseDelayMs: 5, maxDelayMs: 20 },
    });

    await expect(
      client.http.post('/wallets', { name: 'x' }, { idempotencyKey: 'key-1' }),
    ).resolves.toBeDefined();
    expect(calls).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Private helpers                                                             */
/* -------------------------------------------------------------------------- */

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Build a minimal PreparedRequest for middleware unit testing. */
function makeRequest(
  method: HttpMethod,
  existingContext: Record<string, unknown> = {},
): PreparedRequest {
  const isIdempotent = method === 'GET' || method === 'PUT' || method === 'DELETE';
  return {
    method,
    url: `https://api.test/v1/wallets`,
    headers: { accept: 'application/json', authorization: 'Bearer sk_test' },
    body: method === 'GET' ? undefined : '{}',
    timeoutMs: 10_000,
    retryable: isIdempotent,
    signal: undefined,
    options: {
      method,
      path: '/wallets',
      context: existingContext,
    },
  };
}

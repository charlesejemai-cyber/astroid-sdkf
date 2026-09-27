import { describe, it, expect, vi } from 'vitest';
import { AuthenticationError } from '@astroid/errors';
import {
  Astroid,
  createRetryMiddleware,
  retryMiddleware,
  backoffDelay,
  isRetryableStatus,
} from './index.js';

describe('Exponential Backoff & Retry Logic in Client & Middleware', () => {
  it('backoffDelay calculates exponential backoff with full jitter', () => {
    const config = { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000 };

    const mockRandomHalf = () => 0.5;

    expect(backoffDelay(1, config, mockRandomHalf)).toBe(50);
    expect(backoffDelay(2, config, mockRandomHalf)).toBe(100);
    expect(backoffDelay(3, config, mockRandomHalf)).toBe(200);

    const mockRandomMax = () => 1.0;
    expect(backoffDelay(10, config, mockRandomMax)).toBe(1000);
  });

  it('isRetryableStatus retries every 5xx and 429, and no other 4xx', () => {
    // Retryable: rate limiting and any server-side failure.
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(501)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(504)).toBe(true);
    expect(isRetryableStatus(505)).toBe(true);

    // Non-retryable client errors — including transient-looking 4xx such as
    // 408 (Request Timeout) and 425 (Too Early).
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(408)).toBe(false);
    expect(isRetryableStatus(422)).toBe(false);
    expect(isRetryableStatus(425)).toBe(false);
  });

  it('supports constructor retries and retryDelay options', () => {
    const client = new Astroid({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.astroid.test/v1',
      retries: 5,
      retryDelay: 200,
    });
    expect(client).toBeDefined();
  });

  it('non-retryable errors (e.g. 400, 401, 403, 404) throw immediately without retrying', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return new Response(
        JSON.stringify({ error: { message: 'Unauthorized', code: 'AUTHENTICATION_ERROR' } }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      );
    });

    const client = new Astroid({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      retry: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50 },
    });

    await expect(client.wallets.get('w_401')).rejects.toThrow(AuthenticationError);
    expect(callCount).toBe(1);
  });

  it('retryMiddleware alias is export equivalent to createRetryMiddleware', () => {
    expect(retryMiddleware).toBe(createRetryMiddleware);
  });
});

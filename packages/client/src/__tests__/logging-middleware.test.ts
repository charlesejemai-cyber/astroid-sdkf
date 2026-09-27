import { describe, expect, it, vi } from 'vitest';
import { createLoggingMiddleware, redactSensitiveHeaders } from '../middleware/logging.js';
import type { PreparedRequest, RawResponse } from '@astroid/core';

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

function makeRequest(overrides?: Partial<PreparedRequest>): PreparedRequest {
  return {
    method: 'GET',
    url: 'https://api.astroid.finance/v1/wallets',
    headers: {
      accept: 'application/json',
      authorization: 'Bearer sk_secret_token_123',
      'x-api-key': 'api_key_value',
      cookie: 'session=abc123',
      'x-custom-safe': 'safe_value',
    },
    body: undefined,
    timeoutMs: 10_000,
    retryable: true,
    signal: undefined,
    options: {
      method: 'GET',
      path: '/v1/wallets',
      context: { _correlationId: 'test-corr-123', _startTime: Date.now() - 150 },
    },
    ...overrides,
  };
}

function makeResponse(overrides?: Partial<RawResponse>): RawResponse {
  return {
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: { data: [{ id: 'w1' }] },
    requestId: 'req_abc',
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* redactSensitiveHeaders                                                      */
/* -------------------------------------------------------------------------- */

describe('redactSensitiveHeaders', () => {
  it('redacts built-in sensitive headers', () => {
    const headers = {
      authorization: 'Bearer secret',
      'x-api-key': 'key123',
      cookie: 'session=abc',
      'idempotency-key': 'idem123',
      'x-custom': 'safe',
    };

    const redacted = redactSensitiveHeaders(headers);

    expect(redacted.authorization).toBe('[REDACTED]');
    expect(redacted['x-api-key']).toBe('[REDACTED]');
    expect(redacted.cookie).toBe('[REDACTED]');
    expect(redacted['idempotency-key']).toBe('[REDACTED]');
    expect(redacted['x-custom']).toBe('safe');
  });

  it('redacts additional custom headers', () => {
    const headers = {
      'x-internal-token': 'secret123',
      'x-request-id': 'req_123',
    };

    const redacted = redactSensitiveHeaders(headers, ['x-internal-token']);

    expect(redacted['x-internal-token']).toBe('[REDACTED]');
    expect(redacted['x-request-id']).toBe('req_123');
  });

  it('does not mutate the original headers object', () => {
    const headers = { authorization: 'Bearer secret' };
    redactSensitiveHeaders(headers);
    expect(headers.authorization).toBe('Bearer secret');
  });

  it('handles empty headers', () => {
    expect(redactSensitiveHeaders({})).toEqual({});
  });
});

/* -------------------------------------------------------------------------- */
/* createLoggingMiddleware                                                     */
/* -------------------------------------------------------------------------- */

describe('createLoggingMiddleware', () => {
  it('returns a middleware with the correct name', () => {
    const mw = createLoggingMiddleware();
    expect(mw.name).toBe('logging');
  });

  it('calls onRequest hook with redacted headers', async () => {
    const onRequest = vi.fn();
    const mw = createLoggingMiddleware({ onRequest });

    const req = makeRequest();
    await mw.onRequest!(req);

    expect(onRequest).toHaveBeenCalledOnce();
    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'https://api.astroid.finance/v1/wallets',
        headers: expect.objectContaining({
          authorization: '[REDACTED]',
          'x-api-key': '[REDACTED]',
          cookie: '[REDACTED]',
          'x-custom-safe': 'safe_value',
        }),
        correlationId: 'test-corr-123',
      }),
    );
  });

  it('calls onResponse hook with timing metrics', async () => {
    const onResponse = vi.fn();
    const mw = createLoggingMiddleware({ onResponse });

    const req = makeRequest({
      options: {
        method: 'GET',
        path: '/v1/wallets',
        context: { _correlationId: 'corr-456', _startTime: Date.now() - 200 },
      },
    });
    const res = makeResponse({ status: 201 });

    await mw.onResponse!(res, req);

    expect(onResponse).toHaveBeenCalledOnce();
    expect(onResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'https://api.astroid.finance/v1/wallets',
        status: 201,
        durationMs: expect.any(Number),
        requestId: 'req_abc',
        correlationId: 'corr-456',
        success: true,
      }),
    );
  });

  it('calls onError hook with error info', async () => {
    const onError = vi.fn();
    const mw = createLoggingMiddleware({ onError });

    const error = new Error('Network failure');
    const req = makeRequest({
      method: 'POST',
      options: {
        method: 'POST',
        path: '/v1/wallets',
        context: { _correlationId: 'corr-789', _startTime: Date.now() - 500 },
      },
    });

    await mw.onError!(error, req);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'https://api.astroid.finance/v1/wallets',
        error,
        durationMs: expect.any(Number),
        correlationId: 'corr-789',
      }),
    );
  });

  it('does not call hooks when not provided', async () => {
    const mw = createLoggingMiddleware({});
    const req = makeRequest();
    const res = makeResponse();

    // Should not throw
    await expect(mw.onRequest!(req)).resolves.toBeDefined();
    await expect(mw.onResponse!(res, req)).resolves.toBeUndefined();
    await expect(mw.onError!(new Error('test'), req)).resolves.toBeUndefined();
  });

  it('disables redaction when enableRedaction is false', async () => {
    const onRequest = vi.fn();
    const mw = createLoggingMiddleware({ onRequest, enableRedaction: false });

    const req = makeRequest();
    await mw.onRequest!(req);

    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer sk_secret_token_123',
        }),
      }),
    );
  });

  it('parses JSON body in request hook', async () => {
    const onRequest = vi.fn();
    const mw = createLoggingMiddleware({ onRequest });

    const req = makeRequest({
      method: 'POST',
      body: '{"walletId":"w1","asset":"USDC","amount":"10"}',
    });
    await mw.onRequest!(req);

    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { walletId: 'w1', asset: 'USDC', amount: '10' },
      }),
    );
  });

  it('returns original string body when not valid JSON', async () => {
    const onRequest = vi.fn();
    const mw = createLoggingMiddleware({ onRequest });

    const req = makeRequest({
      method: 'POST',
      body: 'not-json',
    });
    await mw.onRequest!(req);

    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'not-json',
      }),
    );
  });

  it('marks non-2xx responses as unsuccessful', async () => {
    const onResponse = vi.fn();
    const mw = createLoggingMiddleware({ onResponse });

    const res = makeResponse({ status: 500 });
    const req = makeRequest();

    await mw.onResponse!(res, req);

    expect(onResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        status: 500,
      }),
    );
  });

  it('marks 2xx responses as successful', async () => {
    const onResponse = vi.fn();
    const mw = createLoggingMiddleware({ onResponse });

    const res = makeResponse({ status: 200 });
    const req = makeRequest();

    await mw.onResponse!(res, req);

    expect(onResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        status: 200,
      }),
    );
  });
});

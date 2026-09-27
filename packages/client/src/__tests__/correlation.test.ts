/**
 * Unit tests for the correlation ID middleware.
 *
 * Verifies that:
 * - A UUID v4 correlation ID is generated and injected on every request
 * - Callers can supply a custom correlation ID
 * - onRequest and onResponse telemetry hooks fire with correct info
 * - Error responses still trigger onResponse with success: false
 * - The middleware works correctly through the full Astroid client
 */

import { describe, expect, it, vi } from 'vitest';
import { Astroid } from '../index.js';
import {
  createCorrelationMiddleware,
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
} from '../middleware/correlation.js';

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number, message: string, code = 'UNAUTHORIZED'): Response {
  return new Response(JSON.stringify({ error: { message, code } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/* -------------------------------------------------------------------------- */
/* Standalone middleware tests                                                  */
/* -------------------------------------------------------------------------- */

describe('createCorrelationMiddleware', () => {
  it('returns a middleware with the correct name', () => {
    const mw = createCorrelationMiddleware();
    expect(mw.name).toBe('correlation');
  });

  it('generates a UUID v4 correlation ID and injects both headers', async () => {
    const mw = createCorrelationMiddleware();

    const req = {
      method: 'GET' as const,
      url: 'https://api.test/v1/wallets',
      headers: { accept: 'application/json' },
      body: undefined,
      timeoutMs: 30000,
      retryable: true,
      signal: undefined,
      options: { method: 'GET' as const, path: '/wallets' },
    };

    const prepared = await mw.onRequest!(req);

    // Issue #255: request ID and correlation ID are resolved independently —
    // both are fresh UUID v4s when the caller supplies neither.
    expect(prepared.headers[CORRELATION_ID_HEADER]).toMatch(UUID_V4_RE);
    expect(prepared.headers[REQUEST_ID_HEADER]).toMatch(UUID_V4_RE);
    expect(prepared.headers[REQUEST_ID_HEADER]).not.toBe(
      prepared.headers[CORRELATION_ID_HEADER],
    );
    expect(prepared.options.context?._correlationId).toBe(
      prepared.headers[CORRELATION_ID_HEADER],
    );
  });

  it('uses the caller-supplied correlation ID when provided', async () => {
    const mw = createCorrelationMiddleware();
    const customId = 'custom-id-abc-123';

    const req = {
      method: 'POST' as const,
      url: 'https://api.test/v1/wallets',
      headers: { accept: 'application/json' },
      body: '{"name":"test"}',
      timeoutMs: 30000,
      retryable: false,
      signal: undefined,
      options: {
        method: 'POST' as const,
        path: '/wallets',
        correlationId: customId,
      },
    };

    const prepared = await mw.onRequest!(req);

    expect(prepared.headers[CORRELATION_ID_HEADER]).toBe(customId);
    expect(prepared.headers[REQUEST_ID_HEADER]).toBe(customId);
  });

  it('fires onRequest telemetry hook with correct info', async () => {
    const onRequest = vi.fn();
    const mw = createCorrelationMiddleware({ onRequest });

    const req = {
      method: 'GET' as const,
      url: 'https://api.test/v1/wallets',
      headers: { accept: 'application/json' },
      body: undefined,
      timeoutMs: 30000,
      retryable: true,
      signal: undefined,
      options: { method: 'GET' as const, path: '/wallets' },
    };

    await mw.onRequest!(req);

    expect(onRequest).toHaveBeenCalledOnce();
    const info = onRequest.mock.calls[0]![0];
    expect(info.method).toBe('GET');
    expect(info.url).toBe('https://api.test/v1/wallets');
    expect(info.correlationId).toMatch(UUID_V4_RE);
    expect(info.headers[CORRELATION_ID_HEADER]).toBe(info.correlationId);
  });

  it('fires onResponse telemetry hook with duration and status', async () => {
    const onResponse = vi.fn();
    const mw = createCorrelationMiddleware({ onResponse });

    const correlationId = 'test-correlation-id-456';
    const startTime = Date.now();
    const req = {
      method: 'GET' as const,
      url: 'https://api.test/v1/wallets',
      headers: {
        accept: 'application/json',
        [CORRELATION_ID_HEADER]: correlationId,
      },
      body: undefined,
      timeoutMs: 30000,
      retryable: true,
      signal: undefined,
      options: {
        method: 'GET' as const,
        path: '/wallets',
        context: {
          _correlationId: correlationId,
          _startTime: startTime,
        },
      },
    };

    const res = {
      status: 200,
      headers: new Headers(),
      body: { data: [] },
      requestId: correlationId,
    };

    await mw.onResponse!(res, req);

    expect(onResponse).toHaveBeenCalledOnce();
    const info = onResponse.mock.calls[0]![0];
    expect(info.method).toBe('GET');
    expect(info.url).toBe('https://api.test/v1/wallets');
    expect(info.correlationId).toBe(correlationId);
    expect(info.status).toBe(200);
    expect(info.success).toBe(true);
    expect(info.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reports success: false for non-2xx responses', async () => {
    const onResponse = vi.fn();
    const mw = createCorrelationMiddleware({ onResponse });

    const req = {
      method: 'GET' as const,
      url: 'https://api.test/v1/wallets',
      headers: { accept: 'application/json' },
      body: undefined,
      timeoutMs: 30000,
      retryable: true,
      signal: undefined,
      options: {
        method: 'GET' as const,
        path: '/wallets',
        context: {
          _correlationId: 'err-id',
          _startTime: Date.now() - 50,
        },
      },
    };

    const res = {
      status: 404,
      headers: new Headers(),
      body: { error: { code: 'NOT_FOUND', message: 'Not found' } },
      requestId: 'err-id',
    };

    await mw.onResponse!(res, req);

    expect(onResponse).toHaveBeenCalledOnce();
    const info = onResponse.mock.calls[0]![0];
    expect(info.status).toBe(404);
    expect(info.success).toBe(false);
  });

  it('does not fire onResponse when no telemetry hooks are provided', async () => {
    const mw = createCorrelationMiddleware();

    const req = {
      method: 'GET' as const,
      url: 'https://api.test/v1/wallets',
      headers: { accept: 'application/json' },
      body: undefined,
      timeoutMs: 30000,
      retryable: true,
      signal: undefined,
      options: {
        method: 'GET' as const,
        path: '/wallets',
        context: { _correlationId: 'id', _startTime: Date.now() },
      },
    };

    const res = { status: 200, headers: new Headers(), body: undefined, requestId: 'id' };

    // Should not throw
    await expect(mw.onResponse!(res, req)).resolves.toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Integration through the full Astroid client                                 */
/* -------------------------------------------------------------------------- */

describe('Correlation ID through Astroid client', () => {
  it('injects X-Astroid-Correlation-ID on every outbound request', async () => {
    const mockFetch = vi.fn().mockImplementation(async (_url: string | URL, opts?: RequestInit) => {
      const headers = (opts?.headers as Record<string, string>) ?? {};
      expect(headers[CORRELATION_ID_HEADER]).toMatch(UUID_V4_RE);
      expect(headers[REQUEST_ID_HEADER]).toMatch(UUID_V4_RE);
      return jsonResponse({ data: { id: 'w1' } });
    });

    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.wallets.get('w1');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('uses a caller-supplied correlation ID through the client', async () => {
    const customId = 'my-trace-id-789';

    const mockFetch = vi.fn().mockImplementation(async (_url: string | URL, opts?: RequestInit) => {
      const headers = (opts?.headers as Record<string, string>) ?? {};
      expect(headers[CORRELATION_ID_HEADER]).toBe(customId);
      expect(headers[REQUEST_ID_HEADER]).toBe(customId);
      return jsonResponse({ data: { id: 'w1' } });
    });

    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    // Use the low-level HTTP client to pass a custom correlationId
    await client.http.get('/wallets/w1', { correlationId: customId });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('fires onRequest and onResponse telemetry hooks with correct info', async () => {
    const onRequest = vi.fn();
    const onResponse = vi.fn();

    const mockFetch = vi.fn().mockImplementation(async () => {
      return jsonResponse({ data: { id: 'w1' } });
    });

    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      telemetry: { onRequest, onResponse },
    });

    await client.wallets.get('w1');

    // onRequest fires
    expect(onRequest).toHaveBeenCalledOnce();
    const reqInfo = onRequest.mock.calls[0]![0];
    expect(reqInfo.method).toBe('GET');
    expect(reqInfo.url).toContain('/wallets/w1');
    expect(reqInfo.correlationId).toMatch(UUID_V4_RE);
    expect(reqInfo.headers[CORRELATION_ID_HEADER]).toBe(reqInfo.correlationId);

    // onResponse fires
    expect(onResponse).toHaveBeenCalledOnce();
    const resInfo = onResponse.mock.calls[0]![0];
    expect(resInfo.method).toBe('GET');
    expect(resInfo.correlationId).toBe(reqInfo.correlationId);
    expect(resInfo.status).toBe(200);
    expect(resInfo.success).toBe(true);
    expect(resInfo.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('fires onResponse even for error responses', async () => {
    const onResponse = vi.fn();

    const mockFetch = vi.fn().mockImplementation(async () => {
      return errorResponse(404, 'Wallet not found', 'NOT_FOUND');
    });

    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      telemetry: { onResponse },
    });

    await client.wallets.get('nonexistent').catch(() => {});

    // onResponse should still fire even when the request fails
    // Note: with the error middleware chain, onResponse fires for raw responses
    // before the error is thrown. The exact call count depends on the middleware
    // pipeline, but at least one call should have the 404 status.
    expect(onResponse).toHaveBeenCalled();
    const lastCall = onResponse.mock.calls[onResponse.mock.calls.length - 1]![0];
    expect(lastCall.status).toBe(404);
    expect(lastCall.success).toBe(false);
  });

  it('generates different correlation IDs for concurrent requests', async () => {
    const ids = new Set<string>();

    const mockFetch = vi.fn().mockImplementation(async () => jsonResponse({ data: { id: 'ok' } }));

    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    await Promise.all([
      client.wallets.get('w1'),
      client.agents.get('a1'),
      client.policies.get('p1'),
    ]);

    // Collect all correlation IDs from fetch calls
    for (const call of mockFetch.mock.calls) {
      const headers = (call[1] as RequestInit)?.headers as Record<string, string>;
      const id = headers[CORRELATION_ID_HEADER];
      if (id) ids.add(id);
    }

    // All three requests should have distinct correlation IDs
    expect(ids.size).toBe(3);
  });
});

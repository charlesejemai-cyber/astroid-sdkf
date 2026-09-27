/**
 * Unit tests for request ID and correlation tracing headers (issue #255).
 *
 * Verifies that:
 * - A UUID v4 `X-Request-ID` is generated and attached when none is supplied
 * - `X-Correlation-ID` and legacy `X-Astroid-Correlation-ID` are attached
 * - Caller-supplied `options.requestId` / `options.correlationId` are honored
 * - Caller-supplied tracing headers are never overwritten
 * - Client-wide `tracingHeaders` config applies as a default
 * - Distinct request IDs are generated for concurrent requests
 * - Every request reaches `fetch` with the headers attached
 */

import { describe, expect, it, vi } from 'vitest';
import { Astroid } from '../index.js';
import {
  createCorrelationMiddleware,
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
  X_CORRELATION_ID_HEADER,
} from '../middleware/correlation.js';

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makePreparedRequest(
  options: {
    correlationId?: string;
    requestId?: string;
    headers?: Record<string, string>;
  } = {},
) {
  return {
    method: 'GET' as const,
    url: 'https://api.test/v1/wallets',
    headers: { accept: 'application/json', ...(options.headers ?? {}) },
    body: undefined,
    timeoutMs: 30000,
    retryable: true,
    signal: undefined,
    options: {
      method: 'GET' as const,
      path: '/wallets',
      correlationId: options.correlationId,
      requestId: options.requestId,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* UUID v4 generation                                                          */
/* -------------------------------------------------------------------------- */

describe('X-Request-ID generation (issue #255)', () => {
  it('generates a UUID v4 request ID when none is supplied', async () => {
    const mw = createCorrelationMiddleware();
    const prepared = await mw.onRequest!(makePreparedRequest());
    expect(prepared.headers[REQUEST_ID_HEADER]).toMatch(UUID_V4_RE);
  });

  it('generates valid UUID v4s across many requests', async () => {
    const mw = createCorrelationMiddleware();
    for (let i = 0; i < 25; i++) {
      const prepared = await mw.onRequest!(makePreparedRequest());
      expect(prepared.headers[REQUEST_ID_HEADER]).toMatch(UUID_V4_RE);
    }
  });

  it('generates distinct request IDs for concurrent requests', async () => {
    const mw = createCorrelationMiddleware();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => mw.onRequest!(makePreparedRequest())),
    );
    const ids = new Set(results.map((r) => r.headers[REQUEST_ID_HEADER]));
    expect(ids.size).toBe(10);
  });

  it('honors options.requestId instead of generating one', async () => {
    const mw = createCorrelationMiddleware();
    const prepared = await mw.onRequest!(
      makePreparedRequest({ requestId: 'req-fixed-001' }),
    );
    expect(prepared.headers[REQUEST_ID_HEADER]).toBe('req-fixed-001');
  });

  it('falls back to options.correlationId for the request ID', async () => {
    const mw = createCorrelationMiddleware();
    const prepared = await mw.onRequest!(
      makePreparedRequest({ correlationId: 'corr-123' }),
    );
    expect(prepared.headers[REQUEST_ID_HEADER]).toBe('corr-123');
  });

  it('honors a caller-supplied x-request-id header over generating one', async () => {
    const mw = createCorrelationMiddleware();
    const prepared = await mw.onRequest!(
      makePreparedRequest({ headers: { [REQUEST_ID_HEADER]: 'header-request-id' } }),
    );
    expect(prepared.headers[REQUEST_ID_HEADER]).toBe('header-request-id');
  });
});

/* -------------------------------------------------------------------------- */
/* X-Correlation-ID and legacy header                                          */
/* -------------------------------------------------------------------------- */

describe('X-Correlation-ID injection (issue #255)', () => {
  it('injects X-Correlation-ID alongside the legacy correlation header', async () => {
    const mw = createCorrelationMiddleware();
    const prepared = await mw.onRequest!(makePreparedRequest({ correlationId: 'flow-7' }));
    expect(prepared.headers[X_CORRELATION_ID_HEADER]).toBe('flow-7');
    expect(prepared.headers[CORRELATION_ID_HEADER]).toBe('flow-7');
    expect(prepared.headers[REQUEST_ID_HEADER]).toBe('flow-7');
  });

  it('does not override a caller-supplied correlation header', async () => {
    const mw = createCorrelationMiddleware();
    const prepared = await mw.onRequest!(
      makePreparedRequest({ headers: { [X_CORRELATION_ID_HEADER]: 'from-gateway' } }),
    );
    expect(prepared.headers[X_CORRELATION_ID_HEADER]).toBe('from-gateway');
  });

  it('applies static tracing headers configured on the middleware', async () => {
    const mw = createCorrelationMiddleware(undefined, {
      headers: { [X_CORRELATION_ID_HEADER]: 'agent-run-42' },
    });
    const prepared = await mw.onRequest!(makePreparedRequest());
    expect(prepared.headers[X_CORRELATION_ID_HEADER]).toBe('agent-run-42');
    // Request ID stays unique per request.
    expect(prepared.headers[REQUEST_ID_HEADER]).toMatch(UUID_V4_RE);
  });

  it('per-request correlation wins over static tracing headers', async () => {
    const mw = createCorrelationMiddleware(undefined, {
      headers: { [X_CORRELATION_ID_HEADER]: 'static-trace' },
    });
    const prepared = await mw.onRequest!(makePreparedRequest({ correlationId: 'per-request-trace' }));
    expect(prepared.headers[X_CORRELATION_ID_HEADER]).toBe('per-request-trace');
  });

  it('normalizes header name casing in static tracing headers', async () => {
    const mw = createCorrelationMiddleware(undefined, {
      headers: { 'X-Correlation-ID': 'Pascal-Cased-Trace' },
    });
    const prepared = await mw.onRequest!(makePreparedRequest());
    expect(prepared.headers[X_CORRELATION_ID_HEADER]).toBe('Pascal-Cased-Trace');
  });

  it('supports a fixed client-wide correlationId via the tracing config', async () => {
    const mw = createCorrelationMiddleware(undefined, { correlationId: 'pin-the-run' });
    const a = await mw.onRequest!(makePreparedRequest());
    const b = await mw.onRequest!(makePreparedRequest());
    expect(a.headers[X_CORRELATION_ID_HEADER]).toBe('pin-the-run');
    expect(b.headers[X_CORRELATION_ID_HEADER]).toBe('pin-the-run');
  });
});

/* -------------------------------------------------------------------------- */
/* End-to-end through the Astroid client (fetch-level verification)            */
/* -------------------------------------------------------------------------- */

describe('tracing headers on fetch calls (issue #255)', () => {
  it('attaches X-Request-ID, X-Correlation-ID and legacy headers to every fetch call', async () => {
    const mockFetch = vi.fn().mockImplementation(async (_url: string | URL, opts?: RequestInit) => {
      const headers = (opts?.headers as Record<string, string>) ?? {};
      expect(headers[REQUEST_ID_HEADER]).toMatch(UUID_V4_RE);
      expect(headers[X_CORRELATION_ID_HEADER]).toMatch(UUID_V4_RE);
      expect(headers[CORRELATION_ID_HEADER]).toMatch(UUID_V4_RE);
      return jsonResponse({ data: { id: 'w1' } });
    });

    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.wallets.get('w1');
    await client.agents.get('a1');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('propagates a per-request correlation ID for end-to-end tracing', async () => {
    const mockFetch = vi.fn().mockImplementation(async (_url: string | URL, opts?: RequestInit) => {
      const headers = (opts?.headers as Record<string, string>) ?? {};
      expect(headers[X_CORRELATION_ID_HEADER]).toBe('workflow-99');
      return jsonResponse({ data: { id: 'w1' } });
    });

    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.http.get('/wallets/w1', { correlationId: 'workflow-99' });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('propagates a per-request custom request ID', async () => {
    const mockFetch = vi.fn().mockImplementation(async (_url: string | URL, opts?: RequestInit) => {
      const headers = (opts?.headers as Record<string, string>) ?? {};
      expect(headers[REQUEST_ID_HEADER]).toBe('req-custom-77');
      return jsonResponse({ data: { id: 'w1' } });
    });

    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.http.get('/wallets/w1', { requestId: 'req-custom-77' });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('applies client-wide tracingHeaders config to every request', async () => {
    const mockFetch = vi.fn().mockImplementation(async (_url: string | URL, opts?: RequestInit) => {
      const headers = (opts?.headers as Record<string, string>) ?? {};
      expect(headers[X_CORRELATION_ID_HEADER]).toBe('tenant-abc');
      expect(headers[REQUEST_ID_HEADER]).toMatch(UUID_V4_RE);
      return jsonResponse({ data: { id: 'w1' } });
    });

    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      tracingHeaders: { 'x-correlation-id': 'tenant-abc' },
    });

    await client.wallets.get('w1');
    await client.policies.list();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('lets per-request headers override the client-wide tracing config', async () => {
    const mockFetch = vi.fn().mockImplementation(async (_url: string | URL, opts?: RequestInit) => {
      const headers = (opts?.headers as Record<string, string>) ?? {};
      expect(headers[REQUEST_ID_HEADER]).toBe('override-req');
      return jsonResponse({ data: { id: 'w1' } });
    });

    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      tracingHeaders: { 'x-request-id': 'static-would-be-wrong' },
    });

    await client.http.get('/wallets/w1', { headers: { 'x-request-id': 'override-req' } });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('never reuses the same generated request ID across sequential requests', async () => {
    const seen: string[] = [];

    const mockFetch = vi.fn().mockImplementation(async (_url: string | URL, opts?: RequestInit) => {
      const headers = (opts?.headers as Record<string, string>) ?? {};
      seen.push(headers[REQUEST_ID_HEADER]!);
      return jsonResponse({ data: { id: 'ok' } });
    });

    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.wallets.get('w1');
    await client.agents.get('a1');
    await client.budgets.get('b1');

    expect(new Set(seen).size).toBe(3);
  });
});

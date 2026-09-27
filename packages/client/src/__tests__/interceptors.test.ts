import { describe, expect, it, vi } from 'vitest';
import {
  Astroid,
  createDebugLogger,
  createInterceptorMiddleware,
  redactDebugHeaders,
  type RequestConfig,
  type ResponseConfig,
} from '../index.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async () => jsonResponse({ data: { id: 'w1' } }));
}

/* -------------------------------------------------------------------------- */
/* Request interceptors                                                        */
/* -------------------------------------------------------------------------- */

describe('request interceptors', () => {
  it('runs request interceptors in registration order', async () => {
    const order: string[] = [];
    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test/v1',
      fetch: makeFetch() as unknown as typeof fetch,
      requestInterceptors: [
        (config) => {
          order.push('first');
          return { ...config, headers: { ...config.headers, 'x-first': 'yes' } };
        },
        () => {
          order.push('second');
        },
        () => {
          order.push('third');
        },
      ],
    });

    await client.http.get('/wallets/w1');

    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('propagates header injection to the fetch call', async () => {
    const mockFetch = makeFetch();
    let seenHeaders: Record<string, string> = {};

    mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      seenHeaders = (init?.headers as Record<string, string>) ?? {};
      return jsonResponse({ data: { id: 'w1' } });
    });

    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      requestInterceptors: [
        (config) => ({
          ...config,
          headers: { ...config.headers, 'x-tenant': 'acme', authorization: 'Bearer rewritten' },
        }),
      ],
    });

    await client.http.get('/wallets/w1');

    expect(seenHeaders['x-tenant']).toBe('acme');
    expect(seenHeaders.authorization).toBe('Bearer rewritten');
  });

  it('lets an interceptor rewrite the URL, method, and body', async () => {
    const mockFetch = makeFetch();
    let seenUrl = '';
    let seenMethod = '';
    let seenBody: unknown;

    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      seenUrl = url;
      seenMethod = init?.method ?? '';
      seenBody = init?.body;
      return jsonResponse({ data: { ok: true } });
    });

    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      requestInterceptors: [
        (config: RequestConfig) => ({
          ...config,
          url: config.url.replace('/wallets/w1', '/wallets/w2'),
          method: 'POST',
          body: {
            ...(typeof config.body === 'object' && config.body ? config.body : {}),
            audit: true,
          },
        }),
      ],
    });

    await client.http.get('/wallets/w1');

    expect(seenUrl).toContain('/wallets/w2');
    expect(seenMethod).toBe('POST');
    expect(JSON.parse(String(seenBody))).toEqual({ audit: true });
  });
});

/* -------------------------------------------------------------------------- */
/* Response interceptors                                                       */
/* -------------------------------------------------------------------------- */

describe('response interceptors', () => {
  it('runs response interceptors in registration order and echoes the request', async () => {
    const order: string[] = [];
    let seenStatus: number | undefined;
    let seenUrl: string | undefined;

    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test/v1',
      fetch: makeFetch() as unknown as typeof fetch,
      responseInterceptors: [
        (response: ResponseConfig) => {
          order.push('first');
          seenStatus = response.status;
          seenUrl = response.request.url;
        },
        () => {
          order.push('second');
        },
      ],
    });

    await client.http.get('/wallets/w1');

    expect(order).toEqual(['first', 'second']);
    expect(seenStatus).toBe(200);
    expect(seenUrl).toContain('/wallets/w1');
  });

  it('allows the response config to be transformed', async () => {
    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test/v1',
      fetch: makeFetch() as unknown as typeof fetch,
      responseInterceptors: [
        (response) => ({
          ...response,
          status: 201,
          body: { data: { transformed: true } },
        }),
      ],
    });

    const response = await client.http.get<{ transformed: boolean }>('/wallets/w1');

    expect(response.data).toEqual({ transformed: true });
  });

  it('observes responses through the middleware when attached manually', async () => {
    const onResponse = vi.fn();
    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test/v1',
      fetch: makeFetch() as unknown as typeof fetch,
    });
    client.use(createInterceptorMiddleware({ responseInterceptors: [onResponse] }));

    await client.http.get('/wallets/w1');

    expect(onResponse).toHaveBeenCalledOnce();
  });
});

/* -------------------------------------------------------------------------- */
/* Debug logger                                                                */
/* -------------------------------------------------------------------------- */

describe('createDebugLogger', () => {
  it('redacts sensitive headers', () => {
    expect(
      redactDebugHeaders({ authorization: 'Bearer secret', 'x-api-key': 'key', 'x-safe': 'ok' }),
    ).toEqual({ authorization: '[REDACTED]', 'x-api-key': '[REDACTED]', 'x-safe': 'ok' });
  });

  it('logs requests and responses through the client `debug` config', async () => {
    const lines: string[] = [];
    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test/v1',
      fetch: makeFetch() as unknown as typeof fetch,
      debug: { logger: (message) => lines.push(message), includeBody: false },
    });

    await client.http.get('/wallets/w1');

    expect(lines.some((line) => line.includes('→ GET') && line.includes('/wallets/w1'))).toBe(true);
    expect(lines.some((line) => line.includes('← 200 GET') && line.includes('/wallets/w1'))).toBe(
      true,
    );
    // Sensitive auth header must never leak into logs.
    expect(lines.join('\n')).not.toContain('sk_test');
    expect(lines.join('\n')).toContain('[REDACTED]');
  });

  it('is inert when disabled', async () => {
    const logger = vi.fn();
    const debug = createDebugLogger({ enabled: false, logger });

    await debug.requestInterceptor({
      url: 'https://api.test/v1/wallets',
      method: 'GET',
      headers: {},
    });
    await debug.responseInterceptor({
      status: 200,
      headers: new Headers(),
      body: {},
      request: { url: 'https://api.test/v1/wallets', method: 'GET', headers: {} },
    });

    expect(logger).not.toHaveBeenCalled();
  });
});

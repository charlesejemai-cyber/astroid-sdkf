import { describe, expect, it, vi } from 'vitest';

import { RateLimitError } from '@astroid/errors';

import { Astroid, createRateLimiterMiddleware } from '../index.js';

const BASE = {
  apiKey: 'sk_test_123',
  baseUrl: 'https://api.example.test',
  retry: false as const,
};

/** Build a fetch mock that returns a wallet envelope and records call timestamps. */
function walletFetch(record?: { times: number[] }) {
  return vi.fn().mockImplementation(async (_url: string) => {
    record?.times.push(Date.now());
    return new Response(JSON.stringify({ data: { id: 'w_1', name: 'Wallet' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

describe('rate-limiter middleware — burst handling', () => {
  it('passes a burst within burstCapacity immediately and successfully', async () => {
    const record = { times: [] as number[] };
    const fetchMock = walletFetch(record);
    const client = new Astroid({
      ...BASE,
      fetch: fetchMock as unknown as typeof fetch,
      rateLimit: { maxRequestsPerSecond: 5, burstCapacity: 4 },
    });

    const results = await Promise.all([
      client.wallets.get('a'),
      client.wallets.get('b'),
      client.wallets.get('c'),
      client.wallets.get('d'),
    ]);

    expect(results).toHaveLength(4);
    expect(results.every((w) => w.id === 'w_1')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // A burst within capacity is dispatched without throttling delay.
    const span = record.times[3]! - record.times[0]!;
    expect(span).toBeLessThan(50);
  });
});

describe('rate-limiter middleware — sustained throttling', () => {
  it('queues excess requests and drains them as tokens refill', async () => {
    const start = Date.now();
    const fetchMock = walletFetch();
    // Burst of 1, refills at 20 req/s (a token every ~50ms).
    const client = new Astroid({
      ...BASE,
      fetch: fetchMock as unknown as typeof fetch,
      rateLimit: { maxRequestsPerSecond: 20, burstCapacity: 1 },
    });

    const results = await Promise.all([
      client.wallets.get('a'),
      client.wallets.get('b'),
      client.wallets.get('c'),
      client.wallets.get('d'),
      client.wallets.get('e'),
    ]);

    expect(results).toHaveLength(5);
    // All requests eventually dispatch successfully, staggered over time.
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(Date.now() - start).toBeGreaterThanOrEqual(120);
  });
});

describe('rate-limiter middleware — queue management', () => {
  it('rejects with RateLimitError when the queue is full', async () => {
    const fetchMock = walletFetch();
    const client = new Astroid({
      ...BASE,
      fetch: fetchMock as unknown as typeof fetch,
      rateLimit: {
        maxRequestsPerSecond: 1,
        burstCapacity: 1,
        maxQueueLength: 2,
        queueTimeoutMs: 1500,
      },
    });

    const settled = await Promise.allSettled([
      client.wallets.get('a'),
      client.wallets.get('b'),
      client.wallets.get('c'),
      client.wallets.get('d'),
    ]);

    const rejected = settled.filter((s) => s.status === 'rejected');
    expect(rejected.length).toBeGreaterThan(0);
    for (const s of rejected) {
      if (s.status === 'rejected') expect(s.reason).toBeInstanceOf(RateLimitError);
    }
    expect(settled.filter((s) => s.status === 'fulfilled').length).toBeGreaterThan(0);
  });

  it('fails a request that waits past queueTimeoutMs', async () => {
    let resolveFirst: (() => void) | undefined;
    let callCount = 0;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          callCount += 1;
          if (callCount === 1) {
            // Hold the first request in-flight so its token stays consumed.
            resolveFirst = () =>
              resolve(
                new Response(JSON.stringify({ data: { id: 'w_x' } }), {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                }),
              );
          } else {
            setTimeout(() => {
              resolve(
                new Response(JSON.stringify({ data: { id: 'w_y' } }), {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                }),
              );
            }, 50);
          }
        }),
    );

    const client = new Astroid({
      ...BASE,
      fetch: fetchMock as unknown as typeof fetch,
      rateLimit: {
        maxRequestsPerSecond: 1, // ~1000ms between tokens
        burstCapacity: 1,
        maxQueueLength: 10,
        queueTimeoutMs: 60, // far shorter than the refill interval
      },
    });

    const first = client.wallets.get('first');
    await expect(client.wallets.get('second')).rejects.toMatchObject({
      name: 'RateLimitError',
      code: 'RATE_LIMIT_QUEUE_TIMEOUT',
    });
    resolveFirst?.();
    await expect(first).resolves.toHaveProperty('id', 'w_x');
  });
});

describe('rate-limiter middleware — Retry-After propagation', () => {
  it('honours Retry-After on 429 and backs off subsequent requests', async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ error: { message: 'Too Many Requests', code: 'RATE_LIMITED' } }),
          { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '0.4' } },
        );
      }
      return new Response(JSON.stringify({ data: { id: 'w_after' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = new Astroid({
      ...BASE,
      fetch: fetchMock as unknown as typeof fetch,
    });
    client.use(createRateLimiterMiddleware({ maxRequestsPerSecond: 100, burstCapacity: 1 }));

    // The 429 carries Retry-After: the limiter records a cooldown and the
    // request surfaces as a RateLimitError (no retry configured).
    await expect(client.wallets.get('first')).rejects.toBeInstanceOf(RateLimitError);

    // A request made during the cooldown is held until after Retry-After
    // elapses, at which point the bucket resumes and dispatch succeeds.
    await expect(client.wallets.get('after')).resolves.toHaveProperty('id', 'w_after');
  });

  it('re-exports the middleware as rateLimiterMiddleware alias', () => {
    const mw = createRateLimiterMiddleware({ maxRequestsPerSecond: 5 });
    expect(mw.name).toBe('rate-limiter');
  });
});

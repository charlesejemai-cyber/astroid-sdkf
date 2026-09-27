import { describe, it, expect, vi } from 'vitest';
import { HttpClient } from '@astroid/core';
import { AstroidTimeoutError } from '@astroid/core';
import { Astroid } from '../src/index.js';

describe('Client Timeout and AbortSignal Support', () => {
  it('throws AstroidTimeoutError when request exceeds timeout option', async () => {
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Network timeout')), 100);
      })
    );

    const client = new HttpClient({
      baseUrl: 'https://api.test',
      timeout: 20,
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.get('/wallets/w_1')).rejects.toBeInstanceOf(AstroidTimeoutError);
  });

  it('supports caller-provided AbortSignal to cancel request immediately', async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url, init) => new Promise((_, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          return reject(new Error('Aborted'));
        }
        signal?.addEventListener('abort', () => {
          reject(new Error('Aborted'));
        });
      })
    );

    const client = new HttpClient({
      baseUrl: 'https://api.test',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const controller = new AbortController();
    controller.abort();

    await expect(client.get('/wallets/w_1', { signal: controller.signal })).rejects.toThrow();
  });

  it('respects Astroid client constructor timeout option', async () => {
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Slow')), 100);
      })
    );

    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test',
      timeout: 10,
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.wallets.get('w_1')).rejects.toBeInstanceOf(AstroidTimeoutError);
  });

  it('supports per-request timeout override via options.timeoutMs', async () => {
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Slow')), 100);
      })
    );

    const client = new HttpClient({
      baseUrl: 'https://api.test',
      timeout: 5000, // default 5s
      fetch: fetchMock as unknown as typeof fetch,
    });

    // Override to 10ms for this specific request
    await expect(client.get('/wallets/w_1', { timeoutMs: 10 })).rejects.toBeInstanceOf(AstroidTimeoutError);
  });

  it('verifies timeout cancellation with mock fetch that respects AbortSignal', async () => {
    // Mock fetch that respects AbortSignal and rejects when aborted
    const fetchMock = vi.fn().mockImplementation(
      (_url, init) => new Promise((_, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (signal?.aborted) {
          return reject(new DOMException('Aborted', 'AbortError'));
        }
        signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      })
    );

    const client = new HttpClient({
      baseUrl: 'https://api.test',
      timeout: 50,
      fetch: fetchMock as unknown as typeof fetch,
    });

    // `retryable: false` keeps this to a single attempt: without it the default
    // retry policy re-issues the timed-out GET, so `toHaveBeenCalledOnce()`
    // below would be asserting retry behaviour rather than abort propagation.
    await expect(client.get('/test', { retryable: false })).rejects.toBeInstanceOf(AstroidTimeoutError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not throw timeout when response arrives before timeout', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, data: { data: 'ok' } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const client = new HttpClient({
      baseUrl: 'https://api.test',
      timeout: 5000,
      fetch: fetchMock as unknown as typeof fetch,
    });

    const response = await client.get('/test');
    expect(response.data).toEqual({ data: 'ok' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

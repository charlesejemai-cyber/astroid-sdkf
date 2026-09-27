import { describe, expect, it } from 'vitest';
import {
  backoffDelay,
  computeRetryDelay,
  createRetryMiddleware,
  isRetryableStatus,
  retryMiddleware,
  type RetryConfig,
} from '../retry.js';

const CONFIG: RetryConfig = { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1_000 };

describe('@astroid/client retry module', () => {
  it('exposes the retry policy primitives from a single entry point', () => {
    expect(typeof backoffDelay).toBe('function');
    expect(typeof isRetryableStatus).toBe('function');
    expect(typeof computeRetryDelay).toBe('function');
    expect(typeof createRetryMiddleware).toBe('function');
    expect(retryMiddleware).toBe(createRetryMiddleware);
  });

  it('classifies transient statuses only', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(504)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
  });

  it('honours Retry-After on 429 responses', () => {
    expect(computeRetryDelay(1, CONFIG, 429, 0.05)).toBe(50);
    // Retry-After is capped at maxDelayMs.
    expect(computeRetryDelay(1, CONFIG, 429, 5)).toBe(1_000);
  });

  it('falls back to full-jitter exponential backoff', () => {
    expect(computeRetryDelay(1, CONFIG, 503, undefined, () => 0.5)).toBe(50);
    expect(computeRetryDelay(2, CONFIG, 503, undefined, () => 0.5)).toBe(100);
    expect(computeRetryDelay(10, CONFIG, 503, undefined, () => 1)).toBe(1_000);
  });
});

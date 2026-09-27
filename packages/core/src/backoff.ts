/**
 * Exponential backoff with full jitter, and the retry decision helper.
 */

import type { RetryConfig } from './config.js';

/**
 * Compute the delay (ms) before retry `attempt` (1-based) using exponential
 * backoff with full jitter, capped at `maxDelayMs`.
 *
 * The growth rate is `config.backoffFactor` (default `2`, i.e. doubling).
 * A `random` function is injected so callers/tests stay deterministic; it
 * defaults to `Math.random`.
 */
export function backoffDelay(
  attempt: number,
  config: RetryConfig,
  random: () => number = Math.random,
): number {
  const factor = config.backoffFactor ?? 2;
  const exponential = config.baseDelayMs * factor ** (attempt - 1);
  const capped = Math.min(exponential, config.maxDelayMs);
  // Full jitter: a random point in [0, capped].
  return Math.floor(random() * capped);
}

/**
 * Whether an HTTP status warrants a retry.
 *
 * Only transient server-side conditions are retryable:
 * - `429 Too Many Requests` — a rate-limit window that will reopen.
 * - Any `5xx` — the server failed to fulfil an otherwise valid request.
 *
 * Every other `4xx` is a client error (bad request, auth, validation, …):
 * retrying it cannot succeed and only burns the caller's latency budget and
 * the API's rate limit, so those statuses are never retried.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/** Sleep for `ms`, resolving early (rejecting) if the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

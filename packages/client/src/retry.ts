/**
 * `@astroid/client` — modular retry policy.
 *
 * A single import point for every piece of the SDK's retry behaviour:
 *
 * - {@link backoffDelay} — exponential backoff with full jitter.
 * - {@link isRetryableStatus} — the transient-status predicate (`429` and any
 *   `5xx`; never other `4xx`).
 * - {@link computeRetryDelay} — combines the two and honours `Retry-After` on
 *   `429` responses.
 * - {@link createRetryMiddleware} — the middleware that configures the
 *   transport's per-request retry policy.
 *
 * Keeping these in one module makes the policy easy to unit-test in isolation
 * and to reuse outside the transport (for example around Stellar Horizon calls
 * made directly by an agent runtime).
 *
 * @module
 */

export {
  backoffDelay,
  isRetryableStatus,
  sleep,
  type RetryConfig,
  type RetryMiddlewareOptions,
} from '@astroid/core';

export {
  createRetryMiddleware,
  retryMiddleware,
  computeRetryDelay,
  type RetryMiddlewareConfig,
} from './middleware/retry.js';

/**
 * `@astroid/client` — retry middleware with exponential backoff and jitter.
 *
 * Autonomous agents running on Stellar can encounter transient network blips,
 * API gateway hiccups (502/503/504), and rate-limit windows (429) that are
 * short-lived and safe to retry automatically. This middleware wraps the
 * transport loop in an iterative retry strategy that:
 *
 * - **Respects idempotency**: only retries idempotent HTTP methods (GET, PUT,
 *   DELETE) or requests with an `Idempotency-Key` header by default. POST/PATCH
 *   requests are not retried unless `retryAllMethods: true` is set or the
 *   caller explicitly marks the request `retryable: true`.
 * - **Exponential backoff with full jitter**: each retry waits a random
 *   interval in `[0, min(baseDelayMs * 2^(attempt-1), maxDelayMs)]` so agents
 *   don't all thunder-herd against a recovering backend.
 * - **Retry-After compliance**: on 429 responses the middleware reads the
 *   `Retry-After` header (seconds) and waits at least that long before the
 *   next attempt, capped at `maxDelayMs`.
 * - **Configurable retry predicate**: the default retryable status set
 *   (`429` and any `5xx`) can be replaced per-instance with an explicit
 *   `retryableStatusCodes` list or a custom `shouldRetryStatus` function.
 * - **Visibility via `onRetry` callback**: consumers can log, trace, or
 *   surface retry events without instrumenting low-level transports.
 *
 * ## Usage
 *
 * The middleware is wired in automatically by `new Astroid({ retry: { ... } })`
 * through the `Astroid` constructor. It can also be added standalone:
 *
 * ```ts
 * import { Astroid, createRetryMiddleware } from '@astroid/client';
 *
 * const astroid = new Astroid({ apiKey: 'sk_live_...' });
 *
 * // Override the default retry policy for this client.
 * astroid.use(createRetryMiddleware({
 *   maxRetries: 5,
 *   baseDelayMs: 200,
 *   maxDelayMs: 10_000,
 *   onRetry: (attempt, error, delayMs) => {
 *     console.warn(`Retry ${attempt} in ${delayMs}ms after:`, error);
 *   },
 * }));
 * ```
 *
 * ## Notes on middleware ordering
 *
 * Register the retry middleware **before** logging or tracing middleware so
 * that each individual attempt is traced independently. Register it **after**
 * authentication middleware so that the auth headers are always fresh on the
 * first attempt (re-auth on 401 is handled separately by the `HttpClient`'s
 * built-in 401 handler and is not re-tried through this middleware).
 *
 * @module
 */

import {
  backoffDelay,
  type Middleware,
  type PreparedRequest,
  type RetryConfig,
  type RetryMiddlewareOptions,
} from '@astroid/core';

/* -------------------------------------------------------------------------- */
/* Public re-exports                                                           */
/* -------------------------------------------------------------------------- */

export type { RetryConfig, RetryMiddlewareOptions };

/* -------------------------------------------------------------------------- */
/* Options                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Options for {@link createRetryMiddleware}.
 *
 * All fields are optional; omitted values fall back to sensible defaults.
 * Extends {@link RetryMiddlewareOptions} from `@astroid/core`.
 */
export interface RetryMiddlewareConfig extends RetryMiddlewareOptions {
  /**
   * Maximum number of retry attempts after the initial request.
   * @default 3
   */
  maxRetries?: number;

  /**
   * Initial backoff delay in milliseconds before the first retry. The actual
   * wait for attempt `n` is a random value in `[0, min(baseDelayMs * 2^(n-1),
   * maxDelayMs)]`.
   * @default 250
   */
  baseDelayMs?: number;

  /**
   * Upper bound for a single retry delay in milliseconds (including
   * `Retry-After` seconds). Prevents unbounded waits in heavily throttled
   * environments.
   * @default 8000
   */
  maxDelayMs?: number;

  /**
   * Multiplier applied per attempt when computing exponential backoff:
   * `baseDelayMs * backoffFactor^(attempt - 1)` (then jittered).
   * @default 2
   */
  backoffFactor?: number;

  /**
   * The HTTP status codes that warrant a retry. When omitted, the SDK-wide
   * default applies: `429` and any `5xx`. Pass an explicit list such as
   * `[429, 502, 503, 504]` to restrict retries to those statuses.
   * `shouldRetryStatus` takes precedence when both are supplied.
   */
  retryableStatusCodes?: number[];

  /**
   * Called before each retry sleep so callers can log, trace, or emit metrics.
   *
   * @param attempt    The retry attempt number (1-based).
   * @param error      The error that triggered this retry.
   * @param delayMs    The calculated delay in milliseconds before the retry.
   * @param req        The prepared request that failed.
   */
  onRetry?: (attempt: number, error: unknown, delayMs: number, req: PreparedRequest) => void;

  /**
   * Custom predicate deciding whether a given HTTP status code is retryable.
   * Defaults to the SDK-wide {@link isRetryableStatus}: `429` and any `5xx`
   * (all other `4xx` client errors are never retried).
   */
  shouldRetryStatus?: (status: number) => boolean;

  /**
   * When `true`, all HTTP methods are treated as retryable by this middleware
   * (the `HttpClient` still gates on the `retryable` flag of the prepared
   * request). Use with caution for non-idempotent endpoints.
   * @default false
   */
  retryAllMethods?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Defaults                                                                    */
/* -------------------------------------------------------------------------- */

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 8_000;

/* -------------------------------------------------------------------------- */
/* Factory                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Create a retry middleware with exponential backoff and full jitter.
 *
 * The middleware injects a `_retryConfig` and `_retryOptions` context block
 * into each request, which the `HttpClient`'s core retry loop picks up to
 * override the global client-level retry config for that request. This allows
 * per-middleware-instance settings (e.g. a different `maxRetries` for a
 * specific client) to coexist with the global defaults.
 *
 * The middleware itself does **not** implement the sleep loop — that is handled
 * by `HttpClient.request`. It focuses on:
 * 1. Normalising and storing the retry config in request context.
 * 2. Propagating `retryable` per the `retryAllMethods` flag.
 *
 * This keeps the separation of concerns clean: the middleware configures
 * policy; the transport enforces it.
 *
 * @param options Optional retry configuration overrides.
 * @returns A `Middleware` instance ready for `client.use(...)`.
 *
 * @example
 * ```ts
 * const astroid = new Astroid({ apiKey: 'sk_live_...' });
 *
 * astroid.use(createRetryMiddleware({
 *   maxRetries: 3,
 *   baseDelayMs: 100,
 *   maxDelayMs: 5_000,
 *   onRetry: (n, err, delayMs) =>
 *     console.warn(`[retry ${n}] in ${delayMs}ms`, (err as Error).message),
 * }));
 * ```
 */
export function createRetryMiddleware(options: RetryMiddlewareConfig = {}): Middleware {
  const retryConfig: RetryConfig = {
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    baseDelayMs: options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
    maxDelayMs: options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
    ...(options.backoffFactor !== undefined ? { backoffFactor: options.backoffFactor } : {}),
    ...(options.retryableStatusCodes !== undefined
      ? { retryableStatusCodes: options.retryableStatusCodes }
      : {}),
  };

  // Normalise the middleware options we forward to the HttpClient's retry loop.
  const middlewareOptions: RetryMiddlewareOptions = {
    ...retryConfig,
    ...(options.onRetry ? { onRetry: options.onRetry } : {}),
    // Only forward an explicit predicate; otherwise the transport falls back to
    // `retryableStatusCodes` (when given) and then the SDK default.
    ...(options.shouldRetryStatus ? { shouldRetryStatus: options.shouldRetryStatus } : {}),
    retryAllMethods: options.retryAllMethods ?? false,
  };

  return {
    name: 'retry',

    onRequest(req: PreparedRequest): PreparedRequest {
      // Determine retryable flag: if retryAllMethods is set, force retryable
      // true unless the caller explicitly set it to false on the request.
      const retryable = options.retryAllMethods ? (req.options.retryable ?? true) : req.retryable;

      return {
        ...req,
        retryable,
        options: {
          ...req.options,
          context: {
            ...req.options.context,
            // These context keys are read by HttpClient.request to select the
            // per-request retry config over the global client config.
            _retryConfig: retryConfig,
            _retryOptions: middlewareOptions,
          },
        },
      };
    },
  };
}

/**
 * Singleton retry middleware using default configuration.
 *
 * Equivalent to `createRetryMiddleware()`.  Useful when a single shared
 * instance is preferred over a new allocation per client.
 *
 * @example
 * ```ts
 * import { retryMiddleware } from '@astroid/client/middleware/retry';
 * astroid.use(retryMiddleware());
 * ```
 */
export const retryMiddleware = createRetryMiddleware;

export default createRetryMiddleware;

/* -------------------------------------------------------------------------- */
/* Helpers (exported for testing)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Compute the retry delay in milliseconds for a given attempt and config,
 * honouring a server-supplied `Retry-After` header on 429 responses.
 *
 * - For 429 responses: reads `retryAfterSeconds`, capped at `config.maxDelayMs`.
 * - For all others: exponential backoff with full jitter via {@link backoffDelay}.
 *
 * @param attempt            The 1-based retry attempt number.
 * @param config             The active retry config.
 * @param status             The HTTP status that triggered the retry.
 * @param retryAfterSeconds  Seconds from the `Retry-After` header (or `undefined`).
 * @param random             Injected RNG for deterministic testing (defaults to `Math.random`).
 */
export function computeRetryDelay(
  attempt: number,
  config: RetryConfig,
  status: number,
  retryAfterSeconds?: number,
  random: () => number = Math.random,
): number {
  // Honour Retry-After on rate-limited responses.
  if (status === 429 && retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds)) {
    return Math.min(Math.max(0, retryAfterSeconds * 1000), config.maxDelayMs);
  }
  return backoffDelay(attempt, config, random);
}

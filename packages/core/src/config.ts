/**
 * Client configuration and its normalisation.
 *
 * `resolveConfig` turns the loose, user-facing `AstroidClientConfig` into a
 * fully-populated `ResolvedConfig` with every default applied, so the rest of
 * the SDK never has to reason about `undefined`.
 */

import type { AuthTokens } from '@astroid/types';

/** How the SDK authenticates each request. */
export interface AuthConfig {
  /** A secret API key (`sk_live_…` / `sk_test_…`). Sent as a Bearer token. */
  apiKey?: string;
  /**
   * A short-lived JWT access token (alternative to an API key), **or** an
   * async function that returns one. When a function is provided it is
   * evaluated before every outbound request so the client always uses a
   * fresh token. Concurrent requests share a single in-flight promise to
   * avoid redundant invocations.
   */
  accessToken?: string | (() => Promise<string>);
  /** A refresh token used to obtain a new access token pair. */
  refreshToken?: string;
  /** Callback invoked whenever tokens are refreshed or updated. */
  onTokenUpdate?: (tokens: AuthTokens) => void | Promise<void>;
  /**
   * Resolved dynamic token provider (set internally by `resolveConfig` when
   * `accessToken` is a function). Consumers should not set this directly.
   */
  tokenProvider?: () => Promise<string>;
}

/** Retry/backoff behaviour for transient failures. */
export interface RetryConfig {
  /** Maximum number of retries after the first attempt. Default 3. */
  maxRetries: number;
  /** Base backoff in ms; grows exponentially with jitter. Default 250. */
  baseDelayMs: number;
  /** Upper bound for a single backoff delay in ms. Default 8000. */
  maxDelayMs: number;
  /**
   * Multiplier applied per attempt when computing exponential backoff:
   * `baseDelayMs * backoffFactor^(attempt - 1)`. Default `2`.
   */
  backoffFactor?: number;
  /**
   * The HTTP status codes that warrant a retry.
   *
   * When omitted, the SDK-wide default applies: `429` and any `5xx`. Supply an
   * explicit list (e.g. `[429, 502, 503, 504]`) to retry only those statuses —
   * useful when an upstream gateway emits transient codes outside the standard
   * set. `shouldRetryStatus` on the retry middleware takes precedence over this.
   */
  retryableStatusCodes?: number[];
}

/**
 * Token-bucket rate limiting used by the client-rate-limiter middleware.
 *
 * Every field is optional; the middleware applies sensible defaults for any
 * omitted value. `maxRequestsPerSecond` is the sustained rate, `burstCapacity`
 * the number of requests allowed to fire back-to-back, `maxQueueLength` the
 * number of excess requests buffered before new ones are rejected, and
 * `queueTimeoutMs` how long a buffered request may wait before failing.
 */
export interface RateLimitConfig {
  /** Sustained request rate (tokens refilled per second). Default 10. */
  maxRequestsPerSecond?: number;
  /** Token bucket capacity — requests allowed to fire immediately. Default 10. */
  burstCapacity?: number;
  /** Max queued requests before new ones are rejected. Default 100. */
  maxQueueLength?: number;
  /** Max ms a queued request waits for a token before failing. Default 30_000. */
  queueTimeoutMs?: number;
}

/** Context passed to the {@link TelemetryHooks.onRequest} callback. */
export interface TelemetryRequestInfo {
  /** HTTP method (GET, POST, …). */
  method: string;
  /** Full request URL. */
  url: string;
  /** The generated or caller-supplied correlation / request ID. */
  correlationId: string;
  /** Per-request headers (may include auth). */
  headers: Record<string, string>;
}

/** Context passed to the {@link TelemetryHooks.onResponse} callback. */
export interface TelemetryResponseInfo {
  /** HTTP method (GET, POST, …). */
  method: string;
  /** Full request URL. */
  url: string;
  /** The correlation / request ID that was sent with the request. */
  correlationId: string;
  /** HTTP response status code. */
  status: number;
  /** Round-trip duration in milliseconds. */
  durationMs: number;
  /** Whether the request succeeded (2xx). */
  success: boolean;
}

/** Lifecycle callbacks for request/response telemetry and monitoring. */
export interface TelemetryHooks {
  /** Called immediately before each outbound request is sent. */
  onRequest?: (info: TelemetryRequestInfo) => void | Promise<void>;
  /** Called after each response is received (success or failure). */
  onResponse?: (info: TelemetryResponseInfo) => void | Promise<void>;
}

/** User-facing configuration passed to `new Astroid({ ... })`. */
export interface AstroidClientConfig extends AuthConfig {
  /** API base URL. Defaults to the public API. */
  baseUrl?: string;
  /** API version path segment. Default `v1`. */
  apiVersion?: string;
  /** Global request timeout in milliseconds. Default 10_000. */
  timeoutMs?: number;
  /** Alias for {@link timeoutMs} (accepted for API parity). */
  timeout?: number;
  /** Retry configuration, or `false` to disable retries entirely. */
  retry?: Partial<RetryConfig> | false;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
  /** Injected fetch implementation (for tests / non-standard runtimes). */
  fetch?: typeof fetch;
  /** Default Stellar network fallback when a request doesn't specify one. */
  network?: string;
  /** Opt into the offline queue for mutating requests. Default false. */
  enableOfflineQueue?: boolean;
  /**
   * Token-bucket per-client rate limiting. When provided, outbound requests are
   * throttled to a sustained rate while allowing bursts, excess requests are
   * queued up to `maxQueueLength`, and `Retry-After` from 429 responses is
   * honoured. Default: no client-side rate limiting.
   */
  rateLimit?: RateLimitConfig;
  /** Request/response telemetry hooks for logging and monitoring. */
  telemetry?: TelemetryHooks;
  /**
   * Static tracing headers merged into every outbound request.
   *
   * Use this for organization-wide correlation (e.g. a fixed tenant or deployment
   * correlation id). Per-request `options.headers`, `options.correlationId` and
   * `options.requestId` take precedence over these values (issue #255).
   */
  tracingHeaders?: Record<string, string>;
}

/** Fully-resolved configuration with all defaults applied. */
export interface ResolvedConfig {
  baseUrl: string;
  apiVersion: string;
  timeoutMs: number;
  retry: RetryConfig | null;
  headers: Record<string, string>;
  auth: AuthConfig;
  fetch: typeof fetch;
  network: string | undefined;
  enableOfflineQueue: boolean;
  /** Token-bucket rate limiting options, when configured. See {@link RateLimitConfig}. */
  rateLimit?: RateLimitConfig;
  /** Static tracing headers merged into every request. See {@link AstroidClientConfig.tracingHeaders}. */
  tracingHeaders?: Record<string, string>;
}

/** The default public API base URL. */
export const DEFAULT_BASE_URL = 'https://api.astroid.finance';

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 250,
  maxDelayMs: 8000,
  backoffFactor: 2,
};

/** Strip a single trailing slash so URL joins stay clean. */
function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Normalise user config into a `ResolvedConfig`. Throws if neither an API key
 * nor an access token is supplied (the SDK cannot authenticate otherwise).
 */
export function resolveConfig(config: AstroidClientConfig): ResolvedConfig {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new TypeError(
      'No fetch implementation found. Pass `fetch` in the client config on runtimes without a global fetch.',
    );
  }

  const retry = config.retry === false ? null : { ...DEFAULT_RETRY, ...(config.retry ?? {}) };

  return {
    baseUrl: trimTrailingSlash(config.baseUrl ?? DEFAULT_BASE_URL),
    apiVersion: config.apiVersion ?? 'v1',
    timeoutMs: config.timeoutMs ?? config.timeout ?? 10_000,
    retry,
    headers: { ...(config.headers ?? {}) },
    auth: {
      apiKey: config.apiKey,
      accessToken: typeof config.accessToken === 'function' ? undefined : config.accessToken,
      refreshToken: config.refreshToken,
      onTokenUpdate: config.onTokenUpdate,
      tokenProvider: typeof config.accessToken === 'function' ? config.accessToken : undefined,
    },
    fetch: fetchImpl,
    network: config.network,
    enableOfflineQueue: config.enableOfflineQueue ?? false,
    rateLimit: config.rateLimit,
    tracingHeaders: config.tracingHeaders,
  };
}

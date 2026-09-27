/**
 * `@astroid/client` — request ID and correlation tracing middleware.
 *
 * Every outbound request automatically carries correlation tracing headers so
 * that a single SDK operation can be traced across the client, API gateway,
 * and backend services:
 *
 * - `X-Request-ID` — unique per HTTP request. A fresh UUID v4 is generated for
 *   each request (via `crypto.randomUUID()`) unless the caller supplies one
 *   through `options.requestId`, `options.correlationId`, or a pre-set
 *   `x-request-id` header.
 * - `X-Correlation-ID` — the end-to-end correlation identifier. It propagates
 *   across every request of a logical operation (or an entire agent workflow),
 *   either because the caller supplied it or because it was configured
 *   client-wide via `tracingHeaders` / {@link CorrelationTracingConfig}.
 * - `X-Astroid-Correlation-ID` — legacy/alias correlation header, kept for
 *   backwards compatibility with earlier SDK versions.
 *
 * Precedence (highest wins) for each header:
 * 1. Caller-supplied per-request headers (`options.headers`)
 * 2. `options.requestId` / `options.correlationId`
 * 3. Client-configured `tracingHeaders` (static, applied to every request)
 * 4. A freshly generated UUID v4
 *
 * The middleware also measures request duration and fires the optional
 * `onRequest` / `onResponse` telemetry hooks configured on the client, making
 * it straightforward to integrate with logging, tracing, or APM tools.
 *
 * @example
 * ```ts
 * import { Astroid, createCorrelationMiddleware } from '@astroid/client';
 *
 * // Client-wide tracing configuration:
 * const astroid = new Astroid({
 *   apiKey: 'sk_test_...',
 *   tracingHeaders: { 'x-correlation-id': 'agent-workflow-42' },
 *   telemetry: {
 *     onRequest: (info) => console.log(`→ ${info.method} ${info.url} [${info.correlationId}]`),
 *     onResponse: (info) => console.log(`← ${info.status} in ${info.durationMs}ms [${info.correlationId}]`),
 *   },
 * });
 *
 * // Per-request custom correlation ID for end-to-end tracing:
 * await astroid.http.get('/wallets/wal_1', { correlationId: 'workflow-42' });
 *
 * // Per-request custom request ID:
 * await astroid.http.get('/wallets/wal_1', { requestId: 'req-abc-001' });
 * ```
 *
 * @module
 */

import type { Middleware, PreparedRequest, RawResponse } from '@astroid/core';
import type { TelemetryHooks } from '@astroid/core';

/** Context key used to store the correlation ID in `request.options.context`. */
const CORRELATION_ID_KEY = '_correlationId';
/** Context key used to store the request start time in milliseconds. */
const START_TIME_KEY = '_startTime';

/**
 * Generate a UUID v4 using the Web Crypto API (`crypto.randomUUID()`),
 * available in Node 20+ and all modern browsers.
 *
 * Falls back to a manual implementation when `crypto` is unavailable (e.g.
 * non-secure browser contexts or exotic runtimes), though this is unlikely in
 * practice since the SDK requires Node >= 20.
 */
function generateCorrelationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback: manual UUID v4 from hex digits
  const hex = '0123456789abcdef';
  let uuid = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += '-';
    } else if (i === 14) {
      uuid += '4';
    } else if (i === 19) {
      uuid += hex[(Math.random() * 4) | 0];
    } else {
      uuid += hex[(Math.random() * 16) | 0];
    }
  }
  return uuid;
}

/**
 * The header name used for correlation IDs. Exported so consumers and tests
 * can reference the canonical header without hardcoding it.
 */
export const CORRELATION_ID_HEADER = 'x-astroid-correlation-id';

/**
 * The header name used for request tracing IDs. This is the server-facing
 * request ID header (distinct from the correlation ID used for client-side
 * trace linking).
 */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * The standard correlation header name (`X-Correlation-ID`) recognized by most
 * API gateways and observability stacks. Added alongside
 * {@link CORRELATION_ID_HEADER} in issue #255.
 */
export const X_CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Header names accepted as caller-supplied tracing headers (lowercase, as they
 * appear in `PreparedRequest.headers`).
 */
const TRACING_HEADER_NAMES = [
  CORRELATION_ID_HEADER,
  X_CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
] as const;

/**
 * Client-wide tracing configuration (issue #255).
 *
 * Supply through the `tracingHeaders` client config to stamp static tracing
 * headers onto every request, or through {@link createCorrelationMiddleware}'s
 * second argument when registering the middleware manually.
 */
export interface CorrelationTracingConfig {
  /**
   * Static tracing headers merged into every outbound request. Per-request
   * headers and `options.correlationId` / `options.requestId` take precedence.
   */
  headers?: Record<string, string>;
  /**
   * Optional fixed correlation ID applied to every request that does not carry
   * a caller-supplied one. Useful for pinning an entire agent run to one trace.
   * Ignored when {@link headers} contains a correlation header.
   */
  correlationId?: string;
}

/**
 * Normalize the various tracing-config input shapes into a single static
 * header map. Accepts either a plain header record (the client-config shape)
 * or a {@link CorrelationTracingConfig}.
 */
function normalizeTracingHeaders(
  config?: Record<string, string> | CorrelationTracingConfig,
): Record<string, string> {
  if (!config) return {};
  const normalized: Record<string, string> = {};

  if ('correlationId' in config && typeof config.correlationId === 'string') {
    normalized[CORRELATION_ID_HEADER] = config.correlationId;
    normalized[X_CORRELATION_ID_HEADER] = config.correlationId;
  }

  // Structured shape: { headers: {...}, correlationId?: string }
  if ('headers' in config && config.headers && typeof config.headers === 'object') {
    for (const [key, value] of Object.entries(config.headers)) {
      normalized[key.toLowerCase()] = value;
    }
    return normalized;
  }

  // Plain header record (the client-config `tracingHeaders` shape).
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      normalized[key.toLowerCase()] = value;
    }
  }
  return normalized;
}

/**
 * Create the request ID / correlation tracing middleware.
 *
 * The middleware:
 * 1. Resolves the request ID: `options.requestId` → `options.correlationId` →
 *    caller-supplied `x-request-id` header → a generated UUID v4.
 * 2. Resolves the correlation ID: caller-supplied correlation headers →
 *    `options.correlationId` → static `tracingHeaders` correlation → a
 *    generated UUID v4 (fresh per request when none is supplied).
 * 3. Injects `X-Request-ID`, `X-Correlation-ID` and
 *    `X-Astroid-Correlation-ID` headers.
 * 4. Records the request start time for duration measurement.
 * 5. Fires `onRequest` with the request info.
 * 6. On response, computes the round-trip duration and fires `onResponse`.
 *
 * @param telemetry Optional telemetry hooks (from the client config) to invoke
 *                  for each request/response lifecycle event.
 * @param tracing   Optional static tracing headers / correlation ID applied to
 *                  every request; per-request values take precedence.
 * @returns A {@link Middleware} that can be registered via `client.use()`.
 */
export function createCorrelationMiddleware(
  telemetry?: TelemetryHooks,
  tracing?: Record<string, string> | CorrelationTracingConfig,
): Middleware {
  // Snapshot the static tracing headers once at registration time.
  const staticHeaders = normalizeTracingHeaders(tracing);

  return {
    name: 'correlation',

    async onRequest(req: PreparedRequest): Promise<PreparedRequest> {
      const callerHeaders = req.headers ?? {};

      // ---- Resolve the request ID (per-request uniqueness) -----------------
      // Precedence: options.requestId → caller x-request-id header (which
      // includes any static tracing value not overridden) → options.correlationId
      // → a freshly generated UUID v4.
      const suppliedRequestId =
        req.options.requestId ??
        callerHeaders[REQUEST_ID_HEADER] ??
        req.options.correlationId;
      const requestId = suppliedRequestId ?? generateCorrelationId();

      // ---- Resolve the correlation ID (end-to-end trace) -------------------
      // Precedence: options.correlationId → caller correlation headers →
      // static tracing headers → a freshly generated UUID v4.
      const hasCallerCorrelationHeader =
        callerHeaders[CORRELATION_ID_HEADER] !== undefined ||
        callerHeaders[X_CORRELATION_ID_HEADER] !== undefined;
      const correlationId =
        req.options.correlationId ??
        callerHeaders[CORRELATION_ID_HEADER] ??
        callerHeaders[X_CORRELATION_ID_HEADER] ??
        staticHeaders[CORRELATION_ID_HEADER] ??
        staticHeaders[X_CORRELATION_ID_HEADER] ??
        generateCorrelationId();

      // Inject tracing headers. Caller-supplied per-request correlation headers
      // are left untouched unless `options.correlationId` explicitly overrides.
      const nextHeaders: Record<string, string> = { ...staticHeaders, ...callerHeaders };
      nextHeaders[REQUEST_ID_HEADER] = requestId;
      if (req.options.correlationId !== undefined || !hasCallerCorrelationHeader) {
        nextHeaders[CORRELATION_ID_HEADER] = correlationId;
        nextHeaders[X_CORRELATION_ID_HEADER] = correlationId;
      }

      // Store in context for the response phase and error enrichment.
      const context = { ...req.options.context };
      context[CORRELATION_ID_KEY] = correlationId;
      context[START_TIME_KEY] = Date.now();

      // Fire telemetry hook
      if (telemetry?.onRequest) {
        await telemetry.onRequest({
          method: req.method,
          url: req.url,
          correlationId,
          headers: nextHeaders,
        });
      }

      return { ...req, headers: nextHeaders, options: { ...req.options, context } };
    },

    async onResponse(res: RawResponse, req: PreparedRequest): Promise<void> {
      if (!telemetry?.onResponse) return;

      const correlationId =
        (req.options.context?.[CORRELATION_ID_KEY] as string) ?? res.requestId ?? '';
      const startTime = (req.options.context?.[START_TIME_KEY] as number) ?? Date.now();
      const durationMs = Date.now() - startTime;

      await telemetry.onResponse({
        method: req.method,
        url: req.url,
        correlationId,
        status: res.status,
        durationMs,
        success: res.status >= 200 && res.status < 300,
      });
    },
  };
}

/** Singleton correlation middleware instance (no telemetry hooks). */
export const correlationMiddleware = createCorrelationMiddleware();

/** Re-export the accepted tracing header names for consumers and tests. */
export const TRACED_HEADERS = TRACING_HEADER_NAMES;

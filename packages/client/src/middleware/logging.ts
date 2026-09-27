/**
 * Request/response logging middleware with hook support and header redaction.
 *
 * This middleware provides an extensible interceptor pattern for the
 * {@link Astroid} client, allowing developers to attach custom logging,
 * metrics, or observability hooks to every HTTP request and response.
 *
 * Sensitive headers (`Authorization`, `X-Api-Key`, `Cookie`, etc.) are
 * automatically redacted in default logs to prevent credential leakage.
 *
 * ```ts
 * import { Astroid, createLoggingMiddleware } from '@astroid/client';
 *
 * const astroid = new Astroid({
 *   apiKey: 'sk_test_...',
 *   logging: {
 *     onRequest: (info) => console.log('→', info.method, info.url),
 *     onResponse: (info) => console.log('←', info.status, info.durationMs + 'ms'),
 *   },
 * });
 * ```
 *
 * @module
 */

import type { Middleware, PreparedRequest, RawResponse } from '@astroid/core';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** Information passed to the `onRequest` hook. */
export interface RequestLogInfo {
  /** HTTP method (GET, POST, etc.). */
  method: string;
  /** Full request URL (including base). */
  url: string;
  /** Request headers (sensitive values redacted by default). */
  headers: Record<string, string>;
  /** Request body (if present). */
  body?: unknown;
  /** Correlation ID if available. */
  correlationId?: string;
}

/** Information passed to the `onResponse` hook. */
export interface ResponseLogInfo {
  /** HTTP method of the originating request. */
  method: string;
  /** Full request URL. */
  url: string;
  /** HTTP status code of the response. */
  status: number;
  /** Round-trip duration in milliseconds. */
  durationMs: number;
  /** Response request ID from the server. */
  requestId?: string;
  /** Correlation ID if available. */
  correlationId?: string;
  /** Whether the response was successful (2xx). */
  success: boolean;
}

/** Information passed to the `onError` hook. */
export interface ErrorLogInfo {
  /** HTTP method of the originating request. */
  method: string;
  /** Full request URL. */
  url: string;
  /** The error that occurred. */
  error: unknown;
  /** Round-trip duration in milliseconds (if available). */
  durationMs?: number;
  /** Correlation ID if available. */
  correlationId?: string;
}

/** Configuration for the logging middleware. */
export interface LoggingMiddlewareOptions {
  /** Hook invoked before each request is sent. */
  onRequest?: (info: RequestLogInfo) => void | Promise<void>;
  /** Hook invoked after each response is received. */
  onResponse?: (info: ResponseLogInfo) => void | Promise<void>;
  /** Hook invoked when a request fails. */
  onError?: (info: ErrorLogInfo) => void | Promise<void>;
  /** Additional header names to redact (merged with built-in list). */
  redactHeaders?: string[];
  /** Set to `false` to disable automatic header redaction. Default `true`. */
  enableRedaction?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Header redaction                                                            */
/* -------------------------------------------------------------------------- */

/** Built-in header names whose values must never be logged. */
const BUILT_IN_SENSITIVE_HEADERS = new Set([
  'authorization',
  'idempotency-key',
  'cookie',
  'x-api-key',
  'x-auth-token',
  'set-cookie',
]);

/**
 * Create a combined set of sensitive header names.
 */
function getSensitiveHeaders(extra?: string[]): Set<string> {
  const set = new Set(BUILT_IN_SENSITIVE_HEADERS);
  if (extra) {
    for (const h of extra) set.add(h.toLowerCase());
  }
  return set;
}

/**
 * Redact sensitive header values in a headers record.
 *
 * Headers whose names appear in the built-in sensitive list (and any
 * caller-supplied additions) are replaced with `[REDACTED]`.
 *
 * @param headers           The headers to redact.
 * @param additionalHeaders Extra header names to redact.
 * @returns A new headers object with sensitive values redacted.
 */
export function redactSensitiveHeaders(
  headers: Record<string, string>,
  additionalHeaders?: string[],
): Record<string, string> {
  const sensitive = getSensitiveHeaders(additionalHeaders);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = sensitive.has(key.toLowerCase()) ? '[REDACTED]' : value;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Middleware factory                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Create a logging middleware with optional `onRequest`, `onResponse`, and
 * `onError` hooks.
 *
 * The middleware automatically:
 * - Measures request duration.
 * - Redacts sensitive headers before passing them to hooks.
 * - Provides correlation IDs when available.
 *
 * @param options Hook configuration and redaction options.
 * @returns A {@link Middleware} that can be registered via `client.use()`.
 *
 * @example
 * ```ts
 * client.use(createLoggingMiddleware({
 *   onRequest: (info) => console.log(`→ ${info.method} ${info.url}`),
 *   onResponse: (info) => console.log(`← ${info.status} in ${info.durationMs}ms`),
 *   onError: (info) => console.error(`✗ ${info.method} ${info.url}:`, info.error),
 * }));
 * ```
 */
export function createLoggingMiddleware(options: LoggingMiddlewareOptions = {}): Middleware {
  const {
    onRequest,
    onResponse,
    onError,
    redactHeaders: extraRedactHeaders,
    enableRedaction = true,
  } = options;

  const redact = (headers: Record<string, string>) =>
    enableRedaction ? redactSensitiveHeaders(headers, extraRedactHeaders) : headers;

  return {
    name: 'logging',

    async onRequest(req: PreparedRequest): Promise<PreparedRequest> {
      if (onRequest) {
        const correlationId = req.options.context?.['_correlationId'] as string | undefined;
        await onRequest({
          method: req.method,
          url: req.url,
          headers: redact(req.headers),
          body: req.body ? tryParseJson(req.body) : undefined,
          correlationId,
        });
      }
      return req;
    },

    async onResponse(res: RawResponse, req: PreparedRequest): Promise<void> {
      if (onResponse) {
        const correlationId = req.options.context?.['_correlationId'] as string | undefined;
        const startTime = req.options.context?.['_startTime'] as number | undefined;
        const durationMs = startTime ? Date.now() - startTime : 0;

        await onResponse({
          method: req.method,
          url: req.url,
          status: res.status,
          durationMs,
          requestId: res.requestId,
          correlationId,
          success: res.status >= 200 && res.status < 300,
        });
      }
    },

    async onError(error: unknown, req: PreparedRequest): Promise<void> {
      if (onError) {
        const correlationId = req.options.context?.['_correlationId'] as string | undefined;
        const startTime = req.options.context?.['_startTime'] as number | undefined;
        const durationMs = startTime ? Date.now() - startTime : undefined;

        await onError({
          method: req.method,
          url: req.url,
          error,
          durationMs,
          correlationId,
        });
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Safely parse a JSON string body, returning the original on failure. */
function tryParseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

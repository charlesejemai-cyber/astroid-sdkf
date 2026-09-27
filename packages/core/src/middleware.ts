/**
 * Built-in middleware: request logging (with secret redaction) and a simple
 * per-key rate-limit guard. All are opt-in via `client.use(...)`.
 */

import type { Middleware, PreparedRequest, RawResponse } from './http-types.js';

/** Header names whose values must never be logged. */
const SENSITIVE_HEADERS = new Set(['authorization', 'idempotency-key', 'cookie', 'x-api-key']);

/** Redact sensitive headers so logs never leak credentials. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '[REDACTED]' : value;
  }
  return out;
}

/** A structured log line emitted by the logging middleware. */
export interface LogEntry {
  phase: 'request' | 'response' | 'error';
  method: string;
  url: string;
  status?: number;
  requestId?: string;
  headers?: Record<string, string>;
  error?: string;
}

/** A sink for log entries (defaults to `console.debug`). */
export type LogSink = (entry: LogEntry) => void;

const defaultSink: LogSink = (entry) => {
  // eslint-disable-next-line no-console
  console.debug('[astroid]', entry);
};

/**
 * Logging middleware. Never logs bodies or credential headers — only method,
 * URL, status, request id, and redacted headers.
 */
export function loggingMiddleware(sink: LogSink = defaultSink): Middleware {
  return {
    name: 'logging',
    onRequest(req: PreparedRequest) {
      sink({
        phase: 'request',
        method: req.method,
        url: req.url,
        headers: redactHeaders(req.headers),
      });
      return req;
    },
    onResponse(res: RawResponse, req: PreparedRequest) {
      sink({
        phase: 'response',
        method: req.method,
        url: req.url,
        status: res.status,
        requestId: res.requestId,
      });
    },
    onError(error: unknown, req: PreparedRequest) {
      sink({
        phase: 'error',
        method: req.method,
        url: req.url,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  };
}

/**
 * Attaches arbitrary static headers to every request (e.g. a tenant id). A thin
 * convenience wrapper so callers don't have to author middleware by hand.
 */
export function headerMiddleware(headers: Record<string, string>): Middleware {
  return {
    name: 'headers',
    onRequest(req: PreparedRequest) {
      return { ...req, headers: { ...req.headers, ...headers } };
    },
  };
}

import type { RetryConfig } from './config.js';

export interface RetryMiddlewareOptions extends Partial<RetryConfig> {
  /** Optional callback invoked on each retry attempt. */
  onRetry?: (attempt: number, error: unknown, delayMs: number, req: PreparedRequest) => void;
  /** Custom check for whether a status code is retryable. Defaults to isRetryableStatus. */
  shouldRetryStatus?: (status: number) => boolean;
  /** Force all requests passing through this middleware to be retryable (unless explicitly set false). Default false. */
  retryAllMethods?: boolean;
}

/**
 * Creates an exponential backoff and retry middleware for network and 5xx errors.
 */
export function createRetryMiddleware(options: RetryMiddlewareOptions = {}): Middleware {
  const retryConfig: RetryConfig = {
    maxRetries: options.maxRetries ?? 3,
    baseDelayMs: options.baseDelayMs ?? 250,
    maxDelayMs: options.maxDelayMs ?? 8000,
    ...(options.backoffFactor !== undefined ? { backoffFactor: options.backoffFactor } : {}),
    ...(options.retryableStatusCodes !== undefined
      ? { retryableStatusCodes: options.retryableStatusCodes }
      : {}),
  };

  return {
    name: 'retry',
    onRequest(req: PreparedRequest) {
      const context = {
        ...req.options.context,
        _retryConfig: retryConfig,
        _retryOptions: options,
      };
      const retryable = options.retryAllMethods ? (req.options.retryable ?? true) : req.retryable;

      return {
        ...req,
        retryable,
        options: {
          ...req.options,
          context,
        },
      };
    },
  };
}

export const retryMiddleware = createRetryMiddleware;

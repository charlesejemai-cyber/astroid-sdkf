/**
 * Pluggable request/response interceptors for `@astroid/client`.
 *
 * Interceptors are the lightweight, ergonomic counterpart to the low-level
 * middleware pipeline. They let application code observe — and, where needed,
 * rewrite — outbound requests and inbound responses for auditing, debugging,
 * telemetry, and header injection, without reaching into the internals of
 * {@link HttpClient}.
 *
 * Request interceptors run **in array order** before the request is dispatched;
 * response interceptors run **in array order** as each response is received.
 * Both are async-friendly: return a replacement config to transform the
 * message, or return nothing to observe it in place.
 *
 * ```ts
 * import { Astroid, createDebugLogger } from '@astroid/client';
 *
 * const debug = createDebugLogger();
 *
 * const astroid = new Astroid({
 *   apiKey: 'sk_test_...',
 *   requestInterceptors: [
 *     // Inject a tenant header on every request.
 *     (config) => ({ ...config, headers: { ...config.headers, 'x-tenant': 'acme' } }),
 *     debug.requestInterceptor,
 *   ],
 *   responseInterceptors: [debug.responseInterceptor],
 * });
 * ```
 *
 * @module
 */

import type {
  HttpMethod,
  Middleware,
  PreparedRequest,
  RawResponse,
  RequestOptions,
} from '@astroid/core';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A mutable view of an outbound request, handed to every request interceptor.
 *
 * `headers` is a plain record so interceptors can add/remove entries directly.
 * `body` is the JSON-parsed payload when the request has one, which makes
 * inspection straightforward; returning a modified body re-serialises it.
 */
export interface RequestConfig {
  /** The fully-qualified request URL (base + path + serialised query). */
  url: string;
  /** The HTTP method. */
  method: HttpMethod;
  /** Request headers (auth headers are already present). */
  headers: Record<string, string>;
  /** The decoded request body, or `undefined` for body-less requests. */
  body?: unknown;
  /** The original per-request options, for advanced inspection. */
  options?: RequestOptions;
}

/**
 * A mutable view of an inbound response, handed to every response interceptor.
 *
 * `request` echoes the request that produced this response so interceptors can
 * correlate the two without external bookkeeping.
 */
export interface ResponseConfig {
  /** The HTTP status code. */
  status: number;
  /** Response headers. */
  headers: Headers;
  /** The parsed response body (`undefined` for empty responses such as `204`). */
  body: unknown;
  /** The server-assigned request ID, when present. */
  requestId?: string;
  /** The request that produced this response. */
  request: RequestConfig;
}

/**
 * A request interceptor. Return a new {@link RequestConfig} to transform the
 * request, or return nothing to observe it without changing it.
 */
export type RequestInterceptor = (
  config: RequestConfig,
) => RequestConfig | void | Promise<RequestConfig | void>;

/**
 * A response interceptor. Return a new {@link ResponseConfig} to transform the
 * response, or return nothing to observe it without changing it.
 */
export type ResponseInterceptor = (
  response: ResponseConfig,
) => ResponseConfig | void | Promise<ResponseConfig | void>;

/** Interceptor arrays accepted by the client configuration. */
export interface InterceptorOptions {
  /** Interceptors invoked, in order, before each request is dispatched. */
  requestInterceptors?: RequestInterceptor[];
  /** Interceptors invoked, in order, as each response is received. */
  responseInterceptors?: ResponseInterceptor[];
}

/* -------------------------------------------------------------------------- */
/* Body helpers                                                                */
/* -------------------------------------------------------------------------- */

/** Parse a JSON string body for inspection, falling back to the raw string. */
function decodeBody(body: string | undefined): unknown {
  if (body === undefined) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** Re-encode an interceptor-supplied body back into the transport string. */
function encodeBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}

/** Snapshot a prepared request into the interceptor-facing config. */
function toRequestConfig(req: PreparedRequest): RequestConfig {
  return {
    url: req.url,
    method: req.method,
    headers: { ...req.headers },
    body: decodeBody(req.body),
    options: req.options,
  };
}

/** Fold an (possibly transformed) config back into a prepared request. */
function fromRequestConfig(original: PreparedRequest, config: RequestConfig): PreparedRequest {
  return {
    ...original,
    url: config.url,
    method: config.method,
    headers: config.headers,
    body: encodeBody(config.body),
    options: config.options ?? original.options,
  };
}

/* -------------------------------------------------------------------------- */
/* Middleware factory                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Create a middleware that runs the supplied request and response interceptors.
 *
 * The middleware is registered automatically by {@link Astroid} when
 * `requestInterceptors` / `responseInterceptors` are present in the client
 * config, but it can also be attached manually via `client.use(...)`.
 *
 * @param options The interceptor arrays to execute.
 * @returns A {@link Middleware} that can be registered via `client.use()`.
 */
export function createInterceptorMiddleware(options: InterceptorOptions = {}): Middleware {
  const requestInterceptors = options.requestInterceptors ?? [];
  const responseInterceptors = options.responseInterceptors ?? [];

  return {
    name: 'interceptors',

    async onRequest(req: PreparedRequest): Promise<PreparedRequest> {
      let current = toRequestConfig(req);
      for (const interceptor of requestInterceptors) {
        const next = await interceptor(current);
        if (next) current = next;
      }
      return fromRequestConfig(req, current);
    },

    async onResponse(res: RawResponse, req: PreparedRequest): Promise<void> {
      let current: ResponseConfig = {
        status: res.status,
        headers: res.headers,
        body: res.body,
        requestId: res.requestId,
        request: toRequestConfig(req),
      };
      for (const interceptor of responseInterceptors) {
        const next = await interceptor(current);
        if (next) current = next;
      }
      res.status = current.status;
      res.body = current.body;
      res.requestId = current.requestId;
      if (current.headers !== res.headers) {
        res.headers = current.headers;
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Built-in debug logger                                                       */
/* -------------------------------------------------------------------------- */

/** Header names redacted by the debug logger by default. */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'idempotency-key',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
]);

/** Redact sensitive header values before logging. */
export function redactDebugHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '[REDACTED]' : value;
  }
  return out;
}

/** Configuration for {@link createDebugLogger}. */
export interface DebugLoggerOptions {
  /** Whether the logger is active. Defaults to `true`. */
  enabled?: boolean;
  /** Log sink. Defaults to `console.debug`. */
  logger?: (message: string) => void;
  /** Log request/response bodies. Defaults to `true`. */
  includeBody?: boolean;
  /** Redact sensitive headers. Defaults to `true`. */
  redactHeaders?: boolean;
}

/** The interceptor pair produced by {@link createDebugLogger}. */
export interface DebugLogger {
  /** Configured request interceptor. */
  requestInterceptor: RequestInterceptor;
  /** Configured response interceptor. */
  responseInterceptor: ResponseInterceptor;
}

/**
 * Create a built-in debug logger that emits request/response log lines in a
 * stable, greppable format:
 *
 * ```
 * [astroid] → POST https://api.astroid.finance/v1/wallets {...}
 * [astroid] ← 201 POST https://api.astroid.finance/v1/wallets (42ms) {...}
 * ```
 *
 * Sensitive headers are redacted by default, and bodies can be disabled with
 * `includeBody: false`. Pass `enabled: false` (or simply do not attach the
 * interceptors) to keep the logger inert.
 *
 * @param options Logger tuning options.
 * @returns A request/response interceptor pair.
 *
 * @example
 * ```ts
 * const debug = createDebugLogger({ includeBody: false });
 * const astroid = new Astroid({
 *   apiKey: 'sk_test_...',
 *   requestInterceptors: [debug.requestInterceptor],
 *   responseInterceptors: [debug.responseInterceptor],
 * });
 * ```
 */
export function createDebugLogger(options: DebugLoggerOptions = {}): DebugLogger {
  const { enabled = true, logger, includeBody = true, redactHeaders = true } = options;
  const sink = logger ?? ((message: string) => console.debug(message));

  const formatHeaders = (headers: Record<string, string>): Record<string, string> =>
    redactHeaders ? redactDebugHeaders(headers) : headers;

  const requestInterceptor: RequestInterceptor = (config) => {
    if (!enabled) return;
    const parts = [
      `[astroid] → ${config.method} ${config.url}`,
      `headers=${JSON.stringify(formatHeaders(config.headers))}`,
    ];
    if (includeBody && config.body !== undefined) {
      parts.push(`body=${JSON.stringify(config.body)}`);
    }
    sink(parts.join(' '));
  };

  const responseInterceptor: ResponseInterceptor = (response) => {
    if (!enabled) return;
    const startTime = response.request.options?.context?.['_startTime'] as number | undefined;
    const durationMs = startTime ? Date.now() - startTime : 0;
    const parts = [
      `[astroid] ← ${response.status} ${response.request.method} ${response.request.url} (${durationMs}ms)`,
    ];
    if (includeBody && response.body !== undefined) {
      parts.push(`body=${JSON.stringify(response.body)}`);
    }
    sink(parts.join(' '));
  };

  return { requestInterceptor, responseInterceptor };
}

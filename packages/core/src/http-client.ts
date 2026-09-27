/**
 * The Astroid HTTP client: auth headers, timeouts, retries with backoff,
 * response-envelope unwrapping, and typed error mapping. Every SDK resource is
 * built on this class; it holds no domain knowledge itself.
 */

import { fromApiError, fromStatus, toNetworkError, type AstroidError } from '@astroid/errors';
import type { ApiError } from '@astroid/types';

import {
  resolveConfig,
  type AstroidClientConfig,
  type ResolvedConfig,
  type RetryConfig,
} from './config.js';
import type { RetryMiddlewareOptions } from './middleware.js';
import {
  MiddlewareStack,
  type AstroidResponse,
  type Middleware,
  type PreparedRequest,
  type RawResponse,
  type RequestOptions,
} from './http-types.js';
import { buildUrl } from './url.js';
import { backoffDelay, isRetryableStatus, sleep } from './backoff.js';
import { AstroidTimeoutError } from './timeout-error.js';

/** Methods considered safe to retry by default (idempotent verbs). */
const IDEMPOTENT_METHODS = new Set(['GET', 'PUT', 'DELETE']);

/** SDK version, surfaced in the User-Agent header. */
export const SDK_VERSION = '0.1.0';

export class HttpClient {
  readonly config: ResolvedConfig;
  readonly middleware = new MiddlewareStack();
  private on401Handler?: (req: PreparedRequest) => Promise<boolean>;
  private tokenProvider?: () => Promise<string>;
  private pendingTokenPromise?: Promise<string>;

  constructor(config: AstroidClientConfig) {
    this.config = resolveConfig(config);
    if (this.config.auth.tokenProvider) {
      this.tokenProvider = this.config.auth.tokenProvider;
    }
  }

  /** Register a middleware. Returns `this` for chaining. */
  use(middleware: Middleware): this {
    this.middleware.use(middleware);
    return this;
  }

  /** Register an automatic 401 retry handler. */
  set401Handler(handler: (req: PreparedRequest) => Promise<boolean>): void {
    this.on401Handler = handler;
  }

  /** Update auth credentials at runtime (e.g. after a token refresh). */
  setAccessToken(accessToken: string | undefined): void {
    this.config.auth.accessToken = accessToken;
  }

  /**
   * Set a dynamic token provider function. When provided, it is evaluated
   * before every outbound request. Concurrent requests share a single
   * in-flight promise to avoid redundant invocations.
   */
  setTokenProvider(provider: (() => Promise<string>) | undefined): void {
    this.tokenProvider = provider;
  }

  /**
   * Resolve the current access token. If a dynamic token provider is
   * registered, evaluates it and caches the in-flight promise so concurrent
   * callers share a single refresh. Falls back to the static
   * `accessToken` / `apiKey` string.
   */
  private async resolveToken(): Promise<string | undefined> {
    if (this.tokenProvider) {
      if (this.pendingTokenPromise) {
        return this.pendingTokenPromise;
      }
      this.pendingTokenPromise = (async () => {
        try {
          const token = await this.tokenProvider!();
          this.config.auth.accessToken = token;
          return token;
        } finally {
          this.pendingTokenPromise = undefined;
        }
      })();
      return this.pendingTokenPromise;
    }
    const token = this.config.auth.accessToken;
    return typeof token === 'string' ? token : undefined;
  }

  /* ----------------------------- verb helpers ----------------------------- */

  get<TData>(
    path: string,
    options: Omit<RequestOptions, 'method' | 'path'> = {},
  ): Promise<AstroidResponse<TData>> {
    return this.request<TData>({ ...options, method: 'GET', path });
  }

  post<TData>(
    path: string,
    body?: unknown,
    options: Omit<RequestOptions, 'method' | 'path' | 'body'> = {},
  ): Promise<AstroidResponse<TData>> {
    return this.request<TData>({ ...options, method: 'POST', path, body });
  }

  patch<TData>(
    path: string,
    body?: unknown,
    options: Omit<RequestOptions, 'method' | 'path' | 'body'> = {},
  ): Promise<AstroidResponse<TData>> {
    return this.request<TData>({ ...options, method: 'PATCH', path, body });
  }

  put<TData>(
    path: string,
    body?: unknown,
    options: Omit<RequestOptions, 'method' | 'path' | 'body'> = {},
  ): Promise<AstroidResponse<TData>> {
    return this.request<TData>({ ...options, method: 'PUT', path, body });
  }

  delete<TData>(
    path: string,
    options: Omit<RequestOptions, 'method' | 'path'> = {},
  ): Promise<AstroidResponse<TData>> {
    return this.request<TData>({ ...options, method: 'DELETE', path });
  }

  /* ------------------------------- core loop ------------------------------ */

  /** Issue a request with retries, returning the unwrapped, typed response. */
  async request<TData>(options: RequestOptions): Promise<AstroidResponse<TData>> {
    const prepared = await this.prepare(options);
    const contextRetry = prepared.options.context?._retryConfig as RetryConfig | undefined;
    const contextOptions = prepared.options.context?._retryOptions as
      | RetryMiddlewareOptions
      | undefined;
    const retry = contextRetry !== undefined ? contextRetry : this.config.retry;
    const maxAttempts = retry && prepared.retryable ? retry.maxRetries + 1 : 1;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const raw = await this.send(prepared);
        await this.middleware.applyResponse(raw, prepared);

        if (raw.status >= 200 && raw.status < 300) {
          return this.unwrap<TData>(raw);
        }

        // Intercept 401 Unauthorized for automatic token refresh and request replay
        if (
          raw.status === 401 &&
          !prepared.options.context?._is401Retry &&
          !prepared.url.includes('/auth/refresh') &&
          !prepared.url.includes('/auth/login') &&
          !prepared.url.includes('/auth/register')
        ) {
          prepared.options.context = { ...prepared.options.context, _is401Retry: true };
          let refreshed = false;

          // Priority 1: re-evaluate the dynamic token provider.
          if (this.tokenProvider) {
            this.pendingTokenPromise = undefined;
            try {
              const newToken = await this.tokenProvider();
              this.config.auth.accessToken = newToken;
              refreshed = true;
            } catch {
              // Provider failed — fall through to the handler below.
            }
          }

          // Priority 2: session-based / custom 401 handler.
          if (!refreshed && this.on401Handler) {
            refreshed = await this.on401Handler(prepared);
          }

          if (refreshed) {
            if (this.config.auth.accessToken) {
              prepared.headers['authorization'] = `Bearer ${this.config.auth.accessToken}`;
            }
            const retriedRaw = await this.send(prepared);
            await this.middleware.applyResponse(retriedRaw, prepared);
            if (retriedRaw.status >= 200 && retriedRaw.status < 300) {
              return this.unwrap<TData>(retriedRaw);
            }
            const retryError = this.toError(retriedRaw);
            await this.middleware.applyError(retryError, prepared);
            throw retryError;
          }
        }

        // Non-2xx: decide whether to retry, otherwise throw a typed error.
        const error = this.toError(raw);
        await this.middleware.applyError(error, prepared);
        // Resolve the retryable-status predicate. Precedence:
        //   1. a custom predicate supplied to the retry middleware,
        //   2. an explicit `retryableStatusCodes` list (per-request or global),
        //   3. the SDK-wide default (`429` + any `5xx`).
        const statusCodes = contextOptions?.retryableStatusCodes ?? retry?.retryableStatusCodes;
        const shouldRetryStatus =
          contextOptions?.shouldRetryStatus ??
          (statusCodes
            ? (status: number) => statusCodes.includes(status)
            : isRetryableStatus);
        if (retry && prepared.retryable && attempt < maxAttempts && shouldRetryStatus(raw.status)) {
          lastError = error;
          const delay = this.retryDelay(attempt, raw, retry);
          if (contextOptions?.onRetry) {
            contextOptions.onRetry(attempt, error, delay, prepared);
          }
          await sleep(delay, prepared.signal);
          continue;
        }
        throw error;
      } catch (err) {
        if (isAbortError(err)) throw err;
        // Transport-level failure (DNS, reset, timeout): retry if allowed.
        //
        // Errors that carry an HTTP status were already given their retry
        // decision by the non-2xx branch above, so they propagate untouched.
        // Status-less typed errors (i.e. no response was ever received) such as
        // `AstroidTimeoutError` are transient transport failures and must go
        // through the same backoff as a raw `TypeError` would.
        if (isAstroidErrorLike(err)) {
          const typed = err as AstroidError;
          if (!isTransportFailure(typed)) throw typed;
          if (retry && prepared.retryable && attempt < maxAttempts) {
            lastError = typed;
            const delay = backoffDelay(attempt, retry);
            if (contextOptions?.onRetry) {
              contextOptions.onRetry(attempt, typed, delay, prepared);
            }
            await sleep(delay, prepared.signal);
            continue;
          }
          await this.middleware.applyError(typed, prepared);
          throw typed;
        }
        const networkError = toNetworkError(err);
        if (retry && prepared.retryable && attempt < maxAttempts) {
          lastError = networkError;
          const delay = backoffDelay(attempt, retry);
          if (contextOptions?.onRetry) {
            contextOptions.onRetry(attempt, networkError, delay, prepared);
          }
          await sleep(delay, prepared.signal);
          continue;
        }
        await this.middleware.applyError(networkError, prepared);
        throw networkError;
      }
    }
    // Exhausted retries.
    await this.middleware.applyError(lastError, prepared);
    throw lastError instanceof Error ? lastError : toNetworkError(lastError);
  }

  /* ------------------------------- internals ------------------------------ */

  /** Build the fully-prepared request (auth, headers, body, url). */
  private async prepare(options: RequestOptions): Promise<PreparedRequest> {
    const { auth, headers: baseHeaders, timeoutMs } = this.config;
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': `astroid-sdk/${SDK_VERSION}`,
      ...baseHeaders,
      ...(options.headers ?? {}),
    };

    // Resolve the access token (dynamic provider or static value).
    const resolvedToken = await this.resolveToken();
    if (resolvedToken) {
      headers['authorization'] = `Bearer ${resolvedToken}`;
    } else if (auth.apiKey) {
      headers['authorization'] = `Bearer ${auth.apiKey}`;
    }
    if (options.idempotencyKey) {
      headers['idempotency-key'] = options.idempotencyKey;
    }

    let body: string | undefined;
    if (options.body !== undefined && options.method !== 'GET') {
      body = JSON.stringify(options.body);
      headers['content-type'] = 'application/json';
    }

    const retryable =
      options.retryable ??
      (IDEMPOTENT_METHODS.has(options.method) || Boolean(options.idempotencyKey));

    const prepared: PreparedRequest = {
      method: options.method,
      url: buildUrl(this.config.baseUrl, this.config.apiVersion, options.path, options.query),
      headers,
      body,
      timeoutMs: options.timeoutMs ?? timeoutMs,
      retryable,
      signal: options.signal,
      options,
    };
    return this.middleware.applyRequest(prepared);
  }

  /** Perform one transport round-trip with a timeout. */
  private async send(req: PreparedRequest): Promise<RawResponse> {
    // Caller already aborted before the request was dispatched.
    if (req.signal?.aborted) {
      throw abortError(req.signal.reason);
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, req.timeoutMs);
    const onExternalAbort = (): void => controller.abort();
    req.signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const response = await this.config.fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      });
      const requestId = response.headers.get('x-request-id') ?? undefined;
      const parsed = await this.parseBody(response);
      return { status: response.status, headers: response.headers, body: parsed, requestId };
    } catch (error) {
      if (timedOut) throw new AstroidTimeoutError(req.timeoutMs);
      throw error;
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  /** Parse a JSON body, tolerating empty (204) and non-JSON responses. */
  private async parseBody(response: Response): Promise<unknown> {
    if (response.status === 204) return undefined;
    const text = await response.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  /** Unwrap a success envelope `{ success, data, meta, requestId }`. */
  private unwrap<TData>(raw: RawResponse): AstroidResponse<TData> {
    const envelope = raw.body as
      | {
          success?: boolean;
          data?: TData;
          meta?: AstroidResponse<TData>['meta'];
          requestId?: string;
        }
      | undefined;
    const requestId = envelope?.requestId ?? raw.requestId;
    // Support both enveloped and bare payloads for resilience.
    const data = (envelope && 'data' in envelope ? envelope.data : (raw.body as TData)) as TData;
    return {
      data,
      meta: envelope?.meta,
      requestId,
      status: raw.status,
      headers: raw.headers,
    };
  }

  /** Convert a non-2xx raw response into a typed `AstroidError`. */
  private toError(raw: RawResponse): AstroidError {
    const envelope = raw.body as { error?: ApiError; requestId?: string } | undefined;
    const requestId = envelope?.requestId ?? raw.requestId;
    if (envelope?.error) {
      return fromApiError(envelope.error, { status: raw.status, requestId });
    }
    return fromStatus(raw.status, `Request failed with status ${raw.status}`, { requestId });
  }

  /** Honour `Retry-After` (seconds) on 429s, else exponential backoff. */
  private retryDelay(
    attempt: number,
    raw: RawResponse,
    retry: RetryConfig | null = this.config.retry,
  ): number {
    if (!retry) return 0;
    if (raw.status === 429) {
      const header = raw.headers.get('retry-after');
      const seconds = header ? Number(header) : NaN;
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, retry.maxDelayMs);
      }
    }
    return backoffDelay(attempt, retry);
  }
}

/** Whether an unknown value is a DOMException-style abort. */
function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === 'AbortError';
}

/** Build a DOM-compatible abort error regardless of runtime. */
function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  // eslint-disable-next-line no-restricted-globals
  return typeof DOMException !== 'undefined'
    ? new DOMException('The request was aborted.', 'AbortError')
    : new Error('The request was aborted.');
}

/** Loose check: was this error already produced by our error layer? */
function isAstroidErrorLike(value: unknown): boolean {
  return value instanceof Error && 'code' in value && 'isRetryable' in value;
}

/**
 * Whether a typed error is a transport-level failure — no HTTP response was
 * ever received, so the request may still succeed on a later attempt.
 *
 * `AstroidTimeoutError` is the canonical example. Errors mapped from a non-2xx
 * response carry an HTTP `status` and have already had their retry decision
 * made against `isRetryableStatus`, so they are excluded here.
 */
function isTransportFailure(error: AstroidError): boolean {
  return error.status === undefined && error.isRetryable;
}

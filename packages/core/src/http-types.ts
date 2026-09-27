/**
 * Request/response primitives and the middleware pipeline for the HTTP client.
 */

import type { ApiError, ResponseMeta } from '@astroid/types';

/** HTTP methods the SDK issues. */
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** A query-string value the client knows how to serialise. */
export type QueryValue = string | number | boolean | null | undefined | Array<string | number>;

/** Options for a single API request (before defaults/auth are applied). */
export interface RequestOptions {
  method: HttpMethod;
  /** Path relative to the versioned base, e.g. `/wallets` or `/wallets/:id`. */
  path: string;
  /** Query parameters; `undefined`/`null` values are dropped. */
  query?: Record<string, QueryValue>;
  /** JSON request body (serialised by the client). */
  body?: unknown;
  /** Per-request header overrides. */
  headers?: Record<string, string>;
  /** Per-request timeout override in ms. */
  timeoutMs?: number;
  /** Idempotency key for safe retries of POSTs. */
  idempotencyKey?: string;
  /** When false, this request is never retried. Defaults to method-based. */
  retryable?: boolean;
  /** An optional caller-supplied abort signal. */
  signal?: AbortSignal;
  /** Free-form context available to middleware (never sent). */
  context?: Record<string, unknown>;
  /**
   * Optional caller-supplied correlation / request ID. When omitted the
   * correlation middleware generates a UUID v4 automatically.
   */
  correlationId?: string;
  /**
   * Optional caller-supplied request ID, sent as the `X-Request-ID` header.
   * When omitted, falls back to {@link correlationId} and then to a generated
   * UUID v4 (issue #255).
   */
  requestId?: string;
}

/** A fully-prepared request as seen by middleware and the transport. */
export interface PreparedRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
  timeoutMs: number;
  retryable: boolean;
  signal: AbortSignal | undefined;
  /** Echo of the original options, for middleware inspection. */
  options: RequestOptions;
}

/** The raw result of a transport round-trip, pre-envelope-unwrapping. */
export interface RawResponse {
  status: number;
  headers: Headers;
  /** The parsed JSON body, or `undefined` for empty (204) responses. */
  body: unknown;
  requestId: string | undefined;
}

/** A successful, envelope-unwrapped response returned to resource methods. */
export interface AstroidResponse<TData> {
  data: TData;
  meta: ResponseMeta | undefined;
  requestId: string | undefined;
  status: number;
  headers: Headers;
}

/** The `error` object plus transport context, used to build typed errors. */
export interface ErrorPayload {
  apiError: ApiError | undefined;
  status: number;
  requestId: string | undefined;
}

/**
 * Middleware observes and can augment requests/responses. Each hook is optional
 * and awaited in registration order (`onResponse`/`onError` run in reverse, like
 * an onion) so cross-cutting concerns compose predictably.
 */
export interface Middleware {
  name?: string;
  /** Mutate/replace the prepared request before it is sent. */
  onRequest?: (req: PreparedRequest) => PreparedRequest | Promise<PreparedRequest>;
  /** Observe a raw response before it is unwrapped. */
  onResponse?: (res: RawResponse, req: PreparedRequest) => void | Promise<void>;
  /** Observe an error before it propagates. */
  onError?: (error: unknown, req: PreparedRequest) => void | Promise<void>;
}

/** Runs the registered middleware around a transport call. */
export class MiddlewareStack {
  private readonly middlewares: Middleware[] = [];

  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /** Apply every `onRequest` hook in order. */
  async applyRequest(req: PreparedRequest): Promise<PreparedRequest> {
    let current = req;
    for (const mw of this.middlewares) {
      if (mw.onRequest) current = await mw.onRequest(current);
    }
    return current;
  }

  /** Apply every `onResponse` hook in reverse order. */
  async applyResponse(res: RawResponse, req: PreparedRequest): Promise<void> {
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const mw = this.middlewares[i];
      if (mw?.onResponse) await mw.onResponse(res, req);
    }
  }

  /** Apply every `onError` hook in reverse order. */
  async applyError(error: unknown, req: PreparedRequest): Promise<void> {
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const mw = this.middlewares[i];
      if (mw?.onError) await mw.onError(error, req);
    }
  }
}

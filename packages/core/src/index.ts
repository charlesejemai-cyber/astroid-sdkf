/**
 * `@astroid/core` — the transport foundation of the Astroid SDK.
 *
 * Everything higher up (resources, the client, the CLI) is built on the
 * `HttpClient`, the middleware pipeline, the pagination iterator and the offline
 * queue exported here. This package holds no domain knowledge.
 *
 * @packageDocumentation
 */

export { HttpClient, SDK_VERSION } from './http-client.js';
export { AstroidTimeoutError } from './timeout-error.js';
export {
  resolveConfig,
  DEFAULT_BASE_URL,
  type AstroidClientConfig,
  type ResolvedConfig,
  type AuthConfig,
  type RetryConfig,
  type RateLimitConfig,
  type TelemetryHooks,
  type TelemetryRequestInfo,
  type TelemetryResponseInfo,
} from './config.js';
export {
  MiddlewareStack,
  type HttpMethod,
  type QueryValue,
  type RequestOptions,
  type PreparedRequest,
  type RawResponse,
  type AstroidResponse,
  type ErrorPayload,
  type Middleware,
} from './http-types.js';
export { Resource, type ListRequestOptions, type RequestOptionsExtras } from './resource.js';
export { buildUrl, buildQueryString } from './url.js';
export { backoffDelay, isRetryableStatus, sleep } from './backoff.js';
export {
  paginate,
  paginateCursor,
  normalizeCursorPage,
  collect,
  MAX_CURSOR_PAGES,
  type PageFetcher,
  type CursorPageFetcher,
  type PaginateCursorOptions,
  type CursorPage,
} from './pagination.js';
export {
  OfflineQueue,
  MemoryQueueStorage,
  type QueueStorage,
  type QueuedRequest,
  type QueueReplayer,
} from './offline-queue.js';
export {
  loggingMiddleware,
  headerMiddleware,
  createRetryMiddleware,
  retryMiddleware,
  redactHeaders,
  type LogEntry,
  type LogSink,
  type RetryMiddlewareOptions,
} from './middleware.js';
export * from './errors.js';

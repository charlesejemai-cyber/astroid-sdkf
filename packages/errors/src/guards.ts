/**
 * `@astroid/errors` — runtime type guards for the error hierarchy.
 *
 * Consumers frequently receive errors across a trust boundary (an HTTP handler,
 * a queue worker, a `catch` block around a plugin) where narrowing with
 * `instanceof` alone is awkward or unsafe. These guards give a single,
 * well-named predicate per error category so `catch` blocks can branch on the
 * failure without string-matching messages.
 *
 * All guards accept `unknown` and narrow to the specific class, so they compose
 * cleanly with `catch (err)` blocks and satisfy TypeScript's control flow:
 *
 * ```ts
 * try {
 *   await agent.transactions.create(input);
 * } catch (err) {
 *   if (isRateLimitError(err)) {
 *     await sleep(err.retryAfter ?? 1);
 *     return retry();
 *   }
 *   if (isPolicyViolationError(err)) {
 *     return { blocked: true, reason: err.code };
 *   }
 *   throw err;
 * }
 * ```
 *
 * @module
 */

import { AstroidError } from './base.js';
import {
  AuthenticationError,
  ConflictError,
  ForbiddenError,
  InsufficientFundsError,
  InternalServerError,
  NetworkError,
  NotFoundError,
  PolicyViolationError,
  RateLimitError,
  ValidationError,
} from './classes.js';

/**
 * Type guard: is this value an error thrown by the Astroid SDK?
 *
 * Matches {@link AstroidError} and every subclass, but *not* plain `Error`,
 * `TypeError`, DOM exceptions, or arbitrary look-alikes.
 *
 * @example
 * ```ts
 * if (isAstroidError(err)) {
 *   console.error(err.code, err.status, err.requestId);
 * }
 * ```
 */
export function isAstroidError(value: unknown): value is AstroidError {
  return value instanceof AstroidError;
}

/** 401 — missing/invalid credentials, expired token, or invalid API key. */
export function isAuthenticationError(value: unknown): value is AuthenticationError {
  return value instanceof AuthenticationError;
}

/** 403 — authenticated but not permitted. `AuthorizationError` is the same class. */
export function isForbiddenError(value: unknown): value is ForbiddenError {
  return value instanceof ForbiddenError;
}

/** 400/422 — request failed schema or business validation. */
export function isValidationError(value: unknown): value is ValidationError {
  return value instanceof ValidationError;
}

/** 404 — the requested resource does not exist. */
export function isNotFoundError(value: unknown): value is NotFoundError {
  return value instanceof NotFoundError;
}

/** 409 — the request conflicts with the current resource state. */
export function isConflictError(value: unknown): value is ConflictError {
  return value instanceof ConflictError;
}

/**
 * A transaction was blocked because it violates one or more spending policies.
 *
 * Note this is a *rejection with a reason* — the API reports policy decisions
 * as successful responses carrying `allowed: false`, so this error only
 * surfaces when a hard policy violation is raised.
 */
export function isPolicyViolationError(value: unknown): value is PolicyViolationError {
  return value instanceof PolicyViolationError;
}

/** The source account lacks sufficient funds. */
export function isInsufficientFundsError(value: unknown): value is InsufficientFundsError {
  return value instanceof InsufficientFundsError;
}

/**
 * 429 — the caller exceeded a rate limit and should back off.
 *
 * Always retryable; inspect `error.retryAfter` (seconds) for the
 * server-advised delay, which {@link toAstroidError} also derives from the
 * standard `Retry-After` header when the body does not supply it.
 *
 * @example
 * ```ts
 * if (isRateLimitError(err)) {
 *   await sleep((err.retryAfter ?? 1) * 1000);
 * }
 * ```
 */
export function isRateLimitError(value: unknown): value is RateLimitError {
  return value instanceof RateLimitError;
}

/** A transport-level failure: DNS, connection reset, offline, or timeout. */
export function isNetworkError(value: unknown): value is NetworkError {
  return value instanceof NetworkError;
}

/** 5xx — the API failed to handle a valid request. `ServerError` is the same class. */
export function isServerError(value: unknown): value is InternalServerError {
  return value instanceof InternalServerError;
}

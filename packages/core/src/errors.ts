/**
 * `@astroid/core` — normalized, typed error hierarchy.
 *
 * The SDK funnels every failure through a single {@link AstroidError} base
 * class so consumers never have to inspect a generic `Error` or parse a raw
 * JSON string. The concrete subclasses (`AuthenticationError`,
 * `ValidationError`, `RateLimitError`, `ServerError`, …) each carry structured
 * `statusCode` / `errorCode` / `details` fields.
 *
 * The implementation lives in the shared `@astroid/errors` module (the
 * "designated shared core module") and is re-exported here so that everything
 * built on `@astroid/core` can import the full hierarchy from one entry point
 * without reaching across package boundaries.
 *
 * Two names, two meanings, no overlap:
 * - {@link toAstroidError} — build a typed error from a failed HTTP `Response`.
 * - {@link asAstroidError} — coerce an arbitrary caught value into an `AstroidError`.
 *
 * @module
 */

import { AstroidError, isAstroidError, toAstroidError } from '@astroid/errors';

export {
  AstroidError,
  type AstroidErrorOptions,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  NotFoundError,
  ConflictError,
  PolicyViolationError,
  InsufficientFundsError,
  AstroidInsufficientFundsError,
  AstroidPolicyViolationError,
  BudgetExceededError,
  ApprovalRequiredError,
  RateLimitError,
  NetworkError,
  ServerError,
  AstroidApiError,
  AstroidValidationError,
  AstroidNetworkError,
  isAstroidError,
  isRateLimitError,
  isPolicyViolationError,
  isValidationError,
  errorClassForCode,
  codeForStatus,
  fromApiError,
  fromStatus,
  toNetworkError,
  toAstroidError,
  fromErrorResponse,
  type NormalizeErrorContext,
} from '@astroid/errors';

/**
 * Safely parse a non-2xx `Response` into the matching typed {@link AstroidError}.
 *
 * Unlike {@link fromErrorResponse} (which always throws), this helper returns
 * the constructed error so callers can log it, attach it to a result, or throw
 * it themselves. The response body is read exactly once and never assumed to be
 * valid JSON: an absent or malformed body falls back to a status-derived error.
 *
 * Thin wrapper over the canonical {@link toAstroidError} factory in
 * `@astroid/errors`, so envelope parsing has one implementation across the SDK.
 *
 * @param response The non-2xx `Response` to normalise.
 * @returns A typed `AstroidError` carrying `statusCode`, `errorCode`, and the
 *   parsed `details`.
 *
 * @example
 * ```ts
 * const res = await fetch('/api/wallets');
 * if (!res.ok) {
 *   const err = await parseErrorResponse(res);
 *   if (err instanceof AuthenticationError) redirectToLogin();
 * }
 * ```
 */
export function parseErrorResponse(response: Response): Promise<AstroidError> {
  return toAstroidError(response);
}

/**
 * Coerce any thrown value into an {@link AstroidError}.
 *
 * `Error` instances that are already part of the Astroid hierarchy are returned
 * unchanged; everything else is wrapped in a generic `AstroidError` with the
 * original value preserved as `cause`, so `catch (err)` blocks always receive a
 * structured, serialisable error.
 *
 * This is a *catch-block* helper. To build an error from a failed HTTP
 * `Response`, use {@link toAstroidError} — a single name per meaning across the
 * SDK.
 *
 * @param value The value caught in a `catch` block.
 * @returns An `AstroidError` (possibly the input itself).
 */
export function asAstroidError(value: unknown): AstroidError {
  if (isAstroidError(value)) return value;

  const message =
    value instanceof Error ? value.message : typeof value === 'string' ? value : 'Unknown error';

  return new AstroidError(message, { code: 'UNKNOWN_ERROR', cause: value });
}

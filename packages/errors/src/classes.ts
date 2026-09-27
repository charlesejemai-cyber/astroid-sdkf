/**
 * `@astroid/errors` — specialized HTTP/API error classes.
 *
 * Lives in its own module so both the package entrypoint, the status/code mapper
 * (`mapper.ts`), and the Stellar domain-error module (`stellar.ts`) can import
 * the classes without circular imports.
 *
 * @module
 */

import { ApiErrorCode } from '@astroid/types';
import { AstroidError } from './base.js';

/** 401 — missing/invalid credentials, expired token, or invalid API key. */
export class AuthenticationError extends AstroidError {}

/** 403 — authenticated but not permitted. */
export class ForbiddenError extends AstroidError {}

/** 403 — authenticated but not permitted (alias for ForbiddenError). */
export const AuthorizationError = ForbiddenError;
export type AuthorizationError = ForbiddenError;

/** 400/422 — request failed schema or business validation. */
export class ValidationError extends AstroidError {
  /** Field-level validation issues, when the API provides them. */
  get fieldErrors(): Record<string, string[]> | undefined {
    return (this.details?.fields ?? this.details?.validationErrors) as
      | Record<string, string[]>
      | undefined;
  }
}

/** 404 — the requested resource does not exist. */
export class NotFoundError extends AstroidError {}

/** 409 — the request conflicts with the current resource state. */
export class ConflictError extends AstroidError {}

/** A transaction was blocked because it violates one or more spending policies. */
export class PolicyViolationError extends AstroidError {}

/** A transaction was blocked because the source account lacks sufficient funds. */
export class InsufficientFundsError extends AstroidError {}

/** A transaction was blocked because it would exceed an available budget. */
export class BudgetExceededError extends AstroidError {}

/** A transaction requires human approval before it can execute. */
export class ApprovalRequiredError extends AstroidError {}

/** 429 — rate limit exceeded. Inspect `retryAfter` before retrying. */
export class RateLimitError extends AstroidError {
  /** Seconds to wait before retrying, from the `Retry-After` header if present. */
  get retryAfter(): number | undefined {
    const value = this.details?.retryAfter;
    return typeof value === 'number' ? value : undefined;
  }

  override get isRetryable(): boolean {
    return true;
  }
}

/** A transport-level failure: DNS, connection reset, offline, or timeout. */
export class NetworkError extends AstroidError {
  override get isRetryable(): boolean {
    return true;
  }
}

/** 5xx — the API failed to handle a valid request. */
export class InternalServerError extends AstroidError {
  override get isRetryable(): boolean {
    return true;
  }
}

/** Alias for InternalServerError — 5xx server-side failure. */
export const ServerError = InternalServerError;
export type ServerError = InternalServerError;

/* -------------------------------------------------------------------------- */
/* API error code → error class                                                */
/* -------------------------------------------------------------------------- */

/**
 * Horizon/Stellar result codes that sometimes leak through the API as if they
 * were Astroid error codes. They describe the same condition as the SDK's
 * insufficient-funds errors, so they resolve to the same class.
 */
const LEAKED_STELLAR_FUNDS_CODES: ReadonlySet<string> = new Set([
  'op_underfunded',
  'op_low_reserve',
  'tx_insufficient_balance',
]);

/**
 * Map an API error code to its concrete error class.
 *
 * This is the single place where an API error code becomes a class, so the
 * status-based mapper, the response factory, and the client middleware can never
 * drift apart on which failure maps to which class.
 *
 * Unrecognised codes fall back to the base {@link AstroidError} — the caller
 * still gets `code` and `status` set, just no specialised class.
 *
 * @example
 * ```ts
 * errorClassForCode('POLICY_VIOLATION'); // → PolicyViolationError
 * errorClassForCode('SOMETHING_NEW');    // → AstroidError
 * ```
 */
export function errorClassForCode(code: string): typeof AstroidError {
  switch (code) {
    case ApiErrorCode.AUTHENTICATION_ERROR:
    case ApiErrorCode.UNAUTHORIZED:
    case ApiErrorCode.INVALID_API_KEY:
    case ApiErrorCode.TOKEN_EXPIRED:
      return AuthenticationError;
    case ApiErrorCode.FORBIDDEN:
      return ForbiddenError;
    case ApiErrorCode.VALIDATION_ERROR:
    case ApiErrorCode.BAD_REQUEST:
      return ValidationError;
    case ApiErrorCode.NOT_FOUND:
      return NotFoundError;
    case ApiErrorCode.CONFLICT:
      return ConflictError;
    case ApiErrorCode.POLICY_VIOLATION:
    case ApiErrorCode.POLICY_REJECTED:
    case ApiErrorCode.RISK_THRESHOLD_EXCEEDED:
      return PolicyViolationError;
    case ApiErrorCode.BUDGET_EXCEEDED:
      return BudgetExceededError;
    case ApiErrorCode.INSUFFICIENT_FUNDS:
    case ApiErrorCode.INSUFFICIENT_BALANCE:
    case ApiErrorCode.WALLET_FROZEN:
      return InsufficientFundsError;
    case ApiErrorCode.APPROVAL_REQUIRED:
      return ApprovalRequiredError;
    case ApiErrorCode.RATE_LIMITED:
      return RateLimitError;
    case ApiErrorCode.NETWORK_ERROR:
    case ApiErrorCode.TIMEOUT:
      return NetworkError;
    case ApiErrorCode.INTERNAL_ERROR:
    case ApiErrorCode.SERVICE_UNAVAILABLE:
      return InternalServerError;
    default:
      return LEAKED_STELLAR_FUNDS_CODES.has(code) ? InsufficientFundsError : AstroidError;
  }
}

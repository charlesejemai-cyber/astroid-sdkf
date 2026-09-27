/**
 * `@astroid/errors` — HTTP status/response-to-error mapping utilities.
 *
 * This module is the bridge between raw HTTP failures and the typed Astroid
 * error hierarchy. It maps HTTP response status codes — and, when available,
 * the parsed error envelope from the response body — into the correct
 * specialized error subclass so consumers can branch on `instanceof` instead
 * of string-matching error messages.
 *
 * Mapping rules (checked in priority order):
 *
 * 1. **API error code** — when the response body contains
 *    `{ error: { code, message, details } }`, the machine-readable code wins.
 *    Codes are resolved through {@link errorClassForCode}.
 * 2. **HTTP status** — when no usable code is present, the status code alone
 *    determines the error class via {@link errorClassForStatus}.
 * 3. **Fallback** — anything unrecognized becomes a base {@link AstroidError}.
 *
 * @example
 * ```ts
 * import { mapStatusToError } from '@astroid/errors';
 *
 * // Status only:
 * mapStatusToError(404, 'Wallet not found');
 * // → NotFoundError with code 'NOT_FOUND', statusCode 404
 *
 * // Status + envelope:
 * mapStatusToError(429, 'Slow down', {
 *   body: { error: { code: 'RATE_LIMITED', message: 'Slow down', details: { retryAfter: 30 } } },
 * });
 * // → RateLimitError with retryAfter === 30
 * ```
 *
 * @module
 */

import { ApiErrorCode, type ApiError } from '@astroid/types';
import { AstroidError, type AstroidErrorOptions } from './base.js';
import {
  AuthenticationError,
  ConflictError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  errorClassForCode,
} from './classes.js';

/* -------------------------------------------------------------------------- */
/* HTTP status → error class                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Map an HTTP response status code to the specialized error class that best
 * represents it. Used as the fallback when the response body carries no
 * machine-readable error code.
 *
 * @example
 * ```ts
 * errorClassForStatus(403); // → ForbiddenError
 * errorClassForStatus(429); // → RateLimitError
 * errorClassForStatus(500); // → InternalServerError
 * errorClassForStatus(418); // → AstroidError (no more specific class applies)
 * ```
 */
export function errorClassForStatus(status: number): typeof AstroidError {
  if (status === 401) return AuthenticationError;
  if (status === 403) return ForbiddenError;
  if (status === 404) return NotFoundError;
  if (status === 409) return ConflictError;
  if (status === 400 || status === 422) return ValidationError;
  if (status === 429) return RateLimitError;
  if (status >= 500) return InternalServerError;
  return AstroidError;
}

/**
 * Infer a machine-readable error code from an HTTP status when the API did not
 * supply one (e.g. a bare 502 from a proxy). Always returns a valid
 * {@link ApiErrorCode}-style string so errors remain consistently typed.
 */
export function statusCodeToCode(status: number): string {
  if (status === 401) return ApiErrorCode.AUTHENTICATION_ERROR;
  if (status === 403) return ApiErrorCode.FORBIDDEN;
  if (status === 404) return ApiErrorCode.NOT_FOUND;
  if (status === 409) return ApiErrorCode.CONFLICT;
  if (status === 400 || status === 422) return ApiErrorCode.VALIDATION_ERROR;
  if (status === 429) return ApiErrorCode.RATE_LIMITED;
  if (status >= 500) return ApiErrorCode.INTERNAL_ERROR;
  return ApiErrorCode.BAD_REQUEST;
}

/* -------------------------------------------------------------------------- */
/* Envelope extraction                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The minimal error-envelope shapes {@link mapStatusToError} understands in a
 * response body.
 */
export interface ErrorEnvelopeInput {
  /** Body of the failed HTTP response, if it could be read/parsed. */
  body?: unknown;
  /** Value of the `x-request-id` response header, when present. */
  requestId?: string;
  /** Extra structured detail to merge into the built error. */
  details?: Record<string, unknown>;
  /** Underlying cause (e.g. the original transport failure). */
  cause?: unknown;
}

/**
 * A non-empty, non-whitespace string, or `undefined`.
 *
 * Error envelopes are assembled by several different services and proxies, and
 * a blank `code` or `message` is common in partial responses. Treating a blank
 * string as "absent" lets the mapping fall through to the HTTP status instead of
 * producing an error with an empty `code` and no message.
 */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** The `details` sub-object, when it is a plain object. */
function detailsObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return value as Record<string, unknown>;
}

/**
 * Locate the `{ code, message, details }` object in a response body.
 *
 * Accepts the standard envelope (`{ error: { code, message, details } }`) and a
 * flat top-level shape (`{ code, message }`). The resolved `code` is guaranteed
 * to be a non-empty string; the `message` is resolved separately by
 * {@link extractMessage} so a response with a valid code but a blank message
 * still maps to the right class instead of losing the code.
 */
function envelopeSource(body: unknown): { code: string; raw: Record<string, unknown> } | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const obj = body as Record<string, unknown>;

  const errorField = obj.error;
  if (typeof errorField === 'object' && errorField !== null) {
    const nested = errorField as Record<string, unknown>;
    const code = nonEmptyString(nested.code);
    if (code !== undefined) return { code, raw: nested };
  }
  const flatCode = nonEmptyString(obj.code);
  return flatCode !== undefined ? { code: flatCode, raw: obj } : undefined;
}

/**
 * Extract the `{ code, message, details }` API error from a response body.
 * Understands both the standard envelope (`{ error: { code, message } }`) and
 * a flat top-level shape (`{ code, message }`). Returns `undefined` when no
 * usable envelope is present.
 *
 * A blank `code` or `message` is treated as absent, so
 * `{ error: { code: '', message: '' } }` yields `undefined` and the caller maps
 * from the HTTP status — yielding a real code and message rather than two empty
 * strings.
 */
export function extractApiError(body: unknown): ApiError | undefined {
  const source = envelopeSource(body);
  if (!source) return undefined;
  const message = nonEmptyString(source.raw.message);
  if (message === undefined) return undefined;
  return { code: source.code, message, details: detailsObject(source.raw.details) };
}

/** Best-effort human-readable message extraction from a response body. */
function extractMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const obj = body as Record<string, unknown>;

  const errorField = obj.error;
  if (typeof errorField === 'object' && errorField !== null) {
    const msg = nonEmptyString((errorField as Record<string, unknown>).message);
    if (msg) return msg;
  }
  return (
    nonEmptyString(obj.message) ??
    nonEmptyString(obj.detail) ??
    nonEmptyString(obj.title) ??
    nonEmptyString(obj.error)
  );
}

/* -------------------------------------------------------------------------- */
/* Core mapping                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Map a failed HTTP response (status + optional body) to a strongly-typed
 * {@link AstroidError} subclass instance.
 *
 * Resolution order:
 * 1. A machine-readable error **code** from the body envelope (via
 *    {@link errorClassForCode}) — highest fidelity.
 * 2. The HTTP **status** code alone (via {@link errorClassForStatus}).
 * 3. The base {@link AstroidError} as a catch-all.
 *
 * The original `message` is always preserved, and diagnostic properties
 * (`statusCode`, `status`, `code`, `requestId`, `details`) are populated from
 * the response where available.
 *
 * @param status   The HTTP response status code.
 * @param message  A human-readable message; when omitted it is extracted from
 *                 the body, falling back to `Request failed with status <n>`.
 * @param context  Optional body / requestId / details / cause.
 * @returns The instantiated error — throw it, or inspect it programmatically.
 *
 * @example
 * ```ts
 * const err = mapStatusToError(403, 'Not allowed');
 * err instanceof AuthorizationError; // true
 * err.statusCode;                    // 403
 * ```
 */
export function mapStatusToError(
  status: number,
  message?: string,
  context: ErrorEnvelopeInput = {},
): AstroidError {
  // The code and the message are resolved independently: a response carrying a
  // valid code but a blank message must still map to the right class, and a
  // response with a message but no code still deserves that message.
  const source = envelopeSource(context.body);
  const resolvedMessage =
    message ?? extractMessage(context.body) ?? `Request failed with status ${status}`;

  // 1. Body code wins — it is the most specific signal.
  if (source) {
    const ErrorClass = errorClassForCode(source.code);
    const details = { ...detailsObject(source.raw.details), ...context.details };
    return new ErrorClass(resolvedMessage, {
      code: source.code,
      status,
      statusCode: status,
      requestId: context.requestId,
      details: Object.keys(details).length > 0 ? details : undefined,
      cause: context.cause,
    });
  }

  // 2. Status-only mapping.
  const ErrorClass = errorClassForStatus(status);
  return new ErrorClass(resolvedMessage, {
    code: statusCodeToCode(status),
    status,
    statusCode: status,
    requestId: context.requestId,
    details: context.details,
    cause: context.cause,
  });
}

/**
 * Convenience wrapper for building typed errors from a status alone, with an
 * explicit message. Equivalent to {@link mapStatusToError} without a body.
 */
export function errorFromStatus(
  status: number,
  message: string,
  context: Omit<ErrorEnvelopeInput, 'body'> = {},
): AstroidError {
  return mapStatusToError(status, message, context);
}

/**
 * Options shape accepted by class constructors across `@astroid/errors`.
 * Re-exported here so the mapper module is self-contained for consumers that
 * build errors manually.
 */
export type { AstroidErrorOptions };

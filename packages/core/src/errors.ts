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
 * @module
 */

import {
  AstroidError,
  codeForStatus,
  fromApiError,
  fromStatus,
  isAstroidError,
} from '@astroid/errors';

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
  errorClassForCode,
  codeForStatus,
  fromApiError,
  fromStatus,
  toNetworkError,
  fromErrorResponse,
  type NormalizeErrorContext,
} from '@astroid/errors';

/** Shape of the `error` envelope the Astroid REST API returns on failure. */
interface ApiErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Safely parse a non-2xx `Response` into the matching typed {@link AstroidError}.
 *
 * Unlike {@link fromErrorResponse} (which always throws), this helper returns
 * the constructed error so callers can log it, attach it to a result, or throw
 * it themselves. The response body is read exactly once and never assumed to be
 * valid JSON: an absent or malformed body falls back to a status-derived error.
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
export async function parseErrorResponse(response: Response): Promise<AstroidError> {
  const status = response.status;
  const requestId = response.headers.get('x-request-id') ?? undefined;

  let body: unknown;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : undefined;
  } catch {
    // Malformed / non-JSON bodies are expected from proxies and gateways.
    body = undefined;
  }

  const envelope = body as ApiErrorEnvelope | undefined;
  const apiError = envelope?.error;

  if (apiError) {
    return fromApiError(
      {
        // Empty-string codes/messages are treated as absent so we still derive a
        // meaningful class from the HTTP status.
        code: apiError.code ? apiError.code : codeForStatus(status),
        message: apiError.message ? apiError.message : `Request failed with status ${status}`,
        details: apiError.details,
      },
      { status, requestId },
    );
  }

  return fromStatus(status, `Request failed with status ${status}`, { requestId });
}

/**
 * Normalise any thrown value into an {@link AstroidError}.
 *
 * `Error` instances that are already part of the Astroid hierarchy are returned
 * unchanged; everything else is wrapped in a generic `AstroidError` with the
 * original value preserved as `cause`, so `catch (err)` blocks always receive a
 * structured, serialisable error.
 *
 * @param value The value caught in a `catch` block.
 * @returns An `AstroidError` (possibly the input itself).
 */
export function toAstroidError(value: unknown): AstroidError {
  if (isAstroidError(value)) return value;

  const message =
    value instanceof Error ? value.message : typeof value === 'string' ? value : 'Unknown error';

  return new AstroidError(message, { code: 'UNKNOWN_ERROR', cause: value });
}

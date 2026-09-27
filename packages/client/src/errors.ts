/**
 * `@astroid/client` — error response parser.
 *
 * Parses raw HTTP responses into typed error instances. Handles the three main
 * error categories the Astroid API returns:
 *
 * 1. **Standard API errors** — `{ error: { code, message, details } }` envelope
 * 2. **Validation errors** — array-style field validation payloads
 * 3. **Stellar Horizon errors** — Horizon-specific result codes
 *
 * @module
 */

import {
  AstroidError,
  AuthenticationError,
  ForbiddenError,
  ValidationError,
  NotFoundError,
  ConflictError,
  PolicyViolationError,
  BudgetExceededError,
  ApprovalRequiredError,
  RateLimitError,
  InternalServerError,
  type AstroidErrorOptions,
} from '@astroid/errors';
import type { ApiError } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Stellar Horizon error                                                       */
/* -------------------------------------------------------------------------- */

/**
 * An error originating from the Stellar Horizon server. Wraps Horizon-specific
 * result codes (`op_underfunded`, `tx_bad_seq`, etc.) so application code can
 * branch on them without parsing raw strings.
 */
export class StellarHorizonError extends AstroidError {
  /** The raw Stellar result code, e.g. `op_underfunded` or `tx_bad_seq`. */
  readonly stellarCode: string;
  /** The Horizon operation-level result code, if present. */
  readonly operationCode?: string;

  constructor(
    message: string,
    options: AstroidErrorOptions & {
      stellarCode: string;
      operationCode?: string;
    },
  ) {
    super(message, options);
    this.stellarCode = options.stellarCode;
    this.operationCode = options.operationCode;
  }
}

/* -------------------------------------------------------------------------- */
/* Parsed error result                                                         */
/* -------------------------------------------------------------------------- */

/** The structured result of parsing an HTTP error response. */
export interface ParsedError {
  /** The typed error instance ready to throw or inspect. */
  error: AstroidError;
  /** Whether the response body was successfully parsed as JSON. */
  parsed: boolean;
}

/* -------------------------------------------------------------------------- */
/* Known Stellar Horizon result codes                                           */
/* -------------------------------------------------------------------------- */

/**
 * Known Horizon operation result codes that map to distinct SDK errors. Unknown
 * codes still produce a `StellarHorizonError` but may carry a different status.
 */
const HORIZON_STATUS_MAP: Record<string, number> = {
  op_underfunded: 402,
  op_no_destination: 404,
  op_no_trust: 422,
  op_unauthorized: 403,
  op_bad_auth: 401,
  tx_bad_seq: 409,
  tx_bad_auth: 401,
  tx_too_late: 410,
  tx_fee_bump_failed_inner_tx: 422,
  tx_insufficient_balance: 402,
  tx_not_supported: 501,
};

/* -------------------------------------------------------------------------- */
/* Content-type helpers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Safely check if a content-type header indicates JSON without throwing on
 * malformed or missing values.
 */
function isJsonContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  // Split off parameters (charset, boundary, etc.) and trim
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return mime === 'application/json' || mime === 'application/hal+json';
}

/**
 * Safely extract the body text from a Response. Returns `undefined` if the
 * response has already been consumed or the body is empty.
 */
async function safeBodyText(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    return text || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Safely parse a JSON string. Returns `undefined` if parsing fails.
 */
function safeJsonParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* Stellar code detection                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Detect Stellar Horizon result codes from various payload shapes the Horizon
 * server may return. Returns `{ stellarCode, operationCode? }` or `undefined`.
 */
function detectStellarCode(
  body: unknown,
): { stellarCode: string; operationCode?: string } | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const obj = body as Record<string, unknown>;

  // Horizon uses `extras.result_codes` in its error envelope
  const extras = obj.extras as Record<string, unknown> | undefined;
  if (extras) {
    const resultCodes = extras.result_codes as Record<string, unknown> | undefined;
    if (resultCodes) {
      const transactionCode =
        typeof resultCodes.transaction === 'string' ? resultCodes.transaction : undefined;
      const operationCodes = resultCodes.operations as string[] | undefined;
      const opCode = operationCodes?.[0];
      const code = opCode ?? transactionCode;
      if (code) {
        return { stellarCode: code, operationCode: opCode };
      }
    }
  }

  // Alternative flat shapes: `result_code` / `stellarCode`
  const resultCode = typeof obj.result_code === 'string' ? obj.result_code : undefined;
  const stellarCode = typeof obj.stellarCode === 'string' ? obj.stellarCode : undefined;
  const code = resultCode ?? stellarCode;
  if (code) {
    return { stellarCode: code };
  }

  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Validation array detection                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Detect a validation-array payload (common in 400/422 responses) and normalise
 * it into field-level errors. Handles multiple payload shapes:
 *
 * - `{ errors: [{ field, message }] }` — array of field-level objects
 * - `{ validationErrors: [{ field, message }] }` — alternate key
 * - `{ error: { details: { fields: { [key]: [messages] } } } }` — pre-mapped
 * - `{ error: { details: { validationErrors: [...] } } }` — nested
 */
function extractFieldErrors(body: unknown): Record<string, string[]> | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const obj = body as Record<string, unknown>;

  // 1. Top-level `errors` array
  const errors = Array.isArray(obj.errors) ? obj.errors : undefined;
  if (errors && errors.length > 0) {
    const fields: Record<string, string[]> = {};
    for (const entry of errors) {
      if (typeof entry === 'object' && entry !== null) {
        const e = entry as Record<string, unknown>;
        const field =
          typeof e.field === 'string' ? e.field : typeof e.path === 'string' ? e.path : undefined;
        const message = typeof e.message === 'string' ? e.message : String(e);
        if (field) {
          (fields[field] ??= []).push(message);
        }
      }
    }
    if (Object.keys(fields).length > 0) return fields;
  }

  // 2. Top-level `validationErrors` array
  const validationErrors = Array.isArray(obj.validationErrors) ? obj.validationErrors : undefined;
  if (validationErrors && validationErrors.length > 0) {
    const fields: Record<string, string[]> = {};
    for (const entry of validationErrors) {
      if (typeof entry === 'object' && entry !== null) {
        const e = entry as Record<string, unknown>;
        const field =
          typeof e.field === 'string' ? e.field : typeof e.path === 'string' ? e.path : undefined;
        const message = typeof e.message === 'string' ? e.message : String(e);
        if (field) {
          (fields[field] ??= []).push(message);
        }
      }
    }
    if (Object.keys(fields).length > 0) return fields;
  }

  // 3. Pre-mapped `error.details.fields`
  const errorEnvelope =
    typeof obj.error === 'object' && obj.error !== null
      ? (obj.error as Record<string, unknown>)
      : undefined;
  if (errorEnvelope) {
    const details =
      typeof errorEnvelope.details === 'object' && errorEnvelope.details !== null
        ? (errorEnvelope.details as Record<string, unknown>)
        : undefined;

    if (details?.fields && typeof details.fields === 'object') {
      return details.fields as Record<string, string[]>;
    }

    // Nested validationErrors in error.details
    const nestedValidation = Array.isArray(details?.validationErrors)
      ? details!.validationErrors
      : undefined;
    if (nestedValidation && nestedValidation.length > 0) {
      const fields: Record<string, string[]> = {};
      for (const entry of nestedValidation) {
        if (typeof entry === 'object' && entry !== null) {
          const e = entry as Record<string, unknown>;
          const field =
            typeof e.field === 'string' ? e.field : typeof e.path === 'string' ? e.path : undefined;
          const message = typeof e.message === 'string' ? e.message : String(e);
          if (field) {
            (fields[field] ??= []).push(message);
          }
        }
      }
      if (Object.keys(fields).length > 0) return fields;
    }
  }

  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Core parser                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Parse an HTTP error response into a typed `AstroidError`.
 *
 * This is the main entry point for error parsing. It inspects the content-type,
 * safely parses the JSON body, detects Stellar Horizon codes and validation
 * arrays, and returns the most specific error class available.
 *
 * @param response  The raw fetch `Response` object.
 * @param bodyText  Optional pre-read body text. If omitted, reads from the
 *                  response (consuming the body).
 * @returns A `ParsedError` with the typed error and whether parsing succeeded.
 *
 * @example
 * ```ts
 * const raw = await fetch(url, init);
 * if (!raw.ok) {
 *   const { error } = await parseErrorResponse(raw);
 *   throw error;
 * }
 * ```
 */
export async function parseErrorResponse(
  response: Response,
  bodyText?: string,
): Promise<ParsedError> {
  const status = response.status;
  const requestId = response.headers.get('x-request-id') ?? undefined;
  const contentType = response.headers.get('content-type');

  // If no pre-read body, read it ourselves (safe — won't throw)
  const text = bodyText ?? (await safeBodyText(response));

  // If body is empty or not JSON, fall back to a status-based error
  if (!text || !isJsonContentType(contentType)) {
    return {
      error: buildStatusError(status, `Request failed with status ${status}`, { requestId }),
      parsed: false,
    };
  }

  const body = safeJsonParse(text);
  if (body === undefined) {
    return {
      error: buildStatusError(status, `Request failed with status ${status}`, { requestId }),
      parsed: false,
    };
  }

  // 1. Check for Stellar Horizon result codes
  const stellar = detectStellarCode(body);
  if (stellar) {
    const horizonStatus = HORIZON_STATUS_MAP[stellar.stellarCode] ?? status;
    const message = extractMessage(body) ?? `Stellar transaction failed: ${stellar.stellarCode}`;
    return {
      error: new StellarHorizonError(message, {
        code: stellar.stellarCode,
        status: horizonStatus,
        requestId,
        stellarCode: stellar.stellarCode,
        operationCode: stellar.operationCode,
        details: extractDetails(body),
      }),
      parsed: true,
    };
  }

  // 2. Standard API error envelope: { error: { code, message, details } }
  const apiError = extractApiError(body);
  if (apiError) {
    const fieldErrors = extractFieldErrors(body);
    const details = fieldErrors ? { fields: fieldErrors } : apiError.details;
    const error = buildTypedError(apiError.code, apiError.message, {
      status,
      requestId,
      details: Object.keys(details ?? {}).length > 0 ? details : undefined,
    });
    return { error, parsed: true };
  }

  // 3. Validation array payload (no standard error envelope)
  const fieldErrors = extractFieldErrors(body);
  if (fieldErrors) {
    const message = extractMessage(body) ?? 'Validation failed';
    return {
      error: new ValidationError(message, {
        code: 'VALIDATION_ERROR',
        status,
        requestId,
        details: { fields: fieldErrors },
      }),
      parsed: true,
    };
  }

  // 4. Unrecognised body shape — wrap as a generic error
  const message = extractMessage(body) ?? `Request failed with status ${status}`;
  return {
    error: buildStatusError(status, message, { requestId, cause: body }),
    parsed: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Sync parser for pre-read bodies                                             */
/* -------------------------------------------------------------------------- */

/**
 * Synchronous variant for cases where the body has already been read and parsed.
 * Useful inside the `HttpClient` where `send()` already consumed the response.
 */
export function parseErrorBody(status: number, body: unknown, requestId?: string): AstroidError {
  // 1. Stellar Horizon
  const stellar = detectStellarCode(body);
  if (stellar) {
    const horizonStatus = HORIZON_STATUS_MAP[stellar.stellarCode] ?? status;
    const message = extractMessage(body) ?? `Stellar transaction failed: ${stellar.stellarCode}`;
    return new StellarHorizonError(message, {
      code: stellar.stellarCode,
      status: horizonStatus,
      requestId,
      stellarCode: stellar.stellarCode,
      operationCode: stellar.operationCode,
      details: extractDetails(body),
    });
  }

  // 2. Standard API error envelope
  const apiError = extractApiError(body);
  if (apiError) {
    const fieldErrors = extractFieldErrors(body);
    const details = fieldErrors ? { fields: fieldErrors } : apiError.details;
    return buildTypedError(apiError.code, apiError.message, {
      status,
      requestId,
      details: Object.keys(details ?? {}).length > 0 ? details : undefined,
    });
  }

  // 3. Validation array
  const fieldErrors = extractFieldErrors(body);
  if (fieldErrors) {
    const message = extractMessage(body) ?? 'Validation failed';
    return new ValidationError(message, {
      code: 'VALIDATION_ERROR',
      status,
      requestId,
      details: { fields: fieldErrors },
    });
  }

  // 4. Fallback
  const message = extractMessage(body) ?? `Request failed with status ${status}`;
  return buildStatusError(status, message, { requestId });
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function extractApiError(body: unknown): ApiError | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const obj = body as Record<string, unknown>;
  const errorField = obj.error;
  if (typeof errorField !== 'object' || errorField === null) return undefined;
  const err = errorField as Record<string, unknown>;
  if (typeof err.code !== 'string' || typeof err.message !== 'string') return undefined;
  return {
    code: err.code,
    message: err.message,
    details:
      typeof err.details === 'object' && err.details !== null
        ? (err.details as Record<string, unknown>)
        : undefined,
  };
}

function extractMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const obj = body as Record<string, unknown>;

  // { error: { message } }
  const errorField = obj.error;
  if (typeof errorField === 'object' && errorField !== null) {
    const msg = (errorField as Record<string, unknown>).message;
    if (typeof msg === 'string') return msg;
  }

  // { message }
  if (typeof obj.message === 'string') return obj.message;

  // { error: string }
  if (typeof obj.error === 'string') return obj.error;

  return undefined;
}

function extractDetails(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const obj = body as Record<string, unknown>;

  // { error: { details } }
  const errorField = obj.error;
  if (typeof errorField === 'object' && errorField !== null) {
    const details = (errorField as Record<string, unknown>).details;
    if (typeof details === 'object' && details !== null) {
      return details as Record<string, unknown>;
    }
  }

  // { extras }
  if (typeof obj.extras === 'object' && obj.extras !== null) {
    return obj.extras as Record<string, unknown>;
  }

  return undefined;
}

/**
 * Map an API error code to the most specific error class. Returns a base
 * `AstroidError` for unknown codes.
 */
function buildTypedError(
  code: string,
  message: string,
  options: Omit<AstroidErrorOptions, 'code'>,
): AstroidError {
  switch (code) {
    case 'AUTHENTICATION_ERROR':
    case 'UNAUTHORIZED':
    case 'INVALID_API_KEY':
    case 'TOKEN_EXPIRED':
      return new AuthenticationError(message, { code, ...options });
    case 'FORBIDDEN':
      return new ForbiddenError(message, { code, ...options });
    case 'VALIDATION_ERROR':
    case 'BAD_REQUEST':
      return new ValidationError(message, { code, ...options });
    case 'NOT_FOUND':
      return new NotFoundError(message, { code, ...options });
    case 'CONFLICT':
      return new ConflictError(message, { code, ...options });
    case 'POLICY_VIOLATION':
      return new PolicyViolationError(message, { code, ...options });
    case 'BUDGET_EXCEEDED':
      return new BudgetExceededError(message, { code, ...options });
    case 'APPROVAL_REQUIRED':
      return new ApprovalRequiredError(message, { code, ...options });
    case 'RATE_LIMITED':
      return new RateLimitError(message, { code, ...options });
    case 'INTERNAL_ERROR':
    case 'SERVICE_UNAVAILABLE':
      return new InternalServerError(message, { code, ...options });
    default:
      return new AstroidError(message, { code, ...options });
  }
}

/**
 * Build an error from an HTTP status code alone (no API error code available).
 */
function buildStatusError(
  status: number,
  message: string,
  context: { requestId?: string; cause?: unknown },
): AstroidError {
  return buildTypedError(codeForStatus(status), message, {
    status,
    requestId: context.requestId,
    cause: context.cause,
  });
}

/**
 * Map an HTTP status code to a machine-readable error code string.
 */
function codeForStatus(status: number): string {
  if (status === 401) return 'AUTHENTICATION_ERROR';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 400 || status === 422) return 'VALIDATION_ERROR';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'INTERNAL_ERROR';
  return 'BAD_REQUEST';
}

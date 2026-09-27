/**
 * `@astroid/errors` — structured error mapping for Stellar network error codes.
 *
 * Debugging agent runtime failures requires distinct, strongly-typed error
 * classes rather than generic errors. This module is the **centralized**
 * mapping layer that translates raw Stellar Horizon (and Soroban RPC) error
 * payloads into dedicated domain error instances:
 *
 * - `InsufficientBalanceError` — `op_underfunded`, `op_low_reserve`,
 *   `tx_insufficient_balance`, `tx_insufficient_fee`
 * - `TrustlineMissingError` — `op_no_trust`, `op_line_full`, `op_no_issuer`
 * - `StellarAuthError` — `op_bad_auth`, `tx_bad_auth`, `op_unauthorized`
 * - `SequenceConflictError` — `tx_bad_seq`
 * - `TransactionExpiredError` — `tx_too_late`, `tx_timebounds_not_met`
 * - `StellarMalformedError` — `tx_malformed`, `tx_failed`, …
 * - `StellarNetworkError` — generic Horizon/RPC failure with the raw result
 *   codes preserved for diagnostics
 *
 * Every mapped error preserves the original message, the machine-readable
 * result codes (`stellarCode`, `operationCode`), and the diagnostic details
 * from the payload.
 *
 * @example
 * ```ts
 * import { mapStellarError } from '@astroid/errors';
 *
 * const err = mapStellarError(
 *   { extras: { result_codes: { transaction: 'tx_bad_seq' } } },
 *   { status: 400, message: 'Transaction failed' },
 * );
 * err instanceof SequenceConflictError; // true
 * err.stellarCode;                      // 'tx_bad_seq'
 * ```
 *
 * @module
 */

import type { ApiError } from '@astroid/types';
import {
  AstroidError,
  type AstroidErrorOptions,
} from './base.js';
import {
  InsufficientFundsError,
  AuthenticationError,
  ValidationError,
  ConflictError,
} from './classes.js';

/* -------------------------------------------------------------------------- */
/* Stellar-specific domain errors                                              */
/* -------------------------------------------------------------------------- */

/**
 * A transaction failed because the source account lacks sufficient funds or
 * reserve. Extends {@link InsufficientFundsError} so both names work with
 * `instanceof` (issue #253 keeps the legacy class fully compatible).
 */
export class InsufficientBalanceError extends InsufficientFundsError {}

/**
 * A transaction failed because a required trustline is missing, full, or
 * unauthorized. Extends {@link ValidationError} — trustline problems are
 * request/state validation issues.
 */
export class TrustlineMissingError extends ValidationError {}

/**
 * A Stellar operation failed signature/authorization checks. Extends
 * {@link AuthenticationError} for parity with the HTTP auth semantics.
 */
export class StellarAuthError extends AuthenticationError {}

/**
 * A transaction was rejected because its sequence number is stale or invalid.
 * Extends {@link ConflictError} — 409 semantics for on-chain state.
 */
export class SequenceConflictError extends ConflictError {}

/** A transaction missed its time bounds and expired before inclusion in a ledger. */
export class TransactionExpiredError extends AstroidError {}

/** The submitted Stellar transaction envelope was malformed or failed validation. */
export class StellarMalformedError extends ValidationError {}

/**
 * A generic Stellar Horizon / RPC failure that has no more specific domain
 * mapping. The raw result codes remain available for diagnostics.
 */
export class StellarNetworkError extends AstroidError {
  /** The raw Stellar transaction-level result code, when known. */
  readonly stellarCode: string | undefined;
  /** The Horizon operation-level result code, when known. */
  readonly operationCode: string | undefined;

  constructor(
    message: string,
    options: AstroidErrorOptions & { stellarCode?: string; operationCode?: string },
  ) {
    super(message, options);
    this.stellarCode = options.stellarCode;
    this.operationCode = options.operationCode;
  }
}

/* -------------------------------------------------------------------------- */
/* Horizon result-code tables                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Horizon operation result codes mapped to their domain error class.
 * Codes not listed here produce a {@link StellarNetworkError}.
 */
export const STELLAR_OPERATION_CODE_MAP: Record<string, typeof AstroidError> = {
  op_underfunded: InsufficientBalanceError,
  op_low_reserve: InsufficientBalanceError,
  op_no_destination: StellarNetworkError,
  op_no_trust: TrustlineMissingError,
  op_line_full: TrustlineMissingError,
  op_no_issuer: TrustlineMissingError,
  op_not_authorized: TrustlineMissingError,
  op_unauthorized: StellarAuthError,
  op_bad_auth: StellarAuthError,
  op_bad_sponsor: StellarMalformedError,
  op_invalid_asset: StellarMalformedError,
};

/**
 * Horizon transaction result codes mapped to their domain error class.
 * Codes not listed here produce a {@link StellarNetworkError}.
 */
export const STELLAR_TRANSACTION_CODE_MAP: Record<string, typeof AstroidError> = {
  tx_insufficient_balance: InsufficientBalanceError,
  tx_insufficient_fee: InsufficientBalanceError,
  tx_bad_auth: StellarAuthError,
  tx_bad_auth_extra: StellarAuthError,
  tx_bad_seq: SequenceConflictError,
  tx_too_late: TransactionExpiredError,
  tx_timebounds_not_met: TransactionExpiredError,
  tx_malformed: StellarMalformedError,
  tx_invalid: StellarMalformedError,
  tx_failed: StellarNetworkError,
  tx_no_source_account: StellarMalformedError,
};

/**
 * The HTTP status each known Stellar result code maps to, so downstream
 * consumers see familiar REST semantics even for on-chain failures.
 */
export const STELLAR_CODE_STATUS_MAP: Record<string, number> = {
  op_underfunded: 402,
  op_low_reserve: 402,
  tx_insufficient_balance: 402,
  tx_insufficient_fee: 402,
  op_no_destination: 404,
  op_no_trust: 422,
  op_line_full: 422,
  op_no_issuer: 404,
  op_not_authorized: 403,
  op_unauthorized: 403,
  op_bad_auth: 401,
  op_bad_sponsor: 400,
  op_invalid_asset: 400,
  tx_bad_auth: 401,
  tx_bad_auth_extra: 401,
  tx_bad_seq: 409,
  tx_too_late: 410,
  tx_timebounds_not_met: 410,
  tx_malformed: 400,
  tx_invalid: 400,
  tx_no_source_account: 400,
};

/* -------------------------------------------------------------------------- */
/* Payload inspection                                                          */
/* -------------------------------------------------------------------------- */

/** The result codes extracted from a Horizon-style error payload. */
export interface StellarResultCodes {
  /** Transaction-level result code, e.g. `tx_bad_seq`. */
  transaction?: string;
  /** First operation-level result code, e.g. `op_underfunded`. */
  operation?: string;
  /** All operation-level result codes, when the payload provides them. */
  operations?: string[];
}

/**
 * Detect Stellar Horizon result codes from the payload shapes the Horizon
 * server (and the Astroid API forwarding Horizon errors) may return:
 *
 * - `{ extras: { result_codes: { transaction, operations } } }` — standard Horizon envelope
 * - `{ result_code: '...' }` / `{ stellarCode: '...' }` — flat/normalized shapes
 */
export function extractStellarResultCodes(body: unknown): StellarResultCodes | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const obj = body as Record<string, unknown>;

  const extras = obj.extras as Record<string, unknown> | undefined;
  if (extras) {
    const resultCodes = extras.result_codes as Record<string, unknown> | undefined;
    if (resultCodes) {
      const transaction =
        typeof resultCodes.transaction === 'string' ? resultCodes.transaction : undefined;
      const operations = Array.isArray(resultCodes.operations)
        ? (resultCodes.operations as string[])
        : undefined;
      const operation = operations?.[0];
      if (transaction || operation) {
        return { transaction, operation, operations };
      }
    }
  }

  const resultCode = typeof obj.result_code === 'string' ? obj.result_code : undefined;
  const stellarCode = typeof obj.stellarCode === 'string' ? obj.stellarCode : undefined;
  const code = resultCode ?? stellarCode;
  if (code) return { transaction: code };

  return undefined;
}

/** Extract a human-readable message from a Horizon error payload. */
function extractStellarMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const obj = body as Record<string, unknown>;
  if (typeof obj.title === 'string') return obj.title;
  if (typeof obj.detail === 'string') return obj.detail;
  if (typeof obj.message === 'string') return obj.message;
  if (typeof obj.error === 'string') return obj.error;
  return undefined;
}

/** Extract structured diagnostic details from a Horizon error payload. */
function extractStellarDetails(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const obj = body as Record<string, unknown>;
  if (typeof obj.extras === 'object' && obj.extras !== null) {
    return obj.extras as Record<string, unknown>;
  }
  if (typeof obj.details === 'object' && obj.details !== null) {
    return obj.details as Record<string, unknown>;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Core mapping                                                                */
/* -------------------------------------------------------------------------- */

/** Options for {@link mapStellarError}. */
export interface StellarMappingContext {
  /** HTTP status of the failed response, when the error came from HTTP. */
  status?: number;
  /** Explicit message override; extracted from the payload when omitted. */
  message?: string;
  /** The API request id, for correlating with backend logs. */
  requestId?: string;
  /** Additional structured detail to merge into the error. */
  details?: Record<string, unknown>;
  /** Underlying cause (e.g. the original transport failure). */
  cause?: unknown;
}

/**
 * Resolve the domain error class for a Stellar result code. Operation codes
 * are checked first, then transaction codes; unknown codes resolve to
 * {@link StellarNetworkError}.
 */
export function errorClassForStellarCode(code: string): typeof AstroidError {
  return STELLAR_OPERATION_CODE_MAP[code] ?? STELLAR_TRANSACTION_CODE_MAP[code] ?? StellarNetworkError;
}

/**
 * Centralized mapping from a raw Stellar Horizon/RPC error payload (with
 * optional HTTP context) to a typed domain error instance.
 *
 * The returned error always preserves:
 * - the original `message` (explicit → payload → result-code-derived fallback)
 * - the machine-readable `stellarCode` / `operationCode` in `details`
 * - the HTTP `status` / `statusCode` (from {@link StellarMappingContext.status}
 *   or the known status for the result code)
 * - `requestId` and any extra `details`
 *
 * @param body     The parsed error payload (Horizon envelope or normalized shape).
 * @param context  Optional HTTP/message/requestId/details/cause context.
 * @returns The instantiated domain error — throw it, or inspect it.
 *
 * @example
 * ```ts
 * const err = mapStellarError(
 *   { extras: { result_codes: { operations: ['op_underfunded'] } } },
 *   { status: 400 },
 * );
 * err instanceof InsufficientBalanceError; // true
 * err.statusCode;                          // 402
 * ```
 */
export function mapStellarError(body: unknown, context: StellarMappingContext = {}): AstroidError {
  const codes = extractStellarResultCodes(body);
  const stellarCode = codes?.operation ?? codes?.transaction ?? 'unknown';
  const operationCode = codes?.operation;

  const ErrorClass = errorClassForStellarCode(stellarCode);
  // The known status for the result code wins: on-chain failures carry REST
  // semantics (e.g. op_underfunded → 402) regardless of the HTTP envelope that
  // carried them. Fall back to the response status, then 400.
  const status = STELLAR_CODE_STATUS_MAP[stellarCode] ?? context.status ?? 400;
  const message =
    context.message ??
    extractStellarMessage(body) ??
    `Stellar transaction failed: ${stellarCode}`;

  const payloadDetails = extractStellarDetails(body);
  const details: Record<string, unknown> = {
    ...(payloadDetails ?? {}),
    ...(context.details ?? {}),
    stellarCode,
    ...(operationCode !== undefined ? { operationCode } : {}),
    ...(codes?.operations !== undefined ? { operations: codes.operations } : {}),
  };

  if (ErrorClass === StellarNetworkError) {
    return new StellarNetworkError(message, {
      code: stellarCode,
      status,
      requestId: context.requestId,
      details,
      cause: context.cause,
      stellarCode,
      operationCode,
    });
  }

  return new ErrorClass(message, {
    code: stellarCode,
    status,
    requestId: context.requestId,
    details,
    cause: context.cause,
  });
}

/**
 * Map a Stellar result code into the {@link ApiError} envelope shape, so
 * pipelines that speak the API error dialect can surface on-chain failures
 * without losing fidelity.
 */
export function stellarCodeToApiError(code: string, message?: string): ApiError {
  const ErrorClass = errorClassForStellarCode(code);
  return {
    code: code,
    message: message ?? `Stellar transaction failed: ${code}`,
    details: { stellarCode: code, domainError: ErrorClass.name },
  };
}

/** Type guard: is this value a Stellar-mapped domain error? */
export function isStellarError(value: unknown): value is StellarNetworkError {
  return (
    value instanceof InsufficientBalanceError ||
    value instanceof TrustlineMissingError ||
    value instanceof StellarAuthError ||
    value instanceof SequenceConflictError ||
    value instanceof TransactionExpiredError ||
    value instanceof StellarMalformedError ||
    value instanceof StellarNetworkError
  );
}

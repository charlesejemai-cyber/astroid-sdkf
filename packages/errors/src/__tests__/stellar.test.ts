/**
 * Unit tests for the centralized Stellar error mapping (issue #253).
 *
 * Covers:
 * - Result-code extraction from Horizon and normalized payload shapes
 * - Domain class resolution for operation and transaction codes
 * - mapStellarError instantiation, message preservation, and diagnostic details
 * - HTTP status inference for on-chain failures
 * - isStellarError type guard and stellarCodeToApiError adapter
 */

import { describe, it, expect } from 'vitest';
import {
  AstroidError,
  InsufficientBalanceError,
  TrustlineMissingError,
  StellarAuthError,
  SequenceConflictError,
  TransactionExpiredError,
  StellarMalformedError,
  StellarNetworkError,
  extractStellarResultCodes,
  errorClassForStellarCode,
  mapStellarError,
  stellarCodeToApiError,
  isStellarError,
} from '../index.js';

/* -------------------------------------------------------------------------- */
/* extractStellarResultCodes                                                   */
/* -------------------------------------------------------------------------- */

describe('extractStellarResultCodes (issue #253)', () => {
  it('extracts codes from the standard Horizon envelope', () => {
    const codes = extractStellarResultCodes({
      extras: { result_codes: { transaction: 'tx_bad_seq', operations: ['op_underfunded'] } },
    });
    expect(codes).toEqual({
      transaction: 'tx_bad_seq',
      operation: 'op_underfunded',
      operations: ['op_underfunded'],
    });
  });

  it('extracts only the transaction code when operations are absent', () => {
    const codes = extractStellarResultCodes({
      extras: { result_codes: { transaction: 'tx_malformed' } },
    });
    expect(codes).toEqual({ transaction: 'tx_malformed', operation: undefined, operations: undefined });
  });

  it('extracts flat result_code / stellarCode shapes', () => {
    expect(extractStellarResultCodes({ result_code: 'op_low_reserve' })?.transaction).toBe(
      'op_low_reserve',
    );
    expect(extractStellarResultCodes({ stellarCode: 'tx_bad_auth' })?.transaction).toBe(
      'tx_bad_auth',
    );
  });

  it('returns undefined for non-stellar payloads', () => {
    expect(extractStellarResultCodes(undefined)).toBeUndefined();
    expect(extractStellarResultCodes(null)).toBeUndefined();
    expect(extractStellarResultCodes({})).toBeUndefined();
    expect(extractStellarResultCodes({ error: { code: 'NOT_FOUND' } })).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* errorClassForStellarCode                                                    */
/* -------------------------------------------------------------------------- */

describe('errorClassForStellarCode (issue #253)', () => {
  it('maps insufficient-balance codes to InsufficientBalanceError', () => {
    expect(errorClassForStellarCode('op_underfunded')).toBe(InsufficientBalanceError);
    expect(errorClassForStellarCode('op_low_reserve')).toBe(InsufficientBalanceError);
    expect(errorClassForStellarCode('tx_insufficient_balance')).toBe(InsufficientBalanceError);
    expect(errorClassForStellarCode('tx_insufficient_fee')).toBe(InsufficientBalanceError);
  });

  it('maps trustline codes to TrustlineMissingError', () => {
    expect(errorClassForStellarCode('op_no_trust')).toBe(TrustlineMissingError);
    expect(errorClassForStellarCode('op_line_full')).toBe(TrustlineMissingError);
    expect(errorClassForStellarCode('op_no_issuer')).toBe(TrustlineMissingError);
    expect(errorClassForStellarCode('op_not_authorized')).toBe(TrustlineMissingError);
  });

  it('maps auth codes to StellarAuthError', () => {
    expect(errorClassForStellarCode('op_bad_auth')).toBe(StellarAuthError);
    expect(errorClassForStellarCode('tx_bad_auth')).toBe(StellarAuthError);
    expect(errorClassForStellarCode('tx_bad_auth_extra')).toBe(StellarAuthError);
  });

  it('maps sequence and expiry codes to their domain errors', () => {
    expect(errorClassForStellarCode('tx_bad_seq')).toBe(SequenceConflictError);
    expect(errorClassForStellarCode('tx_too_late')).toBe(TransactionExpiredError);
    expect(errorClassForStellarCode('tx_timebounds_not_met')).toBe(TransactionExpiredError);
  });

  it('maps malformed codes to StellarMalformedError', () => {
    expect(errorClassForStellarCode('tx_malformed')).toBe(StellarMalformedError);
    expect(errorClassForStellarCode('tx_invalid')).toBe(StellarMalformedError);
    expect(errorClassForStellarCode('op_invalid_asset')).toBe(StellarMalformedError);
  });

  it('falls back to StellarNetworkError for unknown codes', () => {
    expect(errorClassForStellarCode('tx_completely_unknown')).toBe(StellarNetworkError);
    expect(errorClassForStellarCode('')).toBe(StellarNetworkError);
  });
});

/* -------------------------------------------------------------------------- */
/* mapStellarError                                                             */
/* -------------------------------------------------------------------------- */

describe('mapStellarError (issue #253)', () => {
  it('builds InsufficientBalanceError from op_underfunded with inferred 402', () => {
    const err = mapStellarError(
      { extras: { result_codes: { operations: ['op_underfunded'] } } },
      { status: 400 },
    );
    expect(err).toBeInstanceOf(InsufficientBalanceError);
    expect(err.status).toBe(402);
    expect(err.code).toBe('op_underfunded');
    expect(err.details?.stellarCode).toBe('op_underfunded');
  });

  it('builds SequenceConflictError from tx_bad_seq', () => {
    const err = mapStellarError(
      { extras: { result_codes: { transaction: 'tx_bad_seq' } } },
      { status: 400 },
    );
    expect(err).toBeInstanceOf(SequenceConflictError);
    expect(err.status).toBe(409);
  });

  it('builds StellarAuthError from op_bad_auth', () => {
    const err = mapStellarError(
      { extras: { result_codes: { operations: ['op_bad_auth'] } } },
      {},
    );
    expect(err).toBeInstanceOf(StellarAuthError);
    expect(err.status).toBe(401);
  });

  it('builds TrustlineMissingError from op_no_trust', () => {
    const err = mapStellarError({ result_code: 'op_no_trust' }, {});
    expect(err).toBeInstanceOf(TrustlineMissingError);
  });

  it('builds TransactionExpiredError from tx_too_late', () => {
    const err = mapStellarError({ stellarCode: 'tx_too_late' }, {});
    expect(err).toBeInstanceOf(TransactionExpiredError);
    expect(err.status).toBe(410);
  });

  it('builds StellarMalformedError from tx_malformed', () => {
    const err = mapStellarError(
      { extras: { result_codes: { transaction: 'tx_malformed' } } },
      {},
    );
    expect(err).toBeInstanceOf(StellarMalformedError);
    expect(err.status).toBe(400);
  });

  it('builds a StellarNetworkError with raw codes for unmapped failures', () => {
    const err = mapStellarError(
      { extras: { result_codes: { transaction: 'tx_failed' } } },
      {},
    );
    expect(err).toBeInstanceOf(StellarNetworkError);
    const snErr = err as StellarNetworkError;
    expect(snErr.stellarCode).toBe('tx_failed');
    expect(err.details?.stellarCode).toBe('tx_failed');
  });

  it('prefers the operation code over the transaction code', () => {
    const err = mapStellarError(
      { extras: { result_codes: { transaction: 'tx_failed', operations: ['op_low_reserve'] } } },
      {},
    );
    expect(err).toBeInstanceOf(InsufficientBalanceError);
    expect(err.details?.stellarCode).toBe('op_low_reserve');
    expect(err.details?.operationCode).toBe('op_low_reserve');
  });

  it('preserves the original message from the payload', () => {
    const err = mapStellarError(
      { title: 'Transaction Failed', extras: { result_codes: { transaction: 'tx_bad_seq' } } },
      {},
    );
    expect(err.message).toBe('Transaction Failed');
  });

  it('uses an explicit message override when provided', () => {
    const err = mapStellarError(
      { extras: { result_codes: { transaction: 'tx_bad_seq' } } },
      { message: 'Sequence number already used' },
    );
    expect(err.message).toBe('Sequence number already used');
  });

  it('falls back to a result-code-derived message', () => {
    const err = mapStellarError({ extras: { result_codes: { transaction: 'tx_bad_seq' } } }, {});
    expect(err.message).toBe('Stellar transaction failed: tx_bad_seq');
  });

  it('keeps the requestId and merges extra details', () => {
    const err = mapStellarError(
      { extras: { result_codes: { transaction: 'tx_bad_seq' } } },
      { requestId: 'req_stl_1', details: { walletId: 'wal_1' } },
    );
    expect(err.requestId).toBe('req_stl_1');
    expect(err.details?.walletId).toBe('wal_1');
    expect(err.details?.stellarCode).toBe('tx_bad_seq');
  });

  it('preserves Horizon extras in details', () => {
    const extras = { result_codes: { transaction: 'tx_bad_seq' }, envelope: { sequences: 1 } };
    const err = mapStellarError({ extras }, {});
    expect(err.details?.envelope).toEqual({ sequences: 1 });
  });

  it('propagates the cause for error chaining', () => {
    const cause = new Error('http failed');
    const err = mapStellarError({ result_code: 'op_underfunded' }, { cause });
    expect(err.cause).toBe(cause);
  });

  it('always extends AstroidError with a stable name', () => {
    const err = mapStellarError({ result_code: 'op_underfunded' }, {});
    expect(err instanceof AstroidError).toBe(true);
    expect(err.name).toBe('InsufficientBalanceError');
  });
});

/* -------------------------------------------------------------------------- */
/* stellarCodeToApiError + isStellarError                                      */
/* -------------------------------------------------------------------------- */

describe('stellarCodeToApiError and isStellarError (issue #253)', () => {
  it('adapts a stellar code into the API error envelope shape', () => {
    const apiError = stellarCodeToApiError('op_underfunded', 'Not enough XLM');
    expect(apiError.code).toBe('op_underfunded');
    expect(apiError.message).toBe('Not enough XLM');
    expect(apiError.details?.domainError).toBe('InsufficientBalanceError');
  });

  it('derives the message when none is provided', () => {
    const apiError = stellarCodeToApiError('tx_bad_seq');
    expect(apiError.message).toBe('Stellar transaction failed: tx_bad_seq');
  });

  it('recognizes stellar domain errors via the type guard', () => {
    expect(isStellarError(mapStellarError({ result_code: 'op_underfunded' }, {}))).toBe(true);
    expect(isStellarError(new StellarNetworkError('x', { code: 'tx_failed' }))).toBe(true);
    expect(isStellarError(new AstroidError('x', { code: 'X' }))).toBe(false);
    expect(isStellarError(new Error('plain'))).toBe(false);
    expect(isStellarError(null)).toBe(false);
  });
});

/**
 * `@astroid/transaction` — typed error classes and error normalization helpers.
 *
 * @module
 */

import { AstroidError, type AstroidErrorOptions } from '@astroid/errors';

/**
 * Base error class for all transaction-related failures within `@astroid/transaction`.
 */
export class AstroidTransactionError extends AstroidError {
  readonly transactionXdr?: string;

  constructor(message: string, options?: AstroidErrorOptions & { transactionXdr?: string }) {
    super(message, options ?? { code: 'TRANSACTION_ERROR' });
    this.transactionXdr = options?.transactionXdr;
  }
}

/**
 * Error thrown when transaction simulation fails (e.g. malformed XDR, RPC failure, or ledger rejection).
 */
export class TransactionSimulationError extends AstroidTransactionError {
  readonly stellarCode?: string;
  readonly operationCode?: string;
  readonly operationResultCodes?: string[];

  constructor(
    message: string,
    options?: AstroidErrorOptions & TransactionXdrOption & StellarCodeOptions,
  ) {
    super(message, options);
    this.stellarCode = options?.stellarCode;
    this.operationCode = options?.operationCode;
    this.operationResultCodes = options?.operationResultCodes;
  }
}

/**
 * Error thrown when transaction submission fails on the Stellar network or API backend.
 */
export class TransactionSubmissionError extends AstroidTransactionError {
  readonly stellarCode?: string;
  readonly operationCode?: string;
  readonly operationResultCodes?: string[];

  constructor(
    message: string,
    options?: AstroidErrorOptions & TransactionXdrOption & StellarCodeOptions,
  ) {
    super(message, options);
    this.stellarCode = options?.stellarCode;
    this.operationCode = options?.operationCode;
    this.operationResultCodes = options?.operationResultCodes;
  }
}

interface TransactionXdrOption {
  transactionXdr?: string;
}

interface StellarCodeOptions {
  stellarCode?: string;
  operationCode?: string;
  operationResultCodes?: string[];
}

/**
 * Normalizes an unknown caught error during simulation or submission into an `AstroidTransactionError`.
 */
export function normalizeTransactionError(
  err: unknown,
  defaultMessage: string,
  options?: { transactionXdr?: string; isSimulation?: boolean },
): AstroidTransactionError {
  if (err instanceof AstroidTransactionError) {
    return err;
  }

  let message = defaultMessage;
  let stellarCode: string | undefined;
  let operationCode: string | undefined;
  let operationResultCodes: string[] | undefined;
  let status = 400;
  let details: Record<string, unknown> | undefined;

  if (err instanceof Error) {
    message = err.message || defaultMessage;
    if ('status' in err && typeof (err as Record<string, unknown>).status === 'number') {
      status = (err as Record<string, unknown>).status as number;
    }
    if ('stellarCode' in err && typeof (err as Record<string, unknown>).stellarCode === 'string') {
      stellarCode = (err as Record<string, unknown>).stellarCode as string;
    }
    if (
      'operationCode' in err &&
      typeof (err as Record<string, unknown>).operationCode === 'string'
    ) {
      operationCode = (err as Record<string, unknown>).operationCode as string;
    }
    if (
      'operationResultCodes' in err &&
      Array.isArray((err as Record<string, unknown>).operationResultCodes)
    ) {
      operationResultCodes = (err as Record<string, unknown>).operationResultCodes as string[];
    }
    if ('details' in err) {
      const d = (err as Record<string, unknown>).details;
      if (d && typeof d === 'object') details = d as Record<string, unknown>;
    }
  } else if (typeof err === 'string') {
    message = err;
  } else if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === 'string') message = obj.message;
    if (typeof obj.status === 'number') status = obj.status;
    if (typeof obj.stellarCode === 'string') stellarCode = obj.stellarCode;
    if (typeof obj.operationCode === 'string') operationCode = obj.operationCode;
    if (Array.isArray(obj.operationResultCodes))
      operationResultCodes = obj.operationResultCodes as string[];

    // Check Horizon extras result codes
    const extras = obj.extras as Record<string, unknown> | undefined;
    if (extras) {
      const resultCodes = extras.result_codes as Record<string, unknown> | undefined;
      if (resultCodes) {
        if (typeof resultCodes.transaction === 'string') stellarCode = resultCodes.transaction;
        if (Array.isArray(resultCodes.operations)) {
          operationResultCodes = resultCodes.operations as string[];
          operationCode = operationResultCodes[0];
          // Prefer the more specific operation-level code when present.
          if (operationCode) stellarCode = operationCode;
        }
      }
    }
  }

  const errorOpts = {
    code: stellarCode ?? (options?.isSimulation ? 'SIMULATION_FAILED' : 'SUBMISSION_FAILED'),
    status,
    details,
    transactionXdr: options?.transactionXdr,
    stellarCode,
    operationCode,
    operationResultCodes,
  };

  if (options?.isSimulation) {
    return new TransactionSimulationError(message, errorOpts);
  }
  return new TransactionSubmissionError(message, errorOpts);
}

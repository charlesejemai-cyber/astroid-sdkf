import { Networks, TransactionBuilder } from '@stellar/stellar-base';
import type { FeeBumpTransaction, Transaction } from '@stellar/stellar-base';
import type {
  TransactionFeeEstimate,
  TransactionSimulationErrorCode,
  TransactionSimulationOptions,
  TransactionSimulationOutcome,
  TransactionSimulationRemoteResult,
} from '@astroid/types';

import { encodeTransaction } from './builder.js';
import type { DecodedTxPayload } from './decoder.js';
import { decodeTransactionXDR } from './decoder.js';
import {
  TransactionSimulationError,
  normalizeTransactionError,
} from './errors.js';
import { estimateFee } from './fee-estimation.js';
import type { TransactionValidationCode } from './validator.js';
import { validateTransactionEnvelope } from './validator.js';

export interface SimulationOptions {
  networkPassphrase?: string;
  feeBufferPercentage?: number;
}

export interface SimulationResult {
  baseFee: number;
  estimatedFee: number;
  feeBufferPercentage: number;
  isViable: boolean;
  error?: TransactionSimulationError;
}

/**
 * Simulates a Stellar transaction fee and viability from an XDR string or Transaction object.
 */
export function simulateTransactionFee(
  transactionOrXdr: string | Transaction,
  options?: SimulationOptions,
): SimulationResult {
  const networkPassphrase = options?.networkPassphrase ?? Networks.PUBLIC;
  const feeBufferPercentage = options?.feeBufferPercentage ?? 15;

  let xdrString = '';
  let tx: Transaction | FeeBumpTransaction;

  try {
    if (typeof transactionOrXdr === 'string') {
      xdrString = transactionOrXdr;
      tx = TransactionBuilder.fromXDR(xdrString, networkPassphrase);
    } else {
      tx = transactionOrXdr;
      xdrString = tx.toXDR();
    }

    const baseFee = Number(tx.fee);
    if (isNaN(baseFee) || baseFee <= 0) {
      const err = new TransactionSimulationError('Transaction fee must be greater than zero', {
        code: 'ZERO_OR_NEGATIVE_FEE',
        transactionXdr: xdrString,
        status: 400,
      });
      return {
        baseFee: isNaN(baseFee) ? 0 : baseFee,
        estimatedFee: 0,
        feeBufferPercentage,
        isViable: false,
        error: err,
      };
    }

    const multiplier = 1 + feeBufferPercentage / 100;
    const estimatedFee = Math.round(baseFee * multiplier);

    return {
      baseFee,
      estimatedFee,
      feeBufferPercentage,
      isViable: true,
    };
  } catch (error) {
    const normalized = normalizeTransactionError(error, 'Failed to simulate transaction XDR', {
      transactionXdr:
        xdrString || (typeof transactionOrXdr === 'string' ? transactionOrXdr : undefined),
      isSimulation: true,
    });
    return {
      baseFee: 0,
      estimatedFee: 0,
      feeBufferPercentage,
      isViable: false,
      error: normalized,
    };
  }
}

/**
 * Simulation result, enriched with the underlying error instance when the
 * transaction is not viable.
 */
export interface TransactionSimulationResult extends TransactionSimulationOutcome {
  /** Typed error behind a `viable: false` outcome. */
  error?: TransactionSimulationError;
}

/** Map a protocol validator code onto the simulation error taxonomy. */
function mapValidationCode(code: TransactionValidationCode): TransactionSimulationErrorCode {
  switch (code) {
    case 'INVALID_ENVELOPE_XDR':
    case 'INVALID_INPUT':
      return 'INVALID_ENVELOPE';
    case 'FEE_BID_TOO_HIGH':
      return 'FEE_TOO_HIGH';
    case 'FEE_BELOW_MINIMUM':
    case 'MISSING_FEE':
      return 'FEE_BELOW_MINIMUM';
    case 'NO_OPERATIONS':
      return 'NO_OPERATIONS';
    default:
      return 'VALIDATION_FAILED';
  }
}

/** Read the first positive fee from the decoded envelope / normalized view. */
function readEnvelopeFee(...candidates: Array<string | number | null | undefined>): number {
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

/** Build a structured failure outcome from a typed simulation error. */
function failedSimulation(
  errorCode: TransactionSimulationErrorCode,
  error: TransactionSimulationError,
  options: {
    operationCount?: number;
    baseFee?: number;
    valid?: boolean;
    transactionXdr?: string;
    sourceAccount?: string;
  } = {},
): TransactionSimulationResult {
  const result: TransactionSimulationResult = {
    viable: false,
    valid: options.valid ?? false,
    operationCount: options.operationCount ?? 0,
    baseFee: options.baseFee ?? 0,
    estimatedFee: 0,
    errorCode,
    errorMessage: error.message,
    error,
  };
  if (options.transactionXdr !== undefined) result.transactionXdr = options.transactionXdr;
  if (options.sourceAccount !== undefined) result.sourceAccount = options.sourceAccount;
  return result;
}

/**
 * Simulate a transaction's execution outcome before it is broadcast.
 *
 * This is the high-level pre-flight helper: it decodes the envelope, validates
 * it against Astroid protocol requirements, derives the fee it should bid (with
 * an optional live Horizon sample), and — when an Astroid HTTP `client` is
 * supplied — performs a remote dry-run against the `/transactions/simulate`
 * endpoint using the Astroid API's risk and policy engine.
 *
 * Unlike the lower-level {@link simulateTransactionFee}, this function never
 * throws: network failures and malformed envelopes are returned as a structured
 * `viable: false` outcome so callers can branch on `errorCode` instead of
 * wrapping every call in a try/catch.
 *
 * @param transactionOrXdr A base64 XDR envelope, a built `Transaction`, or a `FeeBumpTransaction`.
 * @param options Network, fee-buffer, Horizon and remote-client options.
 * @returns A {@link TransactionSimulationResult} describing viability and fees.
 *
 * @example
 * ```ts
 * const result = await simulateTransaction(unsignedTx, { client: astroid.http });
 * if (!result.viable) throw new Error(result.errorMessage);
 * tx.fee = String(result.estimatedFee);
 * ```
 */
export async function simulateTransaction(
  transactionOrXdr: string | Transaction | FeeBumpTransaction,
  options: TransactionSimulationOptions = {},
): Promise<TransactionSimulationResult> {
  const networkPassphrase = options.networkPassphrase ?? Networks.PUBLIC;
  const feeBufferPercentage = options.feeBufferPercentage ?? 15;

  let xdr: string;
  try {
    xdr = encodeTransaction(transactionOrXdr);
  } catch (error) {
    const normalized = normalizeTransactionError(error, 'Invalid transaction envelope', {
      isSimulation: true,
    });
    return failedSimulation('INVALID_ENVELOPE', normalized);
  }

  let decoded: DecodedTxPayload;
  try {
    decoded = decodeTransactionXDR(xdr, networkPassphrase);
  } catch (error) {
    const normalized = normalizeTransactionError(error, 'Failed to decode transaction envelope', {
      transactionXdr: xdr,
      isSimulation: true,
    });
    return failedSimulation('INVALID_ENVELOPE', normalized, { transactionXdr: xdr });
  }

  const operationCount = decoded.operations.length;
  const report = validateTransactionEnvelope(xdr, { networkPassphrase });
  const baseFee = readEnvelopeFee(decoded.fee, report.normalized.fee);

  const blocking = report.errors[0];
  if (blocking) {
    const errorCode = mapValidationCode(blocking.code);
    const error = new TransactionSimulationError(blocking.message, {
      code: errorCode,
      status: 400,
      transactionXdr: xdr,
      details: { issues: report.issues },
    });
    return failedSimulation(errorCode, error, {
      operationCount,
      baseFee,
      valid: report.valid,
      transactionXdr: xdr,
      sourceAccount: decoded.sourceAccount,
    });
  }

  if (baseFee <= 0) {
    const error = new TransactionSimulationError('Transaction fee must be greater than zero', {
      code: 'ZERO_OR_NEGATIVE_FEE',
      status: 400,
      transactionXdr: xdr,
    });
    return failedSimulation('ZERO_OR_NEGATIVE_FEE', error, {
      operationCount,
      baseFee,
      valid: report.valid,
      transactionXdr: xdr,
      sourceAccount: decoded.sourceAccount,
    });
  }

  let feeEstimate: TransactionFeeEstimate | undefined;
  try {
    feeEstimate = await estimateFee({
      transaction: xdr,
      networkPassphrase,
      bufferPercentage: feeBufferPercentage,
      horizonUrl: options.horizonUrl,
      fetch: options.fetch,
    });
  } catch {
    feeEstimate = undefined;
  }

  const estimatedFee = feeEstimate
    ? Math.max(feeEstimate.recommendedFee, baseFee)
    : baseFee;

  let remote: TransactionSimulationRemoteResult | undefined;
  if (options.client && !options.skipRemote) {
    try {
      const response = await options.client.post<Record<string, unknown>>(
        '/transactions/simulate',
        { transactionXdr: xdr },
      );
      remote = { performed: true, success: true, data: response.data };
    } catch (error) {
      remote = {
        performed: true,
        success: false,
        errorCode: 'SIMULATION_FAILED',
        errorMessage: error instanceof Error ? error.message : 'Remote simulation failed',
      };
    }
  }

  const result: TransactionSimulationResult = {
    viable: !remote || remote.success,
    valid: report.valid,
    operationCount,
    baseFee,
    estimatedFee,
    sourceAccount: decoded.sourceAccount,
    transactionXdr: xdr,
  };
  if (feeEstimate) result.feeEstimate = feeEstimate;
  if (remote) {
    result.remote = remote;
    if (!remote.success) {
      result.errorCode = remote.errorCode ?? 'SIMULATION_FAILED';
      result.errorMessage = remote.errorMessage;
    }
  }
  return result;
}

import { Networks } from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';
import type {
  StellarNetworkState,
  TransactionFeeEstimate,
  TransactionFeeEstimateOptions,
} from '@astroid/types';

import { encodeTransaction } from './builder.js';
import { decodeTransactionXDR } from './decoder.js';
import { MIN_BASE_FEE_STROOPS } from './validator.js';

/**
 * Represents a fee stats bucket returned by Horizon /fee_stats.
 */
export interface HorizonFeeBucket {
  seconds: number;
  last_ledger?: string;
  last_ledger_base_fee?: number | string;
  ledger_max_fee?: number | string;
  p50?: number | string | null;
  p95?: number | string | null;
  p99?: number | string | null;
  fee_charged?: number | string;
  max_fee?: number | string;
  min_fee?: number | string;
  mode_fee?: number | string;
}

/**
 * Parsed and structured fee statistics from the Horizon network.
 */
export interface FeeStatsResult {
  ledgerBaseFee: number;
  modeFee: number;
  maxFee: number;
  p10?: number;
  feeCharged: HorizonFeeBucket[];
}

/**
 * Options for querying Horizon fee stats.
 */
export interface QueryFeeStatsOptions {
  horizonUrl?: string;
  fetch?: typeof fetch;
}

/**
 * Result of estimating a transaction fee from network stats.
 */
export interface FeeEstimationResult {
  live: boolean;
  recommendedFee: number;
  baseFee: number;
  liveFee?: number;
  bufferPercentage: number;
  networkState: 'normal' | 'busy' | 'congested' | 'unknown';
}

/**
 * Options for fee estimation.
 */
export interface EstimateFeeOptions {
  bufferPercentage?: number;
}

/**
 * Queries the Horizon fee_stats endpoint and parses the statistics.
 *
 * @param options - Configuration including horizonUrl and fetch implementation.
 * @returns Parsed FeeStatsResult.
 * @throws ValidationError if the query fails or returns non-OK status.
 */
export async function queryFeeStats(options: QueryFeeStatsOptions = {}): Promise<FeeStatsResult> {
  const url = options.horizonUrl ?? 'https://horizon.stellar.org/fee_stats';
  const fetchFn = options.fetch ?? fetch;

  let response: Response;
  try {
    response = await fetchFn(url);
  } catch (err: unknown) {
    throw new ValidationError('Failed to query Horizon fee stats', {
      code: 'NETWORK_ERROR',
      cause: err,
    });
  }

  if (!response.ok) {
    throw new ValidationError(`Horizon fee_stats returned status ${response.status}`, {
      code: 'HORIZON_ERROR',
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err: unknown) {
    throw new ValidationError('Failed to parse Horizon fee stats JSON', {
      code: 'JSON_PARSE_ERROR',
      cause: err,
    });
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const feeCharged = Array.isArray(raw.fee_charged) ? (raw.fee_charged as HorizonFeeBucket[]) : [];

  const ledgerBaseFee = Number(raw.base_fee ?? raw.ledger_max_fee ?? 100);
  const modeFee = Number(raw.mode_fee ?? ledgerBaseFee);
  const maxFee = Number(raw.ledger_max_fee ?? ledgerBaseFee);
  const p10 = raw.p10 !== undefined && raw.p10 !== null ? Number(raw.p10) : undefined;

  return {
    ledgerBaseFee: Number.isNaN(ledgerBaseFee) ? 100 : ledgerBaseFee,
    modeFee: Number.isNaN(modeFee) ? 100 : modeFee,
    maxFee: Number.isNaN(maxFee) ? 100 : maxFee,
    p10,
    feeCharged,
  };
}

/**
 * Safely queries Horizon fee stats, returning null on failure instead of throwing.
 *
 * @param options - Configuration including horizonUrl and fetch implementation.
 * @returns FeeStatsResult or null.
 */
export async function queryFeeStatsSafe(
  options: QueryFeeStatsOptions = {},
): Promise<FeeStatsResult | null> {
  try {
    return await queryFeeStats(options);
  } catch {
    return null;
  }
}

/**
 * Calculates recommended transaction fee given a live fee and base fee.
 *
 * @param liveFee - Current live fee observed from network or fee stats.
 * @param baseFee - Minimum base fee required by the network ledger.
 * @param options - Optional buffer percentage (defaults to 30%).
 * @returns FeeEstimationResult with recommended fee and network state.
 */
export function estimateFromNetworkFee(
  liveFee: number,
  baseFee: number,
  options: EstimateFeeOptions = {},
): FeeEstimationResult {
  const bufferPercentage = options.bufferPercentage ?? 30;

  if (Number.isNaN(liveFee) || liveFee <= 0) {
    const validBase = Number.isNaN(baseFee) || baseFee <= 0 ? 100 : baseFee;
    return {
      live: false,
      recommendedFee: validBase,
      baseFee: validBase,
      bufferPercentage,
      networkState: 'unknown',
    };
  }

  const validBase = Number.isNaN(baseFee) || baseFee <= 0 ? 100 : baseFee;
  // Integer math avoids floating-point drift (e.g. 200 * 1.1 -> 220.00000000000003).
  const buffered = Math.ceil((liveFee * (100 + bufferPercentage)) / 100);
  const recommendedFee = Math.max(buffered, validBase);

  let networkState: FeeEstimationResult['networkState'] = 'normal';
  if (liveFee >= 5000) {
    networkState = 'congested';
  } else if (liveFee > validBase * 2) {
    networkState = 'busy';
  }

  return {
    live: true,
    recommendedFee,
    baseFee: validBase,
    liveFee,
    bufferPercentage,
    networkState,
  };
}

/**
 * Queries live fee statistics from Horizon and computes an estimated recommended fee.
 *
 * @param horizonUrl - Horizon URL or fee stats endpoint.
 * @param baseFee - Ledger base fee fallback.
 * @param options - Estimation and fetch options.
 * @returns FeeEstimationResult.
 */
export async function estimateLiveFee(
  horizonUrl: string,
  baseFee: number,
  options: EstimateFeeOptions & QueryFeeStatsOptions = {},
): Promise<FeeEstimationResult & { liveFee?: number }> {
  const stats = await queryFeeStatsSafe({
    horizonUrl,
    fetch: options.fetch,
  });

  if (!stats) {
    return {
      live: false,
      recommendedFee: baseFee,
      baseFee,
      bufferPercentage: options.bufferPercentage ?? 30,
      networkState: 'unknown',
    };
  }

  const activeLiveFee = pickLiveFee(stats);

  const result = estimateFromNetworkFee(activeLiveFee, baseFee, options);
  return {
    ...result,
    liveFee: activeLiveFee,
  };
}

/** Pick the most representative live fee from a set of Horizon buckets. */
function pickLiveFee(stats: FeeStatsResult): number {
  let activeLiveFee = stats.modeFee;
  if (stats.feeCharged.length > 0) {
    // Sort by seconds ascending; the freshest bucket has the largest window.
    const sorted = [...stats.feeCharged].sort((a, b) => (a.seconds ?? 0) - (b.seconds ?? 0));
    const freshest = sorted[sorted.length - 1];
    if (freshest && freshest.p50 !== undefined && freshest.p50 !== null) {
      activeLiveFee = Number(freshest.p50);
    } else if (freshest && freshest.fee_charged !== undefined && freshest.fee_charged !== null) {
      activeLiveFee = Number(freshest.fee_charged);
    }
  }
  return activeLiveFee;
}

/** Coerce an optional base fee into a positive integer, falling back to the floor. */
function normalizeBaseFee(baseFee: number | undefined): number {
  return typeof baseFee === 'number' && Number.isFinite(baseFee) && baseFee > 0
    ? Math.floor(baseFee)
    : MIN_BASE_FEE_STROOPS;
}

/**
 * Estimate the fee to bid for an unsigned transaction before broadcast.
 *
 * The estimator accepts either an unsigned transaction envelope (a base64 XDR
 * string or a built `Transaction`) or an explicit operation count. When a
 * `horizonUrl`/`fetch` is supplied it also samples live Horizon fee stats and
 * adds a safety buffer; if that query fails it degrades gracefully to the
 * static base fee instead of throwing. A malformed envelope, by contrast, is a
 * caller error and surfaces as a structured {@link ValidationError}.
 *
 * @param options Envelope or operation count, base fee, buffer and network options.
 * @returns A {@link TransactionFeeEstimate} with min and recommended total fees.
 * @throws {ValidationError} When `transaction` is supplied but cannot be decoded.
 *
 * @example
 * ```ts
 * const estimate = await estimateFee({
 *   transaction: unsignedTx,
 *   horizonUrl: 'https://horizon-testnet.stellar.org',
 * });
 * tx.fee = String(estimate.recommendedFee);
 * ```
 */
export async function estimateFee(
  options: TransactionFeeEstimateOptions = {},
): Promise<TransactionFeeEstimate> {
  const bufferPercentage = options.bufferPercentage ?? 30;

  let operationCount = options.operationCount ?? 1;
  let baseFee = options.baseFee;
  let transactionXdr: string | undefined;

  if (options.transaction !== undefined) {
    try {
      transactionXdr = encodeTransaction(options.transaction as unknown as string);
      const decoded = decodeTransactionXDR(
        transactionXdr,
        options.networkPassphrase ?? Networks.PUBLIC,
      );
      operationCount = decoded.operations.length;
      const envelopeFee = Number(decoded.fee);
      if (baseFee === undefined && Number.isFinite(envelopeFee) && envelopeFee > 0 && operationCount > 0) {
        baseFee = Math.ceil(envelopeFee / operationCount);
      }
    } catch (error) {
      throw new ValidationError('Failed to estimate fee: invalid transaction envelope.', {
        code: 'INVALID_TRANSACTION_ENVELOPE',
        cause: error,
      });
    }
  }

  if (!Number.isFinite(operationCount) || operationCount <= 0) {
    operationCount = 1;
  }
  operationCount = Math.max(1, Math.floor(operationCount));

  const resolvedBaseFee = normalizeBaseFee(baseFee);

  let live = false;
  let networkState: StellarNetworkState = 'unknown';
  let recommendedBaseFee = resolvedBaseFee;

  if (options.horizonUrl !== undefined || options.fetch !== undefined) {
    const stats = await queryFeeStatsSafe({
      horizonUrl: options.horizonUrl,
      fetch: options.fetch,
    });

    if (stats) {
      const liveFee = pickLiveFee(stats);
      if (Number.isFinite(liveFee) && liveFee > 0) {
        const fromLive = estimateFromNetworkFee(liveFee, resolvedBaseFee, { bufferPercentage });
        live = true;
        recommendedBaseFee = Math.max(fromLive.recommendedFee, resolvedBaseFee);
        networkState = fromLive.networkState;
      }
    }
  }

  const minFee = resolvedBaseFee * operationCount;
  const recommendedFee = Math.max(recommendedBaseFee * operationCount, minFee);

  const estimate: TransactionFeeEstimate = {
    operationCount,
    baseFee: resolvedBaseFee,
    minFee,
    recommendedBaseFee,
    recommendedFee,
    bufferPercentage,
    networkState,
    live,
  };
  if (transactionXdr !== undefined) estimate.transactionXdr = transactionXdr;
  return estimate;
}

/**
 * Formats a fee in stroops to XLM string representation (1 XLM = 10^7 stroops).
 *
 * @param stroops - Fee in stroops (number or string).
 * @returns Formatted XLM string.
 */
export function formatFeeAsXlm(stroops: number | string): string {
  const val = typeof stroops === 'string' ? parseFloat(stroops) : stroops;
  if (Number.isNaN(val) || val < 0) {
    return '0.0000000';
  }
  const xlm = val / 10000000;
  return xlm.toFixed(7);
}

/**
 * Parses an XLM fee amount string into stroops integer.
 *
 * @param xlmAmount - Fee in XLM.
 * @returns Fee in stroops.
 */
export function parseFeeInStroops(xlmAmount: string | number): number {
  const val = typeof xlmAmount === 'string' ? parseFloat(xlmAmount) : xlmAmount;
  if (Number.isNaN(val) || val < 0) {
    return 0;
  }
  return Math.round(val * 10000000);
}

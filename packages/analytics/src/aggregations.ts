/**
 * `@astroid/analytics` — local analytical aggregation utilities.
 *
 * Pure, floating-point-free helpers that transform raw transaction feeds into
 * structured telemetry metrics (volume, fees, latency, success rates) grouped
 * by configurable time-bucket intervals (hourly, daily, weekly).
 *
 * No network or database access — every function is deterministic and safe to
 * call from both Node and browser runtimes.
 *
 * @module
 */

import type { Transaction, TransactionStatus } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** Supported UTC bucket granularities. */
export type AggregateGranularity = 'hour' | 'day' | 'week';

/** Configuration for {@link aggregateTransactionMetrics}. */
export interface AggregateTelemetryOptions {
  /** Bucket size in UTC. Defaults to `'day'`. */
  granularity?: AggregateGranularity;
  /** Which timestamp field to bucket on. Defaults to `'createdAt'`. */
  timestampField?: 'createdAt' | 'updatedAt';
}

/** Statistics for a single time-bucket window. */
export interface TransactionTelemetryBucket {
  /** ISO-8601 start of the bucket (inclusive). */
  start: string;
  /** ISO-8601 end of the bucket (exclusive). */
  end: string;
  /** Sum of transaction amounts in this bucket (decimal string). */
  totalVolume: string;
  /** Sum of fees (gasEstimate) in this bucket (decimal string). */
  totalFees: string;
  /** Mean latency (updatedAt − createdAt) in milliseconds for resolved txns. */
  averageLatencyMs: number;
  /** Transactions with a terminal success status. */
  successCount: number;
  /** Transactions with a terminal failure status. */
  failureCount: number;
  /** Total transactions in this bucket. */
  totalCount: number;
  /** `successCount / (successCount + failureCount)`, or `0` when neither exists. */
  successRate: number;
}

/** Aggregate totals across all buckets plus the per-bucket breakdown. */
export interface AggregatedTelemetry {
  /** The granularity used for bucketing. */
  granularity: AggregateGranularity;
  /** Sum of all transaction amounts across every bucket (decimal string). */
  totalVolume: string;
  /** Sum of all fees across every bucket (decimal string). */
  totalFees: string;
  /** Global mean latency in milliseconds for resolved transactions. */
  averageLatencyMs: number;
  /** Total successful transactions across all buckets. */
  successCount: number;
  /** Total failed transactions across all buckets. */
  failureCount: number;
  /** Total transactions processed. */
  totalCount: number;
  /** Global success rate: `successCount / (successCount + failureCount)`. */
  successRate: number;
  /** Per-bucket breakdown, sorted chronologically by `start`. */
  buckets: TransactionTelemetryBucket[];
}

/* -------------------------------------------------------------------------- */
/* Internal helpers — decimal-string arithmetic (no floating-point)            */
/* -------------------------------------------------------------------------- */

type Decimal = { n: bigint; scale: number };

/** Parse a decimal string or number into a `Decimal` (integer numerator + scale). */
function parseDecimal(value: string | number): Decimal {
  const text = String(value).trim();
  const sign = text.startsWith('-') ? -1n : 1n;
  const unsigned = text.replace(/^[+-]/, '');
  const [whole, fraction = ''] = unsigned.split('.');
  return { n: sign * BigInt(`${whole || '0'}${fraction}`), scale: fraction.length };
}

/** Align two `Decimal` values to the same scale and return their BigInt numerators. */
function alignDecimals(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [a.n * 10n ** BigInt(scale - a.scale), b.n * 10n ** BigInt(scale - b.scale), scale];
}

/** Add two decimal strings, returning a decimal string. */
function decAdd(a: string, b: string): string {
  const da = parseDecimal(a);
  const db = parseDecimal(b);
  const [x, y, scale] = alignDecimals(da, db);
  return formatDecimal({ n: x + y, scale });
}

/** Sum an array of decimal strings. */
function decSum(values: string[]): string {
  return values.reduce(decAdd, '0');
}

/** Format a `Decimal` back to a human-readable string (no trailing zeros in fraction). */
function formatDecimal(value: Decimal): string {
  const negative = value.n < 0n;
  let digits = (negative ? -value.n : value.n).toString().padStart(value.scale + 1, '0');
  if (value.scale) {
    digits = `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`.replace(
      /\.0+$|(?<=\.[0-9]*?)0+$/,
      '',
    );
  }
  return `${negative ? '-' : ''}${digits || '0'}`;
}

/* -------------------------------------------------------------------------- */
/* Bucketing helpers                                                           */
/* -------------------------------------------------------------------------- */

/** Terminal success statuses. */
const SUCCESS_STATUSES: ReadonlySet<TransactionStatus> = new Set(['COMPLETED', 'CONFIRMED']);

/** Terminal failure statuses. */
const FAILURE_STATUSES: ReadonlySet<TransactionStatus> = new Set([
  'FAILED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
]);

/** Snap a Date to the start of its UTC bucket. */
function bucketStart(date: Date, granularity: AggregateGranularity): Date {
  const d = new Date(date);
  if (granularity === 'hour') {
    d.setUTCMinutes(0, 0, 0);
  } else if (granularity === 'day') {
    d.setUTCHours(0, 0, 0, 0);
  } else {
    // week — snap to Monday 00:00 UTC
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  }
  return d;
}

/** Return the ISO-8601 date at the end (exclusive) of a bucket. */
function bucketEnd(start: Date, granularity: AggregateGranularity): Date {
  const d = new Date(start);
  if (granularity === 'hour') {
    d.setUTCHours(d.getUTCHours() + 1);
  } else if (granularity === 'day') {
    d.setUTCDate(d.getUTCDate() + 1);
  } else {
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return d;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Compute telemetry summary metrics from a list of transactions, grouped by
 * the requested time-bucket interval.
 *
 * The function performs a single pass over the input array, buckets each
 * transaction by its timestamp, and aggregates:
 *
 * - **Volume** — sum of `transaction.amount` (decimal-string, no precision loss).
 * - **Fees** — sum of `transaction.gasEstimate` (falls back to `"0"` when absent).
 * - **Latency** — `updatedAt − createdAt` in milliseconds (averaged per bucket).
 * - **Success rate** — `COMPLETED` / `CONFIRMED` vs `FAILED` / `REJECTED` /
 *   `CANCELLED` / `EXPIRED`. Pending / in-progress statuses are excluded from
 *   the rate denominator.
 *
 * Buckets are returned sorted chronologically by their start timestamp.
 *
 * @param history  Array of `Transaction` objects to process.
 * @param options  Bucket granularity and timestamp field selector.
 * @returns        An {@link AggregatedTelemetry} object ready for dashboard consumption.
 *
 * @example
 * ```ts
 * import { aggregateTransactionMetrics } from '@astroid/analytics/aggregations';
 *
 * const metrics = aggregateTransactionMetrics(transactions, {
 *   granularity: 'day',
 *   timestampField: 'createdAt',
 * });
 * console.log(metrics.totalVolume);   // "12500.75"
 * console.log(metrics.successRate);   // 0.94
 * ```
 */
export function aggregateTransactionMetrics(
  history: Transaction[],
  options: AggregateTelemetryOptions = {},
): AggregatedTelemetry {
  const granularity = options.granularity ?? 'day';
  const timestampField = options.timestampField ?? 'createdAt';

  // --- Bucket groupings: key → accumulator ---
  interface BucketAccumulator {
    start: Date;
    volumeParts: string[];
    feeParts: string[];
    latenciesMs: number[];
    successCount: number;
    failureCount: number;
    totalCount: number;
  }

  const buckets = new Map<string, BucketAccumulator>();

  for (const tx of history) {
    const raw = new Date(tx[timestampField]);
    if (Number.isNaN(raw.getTime())) continue;

    const start = bucketStart(raw, granularity);
    const key = start.toISOString();

    let acc = buckets.get(key);
    if (!acc) {
      acc = {
        start,
        volumeParts: [],
        feeParts: [],
        latenciesMs: [],
        successCount: 0,
        failureCount: 0,
        totalCount: 0,
      };
      buckets.set(key, acc);
    }

    acc.totalCount += 1;
    acc.volumeParts.push(tx.amount);
    acc.feeParts.push(tx.gasEstimate ?? '0');

    // Latency: difference between updatedAt and createdAt in milliseconds.
    const created = new Date(tx.createdAt).getTime();
    const updated = new Date(tx.updatedAt).getTime();
    if (!Number.isNaN(created) && !Number.isNaN(updated)) {
      acc.latenciesMs.push(updated - created);
    }

    if (SUCCESS_STATUSES.has(tx.status)) {
      acc.successCount += 1;
    } else if (FAILURE_STATUSES.has(tx.status)) {
      acc.failureCount += 1;
    }
  }

  // --- Build sorted bucket results ---
  const sortedKeys = [...buckets.keys()].sort();
  const bucketResults: TransactionTelemetryBucket[] = sortedKeys.map((key) => {
    const acc = buckets.get(key)!;
    const end = bucketEnd(acc.start, granularity);
    const resolved = acc.successCount + acc.failureCount;
    const avgLatency =
      acc.latenciesMs.length > 0
        ? acc.latenciesMs.reduce((sum, v) => sum + v, 0) / acc.latenciesMs.length
        : 0;

    return {
      start: acc.start.toISOString(),
      end: end.toISOString(),
      totalVolume: decSum(acc.volumeParts),
      totalFees: decSum(acc.feeParts),
      averageLatencyMs: avgLatency,
      successCount: acc.successCount,
      failureCount: acc.failureCount,
      totalCount: acc.totalCount,
      successRate: resolved > 0 ? acc.successCount / resolved : 0,
    };
  });

  // --- Global aggregates ---
  const totalVolume = decSum(bucketResults.map((b) => b.totalVolume));
  const totalFees = decSum(bucketResults.map((b) => b.totalFees));
  const totalSuccess = bucketResults.reduce((s, b) => s + b.successCount, 0);
  const totalFailure = bucketResults.reduce((s, b) => s + b.failureCount, 0);
  const totalCount = bucketResults.reduce((s, b) => s + b.totalCount, 0);
  const totalResolved = totalSuccess + totalFailure;

  // Global average latency: recompute from all latencies across buckets.
  const allLatencies: number[] = [];
  for (const key of sortedKeys) {
    const acc = buckets.get(key)!;
    for (const ms of acc.latenciesMs) allLatencies.push(ms);
  }
  const globalAvgLatency =
    allLatencies.length > 0 ? allLatencies.reduce((sum, v) => sum + v, 0) / allLatencies.length : 0;

  return {
    granularity,
    totalVolume,
    totalFees,
    averageLatencyMs: globalAvgLatency,
    successCount: totalSuccess,
    failureCount: totalFailure,
    totalCount,
    successRate: totalResolved > 0 ? totalSuccess / totalResolved : 0,
    buckets: bucketResults,
  };
}

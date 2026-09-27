/**
 * `@astroid/analytics` — aggregated metrics query methods and time-range
 * filtering helpers.
 *
 * Thin, typed wrappers over the `/analytics` metrics endpoints that let
 * dashboards and monitoring systems ask for aggregated financial metrics
 * (transaction volume, fee expenditure, agent execution counts) over a
 * configurable time window.
 *
 * Every filter accepts either an ISO-8601 string or a `Date`; values are
 * normalised to ISO-8601 UTC strings before they are sent to the API so query
 * encoding is consistent across runtimes.
 *
 * @module
 */

import type { HttpClient } from '@astroid/core';
import type {
  AgentAnalytics,
  AnalyticsMetricsResponse,
  Timeframe,
  VolumeSummary,
} from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** UTC bucket granularity accepted by the metrics endpoint. */
export type AnalyticsGranularity = 'hour' | 'day' | 'week' | 'month';

/** The metric families the analytics service can aggregate. */
export type AnalyticsMetricType =
  | 'transaction_volume'
  | 'fee_expenditure'
  | 'agent_execution_count';

/**
 * A reporting time window plus optional scope filters.
 *
 * `startDate`/`endDate` are the canonical spellings; `from`/`to` are accepted
 * as aliases for convenience. Dates may be supplied as ISO-8601 strings or
 * `Date` instances.
 */
export interface TimeRangeFilter {
  /** Inclusive window start (ISO-8601 string or `Date`). */
  startDate?: string | Date;
  /** Exclusive window end (ISO-8601 string or `Date`). */
  endDate?: string | Date;
  /** Alias for {@link startDate}. */
  from?: string | Date;
  /** Alias for {@link endDate}. */
  to?: string | Date;
  /** Bucket granularity. Defaults to `'day'` when omitted. */
  granularity?: AnalyticsGranularity;
  /** Explicit timeframe override (takes precedence over `granularity`). */
  timeframe?: Timeframe;
  /** Filter to a single asset code (e.g. `"USDC"`). */
  asset?: string;
  /** Filter to a single currency. */
  currency?: string;
  /** Filter to a single wallet. */
  walletId?: string;
  /** Filter to a single agent. */
  agentId?: string;
  /** Sort direction for tabular results. */
  order?: 'asc' | 'desc';
  /** Maximum rows per page. */
  limit?: number;
  /** Opaque pagination cursor. */
  cursor?: string;
}

/** Filter accepted by {@link getTransactionVolume} (alias of {@link TimeRangeFilter}). */
export type TransactionVolumeFilter = TimeRangeFilter;
/** Filter accepted by {@link getFeeExpenditure} (alias of {@link TimeRangeFilter}). */
export type FeeExpenditureFilter = TimeRangeFilter;
/** Filter accepted by {@link getAgentExecutionCounts} (alias of {@link TimeRangeFilter}). */
export type AgentExecutionCountFilter = TimeRangeFilter;

/** The normalised, wire-ready form of a {@link TimeRangeFilter}. */
export interface ResolvedTimeRange {
  startDate?: string;
  endDate?: string;
  timeframe?: string;
}

/* -------------------------------------------------------------------------- */
/* Time-range helpers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Coerce a `Date` or date string into an ISO-8601 UTC string.
 *
 * Returns `undefined` when the value is missing or cannot be parsed, so an
 * invalid date never leaks `"Invalid Date"` into a query string.
 */
export function toIso8601(value: string | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

/**
 * Normalise a filter's time window into ISO-8601 strings.
 *
 * `startDate`/`endDate` win over their `from`/`to` aliases; `timeframe` wins
 * over `granularity`.
 */
export function resolveTimeRange(filter: TimeRangeFilter = {}): ResolvedTimeRange {
  const startDate = toIso8601(filter.startDate ?? filter.from);
  const endDate = toIso8601(filter.endDate ?? filter.to);
  const timeframe = filter.timeframe ?? filter.granularity;

  const resolved: ResolvedTimeRange = {};
  if (startDate !== undefined) resolved.startDate = startDate;
  if (endDate !== undefined) resolved.endDate = endDate;
  if (timeframe !== undefined) resolved.timeframe = timeframe;
  return resolved;
}

/**
 * Serialise a {@link TimeRangeFilter} into a `URLSearchParams` instance.
 *
 * Undefined values are omitted so the resulting query string stays compact.
 * When `metric` is supplied it is included as the `metric` parameter used to
 * select the aggregation.
 *
 * @param filter Optional time window and scope filters.
 * @param metric Optional metric selector to include.
 * @returns A `URLSearchParams` ready to append to a request path.
 *
 * @example
 * ```ts
 * buildAnalyticsQuery(
 *   { startDate: new Date('2026-01-01'), endDate: '2026-02-01', granularity: 'day' },
 *   'transaction_volume',
 * ).toString();
 * // "metric=transaction_volume&startDate=2026-01-01T00%3A00%3A00.000Z&...
 * //  &timeframe=day"
 * ```
 */
export function buildAnalyticsQuery(
  filter: TimeRangeFilter = {},
  metric?: AnalyticsMetricType,
): URLSearchParams {
  const params = new URLSearchParams();
  const resolved = resolveTimeRange(filter);

  if (metric !== undefined) params.set('metric', metric);
  if (resolved.startDate !== undefined) params.set('startDate', resolved.startDate);
  if (resolved.endDate !== undefined) params.set('endDate', resolved.endDate);
  if (resolved.timeframe !== undefined) params.set('timeframe', resolved.timeframe);
  if (filter.asset !== undefined) params.set('asset', filter.asset);
  if (filter.currency !== undefined) params.set('currency', filter.currency);
  if (filter.walletId !== undefined) params.set('walletId', filter.walletId);
  if (filter.agentId !== undefined) params.set('agentId', filter.agentId);
  if (filter.cursor !== undefined) params.set('cursor', filter.cursor);
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));
  if (filter.order !== undefined) params.set('order', filter.order);
  return params;
}

/**
 * Build a full request path (route + serialised query) for the metrics
 * endpoint.
 *
 * @param filter   Time window and scope filters.
 * @param metric   Metric selector to include.
 * @param basePath API route prefix (default `'/analytics/metrics'`).
 * @returns A path string such as `/analytics/metrics?metric=...&startDate=...`.
 */
export function buildAnalyticsPath(
  filter: TimeRangeFilter = {},
  metric?: AnalyticsMetricType,
  basePath = '/analytics/metrics',
): string {
  const query = buildAnalyticsQuery(filter, metric).toString();
  return query ? `${basePath}?${query}` : basePath;
}

/* -------------------------------------------------------------------------- */
/* Query methods                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Fetch aggregated transaction-volume metrics over the requested time window.
 *
 * @param client The HTTP client used to reach the analytics API.
 * @param filter Optional time window and scope filters.
 * @returns The {@link VolumeSummary} for the window (total volume, fees,
 *   transaction count, success rate, average latency).
 *
 * @example
 * ```ts
 * const summary = await getTransactionVolume(client, {
 *   startDate: '2026-01-01T00:00:00.000Z',
 *   endDate: '2026-02-01T00:00:00.000Z',
 *   granularity: 'day',
 * });
 * console.log(summary.totalVolume);
 * ```
 */
export async function getTransactionVolume(
  client: HttpClient,
  filter: TimeRangeFilter = {},
): Promise<VolumeSummary> {
  const path = buildAnalyticsPath(filter, 'transaction_volume');
  const res = await client.get<AnalyticsMetricsResponse>(path);
  return res.data.summary;
}

/**
 * Fetch aggregated fee-expenditure metrics over the requested time window.
 *
 * @param client The HTTP client used to reach the analytics API.
 * @param filter Optional time window and scope filters.
 * @returns The {@link VolumeSummary} for the window; `totalFees` is the
 *   aggregated expenditure.
 */
export async function getFeeExpenditure(
  client: HttpClient,
  filter: TimeRangeFilter = {},
): Promise<VolumeSummary> {
  const path = buildAnalyticsPath(filter, 'fee_expenditure');
  const res = await client.get<AnalyticsMetricsResponse>(path);
  return res.data.summary;
}

/**
 * Fetch per-agent execution counts over the requested time window.
 *
 * @param client The HTTP client used to reach the analytics API.
 * @param filter Optional time window and scope filters.
 * @returns An {@link AgentAnalytics} report whose rows carry each agent's
 *   execution (`transactionCount`) totals.
 */
export async function getAgentExecutionCounts(
  client: HttpClient,
  filter: TimeRangeFilter = {},
): Promise<AgentAnalytics> {
  const path = buildAnalyticsPath(filter, undefined, '/analytics/agents');
  const res = await client.get<AgentAnalytics>(path);
  return res.data;
}

/* -------------------------------------------------------------------------- */
/* Resource wrapper                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Lightweight resource exposing the aggregated metrics queries as methods.
 *
 * Every method delegates to the standalone functions above, so the two APIs are
 * interchangeable. Prefer the standalone functions when composing helpers and
 * the resource when working with dependency injection.
 *
 * @example
 * ```ts
 * import { AnalyticsQueryResource } from '@astroid/analytics';
 *
 * const analytics = new AnalyticsQueryResource(httpClient);
 * const volume = await analytics.getTransactionVolume({ granularity: 'week' });
 * ```
 */
export class AnalyticsQueryResource {
  constructor(private readonly client: HttpClient) {}

  /** @see {@link getTransactionVolume} */
  getTransactionVolume(filter: TimeRangeFilter = {}): Promise<VolumeSummary> {
    return getTransactionVolume(this.client, filter);
  }

  /** @see {@link getFeeExpenditure} */
  getFeeExpenditure(filter: TimeRangeFilter = {}): Promise<VolumeSummary> {
    return getFeeExpenditure(this.client, filter);
  }

  /** @see {@link getAgentExecutionCounts} */
  getAgentExecutionCounts(filter: TimeRangeFilter = {}): Promise<AgentAnalytics> {
    return getAgentExecutionCounts(this.client, filter);
  }
}

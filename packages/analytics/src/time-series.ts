/**
 * `@astroid/analytics` — Time-series query builder helpers.
 *
 * Provides pure functions for constructing, validating, and serialising
 * time-bucket query parameters, plus a lightweight resource class for
 * fetching time-series data from the Astroid metrics API.
 *
 * Dashboard builders and agent operators can use these helpers to request
 * performance and expenditure metrics grouped by hourly, daily, or weekly
 * intervals.
 *
 * @module
 */

import type { HttpClient } from '@astroid/core';
import type { AnalyticsMetricsResponse, Timeframe } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** Supported time-bucket intervals for API queries. */
export type TimeSeriesInterval = 'hour' | 'day' | 'week';

/** Parameters for building a time-series query. */
export interface TimeSeriesQueryParams {
  /** Bucket interval: `'hour'`, `'day'`, or `'week'`. */
  interval: TimeSeriesInterval;
  /** ISO-8601 start time (inclusive). */
  startTime: string;
  /** ISO-8601 end time (exclusive). */
  endTime: string;
  /** Filter results by asset code (e.g. `"USDC"`, `"XLM"`). */
  asset?: string;
  /** Filter results by wallet ID. */
  walletId?: string;
  /** Filter results by agent ID. */
  agentId?: string;
}

/* -------------------------------------------------------------------------- */
/* Error type                                                                  */
/* -------------------------------------------------------------------------- */

/** Error thrown when time-series query parameters fail validation. */
export class TimeSeriesQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeSeriesQueryError';
  }
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

const VALID_INTERVALS: readonly TimeSeriesInterval[] = ['hour', 'day', 'week'];

/**
 * Validate time-series query parameters.
 *
 * Throws {@link TimeSeriesQueryError} when:
 * - `interval` is missing or not one of `'hour'`, `'day'`, `'week'`
 * - `startTime` or `endTime` is missing or not a parseable ISO-8601 string
 * - `startTime` is not strictly before `endTime`
 *
 * @throws {TimeSeriesQueryError}
 */
export function validateTimeSeriesQuery(params: TimeSeriesQueryParams): void {
  if (!params.interval) {
    throw new TimeSeriesQueryError('interval is required');
  }
  if (!(VALID_INTERVALS as readonly string[]).includes(params.interval)) {
    throw new TimeSeriesQueryError(
      `Invalid interval "${params.interval}". Must be one of: ${VALID_INTERVALS.join(', ')}`,
    );
  }
  if (!params.startTime) {
    throw new TimeSeriesQueryError('startTime is required');
  }
  if (!params.endTime) {
    throw new TimeSeriesQueryError('endTime is required');
  }
  if (Number.isNaN(Date.parse(params.startTime))) {
    throw new TimeSeriesQueryError(`Invalid startTime "${params.startTime}"`);
  }
  if (Number.isNaN(Date.parse(params.endTime))) {
    throw new TimeSeriesQueryError(`Invalid endTime "${params.endTime}"`);
  }
  if (new Date(params.startTime).getTime() >= new Date(params.endTime).getTime()) {
    throw new TimeSeriesQueryError('startTime must be before endTime');
  }
}

/* -------------------------------------------------------------------------- */
/* Query building                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Build a `URLSearchParams` instance from time-series query parameters.
 *
 * Only defined (non-`undefined`) optional fields are included so the serialised
 * string stays compact.
 *
 * @returns A `URLSearchParams` instance ready to be appended to a URL.
 *
 * @example
 * ```ts
 * const params = buildTimeSeriesQuery({
 *   interval: 'day',
 *   startTime: '2026-01-01T00:00:00.000Z',
 *   endTime: '2026-02-01T00:00:00.000Z',
 *   asset: 'USDC',
 * });
 * console.log(params.toString());
 * // "interval=day&startTime=2026-01-01T00%3A00%3A00.000Z&endTime=2026-02-01T00%3A00%3A00.000Z&asset=USDC"
 * ```
 */
export function buildTimeSeriesQuery(params: TimeSeriesQueryParams): URLSearchParams {
  const searchParams = new URLSearchParams();
  searchParams.set('interval', params.interval);
  searchParams.set('startTime', params.startTime);
  searchParams.set('endTime', params.endTime);
  if (params.asset !== undefined) searchParams.set('asset', params.asset);
  if (params.walletId !== undefined) searchParams.set('walletId', params.walletId);
  if (params.agentId !== undefined) searchParams.set('agentId', params.agentId);
  return searchParams;
}

/**
 * Build a full API path with serialised query parameters.
 *
 * @param params   Time-series query parameters.
 * @param basePath API route prefix (default: `'/analytics/time-series'`).
 * @returns A path string such as
 *   `'/analytics/time-series?interval=day&startTime=…&endTime=…'`.
 */
export function buildTimeSeriesPath(
  params: TimeSeriesQueryParams,
  basePath = '/analytics/time-series',
): string {
  const query = buildTimeSeriesQuery(params).toString();
  return query ? `${basePath}?${query}` : basePath;
}

/* -------------------------------------------------------------------------- */
/* Resource class                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Lightweight resource for fetching time-series analytics from the Astroid API.
 *
 * Wraps {@link buildTimeSeriesPath} with automatic validation so callers get
 * a single async call to retrieve bucketed metric data.
 *
 * @example
 * ```ts
 * import { TimeSeriesResource } from '@astroid/analytics';
 *
 * const ts = new TimeSeriesResource(httpClient);
 * const { points, summary } = await ts.getMetrics({
 *   interval: 'day',
 *   startTime: '2026-01-01T00:00:00.000Z',
 *   endTime: '2026-02-01T00:00:00.000Z',
 * });
 * ```
 */
export class TimeSeriesResource {
  constructor(private readonly client: HttpClient) {}

  /**
   * Fetch time-series metrics bucketed by the specified interval.
   *
   * Parameters are validated before the HTTP request is made; invalid inputs
   * throw a {@link TimeSeriesQueryError} without contacting the API.
   *
   * @param params Time-series query parameters.
   * @returns An {@link AnalyticsMetricsResponse} with per-bucket metric points
   *   and a roll-up summary.
   * @throws {TimeSeriesQueryError} When parameters are invalid.
   */
  async getMetrics(params: TimeSeriesQueryParams): Promise<AnalyticsMetricsResponse> {
    validateTimeSeriesQuery(params);
    const path = buildTimeSeriesPath(params);
    const res = await this.client.get<AnalyticsMetricsResponse>(path);
    return res.data;
  }
}

/* -------------------------------------------------------------------------- */
/* Convenience re-export for mapping intervals → Timeframe DTOs                */
/* -------------------------------------------------------------------------- */

/** Map a {@link TimeSeriesInterval} to the matching `Timeframe` union member. */
export const INTERVAL_TO_TIMEFRAME: Record<TimeSeriesInterval, Timeframe> = {
  hour: 'hour',
  day: 'day',
  week: 'week',
};

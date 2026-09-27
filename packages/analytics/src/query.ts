/**
 * `@astroid/analytics` — query builder helpers for analytics endpoints.
 *
 * Provides pure functions for constructing, validating, and serialising
 * analytics query parameters including date ranges, grouping, and filtering.
 * Dashboard builders and agent operators can use these helpers to request
 * metrics and reports with type-safe, validated parameters.
 *
 * @module
 */

import type { Timeframe } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** Supported grouping dimensions for analytics aggregation. */
export type AnalyticsGroupBy = 'asset' | 'agent' | 'wallet' | 'budget' | 'day' | 'week' | 'month';

/** Timeframe bucket granularity for analytics reports. */
export type { Timeframe };

/** Supported time window presets for quick date range selection. */
export type TimeWindowPreset =
  | 'last_hour'
  | 'last_24_hours'
  | 'last_7_days'
  | 'last_30_days'
  | 'last_90_days'
  | 'this_week'
  | 'this_month'
  | 'this_quarter'
  | 'this_year'
  | 'previous_week'
  | 'previous_month'
  | 'previous_quarter'
  | 'previous_year';

/** Configuration options for building analytics queries. */
export interface AnalyticsQueryOptions {
  /** Inclusive start of the reporting window (ISO-8601). */
  startDate?: string;
  /** Exclusive end of the reporting window (ISO-8601). */
  endDate?: string;
  /** Shorthand alias for {@link startDate}. */
  from?: string;
  /** Shorthand alias for {@link endDate}. */
  to?: string;
  /** Bucket granularity for the report. */
  timeframe?: Timeframe;
  /** Filter results to a single asset code (e.g. `USDC`, `XLM`). */
  asset?: string;
  /** Filter results to a single currency. */
  currency?: string;
  /** Filter results to a single wallet. */
  walletId?: string;
  /** Filter results to a single agent. */
  agentId?: string;
  /** Field to sort the rows by (for list endpoints). */
  sort?: string;
  /** Group results by the specified dimension. */
  groupBy?: AnalyticsGroupBy;
  /** Page number for paginated results (1-indexed). */
  page?: number;
  /** Number of items per page. */
  limit?: number;
  /** Sort order: 'asc' or 'desc'. */
  order?: 'asc' | 'desc';
}

/** Error thrown when analytics query parameters fail validation. */
export class AnalyticsQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalyticsQueryError';
  }
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

const VALID_TIMEFRAMES: readonly Timeframe[] = ['hour', 'day', 'week', 'month', 'year'];
const VALID_GROUP_BY: readonly AnalyticsGroupBy[] = [
  'asset',
  'agent',
  'wallet',
  'budget',
  'day',
  'week',
  'month',
];

/**
 * Validate analytics query parameters.
 *
 * Throws {@link AnalyticsQueryError} when:
 * - `startDate`/`from` or `endDate`/`to` is missing or not a parseable ISO-8601 string
 * - `startDate` is not strictly before `endDate`
 * - `timeframe` is not one of the supported values
 * - `groupBy` is not one of the supported values
 * - `page` or `limit` are not positive integers
 * - `order` is not 'asc' or 'desc'
 *
 * @throws {AnalyticsQueryError}
 */
export function validateAnalyticsQuery(params: AnalyticsQueryOptions): void {
  // Normalize from/to to startDate/endDate
  const startDate = params.startDate ?? params.from;
  const endDate = params.endDate ?? params.to;

  if (!startDate) {
    throw new AnalyticsQueryError('startDate (or from) is required');
  }
  if (!endDate) {
    throw new AnalyticsQueryError('endDate (or to) is required');
  }
  if (Number.isNaN(Date.parse(startDate))) {
    throw new AnalyticsQueryError(`Invalid startDate "${startDate}"`);
  }
  if (Number.isNaN(Date.parse(endDate))) {
    throw new AnalyticsQueryError(`Invalid endDate "${endDate}"`);
  }
  if (new Date(startDate).getTime() >= new Date(endDate).getTime()) {
    throw new AnalyticsQueryError('startDate must be before endDate');
  }

  if (params.timeframe !== undefined) {
    if (!(VALID_TIMEFRAMES as readonly string[]).includes(params.timeframe)) {
      throw new AnalyticsQueryError(
        `Invalid timeframe "${params.timeframe}". Must be one of: ${VALID_TIMEFRAMES.join(', ')}`,
      );
    }
  }

  if (params.groupBy !== undefined) {
    if (!(VALID_GROUP_BY as readonly string[]).includes(params.groupBy)) {
      throw new AnalyticsQueryError(
        `Invalid groupBy "${params.groupBy}". Must be one of: ${VALID_GROUP_BY.join(', ')}`,
      );
    }
  }

  if (params.page !== undefined) {
    if (!Number.isInteger(params.page) || params.page < 1) {
      throw new AnalyticsQueryError('page must be a positive integer');
    }
  }

  if (params.limit !== undefined) {
    if (!Number.isInteger(params.limit) || params.limit < 1) {
      throw new AnalyticsQueryError('limit must be a positive integer');
    }
  }

  if (params.order !== undefined && !['asc', 'desc'].includes(params.order)) {
    throw new AnalyticsQueryError('order must be either "asc" or "desc"');
  }
}

/* -------------------------------------------------------------------------- */
/* Query building                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Build a `URLSearchParams` instance from analytics query options.
 *
 * Only defined (non-`undefined`) optional fields are included so the serialised
 * string stays compact. Accepts both `startDate`/`endDate` and `from`/`to` aliases.
 *
 * @returns A `URLSearchParams` instance ready to be appended to a URL.
 *
 * @example
 * ```ts
 * const params = buildAnalyticsQuery({
 *   startDate: '2026-01-01T00:00:00.000Z',
 *   endDate: '2026-02-01T00:00:00.000Z',
 *   asset: 'USDC',
 *   groupBy: 'day',
 * });
 * console.log(params.toString());
 * // "startDate=2026-01-01T00%3A00%3A00.000Z&endDate=2026-02-01T00%3A00%3A00.000Z&asset=USDC&groupBy=day"
 * ```
 */
export function buildAnalyticsQuery(params: AnalyticsQueryOptions): URLSearchParams {
  const searchParams = new URLSearchParams();

  const startDate = params.startDate ?? params.from;
  const endDate = params.endDate ?? params.to;

  if (startDate) searchParams.set('startDate', startDate);
  if (endDate) searchParams.set('endDate', endDate);
  if (params.timeframe) searchParams.set('timeframe', params.timeframe);
  if (params.asset !== undefined) searchParams.set('asset', params.asset);
  if (params.currency !== undefined) searchParams.set('currency', params.currency);
  if (params.walletId !== undefined) searchParams.set('walletId', params.walletId);
  if (params.agentId !== undefined) searchParams.set('agentId', params.agentId);
  if (params.sort !== undefined) searchParams.set('sort', params.sort);
  if (params.groupBy !== undefined) searchParams.set('groupBy', params.groupBy);
  if (params.page !== undefined) searchParams.set('page', String(params.page));
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params.order !== undefined) searchParams.set('order', params.order);

  return searchParams;
}

/**
 * Build a full API path with serialised query parameters for analytics endpoints.
 *
 * @param params   Analytics query parameters.
 * @param basePath API route prefix (e.g., `'/analytics/overview'`, `'/analytics/agents'`).
 * @returns A path string such as `'/analytics/overview?startDate=…&endDate=…'`.
 */
export function buildAnalyticsPath(params: AnalyticsQueryOptions, basePath: string): string {
  const query = buildAnalyticsQuery(params).toString();
  return query ? `${basePath}?${query}` : basePath;
}

/* -------------------------------------------------------------------------- */
/* Date range presets                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Calculate a date range from a preset time window.
 *
 * @param preset  A predefined time window (e.g., 'last_7_days', 'this_month').
 * @param anchor  Optional reference date (defaults to current UTC time).
 * @returns An object with `startDate` and `endDate` as ISO-8601 strings.
 *
 * @example
 * ```ts
 * const { startDate, endDate } = getDateRangeFromPreset('last_7_days');
 * // { startDate: '2026-01-18T00:00:00.000Z', endDate: '2026-01-25T00:00:00.000Z' }
 * ```
 */
export function getDateRangeFromPreset(
  preset: TimeWindowPreset,
  anchor = new Date(),
): { startDate: string; endDate: string } {
  const now = new Date(anchor);
  const end = new Date(now);
  let start: Date;

  // Helper to start of day/week/month/quarter/year in UTC
  const startOfDay = (d: Date) => {
    const nd = new Date(d);
    nd.setUTCHours(0, 0, 0, 0);
    return nd;
  };

  const startOfWeek = (d: Date) => {
    const nd = startOfDay(d);
    nd.setUTCDate(nd.getUTCDate() - ((nd.getUTCDay() + 6) % 7)); // Monday
    return nd;
  };

  const startOfMonth = (d: Date) => {
    const nd = new Date(d);
    nd.setUTCDate(1);
    nd.setUTCHours(0, 0, 0, 0);
    return nd;
  };

  const startOfQuarter = (d: Date) => {
    const nd = startOfMonth(d);
    nd.setUTCMonth(Math.floor(nd.getUTCMonth() / 3) * 3);
    return nd;
  };

  const startOfYear = (d: Date) => {
    const nd = new Date(d);
    nd.setUTCMonth(0, 1);
    nd.setUTCHours(0, 0, 0, 0);
    return nd;
  };

  const addDays = (d: Date, days: number) => {
    const nd = new Date(d);
    nd.setUTCDate(nd.getUTCDate() + days);
    return nd;
  };

  const addMonths = (d: Date, months: number) => {
    const nd = new Date(d);
    nd.setUTCMonth(nd.getUTCMonth() + months);
    return nd;
  };

  const addYears = (d: Date, years: number) => {
    const nd = new Date(d);
    nd.setUTCFullYear(nd.getUTCFullYear() + years);
    return nd;
  };

  switch (preset) {
    case 'last_hour': {
      start = new Date(now.getTime() - 60 * 60 * 1000);
      break;
    }
    case 'last_24_hours': {
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    }
    case 'last_7_days': {
      start = startOfDay(addDays(now, -7));
      end.setTime(startOfDay(now).getTime());
      break;
    }
    case 'last_30_days': {
      start = startOfDay(addDays(now, -30));
      end.setTime(startOfDay(now).getTime());
      break;
    }
    case 'last_90_days': {
      start = startOfDay(addDays(now, -90));
      end.setTime(startOfDay(now).getTime());
      break;
    }
    case 'this_week': {
      start = startOfWeek(now);
      end.setTime(addDays(start, 7).getTime());
      break;
    }
    case 'this_month': {
      start = startOfMonth(now);
      end.setTime(addMonths(start, 1).getTime());
      break;
    }
    case 'this_quarter': {
      start = startOfQuarter(now);
      end.setTime(addMonths(start, 3).getTime());
      break;
    }
    case 'this_year': {
      start = startOfYear(now);
      end.setTime(addYears(start, 1).getTime());
      break;
    }
    case 'previous_week': {
      const thisWeekStart = startOfWeek(now);
      start = addDays(thisWeekStart, -7);
      end.setTime(thisWeekStart.getTime());
      break;
    }
    case 'previous_month': {
      const thisMonthStart = startOfMonth(now);
      start = addMonths(thisMonthStart, -1);
      end.setTime(thisMonthStart.getTime());
      break;
    }
    case 'previous_quarter': {
      const thisQuarterStart = startOfQuarter(now);
      start = addMonths(thisQuarterStart, -3);
      end.setTime(thisQuarterStart.getTime());
      break;
    }
    case 'previous_year': {
      const thisYearStart = startOfYear(now);
      start = addYears(thisYearStart, -1);
      end.setTime(thisYearStart.getTime());
      break;
    }
    default: {
      throw new AnalyticsQueryError(`Unknown time window preset: ${preset}`);
    }
  }

  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  };
}

/**
 * Apply a time window preset to analytics query options, returning a new
 * options object with the calculated date range.
 *
 * @param preset  A predefined time window.
 * @param options Existing query options to merge with the preset dates.
 * @param anchor  Optional reference date (defaults to current UTC time).
 * @returns A new options object with `startDate` and `endDate` populated.
 */
export function applyTimeWindowPreset(
  preset: TimeWindowPreset,
  options: AnalyticsQueryOptions = {},
  anchor?: Date,
): AnalyticsQueryOptions {
  const { startDate, endDate } = getDateRangeFromPreset(preset, anchor);
  return { ...options, startDate, endDate };
}

/* -------------------------------------------------------------------------- */
/* Convenience builders for common analytics endpoints                         */
/* -------------------------------------------------------------------------- */

/** Build query for `/analytics/overview` endpoint. */
export function buildOverviewQuery(params: AnalyticsQueryOptions): string {
  return buildAnalyticsPath(params, '/analytics/overview');
}

/** Build query for `/analytics/cashflow` endpoint. */
export function buildCashflowQuery(params: AnalyticsQueryOptions): string {
  return buildAnalyticsPath(params, '/analytics/cashflow');
}

/** Build query for `/analytics/spending` endpoint. */
export function buildSpendingQuery(params: AnalyticsQueryOptions): string {
  return buildAnalyticsPath(params, '/analytics/spending');
}

/** Build query for `/analytics/risk` endpoint. */
export function buildRiskQuery(params: AnalyticsQueryOptions): string {
  return buildAnalyticsPath(params, '/analytics/risk');
}

/** Build query for `/analytics/agents` endpoint. */
export function buildAgentsQuery(params: AnalyticsQueryOptions): string {
  return buildAnalyticsPath(params, '/analytics/agents');
}

/** Build query for `/analytics/budgets` endpoint. */
export function buildBudgetsQuery(params: AnalyticsQueryOptions): string {
  return buildAnalyticsPath(params, '/analytics/budgets');
}

/** Build query for `/analytics/agents` list (paginated) endpoint. */
export function buildListAgentsQuery(params: AnalyticsQueryOptions): string {
  return buildAnalyticsPath(params, '/analytics/agents');
}

/** Build query for `/analytics/budgets` list (paginated) endpoint. */
export function buildListBudgetsQuery(params: AnalyticsQueryOptions): string {
  return buildAnalyticsPath(params, '/analytics/budgets');
}

/* -------------------------------------------------------------------------- */
/* Re-export types from @astroid/types for convenience                         */
/* -------------------------------------------------------------------------- */

/**
 * Typed analytics result objects, ready to bind directly to charts.
 * Correspond to the `GET /analytics/*` endpoints (PRD Doc 5).
 *
 * @module
 */

import type { PaginationParams } from './common.js';
import type { DecimalString } from './entities.js';
import type { RiskBand } from './enums.js';

/** Bucket granularity for a time-series report. */
export type Timeframe = 'hour' | 'day' | 'week' | 'month' | 'year' | string;

/**
 * Shared analytics query filters: a time window plus optional scoping to a
 * particular asset, wallet, or agent. Both the `startDate`/`endDate` and the
 * shorthand `from`/`to` spellings are accepted.
 */
export interface AnalyticsQueryParams extends PaginationParams {
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
}

/** Shared analytics query filters (alias of {@link AnalyticsQueryParams}). */
export type AnalyticsQuery = AnalyticsQueryParams;

/**
 * Analytics list queries: the shared analytics filters plus standard
 * pagination controls. Applied to the tabular analytics endpoints (per-agent
 * and per-budget rows) so clients can page through large historical result
 * sets without pulling the full payload into memory.
 */
export interface AnalyticsListParams extends AnalyticsQueryParams, PaginationParams {
  /** Field to sort the rows by. */
  sort?: string;
}

/** A single (timestamp, value) point in a chart-ready time series. */
export interface TimeSeriesPoint {
  date: string;
  value: number;
}

/** A single point in a transaction-metrics time series. */
export interface TimeSeriesMetricPoint {
  timestamp: string;
  volume: string;
  fee: string;
  count: number;
  successCount: number;
  failureCount: number;
}

/** Aggregate volume totals for a reporting window. */
export interface VolumeSummary {
  timeframe: string;
  totalVolume: string;
  totalFees: string;
  transactionCount: number;
  successRate: number;
  averageLatencyMs: number;
}

/** `GET /analytics/metrics` — a metrics time series plus its summary. */
export interface AnalyticsMetricsResponse {
  points: TimeSeriesMetricPoint[];
  summary: VolumeSummary;
}

/**
 * High-level aggregate overview for an organization, wallet, or agent.
 *
 * Returned by `analytics.overview`; the transaction/policy counters power the
 * real-time agent metric dashboards.
 */
export interface AnalyticsOverview {
  /** Total transactions in the window. */
  transactionCount: number;
  /** Transactions blocked by policy in the window. */
  policyViolations: number;
  /** Total volume moved, as a decimal string. */
  totalVolume: string;
  /** Total fees paid, as a decimal string. */
  totalFees: string;
  /** Success rate as a percentage `0`–`100`. */
  successRate: number;
}

/** `GET /analytics/spending` and `GET /analytics/cashflow`. */
export interface CashflowReport {
  currency: string;
  inflow: TimeSeriesPoint[];
  outflow: TimeSeriesPoint[];
  net: TimeSeriesPoint[];
  totalInflow: DecimalString;
  totalOutflow: DecimalString;
}

/** `GET /analytics/risk`. */
export interface RiskReport {
  distribution: Record<RiskBand, number>;
  averageScore: number;
  highRiskTransactions: number;
  trend: TimeSeriesPoint[];
}

/** One agent's line in the agent-performance report. */
export interface AgentSpendingRow {
  agentId: string;
  agentName: string;
  totalSpent: DecimalString;
  transactionCount: number;
  averageRisk: number;
}

/** `GET /analytics/agents`. */
export interface AgentAnalytics {
  currency: string;
  agents: AgentSpendingRow[];
}

/** One budget's line in the budget-utilization report. */
export interface BudgetUtilizationRow {
  budgetId: string;
  budgetName: string;
  limit: DecimalString;
  spent: DecimalString;
  remaining: DecimalString;
  utilization: number;
}

/** `GET /analytics/budgets`. */
export interface BudgetAnalytics {
  currency: string;
  budgets: BudgetUtilizationRow[];
}

/* -------------------------------------------------------------------------- */
/* Metrics aggregation query DTOs (issue #86)                                  */
/* -------------------------------------------------------------------------- */

/** Bucket granularity accepted by the metrics aggregation endpoints. */
export type MetricsInterval = 'hour' | 'day' | 'week' | 'month';

/**
 * Query DTO for `GET /analytics/agents/metrics`.
 *
 * Time range filters (`startDate`/`endDate`) plus an `interval` bucket
 * granularity, optionally scoped to a single agent or wallet. `undefined`
 * fields are omitted from the query string during serialisation.
 */
export interface AgentMetricsParams {
  /** Inclusive start of the reporting window (ISO-8601). */
  startDate?: string;
  /** Exclusive end of the reporting window (ISO-8601). */
  endDate?: string;
  /** Bucket granularity for the report. */
  interval?: MetricsInterval;
  /** Filter results to a single agent. */
  agentId?: string;
  /** Filter results to a single wallet. */
  walletId?: string;
}

/**
 * Query DTO for `GET /analytics/spending/summary`.
 *
 * Aggregated spending totals over a time window, bucketed by `interval`.
 */
export interface SpendingSummaryParams {
  /** Inclusive start of the reporting window (ISO-8601). */
  startDate?: string;
  /** Exclusive end of the reporting window (ISO-8601). */
  endDate?: string;
  /** Bucket granularity for the report. */
  interval?: MetricsInterval;
  /** Filter results to a single currency (e.g. `USD`). */
  currency?: string;
  /** Filter results to a single wallet. */
  walletId?: string;
}

/**
 * Query DTO for `GET /analytics/volume`.
 *
 * Transaction volume and counts over a time window, bucketed by `interval`.
 */
export interface TransactionVolumeParams {
  /** Inclusive start of the reporting window (ISO-8601). */
  startDate?: string;
  /** Exclusive end of the reporting window (ISO-8601). */
  endDate?: string;
  /** Bucket granularity for the report. */
  interval?: MetricsInterval;
  /** Filter results to a single asset code (e.g. `USDC`, `XLM`). */
  asset?: string;
  /** Filter results to a single wallet. */
  walletId?: string;
}

/** One agent's aggregated metrics row. */
export interface AgentMetricsRow {
  agentId: string;
  agentName: string;
  transactionCount: number;
  totalVolume: DecimalString;
  averageRisk: number;
}

/** `GET /analytics/agents/metrics` — per-agent metrics over a time window. */
export interface AgentMetricsReport {
  interval: MetricsInterval;
  startDate?: string;
  endDate?: string;
  agents: AgentMetricsRow[];
}

/** `GET /analytics/spending/summary` — aggregated spending over a time window. */
export interface SpendingSummaryReport {
  interval: MetricsInterval;
  startDate?: string;
  endDate?: string;
  currency: string;
  totalSpent: DecimalString;
  transactionCount: number;
  trend: TimeSeriesPoint[];
}

/** `GET /analytics/volume` — transaction volume over a time window. */
export interface TransactionVolumeReport {
  interval: MetricsInterval;
  startDate?: string;
  endDate?: string;
  totalVolume: DecimalString;
  transactionCount: number;
  points: TimeSeriesPoint[];
}

/* -------------------------------------------------------------------------- */
/* Time-series query DTOs (issue #227)                                          */
/* -------------------------------------------------------------------------- */

/** The metric families the analytics service can aggregate over time. */
export type TimeSeriesMetric =
  | 'transaction_volume'
  | 'fee_expenditure'
  | 'agent_execution_count';

/**
 * Query DTO for `GET /analytics/time-series`.
 *
 * Time range filters (`startDate`/`endDate`) plus an `interval` bucket
 * granularity and one or more `metric` families. Scoping filters (`agentId`,
 * `walletId`, `asset`) are all optional and omitted from the query string when
 * undefined.
 */
export interface TimeSeriesDataParams {
  /** Inclusive start of the reporting window (ISO-8601). */
  startDate?: string;
  /** Exclusive end of the reporting window (ISO-8601). */
  endDate?: string;
  /** Bucket granularity for the report. */
  interval?: MetricsInterval;
  /** A single metric family to aggregate. */
  metric?: TimeSeriesMetric;
  /** Several metric families to aggregate in one request. */
  metrics?: TimeSeriesMetric[];
  /** Filter results to a single agent. */
  agentId?: string;
  /** Filter results to a single wallet. */
  walletId?: string;
  /** Filter results to a single asset code (e.g. `USDC`, `XLM`). */
  asset?: string;
}

/** A single (timestamp, metric, value) point in a time series. */
export interface TimeSeriesDataPoint {
  /** Bucket start (ISO-8601). */
  timestamp: string;
  /** Which metric family this point belongs to. */
  metric: TimeSeriesMetric;
  /** Numeric metric value (count for execution metrics). */
  value: number;
  /** Decimal-string amount for monetary metrics (volume / fee). */
  amount?: DecimalString;
}

/** `GET /analytics/time-series` — a multi-metric time series response. */
export interface TimeSeriesDataResponse {
  /** The bucket granularity the series was grouped by. */
  interval: MetricsInterval;
  /** Inclusive start of the reporting window, echoed back by the API. */
  startDate?: string;
  /** Exclusive end of the reporting window, echoed back by the API. */
  endDate?: string;
  /** Metric families included in `points`. */
  metrics: TimeSeriesMetric[];
  /** The bucketed data points, sorted chronologically. */
  points: TimeSeriesDataPoint[];
}

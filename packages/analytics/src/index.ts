/**
 * `@astroid/analytics` — read-only reporting resource.
 *
 * Thin, typed wrappers over the `GET /analytics/*` endpoints. Every method
 * returns a chart-ready object (time series, distributions, per-agent and
 * per-budget rows) and accepts the shared {@link AnalyticsQuery} filters.
 *
 * @packageDocumentation
 */

import { Resource } from '@astroid/core';
import type {
  AgentAnalytics,
  AgentMetricsParams,
  AgentMetricsReport,
  AgentSpendingRow,
  AnalyticsListParams,
  AnalyticsOverview,
  AnalyticsQuery,
  BudgetAnalytics,
  BudgetUtilizationRow,
  CashflowReport,
  Paginated,
  RiskReport,
  SpendingSummaryParams,
  SpendingSummaryReport,
  TransactionVolumeParams,
  TransactionVolumeReport,
} from '@astroid/types';
// Re-export the aggregated-metrics query helpers (issue #78) from the package
// entry point so consumers can call them directly as well as through
// {@link AnalyticsResource}. These were previously imported but never used,
// which failed the `dts` build (`TS6192: All imports in import declaration are
// unused`).
export {
  AnalyticsQueryResource,
  getAgentExecutionCounts,
  getFeeExpenditure,
  getTransactionVolume,
  buildAnalyticsPath,
  buildAnalyticsQuery,
  resolveTimeRange,
  toIso8601,
  type AgentExecutionCountFilter,
  type AnalyticsGranularity,
  type AnalyticsMetricType,
  type FeeExpenditureFilter,
  type ResolvedTimeRange,
  type TimeRangeFilter,
  type TransactionVolumeFilter,
} from './analytics.js';

export {
  exportToCSV,
  exportToJSON,
  formatTransactionForExport,
  flattenRecordForExport,
  escapeCsvValue,
  type CsvColumn,
  type CsvExportOptions,
  type JsonExportOptions,
} from './exporter.js';

// Publicly re-export the metrics aggregation DTOs (issue #86) so consumers can
// name them without reaching into `@astroid/types`.
export type {
  MetricsInterval,
  AgentMetricsParams,
  AgentMetricsReport,
  AgentMetricsRow,
  SpendingSummaryParams,
  SpendingSummaryReport,
  TransactionVolumeParams,
  TransactionVolumeReport,
} from '@astroid/types';

/**
 * The `analytics` namespace on the Astroid client.
 *
 * All methods are read-only and safe to call frequently; they aggregate over
 * the organization's transactions, agents, and budgets for the requested window
 * and granularity.
 */
export class AnalyticsResource extends Resource {
  /** Headline dashboard metrics plus the spending trend. */
  async overview(query: AnalyticsQuery = {}): Promise<AnalyticsOverview> {
    return this.getData<AnalyticsOverview>('/analytics/overview', { ...query });
  }

  /** Inflow/outflow/net cashflow over the requested window. */
  async cashflow(query: AnalyticsQuery = {}): Promise<CashflowReport> {
    return this.getData<CashflowReport>('/analytics/cashflow', { ...query });
  }

  /** Spending report (alias of the cashflow endpoint's outflow view). */
  async spending(query: AnalyticsQuery = {}): Promise<CashflowReport> {
    return this.getData<CashflowReport>('/analytics/spending', { ...query });
  }

  /** Risk distribution, average score, and trend. */
  async risk(query: AnalyticsQuery = {}): Promise<RiskReport> {
    return this.getData<RiskReport>('/analytics/risk', { ...query });
  }

  /** Per-agent spending and risk breakdown. */
  async agents(query: AnalyticsQuery = {}): Promise<AgentAnalytics> {
    return this.getData<AgentAnalytics>('/analytics/agents', { ...query });
  }

  /** Per-budget utilization breakdown. */
  async budgets(query: AnalyticsQuery = {}): Promise<BudgetAnalytics> {
    return this.getData<BudgetAnalytics>('/analytics/budgets', { ...query });
  }

  /**
   * Densely paginated per-agent performance rows.
   *
   * Unlike {@link AnalyticsResource.agents} (which returns the full aggregate
   * in one payload), this endpoint is cursor/page-aware so clients can page
   * through large historical sets without loading everything at once. Accepts
   * the shared {@link AnalyticsListParams} filters plus pagination controls.
   */
  async listAgents(query: AnalyticsListParams = {}): Promise<Paginated<AgentSpendingRow>> {
    return this.listData<AgentSpendingRow>('/analytics/agents', { ...query });
  }

  /**
   * Densely paginated per-budget utilization rows.
   *
   * Use when there are many budgets and you want to page through them with
   * `page`/`limit`/`order` rather than fetch every row in a single response.
   */
  async listBudgets(query: AnalyticsListParams = {}): Promise<Paginated<BudgetUtilizationRow>> {
    return this.listData<BudgetUtilizationRow>('/analytics/budgets', { ...query });
  }

  /* ------------------------- metrics aggregation ------------------------- */

  /**
   * Per-agent metrics (transaction count, volume, average risk) over a time
   * window, bucketed by `interval`.
   *
   * Query parameters are serialised into the URL query string; `undefined`
   * fields are omitted.
   *
   * @example
   * ```ts
   * const report = await astroid.analytics.getAgentMetrics({
   *   startDate: '2026-01-01T00:00:00.000Z',
   *   endDate: '2026-02-01T00:00:00.000Z',
   *   interval: 'day',
   * });
   * ```
   */
  async getAgentMetrics(query: AgentMetricsParams = {}): Promise<AgentMetricsReport> {
    return this.getData<AgentMetricsReport>('/analytics/agents/metrics', { ...query });
  }

  /**
   * Aggregated spending summary (total spent, transaction count, trend) over a
   * time window, bucketed by `interval`.
   */
  async getSpendingSummary(query: SpendingSummaryParams = {}): Promise<SpendingSummaryReport> {
    return this.getData<SpendingSummaryReport>('/analytics/spending/summary', { ...query });
  }

  /**
   * Transaction volume and counts over a time window, bucketed by `interval`.
   */
  async getTransactionVolume(query: TransactionVolumeParams = {}): Promise<TransactionVolumeReport> {
    return this.getData<TransactionVolumeReport>('/analytics/volume', { ...query });
  }
}

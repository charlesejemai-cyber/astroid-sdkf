import type { HttpClient } from '@astroid/core';
import type {
  AnalyticsMetricsResponse,
  AnalyticsOverview,
  AnalyticsQueryParams,
  VolumeSummary,
} from '@astroid/types';

/**
 * Serialize analytics query parameters — including pagination — into a
 * URLSearchParams instance, skipping undefined values.
 */
function toSearchParams(params?: AnalyticsQueryParams): URLSearchParams {
  const searchParams = new URLSearchParams();
  if (!params) return searchParams;
  if (params.startDate) searchParams.set('startDate', params.startDate);
  if (params.endDate) searchParams.set('endDate', params.endDate);
  if (params.timeframe) searchParams.set('timeframe', params.timeframe);
  if (params.asset) searchParams.set('asset', params.asset);
  if (params.walletId) searchParams.set('walletId', params.walletId);
  if (params.agentId) searchParams.set('agentId', params.agentId);
  // Standard pagination arguments shared across resource packages.
  if (params.cursor) searchParams.set('cursor', params.cursor);
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params.order) searchParams.set('order', params.order);
  return searchParams;
}

export class AnalyticsResource {
  constructor(private readonly client: HttpClient) {}

  /**
   * Fetch time-series analytics metrics matching the given parameters.
   *
   * Accepts optional {@link PaginationParams} (cursor / limit / order) for
   * paging through large metric sets.
   */
  async getMetrics(params?: AnalyticsQueryParams): Promise<AnalyticsMetricsResponse> {
    const searchParams = toSearchParams(params);
    const query = searchParams.toString();
    const path = query ? `/analytics/metrics?${query}` : '/analytics/metrics';
    const res = await this.client.get<AnalyticsMetricsResponse>(path);
    return res.data;
  }

  /**
   * Fetch summary statistics for a given timeframe or query.
   *
   * Accepts optional {@link PaginationParams} (cursor / limit / order) when a
   * params object is supplied.
   */
  async getVolumeSummary(
    timeframeOrParams?: string | AnalyticsQueryParams,
  ): Promise<VolumeSummary> {
    const searchParams = new URLSearchParams();
    if (typeof timeframeOrParams === 'string') {
      searchParams.set('timeframe', timeframeOrParams);
    } else {
      const merged = toSearchParams(timeframeOrParams);
      for (const [key, value] of merged.entries()) {
        searchParams.set(key, value);
      }
    }

    const query = searchParams.toString();
    const path = query ? `/analytics/summary?${query}` : '/analytics/summary';
    const res = await this.client.get<VolumeSummary>(path);
    return res.data;
  }

  /**
   * Fetch a high-level aggregate overview for an organization, wallet, or agent.
   *
   * @param params Optional scoping (startDate, endDate, walletId, agentId).
   */
  async overview(params?: AnalyticsQueryParams): Promise<AnalyticsOverview> {
    const searchParams = new URLSearchParams();
    if (params) {
      if (params.startDate) searchParams.set('startDate', params.startDate);
      if (params.endDate) searchParams.set('endDate', params.endDate);
      if (params.timeframe) searchParams.set('timeframe', params.timeframe);
      if (params.walletId) searchParams.set('walletId', params.walletId);
      if (params.agentId) searchParams.set('agentId', params.agentId);
    }

    const query = searchParams.toString();
    const path = query ? `/analytics/overview?${query}` : '/analytics/overview';
    const res = await this.client.get<AnalyticsOverview>(path);
    return res.data;
  }
}

/**
 * Helper function for backward compatibility with existing aggregateTransactionMetrics
 */
export { aggregateTransactionMetrics } from './aggregations.js';

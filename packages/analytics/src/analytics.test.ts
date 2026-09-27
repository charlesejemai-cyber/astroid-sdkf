import { describe, expect, it, vi } from 'vitest';
import {
  AnalyticsQueryResource,
  buildAnalyticsPath,
  buildAnalyticsQuery,
  getAgentExecutionCounts,
  getFeeExpenditure,
  getTransactionVolume,
  resolveTimeRange,
  toIso8601,
} from './analytics.js';
import type { HttpClient } from '@astroid/core';
import type { AgentAnalytics, AnalyticsMetricsResponse, VolumeSummary } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const SUMMARY: VolumeSummary = {
  timeframe: 'day',
  totalVolume: '12500.75',
  totalFees: '12.50',
  transactionCount: 42,
  successRate: 0.95,
  averageLatencyMs: 180,
};

const METRICS_RESPONSE: AnalyticsMetricsResponse = {
  points: [
    {
      timestamp: '2026-01-01T00:00:00.000Z',
      volume: '12500.75',
      fee: '12.50',
      count: 42,
      successCount: 40,
      failureCount: 2,
    },
  ],
  summary: SUMMARY,
};

const AGENT_ANALYTICS: AgentAnalytics = {
  currency: 'USDC',
  agents: [
    {
      agentId: 'agt_1',
      agentName: 'Payment Bot',
      totalSpent: '500.00',
      transactionCount: 25,
      averageRisk: 8,
    },
  ],
};

function makeClient() {
  const get = vi.fn();
  const client = { get } as unknown as HttpClient;
  return { client, get };
}

/* -------------------------------------------------------------------------- */
/* Time-range helpers                                                          */
/* -------------------------------------------------------------------------- */

describe('toIso8601', () => {
  it('serializes a Date to an ISO-8601 UTC string', () => {
    expect(toIso8601(new Date('2026-01-01T12:30:00.000Z'))).toBe('2026-01-01T12:30:00.000Z');
  });

  it('normalizes an ISO-8601 string', () => {
    expect(toIso8601('2026-02-01T00:00:00Z')).toBe('2026-02-01T00:00:00.000Z');
  });

  it('returns undefined for missing or invalid values', () => {
    expect(toIso8601(undefined)).toBeUndefined();
    expect(toIso8601('not-a-date')).toBeUndefined();
  });
});

describe('resolveTimeRange', () => {
  it('prefers startDate/endDate over the from/to aliases', () => {
    expect(
      resolveTimeRange({
        startDate: '2026-01-01T00:00:00.000Z',
        from: '2025-01-01T00:00:00.000Z',
        endDate: '2026-02-01T00:00:00.000Z',
        to: '2025-02-01T00:00:00.000Z',
      }),
    ).toEqual({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-02-01T00:00:00.000Z',
    });
  });

  it('falls back to from/to and maps granularity to timeframe', () => {
    expect(
      resolveTimeRange({ from: '2026-01-01', to: '2026-01-31', granularity: 'week' }),
    ).toEqual({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-31T00:00:00.000Z',
      timeframe: 'week',
    });
  });

  it('returns an empty object for an empty filter', () => {
    expect(resolveTimeRange()).toEqual({});
  });
});

describe('buildAnalyticsQuery', () => {
  it('serializes the metric, ISO window, granularity, and scope', () => {
    const params = buildAnalyticsQuery(
      {
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: '2026-02-01T00:00:00.000Z',
        granularity: 'day',
        asset: 'USDC',
        walletId: 'wal_1',
        agentId: 'agt_1',
        order: 'desc',
        limit: 50,
      },
      'transaction_volume',
    );

    expect(params.get('metric')).toBe('transaction_volume');
    expect(params.get('startDate')).toBe('2026-01-01T00:00:00.000Z');
    expect(params.get('endDate')).toBe('2026-02-01T00:00:00.000Z');
    expect(params.get('timeframe')).toBe('day');
    expect(params.get('asset')).toBe('USDC');
    expect(params.get('walletId')).toBe('wal_1');
    expect(params.get('agentId')).toBe('agt_1');
    expect(params.get('order')).toBe('desc');
    expect(params.get('limit')).toBe('50');
  });

  it('omits undefined values and invalid dates', () => {
    const params = buildAnalyticsQuery({ startDate: 'garbage', asset: 'XLM' });
    expect(params.has('startDate')).toBe(false);
    expect(params.has('endDate')).toBe(false);
    expect(params.get('asset')).toBe('XLM');
  });
});

describe('buildAnalyticsPath', () => {
  it('joins the default metrics route with the query string', () => {
    const path = buildAnalyticsPath(
      { startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-02T00:00:00.000Z' },
      'fee_expenditure',
    );
    expect(path.startsWith('/analytics/metrics?')).toBe(true);
    expect(path).toContain('metric=fee_expenditure');
    expect(path).toContain('startDate=2026-01-01T00%3A00%3A00.000Z');
  });

  it('supports a custom base path and returns it bare when there are no filters', () => {
    expect(buildAnalyticsPath({}, undefined, '/analytics/agents')).toBe('/analytics/agents');
  });
});

/* -------------------------------------------------------------------------- */
/* Query methods                                                               */
/* -------------------------------------------------------------------------- */

describe('getTransactionVolume', () => {
  it('requests the metrics endpoint and returns the summary', async () => {
    const { client, get } = makeClient();
    get.mockResolvedValue({ data: METRICS_RESPONSE });

    const summary = await getTransactionVolume(client, {
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-02-01T00:00:00.000Z',
      granularity: 'day',
    });

    expect(get).toHaveBeenCalledOnce();
    const path = get.mock.calls[0]![0] as string;
    expect(path).toContain('/analytics/metrics?');
    expect(path).toContain('metric=transaction_volume');
    expect(path).toContain('timeframe=day');
    expect(summary).toEqual(SUMMARY);
    expect(summary.totalVolume).toBe('12500.75');
  });

  it('works with no filter', async () => {
    const { client, get } = makeClient();
    get.mockResolvedValue({ data: METRICS_RESPONSE });
    await getTransactionVolume(client);
    expect(get.mock.calls[0]![0]).toBe('/analytics/metrics?metric=transaction_volume');
  });
});

describe('getFeeExpenditure', () => {
  it('returns the fee total from the summary', async () => {
    const { client, get } = makeClient();
    get.mockResolvedValue({ data: METRICS_RESPONSE });

    const summary = await getFeeExpenditure(client, {
      from: '2026-01-01',
      to: '2026-02-01',
      granularity: 'week',
    });

    const path = get.mock.calls[0]![0] as string;
    expect(path).toContain('metric=fee_expenditure');
    expect(path).toContain('timeframe=week');
    expect(summary.totalFees).toBe('12.50');
  });
});

describe('getAgentExecutionCounts', () => {
  it('requests the agents endpoint with the time window', async () => {
    const { client, get } = makeClient();
    get.mockResolvedValue({ data: AGENT_ANALYTICS });

    const result = await getAgentExecutionCounts(client, {
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-02-01T00:00:00.000Z',
      agentId: 'agt_1',
    });

    const path = get.mock.calls[0]![0] as string;
    expect(path.startsWith('/analytics/agents?')).toBe(true);
    expect(path).toContain('startDate=2026-01-01T00%3A00%3A00.000Z');
    expect(path).toContain('agentId=agt_1');
    expect(result.agents[0]!.transactionCount).toBe(25);
  });
});

/* -------------------------------------------------------------------------- */
/* Resource wrapper                                                            */
/* -------------------------------------------------------------------------- */

describe('AnalyticsQueryResource', () => {
  it('delegates every query method to the standalone helpers', async () => {
    const { client, get } = makeClient();
    get
      .mockResolvedValueOnce({ data: METRICS_RESPONSE })
      .mockResolvedValueOnce({ data: METRICS_RESPONSE })
      .mockResolvedValueOnce({ data: AGENT_ANALYTICS });

    const resource = new AnalyticsQueryResource(client);

    await expect(resource.getTransactionVolume()).resolves.toEqual(SUMMARY);
    await expect(resource.getFeeExpenditure()).resolves.toEqual(SUMMARY);
    await expect(resource.getAgentExecutionCounts()).resolves.toEqual(AGENT_ANALYTICS);
    expect(get).toHaveBeenCalledTimes(3);
  });
});

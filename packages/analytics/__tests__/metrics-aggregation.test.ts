import { describe, it, expect, vi } from 'vitest';
import { HttpClient } from '@astroid/core';
import { AnalyticsResource } from '../src/index.js';
import type { AgentMetricsReport, SpendingSummaryReport, TransactionVolumeReport } from '@astroid/types';

/** Build a resource backed by a fetch mock so real URL serialisation is asserted. */
function resourceWithFetch(body: unknown): { resource: AnalyticsResource; fetchMock: ReturnType<typeof vi.fn> } {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  const client = new HttpClient({
    baseUrl: 'https://api.test',
    apiVersion: 'v1',
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { resource: new AnalyticsResource(client), fetchMock };
}

function requestedUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  return fetchMock.mock.calls[0]![0] as string;
}

describe('AnalyticsResource.getAgentMetrics', () => {
  it('serialises time range and interval query parameters into the URL', async () => {
    const report: AgentMetricsReport = {
      interval: 'day',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-02-01T00:00:00.000Z',
      agents: [
        { agentId: 'agt_1', agentName: 'Ops', transactionCount: 4, totalVolume: '120.5', averageRisk: 0.1 },
      ],
    };
    const { resource, fetchMock } = resourceWithFetch({ data: report });

    const result = await resource.getAgentMetrics({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-02-01T00:00:00.000Z',
      interval: 'day',
      agentId: 'agt_1',
    });

    const url = new URL(requestedUrl(fetchMock));
    expect(url.pathname).toBe('/v1/analytics/agents/metrics');
    expect(url.searchParams.get('startDate')).toBe('2026-01-01T00:00:00.000Z');
    expect(url.searchParams.get('endDate')).toBe('2026-02-01T00:00:00.000Z');
    expect(url.searchParams.get('interval')).toBe('day');
    expect(url.searchParams.get('agentId')).toBe('agt_1');

    // API response parsing: the envelope is unwrapped to the typed report.
    expect(result).toEqual(report);
    expect(result.agents[0]!.totalVolume).toBe('120.5');
  });

  it('omits undefined query parameters entirely', async () => {
    const { resource, fetchMock } = resourceWithFetch({
      data: { interval: 'day', agents: [] } satisfies AgentMetricsReport,
    });

    await resource.getAgentMetrics({ interval: 'day' });

    const url = new URL(requestedUrl(fetchMock));
    expect(url.searchParams.get('interval')).toBe('day');
    expect(url.searchParams.has('startDate')).toBe(false);
    expect(url.searchParams.has('endDate')).toBe(false);
    expect(url.searchParams.has('agentId')).toBe(false);
    expect(url.searchParams.has('walletId')).toBe(false);
  });
});

describe('AnalyticsResource.getSpendingSummary', () => {
  it('serialises filters and parses the spending summary response', async () => {
    const summary: SpendingSummaryReport = {
      interval: 'week',
      currency: 'USD',
      totalSpent: '9800.00',
      transactionCount: 42,
      trend: [{ date: '2026-01-05', value: 1500 }],
    };
    const { resource, fetchMock } = resourceWithFetch({ data: summary });

    const result = await resource.getSpendingSummary({
      startDate: '2026-01-01T00:00:00.000Z',
      interval: 'week',
      currency: 'USD',
      walletId: 'wal_1',
    });

    const url = new URL(requestedUrl(fetchMock));
    expect(url.pathname).toBe('/v1/analytics/spending/summary');
    expect(url.searchParams.get('startDate')).toBe('2026-01-01T00:00:00.000Z');
    expect(url.searchParams.get('interval')).toBe('week');
    expect(url.searchParams.get('currency')).toBe('USD');
    expect(url.searchParams.get('walletId')).toBe('wal_1');
    expect(url.searchParams.has('endDate')).toBe(false);

    expect(result).toEqual(summary);
    expect(result.trend[0]!.value).toBe(1500);
  });

  it('requests with an empty query string when called with no params', async () => {
    const { resource, fetchMock } = resourceWithFetch({
      data: { interval: 'day', currency: 'USD', totalSpent: '0', transactionCount: 0, trend: [] } satisfies SpendingSummaryReport,
    });

    await resource.getSpendingSummary();

    const url = new URL(requestedUrl(fetchMock));
    expect(url.search).toBe('');
  });
});

describe('AnalyticsResource.getTransactionVolume', () => {
  it('serialises asset/wallet filters and parses the volume response', async () => {
    const volume: TransactionVolumeReport = {
      interval: 'month',
      totalVolume: '123456.78',
      transactionCount: 900,
      points: [{ date: '2026-01-01', value: 1000 }],
    };
    const { resource, fetchMock } = resourceWithFetch({ data: volume });

    const result = await resource.getTransactionVolume({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-07-01T00:00:00.000Z',
      interval: 'month',
      asset: 'USDC',
      walletId: 'wal_9',
    });

    const url = new URL(requestedUrl(fetchMock));
    expect(url.pathname).toBe('/v1/analytics/volume');
    expect(url.searchParams.get('startDate')).toBe('2026-01-01T00:00:00.000Z');
    expect(url.searchParams.get('endDate')).toBe('2026-07-01T00:00:00.000Z');
    expect(url.searchParams.get('interval')).toBe('month');
    expect(url.searchParams.get('asset')).toBe('USDC');
    expect(url.searchParams.get('walletId')).toBe('wal_9');

    expect(result).toEqual(volume);
    expect(result.transactionCount).toBe(900);
  });

  it('handles a bare (non-enveloped) payload for resilience', async () => {
    const { resource } = resourceWithFetch({
      interval: 'day',
      totalVolume: '10',
      transactionCount: 1,
      points: [],
    } satisfies TransactionVolumeReport);

    const result = await resource.getTransactionVolume();
    expect(result.totalVolume).toBe('10');
  });
});

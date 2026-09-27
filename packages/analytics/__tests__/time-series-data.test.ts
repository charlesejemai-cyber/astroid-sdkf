import { describe, expect, it, vi } from 'vitest';

import type { HttpClient } from '@astroid/core';
import type { TimeSeriesDataResponse } from '@astroid/types';

import { AnalyticsResource } from '../src/index.js';

const RESPONSE: TimeSeriesDataResponse = {
  interval: 'day',
  startDate: '2026-01-01T00:00:00.000Z',
  endDate: '2026-01-03T00:00:00.000Z',
  metrics: ['transaction_volume', 'fee_expenditure'],
  points: [
    {
      timestamp: '2026-01-01T00:00:00.000Z',
      metric: 'transaction_volume',
      value: 1500.5,
      amount: '1500.5',
    },
    {
      timestamp: '2026-01-01T00:00:00.000Z',
      metric: 'fee_expenditure',
      value: 0.001,
      amount: '0.001',
    },
  ],
};

function createResource() {
  const mockGet = vi.fn().mockResolvedValue({ data: RESPONSE });
  const client = { get: mockGet } as unknown as HttpClient;
  return { resource: new AnalyticsResource(client), mockGet };
}

describe('AnalyticsResource.getTimeSeriesData', () => {
  it('requests /analytics/time-series and unwraps the response', async () => {
    const { resource, mockGet } = createResource();

    const result = await resource.getTimeSeriesData({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-03T00:00:00.000Z',
      interval: 'day',
    });

    expect(result).toEqual(RESPONSE);
    const [path, options] = mockGet.mock.calls[0]!;
    expect(path).toBe('/analytics/time-series');
    expect(options).toEqual({
      query: {
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-03T00:00:00.000Z',
        interval: 'day',
      },
    });
  });

  it('forwards multiple metric families and scope filters', async () => {
    const { resource, mockGet } = createResource();

    await resource.getTimeSeriesData({
      metrics: ['transaction_volume', 'fee_expenditure'],
      agentId: 'agent_123',
      walletId: 'wallet_1',
      asset: 'USDC',
    });

    const [, options] = mockGet.mock.calls[0]! as [string, { query: Record<string, unknown> }];
    expect(options.query).toEqual({
      metrics: ['transaction_volume', 'fee_expenditure'],
      agentId: 'agent_123',
      walletId: 'wallet_1',
      asset: 'USDC',
    });
  });

  it('omits undefined parameters', async () => {
    const { resource, mockGet } = createResource();

    await resource.getTimeSeriesData({ interval: 'hour' });

    const [, options] = mockGet.mock.calls[0]! as [string, { query: Record<string, unknown> }];
    expect(options.query).toEqual({ interval: 'hour' });
  });

  it('handles a single metric selector', async () => {
    const { resource, mockGet } = createResource();

    await resource.getTimeSeriesData({ metric: 'agent_execution_count' });

    const [, options] = mockGet.mock.calls[0]! as [string, { query: Record<string, unknown> }];
    expect(options.query).toEqual({ metric: 'agent_execution_count' });
  });
});

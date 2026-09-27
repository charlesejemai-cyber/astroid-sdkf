import { describe, it, expect, vi } from 'vitest';
import {
  TimeSeriesResource,
  buildTimeSeriesQuery,
  buildTimeSeriesPath,
  validateTimeSeriesQuery,
  TimeSeriesQueryError,
  INTERVAL_TO_TIMEFRAME,
  type TimeSeriesInterval,
} from '../time-series.js';
import type { HttpClient } from '@astroid/core';
import type { AnalyticsMetricsResponse } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Shared fixtures                                                             */
/* -------------------------------------------------------------------------- */

const MOCK_RESPONSE: AnalyticsMetricsResponse = {
  points: [
    {
      timestamp: '2026-01-01T00:00:00.000Z',
      volume: '1500.50',
      fee: '0.001',
      count: 12,
      successCount: 10,
      failureCount: 2,
    },
    {
      timestamp: '2026-01-02T00:00:00.000Z',
      volume: '2300.75',
      fee: '0.002',
      count: 18,
      successCount: 17,
      failureCount: 1,
    },
  ],
  summary: {
    timeframe: 'day',
    totalVolume: '3801.25',
    totalFees: '0.003',
    transactionCount: 30,
    successRate: 0.9,
    averageLatencyMs: 150,
  },
};

function createMockClient(response: AnalyticsMetricsResponse = MOCK_RESPONSE) {
  const mockGet = vi.fn().mockResolvedValue({ data: response });
  const client = { get: mockGet } as unknown as HttpClient;
  return { client, mockGet };
}

/* -------------------------------------------------------------------------- */
/* validateTimeSeriesQuery                                                     */
/* -------------------------------------------------------------------------- */

describe('validateTimeSeriesQuery', () => {
  it('accepts valid parameters', () => {
    expect(() =>
      validateTimeSeriesQuery({
        interval: 'day',
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2026-01-02T00:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('accepts all valid intervals', () => {
    for (const interval of ['hour', 'day', 'week'] as const) {
      expect(() =>
        validateTimeSeriesQuery({
          interval,
          startTime: '2026-01-01T00:00:00.000Z',
          endTime: '2026-01-02T00:00:00.000Z',
        }),
      ).not.toThrow();
    }
  });

  it('throws when interval is empty', () => {
    expect(() =>
      validateTimeSeriesQuery({
        interval: '' as TimeSeriesInterval,
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2026-01-02T00:00:00.000Z',
      }),
    ).toThrow(TimeSeriesQueryError);
  });

  it('throws for unsupported interval values', () => {
    expect(() =>
      validateTimeSeriesQuery({
        interval: 'month' as TimeSeriesInterval,
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2026-01-02T00:00:00.000Z',
      }),
    ).toThrow('Invalid interval "month"');
  });

  it('throws for another unsupported interval', () => {
    expect(() =>
      validateTimeSeriesQuery({
        interval: 'year' as TimeSeriesInterval,
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2026-01-02T00:00:00.000Z',
      }),
    ).toThrow('Invalid interval');
  });

  it('throws when startTime is missing', () => {
    expect(() =>
      validateTimeSeriesQuery({
        interval: 'day',
        startTime: '',
        endTime: '2026-01-02T00:00:00.000Z',
      }),
    ).toThrow('startTime is required');
  });

  it('throws when endTime is missing', () => {
    expect(() =>
      validateTimeSeriesQuery({
        interval: 'day',
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '',
      }),
    ).toThrow('endTime is required');
  });

  it('throws for unparseable startTime', () => {
    expect(() =>
      validateTimeSeriesQuery({
        interval: 'day',
        startTime: 'not-a-date',
        endTime: '2026-01-02T00:00:00.000Z',
      }),
    ).toThrow('Invalid startTime');
  });

  it('throws for unparseable endTime', () => {
    expect(() =>
      validateTimeSeriesQuery({
        interval: 'day',
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: 'garbage',
      }),
    ).toThrow('Invalid endTime');
  });

  it('throws when startTime equals endTime', () => {
    expect(() =>
      validateTimeSeriesQuery({
        interval: 'day',
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow('startTime must be before endTime');
  });

  it('throws when startTime is after endTime', () => {
    expect(() =>
      validateTimeSeriesQuery({
        interval: 'day',
        startTime: '2026-01-05T00:00:00.000Z',
        endTime: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow('startTime must be before endTime');
  });

  it('uses TimeSeriesQueryError as the error name', () => {
    try {
      validateTimeSeriesQuery({
        interval: 'day',
        startTime: '',
        endTime: '',
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TimeSeriesQueryError);
      expect((err as TimeSeriesQueryError).name).toBe('TimeSeriesQueryError');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* buildTimeSeriesQuery                                                        */
/* -------------------------------------------------------------------------- */

describe('buildTimeSeriesQuery', () => {
  it('serializes required parameters', () => {
    const params = buildTimeSeriesQuery({
      interval: 'hour',
      startTime: '2026-06-01T00:00:00.000Z',
      endTime: '2026-06-02T00:00:00.000Z',
    });

    expect(params.get('interval')).toBe('hour');
    expect(params.get('startTime')).toBe('2026-06-01T00:00:00.000Z');
    expect(params.get('endTime')).toBe('2026-06-02T00:00:00.000Z');
  });

  it('preserves parameter ordering', () => {
    const params = buildTimeSeriesQuery({
      interval: 'day',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-02T00:00:00.000Z',
    });

    const keys = [...params.keys()];
    expect(keys).toEqual(['interval', 'startTime', 'endTime']);
  });

  it('includes optional filters when provided', () => {
    const params = buildTimeSeriesQuery({
      interval: 'day',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-02-01T00:00:00.000Z',
      asset: 'USDC',
      walletId: 'w_abc',
      agentId: 'ag_123',
    });

    expect(params.get('asset')).toBe('USDC');
    expect(params.get('walletId')).toBe('w_abc');
    expect(params.get('agentId')).toBe('ag_123');
  });

  it('omits optional filters when not provided', () => {
    const params = buildTimeSeriesQuery({
      interval: 'week',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-08T00:00:00.000Z',
    });

    expect(params.has('asset')).toBe(false);
    expect(params.has('walletId')).toBe(false);
    expect(params.has('agentId')).toBe(false);
  });

  it('returns a URLSearchParams instance', () => {
    const params = buildTimeSeriesQuery({
      interval: 'day',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-02T00:00:00.000Z',
    });

    expect(params).toBeInstanceOf(URLSearchParams);
  });

  it('encodes special characters in values', () => {
    const params = buildTimeSeriesQuery({
      interval: 'day',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-02T00:00:00.000Z',
      walletId: 'w=a&b',
    });

    expect(params.get('walletId')).toBe('w=a&b');
    // Serialised form should be percent-encoded
    const serialised = params.toString();
    expect(serialised).toContain('walletId=w%3Da%26b');
  });

  it('handles all interval types', () => {
    for (const interval of ['hour', 'day', 'week'] as const) {
      const params = buildTimeSeriesQuery({
        interval,
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2026-01-02T00:00:00.000Z',
      });
      expect(params.get('interval')).toBe(interval);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* buildTimeSeriesPath                                                         */
/* -------------------------------------------------------------------------- */

describe('buildTimeSeriesPath', () => {
  it('builds a path with the default base route', () => {
    const path = buildTimeSeriesPath({
      interval: 'day',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-02T00:00:00.000Z',
    });

    expect(path).toMatch(/^\/analytics\/time-series\?/);
    expect(path).toContain('interval=day');
  });

  it('percent-encodes ISO timestamps in the query string', () => {
    const path = buildTimeSeriesPath({
      interval: 'day',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-02T00:00:00.000Z',
    });

    // Colons in timestamps should be percent-encoded by URLSearchParams
    expect(path).toContain('startTime=2026-01-01T00%3A00%3A00.000Z');
    expect(path).toContain('endTime=2026-01-02T00%3A00%3A00.000Z');
  });

  it('supports a custom base path', () => {
    const path = buildTimeSeriesPath(
      {
        interval: 'hour',
        startTime: '2026-06-01T00:00:00.000Z',
        endTime: '2026-06-01T01:00:00.000Z',
      },
      '/v2/analytics/buckets',
    );

    expect(path).toMatch(/^\/v2\/analytics\/buckets\?/);
    expect(path).toContain('interval=hour');
  });

  it('includes all optional filters in the query string', () => {
    const path = buildTimeSeriesPath({
      interval: 'day',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-31T00:00:00.000Z',
      asset: 'XLM',
      walletId: 'w_1',
      agentId: 'ag_99',
    });

    expect(path).toContain('asset=XLM');
    expect(path).toContain('walletId=w_1');
    expect(path).toContain('agentId=ag_99');
  });

  it('formats the path correctly end-to-end', () => {
    const path = buildTimeSeriesPath({
      interval: 'week',
      startTime: '2026-03-02T00:00:00.000Z',
      endTime: '2026-03-09T00:00:00.000Z',
    });

    // Should start with base path and contain a single `?`
    expect(path.startsWith('/analytics/time-series?')).toBe(true);
    expect(path.indexOf('?')).toBe(path.lastIndexOf('?'));
    expect(path).toContain('interval=week');
    expect(path).toContain('startTime=');
    expect(path).toContain('endTime=');
  });
});

/* -------------------------------------------------------------------------- */
/* TimeSeriesResource                                                          */
/* -------------------------------------------------------------------------- */

describe('TimeSeriesResource', () => {
  it('fetches time-series metrics with serialized query parameters', async () => {
    const { client, mockGet } = createMockClient();
    const resource = new TimeSeriesResource(client);

    const result = await resource.getMetrics({
      interval: 'day',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-03T00:00:00.000Z',
      asset: 'USDC',
    });

    expect(mockGet).toHaveBeenCalledOnce();

    const calledPath = mockGet.mock.calls[0]![0] as string;
    expect(calledPath).toContain('/analytics/time-series?');
    expect(calledPath).toContain('interval=day');
    expect(calledPath).toContain('asset=USDC');
    expect(calledPath).toContain('startTime=2026-01-01T00%3A00%3A00.000Z');
    expect(calledPath).toContain('endTime=2026-01-03T00%3A00%3A00.000Z');

    expect(result.points).toHaveLength(2);
    expect(result.summary.totalVolume).toBe('3801.25');
    expect(result.summary.successRate).toBe(0.9);
  });

  it('throws TimeSeriesQueryError for invalid interval without calling the API', async () => {
    const { client, mockGet } = createMockClient();
    const resource = new TimeSeriesResource(client);

    await expect(
      resource.getMetrics({
        interval: 'month' as TimeSeriesInterval,
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2026-01-02T00:00:00.000Z',
      }),
    ).rejects.toThrow(TimeSeriesQueryError);

    expect(mockGet).not.toHaveBeenCalled();
  });

  it('throws for invalid startTime without calling the API', async () => {
    const { client, mockGet } = createMockClient();
    const resource = new TimeSeriesResource(client);

    await expect(
      resource.getMetrics({
        interval: 'day',
        startTime: 'not-a-date',
        endTime: '2026-01-02T00:00:00.000Z',
      }),
    ).rejects.toThrow('Invalid startTime');

    expect(mockGet).not.toHaveBeenCalled();
  });

  it('throws when start equals end without calling the API', async () => {
    const { client, mockGet } = createMockClient();
    const resource = new TimeSeriesResource(client);

    await expect(
      resource.getMetrics({
        interval: 'day',
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toThrow('startTime must be before endTime');

    expect(mockGet).not.toHaveBeenCalled();
  });

  it('serialises all optional filters into the request path', async () => {
    const { client, mockGet } = createMockClient();
    const resource = new TimeSeriesResource(client);

    await resource.getMetrics({
      interval: 'hour',
      startTime: '2026-06-01T00:00:00.000Z',
      endTime: '2026-06-01T06:00:00.000Z',
      asset: 'XLM',
      walletId: 'w_abc',
      agentId: 'ag_1',
    });

    const calledPath = mockGet.mock.calls[0]![0] as string;
    expect(calledPath).toContain('interval=hour');
    expect(calledPath).toContain('asset=XLM');
    expect(calledPath).toContain('walletId=w_abc');
    expect(calledPath).toContain('agentId=ag_1');
  });

  it('returns the parsed response from the API', async () => {
    const customResponse: AnalyticsMetricsResponse = {
      points: [
        {
          timestamp: '2026-07-01T00:00:00.000Z',
          volume: '5000',
          fee: '0.01',
          count: 42,
          successCount: 40,
          failureCount: 2,
        },
      ],
      summary: {
        timeframe: 'day',
        totalVolume: '5000',
        totalFees: '0.01',
        transactionCount: 42,
        successRate: 0.952,
        averageLatencyMs: 200,
      },
    };

    const { client } = createMockClient(customResponse);
    const resource = new TimeSeriesResource(client);

    const result = await resource.getMetrics({
      interval: 'day',
      startTime: '2026-07-01T00:00:00.000Z',
      endTime: '2026-07-02T00:00:00.000Z',
    });

    expect(result.points[0]?.volume).toBe('5000');
    expect(result.points[0]?.count).toBe(42);
    expect(result.summary.transactionCount).toBe(42);
    expect(result.summary.averageLatencyMs).toBe(200);
  });

  it('works with weekly intervals', async () => {
    const { client, mockGet } = createMockClient();
    const resource = new TimeSeriesResource(client);

    await resource.getMetrics({
      interval: 'week',
      startTime: '2026-03-02T00:00:00.000Z',
      endTime: '2026-03-09T00:00:00.000Z',
    });

    const calledPath = mockGet.mock.calls[0]![0] as string;
    expect(calledPath).toContain('interval=week');
  });
});

/* -------------------------------------------------------------------------- */
/* INTERVAL_TO_TIMEFRAME                                                       */
/* -------------------------------------------------------------------------- */

describe('INTERVAL_TO_TIMEFRAME', () => {
  it('maps all interval values to their Timeframe counterparts', () => {
    expect(INTERVAL_TO_TIMEFRAME.hour).toBe('hour');
    expect(INTERVAL_TO_TIMEFRAME.day).toBe('day');
    expect(INTERVAL_TO_TIMEFRAME.week).toBe('week');
  });

  it('contains exactly three entries', () => {
    expect(Object.keys(INTERVAL_TO_TIMEFRAME)).toHaveLength(3);
  });
});

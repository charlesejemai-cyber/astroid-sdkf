import { describe, it, expect } from 'vitest';
import {
  buildAnalyticsQuery,
  buildAnalyticsPath,
  validateAnalyticsQuery,
  AnalyticsQueryError,
  getDateRangeFromPreset,
  applyTimeWindowPreset,
  buildOverviewQuery,
  buildCashflowQuery,
  buildSpendingQuery,
  buildRiskQuery,
  buildAgentsQuery,
  buildBudgetsQuery,
  buildListAgentsQuery,
  buildListBudgetsQuery,
  type AnalyticsQueryOptions,
  type TimeWindowPreset,
  type Timeframe,
  type AnalyticsGroupBy,
} from '../query.js';

/* -------------------------------------------------------------------------- */
/* validateAnalyticsQuery                                                      */
/* -------------------------------------------------------------------------- */

describe('validateAnalyticsQuery', () => {
  const validBase: AnalyticsQueryOptions = {
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-01-31T00:00:00.000Z',
  };

  it('accepts valid parameters with startDate/endDate', () => {
    expect(() => validateAnalyticsQuery(validBase)).not.toThrow();
  });

  it('accepts valid parameters with from/to aliases', () => {
    expect(() =>
      validateAnalyticsQuery({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-31T00:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('accepts mixed startDate/to and from/endDate', () => {
    expect(() =>
      validateAnalyticsQuery({
        startDate: '2026-01-01T00:00:00.000Z',
        to: '2026-01-31T00:00:00.000Z',
      }),
    ).not.toThrow();
    expect(() =>
      validateAnalyticsQuery({
        from: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T00:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('accepts all valid timeframe values', () => {
    for (const tf of ['hour', 'day', 'week', 'month', 'year'] as const) {
      expect(() => validateAnalyticsQuery({ ...validBase, timeframe: tf })).not.toThrow();
    }
  });

  it('accepts all valid groupBy values', () => {
    for (const gb of ['asset', 'agent', 'wallet', 'budget', 'day', 'week', 'month'] as const) {
      expect(() => validateAnalyticsQuery({ ...validBase, groupBy: gb })).not.toThrow();
    }
  });

  it('accepts valid pagination parameters', () => {
    expect(() =>
      validateAnalyticsQuery({ ...validBase, page: 1, limit: 20, order: 'asc' }),
    ).not.toThrow();
    expect(() =>
      validateAnalyticsQuery({ ...validBase, page: 5, limit: 50, order: 'desc' }),
    ).not.toThrow();
  });

  it('throws when startDate is missing', () => {
    expect(() => validateAnalyticsQuery({ endDate: '2026-01-31T00:00:00.000Z' })).toThrow(
      'startDate (or from) is required',
    );
  });

  it('throws when endDate is missing', () => {
    expect(() => validateAnalyticsQuery({ startDate: '2026-01-01T00:00:00.000Z' })).toThrow(
      'endDate (or to) is required',
    );
  });

  it('throws for unparseable startDate', () => {
    expect(() =>
      validateAnalyticsQuery({
        startDate: 'not-a-date',
        endDate: '2026-01-31T00:00:00.000Z',
      }),
    ).toThrow('Invalid startDate');
  });

  it('throws for unparseable endDate', () => {
    expect(() =>
      validateAnalyticsQuery({
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: 'garbage',
      }),
    ).toThrow('Invalid endDate');
  });

  it('throws when startDate equals endDate', () => {
    expect(() =>
      validateAnalyticsQuery({
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow('startDate must be before endDate');
  });

  it('throws when startDate is after endDate', () => {
    expect(() =>
      validateAnalyticsQuery({
        startDate: '2026-01-31T00:00:00.000Z',
        endDate: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow('startDate must be before endDate');
  });

  it('throws for invalid timeframe', () => {
    expect(() =>
      validateAnalyticsQuery({
        ...validBase,
        timeframe: 'quarter' as Timeframe,
      }),
    ).toThrow('Invalid timeframe "quarter"');
  });

  it('throws for invalid groupBy', () => {
    expect(() =>
      validateAnalyticsQuery({
        ...validBase,
        groupBy: 'quarter' as AnalyticsGroupBy,
      }),
    ).toThrow('Invalid groupBy "quarter"');
  });

  it('throws for non-integer page', () => {
    expect(() => validateAnalyticsQuery({ ...validBase, page: 1.5 })).toThrow(
      'page must be a positive integer',
    );
  });

  it('throws for zero page', () => {
    expect(() => validateAnalyticsQuery({ ...validBase, page: 0 })).toThrow(
      'page must be a positive integer',
    );
  });

  it('throws for negative page', () => {
    expect(() => validateAnalyticsQuery({ ...validBase, page: -1 })).toThrow(
      'page must be a positive integer',
    );
  });

  it('throws for non-integer limit', () => {
    expect(() => validateAnalyticsQuery({ ...validBase, limit: 10.5 })).toThrow(
      'limit must be a positive integer',
    );
  });

  it('throws for zero limit', () => {
    expect(() => validateAnalyticsQuery({ ...validBase, limit: 0 })).toThrow(
      'limit must be a positive integer',
    );
  });

  it('throws for invalid order', () => {
    expect(() =>
      validateAnalyticsQuery({ ...validBase, order: 'invalid' as 'asc' | 'desc' }),
    ).toThrow('order must be either "asc" or "desc"');
  });

  it('uses AnalyticsQueryError as the error name', () => {
    try {
      validateAnalyticsQuery({ startDate: '', endDate: '' });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AnalyticsQueryError);
      expect((err as AnalyticsQueryError).name).toBe('AnalyticsQueryError');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* buildAnalyticsQuery                                                         */
/* -------------------------------------------------------------------------- */

describe('buildAnalyticsQuery', () => {
  it('serializes required parameters', () => {
    const params = buildAnalyticsQuery({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-31T00:00:00.000Z',
    });

    expect(params.get('startDate')).toBe('2026-01-01T00:00:00.000Z');
    expect(params.get('endDate')).toBe('2026-01-31T00:00:00.000Z');
  });

  it('uses from/to aliases when startDate/endDate not provided', () => {
    const params = buildAnalyticsQuery({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T00:00:00.000Z',
    });

    expect(params.get('startDate')).toBe('2026-01-01T00:00:00.000Z');
    expect(params.get('endDate')).toBe('2026-01-31T00:00:00.000Z');
  });

  it('includes optional filters when provided', () => {
    const params = buildAnalyticsQuery({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-31T00:00:00.000Z',
      timeframe: 'day',
      asset: 'USDC',
      currency: 'USD',
      walletId: 'w_123',
      agentId: 'ag_456',
      sort: 'totalSpent',
      groupBy: 'day',
      page: 2,
      limit: 25,
      order: 'desc',
    });

    expect(params.get('timeframe')).toBe('day');
    expect(params.get('asset')).toBe('USDC');
    expect(params.get('currency')).toBe('USD');
    expect(params.get('walletId')).toBe('w_123');
    expect(params.get('agentId')).toBe('ag_456');
    expect(params.get('sort')).toBe('totalSpent');
    expect(params.get('groupBy')).toBe('day');
    expect(params.get('page')).toBe('2');
    expect(params.get('limit')).toBe('25');
    expect(params.get('order')).toBe('desc');
  });

  it('omits optional filters when not provided', () => {
    const params = buildAnalyticsQuery({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-31T00:00:00.000Z',
    });

    expect(params.has('timeframe')).toBe(false);
    expect(params.has('asset')).toBe(false);
    expect(params.has('currency')).toBe(false);
    expect(params.has('walletId')).toBe(false);
    expect(params.has('agentId')).toBe(false);
    expect(params.has('sort')).toBe(false);
    expect(params.has('groupBy')).toBe(false);
    expect(params.has('page')).toBe(false);
    expect(params.has('limit')).toBe(false);
    expect(params.has('order')).toBe(false);
  });

  it('returns a URLSearchParams instance', () => {
    const params = buildAnalyticsQuery({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-31T00:00:00.000Z',
    });

    expect(params).toBeInstanceOf(URLSearchParams);
  });

  it('encodes special characters in values', () => {
    const params = buildAnalyticsQuery({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-31T00:00:00.000Z',
      walletId: 'w=a&b',
    });

    expect(params.get('walletId')).toBe('w=a&b');
    const serialised = params.toString();
    expect(serialised).toContain('walletId=w%3Da%26b');
  });
});

/* -------------------------------------------------------------------------- */
/* buildAnalyticsPath                                                          */
/* -------------------------------------------------------------------------- */

describe('buildAnalyticsPath', () => {
  it('builds a path with the default base route', () => {
    const path = buildAnalyticsPath(
      {
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T00:00:00.000Z',
      },
      '/analytics/overview',
    );

    expect(path).toMatch(/^\/analytics\/overview\?/);
    expect(path).toContain('startDate=2026-01-01T00%3A00%3A00.000Z');
    expect(path).toContain('endDate=2026-01-31T00%3A00%3A00.000Z');
  });

  it('percent-encodes ISO timestamps in the query string', () => {
    const path = buildAnalyticsPath(
      {
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T00:00:00.000Z',
      },
      '/analytics/cashflow',
    );

    expect(path).toContain('startDate=');
    expect(path).toContain('2026-01-01T00%3A00%3A00.000Z');
    expect(path).toContain('2026-01-31T00%3A00%3A00.000Z');
  });

  it('includes all optional filters in the query string', () => {
    const path = buildAnalyticsPath(
      {
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T00:00:00.000Z',
        asset: 'XLM',
        walletId: 'w_1',
        agentId: 'ag_99',
        groupBy: 'day',
        page: 1,
        limit: 50,
        order: 'asc',
      },
      '/analytics/agents',
    );

    expect(path).toContain('asset=XLM');
    expect(path).toContain('walletId=w_1');
    expect(path).toContain('agentId=ag_99');
    expect(path).toContain('groupBy=day');
    expect(path).toContain('page=1');
    expect(path).toContain('limit=50');
    expect(path).toContain('order=asc');
  });
});

/* -------------------------------------------------------------------------- */
/* Date range presets                                                          */
/* -------------------------------------------------------------------------- */

describe('getDateRangeFromPreset', () => {
  const anchor = new Date('2026-01-15T12:30:00.000Z'); // Thursday, mid-month

  it('returns correct range for last_hour', () => {
    const { startDate, endDate } = getDateRangeFromPreset('last_hour', anchor);
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    expect(end - start).toBe(60 * 60 * 1000);
    expect(end).toBe(anchor.getTime());
  });

  it('returns correct range for last_24_hours', () => {
    const { startDate, endDate } = getDateRangeFromPreset('last_24_hours', anchor);
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    expect(end - start).toBe(24 * 60 * 60 * 1000);
    expect(end).toBe(anchor.getTime());
  });

  it('returns correct range for last_7_days (start of day)', () => {
    const { startDate, endDate } = getDateRangeFromPreset('last_7_days', anchor);
    const start = new Date(startDate);
    const end = new Date(endDate);
    // Should be at day boundaries (00:00:00.000Z)
    expect(start.getUTCHours()).toBe(0);
    expect(start.getUTCMinutes()).toBe(0);
    expect(start.getUTCSeconds()).toBe(0);
    expect(start.getUTCMilliseconds()).toBe(0);
    expect(end.getUTCHours()).toBe(0);
    expect(end.getUTCMinutes()).toBe(0);
    expect(end.getUTCSeconds()).toBe(0);
    expect(end.getUTCMilliseconds()).toBe(0);
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('returns correct range for last_30_days', () => {
    const { startDate, endDate } = getDateRangeFromPreset('last_30_days', anchor);
    const start = new Date(startDate);
    const end = new Date(endDate);
    expect(end.getTime() - start.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('returns correct range for last_90_days', () => {
    const { startDate, endDate } = getDateRangeFromPreset('last_90_days', anchor);
    const start = new Date(startDate);
    const end = new Date(endDate);
    expect(end.getTime() - start.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it('returns correct range for this_week (Monday to next Monday)', () => {
    const { startDate, endDate } = getDateRangeFromPreset('this_week', anchor);
    const start = new Date(startDate);
    const end = new Date(endDate);
    // Jan 15, 2026 is Thursday, week starts Monday Jan 12
    expect(start.getUTCDay()).toBe(1); // Monday
    expect(start.getUTCHours()).toBe(0);
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('returns correct range for this_month', () => {
    const { startDate, endDate } = getDateRangeFromPreset('this_month', anchor);
    const start = new Date(startDate);
    const end = new Date(endDate);
    expect(start.getUTCDate()).toBe(1);
    expect(start.getUTCHours()).toBe(0);
    expect(end.getUTCMonth()).toBe((start.getUTCMonth() + 1) % 12);
  });

  it('returns correct range for this_quarter', () => {
    const { startDate, endDate } = getDateRangeFromPreset('this_quarter', anchor);
    const start = new Date(startDate);
    const end = new Date(endDate);
    expect([0, 3, 6, 9]).toContain(start.getUTCMonth()); // Quarter start months
    expect(start.getUTCDate()).toBe(1);
    expect(start.getUTCHours()).toBe(0);
    expect(end.getUTCMonth()).toBe((start.getUTCMonth() + 3) % 12);
  });

  it('returns correct range for this_year', () => {
    const { startDate, endDate } = getDateRangeFromPreset('this_year', anchor);
    const start = new Date(startDate);
    const end = new Date(endDate);
    expect(start.getUTCMonth()).toBe(0); // January
    expect(start.getUTCDate()).toBe(1);
    expect(start.getUTCHours()).toBe(0);
    expect(end.getUTCFullYear()).toBe(start.getUTCFullYear() + 1);
  });

  it('returns correct range for previous_week', () => {
    const { startDate, endDate } = getDateRangeFromPreset('previous_week', anchor);
    const start = new Date(startDate);
    const end = new Date(endDate);
    expect(start.getUTCDay()).toBe(1); // Monday
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    // End should be the start of this week
    const thisWeekStart = new Date(anchor);
    thisWeekStart.setUTCHours(0, 0, 0, 0);
    thisWeekStart.setUTCDate(thisWeekStart.getUTCDate() - ((thisWeekStart.getUTCDay() + 6) % 7));
    expect(end.getTime()).toBe(thisWeekStart.getTime());
  });

  it('returns correct range for previous_month', () => {
    const { startDate, endDate } = getDateRangeFromPreset('previous_month', anchor);
    const start = new Date(startDate);
    const end = new Date(endDate);
    expect(start.getUTCDate()).toBe(1);
    expect(end.getUTCDate()).toBe(1);
    expect(end.getUTCMonth()).toBe((start.getUTCMonth() + 1) % 12);
  });

  it('returns correct range for previous_quarter', () => {
    const { startDate, endDate } = getDateRangeFromPreset('previous_quarter', anchor);
    const start = new Date(startDate);
    const end = new Date(endDate);
    expect([0, 3, 6, 9]).toContain(start.getUTCMonth());
    expect(start.getUTCDate()).toBe(1);
    expect(end.getUTCMonth()).toBe((start.getUTCMonth() + 3) % 12);
  });

  it('returns correct range for previous_year', () => {
    const { startDate, endDate } = getDateRangeFromPreset('previous_year', anchor);
    const start = new Date(startDate);
    const end = new Date(endDate);
    expect(start.getUTCMonth()).toBe(0);
    expect(start.getUTCDate()).toBe(1);
    expect(end.getUTCFullYear()).toBe(start.getUTCFullYear() + 1);
    expect(end.getUTCMonth()).toBe(0);
    expect(end.getUTCDate()).toBe(1);
  });

  it('throws for unknown preset', () => {
    expect(() => getDateRangeFromPreset('unknown_preset' as TimeWindowPreset, anchor)).toThrow(
      'Unknown time window preset',
    );
  });
});

describe('applyTimeWindowPreset', () => {
  const anchor = new Date('2026-01-15T12:30:00.000Z');

  it('merges preset dates with existing options', () => {
    const result = applyTimeWindowPreset('last_7_days', { asset: 'USDC' }, anchor);
    expect(result.asset).toBe('USDC');
    expect(result.startDate).toBeDefined();
    expect(result.endDate).toBeDefined();
  });

  it('overrides existing startDate/endDate with preset', () => {
    const result = applyTimeWindowPreset(
      'last_7_days',
      { startDate: '2025-01-01T00:00:00.000Z', endDate: '2025-01-31T00:00:00.000Z' },
      anchor,
    );
    expect(result.startDate).not.toBe('2025-01-01T00:00:00.000Z');
    expect(result.endDate).not.toBe('2025-01-31T00:00:00.000Z');
  });

  it('returns new object without mutating input', () => {
    const input: AnalyticsQueryOptions = { asset: 'USDC' };
    const result = applyTimeWindowPreset('last_7_days', input, anchor);
    expect(result).not.toBe(input);
    expect(input.startDate).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Convenience endpoint builders                                               */
/* -------------------------------------------------------------------------- */

describe('Convenience endpoint builders', () => {
  const baseParams: AnalyticsQueryOptions = {
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-01-31T00:00:00.000Z',
    asset: 'USDC',
  };

  it('buildOverviewQuery builds correct path', () => {
    const path = buildOverviewQuery(baseParams);
    expect(path).toMatch(/^\/analytics\/overview\?/);
    expect(path).toContain('asset=USDC');
  });

  it('buildCashflowQuery builds correct path', () => {
    const path = buildCashflowQuery(baseParams);
    expect(path).toMatch(/^\/analytics\/cashflow\?/);
  });

  it('buildSpendingQuery builds correct path', () => {
    const path = buildSpendingQuery(baseParams);
    expect(path).toMatch(/^\/analytics\/spending\?/);
  });

  it('buildRiskQuery builds correct path', () => {
    const path = buildRiskQuery(baseParams);
    expect(path).toMatch(/^\/analytics\/risk\?/);
  });

  it('buildAgentsQuery builds correct path', () => {
    const path = buildAgentsQuery(baseParams);
    expect(path).toMatch(/^\/analytics\/agents\?/);
  });

  it('buildBudgetsQuery builds correct path', () => {
    const path = buildBudgetsQuery(baseParams);
    expect(path).toMatch(/^\/analytics\/budgets\?/);
  });

  it('buildListAgentsQuery builds correct path', () => {
    const path = buildListAgentsQuery({ ...baseParams, page: 2, limit: 50 });
    expect(path).toMatch(/^\/analytics\/agents\?/);
    expect(path).toContain('page=2');
    expect(path).toContain('limit=50');
  });

  it('buildListBudgetsQuery builds correct path', () => {
    const path = buildListBudgetsQuery({ ...baseParams, page: 1, limit: 100 });
    expect(path).toMatch(/^\/analytics\/budgets\?/);
    expect(path).toContain('page=1');
    expect(path).toContain('limit=100');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Budget, BudgetUtilization } from '@astroid/types';

import {
  BudgetClient,
  classifyAllocation,
  deriveAllocationStatus,
  isAllocationExhausted,
  toBudgetQuery,
  type BudgetHttpClient,
} from '../budget.js';

/* -------------------------------------------------------------------------- */
/* Mock transport                                                              */
/* -------------------------------------------------------------------------- */

function createHttpMock() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } satisfies Record<keyof BudgetHttpClient, ReturnType<typeof vi.fn>>;
}

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'bud_1',
    organizationId: 'org_1',
    parentBudgetId: null,
    agentId: null,
    name: 'Ops',
    currency: 'USDC',
    limitAmount: '1000',
    spent: '250',
    remaining: '750',
    period: 'MONTHLY',
    periodStart: '2026-08-01T00:00:00.000Z',
    rollover: false,
    enabled: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  };
}

function makeUtilization(overrides: Partial<BudgetUtilization> = {}): BudgetUtilization {
  return {
    budgetId: 'bud_1',
    period: 'MONTHLY',
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-09-01T00:00:00.000Z',
    limit: '1000',
    spent: '250',
    remaining: '750',
    utilization: 0.25,
    percent: 25,
    state: 'healthy',
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* toBudgetQuery                                                               */
/* -------------------------------------------------------------------------- */

describe('toBudgetQuery', () => {
  it('drops undefined, null and empty-string values and stringifies the rest', () => {
    expect(toBudgetQuery({ a: 1, b: 'x', c: true, d: undefined, e: null, f: '', g: 0 })).toEqual({
      a: 1,
      b: 'x',
      c: true,
      g: 0,
    });
  });

  it('returns an empty object for no params', () => {
    expect(toBudgetQuery()).toEqual({});
  });
});

/* -------------------------------------------------------------------------- */
/* BudgetClient                                                                */
/* -------------------------------------------------------------------------- */

describe('BudgetClient', () => {
  let http: ReturnType<typeof createHttpMock>;
  let client: BudgetClient;

  beforeEach(() => {
    http = createHttpMock();
    client = new BudgetClient(http);
  });

  it('create() POSTs to /v1/budgets', async () => {
    const budget = makeBudget();
    http.post.mockResolvedValue(budget);
    const result = await client.create({ name: 'Ops', limitAmount: '1000' });
    expect(http.post).toHaveBeenCalledWith('/v1/budgets', { name: 'Ops', limitAmount: '1000' });
    expect(result).toBe(budget);
  });

  it('get() GETs a single budget and encodes the id', async () => {
    http.get.mockResolvedValue(makeBudget());
    await client.get('bud/1');
    expect(http.get).toHaveBeenCalledWith('/v1/budgets/bud%2F1', {});
  });

  it('getBudget() aliases get()', async () => {
    const budget = makeBudget();
    http.get.mockResolvedValue(budget);
    const result = await client.getBudget('bud_1');
    expect(http.get).toHaveBeenCalledWith('/v1/budgets/bud_1', {});
    expect(result).toBe(budget);
  });

  it('list() forwards filters as a query', async () => {
    http.get.mockResolvedValue({ data: [makeBudget()] });
    await client.list({ agentId: 'agt_1', enabled: true, limit: 50, cursor: undefined });
    expect(http.get).toHaveBeenCalledWith('/v1/budgets', {
      query: { agentId: 'agt_1', enabled: true, limit: 50 },
    });
  });

  it('listBudgets() aliases list() with filters', async () => {
    http.get.mockResolvedValue({ data: [makeBudget()] });
    await client.listBudgets({ agentId: 'agt_1', limit: 25 });
    expect(http.get).toHaveBeenCalledWith('/v1/budgets', {
      query: { agentId: 'agt_1', limit: 25 },
    });
  });

  it('simulateBudgetCheck() POSTs the spend to the simulate endpoint and reports allowed spends', async () => {
    const result = {
      budgetId: 'bud_1',
      allowed: true,
      wouldExceed: false,
      afterRemaining: '750',
      utilizationAfter: 0.25,
      state: 'healthy',
      violations: [],
      explanation: 'Spend is within the budget limit.',
    };
    http.post.mockResolvedValue(result);
    const res = await client.simulateBudgetCheck('bud_1', { asset: 'USDC', amount: '250' });
    expect(http.post).toHaveBeenCalledWith('/v1/budgets/bud_1/simulate', {
      asset: 'USDC',
      amount: '250',
    });
    expect(res).toBe(result);
    expect(res.allowed).toBe(true);
  });

  it('simulateBudgetCheck() reports a limit breach', async () => {
    const result = {
      budgetId: 'bud_1',
      allowed: false,
      wouldExceed: true,
      afterRemaining: '0',
      utilizationAfter: 1,
      state: 'exhausted',
      violations: ['Spend would exceed the monthly budget limit of 1000.'],
      explanation: 'Spend would exceed the monthly budget limit of 1000.',
    };
    http.post.mockResolvedValue(result);
    const res = await client.simulateBudgetCheck('bud_1', { asset: 'USDC', amount: '9999' });
    expect(http.post).toHaveBeenCalledWith('/v1/budgets/bud_1/simulate', {
      asset: 'USDC',
      amount: '9999',
    });
    expect(res.allowed).toBe(false);
    expect(res.wouldExceed).toBe(true);
    expect(res.state).toBe('exhausted');
    expect(res.violations.length).toBeGreaterThan(0);
  });

  it('update() PATCHes the budget', async () => {
    http.patch.mockResolvedValue(makeBudget({ name: 'Renamed' }));
    const result = await client.update('bud_1', { name: 'Renamed' });
    expect(http.patch).toHaveBeenCalledWith('/v1/budgets/bud_1', { name: 'Renamed' });
    expect(result.name).toBe('Renamed');
  });

  it('updateBudget() aliases update() and patches the spending limit', async () => {
    http.patch.mockResolvedValue(makeBudget({ limitAmount: '7500.00' }));
    const result = await client.updateBudget('bud_1', { limitAmount: '7500.00' });
    expect(http.patch).toHaveBeenCalledWith('/v1/budgets/bud_1', { limitAmount: '7500.00' });
    expect(result.limitAmount).toBe('7500.00');
  });

  it('delete() DELETEs the budget', async () => {
    http.delete.mockResolvedValue(undefined);
    await client.delete('bud_1');
    expect(http.delete).toHaveBeenCalledWith('/v1/budgets/bud_1');
  });

  it('consume() POSTs to the consume sub-resource', async () => {
    http.post.mockResolvedValue(makeBudget({ spent: '300' }));
    await client.consume('bud_1', { amount: '50', transactionId: 'tx_1' });
    expect(http.post).toHaveBeenCalledWith('/v1/budgets/bud_1/consume', {
      amount: '50',
      transactionId: 'tx_1',
    });
  });

  it('history() supports pagination and filter params', async () => {
    http.get.mockResolvedValue({ data: [], meta: { hasMore: false } });
    await client.history('bud_1', {
      cursor: 'c1',
      limit: 25,
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-31T00:00:00.000Z',
      transactionId: 'tx_9',
      minAmount: 10,
      maxAmount: '500',
    });
    expect(http.get).toHaveBeenCalledWith('/v1/budgets/bud_1/history', {
      query: {
        cursor: 'c1',
        limit: 25,
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-31T00:00:00.000Z',
        transactionId: 'tx_9',
        minAmount: 10,
        maxAmount: '500',
      },
    });
  });

  it('metrics() GETs the metrics sub-resource', async () => {
    http.get.mockResolvedValue({ budgetId: 'bud_1', utilization: 0.25 });
    const m = await client.metrics('bud_1');
    expect(http.get).toHaveBeenCalledWith('/v1/budgets/bud_1/metrics');
    expect(m.utilization).toBe(0.25);
  });

  it('getBudgetUtilization() encodes the budget id and forwards an abort signal', async () => {
    http.get.mockResolvedValue({ budgetId: 'bud/1' });
    const controller = new AbortController();

    await client.getBudgetUtilization('bud/1', { signal: controller.signal });

    expect(http.get).toHaveBeenCalledWith('/v1/budgets/bud%2F1/utilization', {
      signal: controller.signal,
    });
  });

  it('getBudgetUtilization() propagates transport errors', async () => {
    http.get.mockRejectedValue(new Error('utilization unavailable'));

    await expect(client.getBudgetUtilization('bud_1')).rejects.toThrow(
      'utilization unavailable',
    );
  });

  it('propagates a failed request as a rejection', async () => {
    http.get.mockRejectedValue(new Error('budget not found'));

    await expect(client.getBudget('missing')).rejects.toThrow('budget not found');
  });

  it('allocationStatus() fetches the budget then derives status locally', async () => {
    http.get.mockResolvedValue(makeBudget({ limitAmount: '1000', spent: '900' }));
    const status = await client.allocationStatus('bud_1');
    expect(http.get).toHaveBeenCalledWith('/v1/budgets/bud_1', {});
    expect(status).toMatchObject({
      budgetId: 'bud_1',
      limit: '1000',
      spent: '900',
      remaining: '100',
      percent: 90,
      state: 'warning',
    });
  });

  it('allocationStatus() reports wouldExceed for a prospective spend', async () => {
    http.get.mockResolvedValue(makeBudget({ limitAmount: '1000', spent: '900' }));
    const status = await client.allocationStatus('bud_1', { prospectiveSpend: 200 });
    expect(status.wouldExceed).toBe(true);
    expect(status.spent).toBe('1100');
    expect(status.state).toBe('exhausted');
  });

  it('getBudgetUtilization() GETs the utilization sub-resource', async () => {
    const utilization = makeUtilization({ percent: 40, utilization: 0.4, state: 'healthy' });
    http.get.mockResolvedValue(utilization);
    const result = await client.getBudgetUtilization('bud_1');
    expect(http.get).toHaveBeenCalledWith('/v1/budgets/bud_1/utilization', {});
    expect(result).toBe(utilization);
    expect(result.percent).toBe(40);
    expect(result.remaining).toBe('750');
  });

  it('getBudgetUtilization() re-buckets state against custom thresholds', async () => {
    http.get.mockResolvedValue(makeUtilization({ percent: 60, state: 'healthy' }));
    const result = await client.getBudgetUtilization('bud_1', { warnAt: 50, criticalAt: 90 });
    expect(result.state).toBe('warning');
    expect(result.percent).toBe(60);
  });

  it('getBudgetUtilization() leaves the server state untouched without thresholds', async () => {
    http.get.mockResolvedValue(makeUtilization({ percent: 60, state: 'critical' }));
    const result = await client.getBudgetUtilization('bud_1');
    expect(result.state).toBe('critical');
  });

  it('createAlert() / createThresholdAlert() POSTs to /v1/budgets/:id/alerts', async () => {
    const mockAlert = {
      id: 'alt_1',
      budgetId: 'bud_1',
      organizationId: 'org_1',
      thresholdPercent: 80,
      channel: 'WEBHOOK',
      target: 'https://example.com/webhook',
      status: 'ACTIVE',
      recurring: true,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    http.post.mockResolvedValue(mockAlert);
    const result = await client.createAlert('bud_1', {
      thresholdPercent: 80,
      channel: 'WEBHOOK',
      target: 'https://example.com/webhook',
    });
    expect(http.post).toHaveBeenCalledWith('/v1/budgets/bud_1/alerts', {
      thresholdPercent: 80,
      channel: 'WEBHOOK',
      target: 'https://example.com/webhook',
    });
    expect(result).toBe(mockAlert);

    const thresholdResult = await client.createThresholdAlert('bud_1', {
      thresholdPercent: 80,
      channel: 'WEBHOOK',
      target: 'https://example.com/webhook',
    });
    expect(thresholdResult).toBe(mockAlert);
  });

  it('listAlerts() / listThresholdAlerts() GETs /v1/budgets/:id/alerts', async () => {
    http.get.mockResolvedValue({ data: [] });
    await client.listAlerts('bud_1', { status: 'ACTIVE' });
    expect(http.get).toHaveBeenCalledWith('/v1/budgets/bud_1/alerts', {
      query: { status: 'ACTIVE' },
    });

    await client.listThresholdAlerts('bud_1');
    expect(http.get).toHaveBeenCalledWith('/v1/budgets/bud_1/alerts', {
      query: {},
    });
  });

  it('getAlert() / getThresholdAlert() GETs /v1/budgets/:id/alerts/:alertId', async () => {
    const mockAlert = { id: 'alt_1', thresholdPercent: 50 };
    http.get.mockResolvedValue(mockAlert);
    const result = await client.getAlert('bud_1', 'alt_1');
    expect(http.get).toHaveBeenCalledWith('/v1/budgets/bud_1/alerts/alt_1');
    expect(result).toBe(mockAlert);

    const aliasResult = await client.getThresholdAlert('bud_1', 'alt_1');
    expect(aliasResult).toBe(mockAlert);
  });

  it('updateAlert() / updateThresholdAlert() PATCHes /v1/budgets/:id/alerts/:alertId', async () => {
    const updated = { id: 'alt_1', thresholdPercent: 90 };
    http.patch.mockResolvedValue(updated);
    const result = await client.updateAlert('bud_1', 'alt_1', { thresholdPercent: 90 });
    expect(http.patch).toHaveBeenCalledWith('/v1/budgets/bud_1/alerts/alt_1', {
      thresholdPercent: 90,
    });
    expect(result).toBe(updated);

    const aliasResult = await client.updateThresholdAlert('bud_1', 'alt_1', { thresholdPercent: 90 });
    expect(aliasResult).toBe(updated);
  });

  it('deleteAlert() / deleteThresholdAlert() DELETEs /v1/budgets/:id/alerts/:alertId', async () => {
    http.delete.mockResolvedValue(undefined);
    await client.deleteAlert('bud_1', 'alt_1');
    expect(http.delete).toHaveBeenCalledWith('/v1/budgets/bud_1/alerts/alt_1');

    await client.deleteThresholdAlert('bud_1', 'alt_1');
    expect(http.delete).toHaveBeenCalledWith('/v1/budgets/bud_1/alerts/alt_1');
  });
});

/* -------------------------------------------------------------------------- */
/* Allocation helpers                                                          */
/* -------------------------------------------------------------------------- */

describe('allocation helpers', () => {
  it('classifyAllocation buckets by threshold', () => {
    expect(classifyAllocation(10)).toBe('healthy');
    expect(classifyAllocation(85)).toBe('warning');
    expect(classifyAllocation(97)).toBe('critical');
    expect(classifyAllocation(100)).toBe('exhausted');
    expect(classifyAllocation(120)).toBe('exhausted');
    expect(classifyAllocation(60, { warnAt: 50 })).toBe('warning');
  });

  it('classifyAllocation respects each threshold boundary exactly', () => {
    const cases: Array<[number, BudgetUtilization['state']]> = [
      [0, 'healthy'],
      [79.99, 'healthy'],
      [80, 'warning'],
      [94.99, 'warning'],
      [95, 'critical'],
      [99.99, 'critical'],
      [100, 'exhausted'],
      [150, 'exhausted'],
    ];

    for (const [percent, state] of cases) {
      expect(classifyAllocation(percent)).toBe(state);
    }
  });

  it('deriveAllocationStatus classifies utilization at the default thresholds', () => {
    const warning = deriveAllocationStatus(makeBudget({ limitAmount: '100', spent: '80' }));
    expect(warning.percent).toBe(80);
    expect(warning.state).toBe('warning');

    const critical = deriveAllocationStatus(makeBudget({ limitAmount: '100', spent: '95' }));
    expect(critical.percent).toBe(95);
    expect(critical.state).toBe('critical');

    const exhausted = deriveAllocationStatus(makeBudget({ limitAmount: '100', spent: '120' }));
    expect(exhausted.percent).toBe(120);
    expect(exhausted.state).toBe('exhausted');
  });

  it('isAllocationExhausted compares spent against limit', () => {
    expect(isAllocationExhausted({ limitAmount: '100', spent: '100' })).toBe(true);
    expect(isAllocationExhausted({ limitAmount: '100', spent: '99.9' })).toBe(false);
    expect(isAllocationExhausted({ limitAmount: '0', spent: '5' })).toBe(false);
  });

  it('deriveAllocationStatus computes utilization and clamps remaining', () => {
    const status = deriveAllocationStatus(makeBudget({ limitAmount: '200', spent: '250' }));
    expect(status.utilization).toBe(1);
    expect(status.percent).toBe(125);
    expect(status.remaining).toBe('0');
    expect(status.state).toBe('exhausted');
  });

  it('deriveAllocationStatus handles a zero limit without dividing by zero', () => {
    const status = deriveAllocationStatus(makeBudget({ limitAmount: '0', spent: '0' }));
    expect(status.utilization).toBe(0);
    expect(status.percent).toBe(0);
    expect(status.state).toBe('healthy');
  });
});

import { describe, expect, it, vi } from 'vitest';

import { BudgetResource } from '../index.js';

import type { HttpClient } from '@astroid/core';
import type { Budget, BudgetSimulationResult, BudgetUtilization } from '@astroid/types';

/**
 * Minimal HttpClient stand-in. Only the methods the resource uses on the wire
 * are stubbed; each call records its arguments so tests can assert the exact
 * path and query/body that were serialized.
 */
function makeClient() {
  const calls: Array<{ method: string; path: string; query?: unknown; body?: unknown }> = [];
  const handler = vi.fn();

  const client = {
    get: vi.fn(async (path: string, opts?: { query?: Record<string, unknown> }) => {
      calls.push({ method: 'get', path, query: opts?.query });
      const data = await handler('get', path, opts?.query);
      return { data };
    }),
    post: vi.fn(async (path: string, body?: unknown) => {
      calls.push({ method: 'post', path, body });
      const data = await handler('post', path, undefined, body);
      return { data };
    }),
    patch: vi.fn(async (path: string, body?: unknown) => {
      calls.push({ method: 'patch', path, body });
      const data = await handler('patch', path, undefined, body);
      return { data };
    }),
    delete: vi.fn(async (path: string) => {
      calls.push({ method: 'delete', path });
      const data = await handler('delete', path);
      return { data };
    }),
  } as unknown as HttpClient;

  return { client, calls, handler };
}

const BUDGET_ID = 'bud_123';
const budget: Budget = {
  id: BUDGET_ID,
  organizationId: 'org_1',
  name: 'Marketing',
  currency: 'USDC',
  period: 'MONTHLY',
  periodStart: '2026-08-01T00:00:00.000Z',
  limitAmount: '1000.00',
  spent: '0.00',
  remaining: '1000.00',
  enabled: true,
  rollover: false,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('BudgetResource', () => {
  it('getBudget requests /budgets/{id}', async () => {
    const { client, calls, handler } = makeClient();
    handler.mockResolvedValueOnce(budget);
    const resource = new BudgetResource(client);

    const result = await resource.getBudget(BUDGET_ID);

    expect(calls).toEqual([{ method: 'get', path: `/budgets/${BUDGET_ID}`, query: undefined }]);
    expect(result).toEqual(budget);
  });

  it('listBudgets serializes filters and pagination into a GET querystring', async () => {
    const { client, calls, handler } = makeClient();
    handler.mockResolvedValueOnce([budget]);
    const resource = new BudgetResource(client);

    const result = await resource.listBudgets({
      period: 'MONTHLY',
      enabled: true,
      limit: 25,
      page: 2,
      order: 'desc',
      sort: 'spent',
    });

    expect(calls).toEqual([
      {
        method: 'get',
        path: '/budgets',
        query: {
          period: 'MONTHLY',
          enabled: true,
          limit: 25,
          page: 2,
          order: 'desc',
          sort: 'spent',
        },
      },
    ]);
    expect(result.data).toEqual([budget]);
  });

  it('simulateBudgetCheck posts the draw to /budgets/{id}/simulate for an allowed spend', async () => {
    const { client, calls, handler } = makeClient();
    const resultData: BudgetSimulationResult = {
      budget,
      allowed: true,
      wouldExceed: false,
      remainingAfter: '975.00',
      restriction: null,
      windowStart: '2026-08-01T00:00:00.000Z',
      windowEnd: '2026-09-01T00:00:00.000Z',
    };
    handler.mockResolvedValueOnce(resultData);
    const resource = new BudgetResource(client);

    const result = await resource.simulateBudgetCheck(BUDGET_ID, {
      asset: 'USDC',
      amount: '25.00',
    });

    expect(calls).toEqual([
      {
        method: 'post',
        path: `/budgets/${BUDGET_ID}/simulate`,
        body: { asset: 'USDC', amount: '25.00' },
      },
    ]);
    expect(result).toEqual(resultData);
  });

  it('simulateBudgetCheck surfaces a limit breach', async () => {
    const { client, handler } = makeClient();
    const breach: BudgetSimulationResult = {
      budget,
      allowed: false,
      wouldExceed: true,
      remainingAfter: '10.00',
      restriction:
        'Spend of 9999.00 USDC would exceed the monthly budget limit of 1000.00 (remaining: 10.00).',
      windowStart: '2026-08-01T00:00:00.000Z',
      windowEnd: '2026-09-01T00:00:00.000Z',
    };
    handler.mockResolvedValueOnce(breach);
    const resource = new BudgetResource(client);

    const result = await resource.simulateBudgetCheck(BUDGET_ID, {
      asset: 'USDC',
      amount: '9999.00',
    });

    expect(result.allowed).toBe(false);
    expect(result.wouldExceed).toBe(true);
    expect(result.restriction).toContain('would exceed');
  });

  it('utilization fetches the utilization snapshot from /budgets/{id}/utilization', async () => {
    const { client, calls, handler } = makeClient();
    const utilization: BudgetUtilization = {
      budgetId: BUDGET_ID,
      period: 'MONTHLY',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-09-01T00:00:00.000Z',
      limit: '1000.00',
      spent: '400.00',
      remaining: '600.00',
      utilization: 0.4,
      percent: 40,
      state: 'healthy',
    };
    handler.mockResolvedValueOnce(utilization);
    const resource = new BudgetResource(client);

    const result = await resource.utilization(BUDGET_ID);

    expect(calls).toEqual([
      { method: 'get', path: `/budgets/${BUDGET_ID}/utilization`, query: undefined },
    ]);
    expect(result.utilization).toBe(0.4);
    expect(result.remaining).toBe('600.00');
  });

  it('getBudgetUtilization is an alias of utilization', async () => {
    const { client, calls, handler } = makeClient();
    const utilization: BudgetUtilization = {
      budgetId: BUDGET_ID,
      period: 'MONTHLY',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-09-01T00:00:00.000Z',
      limit: '1000.00',
      spent: '400.00',
      remaining: '600.00',
      utilization: 0.4,
      percent: 40,
      state: 'healthy',
    };
    handler.mockResolvedValueOnce(utilization);
    const resource = new BudgetResource(client);

    const result = await resource.getBudgetUtilization(BUDGET_ID);

    expect(calls).toEqual([
      { method: 'get', path: `/budgets/${BUDGET_ID}/utilization`, query: undefined },
    ]);
    expect(result).toEqual(utilization);
  });
});

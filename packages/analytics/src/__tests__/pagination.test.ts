import { describe, expect, it, vi } from 'vitest';

import { AnalyticsResource } from '../index.js';

import type { HttpClient } from '@astroid/core';
import type { AgentSpendingRow, BudgetUtilizationRow } from '@astroid/types';

/** Minimal HttpClient stand-in that records GET calls and returns stubbed data. */
function makeClient() {
  const calls: Array<{ path: string; query?: Record<string, unknown> }> = [];
  const handler = vi.fn();

  const client = {
    get: vi.fn(async (path: string, opts?: { query?: Record<string, unknown> }) => {
      calls.push({ path, query: opts?.query });
      const data = await handler(path, opts?.query);
      return {
        data,
        meta: {
          page: 1,
          limit: 20,
          total: data.length,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
    }),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpClient;

  return { client, calls, handler };
}

describe('AnalyticsResource pagination', () => {
  const agentRow: AgentSpendingRow = {
    agentId: 'agt_1',
    agentName: 'Payment Bot',
    totalSpent: '120.50',
    transactionCount: 7,
    averageRisk: 12,
  };

  const budgetRow: BudgetUtilizationRow = {
    budgetId: 'bud_1',
    budgetName: 'Marketing',
    limit: '1000.00',
    spent: '400.00',
    remaining: '600.00',
    utilization: 0.4,
  };

  it('listAgents serializes analytics filters and pagination into the querystring', async () => {
    const { client, calls, handler } = makeClient();
    handler.mockResolvedValueOnce([agentRow]);
    const resource = new AnalyticsResource(client);

    const result = await resource.listAgents({
      from: '2026-01-01',
      to: '2026-01-31',
      currency: 'USDC',
      page: 2,
      limit: 25,
      order: 'desc',
      sort: 'totalSpent',
    });

    expect(calls).toEqual([
      {
        path: '/analytics/agents',
        query: {
          from: '2026-01-01',
          to: '2026-01-31',
          currency: 'USDC',
          page: 2,
          limit: 25,
          order: 'desc',
          sort: 'totalSpent',
        },
      },
    ]);
    expect(result.data).toEqual([agentRow]);
    expect(result.meta.page).toBe(1);
  });

  it('listAgents returns an empty page when there are no rows', async () => {
    const { client, handler } = makeClient();
    handler.mockResolvedValueOnce([]);
    const resource = new AnalyticsResource(client);

    const result = await resource.listAgents({});
    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it('listBudgets serializes pagination and parses utilization rows', async () => {
    const { client, calls, handler } = makeClient();
    handler.mockResolvedValueOnce([budgetRow]);
    const resource = new AnalyticsResource(client);

    const result = await resource.listBudgets({
      from: '2026-01-01',
      page: 1,
      limit: 50,
      order: 'asc',
    });

    expect(calls).toEqual([
      {
        path: '/analytics/budgets',
        query: { from: '2026-01-01', page: 1, limit: 50, order: 'asc' },
      },
    ]);
    expect(result.data).toEqual([budgetRow]);
    expect(result.data[0]!.utilization).toBe(0.4);
  });
});

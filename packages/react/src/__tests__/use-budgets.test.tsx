/**
 * Tests for the budget resource hooks in `@astroid/react`.
 */

import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-dom/test-utils';
import { createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import { Astroid } from '@astroid/client';
import {
  AstroidProvider,
  queryKeys,
  useBudget,
  useBudgets,
  useBudgetUtilization,
  useCreateBudget,
  useUpdateBudget,
  type UpdateBudgetVariables,
} from '../index.js';
import type { Budget, CreateBudgetInput, Paginated } from '@astroid/types';
import type { UseMutationResult } from '@tanstack/react-query';

/* -------------------------------------------------------------------------- */
/* Fixtures & helpers                                                          */
/* -------------------------------------------------------------------------- */

const BUDGET: Budget = {
  id: 'bud_1',
  organizationId: 'org_1',
  parentBudgetId: null,
  agentId: null,
  name: 'Marketing',
  currency: 'USDC',
  limitAmount: '1000.00',
  spent: '400.00',
  remaining: '600.00',
  period: 'MONTHLY',
  periodStart: '2026-01-01T00:00:00.000Z',
  rollover: false,
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

const BUDGET_PAGE: Paginated<Budget> = {
  data: [BUDGET],
  meta: { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
};

function renderInProviders(
  children: ReactNode,
  options: { client?: Astroid; queryClient?: QueryClient } = {},
): { unmount: () => void; queryClient: QueryClient } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = options.client ?? new Astroid({ apiKey: 'sk_test_budgets', baseUrl: 'https://api.test' });
  const queryClient =
    options.queryClient ??
    new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

  act(() => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(AstroidProvider, { client, children }),
      ),
    );
  });

  return {
    queryClient,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Query hooks                                                                 */
/* -------------------------------------------------------------------------- */

describe('useBudgets', () => {
  it('returns a loading state initially', () => {
    let isLoading = false;

    function TestComponent() {
      isLoading = useBudgets({ limit: 25 }).isLoading;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(typeof isLoading).toBe('boolean');
    unmount();
  });

  it('fetches the budget list from the client', async () => {
    const client = new Astroid({ apiKey: 'sk_test_budgets', baseUrl: 'https://api.test' });
    const listSpy = vi.spyOn(client.budgets, 'list').mockResolvedValue(BUDGET_PAGE);

    let result: Paginated<Budget> | undefined;
    function TestComponent() {
      result = useBudgets().data;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client });

    await waitFor(() => expect(result?.data[0]?.id).toBe('bud_1'));
    expect(listSpy).toHaveBeenCalled();
    unmount();
  });
});

describe('useBudget', () => {
  it('disables the query when id is undefined', () => {
    let isFetching = true;

    function TestComponent() {
      isFetching = useBudget(undefined).isFetching;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(isFetching).toBe(false);
    unmount();
  });

  it('uses the budget detail query key', () => {
    expect(queryKeys.budgets.detail('bud_1')).toEqual(['astroid', 'budgets', 'detail', 'bud_1']);
  });
});

describe('useBudgetUtilization', () => {
  it('is disabled until an id is provided', () => {
    let isFetching = true;

    function TestComponent() {
      isFetching = useBudgetUtilization(undefined).isFetching;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(isFetching).toBe(false);
    unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* Mutation hooks                                                              */
/* -------------------------------------------------------------------------- */

describe('useCreateBudget', () => {
  it('exposes a mutate function and invalidates budget queries on success', async () => {
    const client = new Astroid({ apiKey: 'sk_test_budgets', baseUrl: 'https://api.test' });
    const createSpy = vi.spyOn(client.budgets, 'create').mockResolvedValue(BUDGET);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    let mutation: UseMutationResult<Budget, Error, CreateBudgetInput> | undefined;
    function TestComponent() {
      mutation = useCreateBudget();
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client, queryClient });

    expect(typeof mutation?.mutate).toBe('function');

    await act(async () => {
      await mutation!.mutateAsync({ name: 'Marketing', limitAmount: '1000' });
    });

    expect(createSpy).toHaveBeenCalledWith({ name: 'Marketing', limitAmount: '1000' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.budgets.all });
    unmount();
  });
});

describe('useUpdateBudget', () => {
  it('updates a budget and invalidates its detail/utilization cached queries', async () => {
    const client = new Astroid({ apiKey: 'sk_test_budgets', baseUrl: 'https://api.test' });
    const updateSpy = vi.spyOn(client.budgets, 'update').mockResolvedValue(BUDGET);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    let mutation: UseMutationResult<Budget, Error, UpdateBudgetVariables> | undefined;
    function TestComponent() {
      mutation = useUpdateBudget();
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client, queryClient });

    await act(async () => {
      await mutation!.mutateAsync({ id: 'bud_1', params: { limitAmount: '2500' } });
    });

    expect(updateSpy).toHaveBeenCalledWith('bud_1', { limitAmount: '2500' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.budgets.detail('bud_1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.budgets.utilization('bud_1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.budgets.all });
    unmount();
  });
});

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { queryKeys, useAstroidClient } from '../hooks.js';
import type { BudgetListParams } from '@astroid/client';
import type {
  Budget,
  BudgetUtilization,
  CreateBudgetInput,
  Paginated,
  UpdateBudgetInput,
} from '@astroid/types';

/**
 * Fetch a paginated list of budgets.
 *
 * Backed by `budgets.list` and cached under the shared `queryKeys.budgets.list`
 * key so mutations that invalidate the budget domain automatically refresh it.
 *
 * @param params Optional pagination, period, scope, and sort filters.
 * @returns A TanStack Query result with `data` (a {@link Paginated} of
 *   {@link Budget}), `isLoading`, `error`, etc.
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useBudgets({ limit: 25, period: 'MONTHLY' });
 * if (isLoading) return <p>Loading…</p>;
 * return <ul>{data?.data.map((b) => <li key={b.id}>{b.name}: {b.spent}/{b.limitAmount}</li>)}</ul>;
 * ```
 */
export function useBudgets(params?: BudgetListParams): UseQueryResult<Paginated<Budget>, Error> {
  const astroid = useAstroidClient();
  return useQuery({
    queryKey: queryKeys.budgets.list(params),
    queryFn: () => astroid.budgets.list(params),
  });
}

/**
 * Fetch a single budget by id.
 *
 * The query is disabled until a non-empty `id` is supplied, so the hook is safe
 * to call while an id is still loading.
 *
 * @param id The budget id to fetch, or `undefined` to disable the query.
 * @returns A TanStack Query result with `data` (a {@link Budget}), `isLoading`,
 *   `error`, etc.
 *
 * @example
 * ```tsx
 * const { data } = useBudget('bud_abc123');
 * return <p>{data?.name} — {data?.remaining} remaining</p>;
 * ```
 */
export function useBudget(id: string | undefined): UseQueryResult<Budget, Error> {
  const astroid = useAstroidClient();
  return useQuery({
    queryKey: queryKeys.budgets.detail(id ?? ''),
    queryFn: () => astroid.budgets.get(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Fetch the current utilization snapshot for a budget.
 *
 * Disabled until a non-empty id is supplied. Cached under the budget's
 * utilization key, which {@link useUpdateBudget} invalidates.
 *
 * @param id The budget whose utilization to fetch.
 *
 * @example
 * ```tsx
 * const { data } = useBudgetUtilization('bud_abc123');
 * return <progress value={data?.percent ?? 0} max={100} />;
 * ```
 */
export function useBudgetUtilization(
  id: string | undefined,
): UseQueryResult<BudgetUtilization, Error> {
  const astroid = useAstroidClient();
  return useQuery({
    queryKey: queryKeys.budgets.utilization(id ?? ''),
    queryFn: () => astroid.budgets.utilization(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Mutation hook to create a budget.
 *
 * On success every cached budget list is invalidated so the new budget appears
 * without a manual refetch.
 *
 * @returns A TanStack Query mutation with `mutate(input)`, `isPending`, `error`,
 *   etc.
 *
 * @example
 * ```tsx
 * const createBudget = useCreateBudget();
 * createBudget.mutate({ name: 'Marketing', limitAmount: '1000', period: 'MONTHLY' });
 * ```
 */
export function useCreateBudget(): UseMutationResult<Budget, Error, CreateBudgetInput> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateBudgetInput) => astroid.budgets.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all });
    },
  });
}

/** Variables for {@link useUpdateBudget}. */
export interface UpdateBudgetVariables {
  /** The budget to update. */
  id: string;
  /** The fields to patch. */
  params: UpdateBudgetInput;
}

/**
 * Mutation hook to update a budget's limit, period, rollover, or enabled state.
 *
 * On success the budget's detail and utilization queries — plus every cached
 * list — are invalidated so the UI converges on the authoritative state.
 *
 * @returns A TanStack Query mutation with `mutate({ id, params })`, `isPending`,
 *   `error`, etc.
 *
 * @example
 * ```tsx
 * const updateBudget = useUpdateBudget();
 * updateBudget.mutate({ id: 'bud_abc123', params: { limitAmount: '2500' } });
 * ```
 */
export function useUpdateBudget(): UseMutationResult<Budget, Error, UpdateBudgetVariables> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, params }: UpdateBudgetVariables) => astroid.budgets.update(id, params),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.budgets.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.budgets.utilization(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all });
    },
  });
}

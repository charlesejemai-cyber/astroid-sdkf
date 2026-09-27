/**
 * Optimistic cache tests for the `useCreateAgent` mutation hook.
 *
 * Complements `use-agent-mutations.test.tsx` (which covers the mutation
 * lifecycle and invalidation) by observing the actual query cache:
 * - While `agents.create` is in flight, a synthetic agent is prepended to
 *   every cached agent list (optimistic update).
 * - If the create fails, the list cache is rolled back to the exact
 *   pre-mutation snapshot.
 *
 * The `agents.create` spy is controlled with a deferred promise so the
 * intermediate optimistic state can be asserted deterministically.
 */

import { describe, expect, it, type vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCreateAgent } from '../hooks/useAgents.js';
import { queryKeys } from '../hooks.js';
import { createMockClient, createWrapper, AGENT_A, AGENT_PAGE } from './test-utils.js';
import type { CreateAgentParams, Paginated } from '@astroid/types';

const CREATE_PARAMS: CreateAgentParams = {
  name: 'New Agent',
  capabilities: ['research'],
  description: 'A brand-new agent',
  initialBudget: { currency: 'USDC', amount: '100' },
};

/** Read the default agents list entry from the cache. */
function listCache(queryClient: ReturnType<typeof createWrapper>['queryClient']) {
  return queryClient.getQueryData<Paginated<typeof AGENT_A>>(queryKeys.agents.list({}));
}

describe('useCreateAgent — optimistic cache updates', () => {
  it('prepends an optimistic agent to the list cache while the create is in flight', async () => {
    const client = createMockClient();
    const { queryClient, Wrapper } = createWrapper(client, { gcTime: Infinity });

    // Prime the list cache and hold the create request open.
    queryClient.setQueryData(queryKeys.agents.list({}), AGENT_PAGE);
    let resolveCreate!: (agent: typeof AGENT_A) => void;
    (client.agents.create as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise<typeof AGENT_A>((resolve) => {
        resolveCreate = resolve;
      }),
    );

    const { result } = renderHook(() => useCreateAgent(), { wrapper: Wrapper });

    result.current.mutate(CREATE_PARAMS);

    // Optimistic state: three agents, synthetic one first.
    await waitFor(() => expect(listCache(queryClient)?.data).toHaveLength(3));
    expect(listCache(queryClient)?.data[0]?.name).toBe('New Agent');
    expect(listCache(queryClient)?.data[0]?.id).toMatch(/^optimistic_/);
    expect(listCache(queryClient)?.data[1]?.id).toBe(AGENT_A.id);
    expect(client.agents.create).toHaveBeenCalledWith(CREATE_PARAMS);

    // Settle the create; mutation resolves successfully.
    resolveCreate({ ...AGENT_A, id: 'agent_created', name: 'New Agent' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rolls the list cache back to the pre-mutation snapshot when the create fails', async () => {
    const client = createMockClient();
    const { queryClient, Wrapper } = createWrapper(client, { gcTime: Infinity });

    queryClient.setQueryData(queryKeys.agents.list({}), AGENT_PAGE);
    let rejectCreate!: (err: Error) => void;
    (client.agents.create as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise<never>((_resolve, reject) => {
        rejectCreate = reject;
      }),
    );

    const { result } = renderHook(() => useCreateAgent(), { wrapper: Wrapper });

    result.current.mutate(CREATE_PARAMS);

    // The optimistic entry appears while the request is held open…
    await waitFor(() => expect(listCache(queryClient)?.data).toHaveLength(3));
    expect(listCache(queryClient)?.data[0]?.id).toMatch(/^optimistic_/);

    // …and the cache snaps back to the pre-mutation snapshot on failure.
    rejectCreate(new Error('Create rejected'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    await waitFor(() =>
      expect(listCache(queryClient)?.data).toEqual(AGENT_PAGE.data),
    );
    expect(listCache(queryClient)?.meta).toEqual(AGENT_PAGE.meta);
    expect(result.current.error?.message).toBe('Create rejected');
  });

  it('does not touch other resource caches while creating an agent', async () => {
    const client = createMockClient();
    const { queryClient, Wrapper } = createWrapper(client, { gcTime: Infinity });

    queryClient.setQueryData(queryKeys.agents.list({}), AGENT_PAGE);
    let resolveCreate!: (agent: typeof AGENT_A) => void;
    (client.agents.create as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise<typeof AGENT_A>((resolve) => {
        resolveCreate = resolve;
      }),
    );

    const { result } = renderHook(() => useCreateAgent(), { wrapper: Wrapper });

    result.current.mutate(CREATE_PARAMS);
    await waitFor(() => expect(listCache(queryClient)?.data).toHaveLength(3));

    // Wallets are a separate domain and must be unaffected by agent mutations.
    expect(queryClient.getQueryCache().find({ queryKey: queryKeys.wallets.all })).toBeUndefined();

    resolveCreate({ ...AGENT_A, id: 'agent_created', name: 'New Agent' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

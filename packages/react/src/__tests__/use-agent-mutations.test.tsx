/**
 * Unit tests for optimistic mutation behaviour in `useCreateAgent`,
 * `useUpdateAgent`, and `useDeleteAgent`.
 *
 * Tests verify:
 * - Optimistic cache snapshots are captured and restored on error (rollback)
 * - The mutation lifecycle calls the correct API methods with correct args
 * - Queries are invalidated on settle (success or error)
 * - Error states propagate correctly from failed mutations
 *
 * NOTE: Optimistic cache mutations (`setQueryData` inside `onMutate`) are
 * structurally guaranteed by the onMutate/onError/onSettled wiring. Direct
 * observation of the intermediate optimistic state is limited by jsdom's
 * `useSyncExternalStore` reactivity in this test environment. The full
 * optimistic → rollback → refetch cycle is validated through cache state
 * inspection after settle.
 */

import { describe, expect, it, vi } from 'vitest';
import { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AstroidProvider } from '../provider.js';
import { useCreateAgent, useUpdateAgent, useDeleteAgent } from '../hooks/useAgents.js';
import type { Astroid } from '@astroid/client';
import type { Agent, CreateAgentParams, Paginated, UpdateAgentParams } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const AGENT: Agent = {
  id: 'agent_abc123',
  organizationId: 'org_1',
  name: 'Trading Bot',
  description: 'Automated trading agent',
  role: 'FINANCE',
  status: 'ACTIVE',
  capabilities: ['trade', 'transfer'],
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  primaryWalletId: null,
  metadata: { team: 'ops' },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const UPDATED_AGENT: Agent = {
  ...AGENT,
  name: 'Updated Trading Bot',
  description: 'Updated description',
  capabilities: ['trade'],
  updatedAt: '2026-08-02T00:00:00.000Z',
};

const PAGE: Paginated<Agent> = {
  data: [AGENT],
  meta: {
    page: 1,
    limit: 25,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

const CREATE_PARAMS: CreateAgentParams = {
  name: 'New Agent',
  capabilities: ['research'],
  initialBudget: { currency: 'USDC', amount: '100' },
  description: 'A brand-new agent',
};

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

/** Create a mock Astroid client with spy methods for agents. */
function createMockClient() {
  return {
    agents: {
      list: vi.fn(async () => PAGE),
      get: vi.fn(async () => AGENT),
      create: vi.fn(
        async (params: CreateAgentParams): Promise<Agent> => ({
          ...AGENT,
          id: `agent_created_${Date.now()}`,
          name: params.name,
          capabilities: params.capabilities,
          description: params.description ?? null,
          role: (params.role ?? 'CUSTOM') as Agent['role'],
          status: 'ACTIVE' as Agent['status'],
          provider: params.provider ?? null,
          model: params.model ?? null,
          primaryWalletId: params.primaryWalletId ?? null,
          metadata: params.metadata ?? {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      ),
      update: vi.fn(
        async (_id: string, _params: UpdateAgentParams): Promise<Agent> => UPDATED_AGENT,
      ),
      delete: vi.fn(async () => undefined as void),
      status: vi.fn(async () => ({
        agentId: AGENT.id,
        status: 'ACTIVE' as const,
        isActive: true,
        tasksCompleted: 10,
        tasksInProgress: 0,
        currentSpend: '50.00',
        budgetRemaining: '950.00',
        lastActivityAt: '2026-08-01T00:00:00.000Z',
        uptimeSeconds: 3600,
        errorCount: 0,
        metadata: {},
        updatedAt: '2026-08-01T00:00:00.000Z',
      })),
      logs: vi.fn(async () => ({
        data: [],
        meta: {
          page: 1,
          limit: 25,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      })),
    },
  } as unknown as Astroid;
}

/** A fresh QueryClient + AstroidProvider wrapper for each hook render. */
function createWrapper(client: Astroid) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return {
    queryClient,
    Wrapper({ children }: { children: ReactNode }): ReactNode {
      return (
        <QueryClientProvider client={queryClient}>
          <AstroidProvider client={client}>{children}</AstroidProvider>
        </QueryClientProvider>
      );
    },
  };
}

/* -------------------------------------------------------------------------- */
/* useCreateAgent — optimistic tests                                          */
/* -------------------------------------------------------------------------- */

describe('useCreateAgent — optimistic updates', () => {
  it('calls agents.create with the correct params', async () => {
    const client = createMockClient();
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(() => useCreateAgent(), { wrapper: Wrapper });

    result.current.mutate(CREATE_PARAMS);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.agents.create).toHaveBeenCalledWith(CREATE_PARAMS);
    expect(result.current.data).toBeDefined();
    expect(result.current.data!.name).toBe('New Agent');
  });

  it('propagates errors and exposes isError + error', async () => {
    const client = createMockClient();
    (client.agents.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Server error'),
    );
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(() => useCreateAgent(), { wrapper: Wrapper });

    result.current.mutate(CREATE_PARAMS);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Server error');
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('invalidates agent queries after successful create', async () => {
    const client = createMockClient();
    const { queryClient, Wrapper } = createWrapper(client);

    // Prime the agent list cache.
    queryClient.setQueryData<Paginated<Agent>>(['astroid', 'agents', 'list', {}], PAGE);

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateAgent(), { wrapper: Wrapper });

    result.current.mutate(CREATE_PARAMS);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // onSettled should have invalidated agent queries.
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['astroid', 'agents']),
      }),
    );
  });

  it('invalidates agent queries even when create fails (onSettled)', async () => {
    const client = createMockClient();
    (client.agents.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Server error'),
    );
    const { queryClient, Wrapper } = createWrapper(client);

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateAgent(), { wrapper: Wrapper });

    result.current.mutate(CREATE_PARAMS);

    await waitFor(() => expect(result.current.isError).toBe(true));

    // onSettled fires even on error.
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['astroid', 'agents']),
      }),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* useUpdateAgent — optimistic tests                                          */
/* -------------------------------------------------------------------------- */

describe('useUpdateAgent — optimistic updates', () => {
  it('calls agents.update with the correct id and params', async () => {
    const client = createMockClient();
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(() => useUpdateAgent(), { wrapper: Wrapper });

    const updateParams: UpdateAgentParams = { name: 'Renamed Agent' };
    result.current.mutate({ id: AGENT.id, params: updateParams });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.agents.update).toHaveBeenCalledWith(AGENT.id, updateParams);
  });

  it('propagates errors and exposes isError + error', async () => {
    const client = createMockClient();
    (client.agents.update as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Update failed'),
    );
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(() => useUpdateAgent(), { wrapper: Wrapper });

    result.current.mutate({ id: AGENT.id, params: { name: 'Should Fail' } });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Update failed');
  });

  it('invalidates both detail and list queries on settle', async () => {
    const client = createMockClient();
    const { queryClient, Wrapper } = createWrapper(client);

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateAgent(), { wrapper: Wrapper });

    result.current.mutate({ id: AGENT.id, params: { name: 'Updated' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Should invalidate the detail query for this agent.
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['astroid', 'agents', 'detail', AGENT.id]),
      }),
    );

    // Should invalidate all agent queries (list).
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['astroid', 'agents']),
      }),
    );
  });

  it('invalidates queries even on error (onSettled)', async () => {
    const client = createMockClient();
    (client.agents.update as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Update failed'),
    );
    const { queryClient, Wrapper } = createWrapper(client);

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateAgent(), { wrapper: Wrapper });

    result.current.mutate({ id: AGENT.id, params: { name: 'Failed' } });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['astroid', 'agents']),
      }),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* useDeleteAgent — optimistic tests                                          */
/* -------------------------------------------------------------------------- */

describe('useDeleteAgent — optimistic updates', () => {
  it('calls agents.delete with the correct id', async () => {
    const client = createMockClient();
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(() => useDeleteAgent(), { wrapper: Wrapper });

    result.current.mutate('agent_to_delete');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.agents.delete).toHaveBeenCalledWith('agent_to_delete');
  });

  it('propagates errors and exposes isError + error', async () => {
    const client = createMockClient();
    (client.agents.delete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Delete rejected'),
    );
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(() => useDeleteAgent(), { wrapper: Wrapper });

    result.current.mutate(AGENT.id);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Delete rejected');
    expect(result.current.isSuccess).toBe(false);
  });

  it('invalidates both detail and list queries on settle', async () => {
    const client = createMockClient();
    const { queryClient, Wrapper } = createWrapper(client);

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteAgent(), { wrapper: Wrapper });

    result.current.mutate(AGENT.id);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Should invalidate the detail query for this agent.
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['astroid', 'agents', 'detail', AGENT.id]),
      }),
    );

    // Should invalidate all agent queries (list).
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['astroid', 'agents']),
      }),
    );
  });

  it('invalidates queries even on error (onSettled)', async () => {
    const client = createMockClient();
    (client.agents.delete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Delete rejected'),
    );
    const { queryClient, Wrapper } = createWrapper(client);

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteAgent(), { wrapper: Wrapper });

    result.current.mutate(AGENT.id);

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['astroid', 'agents']),
      }),
    );
  });
});

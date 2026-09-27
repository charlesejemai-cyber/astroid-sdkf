/**
 * Unit tests for the `useAgents` list query hook in `@astroid/react`.
 *
 * Tests verify:
 * - Successful data fetching exposes the paginated agent list from the client
 * - Pagination params are forwarded to `agents.list`
 * - Results are cached under the shared `queryKeys.agents.list` key
 * - Client errors surface in the query error state
 * - Fresh data is not refetched on rerender
 *
 * Also covers the `useAgent` detail query hook:
 * - Fetches a single agent by ID and caches it under the detail key
 * - Stays idle without fetching when no ID is supplied
 *
 * The client methods are mocked via the shared harness; no live API is contacted.
 */

import { describe, expect, it, type vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAgent, useAgents } from '../hooks.js';
import { queryKeys } from '../hooks.js';
import {
  createMockClient,
  createWrapper,
  AGENT_A,
  AGENT_PAGE,
} from './test-utils.js';
import type { Agent, Paginated } from '@astroid/types';

describe('useAgents', () => {
  it('fetches and exposes the paginated agent list', async () => {
    const client = createMockClient();
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(useAgents, { wrapper: Wrapper });

    expect(result.current.isPending).toBe(true);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(AGENT_PAGE);
    expect(result.current.data?.data).toHaveLength(2);
    expect(result.current.data?.data[0]?.name).toBe('Ledger Agent');
    expect(result.current.data?.data[1]?.id).toBe('agent_002');
    expect(client.agents.list).toHaveBeenCalledTimes(1);
    expect(client.agents.list).toHaveBeenCalledWith(undefined);
  });

  it('passes pagination params through to the client list method', async () => {
    const client = createMockClient();
    const { Wrapper } = createWrapper(client);

    const params = { page: 2, limit: 10 };
    const { result } = renderHook(() => useAgents(params), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.agents.list).toHaveBeenCalledWith(params);
  });

  it('caches results under the shared agents.list query key', async () => {
    const client = createMockClient();
    const { queryClient, Wrapper } = createWrapper(client);

    const { result } = renderHook(() => useAgents({ page: 1 }), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cached = queryClient.getQueryData<Paginated<Agent>>(
      queryKeys.agents.list({ page: 1 }),
    );
    expect(cached).toEqual(AGENT_PAGE);
    expect(queryClient.getQueryState(queryKeys.agents.list({ page: 1 }))?.status).toBe(
      'success',
    );
  });

  it('surfaces client errors in the query error state', async () => {
    const client = createMockClient();
    (client.agents.list as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('List failed'),
    );
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(useAgents, { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('List failed');
    expect(result.current.data).toBeUndefined();
  });

  it('does not refetch on rerender while data is fresh', async () => {
    const client = createMockClient();
    const { Wrapper } = createWrapper(client);

    const { result, rerender } = renderHook(useAgents, { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender();
    rerender();

    expect(client.agents.list).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* useAgent — detail query                                                     */
/* -------------------------------------------------------------------------- */

describe('useAgent', () => {
  it('fetches and exposes a single agent by ID', async () => {
    const client = createMockClient();
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(() => useAgent('agent_001'), { wrapper: Wrapper });

    expect(result.current.isPending).toBe(true);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(AGENT_A);
    expect(result.current.data?.name).toBe('Ledger Agent');
    expect(client.agents.get).toHaveBeenCalledTimes(1);
    expect(client.agents.get).toHaveBeenCalledWith('agent_001');
  });

  it('caches the result under the agents.detail query key', async () => {
    const client = createMockClient();
    const { queryClient, Wrapper } = createWrapper(client);

    const { result } = renderHook(() => useAgent('agent_001'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(
      queryClient.getQueryData<Agent>(queryKeys.agents.detail('agent_001')),
    ).toEqual(AGENT_A);
  });

  it('surfaces client errors in the query error state', async () => {
    const client = createMockClient();
    (client.agents.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Not found'),
    );
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(() => useAgent('agent_404'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Not found');
    expect(result.current.data).toBeUndefined();
  });

  it('is disabled and does not fetch when the ID is undefined', async () => {
    const client = createMockClient();
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(() => useAgent(undefined), { wrapper: Wrapper });

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.isError).toBe(false);

    // Give the query a chance to misbehave before asserting it never fetched.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(client.agents.get).not.toHaveBeenCalled();
  });

  it('does not refetch on rerender while data is fresh', async () => {
    const client = createMockClient();
    const { Wrapper } = createWrapper(client);

    const { result, rerender } = renderHook(() => useAgent('agent_001'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender();
    rerender();

    expect(client.agents.get).toHaveBeenCalledTimes(1);
  });
});

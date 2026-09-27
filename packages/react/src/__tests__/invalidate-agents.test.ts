/**
 * Tests for the agents-domain invalidation helpers in `@astroid/react`.
 *
 * After agent mutations, the cache must converge to server state. These tests
 * verify that the typed helpers mark exactly the right query entries stale:
 * - `invalidateQueries.agent` invalidates one agent's detail and the agents domain
 * - `invalidateQueries.agents` invalidates only the agent list for the given params
 * - `invalidateQueries.all` scopes invalidation to the requested domain
 */

import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateQueries, queryKeys } from '../hooks.js';
import { AGENT_A, AGENT_PAGE } from './test-utils.js';

describe('invalidateQueries — agents domain', () => {
  it('agent invalidates the detail entry and the whole agents domain', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.agents.detail(AGENT_A.id), AGENT_A);
    queryClient.setQueryData(queryKeys.agents.list({}), AGENT_PAGE);

    await invalidateQueries.agent(queryClient, AGENT_A.id);

    expect(queryClient.getQueryState(queryKeys.agents.detail(AGENT_A.id))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(queryKeys.agents.list({}))?.isInvalidated).toBe(true);
  });

  it('agents invalidates only the matching list entry', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.agents.list({}), AGENT_PAGE);
    queryClient.setQueryData(queryKeys.agents.detail(AGENT_A.id), AGENT_A);

    await invalidateQueries.agents(queryClient, {});

    expect(queryClient.getQueryState(queryKeys.agents.list({}))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.agents.detail(AGENT_A.id))?.isInvalidated).toBe(
      false,
    );
  });

  it('all scopes invalidation to the requested domain', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.agents.list({}), AGENT_PAGE);
    queryClient.setQueryData(queryKeys.wallets.list({}), {
      data: [],
      meta: AGENT_PAGE.meta,
    });

    await invalidateQueries.all(queryClient, 'agents');

    expect(queryClient.getQueryState(queryKeys.agents.list({}))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.wallets.list({}))?.isInvalidated).toBe(false);
  });
});

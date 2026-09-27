/**
 * Type-level assertions for the agent resource hooks.
 *
 * The annotated assignments below are checked by the TypeScript compiler
 * (`pnpm typecheck`): if a hook's signature drifts from the documented
 * TanStack Query types — query data/error types, or mutation variables —
 * compilation fails. The runtime assertions keep the file executable under
 * `vitest`.
 */

import { describe, expect, it } from 'vitest';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type { Agent, CreateAgentParams, Paginated, PaginationParams } from '@astroid/types';
import { useAgent, useAgents, useCreateAgent } from '../index.js';

describe('agent hook signatures', () => {
  it('matches the documented TanStack Query types', () => {
    const agentsHook: (
      params?: PaginationParams,
    ) => UseQueryResult<Paginated<Agent>, Error> = useAgents;
    const agentHook: (id: string | undefined) => UseQueryResult<Agent, Error> = useAgent;
    const createAgentHook: () => UseMutationResult<Agent, Error, CreateAgentParams> =
      useCreateAgent;

    expect(typeof agentsHook).toBe('function');
    expect(typeof agentHook).toBe('function');
    expect(typeof createAgentHook).toBe('function');
  });
});

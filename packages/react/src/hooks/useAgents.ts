import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useAstroidClient } from '../hooks.js';
import type { Agent, CreateAgentParams, UpdateAgentParams, Paginated } from '@astroid/types';
import { queryKeys } from '../hooks.js';

/* -------------------------------------------------------------------------- */
/* useCreateAgent — optimistic: prepend to list cache                          */
/* -------------------------------------------------------------------------- */

/**
 * Mutation hook to create a new autonomous agent.
 *
 * **Optimistic update**: the new agent is immediately prepended to every cached
 * agent list so the UI reflects the change before the server responds. If the
 * mutation fails the optimistic entry is rolled back and the cache is restored
 * to its previous snapshot.
 *
 * On settle (success _or_ error) the agent list queries are invalidated so the
 * cache converges to the authoritative server state.
 */
export function useCreateAgent(): UseMutationResult<Agent, Error, CreateAgentParams> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: CreateAgentParams) => astroid.agents.create(params),
    onMutate: (newParams) => {
      // Cancel outgoing refetches so they don't overwrite the optimistic update.
      // Fire-and-forget: cancellation races with the snapshot below but the
      // `onSettled` invalidation always ensures convergence.
      void queryClient.cancelQueries({ queryKey: queryKeys.agents.all });

      // Snapshot the previous list cache so we can roll back on error.
      const previousLists = queryClient.getQueriesData<Paginated<Agent>>({
        queryKey: queryKeys.agents.all,
      });

      // Build a temporary optimistic agent from the create params. The id and
      // timestamps are synthetic — they'll be replaced by the real entity on
      // settle when the cache is invalidated and refetched.
      const optimisticAgent: Agent = {
        id: `optimistic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        organizationId: '',
        name: newParams.name,
        description: newParams.description ?? null,
        role: newParams.role ?? ('CUSTOM' as Agent['role']),
        status: 'ACTIVE' as Agent['status'],
        capabilities: newParams.capabilities,
        provider: newParams.provider ?? null,
        model: newParams.model ?? null,
        primaryWalletId: newParams.primaryWalletId ?? null,
        metadata: newParams.metadata ?? {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Optimistically prepend the temporary agent to every cached list.
      for (const [key, oldData] of previousLists) {
        if (!oldData) continue;
        queryClient.setQueryData<Paginated<Agent>>(key, {
          ...oldData,
          data: [optimisticAgent, ...oldData.data],
        });
      }

      return { previousLists };
    },
    onError: (_err, _vars, context) => {
      // Roll back every list to the snapshot taken before the optimistic update.
      if (context?.previousLists) {
        for (const [key, data] of context.previousLists) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      // Invalidate so TanStack Query re-fetches the authoritative state.
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* useUpdateAgent — optimistic: merge into detail + list caches               */
/* -------------------------------------------------------------------------- */

/**
 * Mutation hook to update an existing autonomous agent.
 *
 * **Optimistic update**: the agent's cached detail and every list entry are
 * immediately patched with the update payload so the UI reflects the change
 * before the server responds. If the mutation fails all caches are restored to
 * their pre-mutation snapshots.
 *
 * On settle the detail and list queries are invalidated.
 */
export function useUpdateAgent(): UseMutationResult<
  Agent,
  Error,
  { id: string; params: UpdateAgentParams }
> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, params }: { id: string; params: UpdateAgentParams }) =>
      astroid.agents.update(id, params),
    onMutate: ({ id, params }) => {
      void queryClient.cancelQueries({ queryKey: queryKeys.agents.all });

      // Snapshot previous state for rollback.
      const previousDetail = queryClient.getQueryData<Agent>(queryKeys.agents.detail(id));
      const previousLists = queryClient.getQueriesData<Paginated<Agent>>({
        queryKey: queryKeys.agents.all,
      });

      // Optimistically patch the detail cache if it exists.
      if (previousDetail) {
        queryClient.setQueryData<Agent>(queryKeys.agents.detail(id), {
          ...previousDetail,
          ...params,
          updatedAt: new Date().toISOString(),
        });
      }

      // Optimistically patch the matching agent inside every cached list.
      for (const [key, oldData] of previousLists) {
        if (!oldData) continue;
        queryClient.setQueryData<Paginated<Agent>>(key, {
          ...oldData,
          data: oldData.data.map((agent: Agent) =>
            agent.id === id ? { ...agent, ...params, updatedAt: new Date().toISOString() } : agent,
          ),
        });
      }

      return { previousDetail, previousLists };
    },
    onError: (_err, { id }, context) => {
      // Roll back the detail cache.
      if (context?.previousDetail) {
        queryClient.setQueryData(queryKeys.agents.detail(id), context.previousDetail);
      }
      // Roll back every list cache.
      if (context?.previousLists) {
        for (const [key, data] of context.previousLists) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: (_data, _error, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* useDeleteAgent — optimistic: remove from list cache                        */
/* -------------------------------------------------------------------------- */

/**
 * Mutation hook to delete an autonomous agent.
 *
 * **Optimistic update**: the agent is immediately removed from every cached
 * agent list so the UI reflects the deletion before the server responds. If
 * the mutation fails the previous list caches are restored.
 *
 * On settle the detail and list queries are invalidated.
 */
export function useDeleteAgent(): UseMutationResult<void, Error, string> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => astroid.agents.delete(id),
    onMutate: (id) => {
      void queryClient.cancelQueries({ queryKey: queryKeys.agents.all });

      const previousDetail = queryClient.getQueryData<Agent>(queryKeys.agents.detail(id));
      const previousLists = queryClient.getQueriesData<Paginated<Agent>>({
        queryKey: queryKeys.agents.all,
      });

      // Optimistically remove the agent from every cached list.
      for (const [key, oldData] of previousLists) {
        if (!oldData) continue;
        queryClient.setQueryData<Paginated<Agent>>(key, {
          ...oldData,
          data: oldData.data.filter((agent: Agent) => agent.id !== id),
        });
      }

      return { previousDetail, previousLists };
    },
    onError: (_err, id, context) => {
      // Roll back the detail cache.
      if (context?.previousDetail) {
        queryClient.setQueryData(queryKeys.agents.detail(id), context.previousDetail);
      }
      // Roll back every list cache.
      if (context?.previousLists) {
        for (const [key, data] of context.previousLists) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: (_data, _error, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
  });
}

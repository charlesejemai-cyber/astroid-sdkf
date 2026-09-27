# @astroid/react

React hooks and `<AstroidProvider>` for the Astroid SDK, built on TanStack
Query. Suspense-ready and Next.js Server Component compatible.

## Setup

Wrap your tree in a `QueryClientProvider` and the `AstroidProvider` with an
initialized SDK client:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Astroid } from '@astroid/client';
import { AstroidProvider } from '@astroid/react';

const astroid = new Astroid({ apiKey: process.env.ASTROID_API_KEY! });
const queryClient = new QueryClient();

<QueryClientProvider client={queryClient}>
  <AstroidProvider client={astroid}>
    <App />
  </AstroidProvider>
</QueryClientProvider>
```

## Agent resource hooks

```ts
import { useAgents, useAgent, useCreateAgent } from '@astroid/react';

// Paginated agent list (reactive to the params object).
const { data, isPending, error } = useAgents({ page: 1, limit: 25 });

// Single agent by ID. The query stays idle until an ID is provided.
const { data: agent } = useAgent(id);

// Create an agent. The new agent is optimistically prepended to every cached
// list and rolled back if the request fails; the list is invalidated on settle.
const createAgent = useCreateAgent();
createAgent.mutate({
  name: 'Treasury Bot',
  capabilities: ['transfer'],
  initialBudget: { currency: 'USDC', amount: '500' },
});
```

- `useAgents(params?)` — paginated list query, cached under `['astroid', 'agents', 'list', params]`.
- `useAgent(id?)` — detail query, cached under `['astroid', 'agents', 'detail', id]` and disabled while `id` is undefined.
- `useCreateAgent()` — optimistic create mutation. Companion mutations
  `useUpdateAgent()` and `useDeleteAgent()` follow the same optimistic pattern.
- `queryKeys` and `invalidateQueries` are exported for direct cache access and
  typed invalidation.

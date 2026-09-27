/**
 * Shared test harness for `@astroid/react` hook tests.
 *
 * Provides realistic agent fixtures, a mock Astroid client with spy methods,
 * and a fresh QueryClient + AstroidProvider wrapper so hooks render inside
 * the same provider tree they require at runtime. No live API is contacted.
 */

import { vi } from 'vitest';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AstroidProvider } from '../provider.js';
import type { Astroid } from '@astroid/client';
import type { Agent, CreateAgentParams, Paginated } from '@astroid/types';

/** A fully-populated agent fixture. */
export const AGENT_A: Agent = {
  id: 'agent_001',
  organizationId: 'org_1',
  name: 'Ledger Agent',
  description: 'Reconciles on-chain activity',
  role: 'FINANCE',
  status: 'ACTIVE',
  capabilities: ['audit', 'reconcile'],
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  primaryWalletId: 'wal_001',
  metadata: { team: 'finance' },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

/** A second agent fixture used for list-shape assertions. */
export const AGENT_B: Agent = {
  ...AGENT_A,
  id: 'agent_002',
  name: 'Treasury Agent',
  description: 'Manages liquidity positions',
  capabilities: ['transfer'],
  primaryWalletId: null,
};

/** A single-page agent list returned by the mocked `agents.list`. */
export const AGENT_PAGE: Paginated<Agent> = {
  data: [AGENT_A, AGENT_B],
  meta: {
    page: 1,
    limit: 25,
    total: 2,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

/** Create a mock Astroid client with spy methods for the agents resource. */
export function createMockClient() {
  return {
    agents: {
      list: vi.fn(async (): Promise<Paginated<Agent>> => AGENT_PAGE),
      get: vi.fn(async (): Promise<Agent> => AGENT_A),
      create: vi.fn(async (params: CreateAgentParams): Promise<Agent> => ({
        ...AGENT_A,
        id: 'agent_created',
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
      })),
    },
  } as unknown as Astroid;
}

/**
 * A fresh QueryClient + AstroidProvider wrapper for each hook render.
 *
 * Pass `gcTime: Infinity` for tests that prime the cache with data that has no
 * active observer (e.g. optimistic-mutation tests); the default `gcTime: 0`
 * garbage-collects unobserved entries during mutation cache transactions.
 */
export function createWrapper(client: Astroid, options: { gcTime?: number } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: options.gcTime ?? 0 } },
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

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAstroid } from '../index.js';
import type { Agent, AnalyticsOverview, Budget, Paginated } from '@astroid/types';

export interface UseAgentMetricsOptions {
  pollingInterval?: number;
  enabled?: boolean;
}

export interface AgentMetricsData {
  agentId: string;
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  transactionSuccessRate: number; // percentage 0-100
  totalBudgetLimit: number;
  totalBudgetSpent: number;
  remainingBudgetCapacity: number;
  percentBudgetSpent: number; // percentage 0-100
  isOutOfBudget: boolean;
}

export interface UseAgentMetricsResult {
  data: AgentMetricsData | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

interface AgentQueryPayload {
  agent: Agent | null;
  budgets: Budget[];
  analytics: AnalyticsOverview | null;
}

/**
 * Hook to fetch and aggregate real-time metrics for an autonomous agent.
 *
 * @param agentId - The ID of the agent to track.
 * @param options - Configuration options including pollingInterval (in ms) and enabled flag.
 */
export function useAgentMetrics(
  agentId: string,
  options: UseAgentMetricsOptions = {},
): UseAgentMetricsResult {
  const astroid = useAstroid();
  const { pollingInterval, enabled = true } = options;

  const agentQuery = useQuery<AgentQueryPayload | null, Error>({
    queryKey: ['astroid', 'agents', agentId, 'metrics'],
    queryFn: async (): Promise<AgentQueryPayload | null> => {
      if (!agentId) return null;
      const [agent, budgetsRes, analytics] = await Promise.all([
        astroid.agents.get(agentId).catch(() => null),
        astroid.budgets
          .list({ agentId })
          .catch(() => ({ data: [] }) as unknown as Paginated<Budget>),
        astroid.analytics.overview({ agentId }).catch(() => null),
      ]);
      return { agent, budgets: budgetsRes?.data ?? [], analytics };
    },
    enabled: Boolean(agentId) && enabled,
    refetchInterval: pollingInterval && pollingInterval > 0 ? pollingInterval : false,
  });

  const metrics = useMemo<AgentMetricsData | null>(() => {
    if (!agentQuery.data) return null;

    const { budgets, analytics } = agentQuery.data;

    let totalLimit = 0;
    let totalSpent = 0;

    if (Array.isArray(budgets)) {
      for (const b of budgets) {
        const lim = parseFloat(b.limitAmount);
        const sp = parseFloat(b.spent);
        if (!isNaN(lim)) totalLimit += lim;
        if (!isNaN(sp)) totalSpent += sp;
      }
    }

    const remainingCapacity = Math.max(0, totalLimit - totalSpent);
    const percentSpent = totalLimit > 0 ? Math.min(100, (totalSpent / totalLimit) * 100) : 0;
    const isOutOfBudget = totalLimit > 0 && totalSpent >= totalLimit;

    const totalTx = analytics?.transactionCount ?? 0;
    const failedTx = analytics?.policyViolations ?? 0;
    const successfulTx = Math.max(0, totalTx - failedTx);
    const successRate = totalTx > 0 ? (successfulTx / totalTx) * 100 : 100;

    return {
      agentId,
      totalTransactions: totalTx,
      successfulTransactions: successfulTx,
      failedTransactions: failedTx,
      transactionSuccessRate: Math.round(successRate * 100) / 100,
      totalBudgetLimit: totalLimit,
      totalBudgetSpent: totalSpent,
      remainingBudgetCapacity: remainingCapacity,
      percentBudgetSpent: Math.round(percentSpent * 100) / 100,
      isOutOfBudget,
    };
  }, [agentId, agentQuery.data]);

  return {
    data: metrics,
    isLoading: agentQuery.isLoading,
    isError: agentQuery.isError,
    error: agentQuery.error as Error | null,
    refetch: agentQuery.refetch,
  };
}

import type { Budget, BudgetHistoryEntry } from '@astroid/types';

export interface SpendRequest {
  asset: string;
  amount: string | number;
}

export interface UtilizationResult {
  utilization: number;
  percent: number;
  spent: string;
  remaining: string;
}

export interface ThresholdResult {
  exceeded: boolean;
  level: 'ok' | 'warn' | 'critical' | 'exceeded';
  depleted: boolean;
  thresholdCrossed?: number;
}

export interface BurnRateResult {
  averagePerPeriod: number;
  periodsUntilExhaustion: number | null;
  unsustainable: boolean;
}

function parseAmount(val: string | number | undefined): number {
  if (val === undefined || val === null) return 0;
  const num = typeof val === 'number' ? val : parseFloat(val);
  return isNaN(num) ? 0 : num;
}

function formatAmount(val: number): string {
  return String(Math.max(0, val));
}

/**
 * Calculates the utilization metrics for a given budget.
 */
export function calculateUtilization(
  budget: Budget,
  history?: BudgetHistoryEntry[],
  request?: SpendRequest,
): UtilizationResult {
  const limit = parseAmount(budget.limitAmount);

  let spentNum = parseAmount(budget.spent);
  if (history && history.length > 0) {
    let totalHistory = 0;
    for (const entry of history) {
      totalHistory += parseAmount(entry.amount);
    }
    spentNum = totalHistory;
  }

  if (request) {
    spentNum += parseAmount(request.amount);
  }

  if (limit <= 0) {
    return {
      utilization: 0,
      percent: 0,
      spent: formatAmount(spentNum),
      remaining: '0',
    };
  }

  let utilization = spentNum / limit;
  if (utilization > 1) {
    utilization = 1;
  } else if (utilization < 0) {
    utilization = 0;
  }

  const remainingNum = Math.max(0, limit - spentNum);
  const percent = Math.round(utilization * 10000) / 100;

  return {
    utilization,
    percent,
    spent: formatAmount(spentNum),
    remaining: formatAmount(remainingNum),
  };
}

/**
 * Determines if budget alert thresholds have been exceeded.
 */
export function isThresholdExceeded(
  budget: Budget,
  thresholds?: { warn?: number; critical?: number },
  history?: BudgetHistoryEntry[],
): ThresholdResult {
  const warn = thresholds?.warn ?? 0.8;
  const critical = thresholds?.critical ?? 0.95;

  const { utilization } = calculateUtilization(budget, history);
  const limit = parseAmount(budget.limitAmount);
  const spent = parseAmount(budget.spent);

  const depleted = limit > 0 && spent >= limit;

  if (depleted || utilization >= 1) {
    return {
      exceeded: true,
      level: 'exceeded',
      depleted: true,
    };
  }

  if (utilization >= critical) {
    return {
      exceeded: true,
      level: 'critical',
      depleted: false,
      thresholdCrossed: critical,
    };
  }

  if (utilization >= warn) {
    return {
      exceeded: true,
      level: 'warn',
      depleted: false,
      thresholdCrossed: warn,
    };
  }

  return {
    exceeded: false,
    level: 'ok',
    depleted: false,
  };
}

/**
 * Estimates the burn rate and periods until exhaustion.
 */
export function estimateBurnRate(budget: Budget, periodsCount = 1): BurnRateResult {
  const limit = parseAmount(budget.limitAmount);
  const spent = parseAmount(budget.spent);
  const remaining = Math.max(0, limit - spent);

  if (limit <= 0 || periodsCount <= 0) {
    return {
      averagePerPeriod: 0,
      periodsUntilExhaustion: null,
      unsustainable: false,
    };
  }

  if (spent >= limit) {
    return {
      averagePerPeriod: spent / periodsCount,
      periodsUntilExhaustion: null,
      unsustainable: true,
    };
  }

  const averagePerPeriod = spent / periodsCount;
  if (averagePerPeriod <= 0) {
    return {
      averagePerPeriod: 0,
      periodsUntilExhaustion: null,
      unsustainable: false,
    };
  }

  const periodsUntilExhaustion = Math.ceil(remaining / averagePerPeriod);

  return {
    averagePerPeriod,
    periodsUntilExhaustion,
    unsustainable: false,
  };
}

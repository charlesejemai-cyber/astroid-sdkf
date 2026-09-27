import type { BudgetHistoryEntry, BudgetPeriod } from '@astroid/types';

export interface RollingWindowOptions {
  period:
    | BudgetPeriod
    | 'rolling_1d'
    | 'rolling_7d'
    | 'rolling_30d'
    | 'daily'
    | 'weekly'
    | 'monthly';
  limit: number | string;
  evaluationTime?: Date | string | number;
  warningThresholdPercent?: number; // default 80%
}

export interface RollingWindowCalculationResult {
  totalLimit: number;
  consumedAmount: number;
  remainingMargin: number;
  isExhausted: boolean;
  isWarningTriggered: boolean;
  activeWindowStart: Date;
  activeWindowEnd: Date;
  filteredEntriesCount: number;
}

export function getRollingWindowBounds(
  period: RollingWindowOptions['period'],
  evalTime: Date = new Date(),
): { start: Date; end: Date } {
  const end = new Date(evalTime.getTime());
  const start = new Date(evalTime.getTime());

  switch (period) {
    case 'rolling_1d':
    case 'daily':
      start.setUTCDate(start.getUTCDate() - 1);
      break;
    case 'rolling_7d':
    case 'weekly':
      start.setUTCDate(start.getUTCDate() - 7);
      break;
    case 'rolling_30d':
    case 'monthly':
      start.setUTCDate(start.getUTCDate() - 30);
      break;
    default:
      start.setUTCDate(start.getUTCDate() - 30);
      break;
  }

  return { start, end };
}

export function calculateRollingWindowBudget(
  history: BudgetHistoryEntry[] | null | undefined,
  options: RollingWindowOptions,
): RollingWindowCalculationResult {
  const evalDate = options.evaluationTime ? new Date(options.evaluationTime) : new Date();

  const totalLimit =
    typeof options.limit === 'string' ? parseFloat(options.limit) || 0 : options.limit;
  const warningPercent = options.warningThresholdPercent ?? 80;

  const { start, end } = getRollingWindowBounds(options.period, evalDate);
  const startTime = start.getTime();
  const endTime = end.getTime();

  let consumedAmount = 0;
  let filteredEntriesCount = 0;

  if (Array.isArray(history)) {
    for (const entry of history) {
      if (!entry || !entry.createdAt) continue;
      const entryDate = new Date(entry.createdAt);
      const entryTime = entryDate.getTime();

      if (isNaN(entryTime)) continue;

      if (entryTime >= startTime && entryTime <= endTime) {
        const amt = parseFloat(entry.amount);
        if (!isNaN(amt)) {
          consumedAmount += amt;
          filteredEntriesCount++;
        }
      }
    }
  }

  // Handle JS floating point precision cleanly
  consumedAmount = Math.round(consumedAmount * 1e7) / 1e7;
  const remainingMargin = Math.max(0, Math.round((totalLimit - consumedAmount) * 1e7) / 1e7);
  const isExhausted = consumedAmount >= totalLimit;
  const warningLimit = (totalLimit * warningPercent) / 100;
  const isWarningTriggered = consumedAmount >= warningLimit;

  return {
    totalLimit,
    consumedAmount,
    remainingMargin,
    isExhausted,
    isWarningTriggered,
    activeWindowStart: start,
    activeWindowEnd: end,
    filteredEntriesCount,
  };
}

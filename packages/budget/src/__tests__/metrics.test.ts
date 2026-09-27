import { describe, expect, it } from 'vitest';

import type { Budget, BudgetHistoryEntry } from '@astroid/types';

import { calculateUtilization, estimateBurnRate, isThresholdExceeded } from '../metrics.js';

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'budget-1',
    organizationId: 'org-1',
    name: 'Test Budget',
    currency: 'USDC',
    limitAmount: '100',
    spent: '0',
    remaining: '100',
    period: 'DAILY',
    periodStart: '2025-06-15T00:00:00.000Z',
    rollover: false,
    enabled: true,
    createdAt: '2025-06-15T00:00:00.000Z',
    updatedAt: '2025-06-15T00:00:00.000Z',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<BudgetHistoryEntry> = {}): BudgetHistoryEntry {
  return {
    id: 'entry-1',
    budgetId: 'budget-1',
    amount: '10',
    spentAfter: '10',
    createdAt: '2025-06-15T12:00:00.000Z',
    ...overrides,
  };
}

describe('calculateUtilization', () => {
  it('computes a simple utilization from stored spent to limit', () => {
    const budget = makeBudget({ limitAmount: '100', spent: '75', remaining: '25' });
    const result = calculateUtilization(budget);

    expect(result.utilization).toBe(0.75);
    expect(result.percent).toBe(75);
    expect(result.spent).toBe('75');
    expect(result.remaining).toBe('25');
  });

  it('returns 0 for a zero budget limit (no div-by-zero)', () => {
    const budget = makeBudget({ limitAmount: '0', spent: '0', remaining: '0' });
    const result = calculateUtilization(budget);

    expect(result.utilization).toBe(0);
    expect(result.percent).toBe(0);
  });

  it('yields exactly 1.0 for a fully-exhausted budget', () => {
    const budget = makeBudget({ limitAmount: '100', spent: '100', remaining: '0' });
    const result = calculateUtilization(budget);

    expect(result.utilization).toBe(1);
    expect(result.remaining).toBe('0');
  });

  it('uses window history when provided to compute spent', () => {
    const budget = makeBudget({ limitAmount: '100', spent: '0', remaining: '100' });
    const history = [
      makeEntry({ amount: '40' }),
      makeEntry({ id: 'e2', amount: '30', createdAt: '2025-06-15T13:00:00Z' }),
    ];

    const result = calculateUtilization(budget, history);
    expect(result.spent).toBe('70');
    expect(result.utilization).toBe(0.7);
  });

  it('projects a prospective request on top of current spent', () => {
    const budget = makeBudget({ limitAmount: '100', spent: '60', remaining: '40' });
    const result = calculateUtilization(budget, undefined, { asset: 'USDC', amount: '20' });

    // spent 60 + 20 = 80 → 0.8 utilisation
    expect(result.spent).toBe('80');
    expect(result.utilization).toBe(0.8);
  });

  it('clamps utilization to 1 when over-spent', () => {
    const budget = makeBudget({ limitAmount: '100', spent: '150', remaining: '-50' });
    const result = calculateUtilization(budget);

    expect(result.utilization).toBe(1);
    expect(result.remaining).toBe('0');
  });
});

describe('isThresholdExceeded', () => {
  it('returns ok below the warn threshold', () => {
    const budget = makeBudget({ limitAmount: '100', spent: '50', remaining: '50' });
    const result = isThresholdExceeded(budget);

    expect(result.exceeded).toBe(false);
    expect(result.level).toBe('ok');
    expect(result.depleted).toBe(false);
  });

  it('flags warn at/above 80% (default)', () => {
    const budget = makeBudget({ limitAmount: '100', spent: '80', remaining: '20' });
    const result = isThresholdExceeded(budget);

    expect(result.exceeded).toBe(true);
    expect(result.level).toBe('warn');
    expect(result.thresholdCrossed).toBe(0.8);
  });

  it('flags critical at/above 95% (default)', () => {
    const budget = makeBudget({ limitAmount: '100', spent: '96', remaining: '4' });
    const result = isThresholdExceeded(budget);

    expect(result.level).toBe('critical');
    expect(result.thresholdCrossed).toBe(0.95);
  });

  it('flags exceeded when fully depleted', () => {
    const budget = makeBudget({ limitAmount: '100', spent: '100', remaining: '0' });
    const result = isThresholdExceeded(budget);

    expect(result.depleted).toBe(true);
    expect(result.level).toBe('exceeded');
  });

  it('honours an exact warn threshold match', () => {
    const budget = makeBudget({ limitAmount: '100', spent: '90', remaining: '10' });
    const result = isThresholdExceeded(budget, { warn: 0.9, critical: 1 });

    expect(result.exceeded).toBe(true);
    expect(result.level).toBe('warn');
  });
});

describe('estimateBurnRate', () => {
  it('projects exhaustion periods from current burn', () => {
    // spent 50 over 1 window → 50/period towards a 100 limit → 1 period left
    const budget = makeBudget({ limitAmount: '100', spent: '50', remaining: '50' });
    const result = estimateBurnRate(budget, 1);

    expect(result.averagePerPeriod).toBe(50);
    expect(result.periodsUntilExhaustion).toBe(1);
    expect(result.unsustainable).toBe(false);
  });

  it('sizes a multi-window burn correctly', () => {
    const budget = makeBudget({ limitAmount: '100', spent: '80', remaining: '20' });
    const result = estimateBurnRate(budget, 4);

    expect(result.averagePerPeriod).toBe(20);
    expect(result.periodsUntilExhaustion).toBe(1); // 20 remaining / 20 per period
  });

  it('marks a budget as unsustainable once fully spent', () => {
    const budget = makeBudget({ limitAmount: '100', spent: '100', remaining: '0' });
    const result = estimateBurnRate(budget, 1);

    expect(result.unsustainable).toBe(true);
    expect(result.periodsUntilExhaustion).toBeNull();
  });

  it('handles a zero limit gracefully', () => {
    const budget = makeBudget({ limitAmount: '0', spent: '0', remaining: '0' });
    const result = estimateBurnRate(budget, 1);

    expect(result.periodsUntilExhaustion).toBeNull();
    expect(result.unsustainable).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { aggregateTransactionMetrics } from './metrics.js';
import type { Transaction } from '@astroid/types';

const tx = (asset: string, amount: string, createdAt: string): Transaction => ({
  id: `${asset}-${amount}-${createdAt}`,
  organizationId: 'org',
  walletId: 'wallet',
  asset,
  amount,
  recipientAddress: 'GABC',
  status: 'COMPLETED',
  riskScore: 0,
  riskBand: 'LOW',
  requiresApproval: false,
  confirmationCount: 1,
  metadata: {},
  createdAt,
  updatedAt: createdAt,
});

describe('aggregateTransactionMetrics', () => {
  it('groups UTC days and preserves decimal strings', () => {
    const result = aggregateTransactionMetrics([
      tx('USDC', '1.10', '2026-01-05T23:00:00.000Z'),
      tx('USDC', '2.20', '2026-01-06T01:00:00.000Z'),
      tx('XLM', '5', '2026-01-06T01:00:00.000Z'),
    ]);
    expect(result.totalVolume).toBe('8.3');
    expect(result.buckets).toHaveLength(2);
    expect(result.buckets[0]?.start).toBe('2026-01-05T00:00:00.000Z');
    expect(result.buckets[1]?.totalCount).toBe(2);
  });
});

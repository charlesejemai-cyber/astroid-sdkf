import { describe, expect, it } from 'vitest';
import { aggregateTransactionMetrics } from './aggregations.js';
import type { Transaction, TransactionStatus } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `tx-${Math.random().toString(36).slice(2, 8)}`,
    organizationId: 'org',
    walletId: 'wallet',
    asset: 'USDC',
    amount: '100',
    recipientAddress: 'GABC',
    status: 'COMPLETED' satisfies TransactionStatus,
    riskScore: 0,
    riskBand: 'LOW',
    requiresApproval: false,
    confirmationCount: 1,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe('aggregateTransactionMetrics', () => {
  describe('empty input', () => {
    it('returns zeroed metrics for an empty transaction list', () => {
      const result = aggregateTransactionMetrics([]);

      expect(result.totalVolume).toBe('0');
      expect(result.totalFees).toBe('0');
      expect(result.averageLatencyMs).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
      expect(result.totalCount).toBe(0);
      expect(result.successRate).toBe(0);
      expect(result.buckets).toHaveLength(0);
    });
  });

  describe('daily granularity (default)', () => {
    it('groups transactions into daily UTC buckets', () => {
      const txns = [
        makeTx({
          amount: '50',
          createdAt: '2026-03-10T08:00:00.000Z',
          updatedAt: '2026-03-10T08:00:02.000Z',
        }),
        makeTx({
          amount: '30',
          createdAt: '2026-03-10T15:00:00.000Z',
          updatedAt: '2026-03-10T15:00:01.000Z',
        }),
        makeTx({
          amount: '20',
          createdAt: '2026-03-11T02:00:00.000Z',
          updatedAt: '2026-03-11T02:00:03.000Z',
        }),
      ];

      const result = aggregateTransactionMetrics(txns);

      expect(result.granularity).toBe('day');
      expect(result.totalVolume).toBe('100');
      expect(result.totalCount).toBe(3);
      expect(result.buckets).toHaveLength(2);

      // Buckets sorted chronologically
      expect(result.buckets[0]?.start).toBe('2026-03-10T00:00:00.000Z');
      expect(result.buckets[0]?.end).toBe('2026-03-11T00:00:00.000Z');
      expect(result.buckets[0]?.totalVolume).toBe('80');
      expect(result.buckets[0]?.totalCount).toBe(2);

      expect(result.buckets[1]?.start).toBe('2026-03-11T00:00:00.000Z');
      expect(result.buckets[1]?.end).toBe('2026-03-12T00:00:00.000Z');
      expect(result.buckets[1]?.totalVolume).toBe('20');
      expect(result.buckets[1]?.totalCount).toBe(1);
    });

    it('computes correct success and failure rates', () => {
      const txns = [
        makeTx({ status: 'COMPLETED' }),
        makeTx({ status: 'COMPLETED', id: 'tx-2' }),
        makeTx({ status: 'CONFIRMED', id: 'tx-3' }),
        makeTx({ status: 'FAILED', id: 'tx-4' }),
        makeTx({ status: 'REJECTED', id: 'tx-5' }),
        // Pending — should not count toward success rate denominator
        makeTx({ status: 'PENDING', id: 'tx-6' }),
      ];

      const result = aggregateTransactionMetrics(txns);

      expect(result.totalCount).toBe(6);
      expect(result.successCount).toBe(3);
      expect(result.failureCount).toBe(2);
      // successRate = 3 / (3 + 2) = 0.6
      expect(result.successRate).toBeCloseTo(0.6, 10);
    });

    it('handles transactions with only pending statuses (no resolved)', () => {
      const txns = [
        makeTx({ status: 'PENDING' }),
        makeTx({ status: 'APPROVED', id: 'tx-2' }),
        makeTx({ status: 'SUBMITTED', id: 'tx-3' }),
      ];

      const result = aggregateTransactionMetrics(txns);

      expect(result.totalCount).toBe(3);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
      expect(result.successRate).toBe(0);
    });

    it('computes fees from gasEstimate, falling back to "0"', () => {
      const txns = [
        makeTx({ gasEstimate: '0.001', amount: '100' }),
        makeTx({ gasEstimate: '0.002', amount: '200', id: 'tx-2' }),
        makeTx({ gasEstimate: null, amount: '50', id: 'tx-3' }),
        makeTx({ amount: '75', id: 'tx-4' }), // no gasEstimate key
      ];

      const result = aggregateTransactionMetrics(txns);

      expect(result.totalFees).toBe('0.003');
      expect(result.totalVolume).toBe('425');
    });

    it('computes average latency in milliseconds', () => {
      const txns = [
        makeTx({
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:05.000Z', // 5000ms
        }),
        makeTx({
          id: 'tx-2',
          createdAt: '2026-06-01T06:00:00.000Z',
          updatedAt: '2026-06-01T06:00:03.000Z', // 3000ms
        }),
      ];

      const result = aggregateTransactionMetrics(txns);

      // (5000 + 3000) / 2 = 4000
      expect(result.averageLatencyMs).toBe(4000);
      expect(result.buckets[0]?.averageLatencyMs).toBe(4000);
    });

    it('preserves decimal precision for large volumes', () => {
      const txns = [
        makeTx({ amount: '9999999.99' }),
        makeTx({ amount: '0.01', id: 'tx-2' }),
        makeTx({ amount: '1234567.123456', id: 'tx-3' }),
      ];

      const result = aggregateTransactionMetrics(txns);

      expect(result.totalVolume).toBe('11234567.123456');
    });
  });

  describe('hourly granularity', () => {
    it('groups transactions into hourly UTC buckets', () => {
      const txns = [
        makeTx({ amount: '10', createdAt: '2026-05-01T00:30:00.000Z' }),
        makeTx({ amount: '20', createdAt: '2026-05-01T01:15:00.000Z', id: 'tx-2' }),
        makeTx({ amount: '30', createdAt: '2026-05-01T01:45:00.000Z', id: 'tx-3' }),
      ];

      const result = aggregateTransactionMetrics(txns, { granularity: 'hour' });

      expect(result.granularity).toBe('hour');
      expect(result.buckets).toHaveLength(2);

      expect(result.buckets[0]?.start).toBe('2026-05-01T00:00:00.000Z');
      expect(result.buckets[0]?.end).toBe('2026-05-01T01:00:00.000Z');
      expect(result.buckets[0]?.totalVolume).toBe('10');

      expect(result.buckets[1]?.start).toBe('2026-05-01T01:00:00.000Z');
      expect(result.buckets[1]?.end).toBe('2026-05-01T02:00:00.000Z');
      expect(result.buckets[1]?.totalVolume).toBe('50');
      expect(result.buckets[1]?.totalCount).toBe(2);
    });

    it('computes per-bucket success rates for hourly buckets', () => {
      const txns = [
        makeTx({ createdAt: '2026-05-01T00:00:00.000Z', status: 'COMPLETED' }),
        makeTx({ createdAt: '2026-05-01T00:30:00.000Z', status: 'FAILED', id: 'tx-2' }),
        makeTx({ createdAt: '2026-05-01T01:00:00.000Z', status: 'COMPLETED', id: 'tx-3' }),
        makeTx({ createdAt: '2026-05-01T01:30:00.000Z', status: 'COMPLETED', id: 'tx-4' }),
      ];

      const result = aggregateTransactionMetrics(txns, { granularity: 'hour' });

      // Hour 0: 1 success, 1 failure → 0.5
      expect(result.buckets[0]?.successRate).toBeCloseTo(0.5, 10);
      // Hour 1: 2 success, 0 failure → 1.0
      expect(result.buckets[1]?.successRate).toBe(1);
    });
  });

  describe('weekly granularity', () => {
    it('groups transactions into weekly UTC buckets (Monday–Sunday)', () => {
      // Mon 2026-03-02 and Wed 2026-03-04 are in the same week
      // Mon 2026-03-09 is in the next week
      const txns = [
        makeTx({ amount: '100', createdAt: '2026-03-02T10:00:00.000Z' }),
        makeTx({ amount: '200', createdAt: '2026-03-04T12:00:00.000Z', id: 'tx-2' }),
        makeTx({ amount: '50', createdAt: '2026-03-09T08:00:00.000Z', id: 'tx-3' }),
      ];

      const result = aggregateTransactionMetrics(txns, { granularity: 'week' });

      expect(result.granularity).toBe('week');
      expect(result.buckets).toHaveLength(2);

      // Week 1: Mon Mar 2 – Mon Mar 9
      expect(result.buckets[0]?.start).toBe('2026-03-02T00:00:00.000Z');
      expect(result.buckets[0]?.end).toBe('2026-03-09T00:00:00.000Z');
      expect(result.buckets[0]?.totalVolume).toBe('300');

      // Week 2: Mon Mar 9 – Mon Mar 16
      expect(result.buckets[1]?.start).toBe('2026-03-09T00:00:00.000Z');
      expect(result.buckets[1]?.end).toBe('2026-03-16T00:00:00.000Z');
      expect(result.buckets[1]?.totalVolume).toBe('50');
    });
  });

  describe('timestamp field selection', () => {
    it('buckets by updatedAt when specified', () => {
      const txns = [
        makeTx({
          createdAt: '2026-01-01T23:59:00.000Z',
          updatedAt: '2026-01-02T00:01:00.000Z',
        }),
        makeTx({
          id: 'tx-2',
          createdAt: '2026-01-01T23:59:30.000Z',
          updatedAt: '2026-01-02T00:02:00.000Z',
        }),
      ];

      const resultByCreated = aggregateTransactionMetrics(txns, { timestampField: 'createdAt' });
      const resultByUpdated = aggregateTransactionMetrics(txns, { timestampField: 'updatedAt' });

      // By createdAt: both in Jan 1 bucket
      expect(resultByCreated.buckets).toHaveLength(1);
      expect(resultByCreated.buckets[0]?.start).toBe('2026-01-01T00:00:00.000Z');

      // By updatedAt: both in Jan 2 bucket
      expect(resultByUpdated.buckets).toHaveLength(1);
      expect(resultByUpdated.buckets[0]?.start).toBe('2026-01-02T00:00:00.000Z');
    });
  });

  describe('invalid timestamps', () => {
    it('skips transactions with invalid createdAt dates', () => {
      const txns = [
        makeTx({ createdAt: 'not-a-date', amount: '100' }),
        makeTx({ createdAt: '2026-01-01T12:00:00.000Z', amount: '50', id: 'tx-2' }),
      ];

      const result = aggregateTransactionMetrics(txns);

      expect(result.totalCount).toBe(1);
      expect(result.totalVolume).toBe('50');
    });
  });

  describe('sorting', () => {
    it('returns buckets sorted chronologically regardless of input order', () => {
      const txns = [
        makeTx({ amount: '30', createdAt: '2026-07-15T00:00:00.000Z' }),
        makeTx({ amount: '10', createdAt: '2026-07-10T00:00:00.000Z', id: 'tx-2' }),
        makeTx({ amount: '20', createdAt: '2026-07-12T00:00:00.000Z', id: 'tx-3' }),
      ];

      const result = aggregateTransactionMetrics(txns);

      expect(result.buckets).toHaveLength(3);
      expect(result.buckets[0]?.start).toBe('2026-07-10T00:00:00.000Z');
      expect(result.buckets[1]?.start).toBe('2026-07-12T00:00:00.000Z');
      expect(result.buckets[2]?.start).toBe('2026-07-15T00:00:00.000Z');
    });
  });

  describe('large dataset performance', () => {
    it('processes 10 000 transactions without error', () => {
      const txns: Transaction[] = [];
      for (let i = 0; i < 10_000; i++) {
        const day = (i % 30) + 1;
        const hour = i % 24;
        const dateStr = `2026-04-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;
        txns.push(
          makeTx({
            id: `tx-${i}`,
            amount: String((i % 1000) + 1),
            status: i % 7 === 0 ? 'FAILED' : 'COMPLETED',
            createdAt: dateStr,
            updatedAt: dateStr,
            gasEstimate: String((i % 10) * 0.001),
          }),
        );
      }

      const result = aggregateTransactionMetrics(txns, { granularity: 'day' });

      expect(result.totalCount).toBe(10_000);
      expect(result.buckets.length).toBeGreaterThan(0);
      expect(result.totalVolume).not.toBe('0');
      expect(result.successRate).toBeGreaterThan(0);
      expect(result.successRate).toBeLessThanOrEqual(1);

      // Verify buckets are sorted
      for (let i = 1; i < result.buckets.length; i++) {
        expect(result.buckets[i]!.start >= result.buckets[i - 1]!.start).toBe(true);
      }
    });
  });

  describe('cross-midnight bucketing', () => {
    it('keeps a late-night and early-morning transaction in separate daily buckets', () => {
      const txns = [
        makeTx({ amount: '100', createdAt: '2026-08-15T23:30:00.000Z' }),
        makeTx({ amount: '200', createdAt: '2026-08-16T00:30:00.000Z', id: 'tx-2' }),
      ];

      const result = aggregateTransactionMetrics(txns, { granularity: 'day' });

      expect(result.buckets).toHaveLength(2);
      expect(result.buckets[0]?.totalVolume).toBe('100');
      expect(result.buckets[1]?.totalVolume).toBe('200');
    });
  });

  describe('fees aggregation', () => {
    it('sums fees with decimal precision across buckets', () => {
      const txns = [
        makeTx({ gasEstimate: '0.001', createdAt: '2026-09-01T00:00:00.000Z' }),
        makeTx({ gasEstimate: '0.0025', createdAt: '2026-09-01T12:00:00.000Z', id: 'tx-2' }),
        makeTx({ gasEstimate: '0.0005', createdAt: '2026-09-02T00:00:00.000Z', id: 'tx-3' }),
      ];

      const result = aggregateTransactionMetrics(txns);

      expect(result.totalFees).toBe('0.004');
      expect(result.buckets[0]?.totalFees).toBe('0.0035');
      expect(result.buckets[1]?.totalFees).toBe('0.0005');
    });
  });

  describe('cancelled and expired as failures', () => {
    it('treats CANCELLED and EXPIRED as failure statuses', () => {
      const txns = [
        makeTx({ status: 'CANCELLED' }),
        makeTx({ status: 'EXPIRED', id: 'tx-2' }),
        makeTx({ status: 'COMPLETED', id: 'tx-3' }),
      ];

      const result = aggregateTransactionMetrics(txns);

      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(2);
      expect(result.successRate).toBeCloseTo(1 / 3, 10);
    });
  });
});

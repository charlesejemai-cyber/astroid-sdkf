import { describe, expect, it } from 'vitest';

import {
  estimateFromNetworkFee,
  estimateLiveFee,
  queryFeeStats,
  queryFeeStatsSafe,
  type HorizonFeeBucket,
} from '../src/fee-estimation.js';

const FEE_STATS_URL = 'https://horizon.stellar.org/fee_stats';

/** Build a fake fetch returning a canned Horizon fee_stats body. */
function mockFetch(body: unknown, ok = true): typeof fetch {
  return (async () =>
    ({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    }) as unknown as Response) as typeof fetch;
}

describe('queryFeeStats', () => {
  it('parses Horizon fee_stats response into typed buckets and fees', async () => {
    const body = {
      last_ledger: '123',
      ledger_max_fee: 100,
      base_fee: 100,
      mode_fee: 100,
      p10: 100,
      fee_charged: [
        { seconds: 5, last_ledger: '122', last_ledger_base_fee: 100, ledger_max_fee: 100, p50: 100, p95: 100, p99: 100, fee_charged: 100, max_fee: 100, min_fee: 100, mode_fee: 100 },
        { seconds: 10, last_ledger: '123', last_ledger_base_fee: 100, ledger_max_fee: 100, p50: 100, p95: 100, p99: 100, fee_charged: 100, max_fee: 100, min_fee: 100, mode_fee: 100 },
      ],
    };
    const stats = await queryFeeStats({
      horizonUrl: FEE_STATS_URL,
      fetch: mockFetch(body),
    });

    expect(stats.ledgerBaseFee).toBe(100);
    expect(stats.modeFee).toBe(100);
    expect(stats.feeCharged).toHaveLength(2);
    expect(stats.feeCharged[0].seconds).toBeLessThan(stats.feeCharged[1].seconds);
    expect(stats.feeCharged.every((b: HorizonFeeBucket) => b.p50 === 100)).toBe(true);
    expect(stats.maxFee).toBe(100);
  });

  it('throws on a non-OK horizon response', async () => {
    await expect(
      queryFeeStats({ horizonUrl: FEE_STATS_URL, fetch: mockFetch({}, false) }),
    ).rejects.toThrow();
  });
});

describe('queryFeeStatsSafe', () => {
  it('returns null instead of throwing on network failure', async () => {
    const stats = await queryFeeStatsSafe({
      horizonUrl: FEE_STATS_URL,
      fetch: mockFetch({}, false),
    });
    expect(stats).toBeNull();
  });
});

describe('estimateFromNetworkFee', () => {
  it('adds a default 30% buffer to the live fee when it exceeds the base fee', () => {
    const r = estimateFromNetworkFee(100, 100);
    expect(r.live).toBe(true);
    expect(r.recommendedFee).toBe(130);
    expect(r.bufferPercentage).toBe(30);
    expect(r.networkState).toBe('normal');
  });

  it('keeps the base fee if it already exceeds the buffered live fee', () => {
    const r = estimateFromNetworkFee(100, 1000);
    expect(r.recommendedFee).toBe(1000);
  });

  it('honours a custom buffer percentage', () => {
    const r = estimateFromNetworkFee(200, 100, { bufferPercentage: 10 });
    expect(r.recommendedFee).toBe(220);
  });

  it('returns a non-live fallback when the live fee is invalid', () => {
    const r = estimateFromNetworkFee(NaN, 100);
    expect(r.live).toBe(false);
    expect(r.recommendedFee).toBe(100);
    expect(r.networkState).toBe('unknown');
  });

  it('classifies a congested network when the live fee is very high', () => {
    const r = estimateFromNetworkFee(8000, 100);
    expect(r.networkState).toBe('congested');
  });

  it('classifies a busy network when the live fee is moderately high', () => {
    const r = estimateFromNetworkFee(1000, 100);
    expect(r.networkState).toBe('busy');
  });
});

describe('estimateLiveFee', () => {
  it('uses the freshest bucket p50 with the network url', async () => {
    const body = {
      fee_charged: [
        { seconds: 1, p50: 200 },
        { seconds: 2, p50: 400 },
      ],
    };
    const r = await estimateLiveFee(FEE_STATS_URL, 100, {
      fetch: mockFetch(body),
    });
    expect(r.live).toBe(true);
    expect(r.liveFee).toBe(400);
    expect(r.recommendedFee).toBe(520); // 400 + 30%
  });

  it('falls back to modeFee when p50 is missing', async () => {
    const body = { mode_fee: 300, fee_charged: [{ seconds: 1, p50: null }] };
    const r = await estimateLiveFee(FEE_STATS_URL, 100, {
      fetch: mockFetch(body),
    });
    expect(r.liveFee).toBe(300);
  });

  it('falls back non-live when the network query fails', async () => {
    const r = await estimateLiveFee(FEE_STATS_URL, 100, {
      fetch: mockFetch({}, false),
    });
    expect(r.live).toBe(false);
    expect(r.recommendedFee).toBe(100);
  });
});
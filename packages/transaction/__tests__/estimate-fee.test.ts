import { describe, expect, it } from 'vitest';

import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

import { estimateFee } from '../src/fee-estimation.js';

const TESTNET = Networks.TESTNET;
const FEE_STATS_URL = 'https://horizon-testnet.stellar.org/fee_stats';

/** Build a payment transaction XDR with the given fee (stroops). */
function buildPaymentXdr(fee: number, operations = 1): string {
  const keypair = Keypair.random();
  const account = new Account(keypair.publicKey(), '1');
  let builder = new TransactionBuilder(account, {
    fee: String(fee),
    networkPassphrase: TESTNET,
  });
  for (let i = 0; i < operations; i += 1) {
    builder = builder.addOperation(
      Operation.payment({
        destination: keypair.publicKey(),
        asset: Asset.native(),
        amount: '1',
      }),
    );
  }
  return builder.setTimeout(30).build().toXDR();
}

/** A fake fetch returning a canned Horizon fee_stats body. */
function mockFetch(body: unknown, ok = true): typeof fetch {
  return (async () =>
    ({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    }) as unknown as Response) as typeof fetch;
}

describe('estimateFee', () => {
  it('derives the operation count and base fee from an XDR envelope', async () => {
    const xdr = buildPaymentXdr(100);

    const estimate = await estimateFee({
      transaction: xdr,
      networkPassphrase: TESTNET,
    });

    expect(estimate.operationCount).toBe(1);
    expect(estimate.baseFee).toBe(100);
    expect(estimate.minFee).toBe(100);
    expect(estimate.recommendedBaseFee).toBe(100);
    expect(estimate.recommendedFee).toBe(100);
    expect(estimate.live).toBe(false);
    expect(estimate.networkState).toBe('unknown');
    expect(estimate.transactionXdr).toBe(xdr);
  });

  it('derives the per-operation base fee across a multi-operation envelope', async () => {
    // `fee: '300'` is the per-operation bid, so the envelope total is 600.
    const xdr = buildPaymentXdr(300, 2);

    const estimate = await estimateFee({
      transaction: xdr,
      networkPassphrase: TESTNET,
    });

    expect(estimate.operationCount).toBe(2);
    expect(estimate.baseFee).toBe(300);
    expect(estimate.minFee).toBe(600);
    expect(estimate.recommendedFee).toBe(600);
  });

  it('accepts a built Transaction instance', async () => {
    const keypair = Keypair.random();
    const tx = new TransactionBuilder(new Account(keypair.publicKey(), '1'), {
      fee: '100',
      networkPassphrase: TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: keypair.publicKey(),
          asset: Asset.native(),
          amount: '1',
        }),
      )
      .setTimeout(30)
      .build();

    const estimate = await estimateFee({ transaction: tx, networkPassphrase: TESTNET });

    expect(estimate.operationCount).toBe(1);
    expect(estimate.transactionXdr).toBe(tx.toXDR());
  });

  it('estimates from an explicit operation count when no envelope is supplied', async () => {
    const estimate = await estimateFee({ operationCount: 3 });

    expect(estimate.operationCount).toBe(3);
    expect(estimate.baseFee).toBe(100);
    expect(estimate.minFee).toBe(300);
    expect(estimate.recommendedFee).toBe(300);
    expect(estimate.live).toBe(false);
  });

  it('honours an explicit base fee', async () => {
    const estimate = await estimateFee({ operationCount: 2, baseFee: 250 });

    expect(estimate.baseFee).toBe(250);
    expect(estimate.minFee).toBe(500);
    expect(estimate.recommendedFee).toBe(500);
  });

  it('samples live Horizon stats and applies the default 30% buffer', async () => {
    const body = { mode_fee: 100, fee_charged: [{ seconds: 1, p50: 400 }] };

    const estimate = await estimateFee({
      transaction: buildPaymentXdr(100),
      networkPassphrase: TESTNET,
      horizonUrl: FEE_STATS_URL,
      fetch: mockFetch(body),
    });

    expect(estimate.live).toBe(true);
    expect(estimate.networkState).toBe('busy');
    expect(estimate.recommendedBaseFee).toBe(520); // 400 + 30%
    expect(estimate.recommendedFee).toBe(520);
  });

  it('multiplies the buffered live fee across every operation', async () => {
    const body = { mode_fee: 100, fee_charged: [{ seconds: 1, p50: 400 }] };

    const estimate = await estimateFee({
      operationCount: 2,
      horizonUrl: FEE_STATS_URL,
      fetch: mockFetch(body),
    });

    expect(estimate.recommendedBaseFee).toBe(520);
    expect(estimate.recommendedFee).toBe(1040);
  });

  it('honours a custom buffer percentage', async () => {
    const body = { mode_fee: 100, fee_charged: [{ seconds: 1, p50: 400 }] };

    const estimate = await estimateFee({
      horizonUrl: FEE_STATS_URL,
      fetch: mockFetch(body),
      bufferPercentage: 10,
    });

    expect(estimate.recommendedBaseFee).toBe(440); // 400 + 10%
    expect(estimate.bufferPercentage).toBe(10);
  });

  it('degrades gracefully to the base fee when the network query fails', async () => {
    const estimate = await estimateFee({
      transaction: buildPaymentXdr(100),
      networkPassphrase: TESTNET,
      horizonUrl: FEE_STATS_URL,
      fetch: mockFetch({}, false),
    });

    expect(estimate.live).toBe(false);
    expect(estimate.networkState).toBe('unknown');
    expect(estimate.recommendedFee).toBe(100);
  });

  it('throws a structured ValidationError for a malformed envelope', async () => {
    await expect(
      estimateFee({ transaction: 'not-a-valid-xdr', networkPassphrase: TESTNET }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      estimateFee({ transaction: '', networkPassphrase: TESTNET }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSACTION_ENVELOPE' });
  });

  it('clamps a non-positive operation count to a single operation', async () => {
    const estimate = await estimateFee({ operationCount: 0 });
    expect(estimate.operationCount).toBe(1);
    expect(estimate.recommendedFee).toBe(100);
  });
});

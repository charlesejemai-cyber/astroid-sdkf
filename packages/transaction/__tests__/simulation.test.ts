import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-base';

import { describe, expect, it } from 'vitest';

import type { SimulateTransactionClient } from '@astroid/types';

import { simulateTransaction, simulateTransactionFee } from '../src/simulation.js';
import { TransactionSimulationError } from '../src/errors.js';

const TESTNET = Networks.TESTNET;

/** Build a payment transaction XDR with the given fee (stroops). */
function buildPaymentXdr(fee: number, networkPassphrase = TESTNET): string {
  const keypair = Keypair.random();
  const account = new Account(keypair.publicKey(), '1');
  const tx = new TransactionBuilder(account, {
    fee: String(fee),
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: keypair.publicKey(),
        asset: Asset.native(),
        amount: '10',
      }),
    )
    .setTimeout(30)
    .build();
  return tx.toXDR();
}

/** Build a Transaction instance with the given fee (stroops). */
function buildPaymentTransaction(fee: number, networkPassphrase = TESTNET) {
  const keypair = Keypair.random();
  const account = new Account(keypair.publicKey(), '1');
  return new TransactionBuilder(account, {
    fee: String(fee),
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: keypair.publicKey(),
        asset: Asset.native(),
        amount: '5',
      }),
    )
    .setTimeout(30)
    .build();
}

describe('simulateTransactionFee', () => {
  it('returns baseFee, estimatedFee (default 15% buffer) and viability for a valid XDR', () => {
    const xdr = buildPaymentXdr(100);
    const result = simulateTransactionFee(xdr, { networkPassphrase: TESTNET });

    expect(result.baseFee).toBe(100);
    expect(result.estimatedFee).toBe(115); // 100 * 1.15
    expect(result.feeBufferPercentage).toBe(15);
    expect(result.isViable).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('applies a custom buffer percentage to the estimated fee', () => {
    const xdr = buildPaymentXdr(200);
    const result = simulateTransactionFee(xdr, {
      networkPassphrase: TESTNET,
      feeBufferPercentage: 50,
    });

    expect(result.baseFee).toBe(200);
    expect(result.estimatedFee).toBe(300); // 200 * 1.5
    expect(result.feeBufferPercentage).toBe(50);
  });

  it('accepts a Transaction instance instead of an XDR string', () => {
    const tx = buildPaymentTransaction(250);

    const result = simulateTransactionFee(tx);

    expect(result.baseFee).toBe(250);
    expect(result.estimatedFee).toBe(288); // 250 * 1.15 = 287.5 -> 288
    expect(result.isViable).toBe(true);
  });

  it('rounds fractional estimated fees', () => {
    const xdr = buildPaymentXdr(1);
    const result = simulateTransactionFee(xdr, { networkPassphrase: TESTNET });

    expect(result.estimatedFee).toBe(1); // 1 * 1.15 = 1.15 -> 1
  });

  it('returns a structured TransactionSimulationError container for malformed XDR instead of throwing', () => {
    const result = simulateTransactionFee('not-a-valid-xdr', { networkPassphrase: TESTNET });

    expect(result.isViable).toBe(false);
    expect(result.error).toBeInstanceOf(TransactionSimulationError);
    expect(result.error?.code).toBeDefined();
    expect(result.error?.message).toMatch(/parse|xdr|base64/i);
  });

  it('flags a zero-fee transaction as non-viable with TransactionSimulationError', () => {
    const xdr = buildPaymentXdr(0);
    const result = simulateTransactionFee(xdr, { networkPassphrase: TESTNET });

    expect(result.isViable).toBe(false);
    expect(result.error).toBeInstanceOf(TransactionSimulationError);
    expect(result.error?.code).toBe('ZERO_OR_NEGATIVE_FEE');
  });

  it('defaults to the public network passphrase', () => {
    const xdr = buildPaymentXdr(100, Networks.PUBLIC);
    const result = simulateTransactionFee(xdr);

    expect(result.baseFee).toBe(100);
    expect(result.isViable).toBe(true);
  });
});

/** A fake Horizon fetch returning a canned fee_stats body. */
function mockFetch(body: unknown, ok = true): typeof fetch {
  return (async () =>
    ({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    }) as unknown as Response) as typeof fetch;
}

/** A mock Astroid HTTP client that records `/transactions/simulate` calls. */
function mockSimulateClient(payload: Record<string, unknown>): {
  client: SimulateTransactionClient;
  calls: Array<{ path: string; body?: unknown }>;
} {
  const calls: Array<{ path: string; body?: unknown }> = [];
  const client: SimulateTransactionClient = {
    async post<T>(path: string, body?: unknown): Promise<{ data: T }> {
      calls.push({ path, body });
      return { data: payload as T };
    },
  };
  return { client, calls };
}

describe('simulateTransaction', () => {
  it('returns a viable outcome with fee data for a valid envelope', async () => {
    const xdr = buildPaymentXdr(100);

    const result = await simulateTransaction(xdr, { networkPassphrase: TESTNET });

    expect(result.viable).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.operationCount).toBe(1);
    expect(result.baseFee).toBe(100);
    expect(result.estimatedFee).toBeGreaterThanOrEqual(100);
    expect(result.transactionXdr).toBe(xdr);
    expect(result.sourceAccount).toMatch(/^G/);
    expect(result.error).toBeUndefined();
  });

  it('never throws for a malformed envelope, returning INVALID_ENVELOPE', async () => {
    const result = await simulateTransaction('not-a-valid-xdr', {
      networkPassphrase: TESTNET,
    });

    expect(result.viable).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('INVALID_ENVELOPE');
    expect(result.error).toBeInstanceOf(TransactionSimulationError);
  });

  it('flags a below-minimum fee envelope as FEE_BELOW_MINIMUM', async () => {
    const result = await simulateTransaction(buildPaymentXdr(0), {
      networkPassphrase: TESTNET,
    });

    expect(result.viable).toBe(false);
    expect(result.errorCode).toBe('FEE_BELOW_MINIMUM');
  });

  it('flags an accidental over-bid as FEE_TOO_HIGH', async () => {
    const result = await simulateTransaction(buildPaymentXdr(20_000_000), {
      networkPassphrase: TESTNET,
    });

    expect(result.viable).toBe(false);
    expect(result.errorCode).toBe('FEE_TOO_HIGH');
  });

  it('performs a remote dry-run through the Astroid API when a client is supplied', async () => {
    const xdr = buildPaymentXdr(100);
    const { client, calls } = mockSimulateClient({ ok: true });

    const result = await simulateTransaction(xdr, {
      networkPassphrase: TESTNET,
      client,
    });

    expect(result.viable).toBe(true);
    expect(result.remote).toEqual({ performed: true, success: true, data: { ok: true } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/transactions/simulate');
    expect(calls[0]?.body).toEqual({ transactionXdr: xdr });
  });

  it('reports a remote rejection as non-viable SIMULATION_FAILED', async () => {
    const failingClient: SimulateTransactionClient = {
      async post<T>(): Promise<{ data: T }> {
        throw new Error('backend rejected simulation');
      },
    };

    const result = await simulateTransaction(buildPaymentXdr(100), {
      networkPassphrase: TESTNET,
      client: failingClient,
    });

    expect(result.viable).toBe(false);
    expect(result.errorCode).toBe('SIMULATION_FAILED');
    expect(result.remote?.success).toBe(false);
    expect(result.remote?.errorMessage).toContain('backend rejected simulation');
  });

  it('skips the remote call when skipRemote is set', async () => {
    const { client, calls } = mockSimulateClient({ ok: true });

    const result = await simulateTransaction(buildPaymentXdr(100), {
      networkPassphrase: TESTNET,
      client,
      skipRemote: true,
    });

    expect(result.remote).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('incorporates live Horizon fee stats into the estimated fee', async () => {
    const body = { mode_fee: 100, fee_charged: [{ seconds: 1, p50: 400 }] };

    const result = await simulateTransaction(buildPaymentXdr(100), {
      networkPassphrase: TESTNET,
      horizonUrl: 'https://horizon-testnet.stellar.org/fee_stats',
      fetch: mockFetch(body),
    });

    expect(result.viable).toBe(true);
    expect(result.feeEstimate?.live).toBe(true);
    expect(result.estimatedFee).toBe(460); // 400 + 15% buffer
  });

  it('falls back to the envelope fee when the Horizon query fails', async () => {
    const result = await simulateTransaction(buildPaymentXdr(100), {
      networkPassphrase: TESTNET,
      horizonUrl: 'https://horizon-testnet.stellar.org/fee_stats',
      fetch: mockFetch({}, false),
    });

    expect(result.viable).toBe(true);
    expect(result.estimatedFee).toBe(100);
  });
});

/**
 * Unit tests for the transaction payload formatting helpers in `format.ts`:
 * formatTransactionPayload and buildPaymentPayload.
 */

import { describe, expect, it } from 'vitest';

import { Account, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

import { buildPaymentTransaction, encodeTransaction } from '../src/builder.js';
import { buildPaymentPayload, formatTransactionPayload } from '../src/format.js';
import { decodeTransactionXDR } from '../src/decoder.js';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function buildTestTransaction() {
  const sourceKey = Keypair.random();
  const destination = Keypair.random().publicKey();
  const account = new Account(sourceKey.publicKey(), '7');
  const tx = buildPaymentTransaction({
    source: account,
    networkPassphrase: Networks.TESTNET,
    destination,
    asset: 'XLM',
    amount: '10.5',
    memoText: 'invoice-42',
  });
  return { tx, destination, sourceKey };
}

/* -------------------------------------------------------------------------- */
/* formatTransactionPayload                                                    */
/* -------------------------------------------------------------------------- */

describe('formatTransactionPayload', () => {
  it('formats a built transaction into a structured payload', () => {
    const { tx, destination, sourceKey } = buildTestTransaction();

    const payload = formatTransactionPayload(tx, { networkPassphrase: Networks.TESTNET });

    expect(payload.transactionXdr).toBe(tx.toXDR());
    expect(payload.sourceAccount).toBe(sourceKey.publicKey());
    expect(payload.sequence).toMatch(/^\d+$/);
    expect(payload.fee).toBe('100');
    expect(payload.memo).toEqual({ type: 'text', value: 'invoice-42' });
    expect(payload.operationCount).toBe(1);
    expect(payload.operations[0]).toMatchObject({
      type: 'payment',
      destination,
      asset: 'XLM',
      amount: '10.5000000',
    });
  });

  it('formats a base64 XDR string identically', () => {
    const { tx } = buildTestTransaction();
    const fromXdr = formatTransactionPayload(tx.toXDR(), { networkPassphrase: Networks.TESTNET });
    const fromTx = formatTransactionPayload(tx, { networkPassphrase: Networks.TESTNET });

    expect(fromXdr).toEqual(fromTx);
  });

  it('round-trips: the formatted payload decodes to the same operations', () => {
    const { tx } = buildTestTransaction();
    const payload = formatTransactionPayload(tx, { networkPassphrase: Networks.TESTNET });

    const decoded = decodeTransactionXDR(payload.transactionXdr, Networks.TESTNET);
    expect(decoded.operations).toEqual(payload.operations);
    expect(decoded.sourceAccount).toBe(payload.sourceAccount);
  });

  it('throws a structured ValidationError for invalid XDR', () => {
    expect(() => formatTransactionPayload('not-an-envelope')).toThrowError(ValidationError);
  });

  it('throws a structured ValidationError for an empty string', () => {
    expect(() => formatTransactionPayload('')).toThrowError(ValidationError);
  });
});

/* -------------------------------------------------------------------------- */
/* buildPaymentPayload                                                         */
/* -------------------------------------------------------------------------- */

describe('buildPaymentPayload', () => {
  it('builds and formats a payment payload ready for the API', () => {
    const sourceKey = Keypair.random();
    const destination = Keypair.random().publicKey();
    const issuer = Keypair.random().publicKey();
    const payload = buildPaymentPayload({
      walletId: 'wal_abc123',
      source: new Account(sourceKey.publicKey(), '1'),
      networkPassphrase: Networks.TESTNET,
      destination,
      asset: `USDC:${issuer}`,
      amount: '25',
      memoText: 'reimburse',
    });

    expect(payload.walletId).toBe('wal_abc123');
    expect(payload.asset).toBe(`USDC:${issuer}`);
    expect(payload.amount).toBe('25');
    expect(payload.recipientAddress).toBe(destination);
    expect(payload.memo).toBe('reimburse');

    // The envelope is a valid, decodable payment transaction.
    const decoded = TransactionBuilder.fromXDR(payload.transactionXdr, Networks.TESTNET);
    const op = decoded.operations[0]!;
    if (op.type !== 'payment') throw new Error('expected a payment operation');
    expect(op.destination).toBe(destination);
    expect(op.asset.code).toBe('USDC');
    expect(op.amount).toBe('25.0000000');
  });

  it('omits the memo field when no memo is supplied', () => {
    const payload = buildPaymentPayload({
      walletId: 'wal_abc123',
      source: new Account(Keypair.random().publicKey(), '1'),
      networkPassphrase: Networks.TESTNET,
      destination: Keypair.random().publicKey(),
      asset: 'XLM',
      amount: '1',
    });

    expect(payload).not.toHaveProperty('memo');
  });

  it('throws a structured ValidationError for a missing wallet id', () => {
    expect(() =>
      buildPaymentPayload({
        walletId: '  ',
        source: new Account(Keypair.random().publicKey(), '1'),
        networkPassphrase: Networks.TESTNET,
        destination: Keypair.random().publicKey(),
        asset: 'XLM',
        amount: '1',
      }),
    ).toThrowError(ValidationError);
  });

  it('throws a structured ValidationError for an invalid destination', () => {
    expect(() =>
      buildPaymentPayload({
        walletId: 'wal_abc123',
        source: new Account(Keypair.random().publicKey(), '1'),
        networkPassphrase: Networks.TESTNET,
        destination: 'not-an-address',
        asset: 'XLM',
        amount: '1',
      }),
    ).toThrowError(ValidationError);
  });

  it('throws a structured ValidationError for a non-positive amount', () => {
    expect(() =>
      buildPaymentPayload({
        walletId: 'wal_abc123',
        source: new Account(Keypair.random().publicKey(), '1'),
        networkPassphrase: Networks.TESTNET,
        destination: Keypair.random().publicKey(),
        asset: 'XLM',
        amount: '0',
      }),
    ).toThrowError(ValidationError);
  });
});

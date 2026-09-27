/**
 * Unit tests for the Stellar payment transaction builder.
 *
 * Covers payload generation for native (`XLM`) and issued assets, plus the
 * input validation the helper performs before constructing an unsigned
 * transaction. No network calls are made.
 */

import { describe, expect, it } from 'vitest';

import { Account, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-base';
import type { Transaction } from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

import { buildPaymentTransaction } from '../builder.js';
import type { PaymentTransactionOptions } from '../builder.js';

/** A fresh source account with sequence number `100`. */
function account(): Account {
  return new Account(Keypair.random().publicKey(), '100');
}

/** Decode the single payment operation from a built transaction. */
function paymentOp(options: PaymentTransactionOptions) {
  const tx = buildPaymentTransaction(options);
  // `TransactionBuilder.fromXDR` is typed as `Transaction | FeeBumpTransaction`;
  // a payment transaction is always the former, so narrow it here.
  const decoded = TransactionBuilder.fromXDR(
    tx.toXDR(),
    options.networkPassphrase,
  ) as Transaction;
  const op = decoded.operations[0];
  if (!op || op.type !== 'payment') throw new Error('expected a single payment operation');
  return { tx, decoded, op };
}

describe('buildPaymentTransaction — payload generation', () => {
  it('builds a native XLM payment with the destination, amount and memo', () => {
    const source = Keypair.random();
    const destination = Keypair.random().publicKey();

    const { tx, decoded, op } = paymentOp({
      source: new Account(source.publicKey(), '100'),
      networkPassphrase: Networks.TESTNET,
      destination,
      asset: 'XLM',
      amount: '10.5',
      memoText: 'invoice-42',
    });

    expect(decoded.source).toBe(source.publicKey());
    expect(op.destination).toBe(destination);
    expect(op.asset.isNative()).toBe(true);
    expect(op.amount).toBe('10.5000000');
    expect(String(decoded.memo.value)).toBe('invoice-42');
    // The builder never signs — the caller (or the backend) owns the keys.
    expect(tx.signatures).toHaveLength(0);
  });

  it('builds an issued-asset payment for CODE:ISSUER', () => {
    const destination = Keypair.random().publicKey();
    const issuer = Keypair.random().publicKey();

    const { op } = paymentOp({
      source: account(),
      networkPassphrase: Networks.TESTNET,
      destination,
      asset: `USDC:${issuer}`,
      amount: 25,
    });

    expect(op.asset.isNative()).toBe(false);
    expect(op.asset.code).toBe('USDC');
    expect(op.asset.issuer).toBe(issuer);
    expect(op.amount).toBe('25.0000000');
  });

  it('preserves the recipient address exactly as provided', () => {
    const destination = Keypair.random().publicKey();
    const { op } = paymentOp({
      source: account(),
      networkPassphrase: Networks.TESTNET,
      destination,
      asset: 'XLM',
      amount: '1',
    });

    expect(op.destination).toBe(destination);
  });
});

describe('buildPaymentTransaction — input validation', () => {
  const valid = (): PaymentTransactionOptions => ({
    source: account(),
    networkPassphrase: Networks.TESTNET,
    destination: Keypair.random().publicKey(),
    asset: 'XLM',
    amount: '1',
  });

  it('throws for an invalid destination address', () => {
    expect(() =>
      buildPaymentTransaction({ ...valid(), destination: 'not-a-stellar-address' }),
    ).toThrowError(ValidationError);
  });

  it('throws an INVALID_ADDRESS error for a missing destination', () => {
    const options = { ...valid(), destination: undefined } as unknown as PaymentTransactionOptions;
    try {
      buildPaymentTransaction(options);
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('INVALID_ADDRESS');
    }
  });

  it('throws for a zero or negative amount', () => {
    expect(() => buildPaymentTransaction({ ...valid(), amount: '0' })).toThrowError(
      ValidationError,
    );
    expect(() => buildPaymentTransaction({ ...valid(), amount: -5 })).toThrowError(
      ValidationError,
    );
  });

  it('throws for a non-native asset without an issuer', () => {
    expect(() => buildPaymentTransaction({ ...valid(), asset: 'USDC' })).toThrowError(
      ValidationError,
    );
  });

  it('throws for an unknown network passphrase', () => {
    expect(() =>
      buildPaymentTransaction({ ...valid(), networkPassphrase: 'Not A Real Network' }),
    ).toThrowError(ValidationError);
  });
});

import { describe, expect, it } from 'vitest';

import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

import {
  buildPaymentTransaction,
  buildTransaction,
  encodeTransaction,
  parseAsset,
} from '../src/builder.js';

describe('buildPaymentTransaction', () => {
  it('builds an unsigned payment transaction on the given network', () => {
    const sourceKey = Keypair.random();
    const destination = Keypair.random().publicKey();
    const account = new Account(sourceKey.publicKey(), '100');

    const tx = buildPaymentTransaction({
      source: account,
      networkPassphrase: Networks.TESTNET,
      destination,
      asset: 'XLM',
      amount: '10.5',
      memoText: 'refund',
    });

    const decoded = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET);
    expect(decoded.source).toBe(sourceKey.publicKey());
    expect(decoded.operations).toHaveLength(1);
    const op = decoded.operations[0]!;
    if (op.type !== 'payment') throw new Error('expected a payment operation');
    expect(op.destination).toBe(destination);
    expect(op.amount).toBe('10.5000000');
    expect(op.asset.isNative()).toBe(true);
    expect(String(decoded.memo.value)).toBe('refund');
    expect(decoded.signatures).toHaveLength(0);
  });

  it('supports non-native issued assets and returns encoded XDR', () => {
    const account = new Account(Keypair.random().publicKey(), '1');
    const destination = Keypair.random().publicKey();
    const issuer = Keypair.random().publicKey();

    const tx = buildPaymentTransaction({
      source: account,
      networkPassphrase: Networks.TESTNET,
      destination,
      asset: `USDC:${issuer}`,
      amount: '25',
    });

    const xdr = encodeTransaction(tx);
    const decoded = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
    const op = decoded.operations[0]!;
    if (op.type !== 'payment') throw new Error('expected a payment operation');
    expect(op.asset.code).toBe('USDC');
    expect(op.asset.issuer).toBe(issuer);
  });

  it('builds a transaction from an explicit list of operations', () => {
    const account = new Account(Keypair.random().publicKey(), '2');
    const destination = Keypair.random().publicKey();

    const tx = buildTransaction(
      { source: account, networkPassphrase: Networks.TESTNET },
      [
        Operation.createAccount({
          destination,
          startingBalance: '2',
        }),
      ],
    );

    const decoded = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET);
    expect(decoded.operations[0]!.type).toBe('createAccount');
  });

  it('throws a structured ValidationError for an invalid destination', () => {
    const account = new Account(Keypair.random().publicKey(), '1');
    expect(() =>
      buildPaymentTransaction({
        source: account,
        networkPassphrase: Networks.TESTNET,
        destination: 'not-an-address',
        asset: 'XLM',
        amount: '1',
      }),
    ).toThrowError(ValidationError);
  });

  it('throws a structured ValidationError for a non-positive amount', () => {
    const account = new Account(Keypair.random().publicKey(), '1');
    expect(() =>
      buildPaymentTransaction({
        source: account,
        networkPassphrase: Networks.TESTNET,
        destination: Keypair.random().publicKey(),
        asset: 'XLM',
        amount: '0',
      }),
    ).toThrowError(ValidationError);
  });

  it('throws a structured ValidationError for an unknown passphrase', () => {
    const account = new Account(Keypair.random().publicKey(), '1');
    try {
      buildPaymentTransaction({
        source: account,
        networkPassphrase: 'Not A Real Network',
        destination: Keypair.random().publicKey(),
        asset: 'XLM',
        amount: '1',
      });
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('INVALID_NETWORK_PASSPHRASE');
    }
  });
});

describe('buildPaymentTransaction — memo types', () => {
  const HEX_32 = 'ab'.repeat(32);

  function buildWithMemo(memo: Record<string, unknown>) {
    const account = new Account(Keypair.random().publicKey(), '1');
    return buildPaymentTransaction({
      source: account,
      networkPassphrase: Networks.TESTNET,
      destination: Keypair.random().publicKey(),
      asset: 'XLM',
      amount: '1',
      ...memo,
    });
  }

  it('attaches a hash memo', () => {
    const tx = buildWithMemo({ memoHash: HEX_32 });
    const decoded = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET);
    expect(decoded.memo.type).toBe('hash');
    expect(Buffer.from(decoded.memo.value as Buffer).toString('hex')).toBe(HEX_32);
  });

  it('attaches a return memo', () => {
    const tx = buildWithMemo({ memoReturn: HEX_32 });
    const decoded = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET);
    expect(decoded.memo.type).toBe('return');
  });

  it('attaches an id memo', () => {
    const tx = buildWithMemo({ memoId: 42 });
    const decoded = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET);
    expect(decoded.memo.type).toBe('id');
    expect(String(decoded.memo.value)).toBe('42');
  });

  it('rejects a malformed hash memo', () => {
    expect(() => buildWithMemo({ memoHash: 'not-hex' })).toThrowError(ValidationError);
  });

  it('rejects more than one memo option', () => {
    expect(() => buildWithMemo({ memoText: 'hi', memoHash: HEX_32 })).toThrowError(
      ValidationError,
    );
  });
});

describe('parseAsset', () => {
  it('returns native for XLM', () => {
    expect(parseAsset('XLM').isNative()).toBe(true);
  });

  it('rejects a non-native code without an issuer', () => {
    expect(() => parseAsset('USDC')).toThrowError(ValidationError);
  });

  it('parses CODE:ISSUER', () => {
    const issuer = Keypair.random().publicKey();
    const asset = parseAsset(`USDC:${issuer}`);
    expect(asset.code).toBe('USDC');
    expect(asset.issuer).toBe(issuer);
  });
});
import { describe, expect, it } from 'vitest';

import {
  Account,
  Asset,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

import {
  FeeBumpValidationError,
  assertValidFeeBumpParams,
  bumpFee,
  validateFeeBumpParams,
  type FeeBumpOptions,
} from '../src/feeBump.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Build an unsigned base transaction with a controllable fee and op count. */
function makeInner(
  options: { fee?: string; operations?: number; sign?: boolean } = {},
): Transaction {
  const source = Keypair.random();
  const account = new Account(source.publicKey(), '1');
  const builder = new TransactionBuilder(account, {
    fee: options.fee ?? '100',
    networkPassphrase: Networks.TESTNET,
  }).setTimeout(300);

  for (let i = 0; i < (options.operations ?? 1); i += 1) {
    builder.addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: '1',
      }),
    );
  }

  const tx = builder.build();
  if (options.sign) tx.sign(source);
  return tx;
}

/** A fully valid baseline request, so each test only overrides what it targets. */
function validOptions(overrides: Partial<FeeBumpOptions> = {}): FeeBumpOptions {
  const sponsor = Keypair.random();
  return {
    transaction: makeInner({ sign: true }),
    feeSource: { publicKey: sponsor.publicKey(), secretKey: sponsor.secret() },
    networkPassphrase: Networks.TESTNET,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Valid construction                                                          */
/* -------------------------------------------------------------------------- */

describe('bumpFee — valid construction', () => {
  it('wraps a signed base transaction and signs the fee-bump envelope', () => {
    const sponsor = Keypair.random();
    const inner = makeInner({ sign: true });

    const result = bumpFee({
      transaction: inner,
      feeSource: { publicKey: sponsor.publicKey(), secretKey: sponsor.secret() },
      networkPassphrase: Networks.TESTNET,
    });

    expect(result.signed).toBe(true);
    expect(result.feeSource).toBe(sponsor.publicKey());
    expect(result.networkPassphrase).toBe(Networks.TESTNET);
    expect(result.innerXdr).toBe(inner.toXDR());
    expect(result.operationCount).toBe(1);

    const decoded = TransactionBuilder.fromXDR(result.xdr, Networks.TESTNET);
    expect(decoded).toBeInstanceOf(FeeBumpTransaction);
    const feeBump = decoded as FeeBumpTransaction;
    expect(feeBump.feeSource).toBe(sponsor.publicKey());
    expect(feeBump.innerTransaction.source).toBe(inner.source);
    expect(feeBump.innerTransaction.operations).toHaveLength(1);
    expect(feeBump.signatures).toHaveLength(1);
    expect(result.transaction.toXDR()).toBe(result.xdr);
  });

  it('returns an unsigned envelope when only the public key is supplied', () => {
    const sponsor = Keypair.random();

    const result = bumpFee({
      transaction: makeInner(),
      feeSource: { publicKey: sponsor.publicKey() },
      networkPassphrase: Networks.TESTNET,
    });

    expect(result.signed).toBe(false);
    expect(result.feeSource).toBe(sponsor.publicKey());

    const decoded = TransactionBuilder.fromXDR(result.xdr, Networks.TESTNET) as FeeBumpTransaction;
    expect(decoded.signatures).toHaveLength(0);
  });

  it('accepts a base transaction XDR string and a Keypair fee source', () => {
    const sponsor = Keypair.random();
    const inner = makeInner({ sign: true });

    const result = bumpFee({
      transaction: inner.toXDR(),
      feeSource: sponsor,
      networkPassphrase: Networks.TESTNET,
    });

    expect(result.signed).toBe(true);
    expect(result.innerXdr).toBe(inner.toXDR());
    expect(result.feeSource).toBe(sponsor.publicKey());
  });

  it('accepts a fee-bump transaction built from a different network passphrase', () => {
    const sponsor = Keypair.random();
    const inner = makeInner({ sign: true });

    const result = bumpFee({
      transaction: inner,
      feeSource: { publicKey: sponsor.publicKey(), secretKey: sponsor.secret() },
      networkPassphrase: Networks.PUBLIC,
    });

    expect(result.networkPassphrase).toBe(Networks.PUBLIC);
    expect(() => TransactionBuilder.fromXDR(result.xdr, Networks.PUBLIC)).not.toThrow();
  });

  it('defaults the base fee to the inner rate and reports the total bid', () => {
    const result = bumpFee(validOptions({ transaction: makeInner({ fee: '1000', sign: true }) }));

    expect(result.baseFee).toBe('1000');
    expect(result.innerFee).toBe('1000');
    // buildFeeBumpTransaction bids baseFee × (operations + 1).
    expect(result.fee).toBe('2000');
  });

  it('applies a fee buffer on top of the inner rate when no base fee is given', () => {
    const result = bumpFee(
      validOptions({
        transaction: makeInner({ fee: '1000', sign: true }),
        feeBufferPercentage: 50,
      }),
    );

    expect(result.baseFee).toBe('1500');
    expect(result.fee).toBe('3000');
  });

  it('never lets the resolved base fee fall below the network floor', () => {
    // Inner fee below the 100-stroop floor still resolves to the floor.
    const result = bumpFee(validOptions({ transaction: makeInner({ fee: '1', sign: true }) }));

    expect(result.baseFee).toBe('100');
    expect(result.fee).toBe('200');
  });
});

/* -------------------------------------------------------------------------- */
/* Validation — parameter handling                                             */
/* -------------------------------------------------------------------------- */

describe('validateFeeBumpParams — invalid parameters', () => {
  it('reports a missing fee source', () => {
    const options = validOptions();
    // @ts-expect-error deliberately omitting the fee source
    delete options.feeSource;

    const report = validateFeeBumpParams(options);
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('MISSING_FEE_SOURCE');
  });

  it('rejects a malformed fee source public key', () => {
    const report = validateFeeBumpParams(
      validOptions({ feeSource: { publicKey: 'not-a-public-key' } }),
    );
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('INVALID_FEE_SOURCE_PUBLIC_KEY');
  });

  it('rejects a secret key that does not belong to the public key', () => {
    const report = validateFeeBumpParams(
      validOptions({
        feeSource: {
          publicKey: Keypair.random().publicKey(),
          secretKey: Keypair.random().secret(),
        },
      }),
    );
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('FEE_SOURCE_KEY_MISMATCH');
  });

  it('rejects an invalid secret key', () => {
    const sponsor = Keypair.random();
    const report = validateFeeBumpParams(
      validOptions({ feeSource: { publicKey: sponsor.publicKey(), secretKey: 'S-not-real' } }),
    );
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('INVALID_FEE_SOURCE_SECRET_KEY');
  });

  it('rejects an unknown network passphrase', () => {
    const report = validateFeeBumpParams(validOptions({ networkPassphrase: 'Not A Real Network' }));
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('INVALID_NETWORK_PASSPHRASE');
  });

  it('rejects a missing network passphrase', () => {
    const report = validateFeeBumpParams(
      // @ts-expect-error deliberately omitting the passphrase
      validOptions({ networkPassphrase: undefined }),
    );
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('MISSING_NETWORK_PASSPHRASE');
  });

  it('rejects a malformed transaction XDR string', () => {
    const report = validateFeeBumpParams(validOptions({ transaction: 'not-base64-xdr!!' }));
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('INVALID_TRANSACTION');
  });

  it('refuses to nest a fee-bump envelope', () => {
    const outer = bumpFee(validOptions({ transaction: makeInner({ sign: true }) }));

    const report = validateFeeBumpParams(validOptions({ transaction: outer.xdr }));
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('NESTED_FEE_BUMP');

    expect(() => bumpFee(validOptions({ transaction: outer.xdr }))).toThrowError(
      FeeBumpValidationError,
    );
  });

  it('rejects a base fee below the network minimum', () => {
    const report = validateFeeBumpParams(validOptions({ baseFee: 50 }));
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('BASE_FEE_BELOW_MINIMUM');
  });

  it("rejects a base fee below the inner transaction's rate", () => {
    const report = validateFeeBumpParams(
      validOptions({ transaction: makeInner({ fee: '1000', sign: true }), baseFee: 500 }),
    );
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('BASE_FEE_BELOW_INNER');
  });

  it('rejects a total fee above the safety ceiling', () => {
    const report = validateFeeBumpParams(validOptions({ baseFee: 6_000_000 }));
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('FEE_BID_TOO_HIGH');
  });

  it('rejects a non-integer base fee', () => {
    const report = validateFeeBumpParams(validOptions({ baseFee: 'abc' }));
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('INVALID_BASE_FEE');
  });

  it('rejects a negative base fee', () => {
    const report = validateFeeBumpParams(validOptions({ baseFee: -1 }));
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('INVALID_BASE_FEE');
  });

  it('rejects a negative fee buffer', () => {
    const report = validateFeeBumpParams(validOptions({ feeBufferPercentage: -5 }));
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('INVALID_FEE_BUFFER');
  });
});

/* -------------------------------------------------------------------------- */
/* Warnings, gating and error shape                                            */
/* -------------------------------------------------------------------------- */

describe('fee-bump warnings and error handling', () => {
  it('warns about an unsigned inner transaction without failing validation', () => {
    const report = validateFeeBumpParams(validOptions({ transaction: makeInner() }));

    expect(report.valid).toBe(true);
    expect(report.warnings.map((w) => w.code)).toContain('UNSIGNED_INNER_TRANSACTION');
  });

  it('validates a well-formed request as valid with no errors', () => {
    const report = validateFeeBumpParams(validOptions());
    expect(report.valid).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it('assertValidFeeBumpParams returns the report for valid input', () => {
    const report = assertValidFeeBumpParams(validOptions());
    expect(report.valid).toBe(true);
  });

  it('assertValidFeeBumpParams throws a FeeBumpValidationError carrying the report', () => {
    try {
      assertValidFeeBumpParams(validOptions({ baseFee: 50 }));
      expect.unreachable('expected a FeeBumpValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(FeeBumpValidationError);
      expect(err).toBeInstanceOf(ValidationError);
      const error = err as FeeBumpValidationError;
      expect(error.code).toBe('FEE_BUMP_VALIDATION_FAILED');
      expect(error.status).toBe(400);
      expect(error.report.valid).toBe(false);
      expect(error.report.errors.map((e) => e.code)).toContain('BASE_FEE_BELOW_MINIMUM');
    }
  });

  it('bumpFee throws instead of building when parameters are invalid', () => {
    expect(() => bumpFee(validOptions({ networkPassphrase: 'Not A Real Network' }))).toThrowError(
      FeeBumpValidationError,
    );
  });
});

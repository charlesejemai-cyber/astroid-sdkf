import { describe, expect, it } from 'vitest';

import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-base';

import {
  MAX_MEMO_TEXT_BYTES,
  MAX_TOTAL_FEE_STROOPS,
  TransactionEnvelopeValidationError,
  assertValidTransactionEnvelope,
  sanitizeTransactionJson,
  validateTransactionEnvelope,
  type TransactionJson,
} from '../validator.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const SOURCE = Keypair.random();

function makeSourceAccount(sequence = '1'): Account {
  return new Account(SOURCE.publicKey(), sequence);
}

function buildXdr(options: {
  fee?: string;
  memo?: Memo;
  operations?: number;
  timeoutSeconds?: number;
  minTime?: number;
  maxTime?: number;
}): string {
  const builder = new TransactionBuilder(makeSourceAccount(), {
    fee: options.fee ?? BASE_FEE,
    networkPassphrase: Networks.TESTNET,
    memo: options.memo,
  });

  const opCount = options.operations ?? 1;
  for (let i = 0; i < opCount; i += 1) {
    builder.addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: '1',
      }),
    );
  }

  if (options.minTime !== undefined || options.maxTime !== undefined) {
    builder.setTimebounds(options.minTime ?? 0, options.maxTime ?? 0);
  } else {
    builder.setTimeout(options.timeoutSeconds ?? 300);
  }

  return builder.build().toXDR();
}

const validJson: TransactionJson = {
  source: SOURCE.publicKey(),
  fee: '100',
  sequence: '2',
  memo: { type: 'text', value: 'hello' },
  operations: [{}],
  timeBounds: null,
};

/* -------------------------------------------------------------------------- */
/* XDR envelopes                                                               */
/* -------------------------------------------------------------------------- */

describe('validateTransactionEnvelope — XDR', () => {
  it('accepts a well-formed envelope', () => {
    const report = validateTransactionEnvelope(buildXdr({}), {
      networkPassphrase: Networks.TESTNET,
    });
    expect(report.valid).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.normalized.source).toBe(SOURCE.publicKey());
    expect(report.normalized.operationCount).toBe(1);
  });

  it('flags an empty string', () => {
    const report = validateTransactionEnvelope('');
    expect(report.valid).toBe(false);
    expect(report.errors[0]?.code).toBe('INVALID_ENVELOPE_XDR');
  });

  it('flags non-base64 / undecodable XDR', () => {
    expect(validateTransactionEnvelope('not base64!!!').errors[0]?.code).toBe(
      'INVALID_ENVELOPE_XDR',
    );
    expect(validateTransactionEnvelope('AAAA').errors[0]?.code).toBe('INVALID_ENVELOPE_XDR');
  });

  it('accepts a maximum-length (28-byte) text memo in a decoded envelope', () => {
    const xdr = buildXdr({ memo: Memo.text('x'.repeat(MAX_MEMO_TEXT_BYTES)) });
    const report = validateTransactionEnvelope(xdr, { networkPassphrase: Networks.TESTNET });
    expect(report.valid).toBe(true);
    expect(report.normalized.memoType).toBe('text');
  });

  it('detects an excessive fee bid', () => {
    const xdr = buildXdr({ fee: String(MAX_TOTAL_FEE_STROOPS + 1) });
    const report = validateTransactionEnvelope(xdr, { networkPassphrase: Networks.TESTNET });
    expect(report.errors.map((e) => e.code)).toContain('FEE_BID_TOO_HIGH');
  });

  it('detects a fee below the network minimum', () => {
    const xdr = buildXdr({ fee: '50' });
    const report = validateTransactionEnvelope(xdr, { networkPassphrase: Networks.TESTNET });
    expect(report.errors.map((e) => e.code)).toContain('FEE_BELOW_MINIMUM');
  });

  it('warns when the validity window has elapsed', () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const xdr = buildXdr({ minTime: past - 60, maxTime: past });
    const report = validateTransactionEnvelope(xdr, {
      networkPassphrase: Networks.TESTNET,
      now: Date.now(),
    });
    expect(report.valid).toBe(true); // warning only
    expect(report.warnings.map((w) => w.code)).toContain('TRANSACTION_EXPIRED');
  });
});

/* -------------------------------------------------------------------------- */
/* JSON payloads                                                               */
/* -------------------------------------------------------------------------- */

describe('validateTransactionEnvelope — JSON', () => {
  it('accepts a well-formed JSON payload', () => {
    expect(validateTransactionEnvelope(validJson).valid).toBe(true);
  });

  it('flags a missing source account', () => {
    const report = validateTransactionEnvelope({ ...validJson, source: null });
    expect(report.errors.map((e) => e.code)).toContain('MISSING_SOURCE_ACCOUNT');
  });

  it('flags an invalid source account', () => {
    const report = validateTransactionEnvelope({ ...validJson, source: 'GABC' });
    expect(report.errors.map((e) => e.code)).toContain('INVALID_SOURCE_ACCOUNT');
  });

  it('flags no operations and too many operations', () => {
    expect(
      validateTransactionEnvelope({ ...validJson, operations: [] }).errors.map((e) => e.code),
    ).toContain('NO_OPERATIONS');
    expect(
      validateTransactionEnvelope({
        ...validJson,
        operations: new Array(101).fill({}),
      }).errors.map((e) => e.code),
    ).toContain('TOO_MANY_OPERATIONS');
  });

  it('flags a missing / non-integer / negative fee', () => {
    expect(
      validateTransactionEnvelope({ ...validJson, fee: null }).errors.map((e) => e.code),
    ).toContain('MISSING_FEE');
    expect(
      validateTransactionEnvelope({ ...validJson, fee: '10.5' }).errors.map((e) => e.code),
    ).toContain('INVALID_FEE');
    expect(
      validateTransactionEnvelope({ ...validJson, fee: '-100' }).errors.map((e) => e.code),
    ).toContain('INVALID_FEE');
  });

  it('validates memo variants', () => {
    expect(
      validateTransactionEnvelope({
        ...validJson,
        memo: { type: 'text', value: 'x'.repeat(MAX_MEMO_TEXT_BYTES + 1) },
      }).errors.map((e) => e.code),
    ).toContain('MEMO_TEXT_TOO_LONG');
    expect(
      validateTransactionEnvelope({ ...validJson, memo: { type: 'id', value: 'abc' } }).errors.map(
        (e) => e.code,
      ),
    ).toContain('INVALID_MEMO_ID');
    expect(
      validateTransactionEnvelope({ ...validJson, memo: { type: 'hash', value: 'zz' } }).errors.map(
        (e) => e.code,
      ),
    ).toContain('INVALID_MEMO_HASH');
    expect(
      validateTransactionEnvelope({ ...validJson, memo: { type: 'weird', value: 'x' } }).errors.map(
        (e) => e.code,
      ),
    ).toContain('INVALID_MEMO_TYPE');
    expect(validateTransactionEnvelope({ ...validJson, memo: { type: 'none' } }).valid).toBe(true);
    expect(
      validateTransactionEnvelope({
        ...validJson,
        memo: { type: 'id', value: '18446744073709551615' },
      }).valid,
    ).toBe(true);
  });

  it('flags inverted and invalid time bounds', () => {
    expect(
      validateTransactionEnvelope({
        ...validJson,
        timeBounds: { minTime: 200, maxTime: 100 },
      }).errors.map((e) => e.code),
    ).toContain('INVALID_TIME_BOUNDS');
    expect(
      validateTransactionEnvelope({
        ...validJson,
        timeBounds: { maxTime: 'not-a-date' },
      }).errors.map((e) => e.code),
    ).toContain('INVALID_TIME_BOUNDS');
  });

  it('rejects a non-object, non-string input', () => {
    expect(validateTransactionEnvelope(42 as unknown as string).errors[0]?.code).toBe(
      'INVALID_INPUT',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* assertValidTransactionEnvelope                                              */
/* -------------------------------------------------------------------------- */

describe('assertValidTransactionEnvelope', () => {
  it('returns the report when valid', () => {
    const report = assertValidTransactionEnvelope(validJson);
    expect(report.valid).toBe(true);
  });

  it('throws TransactionEnvelopeValidationError with the report attached', () => {
    try {
      assertValidTransactionEnvelope({ ...validJson, source: null, fee: null });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TransactionEnvelopeValidationError);
      const typed = err as TransactionEnvelopeValidationError;
      expect(typed.report.errors.length).toBeGreaterThanOrEqual(2);
      expect(typed.code).toBe('TRANSACTION_VALIDATION_FAILED');
      expect((typed.details?.issues as unknown[]).length).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* sanitizeTransactionJson                                                     */
/* -------------------------------------------------------------------------- */

describe('sanitizeTransactionJson', () => {
  it('trims, coerces and drops fields without mutating the input', () => {
    const input: TransactionJson = {
      source: `  ${SOURCE.publicKey()}  `,
      fee: 100,
      sequence: 5,
      memo: { type: 'TEXT', value: 'y'.repeat(40) },
      timeBounds: { minTime: '0', maxTime: 0 },
      operations: [{}],
    };
    const out = sanitizeTransactionJson(input);
    expect(out.source).toBe(SOURCE.publicKey());
    expect(out.fee).toBe('100');
    expect(out.sequence).toBe('5');
    expect(out.memo).toEqual({ type: 'text', value: 'y'.repeat(MAX_MEMO_TEXT_BYTES) });
    expect(out.timeBounds).toBeUndefined();
    expect(input.source).toBe(`  ${SOURCE.publicKey()}  `); // unchanged
  });

  it('drops a blank source and an unparseable fee', () => {
    const out = sanitizeTransactionJson({ source: '   ', fee: 'abc' });
    expect(out.source).toBeUndefined();
    expect(out.fee).toBeUndefined();
  });

  it('removes none / blank memos', () => {
    expect(sanitizeTransactionJson({ memo: { type: 'none' } }).memo).toBeUndefined();
    expect(sanitizeTransactionJson({ memo: { type: '' } }).memo).toBeUndefined();
  });
});

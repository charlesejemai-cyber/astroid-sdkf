/**
 * Unit tests for the reusable transaction input validators in `validate.ts`:
 * Stellar public keys, XDR strings, asset identifiers, text memos, and amounts.
 */

import { describe, expect, it } from 'vitest';

import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

import {
  assertValidAssetIdentifier,
  assertValidMemoText,
  assertValidPositiveAmount,
  assertValidStellarPublicKey,
  assertValidXdr,
  isValidAssetIdentifier,
  isValidMemoText,
  isValidPositiveAmount,
  isValidStellarPublicKey,
  isValidXdr,
} from '../src/validate.js';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const VALID_PUBLIC_KEY = Keypair.random().publicKey();
/** A well-formed-looking `G…` string whose checksum bytes are wrong. */
const INVALID_CHECKSUM_KEY = `${VALID_PUBLIC_KEY.slice(0, -1)}${
  VALID_PUBLIC_KEY.at(-1) === 'A' ? 'B' : 'A'
}`;
/** The canonical all-zero Stellar account (valid StrKey). */
const NULL_ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

function validEnvelopeXdr(): string {
  const account = new Account(Keypair.random().publicKey(), '1');
  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: '1',
      }),
    )
    .setTimeout(300)
    .build();
  return tx.toXDR();
}

/* -------------------------------------------------------------------------- */
/* Public keys                                                                 */
/* -------------------------------------------------------------------------- */

describe('isValidStellarPublicKey', () => {
  it('accepts a real checksummed public key', () => {
    expect(isValidStellarPublicKey(VALID_PUBLIC_KEY)).toBe(true);
  });

  it('accepts the canonical null account', () => {
    expect(isValidStellarPublicKey(NULL_ACCOUNT)).toBe(true);
  });

  it('rejects a G-shaped string with a corrupt checksum', () => {
    expect(INVALID_CHECKSUM_KEY).toMatch(/^G[A-Z2-7]{55}$/);
    expect(isValidStellarPublicKey(INVALID_CHECKSUM_KEY)).toBe(false);
  });

  it('rejects non-key values', () => {
    expect(isValidStellarPublicKey('not-an-address')).toBe(false);
    expect(isValidStellarPublicKey('')).toBe(false);
    expect(isValidStellarPublicKey('G' + '1'.repeat(55))).toBe(false); // 1 not in base32
    expect(isValidStellarPublicKey('G' + 'A'.repeat(54))).toBe(false); // wrong length
    expect(isValidStellarPublicKey(VALID_PUBLIC_KEY.toLowerCase())).toBe(false);
  });
});

describe('assertValidStellarPublicKey', () => {
  it('does not throw for a valid key', () => {
    expect(() => assertValidStellarPublicKey(VALID_PUBLIC_KEY)).not.toThrow();
  });

  it('throws a structured ValidationError for an invalid key', () => {
    try {
      assertValidStellarPublicKey('bad-address', 'destination');
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('INVALID_ADDRESS');
      expect((err as ValidationError).details).toEqual({ field: 'destination' });
    }
  });
});

/* -------------------------------------------------------------------------- */
/* XDR                                                                         */
/* -------------------------------------------------------------------------- */

describe('isValidXdr', () => {
  it('accepts a real transaction envelope', () => {
    expect(isValidXdr(validEnvelopeXdr())).toBe(true);
  });

  it('accepts any canonical non-empty base64', () => {
    expect(isValidXdr('AAAAAA==')).toBe(true);
  });

  it('rejects malformed encodings', () => {
    expect(isValidXdr('not xdr')).toBe(false);
    expect(isValidXdr('')).toBe(false);
    expect(isValidXdr('AAA')).toBe(false); // bad padding
    expect(isValidXdr('!!!!')).toBe(false); // not base64 alphabet
    expect(isValidXdr('QQ==QQ==')).toBe(false); // non-canonical
  });
});

describe('assertValidXdr', () => {
  it('does not throw for a valid envelope', () => {
    expect(() => assertValidXdr(validEnvelopeXdr())).not.toThrow();
  });

  it('throws a structured ValidationError for invalid XDR', () => {
    try {
      assertValidXdr('not xdr', 'transactionXdr');
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('INVALID_XDR_ENCODING');
      expect((err as ValidationError).details).toEqual({ field: 'transactionXdr' });
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Assets                                                                      */
/* -------------------------------------------------------------------------- */

describe('isValidAssetIdentifier', () => {
  it('accepts XLM, bare codes, and CODE:ISSUER', () => {
    expect(isValidAssetIdentifier('XLM')).toBe(true);
    expect(isValidAssetIdentifier('xlm')).toBe(true);
    expect(isValidAssetIdentifier('USDC')).toBe(true);
    expect(isValidAssetIdentifier(`USDC:${VALID_PUBLIC_KEY}`)).toBe(true);
  });

  it('rejects malformed identifiers', () => {
    expect(isValidAssetIdentifier('')).toBe(false);
    expect(isValidAssetIdentifier('TOO-LONG-CODE')).toBe(false);
    expect(isValidAssetIdentifier(`USDC:${INVALID_CHECKSUM_KEY}`)).toBe(false);
    expect(isValidAssetIdentifier('USDC:G:extra')).toBe(false);
    expect(isValidAssetIdentifier('XLM:extra')).toBe(false);
  });
});

describe('assertValidAssetIdentifier', () => {
  it('does not throw for valid identifiers', () => {
    expect(() => assertValidAssetIdentifier('XLM')).not.toThrow();
    expect(() => assertValidAssetIdentifier(`USDC:${VALID_PUBLIC_KEY}`)).not.toThrow();
  });

  it('throws a structured ValidationError for an invalid identifier', () => {
    try {
      assertValidAssetIdentifier('TOO-LONG-CODE');
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('INVALID_ASSET');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Memos                                                                       */
/* -------------------------------------------------------------------------- */

describe('isValidMemoText', () => {
  it('accepts ASCII at the 28-byte boundary', () => {
    expect(isValidMemoText('a'.repeat(28))).toBe(true);
    expect(isValidMemoText('a'.repeat(29))).toBe(false);
  });

  it('counts UTF-8 bytes, not characters', () => {
    expect(isValidMemoText('é'.repeat(14))).toBe(true); // 14 × 2 bytes = 28
    expect(isValidMemoText('é'.repeat(15))).toBe(false); // 15 × 2 bytes = 30
  });

  it('rejects non-strings', () => {
    expect(isValidMemoText(123 as unknown as string)).toBe(false);
  });
});

describe('assertValidMemoText', () => {
  it('does not throw for a short memo', () => {
    expect(() => assertValidMemoText('ok')).not.toThrow();
  });

  it('throws a structured ValidationError for an over-long memo', () => {
    try {
      assertValidMemoText('a'.repeat(29));
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('INVALID_MEMO');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Amounts                                                                     */
/* -------------------------------------------------------------------------- */

describe('isValidPositiveAmount', () => {
  it('accepts positive decimal strings and numbers', () => {
    expect(isValidPositiveAmount('10.5')).toBe(true);
    expect(isValidPositiveAmount('0.0000001')).toBe(true);
    expect(isValidPositiveAmount(42)).toBe(true);
  });

  it('rejects zero, negatives, NaN, and empty strings', () => {
    expect(isValidPositiveAmount('0')).toBe(false);
    expect(isValidPositiveAmount(0)).toBe(false);
    expect(isValidPositiveAmount('-1')).toBe(false);
    expect(isValidPositiveAmount('abc')).toBe(false);
    expect(isValidPositiveAmount('')).toBe(false);
  });
});

describe('assertValidPositiveAmount', () => {
  it('does not throw for a valid amount', () => {
    expect(() => assertValidPositiveAmount('1.5')).not.toThrow();
  });

  it('throws a structured ValidationError for an invalid amount', () => {
    try {
      assertValidPositiveAmount(0, 'amount');
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('INVALID_AMOUNT');
      expect((err as ValidationError).details).toEqual({ field: 'amount' });
    }
  });
});

import { describe, it, expect } from 'vitest';
import { Keypair } from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';
import {
  isValidPublicKey,
  isValidSecretKey,
  assertValidPublicKey,
  assertValidSecretKey,
  derivePublicKey,
  signMessage,
  verifyMessage,
  zeroize,
} from '../src/crypto.js';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const keypair = Keypair.random();
const PUBLIC_KEY = keypair.publicKey();
const SECRET_KEY = keypair.secret();

const OTHER_KEYPAIR = Keypair.random();

/* -------------------------------------------------------------------------- */
/* Key validation                                                              */
/* -------------------------------------------------------------------------- */

describe('isValidPublicKey / isValidSecretKey', () => {
  it('accepts valid strkey formats', () => {
    expect(isValidPublicKey(PUBLIC_KEY)).toBe(true);
    expect(isValidSecretKey(SECRET_KEY)).toBe(true);
  });

  it('rejects malformed, empty, and wrong-type values', () => {
    expect(isValidPublicKey('not-a-key')).toBe(false);
    expect(isValidPublicKey('')).toBe(false);
    expect(isValidPublicKey(SECRET_KEY)).toBe(false); // S… is not a public key
    expect(isValidPublicKey(null)).toBe(false);
    expect(isValidPublicKey(123)).toBe(false);
    expect(isValidPublicKey(undefined)).toBe(false);

    expect(isValidSecretKey('not-a-key')).toBe(false);
    expect(isValidSecretKey('')).toBe(false);
    expect(isValidSecretKey(PUBLIC_KEY)).toBe(false); // G… is not a secret key
    expect(isValidSecretKey(null)).toBe(false);
  });

  it('rejects keys with a corrupted checksum', () => {
    // Flip one character of an otherwise valid key.
    const corrupted = PUBLIC_KEY.slice(0, -1) + (PUBLIC_KEY.endsWith('A') ? 'B' : 'A');
    expect(isValidPublicKey(corrupted)).toBe(false);
  });
});

describe('assertValidPublicKey / assertValidSecretKey', () => {
  it('passes through valid keys without throwing', () => {
    expect(() => assertValidPublicKey(PUBLIC_KEY)).not.toThrow();
    expect(() => assertValidSecretKey(SECRET_KEY)).not.toThrow();
  });

  it('throws a ValidationError for invalid keys', () => {
    expect(() => assertValidPublicKey('nope')).toThrow(ValidationError);
    expect(() => assertValidSecretKey('nope')).toThrow(ValidationError);
    try {
      assertValidPublicKey('nope');
    } catch (err) {
      expect((err as ValidationError).code).toBe('INVALID_PUBLIC_KEY');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Derivation                                                                  */
/* -------------------------------------------------------------------------- */

describe('derivePublicKey', () => {
  it('derives the matching public key from a secret key', () => {
    expect(derivePublicKey(SECRET_KEY)).toBe(PUBLIC_KEY);
  });

  it('throws a ValidationError for an invalid secret key', () => {
    expect(() => derivePublicKey('SINVALID')).toThrow(ValidationError);
    expect(() => derivePublicKey(PUBLIC_KEY)).toThrow(ValidationError); // G… is not a secret
  });
});

/* -------------------------------------------------------------------------- */
/* Message signing & verification                                              */
/* -------------------------------------------------------------------------- */

describe('signMessage / verifyMessage', () => {
  it('round-trips a string message (sign then verify)', () => {
    const message = 'approve payment of 25 USDC to GABC';
    const signature = signMessage(message, SECRET_KEY);

    expect(typeof signature).toBe('string');
    expect(verifyMessage(message, signature, PUBLIC_KEY)).toBe(true);
  });

  it('round-trips a binary message', () => {
    const message = new Uint8Array([1, 2, 3, 250, 251, 252]);
    const signature = signMessage(message, SECRET_KEY);

    expect(verifyMessage(message, signature, PUBLIC_KEY)).toBe(true);
  });

  it('accepts a Keypair instance as the signer', () => {
    const signature = signMessage('payload', keypair);
    expect(verifyMessage('payload', signature, PUBLIC_KEY)).toBe(true);
  });

  it('fails verification for a tampered payload', () => {
    const signature = signMessage('transfer 1 USDC', SECRET_KEY);

    expect(verifyMessage('transfer 2 USDC', signature, PUBLIC_KEY)).toBe(false);
    expect(verifyMessage('', signature, PUBLIC_KEY)).toBe(false);
  });

  it('fails verification for a mismatched public key', () => {
    const signature = signMessage('payload', SECRET_KEY);
    expect(verifyMessage('payload', signature, OTHER_KEYPAIR.publicKey())).toBe(false);
  });

  it('fails verification for a tampered signature', () => {
    const signature = signMessage('payload', SECRET_KEY);
    const bytes = Buffer.from(signature, 'base64');
    bytes[0] = bytes[0]! ^ 0xff;
    expect(verifyMessage('payload', bytes.toString('base64'), PUBLIC_KEY)).toBe(false);
  });

  it('returns false (no throw) for invalid keys and malformed signatures', () => {
    expect(verifyMessage('payload', 'AAAA', 'not-a-key')).toBe(false);
    expect(verifyMessage('payload', 'not-base64!!', PUBLIC_KEY)).toBe(false);
    // Valid base64 but wrong signature length (32 bytes ≠ 64).
    expect(verifyMessage('payload', Buffer.alloc(32).toString('base64'), PUBLIC_KEY)).toBe(false);
    expect(verifyMessage('payload', Buffer.alloc(64), PUBLIC_KEY)).toBe(false);
    expect(verifyMessage('payload', 'AAAA', '')).toBe(false);
  });

  it('produces a distinct signature per message (Ed25519 deterministic but message-bound)', () => {
    const sigA = signMessage('message A', SECRET_KEY);
    const sigB = signMessage('message B', SECRET_KEY);
    expect(sigA).not.toBe(sigB);
    expect(verifyMessage('message A', sigA, PUBLIC_KEY)).toBe(true);
    expect(verifyMessage('message B', sigB, PUBLIC_KEY)).toBe(true);
    expect(verifyMessage('message A', sigB, PUBLIC_KEY)).toBe(false);
  });

  it('throws a ValidationError when signing with an invalid secret key', () => {
    expect(() => signMessage('payload', 'not-a-secret')).toThrow(ValidationError);
  });

  it('throws a ValidationError when signing with a public-only Keypair', () => {
    const readOnly = Keypair.fromPublicKey(PUBLIC_KEY);
    expect(readOnly.canSign()).toBe(false);
    expect(() => signMessage('payload', readOnly)).toThrow(ValidationError);
  });
});

/* -------------------------------------------------------------------------- */
/* Memory hygiene                                                              */
/* -------------------------------------------------------------------------- */

describe('zeroize', () => {
  it('overwrites buffer contents in place', () => {
    const buf = Buffer.from('secret-bytes');
    expect(buf.some((b) => b !== 0)).toBe(true);

    zeroize(buf);
    expect(buf.every((b) => b === 0)).toBe(true);
  });

  it('tolerates undefined input', () => {
    expect(() => zeroize(undefined)).not.toThrow();
  });
});

/**
 * `@astroid/wallet` — wallet key management and Ed25519 message signing.
 *
 * Small, auditable utilities for handling Stellar strkeys and signing
 * arbitrary messages with the agent's keypair:
 *
 * - {@link isValidPublicKey} / {@link isValidSecretKey} — checksum-validated
 *   strkey format checks (delegated to `@stellar/stellar-base`'s `StrKey`, so
 *   we never hand-roll base32/checksum logic).
 * - {@link derivePublicKey} — derive the `G…` public key from an `S…` secret.
 * - {@link signMessage} / {@link verifyMessage} — raw Ed25519 detached
 *   signatures over a message, base64-encoded for transport.
 *
 * ## Secret handling
 *
 * Secret material is only held in transient `Buffer`s which are zeroed in
 * `finally` blocks after use ({@link zeroize}); strings are immutable in JS so
 * the `S…` input itself cannot be wiped — callers should drop it as soon as
 * possible and never log it. The derived {@link Keypair} keeps its own copy of
 * the seed for signing; drop the reference after use.
 *
 * @module
 */

import { Keypair, StrKey } from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';
import type { SignerLike } from './signing.js';

/* -------------------------------------------------------------------------- */
/* Memory hygiene                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Overwrite a buffer with zeroes in place.
 *
 * Used to minimise the lifetime of decoded secret-key bytes. JavaScript cannot
 * guarantee secure wiping (GC may have copied the data), so treat this as
 * best-effort hygiene rather than a hard guarantee.
 */
export function zeroize(buffer: Uint8Array | undefined): void {
  buffer?.fill(0);
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Returns `true` when `value` is a well-formed Stellar public key
 * (`G…`, version byte + CRC16 checksum verified).
 *
 * Accepts unknown values gracefully (`false` for non-strings) so it is safe
 * for validating untrusted input.
 */
export function isValidPublicKey(value: unknown): value is string {
  return typeof value === 'string' && StrKey.isValidEd25519PublicKey(value);
}

/**
 * Returns `true` when `value` is a well-formed Stellar secret seed
 * (`S…`, version byte + CRC16 checksum verified).
 */
export function isValidSecretKey(value: unknown): value is string {
  return typeof value === 'string' && StrKey.isValidEd25519SecretSeed(value);
}

/**
 * Throw a structured {@link ValidationError} unless `value` is a valid public key.
 *
 * @throws {ValidationError} When the value is not a `G…` strkey.
 */
export function assertValidPublicKey(value: unknown, field = 'publicKey'): asserts value is string {
  if (!isValidPublicKey(value)) {
    throw new ValidationError(`Invalid Stellar public key${field ? ` (${field})` : ''}.`, {
      code: 'INVALID_PUBLIC_KEY',
    });
  }
}

/**
 * Throw a structured {@link ValidationError} unless `value` is a valid secret key.
 *
 * @throws {ValidationError} When the value is not an `S…` strkey.
 */
export function assertValidSecretKey(value: unknown, field = 'secretKey'): asserts value is string {
  if (!isValidSecretKey(value)) {
    throw new ValidationError(`Invalid Stellar secret key${field ? ` (${field})` : ''}.`, {
      code: 'INVALID_SECRET_KEY',
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Derivation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Derive the public key (`G…`) that corresponds to a secret key (`S…`).
 *
 * The decoded seed bytes are zeroed as soon as the {@link Keypair} has copied
 * them; drop the returned keypair once the public key has been read if you
 * don't need to sign further.
 *
 * @throws {ValidationError} When `secretKey` is not a valid `S…` strkey.
 */
export function derivePublicKey(secretKey: string): string {
  assertValidSecretKey(secretKey);
  // Decode manually (rather than Keypair.fromSecret) so our copy of the raw
  // seed can be wiped immediately after the keypair has consumed it.
  const rawSeed = StrKey.decodeEd25519SecretSeed(secretKey);
  try {
    return Keypair.fromRawEd25519Seed(rawSeed).publicKey();
  } finally {
    zeroize(rawSeed);
  }
}

/* -------------------------------------------------------------------------- */
/* Message signing                                                             */
/* -------------------------------------------------------------------------- */

/** Resolve a {@link SignerLike} to a signing {@link Keypair}. */
function keypairFromSigner(signer: SignerLike): Keypair {
  if (typeof signer !== 'string') {
    if (!signer.canSign()) {
      throw new ValidationError('Signer keypair cannot sign (no secret key present).', {
        code: 'KEYPAIR_CANNOT_SIGN',
      });
    }
    return signer;
  }
  assertValidSecretKey(signer);
  const rawSeed = StrKey.decodeEd25519SecretSeed(signer);
  try {
    return Keypair.fromRawEd25519Seed(rawSeed);
  } finally {
    zeroize(rawSeed);
  }
}

/** Normalise a message payload to bytes without mutating the caller's input. */
function toMessageBytes(message: string | Uint8Array): Buffer {
  if (typeof message === 'string') {
    return Buffer.from(message, 'utf8');
  }
  return Buffer.from(message);
}

/**
 * Sign a message with Ed25519 (Stellar's native signature scheme) and return
 * the detached signature as a base64 string.
 *
 * The message may be a UTF-8 string or raw bytes; a copy of the bytes is
 * always taken so the caller's buffer is never mutated (and can be zeroed
 * independently).
 *
 * @param message Message payload to sign.
 * @param signer  `S…` secret key or a signing-capable {@link Keypair}.
 * @returns Base64-encoded 64-byte Ed25519 signature.
 * @throws {ValidationError} When the secret key/Keypair is invalid or cannot sign.
 *
 * @example
 * ```ts
 * const signature = signMessage('transfer 1 USDC', secretKey);
 * verifyMessage('transfer 1 USDC', signature, publicKey); // true
 * ```
 */
export function signMessage(message: string | Uint8Array, signer: SignerLike): string {
  const keypair = keypairFromSigner(signer);
  const bytes = toMessageBytes(message);
  try {
    // Keypair.sign copies the seed internally; the signature itself is not
    // secret, so only the transient message/seed buffers are wiped.
    return keypair.sign(bytes).toString('base64');
  } finally {
    zeroize(bytes);
  }
}

/**
 * Verify an Ed25519 signature produced by {@link signMessage}.
 *
 * Returns `false` (rather than throwing) for any invalid input — malformed
 * public keys, malformed signatures, or wrong-length signatures all fail
 * verification, which keeps this safe to call on untrusted input.
 *
 * @param message   Original message payload.
 * @param signature Base64-encoded signature (or raw signature bytes).
 * @param publicKey `G…` public key of the expected signer.
 */
export function verifyMessage(
  message: string | Uint8Array,
  signature: string | Uint8Array,
  publicKey: string,
): boolean {
  if (!isValidPublicKey(publicKey)) return false;

  let sigBytes: Buffer;
  if (typeof signature === 'string') {
    sigBytes = Buffer.from(signature, 'base64');
  } else {
    sigBytes = Buffer.from(signature);
  }
  if (sigBytes.length !== 64) {
    zeroize(sigBytes);
    return false;
  }

  const bytes = toMessageBytes(message);
  try {
    return Keypair.fromPublicKey(publicKey).verify(bytes, sigBytes);
  } catch {
    return false;
  } finally {
    zeroize(bytes);
    zeroize(sigBytes);
  }
}

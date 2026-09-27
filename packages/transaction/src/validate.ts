/**
 * Reusable input validators for Stellar transaction payloads.
 *
 * Agent runtimes assemble transactions from many sources — CLI flags, API
 * bodies, LLM-generated payloads — so the SDK exposes small, composable guards
 * here that can be reused anywhere a transaction is constructed. Every
 * `isValid*` predicate is a pure boolean check; every `assert*` companion
 * throws a structured {@link ValidationError} from `@astroid/errors` with a
 * machine-readable `code`, matching the rest of the transaction package.
 *
 * Public keys are checksum-validated through `@stellar/stellar-base`'s `StrKey`
 * (already a dependency), so a well-formed-looking `G…` string that fails its
 * version/checksum bytes is rejected, not just regex-shaped strings.
 *
 * @module
 */

import { StrKey } from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';
import { MAX_MEMO_TEXT_BYTES, MEMO_HASH_BYTES } from './validator.js';

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/** Stellar public key format: `G` followed by 55 base-32 chars. */
const STELLAR_PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;

/** Asset code: 1–12 alphanumeric characters (Stellar asset-code rules). */
const ASSET_CODE_PATTERN = /^[A-Za-z0-9]{1,12}$/;

/** Base64 without line breaks: standard alphabet, `=` padding only at the end. */
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/* -------------------------------------------------------------------------- */
/* Public keys                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Whether `address` is a valid Stellar public key.
 *
 * The check is stricter than the `G[A-Z2-7]{55}` shape: the string must also
 * pass `StrKey`'s version-byte and checksum verification, which catches
 * truncated or corrupted addresses that merely *look* right.
 *
 * @param address The `G…` address to check.
 * @returns `true` when the address is a valid, checksummed Stellar public key.
 *
 * @example
 * ```ts
 * isValidStellarPublicKey('GABCDEF…'); // true for a real key
 * isValidStellarPublicKey('not-an-address'); // false
 * ```
 */
export function isValidStellarPublicKey(address: string): boolean {
  if (typeof address !== 'string') return false;
  const trimmed = address.trim();
  if (!STELLAR_PUBLIC_KEY_PATTERN.test(trimmed)) return false;
  return StrKey.isValidEd25519PublicKey(trimmed);
}

/**
 * Throw a {@link ValidationError} unless `address` is a valid Stellar public key.
 *
 * @param address The `G…` address to validate.
 * @param field   The field name to report in the error details.
 * @throws {ValidationError} With code `INVALID_ADDRESS` when invalid.
 */
export function assertValidStellarPublicKey(address: string, field = 'address'): void {
  if (!isValidStellarPublicKey(address)) {
    throw new ValidationError(`${field} must be a valid Stellar public key (G…).`, {
      code: 'INVALID_ADDRESS',
      details: { field },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* XDR                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Whether `xdr` is a well-formed base64-encoded XDR string.
 *
 * Checks the envelope shape (non-empty, base64 alphabet, `=` padding rules)
 * and round-trips the decode so only canonical, non-empty byte strings pass.
 * This validates the *encoding*, not that the bytes decode to a Stellar
 * transaction — use {@link decodeTransactionXDR} or the envelope validator for
 * that stronger check.
 *
 * @param xdr The base64 XDR string to check.
 * @returns `true` when the string is valid, canonical base64 XDR.
 */
export function isValidXdr(xdr: string): boolean {
  if (typeof xdr !== 'string') return false;
  const trimmed = xdr.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length % 4 !== 0 || !BASE64_PATTERN.test(trimmed)) return false;
  const decoded = Buffer.from(trimmed, 'base64');
  return decoded.length > 0 && decoded.toString('base64') === trimmed;
}

/**
 * Throw a {@link ValidationError} unless `xdr` is a valid base64 XDR string.
 *
 * @param xdr   The base64 XDR string to validate.
 * @param field The field name to report in the error details.
 * @throws {ValidationError} With code `INVALID_XDR_ENCODING` when invalid.
 */
export function assertValidXdr(xdr: string, field = 'xdr'): void {
  if (!isValidXdr(xdr)) {
    throw new ValidationError(`${field} must be a valid base64-encoded XDR string.`, {
      code: 'INVALID_XDR_ENCODING',
      details: { field },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Assets                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Whether `asset` is a valid asset identifier.
 *
 * Accepts `XLM` (native), a bare 1–12 character asset code (e.g. `USDC`), or
 * `CODE:ISSUER` where the issuer is a checksum-valid Stellar public key.
 *
 * @param asset The asset identifier to check.
 * @returns `true` when the identifier is well-formed.
 *
 * @example
 * ```ts
 * isValidAssetIdentifier('XLM');              // true
 * isValidAssetIdentifier('USDC');             // true
 * isValidAssetIdentifier('USDC:G…Issuer');    // true
 * isValidAssetIdentifier('TOO-LONG:bad');     // false
 * ```
 */
export function isValidAssetIdentifier(asset: string): boolean {
  if (typeof asset !== 'string') return false;
  const trimmed = asset.trim();
  if (trimmed === '') return false;
  if (trimmed.toUpperCase() === 'XLM') return true;

  const parts = trimmed.split(':');
  if (parts.length > 2) return false;

  const [code, issuer] = parts;
  if (!code || !ASSET_CODE_PATTERN.test(code)) return false;
  if (issuer !== undefined && !isValidStellarPublicKey(issuer)) return false;
  return true;
}

/**
 * Throw a {@link ValidationError} unless `asset` is a valid asset identifier.
 *
 * @param asset The asset identifier to validate.
 * @throws {ValidationError} With code `INVALID_ASSET` when invalid.
 */
export function assertValidAssetIdentifier(asset: string): void {
  if (!isValidAssetIdentifier(asset)) {
    throw new ValidationError(
      'asset must be XLM, a bare asset code, or CODE:ISSUER with a valid Stellar issuer.',
      { code: 'INVALID_ASSET' },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Memos                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Whether `memo` fits within the standard text memo limit (28 UTF-8 bytes).
 *
 * @param memo The memo text to check.
 * @returns `true` when the memo is at most {@link MAX_MEMO_TEXT_BYTES} bytes.
 */
export function isValidMemoText(memo: string): boolean {
  if (typeof memo !== 'string') return false;
  return new TextEncoder().encode(memo).byteLength <= MAX_MEMO_TEXT_BYTES;
}

/**
 * Throw a {@link ValidationError} unless `memo` fits the standard text memo limit.
 *
 * @param memo  The memo text to validate.
 * @param field The field name to report in the error details.
 * @throws {ValidationError} With code `INVALID_MEMO` when too long.
 */
export function assertValidMemoText(memo: string, field = 'memo'): void {
  if (!isValidMemoText(memo)) {
    throw new ValidationError(`Standard text memo must be ${MAX_MEMO_TEXT_BYTES} bytes or fewer.`, {
      code: 'INVALID_MEMO',
      details: { field },
    });
  }
}

/** A 32-byte memo encoded as 64 hexadecimal characters. */
const HEX_MEMO_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * Whether `memo` is a valid 32-byte hash/return memo, encoded as 64 hex chars.
 *
 * @param memo The hex-encoded memo value to check.
 * @returns `true` when the value is exactly {@link MEMO_HASH_BYTES} bytes of hex.
 */
export function isValidMemoHash(memo: string): boolean {
  return typeof memo === 'string' && HEX_MEMO_PATTERN.test(memo.trim());
}

/**
 * Throw a {@link ValidationError} unless `memo` is a 64-character hex string
 * (a 32-byte `MEMO_HASH` / `MEMO_RETURN` value).
 *
 * @param memo  The hex-encoded memo value to validate.
 * @param field The field name to report in the error details.
 * @throws {ValidationError} With code `INVALID_MEMO` when malformed.
 */
export function assertValidMemoHash(memo: string, field = 'memo'): void {
  if (!isValidMemoHash(memo)) {
    throw new ValidationError(
      `${field} must be ${MEMO_HASH_BYTES} bytes encoded as ${MEMO_HASH_BYTES * 2} hexadecimal characters.`,
      { code: 'INVALID_MEMO', details: { field } },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Amounts                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Whether `amount` is a positive, finite decimal amount.
 *
 * @param amount The amount to check (decimal string or number).
 * @returns `true` when the amount parses to a finite number greater than zero.
 */
export function isValidPositiveAmount(amount: string | number): boolean {
  if (typeof amount !== 'string' && typeof amount !== 'number') return false;
  if (typeof amount === 'string' && amount.trim() === '') return false;
  const numeric = typeof amount === 'number' ? amount : Number(amount);
  return Number.isFinite(numeric) && numeric > 0;
}

/**
 * Throw a {@link ValidationError} unless `amount` is a positive finite amount.
 *
 * @param amount The amount to validate.
 * @param field  The field name to report in the error details.
 * @throws {ValidationError} With code `INVALID_AMOUNT` when not positive.
 */
export function assertValidPositiveAmount(amount: string | number, field = 'amount'): void {
  if (!isValidPositiveAmount(amount)) {
    throw new ValidationError(`${field} must be a positive finite amount.`, {
      code: 'INVALID_AMOUNT',
      details: { field },
    });
  }
}

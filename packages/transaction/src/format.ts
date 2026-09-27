/**
 * Transaction payload formatting helpers.
 *
 * These functions bridge the two representations an agent runtime works with:
 * the Stellar envelope (a built `Transaction` or its base64 XDR) and the plain
 * JSON payload the Astroid API expects. {@link formatTransactionPayload}
 * normalises any envelope into a single structured object (XDR plus decoded
 * metadata) for logging, inspection, or submission; {@link buildPaymentPayload}
 * builds and formats a payment transaction in one call, ready for
 * `transactions.create`.
 *
 * No network or signing happens here. Invalid input surfaces as a structured
 * {@link ValidationError} from `@astroid/errors`.
 *
 * @module
 */

import { Networks } from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';
import type { DecodedOperation, DecodedTxPayload } from './decoder.js';
import { decodeTransactionXDR } from './decoder.js';
import { buildPaymentTransaction, encodeTransaction } from './builder.js';
import type { PaymentTransactionOptions } from './builder.js';
import type { TransactionSource } from './submit.js';

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/** Options for {@link formatTransactionPayload}. */
export interface FormatTransactionPayloadOptions {
  /**
   * Network passphrase used to decode an XDR envelope.
   * Defaults to {@link Networks.PUBLIC}.
   */
  networkPassphrase?: string;
}

/**
 * A transaction envelope normalised for API consumption or inspection.
 *
 * For fee-bump envelopes the fields describe the inner transaction (the
 * operations that actually execute); the full fee-bump envelope XDR is
 * preserved verbatim in `transactionXdr`.
 */
export interface FormattedTransactionPayload {
  /** The base64 XDR envelope, ready for submission. */
  transactionXdr: string;
  /** Source account of the (inner) transaction. */
  sourceAccount: string;
  /** Sequence number of the source account. */
  sequence: string;
  /** Fee bid in stroops. */
  fee: string;
  /** Memo, as `{ type, value }` (`value` is `null` for `none` memos). */
  memo: { type: string; value: string | null };
  /** Number of operations in the envelope. */
  operationCount: number;
  /** Decoded operations, one entry per operation. */
  operations: DecodedOperation[];
}

/**
 * Normalise a Stellar transaction envelope into a single formatted payload.
 *
 * Accepts a built `Transaction`, a `FeeBumpTransaction`, or a base64 XDR string.
 * The envelope is validated (via {@link encodeTransaction}) and decoded, so an
 * undecodable or empty envelope throws a structured {@link ValidationError}.
 *
 * @param source  The transaction to format.
 * @param options Optional network passphrase for decoding XDR strings.
 * @returns       A {@link FormattedTransactionPayload}.
 *
 * @example
 * ```ts
 * const payload = formatTransactionPayload(tx, {
 *   networkPassphrase: StellarNetworkPassphrase.TESTNET,
 * });
 * console.log(payload.operationCount); // 1
 * ```
 */
export function formatTransactionPayload(
  source: TransactionSource,
  options: FormatTransactionPayloadOptions = {},
): FormattedTransactionPayload {
  const transactionXdr = encodeTransaction(source);
  const decoded: DecodedTxPayload = decodeTransactionXDR(
    transactionXdr,
    options.networkPassphrase ?? Networks.PUBLIC,
  );

  return {
    transactionXdr,
    sourceAccount: decoded.sourceAccount,
    sequence: decoded.sequenceNumber,
    fee: decoded.fee,
    memo: decoded.memo,
    operationCount: decoded.operations.length,
    operations: decoded.operations,
  };
}

/* -------------------------------------------------------------------------- */
/* Build + format                                                              */
/* -------------------------------------------------------------------------- */

/** Options for {@link buildPaymentPayload}. */
export interface BuildPaymentPayloadOptions extends PaymentTransactionOptions {
  /** The Astroid wallet id that funds the payment. */
  walletId: string;
}

/**
 * A payment transaction formatted for the Astroid API.
 *
 * Mirrors {@link CreateTransactionInput} for the common payment case, so the
 * result can be passed straight to `astroid.transactions.create(...)`.
 */
export interface PaymentPayload {
  /** The Astroid wallet id that funds the payment. */
  walletId: string;
  /** The base64 XDR envelope of the unsigned payment transaction. */
  transactionXdr: string;
  /** Asset identifier (`XLM`, `CODE`, or `CODE:ISSUER`). */
  asset: string;
  /** Amount to send. */
  amount: string;
  /** Destination Stellar account. */
  recipientAddress: string;
  /** Standard text memo, when one was supplied. */
  memo?: string;
}

/**
 * Build and format a payment transaction in one call.
 *
 * Assembles an unsigned payment transaction (validating the destination
 * address, amount, asset, network passphrase, and source account), encodes it
 * to base64 XDR, and returns the payload the Astroid API accepts.
 *
 * @param options Payment options plus the funding `walletId`.
 * @returns       A {@link PaymentPayload} ready for `transactions.create`.
 * @throws {ValidationError} For a missing `walletId` or any invalid payment field.
 *
 * @example
 * ```ts
 * const payload = buildPaymentPayload({
 *   walletId: 'wal_abc123',
 *   source: account,
 *   networkPassphrase: StellarNetworkPassphrase.TESTNET,
 *   destination: 'G…',
 *   asset: 'USDC',
 *   amount: '10',
 *   memoText: 'invoice-42',
 * });
 * await astroid.transactions.create(payload);
 * ```
 */
export function buildPaymentPayload(options: BuildPaymentPayloadOptions): PaymentPayload {
  if (typeof options.walletId !== 'string' || options.walletId.trim() === '') {
    throw new ValidationError('Missing required transaction field: walletId.', {
      code: 'MISSING_FIELD',
      details: { field: 'walletId' },
    });
  }

  const tx = buildPaymentTransaction(options);

  const payload: PaymentPayload = {
    walletId: options.walletId.trim(),
    transactionXdr: encodeTransaction(tx),
    asset: options.asset.trim(),
    amount: String(options.amount),
    recipientAddress: options.destination.trim(),
  };
  if (options.memoText) {
    payload.memo = options.memoText;
  }
  return payload;
}

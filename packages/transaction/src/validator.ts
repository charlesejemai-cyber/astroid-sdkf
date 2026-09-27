/**
 * Automatic transaction payload validation & sanitization helpers.
 *
 * Constructing raw Stellar transactions by hand in an agent runtime is
 * error-prone: a malformed memo, a missing source account, or an accidental
 * multi-XLM fee bid are all easy to introduce and expensive to discover after
 * broadcast. The helpers here inspect a transaction — either a base64 XDR
 * envelope or a plain-JSON representation — against Astroid protocol
 * requirements and return a structured {@link TransactionValidationReport}
 * before the transaction ever reaches the network.
 *
 * Everything is a pure function: no network, no signing, no mutation of the
 * input. {@link sanitizeTransactionJson} returns a cleaned copy;
 * {@link assertValidTransactionEnvelope} throws a typed
 * {@link TransactionEnvelopeValidationError} carrying the full report.
 *
 * @module
 */

import { Buffer } from 'node:buffer';

import { FeeBumpTransaction, Networks, TransactionBuilder } from '@stellar/stellar-base';
import type { Memo, Transaction } from '@stellar/stellar-base';

import { AstroidTransactionError } from './errors.js';

/* -------------------------------------------------------------------------- */
/* Protocol constants                                                          */
/* -------------------------------------------------------------------------- */

/** Minimum base fee per operation, in stroops (Stellar network floor). */
export const MIN_BASE_FEE_STROOPS = 100;

/**
 * Maximum total fee bid Astroid will allow on a single transaction, in stroops
 * (1 XLM). Anything above this is almost always an accidental over-bid.
 */
export const MAX_TOTAL_FEE_STROOPS = 10_000_000;

/** Maximum number of operations permitted in one transaction. */
export const MAX_OPERATIONS = 100;

/** Maximum byte length of a `MEMO_TEXT` memo. */
export const MAX_MEMO_TEXT_BYTES = 28;

/** Exact byte length of a `MEMO_HASH` / `MEMO_RETURN` memo. */
export const MEMO_HASH_BYTES = 32;

const STELLAR_PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;
const MUXED_ACCOUNT_PATTERN = /^M[A-Z2-7]{68}$/;
const UINT64_PATTERN = /^\d{1,20}$/;
const HEX_64_PATTERN = /^[0-9a-fA-F]{64}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const UINT64_MAX = 18_446_744_073_709_551_615n;

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** Every issue code the validator can emit. */
export type TransactionValidationCode =
  | 'INVALID_INPUT'
  | 'INVALID_ENVELOPE_XDR'
  | 'MISSING_SOURCE_ACCOUNT'
  | 'INVALID_SOURCE_ACCOUNT'
  | 'MISSING_FEE'
  | 'INVALID_FEE'
  | 'FEE_BELOW_MINIMUM'
  | 'FEE_BID_TOO_HIGH'
  | 'NO_OPERATIONS'
  | 'TOO_MANY_OPERATIONS'
  | 'INVALID_MEMO_TYPE'
  | 'INVALID_MEMO_VALUE'
  | 'MEMO_TEXT_TOO_LONG'
  | 'INVALID_MEMO_ID'
  | 'INVALID_MEMO_HASH'
  | 'INVALID_TIME_BOUNDS'
  | 'TRANSACTION_EXPIRED';

/** Severity of a single validation issue. */
export type TransactionValidationSeverity = 'error' | 'warning';

/** A single problem found while validating a transaction payload. */
export interface TransactionValidationIssue {
  /** Machine-readable issue code. */
  code: TransactionValidationCode;
  /** Dotted/indexed path to the offending field (e.g. `"memo"`, `"fee"`). */
  path: string;
  /** Human-readable explanation. */
  message: string;
  /** `error` fails validation; `warning` is advisory only. */
  severity: TransactionValidationSeverity;
}

/** A normalized snapshot of the fields the validator inspected. */
export interface NormalizedTransactionView {
  /** Source account (`G…`/`M…`) or `null` when absent. */
  source: string | null;
  /** Total fee bid in stroops as a string, or `null` when absent/unparseable. */
  fee: string | null;
  /** Number of operations found. */
  operationCount: number;
  /** Memo type: `none` | `text` | `id` | `hash` | `return`. */
  memoType: string;
  /** Whether the payload was a fee-bump envelope. */
  feeBump: boolean;
}

/** The structured result of validating a transaction payload. */
export interface TransactionValidationReport {
  /** `true` when there are no `error`-severity issues. */
  valid: boolean;
  /** Every issue, in discovery order. */
  issues: TransactionValidationIssue[];
  /** Just the `error`-severity issues. */
  errors: TransactionValidationIssue[];
  /** Just the `warning`-severity issues. */
  warnings: TransactionValidationIssue[];
  /** What the validator was able to extract from the payload. */
  normalized: NormalizedTransactionView;
}

/** JSON representation of a transaction memo. */
export interface TransactionMemoJson {
  /** One of `none` | `text` | `id` | `hash` | `return`. */
  type: string;
  /** The memo value (text string, uint64 string, or 64-char hex). Omit for `none`. */
  value?: string | null;
}

/** JSON representation of a transaction's validity window (RFC-3339 or epoch seconds). */
export interface TransactionTimeBoundsJson {
  minTime?: string | number;
  maxTime?: string | number;
}

/** Plain-JSON representation of a transaction, as an alternative to XDR. */
export interface TransactionJson {
  /** Source account address. */
  source?: string | null;
  /** Total fee bid in stroops (string or number). */
  fee?: string | number | null;
  /** Sequence number (not validated structurally, kept for sanitization). */
  sequence?: string | number | null;
  /** Memo, as `{ type, value }`. */
  memo?: TransactionMemoJson | null;
  /** Operation list — only the count is inspected here. */
  operations?: unknown[];
  /** Validity window. */
  timeBounds?: TransactionTimeBoundsJson | null;
  /** Network passphrase, when the payload carries one. */
  networkPassphrase?: string;
}

/** Options for the validator. */
export interface ValidateTransactionOptions {
  /**
   * Network passphrase used to decode an XDR envelope.
   * Defaults to {@link Networks.PUBLIC}.
   */
  networkPassphrase?: string;
  /** Override the maximum acceptable total fee bid, in stroops. */
  maxTotalFeeStroops?: number;
  /** Override the minimum acceptable base fee, in stroops. */
  minBaseFeeStroops?: number;
  /**
   * When provided, transactions whose `maxTime` is at or before this instant
   * are reported as `TRANSACTION_EXPIRED` (warning). Pass `Date.now()` to check
   * against the present.
   */
  now?: number;
}

/* -------------------------------------------------------------------------- */
/* Error class                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Thrown by {@link assertValidTransactionEnvelope} when a payload fails validation.
 * The full {@link TransactionValidationReport} is available on `.report`.
 */
export class TransactionEnvelopeValidationError extends AstroidTransactionError {
  /** The structured validation report that triggered this error. */
  readonly report: TransactionValidationReport;

  constructor(report: TransactionValidationReport) {
    const summary = report.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    super(`Transaction failed validation — ${summary || 'unknown error'}`, {
      code: 'TRANSACTION_VALIDATION_FAILED',
      status: 400,
      details: { issues: report.issues },
    });
    this.report = report;
  }
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                            */
/* -------------------------------------------------------------------------- */

interface IssueSink {
  add(
    code: TransactionValidationCode,
    path: string,
    message: string,
    severity?: TransactionValidationSeverity,
  ): void;
}

function createSink(issues: TransactionValidationIssue[]): IssueSink {
  return {
    add(code, path, message, severity = 'error') {
      issues.push({ code, path, message, severity });
    },
  };
}

function isValidAccountAddress(value: string): boolean {
  return STELLAR_PUBLIC_KEY_PATTERN.test(value) || MUXED_ACCOUNT_PATTERN.test(value);
}

function toEpochMs(value: string | number): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // Heuristic: treat 10-digit values as epoch seconds.
    return value < 1e11 ? value * 1000 : value;
  }
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return n < 1e11 ? n * 1000 : n;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function validateFee(
  feeRaw: string | number | null | undefined,
  operationCount: number,
  sink: IssueSink,
  opts: Required<Pick<ValidateTransactionOptions, 'maxTotalFeeStroops' | 'minBaseFeeStroops'>>,
): string | null {
  if (feeRaw === null || feeRaw === undefined || feeRaw === '') {
    sink.add('MISSING_FEE', 'fee', 'Transaction is missing a fee.');
    return null;
  }

  const feeStr = String(feeRaw).trim();
  if (!/^-?\d+$/.test(feeStr)) {
    sink.add('INVALID_FEE', 'fee', `Fee "${feeStr}" is not an integer number of stroops.`);
    return null;
  }

  const fee = BigInt(feeStr);
  if (fee < 0n) {
    sink.add('INVALID_FEE', 'fee', 'Fee must not be negative.');
    return feeStr;
  }

  const minTotal = BigInt(Math.max(1, operationCount)) * BigInt(opts.minBaseFeeStroops);
  if (fee < minTotal) {
    sink.add(
      'FEE_BELOW_MINIMUM',
      'fee',
      `Fee ${feeStr} stroops is below the network minimum of ${minTotal} stroops ` +
        `(${Math.max(1, operationCount)} op(s) × ${opts.minBaseFeeStroops}).`,
    );
  }

  if (fee > BigInt(opts.maxTotalFeeStroops)) {
    sink.add(
      'FEE_BID_TOO_HIGH',
      'fee',
      `Fee bid ${feeStr} stroops exceeds the safety ceiling of ${opts.maxTotalFeeStroops} stroops.`,
    );
  }

  return feeStr;
}

function validateMemo(memo: TransactionMemoJson | null | undefined, sink: IssueSink): string {
  if (memo === null || memo === undefined) return 'none';

  const type = String(memo.type ?? '').toLowerCase();
  const value = memo.value ?? undefined;

  switch (type) {
    case '':
    case 'none':
      return 'none';

    case 'text': {
      if (typeof value !== 'string') {
        sink.add('INVALID_MEMO_VALUE', 'memo.value', 'A text memo requires a string value.');
        return 'text';
      }
      const bytes = new TextEncoder().encode(value).byteLength;
      if (bytes > MAX_MEMO_TEXT_BYTES) {
        sink.add(
          'MEMO_TEXT_TOO_LONG',
          'memo.value',
          `Text memo is ${bytes} bytes; the maximum is ${MAX_MEMO_TEXT_BYTES}.`,
        );
      }
      return 'text';
    }

    case 'id': {
      const str = String(value ?? '').trim();
      if (!UINT64_PATTERN.test(str) || BigInt(str) > UINT64_MAX) {
        sink.add('INVALID_MEMO_ID', 'memo.value', 'An id memo must be a uint64 value.');
      }
      return 'id';
    }

    case 'hash':
    case 'return': {
      if (typeof value !== 'string' || !HEX_64_PATTERN.test(value.trim())) {
        sink.add(
          'INVALID_MEMO_HASH',
          'memo.value',
          `A ${type} memo must be ${MEMO_HASH_BYTES} bytes encoded as ${MEMO_HASH_BYTES * 2} hex characters.`,
        );
      }
      return type;
    }

    default:
      sink.add('INVALID_MEMO_TYPE', 'memo.type', `Unknown memo type "${memo.type}".`);
      return type;
  }
}

function validateTimeBounds(
  tb: TransactionTimeBoundsJson | null | undefined,
  sink: IssueSink,
  now: number | undefined,
): void {
  if (!tb) return;

  const isSet = (v: string | number | undefined): v is string | number =>
    v !== undefined && v !== '0' && v !== 0 && v !== '';

  const min = isSet(tb.minTime) ? toEpochMs(tb.minTime) : null;
  const max = isSet(tb.maxTime) ? toEpochMs(tb.maxTime) : null;

  if (isSet(tb.minTime) && min === null) {
    sink.add('INVALID_TIME_BOUNDS', 'timeBounds.minTime', 'minTime is not a valid timestamp.');
  }
  if (isSet(tb.maxTime) && max === null) {
    sink.add('INVALID_TIME_BOUNDS', 'timeBounds.maxTime', 'maxTime is not a valid timestamp.');
  }
  if (min !== null && max !== null && min > max) {
    sink.add('INVALID_TIME_BOUNDS', 'timeBounds', 'minTime is after maxTime.');
  }
  if (now !== undefined && max !== null && max <= now) {
    sink.add(
      'TRANSACTION_EXPIRED',
      'timeBounds.maxTime',
      'Transaction validity window has already elapsed.',
      'warning',
    );
  }
}

/** Convert a decoded stellar-base memo into the JSON shape the checks expect. */
function memoToJson(memo: Memo): TransactionMemoJson {
  switch (memo.type) {
    case 'text': {
      const v = memo.value;
      const text = typeof v === 'string' ? v : Buffer.isBuffer(v) ? v.toString('utf8') : '';
      return { type: 'text', value: text };
    }
    case 'id':
      return {
        type: 'id',
        value: typeof memo.value === 'string' ? memo.value : String(memo.value),
      };
    case 'hash':
    case 'return': {
      const v = memo.value;
      const hex = Buffer.isBuffer(v) ? v.toString('hex') : typeof v === 'string' ? v : '';
      return { type: memo.type, value: hex };
    }
    default:
      return { type: 'none' };
  }
}

function jsonFromTransaction(tx: Transaction): TransactionJson {
  return {
    source: tx.source ?? null,
    fee: tx.fee ?? null,
    sequence: tx.sequence ?? null,
    memo: memoToJson(tx.memo),
    operations: [...tx.operations],
    timeBounds: tx.timeBounds
      ? { minTime: tx.timeBounds.minTime, maxTime: tx.timeBounds.maxTime }
      : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The input accepted by {@link validateTransactionEnvelope}: a base64 XDR envelope
 * string, or a {@link TransactionJson} object.
 */
export type TransactionEnvelopeInput = string | TransactionJson;

/** An empty report used when the input can't be inspected at all. */
function emptyNormalized(
  overrides: Partial<NormalizedTransactionView> = {},
): NormalizedTransactionView {
  return {
    source: null,
    fee: null,
    operationCount: 0,
    memoType: 'none',
    feeBump: false,
    ...overrides,
  };
}

function finalize(
  issues: TransactionValidationIssue[],
  normalized: NormalizedTransactionView,
): TransactionValidationReport {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return { valid: errors.length === 0, issues, errors, warnings, normalized };
}

/**
 * Validate a transaction payload against Astroid protocol requirements.
 *
 * Accepts either a base64 XDR envelope (including fee-bump envelopes) or a
 * plain-JSON representation. Never throws for a structurally-decodable payload —
 * problems are returned as issues in the report.
 *
 * @param input   The XDR string or {@link TransactionJson} to validate.
 * @param options Network passphrase and threshold overrides.
 * @returns       A {@link TransactionValidationReport}.
 */
export function validateTransactionEnvelope(
  input: TransactionEnvelopeInput,
  options: ValidateTransactionOptions = {},
): TransactionValidationReport {
  const issues: TransactionValidationIssue[] = [];
  const sink = createSink(issues);

  const thresholds = {
    maxTotalFeeStroops: options.maxTotalFeeStroops ?? MAX_TOTAL_FEE_STROOPS,
    minBaseFeeStroops: options.minBaseFeeStroops ?? MIN_BASE_FEE_STROOPS,
  };

  if (
    input === null ||
    input === undefined ||
    (typeof input !== 'string' && typeof input !== 'object')
  ) {
    sink.add(
      'INVALID_INPUT',
      'transaction',
      'Input must be an XDR string or a transaction object.',
    );
    return finalize(issues, emptyNormalized());
  }

  let json: TransactionJson;
  let feeBump = false;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed === '') {
      sink.add('INVALID_ENVELOPE_XDR', 'xdr', 'XDR envelope must be a non-empty base64 string.');
      return finalize(issues, emptyNormalized());
    }
    if (trimmed.length % 4 !== 0 || !BASE64_PATTERN.test(trimmed)) {
      sink.add('INVALID_ENVELOPE_XDR', 'xdr', 'XDR envelope is not valid base64.');
      return finalize(issues, emptyNormalized());
    }

    const passphrase = options.networkPassphrase ?? Networks.PUBLIC;
    let decoded: Transaction | FeeBumpTransaction;
    try {
      decoded = TransactionBuilder.fromXDR(trimmed, passphrase);
    } catch {
      sink.add('INVALID_ENVELOPE_XDR', 'xdr', 'XDR envelope could not be decoded.');
      return finalize(issues, emptyNormalized());
    }

    if (decoded instanceof FeeBumpTransaction) {
      feeBump = true;
      const inner = decoded.innerTransaction;
      json = jsonFromTransaction(inner);
      // The fee-bump fee is what actually gets bid on the network.
      json.fee = decoded.fee ?? json.fee;
    } else {
      json = jsonFromTransaction(decoded);
    }
  } else {
    json = input;
  }

  // --- source account ---
  const source = json.source ?? null;
  if (source === null || (typeof source === 'string' && source.trim() === '')) {
    sink.add('MISSING_SOURCE_ACCOUNT', 'source', 'Transaction is missing a source account.');
  } else if (typeof source !== 'string' || !isValidAccountAddress(source.trim())) {
    sink.add(
      'INVALID_SOURCE_ACCOUNT',
      'source',
      `Source account "${String(source)}" is not a valid Stellar account address.`,
    );
  }

  // --- operations ---
  const operationCount = Array.isArray(json.operations) ? json.operations.length : 0;
  if (operationCount === 0) {
    sink.add('NO_OPERATIONS', 'operations', 'Transaction must contain at least one operation.');
  } else if (operationCount > MAX_OPERATIONS) {
    sink.add(
      'TOO_MANY_OPERATIONS',
      'operations',
      `Transaction has ${operationCount} operations; the maximum is ${MAX_OPERATIONS}.`,
    );
  }

  // --- fee ---
  const fee = validateFee(json.fee, operationCount, sink, thresholds);

  // --- memo ---
  const memoType = validateMemo(json.memo, sink);

  // --- time bounds ---
  validateTimeBounds(json.timeBounds, sink, options.now);

  return finalize(issues, {
    source: typeof source === 'string' ? source.trim() : null,
    fee,
    operationCount,
    memoType,
    feeBump,
  });
}

/**
 * Like {@link validateTransactionEnvelope}, but throws a
 * {@link TransactionEnvelopeValidationError} (with the report attached) when the
 * payload is invalid. Returns the report on success.
 *
 * @throws {TransactionEnvelopeValidationError} When validation fails.
 */
export function assertValidTransactionEnvelope(
  input: TransactionEnvelopeInput,
  options: ValidateTransactionOptions = {},
): TransactionValidationReport {
  const report = validateTransactionEnvelope(input, options);
  if (!report.valid) {
    throw new TransactionEnvelopeValidationError(report);
  }
  return report;
}

/**
 * Return a sanitized copy of a {@link TransactionJson} payload:
 *
 * - trims the source account and drops it when blank,
 * - coerces the fee to an integer stroop string (dropping it when unparseable),
 * - normalizes the memo (`type` lower-cased, blank/`none` memos removed,
 *   text memos truncated to {@link MAX_MEMO_TEXT_BYTES}),
 * - removes zero/blank time bounds.
 *
 * The input object is never mutated.
 */
export function sanitizeTransactionJson(input: TransactionJson): TransactionJson {
  const out: TransactionJson = {};

  const source = typeof input.source === 'string' ? input.source.trim() : '';
  if (source !== '') out.source = source;

  if (input.fee !== null && input.fee !== undefined && input.fee !== '') {
    const feeStr = String(input.fee).trim();
    if (/^\d+$/.test(feeStr)) out.fee = feeStr;
  }

  if (input.sequence !== null && input.sequence !== undefined) {
    out.sequence = String(input.sequence).trim();
  }

  if (Array.isArray(input.operations)) {
    out.operations = [...input.operations];
  }

  if (input.memo) {
    const type = String(input.memo.type ?? '').toLowerCase();
    if (type && type !== 'none') {
      const memo: TransactionMemoJson = { type };
      if (type === 'text' && typeof input.memo.value === 'string') {
        memo.value = truncateUtf8(input.memo.value, MAX_MEMO_TEXT_BYTES);
      } else if (input.memo.value !== undefined && input.memo.value !== null) {
        memo.value = String(input.memo.value).trim();
      }
      out.memo = memo;
    }
  }

  if (input.timeBounds) {
    const tb: TransactionTimeBoundsJson = {};
    if (input.timeBounds.minTime && input.timeBounds.minTime !== '0') {
      tb.minTime = input.timeBounds.minTime;
    }
    if (input.timeBounds.maxTime && input.timeBounds.maxTime !== '0') {
      tb.maxTime = input.timeBounds.maxTime;
    }
    if (tb.minTime !== undefined || tb.maxTime !== undefined) out.timeBounds = tb;
  }

  if (input.networkPassphrase !== undefined) out.networkPassphrase = input.networkPassphrase;

  return out;
}

/** Truncate a string so its UTF-8 encoding fits within `maxBytes`. */
function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) return value;
  let result = value;
  while (result.length > 0 && encoder.encode(result).byteLength > maxBytes) {
    result = result.slice(0, -1);
  }
  return result;
}

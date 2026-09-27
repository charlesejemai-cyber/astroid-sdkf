/**
 * Fee-bump (fee sponsorship) helpers.
 *
 * On Stellar, a *fee bump* wraps a signed inner transaction in a second envelope
 * whose **fee source** pays a fee at least as high as the inner transaction's.
 * The inner transaction — and its signatures — is carried verbatim; only the fee
 * source signs the new envelope. That is how an autonomous agent can sponsor and
 * accelerate another party's transaction during network congestion without ever
 * holding that party's keys.
 *
 * {@link bumpFee} validates the request against Stellar protocol constraints
 * *before* construction and returns a fully typed {@link FeeBumpResult}: the
 * envelope, its base64 XDR and the resolved fee numbers. Everything here is pure
 * — no network access — so the same checks double as a pre-submission gate via
 * {@link validateFeeBumpParams} / {@link assertValidFeeBumpParams}.
 *
 * Invalid input is surfaced as a structured {@link FeeBumpValidationError} (a
 * `@astroid/errors` `ValidationError` subclass) carrying the full report, never a
 * bare `Error`.
 *
 * @module
 */

import {
  FeeBumpTransaction,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

import { isValidStellarPublicKey, isValidXdr } from './validate.js';
import { MAX_TOTAL_FEE_STROOPS, MIN_BASE_FEE_STROOPS } from './validator.js';

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/** Known Stellar network passphrases accepted by the fee-bump helpers. */
const KNOWN_PASSPHRASES = new Set<string>([Networks.PUBLIC, Networks.TESTNET, Networks.FUTURENET]);

/* -------------------------------------------------------------------------- */
/* Public configuration types                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Credentials of the account that sponsors (pays) the bumped fee.
 *
 * Only `publicKey` is required: with it, {@link bumpFee} still builds a valid,
 * unsigned fee-bump envelope for out-of-band signing. Providing `secretKey` makes
 * the helper sign the envelope locally instead.
 */
export interface FeeSourceCredentials {
  /** The sponsoring account's public key (`G…`). */
  publicKey: string;
  /**
   * The sponsoring account's secret seed (`S…`). When provided it must belong to
   * `publicKey`; the envelope is signed with it and the key is used in memory
   * only. Omit to build an unsigned envelope.
   */
  secretKey?: string;
}

/**
 * The fee source, expressed either as explicit credentials or as an existing
 * `@stellar/stellar-base` `Keypair` (which is always used to sign).
 */
export type FeeSource = FeeSourceCredentials | Keypair;

/** Everything {@link bumpFee} needs: the base transaction plus the sponsoring signer. */
export interface FeeBumpOptions {
  /**
   * The base ("inner") transaction to wrap: a built `Transaction` instance or the
   * base64 XDR envelope of one. A fee-bump envelope is rejected — the protocol
   * does not allow nesting.
   */
  transaction: Transaction | string;
  /** The account that pays the bumped fee. */
  feeSource: FeeSource;
  /** Target Stellar network passphrase (e.g. `Networks.TESTNET`). */
  networkPassphrase: string;
  /**
   * Base fee for the fee-bump envelope, in **stroops per operation**. Defaults to
   * the inner transaction's own per-operation inclusion fee (never below the
   * network floor of {@link MIN_BASE_FEE_STROOPS}).
   *
   * The total bid on the envelope is `baseFee × (operations + 1)`, matching
   * `@stellar/stellar-base`'s `TransactionBuilder.buildFeeBumpTransaction`.
   */
  baseFee?: string | number;
  /**
   * Percentage buffer added on top of the inner transaction's per-operation fee
   * when `baseFee` is omitted. Default `0`.
   */
  feeBufferPercentage?: number;
}

/** The result of a successful {@link bumpFee} call. */
export interface FeeBumpResult {
  /** The constructed fee-bump transaction (signed when credentials allowed it). */
  transaction: FeeBumpTransaction;
  /** Base64 XDR of the fee-bump envelope — ready for submission. */
  xdr: string;
  /** Base64 XDR of the wrapped inner transaction, for reference. */
  innerXdr: string;
  /** The public key (`G…`) of the account that pays the bumped fee. */
  feeSource: string;
  /** `true` when the envelope carries the fee source's signature. */
  signed: boolean;
  /** Total fee bid on the fee-bump envelope, in stroops. */
  fee: string;
  /** Resolved base fee rate used, in stroops per operation. */
  baseFee: string;
  /** The inner transaction's own fee, in stroops. */
  innerFee: string;
  /** Number of operations in the inner transaction. */
  operationCount: number;
  /** Network passphrase the envelope is bound to. */
  networkPassphrase: string;
}

/* -------------------------------------------------------------------------- */
/* Validation report types                                                     */
/* -------------------------------------------------------------------------- */

/** Every issue code the fee-bump validator can emit. */
export type FeeBumpValidationCode =
  | 'INVALID_INPUT'
  | 'MISSING_FEE_SOURCE'
  | 'INVALID_FEE_SOURCE'
  | 'INVALID_FEE_SOURCE_PUBLIC_KEY'
  | 'INVALID_FEE_SOURCE_SECRET_KEY'
  | 'FEE_SOURCE_KEY_MISMATCH'
  | 'MISSING_NETWORK_PASSPHRASE'
  | 'INVALID_NETWORK_PASSPHRASE'
  | 'MISSING_TRANSACTION'
  | 'INVALID_TRANSACTION'
  | 'NESTED_FEE_BUMP'
  | 'EMPTY_OPERATIONS'
  | 'INVALID_BASE_FEE'
  | 'BASE_FEE_BELOW_MINIMUM'
  | 'BASE_FEE_BELOW_INNER'
  | 'FEE_BID_TOO_HIGH'
  | 'INVALID_FEE_BUFFER'
  | 'UNSIGNED_INNER_TRANSACTION';

/** Severity of a single fee-bump validation issue. */
export type FeeBumpValidationSeverity = 'error' | 'warning';

/** A single problem found while validating fee-bump parameters. */
export interface FeeBumpValidationIssue {
  /** Machine-readable issue code. */
  code: FeeBumpValidationCode;
  /** Dotted path to the offending field (e.g. `"feeSource.secretKey"`). */
  path: string;
  /** Human-readable explanation. */
  message: string;
  /** `error` fails validation; `warning` is advisory only. */
  severity: FeeBumpValidationSeverity;
}

/** The structured result of validating a fee-bump request. */
export interface FeeBumpValidationReport {
  /** `true` when there are no `error`-severity issues. */
  valid: boolean;
  /** Every issue, in discovery order. */
  issues: FeeBumpValidationIssue[];
  /** Just the `error`-severity issues. */
  errors: FeeBumpValidationIssue[];
  /** Just the `warning`-severity issues. */
  warnings: FeeBumpValidationIssue[];
}

/* -------------------------------------------------------------------------- */
/* Error class                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Thrown by {@link bumpFee} / {@link assertValidFeeBumpParams} when the fee-bump
 * parameters fail validation. The full {@link FeeBumpValidationReport} is
 * available on `.report`.
 */
export class FeeBumpValidationError extends ValidationError {
  /** The structured validation report that triggered this error. */
  readonly report: FeeBumpValidationReport;

  constructor(report: FeeBumpValidationReport) {
    const summary = report.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    super(`Fee bump failed validation — ${summary || 'unknown error'}`, {
      code: 'FEE_BUMP_VALIDATION_FAILED',
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
    code: FeeBumpValidationCode,
    path: string,
    message: string,
    severity?: FeeBumpValidationSeverity,
  ): void;
}

function createSink(issues: FeeBumpValidationIssue[]): IssueSink {
  return {
    add(code, path, message, severity = 'error') {
      issues.push({ code, path, message, severity });
    },
  };
}

function finalize(issues: FeeBumpValidationIssue[]): FeeBumpValidationReport {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return { valid: errors.length === 0, issues, errors, warnings };
}

/** Parse a stroop amount that must be a non-negative safe integer. */
function parseStroops(value: string | number): number | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return value;
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const numeric = Number(trimmed);
  return Number.isSafeInteger(numeric) ? numeric : null;
}

/** Read the inner transaction's total fee in stroops, tolerating malformed values. */
function readFeeStroops(transaction: Transaction): bigint {
  try {
    return BigInt(transaction.fee || '0');
  } catch {
    return 0n;
  }
}

/**
 * Extract the Soroban resource fee from a transaction's extension, mirroring the
 * check `@stellar/stellar-base` itself performs: a fee bump only has to beat the
 * *inclusion* fee rate, not the inclusion-plus-resource fee.
 */
function extractResourceFeeStroops(transaction: Transaction): bigint {
  try {
    const extension = transaction.toEnvelope().v1().tx().ext();
    if (extension.switch() !== 1) return 0n;
    const sorobanData = extension.value();
    if (!sorobanData) return 0n;
    return BigInt(sorobanData.resourceFee().toString());
  } catch {
    return 0n;
  }
}

/** Everything the builder needs once the request has been fully validated. */
interface ResolvedFeeBump {
  innerTransaction: Transaction;
  innerXdr: string;
  networkPassphrase: string;
  feeSourcePublicKey: string;
  keypair: Keypair | undefined;
  operationCount: number;
  minimumBaseFee: number;
  baseFee: number;
}

/**
 * Validate the request and, when it is sound, resolve the concrete values the
 * builder consumes. Never throws: problems are collected as issues instead.
 */
function analyzeFeeBump(options: FeeBumpOptions): {
  report: FeeBumpValidationReport;
  resolved?: ResolvedFeeBump;
} {
  const issues: FeeBumpValidationIssue[] = [];
  const sink = createSink(issues);

  if (options === null || options === undefined || typeof options !== 'object') {
    sink.add('INVALID_INPUT', 'options', 'Fee-bump options must be an object.');
    return { report: finalize(issues) };
  }

  /* --- network passphrase ------------------------------------------------- */

  const passphrase = options.networkPassphrase;
  let networkPassphrase: string | undefined;
  if (typeof passphrase !== 'string' || passphrase.trim() === '') {
    sink.add(
      'MISSING_NETWORK_PASSPHRASE',
      'networkPassphrase',
      'A Stellar network passphrase is required.',
    );
  } else if (!KNOWN_PASSPHRASES.has(passphrase)) {
    sink.add(
      'INVALID_NETWORK_PASSPHRASE',
      'networkPassphrase',
      `networkPassphrase must be a known Stellar passphrase (e.g. ${Networks.TESTNET}).`,
    );
  } else {
    networkPassphrase = passphrase;
  }

  /* --- inner transaction -------------------------------------------------- */

  let innerTransaction: Transaction | undefined;
  let innerXdr: string | undefined;

  if (options.transaction === null || options.transaction === undefined) {
    sink.add('MISSING_TRANSACTION', 'transaction', 'A base transaction (or its XDR) is required.');
  } else if (typeof options.transaction === 'string') {
    const trimmed = options.transaction.trim();
    if (!isValidXdr(trimmed)) {
      sink.add(
        'INVALID_TRANSACTION',
        'transaction',
        'transaction must be a valid base64 XDR envelope.',
      );
    } else {
      try {
        const decoded = TransactionBuilder.fromXDR(trimmed, networkPassphrase ?? Networks.PUBLIC);
        if (decoded instanceof FeeBumpTransaction) {
          sink.add(
            'NESTED_FEE_BUMP',
            'transaction',
            'A fee-bump envelope cannot be wrapped in another fee-bump envelope.',
          );
        } else {
          innerTransaction = decoded;
          innerXdr = trimmed;
        }
      } catch {
        sink.add('INVALID_TRANSACTION', 'transaction', 'transaction XDR could not be decoded.');
      }
    }
  } else if (options.transaction instanceof FeeBumpTransaction) {
    sink.add(
      'NESTED_FEE_BUMP',
      'transaction',
      'A fee-bump transaction cannot be wrapped in another fee-bump envelope.',
    );
  } else if (options.transaction instanceof Transaction) {
    innerTransaction = options.transaction;
    innerXdr = options.transaction.toXDR();
  } else {
    sink.add(
      'INVALID_TRANSACTION',
      'transaction',
      'transaction must be a Transaction instance or base64 XDR.',
    );
  }

  /* --- operations, inner fee rate ----------------------------------------- */

  let operationCount = 0;
  let minimumBaseFee = MIN_BASE_FEE_STROOPS;

  if (innerTransaction) {
    operationCount = Array.isArray(innerTransaction.operations)
      ? innerTransaction.operations.length
      : 0;
    if (operationCount === 0) {
      sink.add(
        'EMPTY_OPERATIONS',
        'transaction.operations',
        'The base transaction has no operations.',
      );
    } else {
      const resourceFee = extractResourceFeeStroops(innerTransaction);
      const inclusionFee = readFeeStroops(innerTransaction) - resourceFee;
      const perOperation = Number(inclusionFee) / operationCount;
      // The bumped rate must be a whole number of stroops at least as high as the
      // inner inclusion rate, and never below the network floor.
      minimumBaseFee = Math.max(MIN_BASE_FEE_STROOPS, Math.ceil(perOperation));
    }

    if (innerTransaction.signatures.length === 0) {
      sink.add(
        'UNSIGNED_INNER_TRANSACTION',
        'transaction.signatures',
        'The base transaction is unsigned; it must still be signed by its own source account before submission.',
        'warning',
      );
    }
  }

  /* --- fee source --------------------------------------------------------- */

  let feeSourcePublicKey: string | undefined;
  let keypair: Keypair | undefined;
  const feeSource = options.feeSource;

  if (feeSource === null || feeSource === undefined) {
    sink.add(
      'MISSING_FEE_SOURCE',
      'feeSource',
      'A fee source (credentials or Keypair) is required.',
    );
  } else if (feeSource instanceof Keypair) {
    feeSourcePublicKey = feeSource.publicKey();
    keypair = feeSource;
  } else if (typeof feeSource === 'object') {
    const publicKey = typeof feeSource.publicKey === 'string' ? feeSource.publicKey.trim() : '';
    if (publicKey === '') {
      sink.add(
        'INVALID_FEE_SOURCE_PUBLIC_KEY',
        'feeSource.publicKey',
        'feeSource.publicKey is required.',
      );
    } else if (!isValidStellarPublicKey(publicKey)) {
      sink.add(
        'INVALID_FEE_SOURCE_PUBLIC_KEY',
        'feeSource.publicKey',
        'feeSource.publicKey must be a valid Stellar public key (G…).',
      );
    } else {
      feeSourcePublicKey = publicKey;
    }

    if (feeSource.secretKey !== undefined) {
      if (typeof feeSource.secretKey !== 'string' || feeSource.secretKey.trim() === '') {
        sink.add(
          'INVALID_FEE_SOURCE_SECRET_KEY',
          'feeSource.secretKey',
          'feeSource.secretKey must be a non-empty string.',
        );
      } else {
        let derived: Keypair | undefined;
        try {
          derived = Keypair.fromSecret(feeSource.secretKey.trim());
        } catch {
          sink.add(
            'INVALID_FEE_SOURCE_SECRET_KEY',
            'feeSource.secretKey',
            'feeSource.secretKey is not a valid Stellar secret seed (S…).',
          );
        }
        if (derived) {
          if (feeSourcePublicKey !== undefined && derived.publicKey() !== feeSourcePublicKey) {
            sink.add(
              'FEE_SOURCE_KEY_MISMATCH',
              'feeSource',
              'feeSource.secretKey does not belong to feeSource.publicKey.',
            );
          } else {
            feeSourcePublicKey = feeSourcePublicKey ?? derived.publicKey();
            keypair = derived;
          }
        }
      }
    }
  } else {
    sink.add(
      'INVALID_FEE_SOURCE',
      'feeSource',
      'feeSource must be a Keypair or a { publicKey, secretKey } object.',
    );
  }

  /* --- fee buffer --------------------------------------------------------- */

  const bufferRaw = options.feeBufferPercentage;
  let feeBufferPercentage = 0;
  if (bufferRaw !== undefined) {
    if (typeof bufferRaw !== 'number' || !Number.isFinite(bufferRaw) || bufferRaw < 0) {
      sink.add(
        'INVALID_FEE_BUFFER',
        'feeBufferPercentage',
        'feeBufferPercentage must be a non-negative finite number.',
      );
    } else {
      feeBufferPercentage = bufferRaw;
    }
  }

  /* --- base fee ----------------------------------------------------------- */

  let baseFee: number | null = null;
  if (options.baseFee === undefined) {
    baseFee = Math.max(minimumBaseFee, Math.ceil(minimumBaseFee * (1 + feeBufferPercentage / 100)));
  } else {
    const requested = parseStroops(options.baseFee);
    if (requested === null) {
      sink.add(
        'INVALID_BASE_FEE',
        'baseFee',
        'baseFee must be a non-negative integer number of stroops.',
      );
    } else {
      baseFee = requested;
      if (requested < MIN_BASE_FEE_STROOPS) {
        sink.add(
          'BASE_FEE_BELOW_MINIMUM',
          'baseFee',
          `baseFee ${requested} stroops is below the network minimum of ${MIN_BASE_FEE_STROOPS} stroops.`,
        );
      } else if (innerTransaction && operationCount > 0 && requested < minimumBaseFee) {
        sink.add(
          'BASE_FEE_BELOW_INNER',
          'baseFee',
          `baseFee ${requested} stroops is below the inner transaction's rate of ${minimumBaseFee} stroops per operation.`,
        );
      }
    }
  }

  /* --- total fee ceiling -------------------------------------------------- */

  if (baseFee !== null && operationCount > 0) {
    const resourceFee = innerTransaction ? extractResourceFeeStroops(innerTransaction) : 0n;
    const totalFee = BigInt(baseFee) * BigInt(operationCount + 1) + resourceFee;
    if (totalFee > BigInt(MAX_TOTAL_FEE_STROOPS)) {
      sink.add(
        'FEE_BID_TOO_HIGH',
        'fee',
        `Total fee bid of ${totalFee.toString()} stroops exceeds the safety ceiling of ${MAX_TOTAL_FEE_STROOPS} stroops.`,
      );
    }
  }

  const report = finalize(issues);
  if (
    !report.valid ||
    !innerTransaction ||
    !innerXdr ||
    !feeSourcePublicKey ||
    !networkPassphrase ||
    baseFee === null
  ) {
    return { report };
  }

  return {
    report,
    resolved: {
      innerTransaction,
      innerXdr,
      networkPassphrase,
      feeSourcePublicKey,
      keypair,
      operationCount,
      minimumBaseFee,
      baseFee,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Validate fee-bump parameters against Stellar protocol constraints without
 * building anything. Never throws — inspect the returned
 * {@link FeeBumpValidationReport}.
 *
 * @param options The fee-bump request to inspect.
 * @returns A structured report; `valid` is `false` when any error-severity issue was found.
 *
 * @example
 * ```ts
 * const report = validateFeeBumpParams({ transaction, feeSource, networkPassphrase });
 * if (!report.valid) console.error(report.errors);
 * ```
 */
export function validateFeeBumpParams(options: FeeBumpOptions): FeeBumpValidationReport {
  return analyzeFeeBump(options).report;
}

/**
 * Like {@link validateFeeBumpParams}, but throws a {@link FeeBumpValidationError}
 * (with the report attached) when the parameters are invalid. Returns the report
 * on success. Useful as a pre-submission gate.
 *
 * @param options The fee-bump request to inspect.
 * @returns The (valid) report.
 * @throws {FeeBumpValidationError} When any error-severity issue is found.
 */
export function assertValidFeeBumpParams(options: FeeBumpOptions): FeeBumpValidationReport {
  const report = validateFeeBumpParams(options);
  if (!report.valid) {
    throw new FeeBumpValidationError(report);
  }
  return report;
}

/**
 * Wrap a base transaction in a fee-bump envelope paid for by the given fee source.
 *
 * The base transaction may be a built `Transaction` or its base64 XDR. Fee bump
 * parameters are validated against Stellar protocol constraints first — the
 * network passphrase, the fee source keys, the base fee floor/ceiling and the
 * inner transaction's own fee rate — so a malformed request fails with a
 * structured {@link FeeBumpValidationError} instead of a raw `stellar-base`
 * error.
 *
 * When the fee source supplies credentials with a secret key (or a `Keypair`),
 * the envelope is signed locally; otherwise an unsigned envelope is returned for
 * out-of-band signing.
 *
 * @param options The base transaction, fee source, network and fee settings.
 * @returns The fee-bump envelope, its XDR and the resolved fee numbers.
 * @throws {FeeBumpValidationError} When the parameters fail validation.
 *
 * @example
 * ```ts
 * const { xdr } = bumpFee({
 *   transaction: innerTransaction,
 *   feeSource: { publicKey: sponsor.publicKey(), secretKey: sponsor.secret() },
 *   networkPassphrase: Networks.TESTNET,
 *   baseFee: 1000, // stroops per operation
 * });
 * ```
 */
export function bumpFee(options: FeeBumpOptions): FeeBumpResult {
  const { report, resolved } = analyzeFeeBump(options);
  if (!resolved) {
    throw new FeeBumpValidationError(report);
  }

  const { innerTransaction, innerXdr, networkPassphrase, feeSourcePublicKey, keypair, baseFee } =
    resolved;

  let transaction: FeeBumpTransaction;
  try {
    transaction = TransactionBuilder.buildFeeBumpTransaction(
      feeSourcePublicKey,
      String(baseFee),
      innerTransaction,
      networkPassphrase,
    );
  } catch (cause) {
    throw new ValidationError('Unable to build the fee-bump transaction.', {
      code: 'FEE_BUMP_BUILD_FAILED',
      cause,
    });
  }

  if (keypair) {
    transaction.sign(keypair);
  }

  return {
    transaction,
    xdr: transaction.toXDR(),
    innerXdr,
    feeSource: feeSourcePublicKey,
    signed: keypair !== undefined,
    fee: transaction.fee,
    baseFee: String(baseFee),
    innerFee: innerTransaction.fee,
    operationCount: resolved.operationCount,
    networkPassphrase,
  };
}

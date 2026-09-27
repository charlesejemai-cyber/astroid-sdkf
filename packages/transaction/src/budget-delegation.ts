/**
 * Transaction builder helpers for budget delegation operations.
 *
 * These utilities construct Stellar transactions for common AI-agent budget
 * workflows: delegating spending authority, authorizing asset transfers within
 * budget constraints, and encoding manage-data operations for policy enforcement.
 *
 * All builders validate inputs strictly before constructing the transaction,
 * surfacing structured {@link ValidationError} instances from `@astroid/errors`
 * rather than raw exceptions.
 *
 * ```ts
 * import { buildBudgetDelegationTransaction } from '@astroid/transaction';
 *
 * const tx = buildBudgetDelegationTransaction({
 *   source: account,
 *   networkPassphrase: Networks.TESTNET,
 *   budgetAuthority: 'G...BudgetAuthority',
 *   delegatee: 'G...AgentWallet',
 *   asset: 'USDC',
 *   amount: '1000',
 *   budgetId: 'budget_abc123',
 * });
 * ```
 *
 * @module
 */

import { Account, Memo, Networks, Operation, TransactionBuilder } from '@stellar/stellar-base';
import type { Transaction, xdr } from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

import {
  assertValidMemoText,
  assertValidPositiveAmount,
  assertValidStellarPublicKey,
  isValidStellarPublicKey,
  isValidPositiveAmount,
  isValidAssetIdentifier,
  assertValidAssetIdentifier,
} from './validate.js';
import { parseAsset } from './builder.js';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** Known Stellar network passphrases accepted by the builders. */
const KNOWN_PASSPHRASES = new Set<string>([
  Networks.PUBLIC,
  Networks.TESTNET,
  Networks.FUTURENET,
]);

/** Options common to every budget delegation transaction. */
export interface BudgetDelegationBaseOptions {
  /** The source account (with a current sequence number). */
  source: Account;
  /** Stellar network passphrase. */
  networkPassphrase: string;
  /** Base fee in stroops. Default `'100'`. */
  fee?: string | number;
  /** Time-bound validity window in seconds. Default 300. */
  timeout?: number;
  /** Optional text memo (max 28 bytes). */
  memoText?: string;
}

/**
 * Options for building a budget delegation transaction.
 *
 * Budget delegation authorizes a delegatee to spend up to `amount` of `asset`
 * on behalf of the budget authority, subject to the specified budget constraints.
 */
export interface BudgetDelegationOptions extends BudgetDelegationBaseOptions {
  /** Stellar address of the budget authority (the account granting delegation). */
  budgetAuthority: string;
  /** Stellar address of the delegatee (the agent receiving spending authority). */
  delegatee: string;
  /** Asset to delegate spending authority for (e.g. `'USDC'`, `'XLM'`). */
  asset: string;
  /** Maximum amount the delegatee is authorized to spend. */
  amount: string | number;
  /** Unique budget identifier for tracking and policy enforcement. */
  budgetId: string;
  /** Optional expiration timestamp (Unix seconds) for the delegation. */
  expirationTimestamp?: number;
}

/**
 * Options for building a budget-constrained payment transaction.
 *
 * This transaction type encodes the budget ID into a manage-data operation
 * so the backend can enforce budget constraints when processing the payment.
 */
export interface BudgetPaymentOptions extends BudgetDelegationBaseOptions {
  /** Destination Stellar account (`G...`). */
  destination: string;
  /** Asset to transfer. */
  asset: string;
  /** Amount to send. */
  amount: string | number;
  /** Budget ID to charge this payment against. */
  budgetId: string;
  /** Optional policy ID that governs this payment. */
  policyId?: string;
}

/**
 * Options for building an authorization revocation transaction.
 *
 * Revokes a previously granted budget delegation, preventing the delegatee
 * from making further spending against the budget.
 */
export interface BudgetRevocationOptions extends BudgetDelegationBaseOptions {
  /** Stellar address of the budget authority revoking delegation. */
  budgetAuthority: string;
  /** Stellar address of the delegatee whose delegation is being revoked. */
  delegatee: string;
  /** Budget ID whose delegation is being revoked. */
  budgetId: string;
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                            */
/* -------------------------------------------------------------------------- */

/** Throw a `ValidationError` unless `value` is a non-empty string. */
function requireField(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`Missing required field: ${field}.`, {
      code: 'MISSING_FIELD',
      details: { field },
    });
  }
}

/** Assert the network passphrase is valid. */
function assertPassphrase(networkPassphrase: string): void {
  requireField(networkPassphrase, 'networkPassphrase');
  if (!KNOWN_PASSPHRASES.has(networkPassphrase)) {
    throw new ValidationError('networkPassphrase must be a known Stellar passphrase.', {
      code: 'INVALID_NETWORK_PASSPHRASE',
    });
  }
}

/** Assert the budget ID is a non-empty string. */
function assertBudgetId(budgetId: string): void {
  requireField(budgetId, 'budgetId');
  if (budgetId.trim().length < 3) {
    throw new ValidationError('budgetId must be at least 3 characters.', {
      code: 'INVALID_BUDGET_ID',
      details: { field: 'budgetId' },
    });
  }
}

/** Shared construction of a `TransactionBuilder` primed with memo + timeout. */
function createBuilder(options: BudgetDelegationBaseOptions): TransactionBuilder {
  const { source, networkPassphrase } = options;
  if (!(source instanceof Account)) {
    throw new ValidationError('source must be a stellar-base Account instance.', {
      code: 'INVALID_SOURCE_ACCOUNT',
    });
  }
  assertPassphrase(networkPassphrase);

  const fee = options.fee ?? '100';
  const numericFee = typeof fee === 'number' ? fee : Number(fee);
  if (!Number.isFinite(numericFee) || numericFee < 0) {
    throw new ValidationError('fee must be a non-negative finite number of stroops.', {
      code: 'INVALID_FEE',
    });
  }

  let builder = new TransactionBuilder(source, {
    fee: String(fee),
    networkPassphrase,
  });
  if (options.memoText) {
    assertValidMemoText(options.memoText);
    builder = builder.addMemo(Memo.text(options.memoText));
  }
  builder = builder.setTimeout(options.timeout ?? 300);
  return builder;
}

/* -------------------------------------------------------------------------- */
/* Public builders                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Build a Stellar transaction that delegates budget authority to a delegatee.
 *
 * This creates a manage-data operation encoding the budget ID, amount limit,
 * and optional expiration, allowing the backend to enforce budget constraints
 * on the delegatee's transactions.
 *
 * @param options Build options including budget authority, delegatee, and constraints.
 * @returns An unsigned Stellar `Transaction`.
 * @throws {ValidationError} For invalid addresses, amounts, or budget parameters.
 *
 * @example
 * ```ts
 * const tx = buildBudgetDelegationTransaction({
 *   source: authorityAccount,
 *   networkPassphrase: Networks.TESTNET,
 *   budgetAuthority: 'G...Authority',
 *   delegatee: 'G...AgentWallet',
 *   asset: 'USDC',
 *   amount: '5000',
 *   budgetId: 'budget_daily_ops',
 *   memoText: 'delegate daily ops budget',
 * });
 * ```
 */
export function buildBudgetDelegationTransaction(
  options: BudgetDelegationOptions,
): Transaction {
  const { budgetAuthority, delegatee, asset, amount, budgetId, expirationTimestamp } = options;

  // Validate all inputs
  assertValidStellarPublicKey(budgetAuthority, 'budgetAuthority');
  assertValidStellarPublicKey(delegatee, 'delegatee');
  assertValidAssetIdentifier(asset);
  assertValidPositiveAmount(amount, 'amount');
  assertBudgetId(budgetId);

  if (expirationTimestamp !== undefined) {
    if (!Number.isFinite(expirationTimestamp) || expirationTimestamp <= 0) {
      throw new ValidationError('expirationTimestamp must be a positive finite Unix timestamp.', {
        code: 'INVALID_EXPIRATION',
        details: { field: 'expirationTimestamp' },
      });
    }
  }

  const parsedAsset = parseAsset(asset);
  const builder = createBuilder(options);

  // Manage data operation encodes delegation metadata
  const manageDataOps: xdr.Operation[] = [
    Operation.manageData({
      name: `budget_authority_${budgetId}`,
      value: Buffer.from(budgetAuthority.trim()),
    }),
    Operation.manageData({
      name: `budget_delegatee_${budgetId}`,
      value: Buffer.from(delegatee.trim()),
    }),
    Operation.manageData({
      name: `budget_asset_${budgetId}`,
      value: Buffer.from(parsedAsset.isNative() ? 'XLM' : parsedAsset.getCode()),
    }),
    Operation.manageData({
      name: `budget_amount_${budgetId}`,
      value: Buffer.from(String(amount)),
    }),
  ];

  if (expirationTimestamp !== undefined) {
    manageDataOps.push(
      Operation.manageData({
        name: `budget_expiration_${budgetId}`,
        value: Buffer.from(String(expirationTimestamp)),
      }),
    );
  }

  for (const op of manageDataOps) {
    builder.addOperation(op);
  }

  return builder.build();
}

/**
 * Build a budget-constrained payment transaction.
 *
 * This constructs a payment transaction with an additional manage-data
 * operation encoding the budget ID and optional policy ID. The backend
 * uses these to enforce budget limits and policy rules before submitting
 * the payment to the Stellar network.
 *
 * @param options Payment options including budget and policy constraints.
 * @returns An unsigned Stellar `Transaction`.
 * @throws {ValidationError} For invalid addresses, amounts, or budget parameters.
 *
 * @example
 * ```ts
 * const tx = buildBudgetPaymentTransaction({
 *   source: agentAccount,
 *   networkPassphrase: Networks.TESTNET,
 *   destination: 'G...Recipient',
 *   asset: 'USDC',
 *   amount: '25.50',
 *   budgetId: 'budget_research',
 *   policyId: 'policy_weekly_limit',
 *   memoText: 'research materials',
 * });
 * ```
 */
export function buildBudgetPaymentTransaction(
  options: BudgetPaymentOptions,
): Transaction {
  const { destination, asset, amount, budgetId, policyId } = options;

  // Validate inputs
  assertValidStellarPublicKey(destination, 'destination');
  assertValidAssetIdentifier(asset);
  assertValidPositiveAmount(amount, 'amount');
  assertBudgetId(budgetId);

  if (policyId !== undefined) {
    requireField(policyId, 'policyId');
  }

  const parsedAsset = parseAsset(asset);
  const builder = createBuilder(options);

  // Add the budget metadata as manage-data operations
  builder.addOperation(
    Operation.manageData({
      name: `budget_id`,
      value: Buffer.from(budgetId.trim()),
    }),
  );

  if (policyId) {
    builder.addOperation(
      Operation.manageData({
        name: `policy_id`,
        value: Buffer.from(policyId.trim()),
      }),
    );
  }

  // Add the actual payment operation
  builder.addOperation(
    Operation.payment({
      destination: destination.trim(),
      asset: parsedAsset,
      amount: String(amount),
    }),
  );

  return builder.build();
}

/**
 * Build a transaction that revokes budget delegation authority.
 *
 * This creates manage-data operations that clear the delegation entries
 * for a specific budget, preventing the delegatee from making further
 * spending against it.
 *
 * @param options Revocation options identifying the delegation to revoke.
 * @returns An unsigned Stellar `Transaction`.
 * @throws {ValidationError} For invalid addresses or budget parameters.
 *
 * @example
 * ```ts
 * const tx = buildBudgetRevocationTransaction({
 *   source: authorityAccount,
 *   networkPassphrase: Networks.TESTNET,
 *   budgetAuthority: 'G...Authority',
 *   delegatee: 'G...AgentWallet',
 *   budgetId: 'budget_daily_ops',
 * });
 * ```
 */
export function buildBudgetRevocationTransaction(
  options: BudgetRevocationOptions,
): Transaction {
  const { budgetAuthority, delegatee, budgetId } = options;

  // Validate inputs
  assertValidStellarPublicKey(budgetAuthority, 'budgetAuthority');
  assertValidStellarPublicKey(delegatee, 'delegatee');
  assertBudgetId(budgetId);

  const builder = createBuilder(options);

  // Clear the delegation entries by setting values to null
  builder.addOperation(
    Operation.manageData({
      name: `budget_authority_${budgetId}`,
      value: null,
    }),
  );
  builder.addOperation(
    Operation.manageData({
      name: `budget_delegatee_${budgetId}`,
      value: null,
    }),
  );
  builder.addOperation(
    Operation.manageData({
      name: `budget_asset_${budgetId}`,
      value: null,
    }),
  );
  builder.addOperation(
    Operation.manageData({
      name: `budget_amount_${budgetId}`,
      value: null,
    }),
  );
  builder.addOperation(
    Operation.manageData({
      name: `budget_expiration_${budgetId}`,
      value: null,
    }),
  );

  return builder.build();
}

/**
 * Validate budget delegation parameters without building a transaction.
 *
 * Returns a structured validation result instead of throwing, useful for
 * UI forms or pre-flight checks.
 *
 * @param options The delegation options to validate.
 * @returns `{ valid: true }` or `{ valid: false, errors: string[] }`.
 *
 * @example
 * ```ts
 * const result = validateBudgetDelegationParams({
 *   budgetAuthority: 'G...',
 *   delegatee: 'G...',
 *   asset: 'USDC',
 *   amount: '100',
 *   budgetId: 'budget_123',
 * });
 * if (!result.valid) {
 *   console.error(result.errors);
 * }
 * ```
 */
export function validateBudgetDelegationParams(
  options: Partial<BudgetDelegationOptions>,
): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  if (!options.budgetAuthority || !isValidStellarPublicKey(options.budgetAuthority)) {
    errors.push('budgetAuthority must be a valid Stellar public key.');
  }
  if (!options.delegatee || !isValidStellarPublicKey(options.delegatee)) {
    errors.push('delegatee must be a valid Stellar public key.');
  }
  if (!options.asset || !isValidAssetIdentifier(options.asset)) {
    errors.push('asset must be XLM, a bare asset code, or CODE:ISSUER.');
  }
  if (options.amount === undefined || !isValidPositiveAmount(options.amount)) {
    errors.push('amount must be a positive finite number.');
  }
  if (!options.budgetId || options.budgetId.trim().length < 3) {
    errors.push('budgetId must be at least 3 characters.');
  }
  if (
    options.expirationTimestamp !== undefined &&
    (!Number.isFinite(options.expirationTimestamp) || options.expirationTimestamp <= 0)
  ) {
    errors.push('expirationTimestamp must be a positive finite Unix timestamp.');
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

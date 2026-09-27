/**
 * Client-side policy pre-flight simulation engine.
 *
 * Before a Stellar transaction is submitted, agents can evaluate it against
 * their active policy rules locally — no network or blockchain interaction
 * required. The engine compares the proposed transaction (amount, asset,
 * destination account) against each applicable policy configuration and
 * reports the exact rule violations, if any.
 *
 * Failed simulations never throw: they return a structured
 * {@link PolicySimulationReport} describing which rules were breached.
 *
 * @module
 */

import type { Policy, PolicyType, PolicyViolation } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** A proposed transaction to evaluate against active policies. */
export interface SimulatedTransaction {
  /** Asset identifier: `XLM`, `USDC`, or `USDC:G...Issuer`. */
  asset: string;
  /** Amount to transfer (decimal string or number). */
  amount: number | string;
  /** Destination Stellar account (required for recipient rules). */
  recipientAddress?: string;
  /** Source Stellar account (optional; used for sender-scoped rules). */
  senderAddress?: string;
  /** Optional transaction memo. */
  memo?: string;
  /**
   * Amount already spent within the current budget window (day/week/month),
   * used by the daily/weekly/monthly limit evaluators.
   */
  spentInWindow?: number | string;
}

/** The outcome of evaluating a transaction against a set of policies. */
export interface PolicySimulationReport {
  /** Whether the transaction complies with all evaluated rules. */
  passed: boolean;
  /** Every rule violation found, in evaluation order. */
  violations: PolicyViolation[];
}

/** Signature of a single policy rule evaluator. */
type Evaluator = (policy: Policy, tx: SimulatedTransaction) => PolicyViolation | null;

/* -------------------------------------------------------------------------- */
/* Decimal-safe amount helpers                                                 */
/* -------------------------------------------------------------------------- */

/** Scale a decimal string/number to an integer using BigInt arithmetic. */
function toScaled(value: number | string, scale: number): bigint {
  const [intPart = '0', fracPart = ''] = String(value).split('.');
  const frac = fracPart.padEnd(scale, '0').slice(0, scale);
  return BigInt(intPart) * 10n ** BigInt(scale) + BigInt(frac || '0');
}

/** Compare two amounts (numbers or decimal strings). Returns -1, 0, or 1. */
function compareAmounts(a: number | string, b: number | string): -1 | 0 | 1 {
  const scale = 18; // 18 decimal places covers any monetary precision
  const aScaled = toScaled(a, scale);
  const bScaled = toScaled(b, scale);
  if (aScaled < bScaled) return -1;
  if (aScaled > bScaled) return 1;
  return 0;
}

/** Whether `a` is strictly greater than `b` (decimal-safe). */
function isGreaterThan(a: number | string, b: number | string): boolean {
  return compareAmounts(a, b) === 1;
}

/** Whether `a` is strictly less than `b` (decimal-safe). */
function isLessThan(a: number | string, b: number | string): boolean {
  return compareAmounts(a, b) === -1;
}

/** Sum of the spent window amount plus the transaction amount (decimal-safe). */
function sumSpend(spent: number | string | undefined, amount: number | string): string {
  const scale = 18;
  const spentScaled = spent === undefined ? 0n : toScaled(spent, scale);
  const amountScaled = toScaled(amount, scale);
  const total = spentScaled + amountScaled;
  const padded = total.toString().padStart(scale + 1, '0');
  const intPart = padded.slice(0, padded.length - scale) || '0';
  const fracPart = padded.slice(padded.length - scale).replace(/0+$/, '');
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

/* -------------------------------------------------------------------------- */
/* Asset / recipient matching helpers                                          */
/* -------------------------------------------------------------------------- */

/** The asset code portion of an asset identifier (`USDC:G...` -> `USDC`). */
function assetCode(asset: string): string {
  return asset.split(':')[0]?.trim().toUpperCase() ?? '';
}

/** Case-insensitive asset matching: by code, and by code+issuer when given. */
function assetMatches(configured: string, txAsset: string): boolean {
  const wanted = configured.trim();
  if (wanted.toUpperCase() === txAsset.trim().toUpperCase()) return true;
  return assetCode(wanted) === assetCode(txAsset);
}

/* -------------------------------------------------------------------------- */
/* Individual rule evaluators                                                  */
/* -------------------------------------------------------------------------- */

/** Build a `PolicyViolation` from a rule and breach details. */
function violation(
  policy: Policy,
  message: string,
  limit?: number | string,
  actual?: number | string,
): PolicyViolation {
  return {
    policyId: policy.id,
    policyName: policy.name,
    policyType: policy.type,
    message,
    ...(limit !== undefined ? { limit: Number(limit) } : {}),
    ...(actual !== undefined ? { actual: Number(actual) } : {}),
  };
}

/** Maximum transfer limit (`maxAmount`). */
function evaluateMaxAmount(policy: Policy, tx: SimulatedTransaction): PolicyViolation | null {
  const max = policy.configuration.maxAmount;
  if (max === undefined || !isGreaterThan(tx.amount, max)) return null;
  return violation(
    policy,
    `Transfer amount ${tx.amount} exceeds the maximum allowed limit of ${max} ${tx.asset}.`,
    max,
    tx.amount,
  );
}

/** Minimum transfer limit (`minAmount`). */
function evaluateMinAmount(policy: Policy, tx: SimulatedTransaction): PolicyViolation | null {
  const min = policy.configuration.minAmount;
  if (min === undefined || !isLessThan(tx.amount, min)) return null;
  return violation(
    policy,
    `Transfer amount ${tx.amount} is below the minimum allowed limit of ${min} ${tx.asset}.`,
    min,
    tx.amount,
  );
}

/** Daily spend limit (`dailyLimit`), combining prior window spend with the tx. */
function evaluateDailyLimit(policy: Policy, tx: SimulatedTransaction): PolicyViolation | null {
  const dailyLimit = policy.configuration.dailyLimit;
  if (dailyLimit === undefined) return null;
  const projected = sumSpend(tx.spentInWindow, tx.amount);
  if (!isGreaterThan(projected, dailyLimit)) return null;
  return violation(
    policy,
    `Transfer would push today's spend to ${projected}, exceeding the daily limit of ${dailyLimit} ${tx.asset}.`,
    dailyLimit,
    projected,
  );
}

/** Weekly spend limit (`weeklyLimit`). */
function evaluateWeeklyLimit(policy: Policy, tx: SimulatedTransaction): PolicyViolation | null {
  const weeklyLimit = policy.configuration.weeklyLimit;
  if (weeklyLimit === undefined) return null;
  const projected = sumSpend(tx.spentInWindow, tx.amount);
  if (!isGreaterThan(projected, weeklyLimit)) return null;
  return violation(
    policy,
    `Transfer would push this week's spend to ${projected}, exceeding the weekly limit of ${weeklyLimit} ${tx.asset}.`,
    weeklyLimit,
    projected,
  );
}

/** Monthly spend limit (`monthlyLimit`). */
function evaluateMonthlyLimit(policy: Policy, tx: SimulatedTransaction): PolicyViolation | null {
  const monthlyLimit = policy.configuration.monthlyLimit;
  if (monthlyLimit === undefined) return null;
  const projected = sumSpend(tx.spentInWindow, tx.amount);
  if (!isGreaterThan(projected, monthlyLimit)) return null;
  return violation(
    policy,
    `Transfer would push this month's spend to ${projected}, exceeding the monthly limit of ${monthlyLimit} ${tx.asset}.`,
    monthlyLimit,
    projected,
  );
}

/** Destination whitelist (`allowedRecipients`). */
function evaluateAllowedRecipients(
  policy: Policy,
  tx: SimulatedTransaction,
): PolicyViolation | null {
  const allowed = policy.configuration.allowedRecipients;
  if (!allowed || allowed.length === 0) return null;

  const destination = tx.recipientAddress;
  if (!destination) {
    return violation(
      policy,
      'A recipient address is required when an allowed-recipients policy applies.',
    );
  }
  if (allowed.includes(destination)) return null;
  return violation(policy, `Destination ${destination} is not in the allowed recipient list.`);
}

/** Destination blacklist (`blockedRecipients`). */
function evaluateBlockedRecipients(
  policy: Policy,
  tx: SimulatedTransaction,
): PolicyViolation | null {
  const blocked = policy.configuration.blockedRecipients;
  if (!blocked || blocked.length === 0) return null;

  const destination = tx.recipientAddress;
  if (destination && blocked.includes(destination)) {
    return violation(policy, `Destination ${destination} is blocked by policy.`);
  }
  return null;
}

/** Asset whitelist (`allowedAssets`). */
function evaluateAllowedAssets(policy: Policy, tx: SimulatedTransaction): PolicyViolation | null {
  const allowed = policy.configuration.allowedAssets;
  if (!allowed || allowed.length === 0) return null;

  if (allowed.some((entry) => assetMatches(entry, tx.asset))) return null;
  return violation(policy, `Asset ${tx.asset} is not in the allowed asset list.`);
}

/** Asset blacklist (`blockedAssets`). */
function evaluateBlockedAssets(policy: Policy, tx: SimulatedTransaction): PolicyViolation | null {
  const blocked = policy.configuration.blockedAssets;
  if (!blocked || blocked.length === 0) return null;

  if (blocked.some((entry) => assetMatches(entry, tx.asset))) {
    return violation(policy, `Asset ${tx.asset} is blocked by policy.`);
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Evaluator registry                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Maps a policy type to its evaluator. Adding a new rule type means adding an
 * evaluator function and registering it here — nothing else changes.
 */
const evaluators: Partial<Record<PolicyType, Evaluator>> = {
  MAX_AMOUNT: evaluateMaxAmount,
  MIN_AMOUNT: evaluateMinAmount,
  DAILY_BUDGET: evaluateDailyLimit,
  WEEKLY_BUDGET: evaluateWeeklyLimit,
  MONTHLY_BUDGET: evaluateMonthlyLimit,
  ALLOWED_RECIPIENTS: evaluateAllowedRecipients,
  BLOCKED_RECIPIENTS: evaluateBlockedRecipients,
  ALLOWED_ASSETS: evaluateAllowedAssets,
  BLOCKED_ASSETS: evaluateBlockedAssets,
};

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Evaluate a proposed transaction against a set of active policy rules.
 *
 * Every policy in `policies` is checked against its configured rule (the
 * evaluator is selected by `policy.type`). Disabled policies are skipped.
 * The function never throws for a failed simulation — it returns a
 * {@link PolicySimulationReport} describing each specific violation.
 *
 * @param policies Active policy rules to evaluate against.
 * @param tx       The proposed transaction payload.
 * @returns        A report with the overall `passed` flag and per-rule violations.
 */
export function simulatePolicy(
  policies: Policy[],
  tx: SimulatedTransaction,
): PolicySimulationReport {
  const violations: PolicyViolation[] = [];

  for (const policy of policies) {
    if (!policy.enabled) continue;

    const evaluator = evaluators[policy.type];
    if (!evaluator) continue; // unknown rule type: not enforceable client-side

    const result = evaluator(policy, tx);
    if (result) violations.push(result);
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

/* -------------------------------------------------------------------------- */
/* Decoded transaction types (for simulatePolicyLocal)                         */
/* -------------------------------------------------------------------------- */

export interface DecodedOperation {
  type: string;
  sourceAccount?: string;
  destination?: string;
  recipient?: string;
  asset?: string;
  amount?: string | number;
  [key: string]: unknown;
}

export interface DecodedTxPayload {
  sourceAccount?: string;
  operations: DecodedOperation[];
  memo?: string;
  fee?: string | number;
}

export interface LocalPolicySimulationResult {
  passed: boolean;
  violations: PolicyViolation[];
}

/**
 * Evaluate a decoded transaction payload against active policy rules.
 *
 * This is a convenience wrapper for use in agent pipelines where the
 * transaction has already been decoded into a structured payload.
 *
 * @param decodedTx The decoded transaction payload.
 * @param policies  Active policy rules to evaluate against.
 * @returns         A report with the overall `passed` flag and per-rule violations.
 */
export function simulatePolicyLocal(
  decodedTx: DecodedTxPayload,
  policies: Policy[],
): LocalPolicySimulationResult {
  const violations: PolicyViolation[] = [];

  if (!decodedTx || !Array.isArray(decodedTx.operations) || !Array.isArray(policies)) {
    return {
      passed: true,
      violations: [],
    };
  }

  for (const policy of policies) {
    if (!policy.enabled) continue;

    const config = policy.configuration || {};

    for (const op of decodedTx.operations) {
      const opAsset = op.asset || (config.asset as string | undefined);
      const opAmount =
        typeof op.amount === 'string'
          ? parseFloat(op.amount)
          : typeof op.amount === 'number'
            ? op.amount
            : 0;
      const opDest = op.destination || op.recipient || '';

      // 1. Asset Allowlist rule
      const allowedAssets =
        config.allowedAssets ||
        (policy.type === 'ALLOWED_ASSETS' && Array.isArray(config.assets)
          ? config.assets
          : undefined);
      if (Array.isArray(allowedAssets) && allowedAssets.length > 0) {
        if (opAsset && !allowedAssets.includes(opAsset)) {
          violations.push({
            policyId: policy.id,
            policyName: policy.name,
            policyType: policy.type,
            message: `Asset ${opAsset} is not in the allowed assets list [${allowedAssets.join(', ')}]`,
          });
        }
      }

      // 2. Blocked Assets rule
      const blockedAssets = config.blockedAssets;
      if (Array.isArray(blockedAssets) && blockedAssets.length > 0) {
        if (opAsset && blockedAssets.includes(opAsset)) {
          violations.push({
            policyId: policy.id,
            policyName: policy.name,
            policyType: policy.type,
            message: `Asset ${opAsset} is blocked by policy`,
          });
        }
      }

      // 3. Max Amount Limit rule
      const maxAmount =
        typeof config.maxAmount === 'number'
          ? config.maxAmount
          : typeof config.limit === 'number'
            ? config.limit
            : undefined;
      if (typeof maxAmount === 'number' && maxAmount > 0) {
        if (opAmount > maxAmount) {
          violations.push({
            policyId: policy.id,
            policyName: policy.name,
            policyType: policy.type,
            message: `Transfer amount ${opAmount} exceeds max limit of ${maxAmount}`,
            limit: maxAmount,
            actual: opAmount,
          });
        }
      }

      // 4. Destination Denylist rule
      const blockedRecipients =
        config.blockedRecipients ||
        config.destinationDenylist ||
        (policy.type === 'BLOCKED_RECIPIENTS' && Array.isArray(config.recipients)
          ? config.recipients
          : undefined);
      if (Array.isArray(blockedRecipients) && blockedRecipients.length > 0) {
        if (opDest && blockedRecipients.includes(opDest)) {
          violations.push({
            policyId: policy.id,
            policyName: policy.name,
            policyType: policy.type,
            message: `Destination address ${opDest} is blocked on denylist`,
          });
        }
      }

      // 5. Allowed Recipients rule (if specified)
      const allowedRecipients = config.allowedRecipients;
      if (Array.isArray(allowedRecipients) && allowedRecipients.length > 0) {
        if (opDest && !allowedRecipients.includes(opDest)) {
          violations.push({
            policyId: policy.id,
            policyName: policy.name,
            policyType: policy.type,
            message: `Destination address ${opDest} is not in allowed recipients list`,
          });
        }
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

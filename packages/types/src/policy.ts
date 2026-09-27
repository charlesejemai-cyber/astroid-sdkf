/**
 * Policy simulation and risk-assessment payloads.
 *
 * The canonical {@link Policy} entity lives in `./entities.ts` and the
 * {@link PolicyType} enum in `./enums.ts`; this module only adds the
 * simulation request/response shapes.
 */

import type { PolicyType } from './enums.js';

/** A single policy rule breach reported by a client-side simulation. */
export interface PolicyViolation {
  policyId: string;
  policyName: string;
  policyType: PolicyType;
  message: string;
  /** The configured limit that was breached, when applicable. */
  limit?: number | string;
  /** The actual value that breached the limit, when applicable. */
  actual?: number | string;
}

/**
 * A pre-flight policy simulation request.
 *
 * Combines the **transaction payload** to evaluate (`asset`, `amount`,
 * `recipientAddress`, …) with the **policy rules** it should be checked
 * against. When `policyIds` is omitted the server resolves every enabled policy
 * in scope for `walletId` / `agentId`; when it is supplied, only those rules are
 * evaluated. Nothing is committed — the endpoint is a pure dry-run.
 */
export interface PolicySimulationRequest {
  /** Wallet whose active policies apply. Mutually exclusive with `agentId`. */
  walletId?: string;
  /** Agent whose active policies apply. Mutually exclusive with `walletId`. */
  agentId?: string;
  /** Asset identifier: `XLM`, `USDC`, or `USDC:G...Issuer`. */
  asset: string;
  /** Amount to transfer (decimal string or number). */
  amount: string | number;
  /** Destination Stellar account, required by recipient rules. */
  recipientAddress?: string;
  /** Source Stellar account the spend is attributed to. */
  senderAddress?: string;
  /** Optional transaction memo. */
  memo?: string;
  /**
   * Amount already spent within the active budget window (day/week/month), used
   * by the rolling-limit rules. Decimal string or number.
   */
  spentInWindow?: string | number;
  /**
   * Restrict the evaluation to these policy rule ids. Defaults to every enabled
   * policy in scope for `walletId` / `agentId`.
   */
  policyIds?: string[];
  /** Arbitrary caller metadata, echoed back by the API. */
  metadata?: Record<string, unknown>;
}

export interface PolicyViolationDetail {
  policyId: string;
  policyType: PolicyType;
  message: string;
  limit?: number | string;
  actual?: number | string;
}

export interface PolicyRiskFactor {
  factor: string;
  score: number;
  description: string;
}

export interface PolicyRiskAssessment {
  score: number;
  band: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  factors: PolicyRiskFactor[];
}

export interface PolicyBudgetImpact {
  budgetId: string;
  beforeRemaining: string;
  afterRemaining: string;
}

/**
 * The outcome of a server-side policy simulation (`PolicyResource.simulatePolicy`).
 *
 * A blocked transaction is **not** an error: `allowed` is `false` and
 * `violations` explains exactly which rules were breached, so callers can
 * surface a precise message instead of catching an exception.
 */
export interface PolicySimulationResult {
  /** Whether the transaction complies with every evaluated rule. */
  allowed: boolean;
  /** The rule breaches that blocked the transaction (empty when `allowed`). */
  violations: PolicyViolationDetail[];
  /** Roles whose approval is required before the transaction may proceed. */
  requiredApprovals: string[];
  /** A 0..1 risk score and its contributing factors. */
  risk: PolicyRiskAssessment;
  /** How the transaction would move each affected budget. */
  budgetImpact: PolicyBudgetImpact[];
  /** Human-readable summary of the decision. */
  explanation: string;
}

export interface SimulatePolicyRequest {
  walletId?: string;
  asset: string;
  amount: string | number;
  recipientAddress?: string;
  spentInWindow?: string;
}

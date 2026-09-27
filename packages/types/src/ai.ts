/**
 * AI-native SDK types (PRD Doc 8 "AI-Native SDK", Doc 6 "Financial Intent Engine").
 *
 * Developers express a financial *intent* — not a low-level transfer — and the
 * backend orchestrates proposal -> policy -> risk -> transaction. These types
 * describe the request and the orchestrated result.
 */

import type { Proposal, Transaction } from './entities.js';
import type { PolicySimulationResult } from './policy.js';

/** A high-level financial intent submitted by an AI agent. */
export interface PaymentIntent {
  /** Natural-language purpose, e.g. "Purchase OpenAI credits". */
  intent: string;
  amount: number | string;
  asset: string;
  /** Optional explicit recipient; otherwise resolved by the backend. */
  recipientAddress?: string;
  agentId?: string;
  walletId?: string;
  budgetId?: string;
  /** Links the payment to a conversation/task for financial memory. */
  conversationId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
  /**
   * When true, only simulate (never create a transaction). Equivalent to
   * "AI Simulation Mode".
   */
  simulateOnly?: boolean;
}

/** The outcome of an orchestrated `ai.requestPayment` call. */
export const PaymentIntentOutcome = {
  EXECUTED: 'executed',
  PENDING_APPROVAL: 'pending_approval',
  SIMULATED: 'simulated',
  REJECTED: 'rejected',
} as const;
export type PaymentIntentOutcome = (typeof PaymentIntentOutcome)[keyof typeof PaymentIntentOutcome];

/**
 * The result of requesting a payment via an intent. Exactly which fields are
 * present depends on `outcome`:
 * - `executed` / `pending_approval`: `transaction` is set (and `proposal` when approval is required).
 * - `simulated`: `simulation` is set, `transaction` is undefined.
 * - `rejected`: `simulation` explains why.
 */
export interface PaymentIntentResult {
  outcome: PaymentIntentOutcome;
  transaction?: Transaction;
  proposal?: Proposal;
  simulation?: PolicySimulationResult;
  /** Human-readable explanation of the decision (explainability). */
  explanation: string;
}

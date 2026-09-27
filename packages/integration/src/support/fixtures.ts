/**
 * Shared entity factories and Stellar keypairs for the integration suite.
 *
 * Every factory returns a complete, type-checked entity. Building them from
 * the real DTOs (rather than ad-hoc object literals inside each test) is what
 * lets the suite assert that values crossing a package boundary keep the shape
 * that package promises: a `Policy` minted here is assignable to
 * `@astroid/policy`'s `PolicyDraft`, and a `Budget` to `@astroid/budget`'s
 * inputs, because they are the very same declarations.
 *
 * @module
 */

import { Account, Keypair, Networks } from '@stellar/stellar-base';
import {
  AgentStatus,
  BudgetPeriod,
  PolicyType,
  RiskBand,
  TransactionStatus,
  WalletStatus,
  WalletType,
  type Agent,
  type Budget,
  type BudgetSimulationResult,
  type BudgetUtilization,
  type Policy,
  type PolicySimulationResult,
  type Transaction,
  type Wallet,
} from '@astroid/types';

/** Fixed clock so snapshots are deterministic across runs. */
export const NOW = '2026-01-15T09:30:00.000Z';
export const WINDOW_START = '2026-01-15T00:00:00.000Z';
export const WINDOW_END = '2026-01-16T00:00:00.000Z';
export const ORGANIZATION_ID = 'org_astroid_1';

/** Deterministic-looking but genuinely valid keypairs, generated per call. */
export function newKeypair(): Keypair {
  return Keypair.random();
}

/**
 * A source account at a known sequence number.
 *
 * As of `@stellar/stellar-base` v15 the `Account` constructor takes the
 * account's **public key** plus a sequence number; passing a secret key throws
 * `accountId is invalid`. Nothing here signs — the builders only need an
 * account id to stamp onto the envelope.
 */
export function newSourceAccount(sequence = '1'): Account {
  return new Account(newKeypair().publicKey(), sequence);
}

export function agentFixture(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agt_1',
    organizationId: ORGANIZATION_ID,
    primaryWalletId: null,
    name: 'Treasury Rebalancer',
    description: 'Moves idle XLM into yield.',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    role: 'FINANCE',
    status: AgentStatus.ACTIVE,
    capabilities: ['transfer', 'swap'],
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

export function walletFixture(overrides: Partial<Wallet> = {}): Wallet {
  return {
    id: 'wal_1',
    organizationId: ORGANIZATION_ID,
    agentId: 'agt_1',
    stellarAddress: newKeypair().publicKey(),
    label: 'Operating wallet',
    walletType: WalletType.AGENT,
    network: 'TESTNET',
    status: WalletStatus.ACTIVE,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

export function policyFixture(overrides: Partial<Policy> = {}): Policy {
  return {
    id: 'pol_1',
    organizationId: ORGANIZATION_ID,
    agentId: 'agt_1',
    name: 'USDC spend cap',
    description: 'Caps daily USDC outflow for the rebalancer.',
    type: PolicyType.COMPOSITE,
    configuration: { maxAmount: 1000, allowedAssets: ['USDC'], dailyLimit: 500 },
    priority: 1,
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

export function budgetFixture(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'bdg_1',
    organizationId: ORGANIZATION_ID,
    parentBudgetId: null,
    agentId: 'agt_1',
    name: 'Daily USDC allowance',
    currency: 'USDC',
    limitAmount: '1000.00',
    spent: '0.00',
    remaining: '1000.00',
    period: BudgetPeriod.DAILY,
    periodStart: WINDOW_START,
    rollover: false,
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

export function budgetUtilizationFixture(overrides: Partial<BudgetUtilization> = {}): BudgetUtilization {
  return {
    budgetId: 'bdg_1',
    period: BudgetPeriod.DAILY,
    periodStart: WINDOW_START,
    periodEnd: WINDOW_END,
    limit: '1000.00',
    spent: '0.00',
    remaining: '1000.00',
    utilization: 0,
    percent: 0,
    state: 'healthy',
    ...overrides,
  };
}

export function budgetSimulationFixture(
  overrides: Partial<BudgetSimulationResult> = {},
): BudgetSimulationResult {
  return {
    budget: budgetFixture(),
    allowed: true,
    wouldExceed: false,
    remainingAfter: '1000.00',
    restriction: null,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    ...overrides,
  };
}

export function policySimulationFixture(
  overrides: Partial<PolicySimulationResult> = {},
): PolicySimulationResult {
  return {
    allowed: true,
    violations: [],
    requiredApprovals: [],
    risk: { score: 0.1, band: 'LOW', factors: [] },
    budgetImpact: [],
    explanation: 'Transaction complies with all evaluated rules.',
    ...overrides,
  };
}

export function transactionFixture(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'txn_1',
    organizationId: ORGANIZATION_ID,
    walletId: 'wal_1',
    agentId: 'agt_1',
    policyId: 'pol_1',
    budgetId: 'bdg_1',
    asset: 'USDC',
    amount: '250.00',
    senderAddress: newKeypair().publicKey(),
    recipientAddress: newKeypair().publicKey(),
    memo: 'invoice-42',
    purpose: 'invoice',
    status: TransactionStatus.PENDING,
    riskScore: 0.1,
    riskBand: RiskBand.LOW,
    requiresApproval: false,
    stellarHash: null,
    confirmationCount: 0,
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

export { Networks };

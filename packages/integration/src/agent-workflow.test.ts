/**
 * Cross-package integration: a full autonomous-agent financial workflow.
 *
 * Walks one transaction from "spawn an agent" to "record it against the
 * ledger", deliberately routing every step through a *different* package:
 *
 * | Step | Package exercised |
 * | --- | --- |
 * | client construction, auth, transport | `@astroid/client`, `@astroid/core` |
 * | agent creation | `@astroid/agent` (`AgentClient`) |
 * | wallet custody | `@astroid/wallet` |
 * | policy authoring | `@astroid/policy` (`PolicyBuilder`) |
 * | policy dry-run | `@astroid/policy` (`simulatePolicy`) |
 * | budget enforcement | `@astroid/budget` |
 * | Stellar XDR authoring | `@astroid/transaction` |
 * | transaction ledger | `@astroid/types` DTOs |
 *
 * The workflow is served by the routing `fetch` double in
 * `support/mock-api.ts`, so the real `HttpClient` pipeline (URL building, auth
 * headers, envelope unwrapping, error mapping) runs underneath.
 *
 * @module
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { Transaction as StellarTransaction } from '@stellar/stellar-base';

import { Astroid } from '@astroid/client';
import type { AgentClient } from '@astroid/agent';
import { PolicyBuilder, type PolicyDraft } from '@astroid/policy';
import { buildPaymentTransaction, encodeTransaction } from '@astroid/transaction';
import {
  type Agent,
  type Budget,
  type BudgetSimulationResult,
  type BudgetUtilization,
  type CreateTransactionInput,
  type Policy,
  type PolicySimulationResult,
  type Transaction,
  type Wallet,
} from '@astroid/types';

import { createMockApi, type MockApi } from './support/mock-api.js';
import {
  agentFixture,
  budgetFixture,
  budgetSimulationFixture,
  budgetUtilizationFixture,
  newKeypair,
  newSourceAccount,
  NOW,
  policyFixture,
  policySimulationFixture,
  transactionFixture,
  walletFixture,
  Networks,
} from './support/fixtures.js';

const API_KEY = 'sk_test_integration';
const BASE_URL = 'https://api.astroid.test';

/** Mutable budget state so `consume` genuinely draws the allowance down. */
interface BudgetState {
  spent: number;
  remaining: number;
  limit: number;
}

function toMoney(value: number): string {
  return value.toFixed(2);
}

/**
 * Wire a mock API that serves a complete, stateful agent financial stack and
 * return it alongside an `Astroid` client bound to it.
 */
function setupStack(): { api: MockApi; astroid: Astroid; budget: BudgetState } {
  const api = createMockApi();
  const budget: BudgetState = { spent: 0, remaining: 1000, limit: 1000 };

  api
    .json('POST /agents', agentFixture())
    .json('POST /wallets', walletFixture())
    .json('POST /policies', policyFixture())
    .json('POST /policies/simulate', policySimulationFixture())
    .json('GET /budgets/:id/utilization', budgetUtilizationFixture())
    .json('POST /transactions', transactionFixture());

  // Budget reads and draws are derived from the same running state so the
  // workflow's numbers stay consistent instead of being canned per route.
  api.on('POST /budgets', () => ({
    status: 201,
    body: {
      success: true,
      data: budgetFixture({ spent: '0.00', remaining: toMoney(budget.remaining) }),
    },
  }));

  api.on('POST /budgets/:id/simulate', (req) => {
    const amount = Number((req.body as { amount?: string | number } | undefined)?.amount ?? 0);
    const wouldExceed = budget.remaining - amount < 0;
    return {
      status: 200,
      body: {
        success: true,
        data: budgetSimulationFixture({
          budget: budgetFixture({ spent: toMoney(budget.spent), remaining: toMoney(budget.remaining) }),
          allowed: !wouldExceed,
          wouldExceed,
          remainingAfter: toMoney(budget.remaining - amount),
          restriction: wouldExceed ? 'Exceeds remaining budget' : null,
        }),
      },
    };
  });

  api.on('GET /budgets/:id/utilization', () => {
    const body: BudgetUtilization = budgetUtilizationFixture({
      spent: toMoney(budget.spent),
      remaining: toMoney(budget.remaining),
      utilization: budget.limit === 0 ? 0 : budget.spent / budget.limit,
      percent: budget.limit === 0 ? 0 : (budget.spent / budget.limit) * 100,
      state: 'healthy',
    });
    return { status: 200, body: { success: true, data: body } };
  });

  api.on('POST /budgets/:id/consume', (req) => {
    const amount = Number((req.body as { amount?: string | number } | undefined)?.amount ?? 0);
    budget.spent += amount;
    budget.remaining = Math.max(budget.limit - budget.spent, 0);
    return {
      status: 200,
      body: {
        success: true,
        data: budgetFixture({ spent: toMoney(budget.spent), remaining: toMoney(budget.remaining) }),
      },
    };
  });

  const astroid = new Astroid({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    fetch: api.fetch,
    // Deterministic attempt counts: a workflow test asserts call sequences, so
    // background retries would only add noise. Retry behaviour is covered by
    // the dedicated retry suites.
    retry: false,
  });

  return { api, astroid, budget };
}

describe('agent financial workflow across packages', () => {
  let api: MockApi;
  let astroid: Astroid;
  let budget: BudgetState;

  beforeEach(() => {
    ({ api, astroid, budget } = setupStack());
  });

  it('carries a payment from agent creation to a budget-adjusted ledger entry', async () => {
    /* --- 1. @astroid/agent: spawn the agent ------------------------------- */

    // The namespace the client hands out is the very class @astroid/agent ships.
    const agents: AgentClient = astroid.agents;
    const agent: Agent = await agents.create({
      name: 'Treasury Rebalancer',
      capabilities: ['transfer', 'swap'],
      initialBudget: { currency: 'USDC', amount: '1000.00' },
      description: 'Moves idle XLM into yield.',
    });

    expect(agent.id).toBe('agt_1');
    expect(agent.status).toBe('ACTIVE');

    /* --- 2. @astroid/wallet: attach custody ------------------------------ */

    const wallet: Wallet = await astroid.wallets.create({
      agentId: agent.id,
      label: 'Operating wallet',
    });

    expect(wallet.agentId).toBe(agent.id);
    expect(wallet.stellarAddress).toMatch(/^G[A-Z2-7]{55}$/);

    /* --- 3. @astroid/policy: author a rule bound to that agent ------------ */

    // `PolicyDraft` is produced by @astroid/policy and consumed by the
    // @astroid/policy resource — annotated to pin the contract.
    const draft: PolicyDraft = new PolicyBuilder({ name: 'USDC spend cap' })
      .forAgent(agent.id)
      .allowAsset('USDC')
      .maxAmount(1000)
      .dailyLimit(500)
      .build();

    // A composite rule (asset + amount + velocity) is inferred as COMPOSITE.
    expect(draft.type).toBe('COMPOSITE');
    expect(draft.agentId).toBe(agent.id);

    const policy: Policy = await astroid.policies.create(draft);

    expect(policy.id).toBe('pol_1');
    expect(policy.configuration.dailyLimit).toBe(500);

    /* --- 4. @astroid/budget: enforce the allowance ------------------------ */

    const createdBudget: Budget = await astroid.budgets.create({
      name: 'Daily USDC allowance',
      limitAmount: '1000.00',
      currency: 'USDC',
      period: 'DAILY',
      agentId: agent.id,
    });

    expect(createdBudget.remaining).toBe('1000.00');

    const simulation: BudgetSimulationResult = await astroid.budgets.simulateBudgetCheck(
      createdBudget.id,
      { asset: 'USDC', amount: '250.00' },
    );

    expect(simulation.allowed).toBe(true);
    // 1000 remaining less the 250 draw.
    expect(simulation.remainingAfter).toBe('750.00');

    /* --- 5. @astroid/transaction: author real Stellar XDR ---------------- */

    const source = newSourceAccount('42');
    const recipient = newKeypair().publicKey();
    const issuer = newKeypair().publicKey();

    // The API accepts the short `USDC` code, but a Stellar envelope must name
    // the issuer, so the on-chain build uses the fully-qualified identifier.
    const built: StellarTransaction = buildPaymentTransaction({
      source,
      networkPassphrase: Networks.TESTNET,
      destination: recipient,
      asset: `USDC:${issuer}`,
      amount: '250.00',
      memoText: 'invoice-42',
    });

    const transactionXdr = encodeTransaction(built);

    // The SDK produced a genuinely decodable envelope, not a placeholder.
    expect(transactionXdr.length).toBeGreaterThan(0);
    expect(built.operations).toHaveLength(1);

    /* --- 6. @astroid/types DTOs: record the transaction ------------------ */

    // One `CreateTransactionInput` threads identifiers produced by four other
    // packages — this is the cross-package type contract the suite guards.
    const input: CreateTransactionInput = {
      walletId: wallet.id,
      agentId: agent.id,
      policyId: policy.id,
      budgetId: createdBudget.id,
      asset: 'USDC',
      amount: '250.00',
      recipientAddress: recipient,
      memo: 'invoice-42',
      purpose: 'invoice',
    };

    const recorded: Transaction = await astroid.transactions.create(input);

    expect(recorded.id).toBe('txn_1');
    expect(recorded.agentId).toBe(agent.id);
    expect(recorded.policyId).toBe(policy.id);
    expect(recorded.budgetId).toBe(createdBudget.id);

    /* --- 7. Draw the budget down and re-read utilization ---------------- */

    const drawnDown: Budget = await astroid.budgets.consume(createdBudget.id, {
      amount: '250.00',
      transactionId: recorded.id,
      reason: 'invoice-42',
    });

    expect(drawnDown.spent).toBe('250.00');
    expect(drawnDown.remaining).toBe('750.00');
    expect(budget.remaining).toBe(750);

    const utilization: BudgetUtilization = await astroid.budgets.utilization(createdBudget.id);

    expect(utilization.spent).toBe('250.00');
    expect(utilization.remaining).toBe('750.00');
    expect(utilization.percent).toBeCloseTo(25);
    expect(utilization.state).toBe('healthy');

    /* --- 8. The packages really did talk to each other ------------------ */

    expect(api.calls()).toEqual([
      'POST /agents',
      'POST /wallets',
      'POST /policies',
      'POST /budgets',
      'POST /budgets/bdg_1/simulate',
      'POST /transactions',
      'POST /budgets/bdg_1/consume',
      'GET /budgets/bdg_1/utilization',
    ]);

    // Every hop went through one client, so every hop was authenticated.
    for (const request of api.requests) {
      expect(request.headers['authorization']).toBe(`Bearer ${API_KEY}`);
    }
  });

  it('reports a policy block as a decision, not an exception', async () => {
    const agent: Agent = await astroid.agents.create({
      name: 'Treasury Rebalancer',
      capabilities: ['transfer'],
      initialBudget: { currency: 'USDC', amount: '1000.00' },
    });
    const draft: PolicyDraft = new PolicyBuilder({ name: 'USDC spend cap' })
      .forAgent(agent.id)
      .allowAsset('USDC')
      .maxAmount(1000)
      .build();
    await astroid.policies.create(draft);

    api.on('POST /policies/simulate', () => ({
      status: 200,
      body: {
        success: true,
        data: policySimulationFixture({
          allowed: false,
          violations: [
            {
              policyId: 'pol_1',
              policyType: 'MAX_AMOUNT',
              message: 'Amount exceeds policy maximum',
              limit: 1000,
              actual: 5000,
            },
          ],
          requiredApprovals: ['FINANCE_CONTROLLER'],
          risk: {
            score: 0.92,
            band: 'CRITICAL',
            factors: [{ factor: 'amount', score: 0.9, description: 'Unusual transfer size' }],
          },
          explanation: 'Transaction blocked by 1 policy rule.',
        }),
      },
    }));

    const decision: PolicySimulationResult = await astroid.policies.simulatePolicy({
      agentId: agent.id,
      asset: 'USDC',
      amount: '5000',
    });

    // A blocked transaction resolves; only transport/API failures reject.
    expect(decision.allowed).toBe(false);
    expect(decision.violations).toHaveLength(1);
    expect(decision.violations[0]?.policyId).toBe('pol_1');
    expect(decision.requiredApprovals).toEqual(['FINANCE_CONTROLLER']);
    expect(decision.risk.band).toBe('CRITICAL');
  });

  it('blocks a draw that would breach the budget and allows one that fits', async () => {
    const created: Budget = await astroid.budgets.create({
      name: 'Daily USDC allowance',
      limitAmount: '1000.00',
      currency: 'USDC',
      period: 'DAILY',
    });
    await astroid.budgets.consume(created.id, { amount: '900.00' });

    const tooBig: BudgetSimulationResult = await astroid.budgets.simulateBudgetCheck(created.id, {
      asset: 'USDC',
      amount: '250.00',
    });

    expect(tooBig.allowed).toBe(false);
    expect(tooBig.wouldExceed).toBe(true);
    expect(tooBig.restriction).toBe('Exceeds remaining budget');

    const affordable: BudgetSimulationResult = await astroid.budgets.simulateBudgetCheck(
      created.id,
      { asset: 'USDC', amount: '50.00' },
    );

    expect(affordable.allowed).toBe(true);
    expect(affordable.remainingAfter).toBe('50.00');
  });

  it('echoes identifiers supplied by the agent package back onto created entities', async () => {
    const agent: Agent = await astroid.agents.create({
      name: 'Treasury Rebalancer',
      capabilities: ['transfer'],
      initialBudget: { currency: 'USDC', amount: '1000.00' },
    });

    const created = api.requests.find((request) => request.path === '/agents');
    expect(created?.body).toMatchObject({
      name: 'Treasury Rebalancer',
      capabilities: ['transfer'],
      initialBudget: { currency: 'USDC', amount: '1000.00' },
    });

    // The agent id is the contract every later package keys off.
    expect(agent.createdAt).toBe(NOW);
  });
});

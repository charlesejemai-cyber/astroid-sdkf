import { Resource } from '@astroid/core';
import type {
  Paginated,
  Policy,
  PolicySimulationRequest,
  PolicySimulationResult,
} from '@astroid/types';

import { simulatePolicy as evaluatePolicyRules } from './simulator.js';
import type { PolicySimulationReport, SimulatedTransaction } from './simulator.js';
import { simulatePolicy } from './simulate-policy.js';

/**
 * The client-side (offline) policy engine. `evaluatePolicyRules` is the pure
 * evaluator that takes a set of policy rules and a transaction payload and
 * returns a {@link PolicySimulationReport} — no network required.
 */
export { evaluatePolicyRules };

/**
 * Server-side policy simulation endpoint helper. Import `simulatePolicy` to run
 * a dry-run against the API without constructing a {@link PolicyResource}.
 */
export {
  simulatePolicy,
  POLICY_SIMULATE_PATH,
  type PolicySimulationHttpClient,
} from './simulate-policy.js';

/** Offline policy-engine types and helpers (see {@link evaluatePolicyRules}). */
export {
  simulatePolicyLocal,
  type SimulatedTransaction,
  type PolicySimulationReport,
  type DecodedOperation,
  type DecodedTxPayload,
  type LocalPolicySimulationResult,
} from './simulator.js';

/**
 * Policy DTOs re-exported from `@astroid/types` so consumers of
 * `@astroid/policy` can name the simulation request/response types without a
 * second import.
 */
export type {
  Policy,
  PolicySimulationRequest,
  PolicySimulationResult,
  PolicyViolation,
  PolicyViolationDetail,
  PolicyRiskAssessment,
  PolicyRiskFactor,
  PolicyBudgetImpact,
} from '@astroid/types';

/** Filters accepted by {@link PolicyResource.list}. */
export interface PolicyListParams {
  /** Only policies that are enabled (or disabled). */
  enabled?: boolean;
  /** Only policies of this type. */
  type?: string;
  /** Only policies scoped to this agent. */
  agentId?: string;
}

export class PolicyResource extends Resource {
  /**
   * Create a new spending policy.
   */
  async create(
    input: Omit<Policy, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>,
  ): Promise<Policy> {
    const res = await this.client.post<Policy>('/policies', input);
    return res.data;
  }

  /**
   * Retrieve a policy by ID.
   */
  async get(id: string): Promise<Policy> {
    return this.getData<Policy>(`/policies/${encodeURIComponent(id)}`);
  }

  /**
   * List policies with optional filtering.
   */
  async list(params: PolicyListParams = {}): Promise<Paginated<Policy>> {
    return this.listData<Policy>('/policies', { ...params });
  }

  /**
   * Update an existing policy.
   */
  async update(
    id: string,
    input: Partial<Omit<Policy, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Policy> {
    const res = await this.client.patch<Policy>(`/policies/${encodeURIComponent(id)}`, input);
    return res.data;
  }

  /**
   * Delete a policy.
   */
  async delete(id: string): Promise<void> {
    await this.client.delete<void>(`/policies/${encodeURIComponent(id)}`);
  }

  /**
   * Simulate a proposed transaction against the organization's policy rules on
   * the server, **without committing it**.
   *
   * The request combines the transaction payload (`asset`, `amount`,
   * `recipientAddress`, …) with the rules to evaluate: pass `policyIds` to check
   * specific policies, or `walletId` / `agentId` to evaluate every enabled policy
   * in scope. The endpoint returns a {@link PolicySimulationResult} describing
   * whether the transaction is allowed, which rules were breached, any required
   * approvals, the risk assessment and the budget impact.
   *
   * A blocked transaction is **not** an error — `allowed` is `false` and
   * `violations` lists the breaches. Only a transport/API failure rejects.
   *
   * @param input The transaction payload plus the policy rules to evaluate against.
   * @returns     The dry-run decision and its supporting detail.
   * @throws      `NetworkError` / typed API errors when the request itself fails.
   *
   * @example
   * ```ts
   * const result = await astroid.policies.simulatePolicy({
   *   walletId: 'w_1',
   *   asset: 'USDC',
   *   amount: '250',
   *   recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
   * });
   *
   * if (!result.allowed) {
   *   throw new Error(result.explanation);
   * }
   * ```
   */
  async simulatePolicy(input: PolicySimulationRequest): Promise<PolicySimulationResult> {
    return simulatePolicy(this.client, input);
  }

  /**
   * Perform a pre-flight server-side policy simulation.
   *
   * @deprecated Use {@link PolicyResource.simulatePolicy} instead; behaviour is
   * identical.
   */
  async simulate(input: PolicySimulationRequest): Promise<PolicySimulationResult> {
    return this.simulatePolicy(input);
  }

  /**
   * Pre-flight check a proposed transaction against an agent's configured
   * spending and security policies before execution.
   *
   * This is the high-level simulation wrapper: it fetches the active policies
   * for the given agent (or wallet), converts the proposed transaction into a
   * {@link SimulatedTransaction}, and evaluates it client-side with the local
   * policy engine (`evaluatePolicyRules`). The result tells the caller whether
   * the transaction may proceed and, if not, exactly which rules were breached —
   * all without spending network fees on a transaction that would be rejected.
   *
   * @param options.agentId     Agent whose policies apply (mutually exclusive with `walletId`).
   * @param options.walletId    Wallet whose policies apply (mutually exclusive with `agentId`).
   * @param options.transaction The proposed transaction to evaluate.
   * @returns                   A structured report with a `passed` flag and per-rule violations.
   * @throws                    If neither `agentId` nor `walletId` is provided.
   */
  async simulateTransaction(options: {
    agentId?: string;
    walletId?: string;
    transaction: SimulatedTransaction;
  }): Promise<PolicySimulationReport> {
    const { agentId, walletId, transaction } = options;

    if (!agentId && !walletId) {
      throw new Error(
        'simulateTransaction requires an `agentId` or `walletId` to scope the policy check.',
      );
    }

    const params: PolicyListParams & { walletId?: string } = { enabled: true };
    if (agentId) params.agentId = agentId;
    if (walletId) (params as { walletId?: string }).walletId = walletId;

    const { data: policies } = await this.list(params);

    return evaluatePolicyRules(policies, transaction);
  }
}

/** Alias of {@link PolicyResource} matching the `*sResource` client naming. */
export const PoliciesResource = PolicyResource;

export * from './simulator.js';
export * from './builder.js';

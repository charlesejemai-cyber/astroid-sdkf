/**
 * Server-side policy simulation endpoint helper.
 *
 * {@link simulatePolicy} performs a pre-flight dry-run of a proposed
 * transaction against an organization's active policy rules. It talks to the
 * `POST /policies/simulate` endpoint through a minimal injected transport, so it
 * can be used with an `@astroid/client` instance, a raw `HttpClient`, or a mock
 * in tests — without constructing a `PolicyResource`.
 *
 * A blocked transaction is not an error: the endpoint responds with an
 * `allowed: false` {@link PolicySimulationResult} describing the breached rules.
 *
 * @module
 */

import type { AstroidResponse } from '@astroid/core';
import type { PolicySimulationRequest, PolicySimulationResult } from '@astroid/types';

/** The path of the server-side policy simulation endpoint. */
export const POLICY_SIMULATE_PATH = '/policies/simulate';

/**
 * The minimal HTTP surface {@link simulatePolicy} needs.
 *
 * `@astroid/core`'s `HttpClient` satisfies this shape, which is what
 * `PolicyResource` passes in; tests can pass a lightweight mock.
 */
export interface PolicySimulationHttpClient {
  post<TData>(path: string, body?: unknown): Promise<AstroidResponse<TData>>;
}

/**
 * Simulate a proposed transaction against the organization's policy rules.
 *
 * The request combines the transaction payload (`asset`, `amount`,
 * `recipientAddress`, …) with the rules to evaluate: pass `policyIds` to check
 * specific policies, or `walletId` / `agentId` to evaluate every enabled policy
 * in scope. Nothing is committed — the endpoint is a pure dry-run.
 *
 * @param client The transport used to reach the API (an `HttpClient` satisfies it).
 * @param input  The transaction payload plus the policy rules to evaluate against.
 * @returns      The decision, the breached rules, required approvals, risk and
 *               budget impact. A rejection resolves normally with `allowed: false`.
 * @throws       `NetworkError` / typed API errors when the request itself fails.
 *
 * @example
 * ```ts
 * import { HttpClient } from '@astroid/core';
 * import { simulatePolicy } from '@astroid/policy';
 *
 * const http = new HttpClient({ apiKey: process.env.ASTROID_API_KEY! });
 *
 * const result = await simulatePolicy(http, {
 *   walletId: 'w_1',
 *   asset: 'USDC',
 *   amount: '250',
 *   recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
 * });
 *
 * if (!result.allowed) {
 *   for (const violation of result.violations) console.warn(violation.message);
 * }
 * ```
 */
export async function simulatePolicy(
  client: PolicySimulationHttpClient,
  input: PolicySimulationRequest,
): Promise<PolicySimulationResult> {
  const res = await client.post<PolicySimulationResult>(POLICY_SIMULATE_PATH, input);
  return res.data;
}

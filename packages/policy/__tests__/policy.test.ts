import { describe, expect, it, vi } from 'vitest';

import { HttpClient } from '@astroid/core';
import { NetworkError } from '@astroid/errors';
import type { Policy, PolicySimulationResult } from '@astroid/types';

import { PolicyResource } from '../src/index.js';

/** HTTP 200 response carrying an enveloped `data` payload. */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Build a `PolicyResource` backed by the given fetch mock. */
function client(
  fetchImpl: typeof fetch,
): { resource: PolicyResource; fetch: ReturnType<typeof vi.fn> } {
  const fetchMock = vi.fn(fetchImpl);
  const http = new HttpClient({
    apiKey: 'sk_test',
    baseUrl: 'https://api.example.test',
    retry: false,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { resource: new PolicyResource(http), fetch: fetchMock };
}

const POLICY: Policy = {
  id: 'pol_1',
  organizationId: 'org_1',
  name: 'Max 500 USDC',
  type: 'MAX_AMOUNT',
  configuration: { maxAmount: 500 },
  priority: 1,
  enabled: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const CREATE_INPUT = {
  name: 'Max 500 USDC',
  type: 'MAX_AMOUNT' as const,
  configuration: { maxAmount: 500 },
  priority: 1,
  enabled: true,
};

const SIM_RESULT: PolicySimulationResult = {
  allowed: true,
  violations: [],
  requiredApprovals: [],
  risk: { score: 0.05, band: 'LOW', factors: [] },
  budgetImpact: [],
  explanation: 'Transfer is within policy limits.',
};

describe('PolicyResource — CRUD with mocked API responses', () => {
  it('create POSTs the input to /policies and returns the policy', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: POLICY }));

    const created = await resource.create(CREATE_INPUT);

    expect(created).toEqual(POLICY);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/policies');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual(CREATE_INPUT);
  });

  it('get fetches a single policy by id', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: POLICY }));

    const policy = await resource.get('pol_1');

    expect(policy).toEqual(POLICY);
    expect(String(fetch.mock.calls[0]![0])).toContain('/policies/pol_1');
  });

  it('list returns a paginated set of policies', async () => {
    const { resource } = client(async () =>
      jsonResponse({
        data: [POLICY],
        meta: { page: 1, limit: 1, total: 1, totalPages: 1 },
      }),
    );

    const result = await resource.list({ enabled: true });

    expect(result.data).toEqual([POLICY]);
    expect(result.meta?.total).toBe(1);
  });

  it('update PATCHes the policy and returns the updated record', async () => {
    const { resource, fetch } = client(async () =>
      jsonResponse({ data: { ...POLICY, enabled: false } }),
    );

    const updated = await resource.update('pol_1', { enabled: false });

    expect(updated.enabled).toBe(false);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/policies/pol_1');
    expect((init as RequestInit).method).toBe('PATCH');
  });

  it('delete issues a DELETE and resolves to void', async () => {
    const { resource, fetch } = client(async () => new Response(null, { status: 204 }));

    await expect(resource.delete('pol_1')).resolves.toBeUndefined();
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/policies/pol_1');
    expect((init as RequestInit).method).toBe('DELETE');
  });
});

describe('PolicyResource — pre-flight simulation and dry-run helper', () => {
  it('simulate POSTs the request payload and returns the result', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: SIM_RESULT }));

    const input = {
      walletId: 'w_1',
      asset: 'USDC',
      amount: '150',
      recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
    };

    const result = await resource.simulate(input);

    expect(result).toEqual(SIM_RESULT);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/policies/simulate');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual(input);
  });

  it('simulatePolicy performs dry-run check against active spending policies', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: SIM_RESULT }));

    const input = {
      walletId: 'w_1',
      asset: 'USDC',
      amount: '100',
      recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
    };

    const result = await resource.simulatePolicy(input);

    expect(result).toEqual(SIM_RESULT);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/policies/simulate');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual(input);
  });

  it('simulatePolicy serializes the full transaction payload and policy-rule selectors', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: SIM_RESULT }));

    const input = {
      agentId: 'ag_1',
      asset: 'XLM',
      amount: 10,
      recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
      senderAddress: 'GSOURCE',
      memo: 'payout',
      spentInWindow: '40',
      policyIds: ['pol_1', 'pol_2'],
    };

    const result = await resource.simulatePolicy(input);

    expect(result).toEqual(SIM_RESULT);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/policies/simulate');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual(input);
  });

  it('simulate is a backwards-compatible alias of simulatePolicy', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: SIM_RESULT }));

    const result = await resource.simulate({ walletId: 'w_1', asset: 'USDC', amount: '50' });

    expect(result).toEqual(SIM_RESULT);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/policies/simulate');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('simulate returns a rejected result with the breached violations', async () => {
    const rejected: PolicySimulationResult = {
      allowed: false,
      violations: [
        {
          policyId: 'pol_1',
          policyType: 'MAX_AMOUNT',
          message: 'Transfer amount 750 exceeds the maximum allowed limit of 500 USDC.',
          limit: 500,
          actual: 750,
        },
      ],
      requiredApprovals: ['owner'],
      risk: { score: 0.82, band: 'HIGH', factors: [] },
      budgetImpact: [],
      explanation: 'Transfer is blocked by 1 active policy.',
    };
    const { resource, fetch } = client(async () => jsonResponse({ data: rejected }));

    const input = {
      walletId: 'w_1',
      asset: 'USDC',
      amount: '750',
      recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
    };
    const result = await resource.simulatePolicy(input);

    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      policyId: 'pol_1',
      policyType: 'MAX_AMOUNT',
      limit: 500,
      actual: 750,
    });
    expect(result.requiredApprovals).toContain('owner');
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/policies/simulate');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual(input);
  });

  it('propagates network failures as a structured NetworkError', async () => {
    const { resource } = client(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(resource.simulate({ walletId: 'w_1', asset: 'XLM', amount: '1' })).rejects.toBeInstanceOf(
      NetworkError,
    );
  });
});

describe('PolicyResource — simulateTransaction wrapper (list + local evaluate)', () => {
  const BLOCKING_POLICY: Policy = {
    ...POLICY,
    id: 'pol_max',
    name: 'Max 500 USDC',
    type: 'MAX_AMOUNT',
    configuration: { maxAmount: 500 },
  };

  it('throws when neither agentId nor walletId is provided', async () => {
    const { resource } = client(async () => jsonResponse({ data: [] }));

    await expect(
      resource.simulateTransaction({ transaction: { asset: 'XLM', amount: '1' } }),
    ).rejects.toThrow('agentId` or `walletId`');
  });

  it('fetches active policies for the wallet and evaluates locally (allowed)', async () => {
    const { resource, fetch } = client(async () =>
      jsonResponse({ data: [BLOCKING_POLICY], meta: { page: 1, limit: 10, total: 1, totalPages: 1 } }),
    );

    const report = await resource.simulateTransaction({
      walletId: 'w_1',
      transaction: { asset: 'USDC', amount: '150' },
    });

    expect(report.passed).toBe(true);
    expect(report.violations).toEqual([]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/policies');
    expect(String(url)).toContain('enabled=true');
    expect(String(url)).toContain('walletId=w_1');
  });

  it('blocks a transaction that breaches a fetched max-amount policy', async () => {
    const { resource, fetch } = client(async () =>
      jsonResponse({ data: [BLOCKING_POLICY], meta: { page: 1, limit: 10, total: 1, totalPages: 1 } }),
    );

    const report = await resource.simulateTransaction({
      walletId: 'w_1',
      transaction: { asset: 'USDC', amount: '750.50' },
    });

    expect(report.passed).toBe(false);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toMatchObject({
      policyId: 'pol_max',
      policyType: 'MAX_AMOUNT',
      limit: 500,
      actual: 750.5,
    });
    expect(report.violations[0].message).toContain('exceeds the maximum');
  });

  it('skips disabled policies during the local evaluation', async () => {
    const { resource, fetch } = client(async () =>
      jsonResponse({
        data: [{ ...BLOCKING_POLICY, enabled: false }],
        meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
      }),
    );

    const report = await resource.simulateTransaction({
      walletId: 'w_1',
      transaction: { asset: 'USDC', amount: '9999' },
    });

    expect(report.passed).toBe(true);
    expect(fetch.mock.calls).toHaveLength(1);
  });

  it('scopes by agentId when given instead of walletId', async () => {
    const { resource, fetch } = client(async () =>
      jsonResponse({ data: [], meta: { page: 1, limit: 10, total: 0, totalPages: 0 } }),
    );

    const report = await resource.simulateTransaction({
      agentId: 'ag_1',
      transaction: { asset: 'XLM', amount: '5' },
    });

    expect(report.passed).toBe(true);
    const url = String(fetch.mock.calls[0]![0]);
    expect(url).toContain('agentId=ag_1');
    expect(url).not.toContain('walletId');
  });
});

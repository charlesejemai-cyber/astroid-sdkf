/**
 * Cross-package integration: error propagation across the client/resource boundary.
 *
 * Every SDK resource funnels failures through `HttpClient`, which maps wire
 * envelopes onto the typed errors in `@astroid/errors`. Individual packages
 * test their own mapping; this suite verifies the property that matters at the
 * seams — a caller holding a client from `@astroid/client` can `catch` an error
 * and branch on the *same* class identity that `@astroid/errors` exports, even
 * though the failure originated several packages away, and that client-side
 * guards fail before any request is made.
 *
 * @module
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-base';

import { Astroid } from '@astroid/client';
import { AstroidValidationError, type AgentClient } from '@astroid/agent';
import { PolicyBuilder } from '@astroid/policy';
import { buildPaymentTransaction } from '@astroid/transaction';
import {
  AuthenticationError,
  BudgetExceededError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  PolicyViolationError,
  RateLimitError,
  ValidationError,
  type AstroidError,
} from '@astroid/errors';

import { createMockApi, type MockApi } from './support/mock-api.js';
import { agentFixture, newSourceAccount, Networks } from './support/fixtures.js';

let api: MockApi;
let astroid: Astroid;

beforeEach(() => {
  api = createMockApi();
  astroid = new Astroid({
    apiKey: 'sk_test_integration',
    baseUrl: 'https://api.astroid.test',
    fetch: api.fetch,
    retry: false,
  });
});

/** Narrow an unknown catch binding to the SDK error hierarchy. */
function asAstroidError(error: unknown): AstroidError {
  expect(error).toBeInstanceOf(Error);
  return error as AstroidError;
}

describe('server-side errors reach the caller as the exact SDK class', () => {
  it('maps 401 AUTHENTICATION_ERROR to AuthenticationError', async () => {
    api.fail('GET /agents/agt_1', 401, 'AUTHENTICATION_ERROR', 'API key rejected');

    await expect(astroid.agents.get('agt_1')).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('maps 404 NOT_FOUND to NotFoundError and keeps the id from the URL', async () => {
    api.fail('GET /agents/agt_missing', 404, 'NOT_FOUND', 'Agent not found');

    const error = asAstroidError(
      await astroid.agents.get('agt_missing').catch((err: unknown) => err),
    );

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.status).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.isRetryable).toBe(false);
  });

  it('maps a policy rejection to PolicyViolationError with its details intact', async () => {
    api.fail('POST /transactions', 422, 'POLICY_VIOLATION', 'Blocked by spend policy', {
      details: { policyId: 'pol_1', rule: 'MAX_AMOUNT' },
    });

    const error = asAstroidError(
      await astroid.transactions
        .create({
          walletId: 'wal_1',
          asset: 'USDC',
          amount: '5000',
          recipientAddress: Keypair.random().publicKey(),
        })
        .catch((err: unknown) => err),
    );

    expect(error).toBeInstanceOf(PolicyViolationError);
    expect(error.status).toBe(422);
    // `details` is the mechanism by which a server explains *which* rule fired;
    // it must survive the resource boundary intact.
    expect(error.details).toMatchObject({ policyId: 'pol_1', rule: 'MAX_AMOUNT' });
  });

  it('maps BUDGET_EXCEEDED to BudgetExceededError', async () => {
    api.fail('POST /budgets/bdg_1/consume', 422, 'BUDGET_EXCEEDED', 'Daily cap reached');

    await expect(
      astroid.budgets.consume('bdg_1', { amount: '10.00' }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('maps 409 CONFLICT to ConflictError', async () => {
    api.fail('POST /agents', 409, 'CONFLICT', 'An agent with that name already exists');

    const error = asAstroidError(
      await astroid.agents
        .create({ name: 'dupe', capabilities: ['a'], initialBudget: { currency: 'XLM', amount: '1' } })
        .catch((err: unknown) => err),
    );

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.status).toBe(409);
  });

  it('maps 429 RATE_LIMITED to RateLimitError and marks it retryable', async () => {
    api.fail('GET /agents/agt_1', 429, 'RATE_LIMITED', 'Slow down');

    const error = asAstroidError(
      await astroid.agents.get('agt_1').catch((err: unknown) => err),
    );

    expect(error).toBeInstanceOf(RateLimitError);
    // Retrying a rate limit is meaningful, so the flag must say so.
    expect(error.isRetryable).toBe(true);
  });

  it('maps 500 to InternalServerError and marks it retryable', async () => {
    api.fail('GET /agents/agt_1', 500, 'INTERNAL_ERROR', 'Upstream exploded');

    const error = asAstroidError(
      await astroid.agents.get('agt_1').catch((err: unknown) => err),
    );

    expect(error).toBeInstanceOf(InternalServerError);
    expect(error.isRetryable).toBe(true);
  });

  it('maps 400 VALIDATION_ERROR to ValidationError', async () => {
    api.fail('POST /policies', 400, 'VALIDATION_ERROR', 'configuration.maxAmount must be positive');

    const draft = new PolicyBuilder({ name: 'cap' }).allowAsset('USDC').maxAmount(100).build();

    await expect(astroid.policies.create(draft)).rejects.toBeInstanceOf(ValidationError);
  });

  it('preserves the requestId so a failure can be correlated with server logs', async () => {
    api.on('GET /agents/agt_1', () => ({
      status: 404,
      body: { success: false, error: { code: 'NOT_FOUND', message: 'Agent not found' } },
      headers: { 'x-request-id': 'req_header_42' },
    }));

    const error = asAstroidError(
      await astroid.agents.get('agt_1').catch((err: unknown) => err),
    );

    expect(error.requestId).toBe('req_header_42');
  });

  it('serialises the mapped error without leaking internals', async () => {
    api.fail('GET /agents/agt_1', 404, 'NOT_FOUND', 'Agent not found');

    const error = asAstroidError(
      await astroid.agents.get('agt_1').catch((err: unknown) => err),
    );
    const json = error.toJSON();

    expect(json).toMatchObject({ name: 'NotFoundError', code: 'NOT_FOUND', status: 404 });
    expect(json).not.toHaveProperty('cause');
  });
});

describe('client-side guards fail before crossing the network', () => {
  it('rejects an invalid agent payload without issuing a request', async () => {
    api.json('POST /agents', agentFixture());

    // The @astroid/agent guard runs ahead of transport, so the caller's own
    // mistake never costs a round trip.
    await expect(
      astroid.agents.create({
        name: '   ',
        capabilities: ['transfer'],
        initialBudget: { currency: 'USDC', amount: '10' },
      }),
    ).rejects.toBeInstanceOf(AstroidValidationError);

    expect(api.requests).toHaveLength(0);
  });

  it('rejects an agent payload with no capabilities without issuing a request', async () => {
    await expect(
      astroid.agents.create({
        name: 'Valid name',
        capabilities: [],
        initialBudget: { currency: 'USDC', amount: '10' },
      }),
    ).rejects.toBeInstanceOf(AstroidValidationError);

    expect(api.requests).toHaveLength(0);
  });

  it('rejects a malformed policy address with a ValidationError', () => {
    expect(() => new PolicyBuilder({ name: 'cap' }).allowDestination('not-a-stellar-key')).toThrow(
      ValidationError,
    );
  });

  it('rejects a payment to an invalid destination with a ValidationError', () => {
    expect(() =>
      buildPaymentTransaction({
        source: newSourceAccount('1'),
        networkPassphrase: Networks.TESTNET,
        destination: 'NOT_A_KEY',
        asset: 'USDC',
        amount: '1.00',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects a non-positive payment amount with a ValidationError', () => {
    expect(() =>
      buildPaymentTransaction({
        source: newSourceAccount('1'),
        networkPassphrase: Networks.TESTNET,
        destination: Keypair.random().publicKey(),
        asset: 'USDC',
        amount: '0',
      }),
    ).toThrow(ValidationError);
  });
});

describe('errors keep one class identity across the package graph', () => {
  it('lets a caller catch the class @astroid/errors exports, not a duplicate', async () => {
    api.fail('GET /agents/agt_1', 404, 'NOT_FOUND', 'Agent not found');

    // `@astroid/agent` resource -> `@astroid/core` HttpClient -> `@astroid/errors`
    // must all agree on one class. A duplicated module instance would break this.
    const agents: AgentClient = astroid.agents;
    const error = await agents.get('agt_1').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toBeInstanceOf(Error);
    expect((error as NotFoundError).name).toBe('NotFoundError');
  });

  it('surfaces a transport failure as a NetworkError after exhausting retries', async () => {
    const retrying = new Astroid({
      apiKey: 'sk_test_integration',
      baseUrl: 'https://api.astroid.test',
      fetch: (() => {
        throw new TypeError('connect ECONNREFUSED');
      }) as unknown as typeof fetch,
      retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 },
    });

    const error = asAstroidError(
      await retrying.agents.get('agt_1').catch((err: unknown) => err),
    );

    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.isRetryable).toBe(true);
  });
});

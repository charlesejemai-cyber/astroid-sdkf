import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '@astroid/types';

import { AgentClient } from '../client.js';
import { AgentResource } from '../index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal HTTP-client mock that satisfies the Resource constructor. */
function createClientMock() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
}

/** Construct a minimal but structurally valid Agent fixture. */
function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agt_1',
    organizationId: 'org_1',
    name: 'Test Agent',
    role: 'OPERATIONS',
    status: 'ACTIVE',
    capabilities: ['trade', 'transfer'],
    metadata: {},
    createdAt: '2026-08-29T10:00:00.000Z',
    updatedAt: '2026-08-29T10:00:00.000Z',
    ...overrides,
  };
}

/** Wrap a data payload as an HTTP response shape the Resource layer expects. */
function httpOk<T>(data: T) {
  return { data, requestId: undefined, status: 200, headers: new Headers() };
}

/** Minimal valid CreateAgentParams payload. */
const CREATE_PARAMS = {
  name: 'NewBot',
  capabilities: ['trade'] as string[],
  initialBudget: { currency: 'USDC', amount: '500' },
};

// ---------------------------------------------------------------------------
// AgentClient alias
// ---------------------------------------------------------------------------

describe('AgentClient (alias of AgentResource)', () => {
  it('is the same class as AgentResource', () => {
    expect(AgentClient).toBe(AgentResource);
  });
});

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

describe('AgentResource CRUD', () => {
  let http: ReturnType<typeof createClientMock>;
  let resource: AgentResource;

  beforeEach(() => {
    http = createClientMock();
    resource = new AgentResource(http as never);
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create()', () => {
    it('POSTs to /agents with the supplied params and returns the created agent', async () => {
      const agent = makeAgent({ name: 'NewBot' });
      http.post.mockResolvedValue(httpOk(agent));

      const result = await resource.create(CREATE_PARAMS);

      expect(result).toEqual(agent);
      expect(http.post).toHaveBeenCalledOnce();
      expect(http.post).toHaveBeenCalledWith('/agents', CREATE_PARAMS);
    });

    it('forwards optional fields (description, role, provider, model, metadata)', async () => {
      const agent = makeAgent({ name: 'FullBot' });
      http.post.mockResolvedValue(httpOk(agent));

      const params = {
        ...CREATE_PARAMS,
        name: 'FullBot',
        description: 'A fully-configured agent',
        role: 'OPERATIONS' as const,
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        metadata: { team: 'finance' },
      };

      await resource.create(params);

      expect(http.post).toHaveBeenCalledWith('/agents', params);
    });

    it('throws AstroidValidationError when required fields are missing', async () => {
      const { AstroidValidationError } = await import('../errors.js');

      await expect(
        resource.create({ name: '', capabilities: [], initialBudget: { currency: '', amount: '' } }),
      ).rejects.toBeInstanceOf(AstroidValidationError);

      // Client should not have been called — validation is pre-flight
      expect(http.post).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  describe('get()', () => {
    it('GETs /agents/:id and returns the agent', async () => {
      const agent = makeAgent({ id: 'agt_42' });
      http.get.mockResolvedValue(httpOk(agent));

      const result = await resource.get('agt_42');

      expect(result).toEqual(agent);
      expect(http.get).toHaveBeenCalledWith('/agents/agt_42', {});
    });

    it('percent-encodes slashes in the agent id', async () => {
      http.get.mockResolvedValue(httpOk(makeAgent()));

      await resource.get('agt/special');

      expect(http.get).toHaveBeenCalledWith('/agents/agt%2Fspecial', {});
    });
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list()', () => {
    it('GETs /agents and returns a paginated result', async () => {
      const agents = [makeAgent({ id: 'agt_1' }), makeAgent({ id: 'agt_2' })];
      http.get.mockResolvedValue(httpOk(agents));

      const result = await resource.list();

      expect(result.data).toEqual(agents);
      // The resource passes an empty query object when no filters are supplied
      expect(http.get).toHaveBeenCalledWith('/agents', { query: {} });
    });

    it('forwards status and role filters as query parameters', async () => {
      http.get.mockResolvedValue(httpOk([]));

      await resource.list({ status: 'ACTIVE', role: 'OPERATIONS', page: 2, limit: 10 });

      expect(http.get).toHaveBeenCalledWith('/agents', {
        query: { status: 'ACTIVE', role: 'OPERATIONS', page: 2, limit: 10 },
      });
    });

    it('returns pagination metadata from the response envelope', async () => {
      http.get.mockResolvedValue({
        data: [makeAgent()],
        meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
        status: 200,
        headers: new Headers(),
      });

      const result = await resource.list();

      expect(result.meta?.total).toBe(1);
      expect(result.meta?.page).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe('update()', () => {
    it('PATCHes /agents/:id with the update payload and returns the updated agent', async () => {
      const updated = makeAgent({ name: 'RenamedBot', status: 'SUSPENDED' });
      http.patch.mockResolvedValue(httpOk(updated));

      const result = await resource.update('agt_1', { name: 'RenamedBot', status: 'SUSPENDED' });

      expect(result).toEqual(updated);
      expect(http.patch).toHaveBeenCalledWith('/agents/agt_1', {
        name: 'RenamedBot',
        status: 'SUSPENDED',
      });
    });

    it('percent-encodes slashes in the agent id for PATCH', async () => {
      http.patch.mockResolvedValue(httpOk(makeAgent()));

      await resource.update('agt/special', { name: 'X' });

      expect(http.patch).toHaveBeenCalledWith('/agents/agt%2Fspecial', { name: 'X' });
    });

    it('accepts partial update payloads (only changed fields)', async () => {
      http.patch.mockResolvedValue(httpOk(makeAgent({ metadata: { team: 'ops' } })));

      await resource.update('agt_1', { metadata: { team: 'ops' } });

      expect(http.patch).toHaveBeenCalledWith('/agents/agt_1', { metadata: { team: 'ops' } });
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  describe('delete()', () => {
    it('issues DELETE to /agents/:id and resolves to void', async () => {
      http.delete.mockResolvedValue(undefined);

      await expect(resource.delete('agt_1')).resolves.toBeUndefined();

      expect(http.delete).toHaveBeenCalledWith('/agents/agt_1');
    });

    it('percent-encodes slashes in the agent id for DELETE', async () => {
      http.delete.mockResolvedValue(undefined);

      await resource.delete('agt/special');

      expect(http.delete).toHaveBeenCalledWith('/agents/agt%2Fspecial');
    });
  });

  // -------------------------------------------------------------------------
  // status
  // -------------------------------------------------------------------------

  describe('status()', () => {
    it('GETs /agents/:id/status and returns the metrics object', async () => {
      const metrics = {
        agentId: 'agt_1',
        totalTransactions: 10,
        successRate: 0.95,
        lastActiveAt: '2026-08-29T10:00:00.000Z',
      };
      http.get.mockResolvedValue(httpOk(metrics));

      const result = await resource.status('agt_1');

      expect(result).toEqual(metrics);
      expect(http.get).toHaveBeenCalledWith('/agents/agt_1/status', {});
    });
  });
});

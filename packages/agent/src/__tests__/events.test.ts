import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentLifecycleEvent } from '@astroid/types';

import { AgentResource } from '../index.js';

function createClientMock() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
}

function makeEvent(overrides: Partial<AgentLifecycleEvent> = {}): AgentLifecycleEvent {
  return {
    id: 'evt_1',
    type: 'agent.created',
    agentId: 'agt_1',
    organizationId: 'org_1',
    occurredAt: '2026-08-29T10:00:00.000Z',
    payload: {
      agentId: 'agt_1',
      organizationId: 'org_1',
      occurredAt: '2026-08-29T10:00:00.000Z',
    },
    ...overrides,
  };
}

describe('AgentResource event endpoints', () => {
  let http: ReturnType<typeof createClientMock>;
  let resource: AgentResource;

  beforeEach(() => {
    http = createClientMock();
    resource = new AgentResource(http as never);
  });

  it('listEvents() GETs the agent events path with an encoded id', async () => {
    http.get.mockResolvedValue({ data: [makeEvent()] });
    await resource.listEvents('agt/1');
    expect(http.get).toHaveBeenCalledWith('/v1/agents/agt%2F1/events', { query: undefined });
  });

  it('listEvents() serializes filters and pagination as a query', async () => {
    http.get.mockResolvedValue({ data: [makeEvent()] });
    await resource.listEvents('agt_1', {
      eventTypes: ['agent.created', 'agent.suspended'],
      cursor: 'c1',
      limit: 25,
      order: 'desc',
      from: '2026-08-01T00:00:00.000Z',
    });
    expect(http.get).toHaveBeenCalledWith('/v1/agents/agt_1/events', {
      query: {
        cursor: 'c1',
        limit: 25,
        order: 'desc',
        from: '2026-08-01T00:00:00.000Z',
        eventTypes: 'agent.created,agent.suspended',
      },
    });
  });

  it('listEvents() omits empty filters', async () => {
    http.get.mockResolvedValue({ data: [makeEvent()] });
    await resource.listEvents('agt_1', { eventTypes: [] });
    expect(http.get).toHaveBeenCalledWith('/v1/agents/agt_1/events', { query: {} });
  });

  it('subscribe() POSTs the subscription options to the subscriptions path', async () => {
    const subscription = {
      id: 'sub_1',
      agentId: 'agt_1',
      organizationId: 'org_1',
      eventTypes: ['agent.budget_exhausted'] as const,
      includeHistory: true,
      status: 'ACTIVE' as const,
      createdAt: '2026-08-29T10:00:00.000Z',
    };
    http.post.mockResolvedValue({ data: subscription });
    const result = await resource.subscribe('agt_1', {
      eventTypes: ['agent.budget_exhausted'],
      includeHistory: true,
    });
    expect(http.post).toHaveBeenCalledWith('/v1/agents/agt_1/events/subscriptions', {
      eventTypes: ['agent.budget_exhausted'],
      includeHistory: true,
    });
    expect(result).toBe(subscription);
  });

  it('subscribe() defaults to an empty options payload', async () => {
    http.post.mockResolvedValue({ data: {} });
    await resource.subscribe('agt_1');
    expect(http.post).toHaveBeenCalledWith('/v1/agents/agt_1/events/subscriptions', {});
  });

  it('unsubscribe() DELETEs the subscription path with encoded ids', async () => {
    http.delete.mockResolvedValue(undefined);
    await resource.unsubscribe('agt/1', 'sub/1');
    expect(http.delete).toHaveBeenCalledWith('/v1/agents/agt%2F1/events/subscriptions/sub%2F1');
  });
});

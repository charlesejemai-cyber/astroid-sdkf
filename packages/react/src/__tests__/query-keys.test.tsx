import { describe, expect, it } from 'vitest';
import { queryKeys } from '../hooks.js';

describe('queryKeys', () => {
  describe('wallets', () => {
    it('all returns the root wallets key', () => {
      expect(queryKeys.wallets.all).toEqual(['astroid', 'wallets']);
    });

    it('list returns a stable key with params', () => {
      const params = { limit: 10, cursor: 'cur_1' };
      expect(queryKeys.wallets.list(params)).toEqual([
        'astroid',
        'wallets',
        'list',
        params,
      ]);
    });

    it('list defaults to empty object when no params', () => {
      expect(queryKeys.wallets.list()).toEqual([
        'astroid',
        'wallets',
        'list',
        {},
      ]);
    });

    it('detail returns a key with the wallet ID', () => {
      expect(queryKeys.wallets.detail('wal_123')).toEqual([
        'astroid',
        'wallets',
        'detail',
        'wal_123',
      ]);
    });

    it('balance returns a nested key under detail', () => {
      expect(queryKeys.wallets.balance('wal_123')).toEqual([
        'astroid',
        'wallets',
        'detail',
        'wal_123',
        'balance',
      ]);
    });

    it('different wallet IDs produce different keys', () => {
      expect(queryKeys.wallets.detail('wal_1')).not.toEqual(
        queryKeys.wallets.detail('wal_2'),
      );
    });
  });

  describe('agents', () => {
    it('all returns the root agents key', () => {
      expect(queryKeys.agents.all).toEqual(['astroid', 'agents']);
    });

    it('list returns a stable key', () => {
      expect(queryKeys.agents.list({ limit: 25 })).toEqual([
        'astroid',
        'agents',
        'list',
        { limit: 25 },
      ]);
    });

    it('detail returns a key with the agent ID', () => {
      expect(queryKeys.agents.detail('agent_abc')).toEqual([
        'astroid',
        'agents',
        'detail',
        'agent_abc',
      ]);
    });
  });

  describe('policies', () => {
    it('all returns the root policies key', () => {
      expect(queryKeys.policies.all).toEqual(['astroid', 'policies']);
    });

    it('list returns a stable key', () => {
      expect(queryKeys.policies.list()).toEqual([
        'astroid',
        'policies',
        'list',
        {},
      ]);
    });

    it('detail returns a key with the policy ID', () => {
      expect(queryKeys.policies.detail('pol_xyz')).toEqual([
        'astroid',
        'policies',
        'detail',
        'pol_xyz',
      ]);
    });
  });

  describe('budgets', () => {
    it('all returns the root budgets key', () => {
      expect(queryKeys.budgets.all).toEqual(['astroid', 'budgets']);
    });

    it('list returns a stable key', () => {
      expect(queryKeys.budgets.list({ limit: 50 })).toEqual([
        'astroid',
        'budgets',
        'list',
        { limit: 50 },
      ]);
    });

    it('detail returns a key with the budget ID', () => {
      expect(queryKeys.budgets.detail('bud_123')).toEqual([
        'astroid',
        'budgets',
        'detail',
        'bud_123',
      ]);
    });

    it('utilization returns a nested key under detail', () => {
      expect(queryKeys.budgets.utilization('bud_123')).toEqual([
        'astroid',
        'budgets',
        'detail',
        'bud_123',
        'utilization',
      ]);
    });
  });

  describe('key stability', () => {
    it('same inputs produce equal keys (structural equality)', () => {
      const key1 = queryKeys.wallets.list({ limit: 10 });
      const key2 = queryKeys.wallets.list({ limit: 10 });
      expect(key1).toEqual(key2);
    });

    it('different resource types produce different root keys', () => {
      expect(queryKeys.wallets.all).not.toEqual(queryKeys.agents.all);
      expect(queryKeys.agents.all).not.toEqual(queryKeys.budgets.all);
      expect(queryKeys.budgets.all).not.toEqual(queryKeys.policies.all);
    });
  });
});

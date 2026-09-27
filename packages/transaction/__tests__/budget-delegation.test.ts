import { describe, expect, it } from 'vitest';

import { Account, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

import {
  buildBudgetDelegationTransaction,
  buildBudgetPaymentTransaction,
  buildBudgetRevocationTransaction,
  validateBudgetDelegationParams,
} from '../src/budget-delegation.js';

function makeAccount(): { keypair: Keypair; account: Account } {
  const keypair = Keypair.random();
  return { keypair, account: new Account(keypair.publicKey(), '100') };
}

function issuerKey(): string {
  return Keypair.random().publicKey();
}

describe('buildBudgetDelegationTransaction', () => {
  it('builds a delegation transaction with all manage-data operations', () => {
    const { account } = makeAccount();
    const authority = Keypair.random().publicKey();
    const delegatee = Keypair.random().publicKey();
    const issuer = issuerKey();

    const tx = buildBudgetDelegationTransaction({
      source: account,
      networkPassphrase: Networks.TESTNET,
      budgetAuthority: authority,
      delegatee,
      asset: `USDC:${issuer}`,
      amount: '5000',
      budgetId: 'budget_daily_ops',
      memoText: 'delegate daily budget',
    });

    const decoded = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET);
    expect(decoded.operations).toHaveLength(4);
    expect(String(decoded.memo.value)).toBe('delegate daily budget');

    const opNames = decoded.operations.map((op) => {
      if (op.type !== 'manageData') throw new Error('expected manageData');
      return op.name;
    });
    expect(opNames).toContain('budget_authority_budget_daily_ops');
    expect(opNames).toContain('budget_delegatee_budget_daily_ops');
    expect(opNames).toContain('budget_asset_budget_daily_ops');
    expect(opNames).toContain('budget_amount_budget_daily_ops');
  });

  it('includes expiration when provided', () => {
    const { account } = makeAccount();
    const authority = Keypair.random().publicKey();
    const delegatee = Keypair.random().publicKey();
    const expiration = Math.floor(Date.now() / 1000) + 86400;

    const tx = buildBudgetDelegationTransaction({
      source: account,
      networkPassphrase: Networks.TESTNET,
      budgetAuthority: authority,
      delegatee,
      asset: 'XLM',
      amount: '100',
      budgetId: 'budget_1',
      expirationTimestamp: expiration,
    });

    const decoded = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET);
    expect(decoded.operations).toHaveLength(5);
    const opNames = decoded.operations.map((op) => {
      if (op.type !== 'manageData') throw new Error('expected manageData');
      return op.name;
    });
    expect(opNames).toContain('budget_expiration_budget_1');
  });

  it('throws ValidationError for invalid budget authority', () => {
    const { account } = makeAccount();
    expect(() =>
      buildBudgetDelegationTransaction({
        source: account,
        networkPassphrase: Networks.TESTNET,
        budgetAuthority: 'not-a-key',
        delegatee: Keypair.random().publicKey(),
        asset: 'XLM',
        amount: '100',
        budgetId: 'budget_1',
      }),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError for invalid amount', () => {
    const { account } = makeAccount();
    expect(() =>
      buildBudgetDelegationTransaction({
        source: account,
        networkPassphrase: Networks.TESTNET,
        budgetAuthority: Keypair.random().publicKey(),
        delegatee: Keypair.random().publicKey(),
        asset: 'XLM',
        amount: '-50',
        budgetId: 'budget_1',
      }),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError for short budgetId', () => {
    const { account } = makeAccount();
    expect(() =>
      buildBudgetDelegationTransaction({
        source: account,
        networkPassphrase: Networks.TESTNET,
        budgetAuthority: Keypair.random().publicKey(),
        delegatee: Keypair.random().publicKey(),
        asset: 'XLM',
        amount: '100',
        budgetId: 'ab',
      }),
    ).toThrow(ValidationError);
  });
});

describe('buildBudgetPaymentTransaction', () => {
  it('builds a payment transaction with budget and policy metadata', () => {
    const { account } = makeAccount();
    const destination = Keypair.random().publicKey();
    const issuer = issuerKey();

    const tx = buildBudgetPaymentTransaction({
      source: account,
      networkPassphrase: Networks.TESTNET,
      destination,
      asset: `USDC:${issuer}`,
      amount: '25.50',
      budgetId: 'budget_research',
      policyId: 'policy_weekly',
      memoText: 'research materials',
    });

    const decoded = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET);
    expect(decoded.operations).toHaveLength(3);

    const opNames = decoded.operations.map((op) => {
      if (op.type !== 'manageData' && op.type !== 'payment') throw new Error('unexpected op type');
      return op.type === 'manageData' ? `manage:${op.name}` : `payment:${op.destination}`;
    });
    expect(opNames).toContain('manage:budget_id');
    expect(opNames).toContain('manage:policy_id');
    expect(opNames.some((n) => n.startsWith('payment:'))).toBe(true);
  });

  it('omits policy_id manage-data when policyId is not provided', () => {
    const { account } = makeAccount();
    const destination = Keypair.random().publicKey();

    const tx = buildBudgetPaymentTransaction({
      source: account,
      networkPassphrase: Networks.TESTNET,
      destination,
      asset: 'XLM',
      amount: '10',
      budgetId: 'budget_1',
    });

    const decoded = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET);
    expect(decoded.operations).toHaveLength(2);
    const opNames = decoded.operations.map((op) => {
      if (op.type !== 'manageData' && op.type !== 'payment') throw new Error('unexpected');
      return op.type === 'manageData' ? op.name : 'payment';
    });
    expect(opNames).not.toContain('policy_id');
  });

  it('throws ValidationError for invalid destination', () => {
    const { account } = makeAccount();
    expect(() =>
      buildBudgetPaymentTransaction({
        source: account,
        networkPassphrase: Networks.TESTNET,
        destination: 'bad-address',
        asset: 'XLM',
        amount: '10',
        budgetId: 'budget_1',
      }),
    ).toThrow(ValidationError);
  });
});

describe('buildBudgetRevocationTransaction', () => {
  it('builds a revocation transaction that clears all delegation entries', () => {
    const { account } = makeAccount();
    const authority = Keypair.random().publicKey();
    const delegatee = Keypair.random().publicKey();

    const tx = buildBudgetRevocationTransaction({
      source: account,
      networkPassphrase: Networks.TESTNET,
      budgetAuthority: authority,
      delegatee,
      budgetId: 'budget_revoke_me',
    });

    const decoded = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET);
    expect(decoded.operations).toHaveLength(5);

    for (const op of decoded.operations) {
      if (op.type !== 'manageData') throw new Error('expected manageData');
      expect(op.value === null || op.value === undefined).toBe(true);
    }

    const opNames = decoded.operations.map((op) => {
      if (op.type !== 'manageData') throw new Error('expected manageData');
      return op.name;
    });
    expect(opNames).toContain('budget_authority_budget_revoke_me');
    expect(opNames).toContain('budget_delegatee_budget_revoke_me');
    expect(opNames).toContain('budget_asset_budget_revoke_me');
    expect(opNames).toContain('budget_amount_budget_revoke_me');
    expect(opNames).toContain('budget_expiration_budget_revoke_me');
  });

  it('throws ValidationError for invalid delegatee', () => {
    const { account } = makeAccount();
    expect(() =>
      buildBudgetRevocationTransaction({
        source: account,
        networkPassphrase: Networks.TESTNET,
        budgetAuthority: Keypair.random().publicKey(),
        delegatee: 'invalid',
        budgetId: 'budget_1',
      }),
    ).toThrow(ValidationError);
  });
});

describe('validateBudgetDelegationParams', () => {
  it('returns valid for correct params', () => {
    const result = validateBudgetDelegationParams({
      budgetAuthority: Keypair.random().publicKey(),
      delegatee: Keypair.random().publicKey(),
      asset: 'XLM',
      amount: '100',
      budgetId: 'budget_valid',
    });
    expect(result).toEqual({ valid: true });
  });

  it('returns invalid with all error messages for empty params', () => {
    const result = validateBudgetDelegationParams({});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('validates expiration timestamp', () => {
    const result = validateBudgetDelegationParams({
      budgetAuthority: Keypair.random().publicKey(),
      delegatee: Keypair.random().publicKey(),
      asset: 'XLM',
      amount: '100',
      budgetId: 'budget_1',
      expirationTimestamp: -1,
    });
    expect(result.valid).toBe(false);
  });
});

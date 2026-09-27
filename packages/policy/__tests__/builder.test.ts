import { describe, expect, it } from 'vitest';

import { ValidationError } from '@astroid/errors';

import {
  PolicyBuilder,
  assertValidPolicyRule,
  isValidPolicyAddress,
  isValidPolicyAsset,
  policy,
  validatePolicyRule,
  type PolicyDraft,
} from '../src/builder.js';

/** A format-valid Stellar public key (`G` + 55 base-32 chars). */
const ADDRESS_A = `G${'A'.repeat(55)}`;
const ADDRESS_B = `G${'B'.repeat(55)}`;
const ISSUER = `G${'C'.repeat(55)}`;

describe('PolicyBuilder', () => {
  it('builds a single-condition rule and infers its type', () => {
    const draft = new PolicyBuilder('Max transfer').maxAmount(500).build();

    expect(draft).toEqual({
      name: 'Max transfer',
      type: 'MAX_AMOUNT',
      configuration: { maxAmount: 500 },
      priority: 1,
      enabled: true,
    });
  });

  it('infers COMPOSITE when several rule families are configured', () => {
    const draft = PolicyBuilder.create('Treasury guardrails')
      .allowDestinations(ADDRESS_A, ADDRESS_B)
      .allowAssets('XLM', `USDC:${ISSUER}`)
      .maxAmount(1_000)
      .dailyLimit(5_000)
      .build();

    expect(draft.type).toBe('COMPOSITE');
    expect(draft.configuration.allowedRecipients).toEqual([ADDRESS_A, ADDRESS_B]);
    expect(draft.configuration.allowedAssets).toEqual(['XLM', `USDC:${ISSUER}`]);
    expect(draft.configuration.maxAmount).toBe(1_000);
    expect(draft.configuration.dailyLimit).toBe(5_000);
  });

  it('honours an explicit type override', () => {
    const draft = new PolicyBuilder({ name: 'Custom', type: 'AGENT_RULE' })
      .forAgent('agent_123')
      .maxAmount(10)
      .build();

    expect(draft.type).toBe('AGENT_RULE');
    expect(draft.agentId).toBe('agent_123');
  });

  it('supports the policy() factory alias', () => {
    const draft = policy('Alias').maxAmount(1).build();
    expect(draft.name).toBe('Alias');
  });

  it('carries priority, enabled and description through build()', () => {
    const draft = new PolicyBuilder('Scoped')
      .withDescription('Desc')
      .withPriority(7)
      .enabled(false)
      .minAmount(2)
      .build();

    expect(draft.description).toBe('Desc');
    expect(draft.priority).toBe(7);
    expect(draft.enabled).toBe(false);
  });

  it('rejects invalid destinations during rule construction', () => {
    expect(() => new PolicyBuilder('Bad').allowDestination('not-a-key')).toThrowError(
      ValidationError,
    );
    try {
      new PolicyBuilder('Bad').denyDestination('nope');
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect((err as ValidationError).code).toBe('INVALID_POLICY_ADDRESS');
    }
  });

  it('rejects invalid assets', () => {
    expect(() => new PolicyBuilder('Bad').allowAsset('USDC:not-an-issuer')).toThrowError(
      ValidationError,
    );
    expect(() => new PolicyBuilder('Bad').denyAsset('')).toThrowError(ValidationError);
  });

  it('rejects non-positive amounts', () => {
    expect(() => new PolicyBuilder('Bad').maxAmount(0)).toThrowError(ValidationError);
    expect(() => new PolicyBuilder('Bad').dailyLimit(-5)).toThrowError(ValidationError);
  });

  it('rejects an unordered time window', () => {
    expect(() =>
      new PolicyBuilder('Window').timeWindow({
        start: '2026-12-31T00:00:00.000Z',
        end: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrowError(ValidationError);

    const draft = new PolicyBuilder('Window')
      .timeWindow({ start: '2026-01-01T00:00:00.000Z', end: '2026-12-31T00:00:00.000Z' })
      .build();
    expect(draft.type).toBe('TIME_WINDOW');
  });

  it('throws on build() with no conditions and no explicit type', () => {
    expect(() => new PolicyBuilder('Empty').build()).toThrowError(ValidationError);
  });

  it('rejects a minAmount greater than maxAmount', () => {
    expect(() => new PolicyBuilder('Bad').maxAmount(10).minAmount(20)).toThrowError(
      ValidationError,
    );
  });
});

describe('policy validation utilities', () => {
  it('validates address and asset formats', () => {
    expect(isValidPolicyAddress(ADDRESS_A)).toBe(true);
    expect(isValidPolicyAddress('lowercase')).toBe(false);
    expect(isValidPolicyAsset('XLM')).toBe(true);
    expect(isValidPolicyAsset('USDC')).toBe(true);
    expect(isValidPolicyAsset(`USDC:${ISSUER}`)).toBe(true);
    expect(isValidPolicyAsset('TOO-LONG-CODE')).toBe(false);
    expect(isValidPolicyAsset(`USDC:${ADDRESS_A}:extra`)).toBe(false);
  });

  it('reports every issue without throwing', () => {
    const draft: PolicyDraft = {
      name: '',
      type: 'ALLOWED_ASSETS',
      configuration: {
        allowedAssets: ['bad asset'],
        maxAmount: -1,
      },
      priority: 1,
      enabled: true,
    };

    const issues = validatePolicyRule(draft);
    expect(issues.length).toBeGreaterThanOrEqual(3);
    expect(issues.map((i) => i.field)).toContain('name');
    expect(issues.map((i) => i.field)).toContain('configuration.maxAmount');
  });

  it('assertValidPolicyRule throws a structured ValidationError', () => {
    const draft: PolicyDraft = {
      name: 'Broken',
      type: 'MAX_AMOUNT',
      configuration: { maxAmount: 0 },
      priority: 1,
      enabled: true,
    };

    try {
      assertValidPolicyRule(draft);
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('INVALID_POLICY_RULE');
    }
  });

  it('returns a valid draft unchanged', () => {
    const draft: PolicyDraft = {
      name: 'Valid',
      type: 'MAX_AMOUNT',
      configuration: { maxAmount: 100 },
      priority: 1,
      enabled: true,
    };
    expect(assertValidPolicyRule(draft)).toBe(draft);
    expect(validatePolicyRule(draft)).toEqual([]);
  });
});

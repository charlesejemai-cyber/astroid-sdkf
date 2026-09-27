/**
 * `@astroid/policy` — fluent policy condition builder & validation utilities.
 *
 * Constructing a valid policy JSON document by hand is error-prone:
 * destination whitelists need checksum-shaped Stellar public keys, spend caps
 * must be positive numbers, and time windows must have an ordered start/end.
 * {@link PolicyBuilder} offers a small, chainable, fully-typed API for
 * assembling a {@link PolicyDraft} — the exact payload accepted by
 * {@link PolicyResource.create} — while validating every parameter as it is
 * added.
 *
 * The builder is pure and side-effect free (no network, no globals); the only
 * runtime dependency it relies on is the structured {@link ValidationError}
 * from `@astroid/errors`.
 *
 * @example
 * ```ts
 * import { PolicyBuilder } from '@astroid/policy';
 *
 * const policy = new PolicyBuilder('Treasury guardrails')
 *   .forAgent('agent_123')
 *   .allowDestinations('GDEST…', 'GOTHER…')
 *   .allowAssets('XLM', 'USDC:G…Issuer')
 *   .maxAmount(500)
 *   .dailyLimit(2_500)
 *   .timeWindow({ start: '2026-01-01T00:00:00.000Z', end: '2026-12-31T23:59:59.000Z' })
 *   .build();
 *
 * await astroid.policies.create(policy);
 * ```
 *
 * @module
 */

import { ValidationError } from '@astroid/errors';
import type { Policy, PolicyConfiguration, PolicyType } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A policy payload ready to be created: a {@link Policy} without the fields the
 * server owns (`id`, `organizationId`, timestamps).
 */
export type PolicyDraft = Omit<
  Policy,
  'id' | 'organizationId' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

/** A single problem found while validating a policy rule. */
export interface PolicyValidationIssue {
  /** Dotted path to the offending field (e.g. `"configuration.allowedRecipients"`). */
  field: string;
  /** Human-readable explanation. */
  message: string;
}

/** A time window during which the policy applies. */
export interface PolicyTimeWindow {
  /** Inclusive start (ISO-8601 or any `Date`-parseable string). */
  start: string;
  /** Exclusive end (ISO-8601 or any `Date`-parseable string). */
  end: string;
  /** Optional IANA timezone label (e.g. `"UTC"`). */
  timezone?: string;
}

/** Options accepted by the {@link PolicyBuilder} constructor. */
export interface PolicyBuilderOptions {
  /** Human-readable policy name. */
  name?: string;
  /** Optional description. */
  description?: string;
  /** Scope the policy to a single agent. */
  agentId?: string | null;
  /** Evaluation priority (lower runs first). Defaults to `1`. */
  priority?: number;
  /** Whether the policy is active. Defaults to `true`. */
  enabled?: boolean;
  /** Force an explicit policy type instead of inferring one. */
  type?: PolicyType;
}

/* -------------------------------------------------------------------------- */
/* Validation helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Stellar public key format: `G` followed by 55 base-32 characters. */
const STELLAR_PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;

/** Asset code: 1–12 alphanumeric characters (SEP-0011 Alphanumeric4/12). */
const ASSET_CODE_PATTERN = /^[A-Za-z0-9]{1,12}$/;

/**
 * Whether `value` is a syntactically valid Stellar public key (`G…`).
 *
 * This is a format check — it verifies the `G` prefix, length and base-32
 * alphabet, but not the CRC16 checksum. Policies are also validated server-side
 * against the full checksum before they are persisted.
 */
export function isValidPolicyAddress(value: unknown): value is string {
  return typeof value === 'string' && STELLAR_PUBLIC_KEY_PATTERN.test(value.trim());
}

/**
 * Whether `value` is a valid asset identifier: `XLM`, a bare asset code, or
 * `CODE:ISSUER` with a format-valid Stellar issuer.
 */
export function isValidPolicyAsset(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed === '') return false;
  if (trimmed.toUpperCase() === 'XLM') return true;

  const parts = trimmed.split(':');
  if (parts.length > 2) return false;
  const [code, issuer] = parts;
  if (!code || !ASSET_CODE_PATTERN.test(code)) return false;
  if (issuer !== undefined && !isValidPolicyAddress(issuer)) return false;
  return true;
}

/** Throw a {@link ValidationError} when `value` is not a valid Stellar address. */
function assertAddress(value: string, field: string): void {
  if (!isValidPolicyAddress(value)) {
    throw new ValidationError(`${field} must be a valid Stellar public key (G…).`, {
      code: 'INVALID_POLICY_ADDRESS',
      details: { field },
    });
  }
}

/** Throw a {@link ValidationError} when `value` is not a valid asset identifier. */
function assertAsset(value: string, field: string): void {
  if (!isValidPolicyAsset(value)) {
    throw new ValidationError(
      `${field} must be XLM, a bare asset code, or CODE:ISSUER with a valid Stellar issuer.`,
      { code: 'INVALID_POLICY_ASSET', details: { field } },
    );
  }
}

/** Throw a {@link ValidationError} when `value` is not a positive finite amount. */
function assertPositiveAmount(value: number, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive finite number.`, {
      code: 'INVALID_POLICY_AMOUNT',
      details: { field },
    });
  }
}

/** Throw a {@link ValidationError} when the time window is malformed or unordered. */
function assertTimeWindow(window: PolicyTimeWindow): void {
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  if (Number.isNaN(start)) {
    throw new ValidationError('timeWindow.start must be a parseable date string.', {
      code: 'INVALID_POLICY_TIME_WINDOW',
      details: { field: 'timeWindow.start' },
    });
  }
  if (Number.isNaN(end)) {
    throw new ValidationError('timeWindow.end must be a parseable date string.', {
      code: 'INVALID_POLICY_TIME_WINDOW',
      details: { field: 'timeWindow.end' },
    });
  }
  if (start >= end) {
    throw new ValidationError('timeWindow.start must be before timeWindow.end.', {
      code: 'INVALID_POLICY_TIME_WINDOW',
      details: { field: 'timeWindow' },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Rule-family inference                                                       */
/* -------------------------------------------------------------------------- */

/** Infer the most specific {@link PolicyType} for a configuration. */
function inferPolicyType(configuration: PolicyConfiguration): PolicyType | 'COMPOSITE' | null {
  const families: PolicyType[] = [];
  if (configuration.maxAmount !== undefined) families.push('MAX_AMOUNT');
  if (configuration.minAmount !== undefined) families.push('MIN_AMOUNT');
  if (configuration.allowedRecipients?.length) families.push('ALLOWED_RECIPIENTS');
  if (configuration.blockedRecipients?.length) families.push('BLOCKED_RECIPIENTS');
  if (configuration.allowedAssets?.length) families.push('ALLOWED_ASSETS');
  if (configuration.blockedAssets?.length) families.push('BLOCKED_ASSETS');
  if (configuration.dailyLimit !== undefined) families.push('DAILY_BUDGET');
  if (configuration.weeklyLimit !== undefined) families.push('WEEKLY_BUDGET');
  if (configuration.monthlyLimit !== undefined) families.push('MONTHLY_BUDGET');
  if (configuration.timeWindow !== undefined) families.push('TIME_WINDOW');

  if (families.length === 0) return null;
  if (families.length === 1) return families[0]!;
  return 'COMPOSITE';
}

/* -------------------------------------------------------------------------- */
/* Standalone validation utilities                                             */
/* -------------------------------------------------------------------------- */

/**
 * Validate a policy draft without throwing. Returns every issue found (empty
 * when the draft is valid) so callers can surface all problems at once.
 *
 * @param draft The policy payload to inspect.
 * @returns     A list of {@link PolicyValidationIssue}s.
 */
export function validatePolicyRule(draft: PolicyDraft): PolicyValidationIssue[] {
  const issues: PolicyValidationIssue[] = [];
  const config = draft.configuration ?? {};

  if (typeof draft.name !== 'string' || draft.name.trim() === '') {
    issues.push({ field: 'name', message: 'Policy name is required.' });
  }
  if (!draft.type) {
    issues.push({ field: 'type', message: 'Policy type is required.' });
  }
  if (typeof draft.priority !== 'number' || !Number.isFinite(draft.priority)) {
    issues.push({ field: 'priority', message: 'priority must be a finite number.' });
  }

  const checkAmount = (value: unknown, field: string): void => {
    if (value === undefined) return;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      issues.push({ field, message: `${field} must be a positive finite number.` });
    }
  };
  checkAmount(config.maxAmount, 'configuration.maxAmount');
  checkAmount(config.minAmount, 'configuration.minAmount');
  checkAmount(config.dailyLimit, 'configuration.dailyLimit');
  checkAmount(config.weeklyLimit, 'configuration.weeklyLimit');
  checkAmount(config.monthlyLimit, 'configuration.monthlyLimit');

  if (
    typeof config.maxAmount === 'number' &&
    typeof config.minAmount === 'number' &&
    config.minAmount > config.maxAmount
  ) {
    issues.push({
      field: 'configuration.minAmount',
      message: 'minAmount must not exceed maxAmount.',
    });
  }

  for (const [field, list, validator] of [
    ['configuration.allowedRecipients', config.allowedRecipients, isValidPolicyAddress],
    ['configuration.blockedRecipients', config.blockedRecipients, isValidPolicyAddress],
    ['configuration.allowedAssets', config.allowedAssets, isValidPolicyAsset],
    ['configuration.blockedAssets', config.blockedAssets, isValidPolicyAsset],
  ] as const) {
    if (list === undefined) continue;
    if (list.length === 0) {
      issues.push({ field, message: `${field} must contain at least one entry.` });
      continue;
    }
    list.forEach((entry, index) => {
      if (!validator(entry)) {
        issues.push({ field: `${field}[${index}]`, message: `"${entry}" is not valid.` });
      }
    });
  }

  if (config.timeWindow) {
    const { start, end } = config.timeWindow;
    if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
      issues.push({
        field: 'configuration.timeWindow',
        message: 'timeWindow start/end must be parseable dates.',
      });
    } else if (Date.parse(start) >= Date.parse(end)) {
      issues.push({
        field: 'configuration.timeWindow',
        message: 'timeWindow.start must be before timeWindow.end.',
      });
    }
  }

  return issues;
}

/**
 * Validate a policy draft and throw a structured {@link ValidationError} when
 * it is invalid. Returns the draft unchanged on success, so it can be used
 * inline.
 *
 * @throws {ValidationError} With code `INVALID_POLICY_RULE` when invalid.
 */
export function assertValidPolicyRule(draft: PolicyDraft): PolicyDraft {
  const issues = validatePolicyRule(draft);
  if (issues.length > 0) {
    const summary = issues.map((i) => `${i.field}: ${i.message}`).join('; ');
    throw new ValidationError(`Policy rule is invalid — ${summary}`, {
      code: 'INVALID_POLICY_RULE',
      details: { issues },
    });
  }
  return draft;
}

/* -------------------------------------------------------------------------- */
/* Fluent builder                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Fluent builder for policy rules.
 *
 * Each `with*`/`allow*`/`deny*` method appends or sets a single configuration
 * field and returns `this`, so conditions can be chained. Invalid inputs throw
 * immediately; {@link PolicyBuilder.build} additionally runs the full
 * {@link assertValidPolicyRule} check and resolves the policy `type` (inferred
 * from the configured conditions, or `COMPOSITE` when more than one family is
 * used).
 *
 * @example
 * ```ts
 * const rule = PolicyBuilder.create('Payroll destinations')
 *   .allowDestinations(...teamAddresses)
 *   .maxAmount(10_000)
 *   .build();
 * ```
 */
export class PolicyBuilder {
  private draft: {
    name: string;
    description?: string;
    type?: PolicyType;
    configuration: PolicyConfiguration;
    priority: number;
    enabled: boolean;
    agentId?: string | null;
  };

  constructor(nameOrOptions: string | PolicyBuilderOptions = {}) {
    const options: PolicyBuilderOptions =
      typeof nameOrOptions === 'string' ? { name: nameOrOptions } : nameOrOptions;

    this.draft = {
      name: options.name ?? '',
      configuration: {},
      priority: options.priority ?? 1,
      enabled: options.enabled ?? true,
    };
    if (options.description !== undefined) this.draft.description = options.description;
    if (options.type !== undefined) this.draft.type = options.type;
    if (options.agentId !== undefined) this.draft.agentId = options.agentId;
  }

  /** Start a new builder with the given name. */
  static create(name: string): PolicyBuilder {
    return new PolicyBuilder(name);
  }

  /** Set the policy name. */
  withName(name: string): this {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new ValidationError('Policy name is required.', { code: 'INVALID_POLICY_NAME' });
    }
    this.draft.name = name;
    return this;
  }

  /** Set the optional description. */
  withDescription(description: string): this {
    this.draft.description = description;
    return this;
  }

  /** Scope the policy to a single agent. */
  forAgent(agentId: string | null): this {
    this.draft.agentId = agentId;
    return this;
  }

  /** Set the explicit policy type (overrides inference). */
  ofType(type: PolicyType): this {
    this.draft.type = type;
    return this;
  }

  /** Set the evaluation priority (lower runs first). */
  withPriority(priority: number): this {
    if (typeof priority !== 'number' || !Number.isFinite(priority) || priority < 0) {
      throw new ValidationError('priority must be a non-negative finite number.', {
        code: 'INVALID_POLICY_PRIORITY',
      });
    }
    this.draft.priority = priority;
    return this;
  }

  /** Enable or disable the policy. */
  enabled(enabled: boolean): this {
    this.draft.enabled = Boolean(enabled);
    return this;
  }

  /* ------------------------------ destinations ---------------------------- */

  /** Allow one destination (Stellar `G…` address). */
  allowDestination(address: string): this {
    assertAddress(address, 'allowedRecipients');
    this.draft.configuration.allowedRecipients = [
      ...(this.draft.configuration.allowedRecipients ?? []),
      address,
    ];
    return this;
  }

  /** Allow several destinations at once. */
  allowDestinations(...addresses: string[]): this {
    for (const address of addresses) this.allowDestination(address);
    return this;
  }

  /** Block one destination (Stellar `G…` address). */
  denyDestination(address: string): this {
    assertAddress(address, 'blockedRecipients');
    this.draft.configuration.blockedRecipients = [
      ...(this.draft.configuration.blockedRecipients ?? []),
      address,
    ];
    return this;
  }

  /** Block several destinations at once. */
  denyDestinations(...addresses: string[]): this {
    for (const address of addresses) this.denyDestination(address);
    return this;
  }

  /* -------------------------------- assets -------------------------------- */

  /** Restrict transfers to a single asset (`XLM`, `USDC`, or `CODE:ISSUER`). */
  allowAsset(asset: string): this {
    assertAsset(asset, 'allowedAssets');
    this.draft.configuration.allowedAssets = [
      ...(this.draft.configuration.allowedAssets ?? []),
      asset,
    ];
    return this;
  }

  /** Restrict transfers to the given assets. */
  allowAssets(...assets: string[]): this {
    for (const asset of assets) this.allowAsset(asset);
    return this;
  }

  /** Block a single asset. */
  denyAsset(asset: string): this {
    assertAsset(asset, 'blockedAssets');
    this.draft.configuration.blockedAssets = [
      ...(this.draft.configuration.blockedAssets ?? []),
      asset,
    ];
    return this;
  }

  /** Block the given assets. */
  denyAssets(...assets: string[]): this {
    for (const asset of assets) this.denyAsset(asset);
    return this;
  }

  /* ------------------------------ spend limits ---------------------------- */

  /** Cap each individual transfer at `amount`. */
  maxAmount(amount: number): this {
    assertPositiveAmount(amount, 'maxAmount');
    this.draft.configuration.maxAmount = amount;
    return this;
  }

  /** Require each transfer to be at least `amount`. */
  minAmount(amount: number): this {
    assertPositiveAmount(amount, 'minAmount');
    if (
      this.draft.configuration.maxAmount !== undefined &&
      amount > this.draft.configuration.maxAmount
    ) {
      throw new ValidationError('minAmount must not exceed maxAmount.', {
        code: 'INVALID_POLICY_AMOUNT',
      });
    }
    this.draft.configuration.minAmount = amount;
    return this;
  }

  /** Cap spend over a rolling day at `amount` (velocity limit). */
  dailyLimit(amount: number): this {
    assertPositiveAmount(amount, 'dailyLimit');
    this.draft.configuration.dailyLimit = amount;
    return this;
  }

  /** Cap spend over a rolling week at `amount` (velocity limit). */
  weeklyLimit(amount: number): this {
    assertPositiveAmount(amount, 'weeklyLimit');
    this.draft.configuration.weeklyLimit = amount;
    return this;
  }

  /** Cap spend over a rolling month at `amount` (velocity limit). */
  monthlyLimit(amount: number): this {
    assertPositiveAmount(amount, 'monthlyLimit');
    this.draft.configuration.monthlyLimit = amount;
    return this;
  }

  /** Restrict the policy to an ordered time window. */
  timeWindow(window: PolicyTimeWindow): this {
    assertTimeWindow(window);
    this.draft.configuration.timeWindow = {
      start: window.start,
      end: window.end,
      ...(window.timezone !== undefined ? { timezone: window.timezone } : {}),
    };
    return this;
  }

  /**
   * Produce the final, validated policy draft.
   *
   * @returns A {@link PolicyDraft} accepted by `PolicyResource.create`.
   * @throws {ValidationError} When no conditions/type were configured, or any
   *   accumulated parameter is invalid.
   */
  build(): PolicyDraft {
    const inferred = inferPolicyType(this.draft.configuration);
    const type = this.draft.type ?? inferred ?? undefined;
    if (!type) {
      throw new ValidationError(
        'PolicyBuilder requires at least one condition or an explicit type before build().',
        { code: 'INVALID_POLICY_RULE' },
      );
    }

    const draft: PolicyDraft = {
      name: this.draft.name,
      type,
      configuration: { ...this.draft.configuration },
      priority: this.draft.priority,
      enabled: this.draft.enabled,
      ...(this.draft.description !== undefined ? { description: this.draft.description } : {}),
      ...(this.draft.agentId !== undefined ? { agentId: this.draft.agentId } : {}),
    };

    return assertValidPolicyRule(draft);
  }
}

/**
 * Convenience factory for {@link PolicyBuilder}. Equivalent to
 * `new PolicyBuilder(name)`.
 */
export function policy(name: string): PolicyBuilder {
  return new PolicyBuilder(name);
}

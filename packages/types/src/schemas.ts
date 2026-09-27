/**
 * Zod runtime validation schemas for core domain models and DTOs.
 *
 * Each schema mirrors the corresponding TypeScript interface in `entities.ts`
 * and `dto.ts` exactly — they are the single source of truth for runtime
 * validation at SDK boundaries.
 *
 * @example
 * ```ts
 * import { AgentSchema, validateAgent } from '@astroid/types';
 *
 * const result = validateAgent(unknownPayload);
 * if (result.success) {
 *   console.log(result.data.name);
 * } else {
 *   console.error(result.error.flatten());
 * }
 * ```
 *
 * @module
 */

import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Enum schemas                                                                */
/* -------------------------------------------------------------------------- */

export const OrganizationPlanSchema = z.enum(['FREE', 'STARTER', 'GROWTH', 'ENTERPRISE']);

export const OrganizationStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']);

export const UserRoleSchema = z.enum([
  'OWNER',
  'ADMIN',
  'FINANCE',
  'DEVELOPER',
  'AUDITOR',
  'VIEWER',
]);

export const UserStatusSchema = z.enum(['ACTIVE', 'INVITED', 'SUSPENDED', 'ARCHIVED']);

export const AgentRoleSchema = z.enum([
  'FINANCE',
  'RESEARCH',
  'OPERATIONS',
  'PROCUREMENT',
  'CUSTOM',
]);

export const AgentStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'SUSPENDED', 'ARCHIVED']);

export const WalletTypeSchema = z.enum(['AGENT', 'TREASURY', 'ESCROW', 'SHARED', 'PERSONAL']);

export const WalletStatusSchema = z.enum(['ACTIVE', 'FROZEN', 'PAUSED', 'ARCHIVED']);

export const StellarNetworkSchema = z.enum(['TESTNET', 'PUBLIC', 'FUTURENET']);

export const PolicyTypeSchema = z.enum([
  'MAX_AMOUNT',
  'MIN_AMOUNT',
  'ALLOWED_ASSETS',
  'BLOCKED_ASSETS',
  'DAILY_BUDGET',
  'WEEKLY_BUDGET',
  'MONTHLY_BUDGET',
  'ALLOWED_RECIPIENTS',
  'BLOCKED_RECIPIENTS',
  'TIME_WINDOW',
  'DEPARTMENT_RULE',
  'AGENT_RULE',
  'EMERGENCY_LOCK',
  'COMPOSITE',
]);

export const BudgetPeriodSchema = z.enum([
  'ONE_TIME',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'YEARLY',
]);

export const TransactionStatusSchema = z.enum([
  'DRAFT',
  'PENDING',
  'APPROVED',
  'SUBMITTED',
  'CONFIRMED',
  'COMPLETED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
  'FAILED',
]);

export const RiskBandSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const ProposalStatusSchema = z.enum([
  'DRAFT',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'EXECUTED',
  'CANCELLED',
]);

export const ApprovalTypeSchema = z.enum([
  'SINGLE',
  'DUAL',
  'MULTISIG',
  'ROLE',
  'COMMITTEE',
  'EMERGENCY',
]);

export const ApprovalDecisionSchema = z.enum(['APPROVED', 'REJECTED', 'DELEGATED', 'EXPIRED']);

export const NotificationTypeSchema = z.enum([
  'BUDGET_EXCEEDED',
  'PROPOSAL_APPROVED',
  'PROPOSAL_REJECTED',
  'WALLET_FUNDED',
  'PAYMENT_FAILED',
  'POLICY_VIOLATION',
  'RISK_ALERT',
  'APPROVAL_REQUIRED',
  'INFO',
]);

export const NotificationChannelSchema = z.enum([
  'DASHBOARD',
  'EMAIL',
  'DISCORD',
  'SLACK',
  'WEBHOOK',
]);

/* -------------------------------------------------------------------------- */
/* Shared primitives                                                           */
/* -------------------------------------------------------------------------- */

/** ISO-861 datetime string. */
export const IsoDateTimeSchema = z.string().datetime();

/** Decimal monetary amount as a string. */
export const DecimalStringSchema = z.string();

/* -------------------------------------------------------------------------- */
/* Core entity schemas                                                         */
/* -------------------------------------------------------------------------- */

/** Organization entity. */
export const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logo: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  plan: OrganizationPlanSchema,
  status: OrganizationStatusSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.nullable().optional(),
});

/** User entity. */
export const UserSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  email: z.string().email(),
  avatar: z.string().nullable().optional(),
  role: UserRoleSchema,
  status: UserStatusSchema,
  lastLogin: IsoDateTimeSchema.nullable().optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.nullable().optional(),
});

/** Agent entity. */
export const AgentSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  primaryWalletId: z.string().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  role: AgentRoleSchema,
  status: AgentStatusSchema,
  capabilities: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.nullable().optional(),
});

/** Wallet entity. */
export const WalletSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  agentId: z.string().nullable().optional(),
  stellarAddress: z.string(),
  label: z.string().nullable().optional(),
  walletType: WalletTypeSchema,
  network: StellarNetworkSchema,
  status: WalletStatusSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.nullable().optional(),
});

/** Asset balance on a wallet. */
export const AssetBalanceSchema = z.object({
  asset: z.string(),
  balance: DecimalStringSchema,
  issuer: z.string().nullable().optional(),
});

/** Full balance snapshot for a wallet. */
export const WalletBalanceSchema = z.object({
  walletId: z.string(),
  stellarAddress: z.string(),
  network: StellarNetworkSchema,
  balances: z.array(AssetBalanceSchema),
  updatedAt: IsoDateTimeSchema,
});

/** Policy configuration (flexible JSONB shape). */
export const PolicyConfigurationSchema = z
  .object({
    maxAmount: z.number().optional(),
    minAmount: z.number().optional(),
    asset: z.string().optional(),
    allowedAssets: z.array(z.string()).optional(),
    blockedAssets: z.array(z.string()).optional(),
    allowedRecipients: z.array(z.string()).optional(),
    blockedRecipients: z.array(z.string()).optional(),
    requiresApproval: z.boolean().optional(),
    dailyLimit: z.number().optional(),
    weeklyLimit: z.number().optional(),
    monthlyLimit: z.number().optional(),
    timeWindow: z
      .object({
        start: z.string(),
        end: z.string(),
        timezone: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

/** Policy entity. */
export const PolicySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  agentId: z.string().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  type: PolicyTypeSchema,
  configuration: PolicyConfigurationSchema,
  priority: z.number(),
  enabled: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.nullable().optional(),
});

/** Budget entity. */
export const BudgetSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  parentBudgetId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  name: z.string(),
  currency: z.string(),
  limitAmount: DecimalStringSchema,
  spent: DecimalStringSchema,
  remaining: DecimalStringSchema,
  period: BudgetPeriodSchema,
  periodStart: IsoDateTimeSchema,
  rollover: z.boolean(),
  enabled: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.nullable().optional(),
});

/** Budget history entry. */
export const BudgetHistoryEntrySchema = z.object({
  id: z.string(),
  budgetId: z.string(),
  amount: DecimalStringSchema,
  spentAfter: DecimalStringSchema,
  transactionId: z.string().nullable().optional(),
  createdAt: IsoDateTimeSchema,
});

/** Transaction entity. */
export const TransactionSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  walletId: z.string(),
  agentId: z.string().nullable().optional(),
  policyId: z.string().nullable().optional(),
  budgetId: z.string().nullable().optional(),
  asset: z.string(),
  amount: DecimalStringSchema,
  senderAddress: z.string().nullable().optional(),
  recipientAddress: z.string(),
  memo: z.string().nullable().optional(),
  purpose: z.string().nullable().optional(),
  status: TransactionStatusSchema,
  riskScore: z.number(),
  riskBand: RiskBandSchema,
  requiresApproval: z.boolean(),
  stellarHash: z.string().nullable().optional(),
  confirmationCount: z.number(),
  gasEstimate: DecimalStringSchema.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.nullable().optional(),
});

/** Proposal entity. */
export const ProposalSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  transactionId: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  approvalType: ApprovalTypeSchema,
  requiredApprovals: z.number(),
  status: ProposalStatusSchema,
  expiresAt: IsoDateTimeSchema.nullable().optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

/** Approval entity. */
export const ApprovalSchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  userId: z.string(),
  decision: ApprovalDecisionSchema,
  comment: z.string().nullable().optional(),
  createdAt: IsoDateTimeSchema,
});

/** Notification entity. */
export const NotificationSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  title: z.string(),
  body: z.string(),
  type: NotificationTypeSchema,
  channel: NotificationChannelSchema,
  read: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: IsoDateTimeSchema,
});

/* -------------------------------------------------------------------------- */
/* DTO input schemas                                                           */
/* -------------------------------------------------------------------------- */

/** Create wallet input. */
export const CreateWalletInputSchema = z.object({
  agentId: z.string().optional(),
  label: z.string().optional(),
  walletType: WalletTypeSchema.optional(),
  network: StellarNetworkSchema.optional(),
});

/** Create agent input. */
export const CreateAgentInputSchema = z.object({
  name: z.string().min(1, 'Agent name is required'),
  description: z.string().optional(),
  role: AgentRoleSchema.optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  primaryWalletId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Create policy input. */
export const CreatePolicyInputSchema = z.object({
  name: z.string().min(1, 'Policy name is required'),
  type: PolicyTypeSchema,
  configuration: PolicyConfigurationSchema,
  description: z.string().optional(),
  agentId: z.string().optional(),
  priority: z.number().optional(),
  enabled: z.boolean().optional(),
});

/** Create budget input. */
export const CreateBudgetInputSchema = z.object({
  name: z.string().min(1, 'Budget name is required'),
  limitAmount: z.union([z.number().positive(), z.string().min(1)]),
  currency: z.string().optional(),
  period: BudgetPeriodSchema.optional(),
  parentBudgetId: z.string().optional(),
  agentId: z.string().optional(),
  rollover: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

/** Create transaction input. */
export const CreateTransactionInputSchema = z.object({
  walletId: z.string().min(1, 'Wallet ID is required'),
  asset: z.string().min(1, 'Asset is required'),
  amount: z.union([z.number().positive(), z.string().min(1)]),
  recipientAddress: z.string().min(1, 'Recipient address is required'),
  agentId: z.string().optional(),
  policyId: z.string().optional(),
  budgetId: z.string().optional(),
  memo: z.string().optional(),
  purpose: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().optional(),
});

/** Transfer input. */
export const TransferInputSchema = z.object({
  recipientAddress: z.string().min(1, 'Recipient address is required'),
  asset: z.string().min(1, 'Asset is required'),
  amount: z.union([z.number().positive(), z.string().min(1)]),
  memo: z.string().optional(),
  purpose: z.string().optional(),
  budgetId: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

/** Simulate policy input. */
export const SimulatePolicyInputSchema = z.object({
  walletId: z.string().optional(),
  agentId: z.string().optional(),
  asset: z.string().min(1, 'Asset is required'),
  amount: z.union([z.number().nonnegative(), z.string().min(1)]),
  recipientAddress: z.string().optional(),
  policyIds: z.array(z.string()).optional(),
});

/* -------------------------------------------------------------------------- */
/* Validation helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Result of a validation attempt. */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: z.ZodError };

/**
 * Validate an unknown value against a Zod schema, returning a typed result.
 *
 * @example
 * ```ts
 * const result = validate(AgentSchema, payload);
 * if (result.success) {
 *   console.log(result.data.name);
 * }
 * ```
 */
export function validate<T extends z.ZodType>(
  schema: T,
  value: unknown,
): ValidationResult<z.infer<T>> {
  const result = schema.safeParse(value);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Validate and throw on failure. Returns the typed value on success.
 *
 * @throws {z.ZodError} if validation fails.
 *
 * @example
 * ```ts
 * const agent = validateOrThrow(AgentSchema, payload);
 * ```
 */
export function validateOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  return schema.parse(value);
}

/* -------------------------------------------------------------------------- */
/* Convenience validators (one-liners for common entities)                     */
/* -------------------------------------------------------------------------- */

/** Validate an Agent payload. */
export function validateAgent(value: unknown): ValidationResult<z.infer<typeof AgentSchema>> {
  return validate(AgentSchema, value);
}

/** Validate a Wallet payload. */
export function validateWallet(value: unknown): ValidationResult<z.infer<typeof WalletSchema>> {
  return validate(WalletSchema, value);
}

/** Validate a Policy payload. */
export function validatePolicy(value: unknown): ValidationResult<z.infer<typeof PolicySchema>> {
  return validate(PolicySchema, value);
}

/** Validate a Budget payload. */
export function validateBudget(value: unknown): ValidationResult<z.infer<typeof BudgetSchema>> {
  return validate(BudgetSchema, value);
}

/** Validate a Transaction payload. */
export function validateTransaction(
  value: unknown,
): ValidationResult<z.infer<typeof TransactionSchema>> {
  return validate(TransactionSchema, value);
}

/** Validate a CreateTransactionInput payload. */
export function validateCreateTransactionInput(
  value: unknown,
): ValidationResult<z.infer<typeof CreateTransactionInputSchema>> {
  return validate(CreateTransactionInputSchema, value);
}

/** Validate a CreateAgentInput payload. */
export function validateCreateAgentInput(
  value: unknown,
): ValidationResult<z.infer<typeof CreateAgentInputSchema>> {
  return validate(CreateAgentInputSchema, value);
}

/** Validate a CreatePolicyInput payload. */
export function validateCreatePolicyInput(
  value: unknown,
): ValidationResult<z.infer<typeof CreatePolicyInputSchema>> {
  return validate(CreatePolicyInputSchema, value);
}

/** Validate a CreateBudgetInput payload. */
export function validateCreateBudgetInput(
  value: unknown,
): ValidationResult<z.infer<typeof CreateBudgetInputSchema>> {
  return validate(CreateBudgetInputSchema, value);
}

/** Validate a TransferInput payload. */
export function validateTransferInput(
  value: unknown,
): ValidationResult<z.infer<typeof TransferInputSchema>> {
  return validate(TransferInputSchema, value);
}

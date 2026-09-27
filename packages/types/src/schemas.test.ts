import { describe, it, expect } from 'vitest';
import {
  AgentSchema,
  WalletSchema,
  PolicySchema,
  BudgetSchema,
  TransactionSchema,
  CreateAgentInputSchema,
  CreateWalletInputSchema,
  CreatePolicyInputSchema,
  CreateBudgetInputSchema,
  CreateTransactionInputSchema,
  TransferInputSchema,
  validate,
  validateOrThrow,
  validateAgent,
  validateWallet,
  validatePolicy,
  validateBudget,
  validateTransaction,
  validateCreateTransactionInput,
  validateCreateAgentInput,
  validateCreatePolicyInput,
  validateCreateBudgetInput,
  validateTransferInput,
} from './schemas.js';

/* -------------------------------------------------------------------------- */
/* Valid payloads — should pass                                                */
/* -------------------------------------------------------------------------- */

describe('Zod schemas — valid payloads', () => {
  const validAgent = {
    id: 'agt_1',
    organizationId: 'org_1',
    name: 'Finance Bot',
    role: 'FINANCE',
    status: 'ACTIVE',
    capabilities: ['payments', 'budgets'],
    metadata: { version: 2 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const validWallet = {
    id: 'wlt_1',
    organizationId: 'org_1',
    stellarAddress: 'GABC1234567890ABCDEF',
    walletType: 'TREASURY',
    network: 'TESTNET',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const validPolicy = {
    id: 'pol_1',
    organizationId: 'org_1',
    name: 'Daily Limit',
    type: 'MAX_AMOUNT',
    configuration: { maxAmount: 1000 },
    priority: 1,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const validBudget = {
    id: 'bud_1',
    organizationId: 'org_1',
    name: 'Monthly Ops',
    currency: 'USDC',
    limitAmount: '10000',
    spent: '2500',
    remaining: '7500',
    period: 'MONTHLY',
    periodStart: '2026-01-01T00:00:00.000Z',
    rollover: false,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const validTransaction = {
    id: 'txn_1',
    organizationId: 'org_1',
    walletId: 'wlt_1',
    asset: 'USDC',
    amount: '100.50',
    recipientAddress: 'GDEF1234567890ABCDEF',
    status: 'COMPLETED',
    riskScore: 0.2,
    riskBand: 'LOW',
    requiresApproval: false,
    confirmationCount: 3,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('AgentSchema validates a correct agent', () => {
    const result = AgentSchema.safeParse(validAgent);
    expect(result.success).toBe(true);
  });

  it('WalletSchema validates a correct wallet', () => {
    const result = WalletSchema.safeParse(validWallet);
    expect(result.success).toBe(true);
  });

  it('PolicySchema validates a correct policy', () => {
    const result = PolicySchema.safeParse(validPolicy);
    expect(result.success).toBe(true);
  });

  it('BudgetSchema validates a correct budget', () => {
    const result = BudgetSchema.safeParse(validBudget);
    expect(result.success).toBe(true);
  });

  it('TransactionSchema validates a correct transaction', () => {
    const result = TransactionSchema.safeParse(validTransaction);
    expect(result.success).toBe(true);
  });

  it('AgentSchema allows optional fields to be missing', () => {
    const minimal = {
      id: 'agt_2',
      organizationId: 'org_1',
      name: 'Minimal Bot',
      role: 'FINANCE',
      status: 'ACTIVE',
      capabilities: [],
      metadata: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(AgentSchema.safeParse(minimal).success).toBe(true);
  });

  it('TransactionSchema allows nullable optional fields', () => {
    const tx = {
      ...validTransaction,
      agentId: null,
      policyId: null,
      memo: null,
    };
    expect(TransactionSchema.safeParse(tx).success).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Invalid payloads — should fail with descriptive errors                      */
/* -------------------------------------------------------------------------- */

describe('Zod schemas — invalid payloads', () => {
  it('AgentSchema rejects missing required fields', () => {
    const result = AgentSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.path.join('.'));
      expect(issues).toContain('id');
      expect(issues).toContain('name');
      expect(issues).toContain('role');
      expect(issues).toContain('status');
      expect(issues).toContain('capabilities');
    }
  });

  it('AgentSchema rejects invalid enum values', () => {
    const result = AgentSchema.safeParse({
      id: 'agt_1',
      organizationId: 'org_1',
      name: 'Bot',
      role: 'INVALID_ROLE',
      status: 'ACTIVE',
      capabilities: [],
      metadata: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('Invalid');
    }
  });

  it('WalletSchema rejects missing stellarAddress', () => {
    const result = WalletSchema.safeParse({
      id: 'wlt_1',
      organizationId: 'org_1',
      walletType: 'TREASURY',
      network: 'TESTNET',
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('PolicySchema rejects invalid policy type', () => {
    const result = PolicySchema.safeParse({
      id: 'pol_1',
      organizationId: 'org_1',
      name: 'Test',
      type: 'INVALID_TYPE',
      configuration: {},
      priority: 1,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('BudgetSchema rejects missing limitAmount', () => {
    const result = BudgetSchema.safeParse({
      id: 'bud_1',
      organizationId: 'org_1',
      name: 'Test',
      currency: 'USDC',
      spent: '0',
      remaining: '100',
      period: 'MONTHLY',
      periodStart: '2026-01-01T00:00:00.000Z',
      rollover: false,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('TransactionSchema rejects invalid status', () => {
    const result = TransactionSchema.safeParse({
      id: 'txn_1',
      organizationId: 'org_1',
      walletId: 'wlt_1',
      asset: 'USDC',
      amount: '100',
      recipientAddress: 'GABC',
      status: 'INVALID_STATUS',
      riskScore: 0,
      riskBand: 'LOW',
      requiresApproval: false,
      confirmationCount: 0,
      metadata: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('TransactionSchema rejects non-numeric riskScore', () => {
    const result = TransactionSchema.safeParse({
      id: 'txn_1',
      organizationId: 'org_1',
      walletId: 'wlt_1',
      asset: 'USDC',
      amount: '100',
      recipientAddress: 'GABC',
      status: 'COMPLETED',
      riskScore: 'high',
      riskBand: 'LOW',
      requiresApproval: false,
      confirmationCount: 0,
      metadata: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('AgentSchema rejects completely invalid input types', () => {
    expect(AgentSchema.safeParse('not an object').success).toBe(false);
    expect(AgentSchema.safeParse(null).success).toBe(false);
    expect(AgentSchema.safeParse(undefined).success).toBe(false);
    expect(AgentSchema.safeParse(42).success).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* DTO input schemas                                                           */
/* -------------------------------------------------------------------------- */

describe('Zod schemas — DTO inputs', () => {
  it('CreateAgentInputSchema requires name', () => {
    expect(CreateAgentInputSchema.safeParse({}).success).toBe(false);
    expect(CreateAgentInputSchema.safeParse({ name: '' }).success).toBe(false);
    expect(CreateAgentInputSchema.safeParse({ name: 'Bot' }).success).toBe(true);
  });

  it('CreateWalletInputSchema accepts empty input (all optional)', () => {
    expect(CreateWalletInputSchema.safeParse({}).success).toBe(true);
  });

  it('CreatePolicyInputSchema requires name and type', () => {
    expect(CreatePolicyInputSchema.safeParse({}).success).toBe(false);
    expect(
      CreatePolicyInputSchema.safeParse({ name: 'Test', type: 'MAX_AMOUNT', configuration: {} })
        .success,
    ).toBe(true);
  });

  it('CreateBudgetInputSchema requires name and limitAmount', () => {
    expect(CreateBudgetInputSchema.safeParse({}).success).toBe(false);
    expect(CreateBudgetInputSchema.safeParse({ name: 'Budget', limitAmount: 1000 }).success).toBe(
      true,
    );
    expect(CreateBudgetInputSchema.safeParse({ name: 'Budget', limitAmount: '1000' }).success).toBe(
      true,
    );
  });

  it('CreateTransactionInputSchema requires walletId, asset, amount, recipientAddress', () => {
    const result = CreateTransactionInputSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('walletId');
      expect(paths).toContain('asset');
      expect(paths).toContain('amount');
      expect(paths).toContain('recipientAddress');
    }
  });

  it('CreateTransactionInputSchema validates a complete input', () => {
    const result = CreateTransactionInputSchema.safeParse({
      walletId: 'wlt_1',
      asset: 'USDC',
      amount: '100',
      recipientAddress: 'GABC',
    });
    expect(result.success).toBe(true);
  });

  it('TransferInputSchema requires recipientAddress, asset, amount', () => {
    expect(TransferInputSchema.safeParse({}).success).toBe(false);
    expect(
      TransferInputSchema.safeParse({
        recipientAddress: 'GABC',
        asset: 'USDC',
        amount: 50,
      }).success,
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Validation helpers                                                          */
/* -------------------------------------------------------------------------- */

describe('Zod schemas — validation helpers', () => {
  const validAgent = {
    id: 'agt_1',
    organizationId: 'org_1',
    name: 'Finance Bot',
    role: 'FINANCE',
    status: 'ACTIVE',
    capabilities: [],
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('validate returns success for valid data', () => {
    const result = validate(AgentSchema, validAgent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Finance Bot');
    }
  });

  it('validate returns error for invalid data', () => {
    const result = validate(AgentSchema, {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it('validateOrThrow returns data for valid input', () => {
    const data = validateOrThrow(AgentSchema, validAgent);
    expect(data.name).toBe('Finance Bot');
  });

  it('validateOrThrow throws ZodError for invalid input', () => {
    expect(() => validateOrThrow(AgentSchema, {})).toThrow();
  });

  it('validateAgent works for agents', () => {
    expect(validateAgent(validAgent).success).toBe(true);
    expect(validateAgent({}).success).toBe(false);
  });

  it('validateWallet works for wallets', () => {
    const wallet = {
      id: 'wlt_1',
      organizationId: 'org_1',
      stellarAddress: 'GABC',
      walletType: 'TREASURY',
      network: 'TESTNET',
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(validateWallet(wallet).success).toBe(true);
    expect(validateWallet({}).success).toBe(false);
  });

  it('validatePolicy works for policies', () => {
    const policy = {
      id: 'pol_1',
      organizationId: 'org_1',
      name: 'Limit',
      type: 'MAX_AMOUNT',
      configuration: { maxAmount: 100 },
      priority: 1,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(validatePolicy(policy).success).toBe(true);
    expect(validatePolicy({}).success).toBe(false);
  });

  it('validateBudget works for budgets', () => {
    const budget = {
      id: 'bud_1',
      organizationId: 'org_1',
      name: 'Monthly',
      currency: 'USDC',
      limitAmount: '1000',
      spent: '0',
      remaining: '1000',
      period: 'MONTHLY',
      periodStart: '2026-01-01T00:00:00.000Z',
      rollover: false,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(validateBudget(budget).success).toBe(true);
    expect(validateBudget({}).success).toBe(false);
  });

  it('validateTransaction works for transactions', () => {
    const tx = {
      id: 'txn_1',
      organizationId: 'org_1',
      walletId: 'wlt_1',
      asset: 'USDC',
      amount: '100',
      recipientAddress: 'GABC',
      status: 'COMPLETED',
      riskScore: 0.1,
      riskBand: 'LOW',
      requiresApproval: false,
      confirmationCount: 1,
      metadata: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(validateTransaction(tx).success).toBe(true);
    expect(validateTransaction({}).success).toBe(false);
  });

  it('validateCreateTransactionInput works for transaction inputs', () => {
    const input = {
      walletId: 'wlt_1',
      asset: 'USDC',
      amount: '100',
      recipientAddress: 'GABC',
    };
    expect(validateCreateTransactionInput(input).success).toBe(true);
    expect(validateCreateTransactionInput({}).success).toBe(false);
  });

  it('validateCreateAgentInput works for agent inputs', () => {
    expect(validateCreateAgentInput({ name: 'Bot' }).success).toBe(true);
    expect(validateCreateAgentInput({}).success).toBe(false);
  });

  it('validateCreatePolicyInput works for policy inputs', () => {
    expect(
      validateCreatePolicyInput({ name: 'Test', type: 'MAX_AMOUNT', configuration: {} }).success,
    ).toBe(true);
    expect(validateCreatePolicyInput({}).success).toBe(false);
  });

  it('validateCreateBudgetInput works for budget inputs', () => {
    expect(validateCreateBudgetInput({ name: 'Budget', limitAmount: 1000 }).success).toBe(true);
    expect(validateCreateBudgetInput({}).success).toBe(false);
  });

  it('validateTransferInput works for transfer inputs', () => {
    expect(
      validateTransferInput({ recipientAddress: 'GABC', asset: 'USDC', amount: 50 }).success,
    ).toBe(true);
    expect(validateTransferInput({}).success).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Schema type compatibility with TypeScript interfaces                        */
/* -------------------------------------------------------------------------- */

describe('Zod schemas — type compatibility', () => {
  it('AgentSchema output type matches the entity interface', () => {
    type SchemaType = typeof AgentSchema._output;
    // Verify key fields exist
    const agent: SchemaType = {
      id: '1',
      organizationId: '1',
      name: 'Bot',
      role: 'FINANCE',
      status: 'ACTIVE',
      capabilities: [],
      metadata: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(agent.id).toBe('1');
  });

  it('WalletSchema output type has all required fields', () => {
    type SchemaType = typeof WalletSchema._output;
    const wallet: SchemaType = {
      id: '1',
      organizationId: '1',
      stellarAddress: 'GABC',
      walletType: 'TREASURY',
      network: 'TESTNET',
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(wallet.stellarAddress).toBe('GABC');
  });

  it('TransactionSchema output type has all required fields', () => {
    type SchemaType = typeof TransactionSchema._output;
    const tx: SchemaType = {
      id: '1',
      organizationId: '1',
      walletId: '1',
      asset: 'USDC',
      amount: '100',
      recipientAddress: 'GABC',
      status: 'COMPLETED',
      riskScore: 0,
      riskBand: 'LOW',
      requiresApproval: false,
      confirmationCount: 0,
      metadata: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(tx.status).toBe('COMPLETED');
  });
});

import type { CreateAgentParams } from '@astroid/types';
import { AstroidValidationError } from './errors.js';

/**
 * Validates a CreateAgentParams payload.
 * Ensures required fields (name, capabilities, initialBudget) are present and correctly typed.
 * Throws {@link AstroidValidationError} when invalid.
 *
 * @param params The agent creation parameters to validate.
 * @throws {AstroidValidationError} If any required field is missing or invalid.
 *
 * @example
 * ```ts
 * validateCreateAgentParams({
 *   name: 'MyAgent',
 *   capabilities: ['trade'],
 *   initialBudget: { currency: 'USDC', amount: '100' }
 * });
 * ```
 */
export function validateCreateAgentParams(params: unknown): asserts params is CreateAgentParams {
  if (!params || typeof params !== 'object') {
    throw new AstroidValidationError('Agent creation parameters must be a non-null object.', {
      received: typeof params,
    });
  }

  const p = params as Record<string, unknown>;

  // Validate name
  if (typeof p['name'] !== 'string' || p['name'].trim() === '') {
    throw new AstroidValidationError(
      'Agent validation failed: "name" is required and must be a non-empty string.',
      {
        field: 'name',
        received: p['name'],
      },
    );
  }

  // Validate capabilities
  if (!Array.isArray(p['capabilities']) || p['capabilities'].length === 0) {
    throw new AstroidValidationError(
      'Agent validation failed: "capabilities" is required and must be a non-empty array of strings.',
      {
        field: 'capabilities',
        received: p['capabilities'],
      },
    );
  }

  for (const cap of p['capabilities']) {
    if (typeof cap !== 'string' || cap.trim() === '') {
      throw new AstroidValidationError(
        'Agent validation failed: every capability must be a non-empty string.',
        {
          field: 'capabilities',
          received: cap,
        },
      );
    }
  }

  // Validate initialBudget
  const budget = p['initialBudget'];
  if (!budget || typeof budget !== 'object') {
    throw new AstroidValidationError(
      'Agent validation failed: "initialBudget" is required and must be an object.',
      {
        field: 'initialBudget',
        received: budget,
      },
    );
  }

  const b = budget as Record<string, unknown>;

  if (typeof b['currency'] !== 'string' || b['currency'].trim() === '') {
    throw new AstroidValidationError(
      'Agent validation failed: "initialBudget.currency" is required and must be a non-empty string.',
      {
        field: 'initialBudget.currency',
        received: b['currency'],
      },
    );
  }

  if (typeof b['amount'] !== 'string' || b['amount'].trim() === '') {
    throw new AstroidValidationError(
      'Agent validation failed: "initialBudget.amount" is required and must be a non-empty string.',
      {
        field: 'initialBudget.amount',
        received: b['amount'],
      },
    );
  }

  // Validate amount format / bounds (must be a valid positive numeric string)
  const numAmount = Number(b['amount']);
  if (isNaN(numAmount) || numAmount < 0) {
    throw new AstroidValidationError(
      'Agent validation failed: "initialBudget.amount" must be a valid non-negative number string.',
      {
        field: 'initialBudget.amount',
        received: b['amount'],
      },
    );
  }
}

/**
 * Type guard to check if a payload satisfies CreateAgentParams without throwing.
 *
 * @param params The payload to check.
 * @returns True if valid CreateAgentParams, false otherwise.
 */
export function isValidCreateAgentParams(params: unknown): params is CreateAgentParams {
  try {
    validateCreateAgentParams(params);
    return true;
  } catch {
    return false;
  }
}

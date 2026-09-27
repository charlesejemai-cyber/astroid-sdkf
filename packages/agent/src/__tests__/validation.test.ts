import { describe, expect, it } from 'vitest';
import { validateCreateAgentParams, isValidCreateAgentParams } from '../validation.js';
import { AstroidValidationError } from '../errors.js';

describe('Agent validation schemas', () => {
  describe('validateCreateAgentParams', () => {
    it('accepts a valid agent creation payload', () => {
      const validPayload = {
        name: 'TradingBot',
        capabilities: ['swap', 'arbitrage'],
        initialBudget: {
          currency: 'USDC',
          amount: '500',
        },
      };

      expect(() => validateCreateAgentParams(validPayload)).not.toThrow();
      expect(isValidCreateAgentParams(validPayload)).toBe(true);
    });

    it('throws AstroidValidationError when payload is not an object', () => {
      expect(() => validateCreateAgentParams(null)).toThrow(AstroidValidationError);
      expect(() => validateCreateAgentParams('not-an-object')).toThrow(AstroidValidationError);
      expect(isValidCreateAgentParams(undefined)).toBe(false);
    });

    it('validates required name field', () => {
      const missingName = {
        capabilities: ['swap'],
        initialBudget: { currency: 'USDC', amount: '100' },
      };

      expect(() => validateCreateAgentParams(missingName)).toThrowError(/name/i);
      expect(isValidCreateAgentParams({ ...missingName, name: '' })).toBe(false);
      expect(isValidCreateAgentParams({ ...missingName, name: 123 })).toBe(false);
    });

    it('validates required capabilities field', () => {
      const missingCaps = {
        name: 'Bot',
        initialBudget: { currency: 'USDC', amount: '100' },
      };

      expect(() => validateCreateAgentParams(missingCaps)).toThrowError(/capabilities/i);
      expect(isValidCreateAgentParams({ ...missingCaps, capabilities: [] })).toBe(false);
      expect(isValidCreateAgentParams({ ...missingCaps, capabilities: ['valid', 123] })).toBe(
        false,
      );
    });

    it('validates required initialBudget field and nested properties', () => {
      const missingBudget = {
        name: 'Bot',
        capabilities: ['swap'],
      };

      expect(() => validateCreateAgentParams(missingBudget)).toThrowError(/initialBudget/i);
      expect(isValidCreateAgentParams({ ...missingBudget, initialBudget: {} })).toBe(false);
      expect(
        isValidCreateAgentParams({
          ...missingBudget,
          initialBudget: { currency: '', amount: '100' },
        }),
      ).toBe(false);
      expect(
        isValidCreateAgentParams({
          ...missingBudget,
          initialBudget: { currency: 'USDC', amount: '' },
        }),
      ).toBe(false);
      expect(
        isValidCreateAgentParams({
          ...missingBudget,
          initialBudget: { currency: 'USDC', amount: 'invalid-number' },
        }),
      ).toBe(false);
      expect(
        isValidCreateAgentParams({
          ...missingBudget,
          initialBudget: { currency: 'USDC', amount: '-50' },
        }),
      ).toBe(false);
    });
  });
});

/**
 * Unit tests for the runtime type guards and prototype-chain integrity of the
 * error hierarchy (issue #240).
 *
 * Covers:
 * - Every exported guard, including positive and negative cases
 * - Guards rejecting plain `Error`, DOM exceptions, nullish values, and
 *   structurally-identical look-alikes
 * - Guards narrowing to their specific class so subclass-only properties
 *   (`retryAfter`, `fieldErrors`) are reachable in a `catch` block
 * - `instanceof` reliability through the whole hierarchy, which is what the
 *   `Object.setPrototypeOf` / `new.target` handling in `base.ts` exists to
 *   guarantee when the package is transpiled to older targets
 * - Extensibility: user-defined subclasses keep their own `name` and chain
 */

import { describe, it, expect } from 'vitest';
import {
  AstroidError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  ForbiddenError,
  InsufficientFundsError,
  InternalServerError,
  NetworkError,
  NotFoundError,
  PolicyViolationError,
  RateLimitError,
  ServerError,
  ValidationError,
  isAstroidError,
  isAuthenticationError,
  isConflictError,
  isForbiddenError,
  isInsufficientFundsError,
  isNetworkError,
  isNotFoundError,
  isPolicyViolationError,
  isRateLimitError,
  isServerError,
  isValidationError,
  toAstroidError,
} from '../index.js';

/** One instance of every concrete error class in the hierarchy. */
function allErrors(): AstroidError[] {
  return [
    new AstroidError('base', { code: 'UNKNOWN' }),
    new AuthenticationError('auth', { code: 'AUTHENTICATION_ERROR' }),
    new ForbiddenError('forbid', { code: 'FORBIDDEN' }),
    new ValidationError('valid', { code: 'VALIDATION_ERROR' }),
    new NotFoundError('nf', { code: 'NOT_FOUND' }),
    new ConflictError('conflict', { code: 'CONFLICT' }),
    new PolicyViolationError('policy', { code: 'POLICY_VIOLATION' }),
    new InsufficientFundsError('funds', { code: 'INSUFFICIENT_FUNDS' }),
    new RateLimitError('rate', { code: 'RATE_LIMITED' }),
    new NetworkError('net', { code: 'NETWORK_ERROR' }),
    new InternalServerError('srv', { code: 'INTERNAL_ERROR' }),
  ];
}

/** Values that are never Astroid errors, whatever a guard is asked. */
function nonErrors(): unknown[] {
  return [
    undefined,
    null,
    0,
    42,
    '',
    'PolicyViolationError',
    true,
    {},
    [],
    Object.create(null),
    new Error('plain'),
    new TypeError('type'),
    new RangeError('range'),
    new SyntaxError('syntax'),
    Promise.resolve(new RateLimitError('rate', { code: 'RATE_LIMITED' })),
    // Structurally identical look-alike: guards are `instanceof`-based, so a
    // hand-rolled object must not be mistaken for a real SDK error.
    { name: 'RateLimitError', message: 'x', code: 'RATE_LIMITED', stack: 'fake' },
  ];
}

describe('type guards (issue #240)', () => {
  describe('isAstroidError', () => {
    it('accepts every error in the hierarchy', () => {
      for (const err of allErrors()) {
        expect(isAstroidError(err)).toBe(true);
      }
    });

    it('rejects non-Astroid values', () => {
      for (const value of nonErrors()) {
        expect(isAstroidError(value)).toBe(false);
      }
    });
  });

  describe('per-class guards', () => {
    it('isAuthenticationError matches only AuthenticationError', () => {
      const err = new AuthenticationError('a', { code: 'AUTHENTICATION_ERROR' });
      expect(isAuthenticationError(err)).toBe(true);
      expect(isAuthenticationError(new ForbiddenError('f', { code: 'FORBIDDEN' }))).toBe(false);
      expect(isAuthenticationError(new AstroidError('b', { code: 'UNKNOWN' }))).toBe(false);
    });

    it('isForbiddenError matches ForbiddenError and its AuthorizationError alias', () => {
      expect(isForbiddenError(new ForbiddenError('f', { code: 'FORBIDDEN' }))).toBe(true);
      // AuthorizationError is the same class, so the guard must accept it.
      expect(AuthorizationError).toBe(ForbiddenError);
      expect(isForbiddenError(new AuthorizationError('a', { code: 'FORBIDDEN' }))).toBe(true);
      expect(isForbiddenError(new AuthenticationError('a', { code: 'AUTHENTICATION_ERROR' }))).toBe(
        false,
      );
    });

    it('isValidationError matches only ValidationError', () => {
      expect(isValidationError(new ValidationError('v', { code: 'VALIDATION_ERROR' }))).toBe(true);
      expect(isValidationError(new AuthenticationError('a', { code: 'AUTHENTICATION_ERROR' }))).toBe(
        false,
      );
    });

    it('isNotFoundError matches only NotFoundError', () => {
      expect(isNotFoundError(new NotFoundError('n', { code: 'NOT_FOUND' }))).toBe(true);
      expect(isNotFoundError(new ConflictError('c', { code: 'CONFLICT' }))).toBe(false);
    });

    it('isConflictError matches only ConflictError', () => {
      expect(isConflictError(new ConflictError('c', { code: 'CONFLICT' }))).toBe(true);
      expect(isConflictError(new NotFoundError('n', { code: 'NOT_FOUND' }))).toBe(false);
    });

    it('isPolicyViolationError matches only PolicyViolationError', () => {
      expect(isPolicyViolationError(new PolicyViolationError('p', { code: 'POLICY_VIOLATION' }))).toBe(
        true,
      );
      // A spending-limit rejection is still a policy violation, not a budget one.
      expect(
        isPolicyViolationError(new PolicyViolationError('p', { code: 'RISK_THRESHOLD_EXCEEDED' })),
      ).toBe(true);
      expect(isPolicyViolationError(new ValidationError('v', { code: 'VALIDATION_ERROR' }))).toBe(
        false,
      );
    });

    it('isInsufficientFundsError matches only InsufficientFundsError', () => {
      expect(
        isInsufficientFundsError(new InsufficientFundsError('i', { code: 'INSUFFICIENT_FUNDS' })),
      ).toBe(true);
      expect(isInsufficientFundsError(new ValidationError('v', { code: 'VALIDATION_ERROR' }))).toBe(
        false,
      );
    });

    it('isRateLimitError matches only RateLimitError', () => {
      const err = new RateLimitError('r', { code: 'RATE_LIMITED', details: { retryAfter: 3 } });
      expect(isRateLimitError(err)).toBe(true);
      // Server outages and transport failures are retryable too, but are not
      // rate limits — callers back off differently for each.
      expect(isRateLimitError(new NetworkError('n', { code: 'NETWORK_ERROR' }))).toBe(false);
      expect(isRateLimitError(new InternalServerError('s', { code: 'INTERNAL_ERROR' }))).toBe(false);
    });

    it('isNetworkError matches only NetworkError', () => {
      expect(isNetworkError(new NetworkError('n', { code: 'NETWORK_ERROR' }))).toBe(true);
      expect(isNetworkError(new InternalServerError('s', { code: 'INTERNAL_ERROR' }))).toBe(false);
    });

    it('isServerError matches InternalServerError and its ServerError alias', () => {
      expect(isServerError(new InternalServerError('s', { code: 'INTERNAL_ERROR' }))).toBe(true);
      expect(ServerError).toBe(InternalServerError);
      expect(isServerError(new ServerError('s', { code: 'INTERNAL_ERROR' }))).toBe(true);
      expect(isServerError(new NetworkError('n', { code: 'NETWORK_ERROR' }))).toBe(false);
    });

    it('rejects non-Astroid values for every guard', () => {
      const guards = [
        isAuthenticationError,
        isForbiddenError,
        isValidationError,
        isNotFoundError,
        isConflictError,
        isPolicyViolationError,
        isInsufficientFundsError,
        isRateLimitError,
        isNetworkError,
        isServerError,
      ];
      for (const guard of guards) {
        for (const value of nonErrors()) {
          expect(guard(value)).toBe(false);
        }
      }
    });

    it('each guard is false for every sibling error class', () => {
      const pairs: Array<[(v: unknown) => boolean, new (...a: never[]) => AstroidError]> = [
        [isAuthenticationError, AuthenticationError],
        [isForbiddenError, ForbiddenError],
        [isValidationError, ValidationError],
        [isNotFoundError, NotFoundError],
        [isConflictError, ConflictError],
        [isPolicyViolationError, PolicyViolationError],
        [isInsufficientFundsError, InsufficientFundsError],
        [isRateLimitError, RateLimitError],
        [isNetworkError, NetworkError],
        [isServerError, InternalServerError],
      ];

      for (const [guard, ctor] of pairs) {
        for (const err of allErrors()) {
          if (err instanceof ctor) continue; // the guard's own class
          expect(guard(err)).toBe(false);
        }
      }
    });
  });

  describe('narrowing a catch block', () => {
    it('exposes subclass-only properties after narrowing', async () => {
      const err = await toAstroidError(
        new Response(null, { status: 429, headers: { 'retry-after': '7' } }),
      );

      // This is the whole point of the typed hierarchy: `retryAfter` is only
      // reachable once the guard narrows the type.
      expect(isRateLimitError(err)).toBe(true);
      if (isRateLimitError(err)) {
        expect(err.retryAfter).toBe(7);
        expect(err.isRetryable).toBe(true);
      } else {
        throw new Error('expected a RateLimitError');
      }
    });

    it('exposes fieldErrors after narrowing a ValidationError', () => {
      const err = new ValidationError('v', {
        code: 'VALIDATION_ERROR',
        details: { fields: { email: ['required'] } },
      });

      expect(isValidationError(err)).toBe(true);
      if (isValidationError(err)) {
        expect(err.fieldErrors).toEqual({ email: ['required'] });
      }
    });
  });
});

describe('hierarchy integrity across transpile targets', () => {
  it('keeps the prototype chain intact for every subclass', () => {
    for (const err of allErrors()) {
      const ctor = err.constructor as new () => AstroidError;
      expect(Object.getPrototypeOf(err)).toBe(ctor.prototype);
    }
  });

  it('resolves instanceof through every level of the hierarchy', () => {
    const err = new RateLimitError('r', { code: 'RATE_LIMITED' });
    expect(err instanceof RateLimitError).toBe(true);
    expect(err instanceof AstroidError).toBe(true);
    expect(err instanceof Error).toBe(true);
    expect(err instanceof ValidationError).toBe(false);
  });

  it('names each error after its own class, not the base class', () => {
    expect(new AuthenticationError('a', { code: 'AUTHENTICATION_ERROR' }).name).toBe(
      'AuthenticationError',
    );
    expect(new RateLimitError('r', { code: 'RATE_LIMITED' }).name).toBe('RateLimitError');
    // An unmapped code must not rename the instance to `AstroidError`.
    expect(new AstroidError('b', { code: 'SOMETHING_NEW' }).name).toBe('AstroidError');
  });

  it('supports user-defined subclasses without losing name or chain', () => {
    // `new.target` in the base constructor is what makes this work: a subclass
    // gets its own `name` and its own prototype, which is the property a
    // downleveled `extends Error` would otherwise drop.
    //
    // Note on coverage: the `Object.setPrototypeOf(this, new.target.prototype)`
    // call in `base.ts` is *not* observable from these tests — this package
    // compiles to native ES2022 classes (tsc `target: ES2022`, tsup
    // `target: 'es2022'`), where `extends Error` preserves the chain on its own,
    // so deleting that line still passes here. It is not dead code, though:
    // compiling `base.ts` + `classes.ts` with `--target es5` shows the repair
    // keeping `instanceof` and `name` intact for every class (an equivalent
    // class without it fails `instanceof` under ES5), which matters for
    // consumers who bundle the CJS output through an older toolchain. The
    // `name` assertions below *are* load-bearing and do catch a regression.
    class InsufficientBalanceError extends InsufficientFundsError {}
    class MyCustomError extends ValidationError {
      override get fieldErrors() {
        return { custom: ['always'] };
      }
    }

    const funds = new InsufficientBalanceError('no funds', { code: 'INSUFFICIENT_BALANCE' });
    expect(funds.name).toBe('InsufficientBalanceError');
    expect(funds).toBeInstanceOf(InsufficientBalanceError);
    expect(funds).toBeInstanceOf(InsufficientFundsError);
    expect(funds).toBeInstanceOf(AstroidError);
    expect(isInsufficientFundsError(funds)).toBe(true);

    const custom = new MyCustomError('bad', { code: 'VALIDATION_ERROR' });
    expect(custom.name).toBe('MyCustomError');
    expect(custom).toBeInstanceOf(MyCustomError);
    expect(custom).toBeInstanceOf(ValidationError);
    expect(custom.fieldErrors).toEqual({ custom: ['always'] });
    expect(isValidationError(custom)).toBe(true);
  });

  it('preserves a usable stack trace on every subclass', () => {
    for (const err of allErrors()) {
      expect(typeof err.stack).toBe('string');
      expect(err.stack!.length).toBeGreaterThan(0);
    }
  });

  it('keeps status, statusCode, code, and details aligned', () => {
    const err = new NotFoundError('gone', {
      code: 'NOT_FOUND',
      status: 404,
      details: { id: 'wal_1' },
    });

    expect(err.status).toBe(404);
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.errorCode).toBe('NOT_FOUND');
    expect(err.details).toEqual({ id: 'wal_1' });
  });

  it('defaults statusCode to status when only status is supplied', () => {
    const err = new ValidationError('bad', { code: 'VALIDATION_ERROR', status: 422 });

    expect(err.status).toBe(422);
    expect(err.statusCode).toBe(422);
  });
});

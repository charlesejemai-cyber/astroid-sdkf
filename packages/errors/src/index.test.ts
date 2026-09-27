import { describe, it, expect } from 'vitest';
import {
  AstroidError,
  AuthenticationError,
  AuthorizationError,
  ForbiddenError,
  ConflictError,
  InsufficientFundsError,
  BudgetExceededError,
  ApprovalRequiredError,
  NetworkError,
  NotFoundError,
  PolicyViolationError,
  RateLimitError,
  InternalServerError,
  ServerError,
  ValidationError,
  errorClassForCode,
  codeForStatus,
  statusCodeToCode,
  fromApiError,
  fromStatus,
  errorFromStatus,
  fromErrorResponse,
  isAstroidError,
} from './index.js';

describe('@astroid/errors', () => {
  /* ------------------------------------------------------------------------ */
  /* errorClassForCode — complete coverage                                     */
  /* ------------------------------------------------------------------------ */

  describe('errorClassForCode', () => {
    it('maps auth codes to AuthenticationError', () => {
      expect(errorClassForCode('AUTHENTICATION_ERROR')).toBe(AuthenticationError);
      expect(errorClassForCode('UNAUTHORIZED')).toBe(AuthenticationError);
      expect(errorClassForCode('INVALID_API_KEY')).toBe(AuthenticationError);
      expect(errorClassForCode('TOKEN_EXPIRED')).toBe(AuthenticationError);
    });

    it('maps FORBIDDEN to ForbiddenError and AuthorizationError', () => {
      expect(errorClassForCode('FORBIDDEN')).toBe(ForbiddenError);
      expect(new (errorClassForCode('FORBIDDEN'))('x', { code: 'FORBIDDEN' })).toBeInstanceOf(AuthorizationError);
    });

    it('maps validation codes to ValidationError', () => {
      expect(errorClassForCode('VALIDATION_ERROR')).toBe(ValidationError);
      expect(errorClassForCode('BAD_REQUEST')).toBe(ValidationError);
    });

    it('maps NOT_FOUND to NotFoundError', () => {
      expect(errorClassForCode('NOT_FOUND')).toBe(NotFoundError);
    });

    it('maps CONFLICT to ConflictError', () => {
      expect(errorClassForCode('CONFLICT')).toBe(ConflictError);
    });

    it('maps policy codes to PolicyViolationError', () => {
      expect(errorClassForCode('POLICY_VIOLATION')).toBe(PolicyViolationError);
      expect(errorClassForCode('POLICY_REJECTED')).toBe(PolicyViolationError);
      expect(errorClassForCode('RISK_THRESHOLD_EXCEEDED')).toBe(PolicyViolationError);
    });

    it('maps BUDGET_EXCEEDED to BudgetExceededError', () => {
      expect(errorClassForCode('BUDGET_EXCEEDED')).toBe(BudgetExceededError);
    });

    it('maps insufficient funds codes to InsufficientFundsError', () => {
      expect(errorClassForCode('INSUFFICIENT_FUNDS')).toBe(InsufficientFundsError);
      expect(errorClassForCode('INSUFFICIENT_BALANCE')).toBe(InsufficientFundsError);
      expect(errorClassForCode('WALLET_FROZEN')).toBe(InsufficientFundsError);
    });

    it('maps APPROVAL_REQUIRED to ApprovalRequiredError', () => {
      expect(errorClassForCode('APPROVAL_REQUIRED')).toBe(ApprovalRequiredError);
    });

    it('maps RATE_LIMITED to RateLimitError', () => {
      expect(errorClassForCode('RATE_LIMITED')).toBe(RateLimitError);
    });

    it('maps network/timeout codes to NetworkError', () => {
      expect(errorClassForCode('NETWORK_ERROR')).toBe(NetworkError);
      expect(errorClassForCode('TIMEOUT')).toBe(NetworkError);
    });

    it('maps server codes to InternalServerError and ServerError', () => {
      expect(errorClassForCode('INTERNAL_ERROR')).toBe(InternalServerError);
      expect(errorClassForCode('SERVICE_UNAVAILABLE')).toBe(InternalServerError);
    });

    it('maps Horizon leak-through codes to InsufficientFundsError', () => {
      expect(errorClassForCode('op_underfunded')).toBe(InsufficientFundsError);
      expect(errorClassForCode('op_low_reserve')).toBe(InsufficientFundsError);
      expect(errorClassForCode('tx_insufficient_balance')).toBe(InsufficientFundsError);
    });

    it('returns AstroidError for unknown codes', () => {
      expect(errorClassForCode('SOMETHING_UNKNOWN')).toBe(AstroidError);
      expect(errorClassForCode('')).toBe(AstroidError);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* codeForStatus                                                             */
  /* ------------------------------------------------------------------------ */

  describe('codeForStatus', () => {
    it('maps all HTTP status codes to correct error codes', () => {
      expect(codeForStatus(400)).toBe('VALIDATION_ERROR');
      expect(codeForStatus(401)).toBe('AUTHENTICATION_ERROR');
      expect(codeForStatus(403)).toBe('FORBIDDEN');
      expect(codeForStatus(404)).toBe('NOT_FOUND');
      expect(codeForStatus(409)).toBe('CONFLICT');
      expect(codeForStatus(422)).toBe('VALIDATION_ERROR');
      expect(codeForStatus(429)).toBe('RATE_LIMITED');
      expect(codeForStatus(500)).toBe('INTERNAL_ERROR');
      expect(codeForStatus(502)).toBe('INTERNAL_ERROR');
      expect(codeForStatus(503)).toBe('INTERNAL_ERROR');
    });

    it('maps unknown client errors to BAD_REQUEST', () => {
      expect(codeForStatus(418)).toBe('BAD_REQUEST');
      expect(codeForStatus(451)).toBe('BAD_REQUEST');
    });

    it('stays in lockstep with statusCodeToCode for every status', () => {
      // The two spellings are one implementation; this pins that so the tables
      // cannot drift apart as statuses are added.
      for (const status of [200, 400, 401, 403, 404, 409, 418, 422, 429, 451, 500, 502, 503, 599]) {
        expect(codeForStatus(status)).toBe(statusCodeToCode(status));
      }
    });
  });

  /* ------------------------------------------------------------------------ */
  /* fromApiError — typed error construction                                   */
  /* ------------------------------------------------------------------------ */

  describe('fromApiError', () => {
    it('builds a typed error from an API error envelope', () => {
      const err = fromApiError(
        { code: 'POLICY_VIOLATION', message: 'Transaction exceeds policy limits.' },
        { status: 422, requestId: 'req_abc', details: { policyId: 'pol_1' } },
      );
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect(err).toBeInstanceOf(AstroidError);
      expect(err.code).toBe('POLICY_VIOLATION');
      expect(err.status).toBe(422);
      expect(err.requestId).toBe('req_abc');
      expect(err.details).toEqual({ policyId: 'pol_1' });
    });

    it('builds a ValidationError from VALIDATION_ERROR code', () => {
      const err = fromApiError(
        {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: { fields: { email: ['required'] } },
        },
        { status: 422 },
      );
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fieldErrors).toEqual({ email: ['required'] });
    });

    it('builds an InsufficientFundsError from INSUFFICIENT_FUNDS code', () => {
      const err = fromApiError(
        { code: 'INSUFFICIENT_FUNDS', message: 'Not enough funds' },
        { status: 402 },
      );
      expect(err).toBeInstanceOf(InsufficientFundsError);
      expect(err.code).toBe('INSUFFICIENT_FUNDS');
    });

    it('builds an InsufficientFundsError from INSUFFICIENT_BALANCE code', () => {
      const err = fromApiError(
        { code: 'INSUFFICIENT_BALANCE', message: 'Balance too low' },
        { status: 402 },
      );
      expect(err).toBeInstanceOf(InsufficientFundsError);
    });

    it('builds a PolicyViolationError from POLICY_REJECTED code', () => {
      const err = fromApiError(
        { code: 'POLICY_REJECTED', message: 'Policy check failed' },
        { status: 422 },
      );
      expect(err).toBeInstanceOf(PolicyViolationError);
    });

    it('builds a RateLimitError with retryAfter', () => {
      const err = fromApiError(
        { code: 'RATE_LIMITED', message: 'Slow down', details: { retryAfter: 60 } },
        { status: 429 },
      );
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfter).toBe(60);
    });

    it('merges context details with API details', () => {
      const err = fromApiError(
        { code: 'NOT_FOUND', message: 'Gone' },
        { status: 404, details: { resource: 'wallet' } },
      );
      expect(err.details).toEqual({ resource: 'wallet' });
    });

    it('builds a base AstroidError for unknown codes', () => {
      const err = fromApiError({ code: 'CUSTOM_CODE', message: 'Custom' }, { status: 418 });
      expect(err).toBeInstanceOf(AstroidError);
      expect(err).not.toBeInstanceOf(ValidationError);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* fromStatus — HTTP status → error class instance                            */
  /* ------------------------------------------------------------------------ */

  describe('fromStatus', () => {
    it('400 → ValidationError', () => {
      const err = fromStatus(400, 'Bad request');
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.code).toBe('VALIDATION_ERROR');
    });

    it('401 → AuthenticationError', () => {
      const err = fromStatus(401, 'Unauthorized');
      expect(err).toBeInstanceOf(AuthenticationError);
    });

    it('403 → ForbiddenError and AuthorizationError', () => {
      const err = fromStatus(403, 'Forbidden');
      expect(err).toBeInstanceOf(ForbiddenError);
      expect(err).toBeInstanceOf(AuthorizationError);
    });

    it('404 → NotFoundError', () => {
      const err = fromStatus(404, 'Not found', { requestId: 'req_x' });
      expect(err).toBeInstanceOf(NotFoundError);
      expect(err.requestId).toBe('req_x');
    });

    it('409 → ConflictError', () => {
      const err = fromStatus(409, 'Conflict');
      expect(err).toBeInstanceOf(ConflictError);
    });

    it('422 → ValidationError', () => {
      const err = fromStatus(422, 'Validation failed');
      expect(err).toBeInstanceOf(ValidationError);
    });

    it('429 → RateLimitError', () => {
      const err = fromStatus(429, 'Too many requests');
      expect(err).toBeInstanceOf(RateLimitError);
    });

    it('500 → InternalServerError and ServerError', () => {
      const err = fromStatus(500, 'Internal error');
      expect(err).toBeInstanceOf(InternalServerError);
      expect(err).toBeInstanceOf(ServerError);
    });

    it('503 → InternalServerError and ServerError', () => {
      const err = fromStatus(503, 'Service unavailable');
      expect(err).toBeInstanceOf(InternalServerError);
      expect(err).toBeInstanceOf(ServerError);
    });

    it('agrees with errorFromStatus, which delegates to the same mapping', () => {
      for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 503]) {
        const viaAlias = fromStatus(status, 'msg', { requestId: 'req_1' });
        const viaCanonical = errorFromStatus(status, 'msg', { requestId: 'req_1' });
        expect(viaAlias.constructor).toBe(viaCanonical.constructor);
        expect(viaAlias.code).toBe(viaCanonical.code);
        expect(viaAlias.statusCode).toBe(viaCanonical.statusCode);
      }
    });
  });

  /* ------------------------------------------------------------------------ */
  /* fromErrorResponse — HTTP Response → typed error                            */
  /* ------------------------------------------------------------------------ */

  describe('fromErrorResponse', () => {
    function makeResponse(
      body: unknown,
      status: number,
      headers?: Record<string, string>,
    ): Response {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      });
    }

    it('parses a standard API error envelope', async () => {
      const res = makeResponse({ error: { code: 'NOT_FOUND', message: 'Wallet not found' } }, 404, {
        'x-request-id': 'req_123',
      });

      await expect(fromErrorResponse(res)).rejects.toThrow(NotFoundError);
      try {
        await fromErrorResponse(res);
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundError);
        const ne = err as NotFoundError;
        expect(ne.code).toBe('NOT_FOUND');
        expect(ne.requestId).toBe('req_123');
      }
    });

    it('parses POLICY_VIOLATION as PolicyViolationError', async () => {
      const res = makeResponse(
        { error: { code: 'POLICY_VIOLATION', message: 'Exceeds limit' } },
        422,
      );
      await expect(fromErrorResponse(res)).rejects.toThrow(PolicyViolationError);
    });

    it('parses INSUFFICIENT_FUNDS as InsufficientFundsError', async () => {
      const res = makeResponse(
        { error: { code: 'INSUFFICIENT_FUNDS', message: 'Not enough' } },
        402,
      );
      await expect(fromErrorResponse(res)).rejects.toThrow(InsufficientFundsError);
    });

    it('parses RATE_LIMITED as RateLimitError', async () => {
      const res = makeResponse(
        { error: { code: 'RATE_LIMITED', message: 'Slow down', details: { retryAfter: 30 } } },
        429,
      );
      await expect(fromErrorResponse(res)).rejects.toThrow(RateLimitError);
    });

    it('falls back to status-based error when body has no error envelope', async () => {
      const res = makeResponse({ message: 'Something went wrong' }, 500);
      await expect(fromErrorResponse(res)).rejects.toThrow(ServerError);
    });

    it('handles empty body by falling back to status', async () => {
      const res = new Response(null, { status: 404 });
      await expect(fromErrorResponse(res)).rejects.toThrow(NotFoundError);
    });

    it('handles malformed JSON body', async () => {
      const res = new Response('not json', {
        status: 400,
        headers: { 'content-type': 'text/plain' },
      });
      await expect(fromErrorResponse(res)).rejects.toThrow(ValidationError);
    });

    it('preserves requestId from response headers', async () => {
      const res = makeResponse({ error: { code: 'CONFLICT', message: 'Already exists' } }, 409, {
        'x-request-id': 'req_xyz',
      });
      try {
        await fromErrorResponse(res);
      } catch (err) {
        const ce = err as ConflictError;
        expect(ce.requestId).toBe('req_xyz');
      }
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Error class properties and behavior                                       */
  /* ------------------------------------------------------------------------ */

  describe('error class properties', () => {
    it('marks retryable errors correctly', () => {
      expect(new RateLimitError('slow down', { code: 'RATE_LIMITED' }).isRetryable).toBe(true);
      expect(new NetworkError('offline', { code: 'NETWORK_ERROR' }).isRetryable).toBe(true);
      expect(new ServerError('oops', { code: 'INTERNAL_ERROR' }).isRetryable).toBe(true);
      expect(new NotFoundError('nope', { code: 'NOT_FOUND' }).isRetryable).toBe(false);
      expect(new ValidationError('bad', { code: 'VALIDATION_ERROR' }).isRetryable).toBe(false);
    });

    it('exposes retryAfter on RateLimitError', () => {
      const err = new RateLimitError('slow down', {
        code: 'RATE_LIMITED',
        details: { retryAfter: 30 },
      });
      expect(err.retryAfter).toBe(30);
    });

    it('returns undefined for retryAfter when not set', () => {
      const err = new RateLimitError('slow down', { code: 'RATE_LIMITED' });
      expect(err.retryAfter).toBeUndefined();
    });

    it('exposes fieldErrors on ValidationError', () => {
      const err = new ValidationError('invalid', {
        code: 'VALIDATION_ERROR',
        details: { fields: { email: ['must be a valid email'] } },
      });
      expect(err.fieldErrors).toEqual({ email: ['must be a valid email'] });
    });

    it('returns undefined for fieldErrors when not set', () => {
      const err = new ValidationError('bad', { code: 'VALIDATION_ERROR' });
      expect(err.fieldErrors).toBeUndefined();
    });

    it('preserves cause for stack trace', () => {
      const cause = new Error('original');
      const err = new ValidationError('wrapped', {
        code: 'VALIDATION_ERROR',
        cause,
      });
      expect(err.cause).toBe(cause);
      expect(err.stack).toBeDefined();
    });

    it('sets name to the subclass name', () => {
      expect(new AuthenticationError('a', { code: 'AUTHENTICATION_ERROR' }).name).toBe('AuthenticationError');
      expect(new ForbiddenError('f', { code: 'FORBIDDEN' }).name).toBe('ForbiddenError');
      expect(new RateLimitError('r', { code: 'RATE_LIMITED' }).name).toBe('RateLimitError');
      expect(new PolicyViolationError('p', { code: 'POLICY_VIOLATION' }).name).toBe(
        'PolicyViolationError',
      );
      expect(new NotFoundError('n', { code: 'NOT_FOUND' }).name).toBe('NotFoundError');
      expect(new InsufficientFundsError('i', { code: 'INSUFFICIENT_FUNDS' }).name).toBe('InsufficientFundsError');
      expect(new InternalServerError('s', { code: 'INTERNAL_ERROR' }).name).toBe('InternalServerError');
      expect(new ServerError('s', { code: 'INTERNAL_ERROR' }).name).toBe('InternalServerError');
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Serialisation and type guard                                              */
  /* ------------------------------------------------------------------------ */

  describe('serialisation and type guard', () => {
    it('is recognisable via the type guard', () => {
      const err = fromApiError({ code: 'NOT_FOUND', message: 'gone' }, { status: 404 });
      expect(isAstroidError(err)).toBe(true);
      expect(isAstroidError(new Error('plain'))).toBe(false);
      expect(isAstroidError(null)).toBe(false);
      expect(isAstroidError(undefined)).toBe(false);
    });

    it('serialises to JSON without secrets', () => {
      const err = fromApiError({ code: 'NOT_FOUND', message: 'gone' }, { status: 404 });
      const json = err.toJSON();
      expect(json).toMatchObject({ name: 'NotFoundError', code: 'NOT_FOUND', status: 404 });
      expect(JSON.stringify(json)).not.toContain('apiKey');
    });

    it('toJSON includes stack trace', () => {
      const err = new ValidationError('val', { code: 'VALIDATION_ERROR' });
      const json = err.toJSON();
      expect(json.stack).toBeDefined();
      expect(typeof json.stack).toBe('string');
    });

    it('instanceof works across the hierarchy', () => {
      const auth = new AuthenticationError('a', { code: 'AUTHENTICATION_ERROR' });
      expect(auth instanceof AuthenticationError).toBe(true);
      expect(auth instanceof AstroidError).toBe(true);
      expect(auth instanceof Error).toBe(true);
      expect(auth instanceof ValidationError).toBe(false);

      const forbidden = new ForbiddenError('f', { code: 'FORBIDDEN' });
      expect(forbidden instanceof ForbiddenError).toBe(true);
      expect(forbidden instanceof AstroidError).toBe(true);

      const internal = new InternalServerError('i', { code: 'INTERNAL_ERROR' });
      expect(internal instanceof InternalServerError).toBe(true);
      expect(internal instanceof AstroidError).toBe(true);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Stack trace preservation                                                  */
  /* ------------------------------------------------------------------------ */

  it('preserves cause for stack trace via Error constructor', () => {
    const cause = new Error('original failure');
    const err = new ValidationError('wrapped', {
      code: 'VALIDATION_ERROR',
      cause,
    });
    expect(err.cause).toBe(cause);
    expect(err.stack).toBeDefined();
  });

  it('sets name to the subclass name', () => {
    expect(new AuthenticationError('auth', { code: 'AUTHENTICATION_ERROR' }).name).toBe(
      'AuthenticationError',
    );
    expect(new ForbiddenError('forbid', { code: 'FORBIDDEN' }).name).toBe('ForbiddenError');
    expect(new RateLimitError('rate', { code: 'RATE_LIMITED' }).name).toBe('RateLimitError');
    expect(new PolicyViolationError('policy', { code: 'POLICY_VIOLATION' }).name).toBe(
      'PolicyViolationError',
    );
    expect(new NotFoundError('nf', { code: 'NOT_FOUND' }).name).toBe('NotFoundError');
    expect(new ValidationError('val', { code: 'VALIDATION_ERROR' }).name).toBe('ValidationError');
    expect(new InternalServerError('srv', { code: 'INTERNAL_ERROR' }).name).toBe('InternalServerError');
    expect(new ServerError('srv', { code: 'INTERNAL_ERROR' }).name).toBe('InternalServerError');
  });
});

/**
 * Unit tests for the `@astroid/errors` mapper and specialized error classes
 * (issue #279).
 *
 * Covers:
 * - Status-code → error-class mapping (`errorClassForStatus`, `statusCodeToCode`)
 * - Envelope extraction (`extractApiError`)
 * - Full mapping via `mapStatusToError` / `errorFromStatus`
 * - Message preservation and diagnostic properties (`statusCode`, `code`, …)
 * - `err.name` matching the class name for name-based catch handlers
 * - `instanceof` reliability across the hierarchy
 * - Stack-trace and `cause` preservation
 */

import { describe, it, expect } from 'vitest';
import {
  AstroidError,
  AuthenticationError,
  AuthorizationError,
  ForbiddenError,
  ConflictError,
  NotFoundError,
  RateLimitError,
  InternalServerError,
  ServerError,
  ValidationError,
  errorClassForStatus,
  statusCodeToCode,
  mapStatusToError,
  errorFromStatus,
  extractApiError,
} from '../index.js';
import { errorClassForCode } from '../index.js';

/* -------------------------------------------------------------------------- */
/* errorClassForStatus — HTTP status → error class                             */
/* -------------------------------------------------------------------------- */

describe('errorClassForStatus (issue #271 / #279)', () => {
  it('maps 400 to ValidationError', () => {
    expect(errorClassForStatus(400)).toBe(ValidationError);
  });

  it('maps 401 to AuthenticationError', () => {
    expect(errorClassForStatus(401)).toBe(AuthenticationError);
  });

  it('maps 403 to ForbiddenError (and matches AuthorizationError)', () => {
    expect(errorClassForStatus(403)).toBe(ForbiddenError);
    expect(new (errorClassForStatus(403))('x', { code: 'FORBIDDEN' })).toBeInstanceOf(ForbiddenError);
  });

  it('maps 404 to NotFoundError', () => {
    expect(errorClassForStatus(404)).toBe(NotFoundError);
  });

  it('maps 409 to ConflictError', () => {
    expect(errorClassForStatus(409)).toBe(ConflictError);
  });

  it('maps 422 to ValidationError', () => {
    expect(errorClassForStatus(422)).toBe(ValidationError);
  });

  it('maps 429 to RateLimitError', () => {
    expect(errorClassForStatus(429)).toBe(RateLimitError);
  });

  it('maps all 5xx statuses to InternalServerError', () => {
    expect(errorClassForStatus(500)).toBe(InternalServerError);
    expect(errorClassForStatus(502)).toBe(InternalServerError);
    expect(errorClassForStatus(503)).toBe(InternalServerError);
    expect(errorClassForStatus(599)).toBe(InternalServerError);
  });

  it('falls back to the base AstroidError for unmapped statuses', () => {
    expect(errorClassForStatus(402)).toBe(AstroidError);
    expect(errorClassForStatus(418)).toBe(AstroidError);
    expect(errorClassForStatus(451)).toBe(AstroidError);
  });
});

/* -------------------------------------------------------------------------- */
/* statusCodeToCode — HTTP status → machine-readable code                      */
/* -------------------------------------------------------------------------- */

describe('statusCodeToCode (issue #279)', () => {
  it('maps every standard error status to a machine-readable code', () => {
    expect(statusCodeToCode(400)).toBe('VALIDATION_ERROR');
    expect(statusCodeToCode(401)).toBe('AUTHENTICATION_ERROR');
    expect(statusCodeToCode(403)).toBe('FORBIDDEN');
    expect(statusCodeToCode(404)).toBe('NOT_FOUND');
    expect(statusCodeToCode(409)).toBe('CONFLICT');
    expect(statusCodeToCode(422)).toBe('VALIDATION_ERROR');
    expect(statusCodeToCode(429)).toBe('RATE_LIMITED');
    expect(statusCodeToCode(500)).toBe('INTERNAL_ERROR');
    expect(statusCodeToCode(503)).toBe('INTERNAL_ERROR');
  });

  it('maps unknown client errors to BAD_REQUEST', () => {
    expect(statusCodeToCode(418)).toBe('BAD_REQUEST');
  });
});

/* -------------------------------------------------------------------------- */
/* extractApiError — envelope extraction                                       */
/* -------------------------------------------------------------------------- */

describe('extractApiError (issue #279)', () => {
  it('extracts the standard { error: { code, message } } envelope', () => {
    const apiError = extractApiError({
      error: { code: 'NOT_FOUND', message: 'Wallet not found', details: { walletId: 'wal_1' } },
    });
    expect(apiError).toEqual({
      code: 'NOT_FOUND',
      message: 'Wallet not found',
      details: { walletId: 'wal_1' },
    });
  });

  it('extracts a flat top-level { code, message } shape', () => {
    const apiError = extractApiError({ code: 'RATE_LIMITED', message: 'Slow down' });
    expect(apiError).toEqual({ code: 'RATE_LIMITED', message: 'Slow down', details: undefined });
  });

  it('returns undefined for non-object bodies', () => {
    expect(extractApiError(undefined)).toBeUndefined();
    expect(extractApiError(null)).toBeUndefined();
    expect(extractApiError('oops')).toBeUndefined();
    expect(extractApiError(42)).toBeUndefined();
  });

  it('returns undefined when code or message are missing', () => {
    expect(extractApiError({ error: { code: 'X' } })).toBeUndefined();
    expect(extractApiError({ error: { message: 'x' } })).toBeUndefined();
    expect(extractApiError({})).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* mapStatusToError — full mapping                                             */
/* -------------------------------------------------------------------------- */

describe('mapStatusToError (issue #279)', () => {
  it('maps 400 to ValidationError with statusCode and code populated', () => {
    const err = mapStatusToError(400, 'Invalid input');
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.statusCode).toBe(400);
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toBe('Invalid input');
  });

  it('maps 401 to AuthenticationError', () => {
    const err = mapStatusToError(401);
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.statusCode).toBe(401);
  });

  it('maps 403 to ForbiddenError', () => {
    const err = mapStatusToError(403);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.statusCode).toBe(403);
  });

  it('maps 404 to NotFoundError and preserves the requestId', () => {
    const err = mapStatusToError(404, 'Wallet not found', { requestId: 'req_404' });
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.requestId).toBe('req_404');
    expect(err.statusCode).toBe(404);
  });

  it('maps 429 to RateLimitError and keeps it retryable', () => {
    const err = mapStatusToError(429, 'Too many requests');
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.isRetryable).toBe(true);
  });

  it('maps 5xx to InternalServerError and ServerError', () => {
    const err = mapStatusToError(503, 'Down');
    expect(err).toBeInstanceOf(InternalServerError);
    expect(err).toBeInstanceOf(ServerError);
    expect(err.statusCode).toBe(503);
  });

  it('prefers the body error code over the status when both are present', () => {
    const err = mapStatusToError(402, 'No funds', {
      body: { error: { code: 'INSUFFICIENT_FUNDS', message: 'No funds' } },
    });
    // INSUFFICIENT_FUNDS maps to InsufficientFundsError via errorClassForCode,
    // even though a bare 402 would have fallen back to AstroidError.
    expect(err.code).toBe('INSUFFICIENT_FUNDS');
    expect(err.statusCode).toBe(402);
    expect(err).toBeInstanceOf(AstroidError);
    expect(err).not.toBeInstanceOf(ValidationError);
  });

  it('preserves the original error message through the mapping', () => {
    const err = mapStatusToError(404, 'The requested resource does not exist');
    expect(err.message).toBe('The requested resource does not exist');
  });

  it('falls back to the envelope message when no explicit message is given', () => {
    const err = mapStatusToError(422, undefined, {
      body: { error: { code: 'VALIDATION_ERROR', message: 'amount must be positive' } },
    });
    expect(err.message).toBe('amount must be positive');
  });

  it('falls back to a status-based message when nothing else is available', () => {
    const err = mapStatusToError(404);
    expect(err.message).toBe('Request failed with status 404');
  });

  it('merges body details with context details (context wins)', () => {
    const err = mapStatusToError(422, 'bad', {
      body: { error: { code: 'VALIDATION_ERROR', message: 'bad', details: { fields: { a: ['x'] } } } },
      details: { fields: { a: ['y'] } },
    });
    expect(err.details).toEqual({ fields: { a: ['y'] } });
  });

  it('attaches structured details to status-only errors', () => {
    const err = mapStatusToError(404, 'gone', { details: { resource: 'wallet' } });
    expect(err.details).toEqual({ resource: 'wallet' });
  });

  it('preserves the cause for error chaining', () => {
    const cause = new Error('socket hang up');
    const err = mapStatusToError(502, 'Bad gateway', { cause });
    expect(err.cause).toBe(cause);
  });

  it('keeps stack traces intact', () => {
    const err = mapStatusToError(500, 'boom');
    expect(err.stack).toBeDefined();
    expect(typeof err.stack).toBe('string');
  });
});

/* -------------------------------------------------------------------------- */
/* errorFromStatus — status-only convenience wrapper                           */
/* -------------------------------------------------------------------------- */

describe('errorFromStatus (issue #279)', () => {
  it('builds the same error as mapStatusToError without a body', () => {
    const err = errorFromStatus(401, 'Invalid API key', { requestId: 'req_9' });
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.message).toBe('Invalid API key');
    expect(err.statusCode).toBe(401);
    expect(err.requestId).toBe('req_9');
    expect(err.code).toBe('AUTHENTICATION_ERROR');
  });
});

/* -------------------------------------------------------------------------- */
/* Specialized error classes — names, instanceof, statusCode                   */
/* -------------------------------------------------------------------------- */

describe('specialized error classes (issue #271 / #279)', () => {
  it('sets err.name to the exact class name for every subclass', () => {
    const errors: AstroidError[] = [
      new AuthenticationError('a', { code: 'AUTHENTICATION_ERROR', statusCode: 401 }),
      new ForbiddenError('a', { code: 'FORBIDDEN', statusCode: 403 }),
      new AuthorizationError('a', { code: 'FORBIDDEN', statusCode: 403 }),
      new ValidationError('a', { code: 'VALIDATION_ERROR', statusCode: 400 }),
      new NotFoundError('a', { code: 'NOT_FOUND', statusCode: 404 }),
      new ConflictError('a', { code: 'CONFLICT', statusCode: 409 }),
      new RateLimitError('a', { code: 'RATE_LIMITED', statusCode: 429 }),
      new InternalServerError('a', { code: 'INTERNAL_ERROR', statusCode: 500 }),
      new ServerError('a', { code: 'INTERNAL_ERROR', statusCode: 500 }),
    ];
    for (const err of errors) {
      expect(err.name).toBe(err.constructor.name);
    }
  });

  it('supports name-based catch handlers', () => {
    const err = mapStatusToError(429, 'slow down');
    expect(err.name).toBe('RateLimitError');
  });

  it('keeps instanceof reliable across the hierarchy', () => {
    const err = mapStatusToError(404, 'nope');
    expect(err instanceof NotFoundError).toBe(true);
    expect(err instanceof AstroidError).toBe(true);
    expect(err instanceof Error).toBe(true);
    expect(err instanceof ValidationError).toBe(false);
  });

  it('exposes statusCode on every constructed subclass', () => {
    expect(new ValidationError('v', { code: 'VALIDATION_ERROR', statusCode: 422 }).statusCode).toBe(422);
    expect(new AuthenticationError('a', { code: 'AUTHENTICATION_ERROR' }).statusCode).toBeUndefined();
  });

  it('defaults statusCode to status when only status is provided', () => {
    const err = new NotFoundError('n', { code: 'NOT_FOUND', status: 404 });
    expect(err.statusCode).toBe(404);
    expect(err.status).toBe(404);
  });

  it('serializes statusCode in toJSON', () => {
    const err = mapStatusToError(404, 'gone');
    const json = err.toJSON();
    expect(json.statusCode).toBe(404);
    expect(json.status).toBe(404);
  });

  it('remains compatible with errorClassForCode for code-based mapping', () => {
    expect(errorClassForCode('NOT_FOUND')).toBe(NotFoundError);
    expect(errorClassForCode('RATE_LIMITED')).toBe(RateLimitError);
    expect(errorClassForCode('AUTHENTICATION_ERROR')).toBe(AuthenticationError);
  });
});

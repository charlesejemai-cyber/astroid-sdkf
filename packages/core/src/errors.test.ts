import { describe, expect, it } from 'vitest';
import {
  AstroidApiError,
  AstroidError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
  parseErrorResponse,
  toAstroidError,
} from './errors.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return jsonResponse(status, { error: { code, message } }, headers);
}

/* -------------------------------------------------------------------------- */
/* parseErrorResponse                                                          */
/* -------------------------------------------------------------------------- */

describe('parseErrorResponse', () => {
  it('maps a 401 envelope to AuthenticationError', async () => {
    const err = await parseErrorResponse(
      errorResponse(401, 'AUTHENTICATION_ERROR', 'Invalid API key'),
    );
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err).toBeInstanceOf(AstroidError);
    expect(err).toBeInstanceOf(AstroidApiError);
    expect(err.message).toBe('Invalid API key');
    expect(err.errorCode).toBe('AUTHENTICATION_ERROR');
    expect(err.statusCode).toBe(401);
  });

  it('maps a 400 envelope to ValidationError', async () => {
    const err = await parseErrorResponse(errorResponse(400, 'VALIDATION_ERROR', 'Bad request'));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.statusCode).toBe(400);
  });

  it('maps a 429 envelope to RateLimitError with structured details', async () => {
    const response = jsonResponse(429, {
      error: { code: 'RATE_LIMITED', message: 'Slow down', details: { retryAfter: 30 } },
    });
    const err = await parseErrorResponse(response);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.errorCode).toBe('RATE_LIMITED');
    expect(err.statusCode).toBe(429);
    expect(err.details).toEqual({ retryAfter: 30 });
    expect(err.isRetryable).toBe(true);
  });

  it('maps a 500 envelope to ServerError', async () => {
    const err = await parseErrorResponse(errorResponse(500, 'INTERNAL_ERROR', 'Boom'));
    expect(err).toBeInstanceOf(ServerError);
    expect(err.isRetryable).toBe(true);
  });

  it('maps other statuses by status code when no envelope code is present', async () => {
    await expect(parseErrorResponse(errorResponse(403, '', 'Forbidden'))).resolves.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(parseErrorResponse(errorResponse(404, '', 'Missing'))).resolves.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('derives the error class from the status when the body is malformed', async () => {
    const response = new Response('not json at all', {
      status: 503,
      headers: { 'content-type': 'text/plain' },
    });
    const err = await parseErrorResponse(response);
    expect(err).toBeInstanceOf(ServerError);
    expect(err.statusCode).toBe(503);
    expect(err.message).toContain('503');
  });

  it('captures the x-request-id header', async () => {
    const err = await parseErrorResponse(
      errorResponse(401, 'AUTHENTICATION_ERROR', 'nope', { 'x-request-id': 'req_123' }),
    );
    expect(err.requestId).toBe('req_123');
  });

  it('produces a serialisable error', async () => {
    const err = await parseErrorResponse(errorResponse(422, 'VALIDATION_ERROR', 'Invalid'));
    const json = err.toJSON();
    expect(json).toMatchObject({ name: 'ValidationError', code: 'VALIDATION_ERROR', status: 422 });
  });
});

/* -------------------------------------------------------------------------- */
/* toAstroidError                                                             */
/* -------------------------------------------------------------------------- */

describe('toAstroidError', () => {
  it('returns an existing AstroidError unchanged', () => {
    const original = new AuthenticationError('nope', { code: 'AUTHENTICATION_ERROR' });
    expect(toAstroidError(original)).toBe(original);
  });

  it('wraps a plain Error as a generic AstroidError preserving the cause', () => {
    const cause = new Error('boom');
    const err = toAstroidError(cause);
    expect(err).toBeInstanceOf(AstroidError);
    expect(err.message).toBe('boom');
    expect(err.errorCode).toBe('UNKNOWN_ERROR');
    expect(err.cause).toBe(cause);
  });

  it('wraps a thrown string', () => {
    const err = toAstroidError('kaboom');
    expect(err.message).toBe('kaboom');
    expect(err).toBeInstanceOf(AstroidError);
  });
});

import { describe, it, expect } from 'vitest';
import {
  AuthenticationError,
  AuthorizationError,
  ForbiddenError,
  ValidationError,
  NotFoundError,
  ConflictError,
  PolicyViolationError,
  BudgetExceededError,
  ApprovalRequiredError,
  RateLimitError,
  InternalServerError,
  ServerError,
  AstroidError,
} from '@astroid/errors';
import { StellarHorizonError, parseErrorResponse, parseErrorBody } from './errors.js';

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

function makeResponse(body: unknown, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function makeTextResponse(text: string, status: number, contentType = 'text/plain'): Response {
  return new Response(text, {
    status,
    headers: { 'content-type': contentType },
  });
}

/* -------------------------------------------------------------------------- */
/* parseErrorResponse — async Response parser                                  */
/* -------------------------------------------------------------------------- */

describe('parseErrorResponse', () => {
  /* ---- Standard API error envelope ---- */

  it('parses a standard { error: { code, message } } envelope', async () => {
    const response = makeResponse(
      { error: { code: 'NOT_FOUND', message: 'Wallet not found' } },
      404,
      { 'x-request-id': 'req_abc' },
    );

    const { error, parsed } = await parseErrorResponse(response);

    expect(parsed).toBe(true);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Wallet not found');
    expect(error.status).toBe(404);
    expect(error.requestId).toBe('req_abc');
  });

  it('parses an error envelope with nested details', async () => {
    const response = makeResponse(
      {
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: { field: 'email' } },
      },
      422,
    );

    const { error, parsed } = await parseErrorResponse(response);

    expect(parsed).toBe(true);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.status).toBe(422);
    expect(error.details).toEqual({ field: 'email' });
  });

  it('maps AUTHENTICATION_ERROR to AuthenticationError', async () => {
    const response = makeResponse(
      { error: { code: 'AUTHENTICATION_ERROR', message: 'Token expired' } },
      401,
    );

    const { error } = await parseErrorResponse(response);
    expect(error).toBeInstanceOf(AuthenticationError);
  });

  it('maps FORBIDDEN to ForbiddenError and AuthorizationError', async () => {
    const response = makeResponse({ error: { code: 'FORBIDDEN', message: 'Not allowed' } }, 403);

    const { error } = await parseErrorResponse(response);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toBeInstanceOf(AuthorizationError);
  });

  it('maps POLICY_VIOLATION to PolicyViolationError', async () => {
    const response = makeResponse(
      { error: { code: 'POLICY_VIOLATION', message: 'Exceeds daily limit' } },
      422,
    );

    const { error } = await parseErrorResponse(response);
    expect(error).toBeInstanceOf(PolicyViolationError);
  });

  it('maps BUDGET_EXCEEDED to BudgetExceededError', async () => {
    const response = makeResponse(
      { error: { code: 'BUDGET_EXCEEDED', message: 'Budget exceeded' } },
      422,
    );

    const { error } = await parseErrorResponse(response);
    expect(error).toBeInstanceOf(BudgetExceededError);
  });

  it('maps APPROVAL_REQUIRED to ApprovalRequiredError', async () => {
    const response = makeResponse(
      { error: { code: 'APPROVAL_REQUIRED', message: 'Needs sign-off' } },
      422,
    );

    const { error } = await parseErrorResponse(response);
    expect(error).toBeInstanceOf(ApprovalRequiredError);
  });

  it('maps RATE_LIMITED to RateLimitError', async () => {
    const response = makeResponse(
      { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
      429,
    );

    const { error } = await parseErrorResponse(response);
    expect(error).toBeInstanceOf(RateLimitError);
  });

  it('maps INTERNAL_ERROR to InternalServerError and ServerError', async () => {
    const response = makeResponse(
      { error: { code: 'INTERNAL_ERROR', message: 'Something broke' } },
      500,
    );

    const { error } = await parseErrorResponse(response);
    expect(error).toBeInstanceOf(InternalServerError);
    expect(error).toBeInstanceOf(ServerError);
  });

  it('maps unknown error codes to base AstroidError', async () => {
    const response = makeResponse(
      { error: { code: 'SOME_NEW_CODE', message: 'Something unusual' } },
      418,
    );

    const { error, parsed } = await parseErrorResponse(response);
    expect(parsed).toBe(true);
    expect(error).toBeInstanceOf(AstroidError);
    expect(error.code).toBe('SOME_NEW_CODE');
    // Should NOT be any subclass
    expect(error).not.toBeInstanceOf(AuthenticationError);
    expect(error).not.toBeInstanceOf(ValidationError);
  });

  /* ---- Validation arrays ---- */

  it('parses a top-level errors array into field-level errors', async () => {
    const response = makeResponse(
      {
        errors: [
          { field: 'email', message: 'Must be a valid email' },
          { field: 'amount', message: 'Must be positive' },
          { field: 'email', message: 'Already taken' },
        ],
      },
      422,
    );

    const { error, parsed } = await parseErrorResponse(response);

    expect(parsed).toBe(true);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.details).toBeDefined();
    const fields = (error.details as Record<string, unknown>).fields as Record<string, string[]>;
    expect(fields.email).toEqual(['Must be a valid email', 'Already taken']);
    expect(fields.amount).toEqual(['Must be positive']);
  });

  it('parses validationErrors array into field-level errors', async () => {
    const response = makeResponse(
      {
        validationErrors: [{ path: 'recipientAddress', message: 'Invalid Stellar address' }],
      },
      400,
    );

    const { error, parsed } = await parseErrorResponse(response);

    expect(parsed).toBe(true);
    expect(error).toBeInstanceOf(ValidationError);
    const fields = (error.details as Record<string, unknown>).fields as Record<string, string[]>;
    expect(fields.recipientAddress).toEqual(['Invalid Stellar address']);
  });

  it('parses nested error.details.validationErrors', async () => {
    const response = makeResponse(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: {
            validationErrors: [{ field: 'name', message: 'Required' }],
          },
        },
      },
      422,
    );

    const { error, parsed } = await parseErrorResponse(response);

    expect(parsed).toBe(true);
    expect(error).toBeInstanceOf(ValidationError);
    const fields = (error.details as Record<string, unknown>).fields as Record<string, string[]>;
    expect(fields.name).toEqual(['Required']);
  });

  it('parses pre-mapped error.details.fields', async () => {
    const response = makeResponse(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: {
            fields: {
              email: ['Invalid format'],
              password: ['Too short', 'Needs special character'],
            },
          },
        },
      },
      422,
    );

    const { error, parsed } = await parseErrorResponse(response);

    expect(parsed).toBe(true);
    expect(error).toBeInstanceOf(ValidationError);
    const fields = (error.details as Record<string, unknown>).fields as Record<string, string[]>;
    expect(fields.email).toEqual(['Invalid format']);
    expect(fields.password).toEqual(['Too short', 'Needs special character']);
  });

  /* ---- Stellar Horizon errors ---- */

  it('parses a Horizon error with extras.result_codes.transaction', async () => {
    const response = makeResponse(
      {
        type: 'https://stellar.org/horizon-errors/transaction_failed',
        title: 'Transaction Failed',
        status: 400,
        extras: {
          result_codes: {
            transaction: 'tx_bad_seq',
          },
        },
      },
      400,
    );

    const { error, parsed } = await parseErrorResponse(response);

    expect(parsed).toBe(true);
    expect(error).toBeInstanceOf(StellarHorizonError);
    expect((error as StellarHorizonError).stellarCode).toBe('tx_bad_seq');
    expect(error.status).toBe(409); // tx_bad_seq maps to 409 CONFLICT
  });

  it('parses a Horizon error with extras.result_codes.operations', async () => {
    const response = makeResponse(
      {
        type: 'https://stellar.org/horizon-errors/transaction_failed',
        extras: {
          result_codes: {
            transaction: 'tx_failed',
            operations: ['op_underfunded'],
          },
        },
      },
      400,
    );

    const { error, parsed } = await parseErrorResponse(response);

    expect(parsed).toBe(true);
    expect(error).toBeInstanceOf(StellarHorizonError);
    const horizonError = error as StellarHorizonError;
    expect(horizonError.stellarCode).toBe('op_underfunded');
    expect(horizonError.operationCode).toBe('op_underfunded');
    expect(error.status).toBe(402); // op_underfunded maps to 402
  });

  it('parses a Horizon error with result_code flat shape', async () => {
    const response = makeResponse({ result_code: 'tx_bad_auth' }, 400);

    const { error, parsed } = await parseErrorResponse(response);

    expect(parsed).toBe(true);
    expect(error).toBeInstanceOf(StellarHorizonError);
    expect((error as StellarHorizonError).stellarCode).toBe('tx_bad_auth');
    expect(error.status).toBe(401);
  });

  it('parses a Horizon error with stellarCode flat shape', async () => {
    const response = makeResponse({ stellarCode: 'op_no_destination' }, 400);

    const { error, parsed } = await parseErrorResponse(response);

    expect(parsed).toBe(true);
    expect(error).toBeInstanceOf(StellarHorizonError);
    expect((error as StellarHorizonError).stellarCode).toBe('op_no_destination');
    expect(error.status).toBe(404);
  });

  it('falls back to original status for unknown Stellar codes', async () => {
    const response = makeResponse({ extras: { result_codes: { transaction: 'op_unknown' } } }, 400);

    const { error } = await parseErrorResponse(response);
    expect(error).toBeInstanceOf(StellarHorizonError);
    expect(error.status).toBe(400); // unknown code, keeps original status
  });

  /* ---- Content-type handling ---- */

  it('returns parsed: false for non-JSON content-type', async () => {
    const response = makeTextResponse('Internal Server Error', 500, 'text/html');

    const { error, parsed } = await parseErrorResponse(response);

    expect(parsed).toBe(false);
    expect(error).toBeInstanceOf(ServerError);
    expect(error.status).toBe(500);
  });

  it('returns parsed: false when body is empty', async () => {
    const response = new Response(null, { status: 204 });

    const { error, parsed } = await parseErrorResponse(response);

    expect(parsed).toBe(false);
    expect(error.status).toBe(204);
  });

  it('returns parsed: false for malformed JSON', async () => {
    const response = new Response('not json at all', {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });

    const { error, parsed } = await parseErrorResponse(response);

    expect(parsed).toBe(false);
    expect(error.status).toBe(400);
  });

  it('handles application/hal+json content type', async () => {
    const response = makeResponse({ error: { code: 'NOT_FOUND', message: 'Gone' } }, 404);
    // Override content-type
    const halResponse = new Response(response.body, {
      status: 404,
      headers: { 'content-type': 'application/hal+json' },
    });

    const { error, parsed } = await parseErrorResponse(halResponse);
    expect(parsed).toBe(true);
    expect(error).toBeInstanceOf(NotFoundError);
  });

  /* ---- Fallback behavior ---- */

  it('handles a body with message but no error envelope', async () => {
    const response = makeResponse({ message: 'Something went wrong' }, 500);

    const { error, parsed } = await parseErrorResponse(response);

    expect(parsed).toBe(true);
    expect(error).toBeInstanceOf(ServerError);
    expect(error.message).toBe('Something went wrong');
  });

  it('handles a body with just error as a string', async () => {
    const response = makeResponse({ error: 'Rate limited' }, 429);

    const { error } = await parseErrorResponse(response);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.message).toBe('Rate limited');
  });

  it('uses default message when no message field is found', async () => {
    const response = makeResponse({ foo: 'bar' }, 404);

    const { error } = await parseErrorResponse(response);
    expect(error.message).toBe('Request failed with status 404');
  });

  /* ---- Request ID extraction ---- */

  it('reads x-request-id from response headers', async () => {
    const response = makeResponse({ error: { code: 'NOT_FOUND', message: 'Nope' } }, 404, {
      'x-request-id': 'req_xyz_123',
    });

    const { error } = await parseErrorResponse(response);
    expect(error.requestId).toBe('req_xyz_123');
  });

  /* ---- Pre-read body ---- */

  it('accepts a pre-read body text', async () => {
    const response = makeResponse({ error: { code: 'CONFLICT', message: 'Already exists' } }, 409);
    // Pre-read the body
    const bodyText = await response.text();

    const { error, parsed } = await parseErrorResponse(response, bodyText);

    expect(parsed).toBe(true);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toBe('Already exists');
  });
});

/* -------------------------------------------------------------------------- */
/* parseErrorBody — sync body parser                                           */
/* -------------------------------------------------------------------------- */

describe('parseErrorBody', () => {
  it('parses a standard API error from a pre-parsed body object', () => {
    const body = { error: { code: 'NOT_FOUND', message: 'Wallet missing' } };
    const error = parseErrorBody(404, body, 'req_sync');

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.status).toBe(404);
    expect(error.requestId).toBe('req_sync');
  });

  it('parses a Stellar Horizon error from a pre-parsed body', () => {
    const body = {
      extras: { result_codes: { transaction: 'tx_bad_seq' } },
    };
    const error = parseErrorBody(400, body);

    expect(error).toBeInstanceOf(StellarHorizonError);
    expect((error as StellarHorizonError).stellarCode).toBe('tx_bad_seq');
    expect(error.status).toBe(409);
  });

  it('parses validation errors from a pre-parsed body', () => {
    const body = {
      errors: [{ field: 'email', message: 'Invalid' }],
    };
    const error = parseErrorBody(422, body);

    expect(error).toBeInstanceOf(ValidationError);
    const fields = (error.details as Record<string, unknown>).fields as Record<string, string[]>;
    expect(fields.email).toEqual(['Invalid']);
  });

  it('falls back to status-based error for unrecognised shapes', () => {
    const error = parseErrorBody(500, { random: 'data' });

    expect(error).toBeInstanceOf(ServerError);
    expect(error.status).toBe(500);
  });

  it('handles undefined/null body', () => {
    const error = parseErrorBody(400, undefined);

    expect(error.status).toBe(400);
    expect(error.message).toBe('Request failed with status 400');
  });

  it('maps AUTHENTICATION_ERROR to AuthenticationError', () => {
    const body = { error: { code: 'AUTHENTICATION_ERROR', message: 'Bad creds' } };
    const error = parseErrorBody(401, body);
    expect(error).toBeInstanceOf(AuthenticationError);
  });

  it('maps POLICY_VIOLATION to PolicyViolationError', () => {
    const body = { error: { code: 'POLICY_VIOLATION', message: 'Blocked' } };
    const error = parseErrorBody(422, body);
    expect(error).toBeInstanceOf(PolicyViolationError);
  });

  it('maps BUDGET_EXCEEDED to BudgetExceededError', () => {
    const body = { error: { code: 'BUDGET_EXCEEDED', message: 'Over budget' } };
    const error = parseErrorBody(422, body);
    expect(error).toBeInstanceOf(BudgetExceededError);
  });

  it('maps APPROVAL_REQUIRED to ApprovalRequiredError', () => {
    const body = { error: { code: 'APPROVAL_REQUIRED', message: 'Needs approval' } };
    const error = parseErrorBody(422, body);
    expect(error).toBeInstanceOf(ApprovalRequiredError);
  });

  it('maps unknown codes to base AstroidError', () => {
    const body = { error: { code: 'CUSTOM_CODE', message: 'Custom' } };
    const error = parseErrorBody(418, body);
    expect(error).toBeInstanceOf(AstroidError);
    expect(error.code).toBe('CUSTOM_CODE');
  });
});

/* -------------------------------------------------------------------------- */
/* StellarHorizonError class                                                   */
/* -------------------------------------------------------------------------- */

describe('StellarHorizonError', () => {
  it('exposes stellarCode and operationCode', () => {
    const error = new StellarHorizonError('Payment failed', {
      code: 'op_underfunded',
      status: 402,
      stellarCode: 'op_underfunded',
      operationCode: 'op_underfunded',
    });

    expect(error.stellarCode).toBe('op_underfunded');
    expect(error.operationCode).toBe('op_underfunded');
    expect(error.code).toBe('op_underfunded');
    expect(error.status).toBe(402);
    expect(error).toBeInstanceOf(AstroidError);
  });

  it('serialises correctly', () => {
    const error = new StellarHorizonError('Bad seq', {
      code: 'tx_bad_seq',
      status: 409,
      stellarCode: 'tx_bad_seq',
    });

    const json = error.toJSON();
    expect(json.name).toBe('StellarHorizonError');
    expect(json.code).toBe('tx_bad_seq');
    expect(json.status).toBe(409);
  });

  it('preserves cause for stack trace', () => {
    const cause = new Error('original');
    const error = new StellarHorizonError('Failed', {
      code: 'tx_bad_seq',
      status: 409,
      stellarCode: 'tx_bad_seq',
      cause,
    });

    expect(error.cause).toBe(cause);
  });
});

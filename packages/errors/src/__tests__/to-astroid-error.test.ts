/**
 * Unit tests for the `toAstroidError(response, body)` factory (issue #240).
 *
 * Covers:
 * - Status-code → error-class mapping for every error category
 * - Body `code` taking precedence over the HTTP status
 * - `requestId` / `status` / `statusCode` / `details` propagation
 * - `Retry-After` header handling, including body-vs-header precedence
 * - Safe handling of malformed, non-JSON, and already-consumed bodies
 * - The factory resolves (never throws) and always yields a typed error
 * - `fromErrorResponse` throwing the same error the factory builds
 */

import { describe, it, expect } from 'vitest';
import {
  AstroidError,
  AuthenticationError,
  ConflictError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  PolicyViolationError,
  RateLimitError,
  ServerError,
  ValidationError,
  fromErrorResponse,
  toAstroidError,
} from '../index.js';

/** Build a JSON error response. */
function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Build a response whose body is arbitrary (often non-JSON) text. */
function textResponse(body: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

describe('toAstroidError', () => {
  /* ---------------------------------------------------------------- */
  /* Status-code categories                                             */
  /* ---------------------------------------------------------------- */

  describe('maps every status-code category to its error class', () => {
    const cases: Array<[number, unknown, string]> = [
      [400, ValidationError, 'ValidationError'],
      [422, ValidationError, 'ValidationError'],
      [401, AuthenticationError, 'AuthenticationError'],
      [403, ForbiddenError, 'ForbiddenError'],
      [404, NotFoundError, 'NotFoundError'],
      [409, ConflictError, 'ConflictError'],
      [429, RateLimitError, 'RateLimitError'],
      [500, InternalServerError, 'InternalServerError'],
      [502, InternalServerError, 'InternalServerError'],
      [503, ServerError, 'InternalServerError'],
    ];

    it.each(cases)('status %i → %s', async (status, expected, expectedName) => {
      // No body at all: the status is the only available signal.
      const err = await toAstroidError(new Response(null, { status }));

      expect(err).toBeInstanceOf(expected as new (...args: never[]) => AstroidError);
      expect(err.name).toBe(expectedName);
      expect(err.status).toBe(status);
      expect(err.statusCode).toBe(status);
      expect(err).toBeInstanceOf(AstroidError);
      expect(err).toBeInstanceOf(Error);
    });

    it('falls back to the base AstroidError for unmapped statuses', async () => {
      const err = await toAstroidError(new Response(null, { status: 418 }));

      expect(err).toBeInstanceOf(AstroidError);
      expect(err.constructor).toBe(AstroidError);
      expect(err.status).toBe(418);
      expect(typeof err.code).toBe('string');
    });
  });

  /* ---------------------------------------------------------------- */
  /* Envelope precedence                                                */
  /* ---------------------------------------------------------------- */

  describe('prefers the body error code over the status', () => {
    it('maps a POLICY_VIOLATION body returned with a 400', async () => {
      const err = await toAstroidError(
        jsonResponse({ error: { code: 'POLICY_VIOLATION', message: 'Exceeds daily limit' } }, 400),
      );

      expect(err).toBeInstanceOf(PolicyViolationError);
      expect(err.code).toBe('POLICY_VIOLATION');
      expect(err.status).toBe(400);
      expect(err.message).toBe('Exceeds daily limit');
    });

    it('keeps a code that disagrees with the status instead of overwriting it', async () => {
      const err = await toAstroidError(
        jsonResponse({ error: { code: 'INSUFFICIENT_FUNDS', message: 'Not enough' } }, 402),
      );

      expect(err.code).toBe('INSUFFICIENT_FUNDS');
      expect(err.statusCode).toBe(402);
    });

    it('understands a flat top-level { code, message } envelope', async () => {
      const err = await toAstroidError(jsonResponse({ code: 'NOT_FOUND', message: 'gone' }, 404));

      expect(err).toBeInstanceOf(NotFoundError);
      expect(err.code).toBe('NOT_FOUND');
      expect(err.message).toBe('gone');
    });

    it('preserves the raw API error details', async () => {
      const err = await toAstroidError(
        jsonResponse(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid',
              details: { fields: { email: ['must be a valid email'] } },
            },
          },
          422,
        ),
      );

      expect(err.details).toEqual({ fields: { email: ['must be a valid email'] } });
    });
  });

  /* ---------------------------------------------------------------- */
  /* Diagnostics                                                       */
  /* ---------------------------------------------------------------- */

  it('reads the requestId from the x-request-id header', async () => {
    const err = await toAstroidError(
      jsonResponse({ error: { code: 'CONFLICT', message: 'dup' } }, 409, {
        'x-request-id': 'req_abc',
      }),
    );

    expect(err.requestId).toBe('req_abc');
  });

  it('leaves requestId undefined when the header is absent', async () => {
    const err = await toAstroidError(new Response(null, { status: 500 }));

    expect(err.requestId).toBeUndefined();
  });

  /* ---------------------------------------------------------------- */
  /* Retry-After                                                       */
  /* ---------------------------------------------------------------- */

  describe('Retry-After handling', () => {
    it('exposes delta-seconds from the header as retryAfter', async () => {
      const err = await toAstroidError(new Response(null, { status: 429, headers: { 'retry-after': '30' } }));

      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfter).toBe(30);
      expect(err.isRetryable).toBe(true);
    });

    it('supports the HTTP-date form of Retry-After', async () => {
      const future = new Date(Date.now() + 45_000).toUTCString();
      const err = await toAstroidError(
        new Response(null, { status: 429, headers: { 'retry-after': future } }),
      );

      const retryAfter = (err as RateLimitError).retryAfter;
      expect(typeof retryAfter).toBe('number');
      // Allow a couple of seconds of slack for HTTP-date second-granularity.
      expect(retryAfter).toBeGreaterThan(40);
      expect(retryAfter).toBeLessThanOrEqual(45);
    });

    it('ignores an unparseable Retry-After header rather than throwing', async () => {
      const err = await toAstroidError(
        new Response(null, { status: 429, headers: { 'retry-after': 'soon-ish' } }),
      );

      expect((err as RateLimitError).retryAfter).toBeUndefined();
    });

    it('prefers a body-supplied retryAfter over the header', async () => {
      const err = await toAstroidError(
        jsonResponse(
          { error: { code: 'RATE_LIMITED', message: 'slow down', details: { retryAfter: 5 } } },
          429,
          { 'retry-after': '300' },
        ),
      );

      expect((err as RateLimitError).retryAfter).toBe(5);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Malformed / non-JSON bodies from gateways                          */
  /* ---------------------------------------------------------------- */

  describe('tolerates malformed and non-JSON gateway responses', () => {
    it('maps an HTML error page to the status-derived error', async () => {
      const err = await toAstroidError(
        textResponse('<html><body>502 Bad Gateway</body></html>', 502, {
          'content-type': 'text/html',
        }),
      );

      expect(err).toBeInstanceOf(InternalServerError);
      expect(err.status).toBe(502);
      expect(err.message).toBe('Request failed with status 502');
    });

    it('maps a plain-text body to the status-derived error', async () => {
      const err = await toAstroidError(
        textResponse('not json at all', 400, { 'content-type': 'text/plain' }),
      );

      expect(err).toBeInstanceOf(ValidationError);
      expect(err.status).toBe(400);
    });

    it('handles an empty body', async () => {
      const err = await toAstroidError(new Response(null, { status: 404 }));

      expect(err).toBeInstanceOf(NotFoundError);
    });

    it('handles a JSON null body', async () => {
      const err = await toAstroidError(jsonResponse(null, 404));

      expect(err).toBeInstanceOf(NotFoundError);
    });

    it('handles a JSON array body', async () => {
      const err = await toAstroidError(jsonResponse([1, 2, 3], 500));

      expect(err).toBeInstanceOf(InternalServerError);
    });

    it('handles a JSON string body', async () => {
      const err = await toAstroidError(jsonResponse('gateway failure', 500));

      expect(err).toBeInstanceOf(InternalServerError);
    });

    it('handles an `error` field that is a string rather than an object', async () => {
      const err = await toAstroidError(jsonResponse({ error: 'boom' }, 500));

      expect(err).toBeInstanceOf(InternalServerError);
      expect(err.message).toBe('boom');
    });

    it('falls back to the status when the envelope omits its message', async () => {
      const err = await toAstroidError(jsonResponse({ error: { code: 'RATE_LIMITED' } }, 429));

      expect(err).toBeInstanceOf(RateLimitError);
      expect(err.message).toBe('Request failed with status 429');
    });

    it('drops a non-object `details` field instead of propagating it', async () => {
      const err = await toAstroidError(
        jsonResponse({ error: { code: 'NOT_FOUND', message: 'gone', details: 'oops' } }, 404),
      );

      expect(err).toBeInstanceOf(NotFoundError);
      expect(err.details).toBeUndefined();
    });

    it('never throws when the body stream was already consumed', async () => {
      const res = textResponse('{"error":{"code":"NOT_FOUND","message":"gone"}}', 404);
      // Consume the body, exactly as an eager logger would.
      await res.text();

      const err = await toAstroidError(res);

      expect(err).toBeInstanceOf(NotFoundError);
      expect(err.status).toBe(404);
    });

    it('never throws for a response-like object with no headers map', async () => {
      // Hand-rolled `Response` shims and the `RawResponse` shape used by the
      // client middleware have no `Headers` instance.
      const err = await toAstroidError({ status: 500 } as unknown as Response);

      expect(err).toBeInstanceOf(InternalServerError);
      expect(err.code).toBe('INTERNAL_ERROR');
      expect(err.status).toBe(500);
      expect(err.requestId).toBeUndefined();
    });

    it('never throws for a response-like object with no text() method', async () => {
      const err = await toAstroidError({ status: 404 } as unknown as Response);

      expect(err).toBeInstanceOf(NotFoundError);
      expect(err.status).toBe(404);
    });

    it('reads headers from a Headers-like object that is not a Headers instance', async () => {
      const err = await toAstroidError({
        status: 429,
        headers: new Map([['retry-after', '7']]),
      } as unknown as Response);

      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfter).toBe(7);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Partial / blank envelope fields                                  */
  /* ---------------------------------------------------------------- */

  describe('treats blank envelope fields as absent', () => {
    it('derives the class and code from the status when the envelope code is blank', async () => {
      const err = await toAstroidError(jsonResponse({ error: { code: '', message: '' } }, 403));

      expect(err).toBeInstanceOf(ForbiddenError);
      expect(err.code).toBe('FORBIDDEN');
      expect(err.message).toBe('Request failed with status 403');
    });

    it('keeps the API message while still deriving the code from the status', async () => {
      const err = await toAstroidError(
        jsonResponse({ error: { code: '', message: 'Forbidden' } }, 403),
      );

      expect(err).toBeInstanceOf(ForbiddenError);
      expect(err.code).toBe('FORBIDDEN');
      expect(err.message).toBe('Forbidden');
    });

    it('keeps a valid code when only the message is blank', async () => {
      const err = await toAstroidError(
        jsonResponse({ error: { code: 'POLICY_VIOLATION', message: '   ' } }, 400),
      );

      expect(err).toBeInstanceOf(PolicyViolationError);
      expect(err.code).toBe('POLICY_VIOLATION');
      expect(err.message).toBe('Request failed with status 400');
    });

    it('falls through a blank nested envelope to a flat top-level one', async () => {
      const err = await toAstroidError(
        jsonResponse({ error: { code: '' }, code: 'CONFLICT', message: 'dup' }, 409),
      );

      expect(err).toBeInstanceOf(ConflictError);
      expect(err.code).toBe('CONFLICT');
      expect(err.message).toBe('dup');
    });
  });

  /* ---------------------------------------------------------------- */
  /* Explicit body argument                                            */
  /* ---------------------------------------------------------------- */

  describe('accepts an explicit body argument', () => {
    it('uses a pre-parsed object without re-reading the response', async () => {
      const res = jsonResponse({ error: { code: 'FORBIDDEN', message: 'nope' } }, 403);
      const err = await toAstroidError(res, { error: { code: 'FORBIDDEN', message: 'nope' } });

      expect(err).toBeInstanceOf(ForbiddenError);
      expect(err.message).toBe('nope');
    });

    it('honours an explicit body even when the response body says otherwise', async () => {
      const res = jsonResponse({ error: { code: 'NOT_FOUND', message: 'from response' } }, 404);
      const err = await toAstroidError(res, { error: { code: 'CONFLICT', message: 'from argument' } });

      expect(err).toBeInstanceOf(ConflictError);
      expect(err.message).toBe('from argument');
    });

    it('treats an explicit `undefined` body as "read it for me"', async () => {
      const res = jsonResponse({ error: { code: 'NOT_FOUND', message: 'gone' } }, 404);
      const err = await toAstroidError(res, undefined);

      expect(err).toBeInstanceOf(NotFoundError);
      expect(err.message).toBe('gone');
    });
  });

  /* ---------------------------------------------------------------- */
  /* Contract                                                          */
  /* ---------------------------------------------------------------- */

  it('resolves rather than throwing, and always returns a typed error', async () => {
    await expect(
      toAstroidError(new Response(null, { status: 500 })),
    ).resolves.toBeInstanceOf(AstroidError);
  });

  it('always produces a usable stack trace and message', async () => {
    const err = await toAstroidError(new Response(null, { status: 503 }));

    expect(typeof err.stack).toBe('string');
    expect(err.stack).toContain('InternalServerError');
    expect(err.message.length).toBeGreaterThan(0);
  });
});

describe('fromErrorResponse', () => {
  it('throws the same typed error that toAstroidError would build', async () => {
    const makeRes = () =>
      jsonResponse(
        { error: { code: 'RATE_LIMITED', message: 'Slow down', details: { retryAfter: 12 } } },
        429,
        { 'x-request-id': 'req_1' },
      );

    const thrown = await fromErrorResponse(makeRes()).then(
      () => null,
      (e: unknown) => e as RateLimitError,
    );
    const built = await toAstroidError(makeRes());

    expect(thrown).toBeInstanceOf(RateLimitError);
    expect(thrown?.name).toBe(built.name);
    expect(thrown?.code).toBe(built.code);
    expect(thrown?.status).toBe(built.status);
    expect(thrown?.requestId).toBe(built.requestId);
    expect(thrown?.details).toEqual(built.details);
    expect(thrown?.message).toBe(built.message);
  });

  it('throws for a non-JSON gateway response', async () => {
    await expect(
      fromErrorResponse(textResponse('<html>oops</html>', 502, { 'content-type': 'text/html' })),
    ).rejects.toBeInstanceOf(InternalServerError);
  });
});

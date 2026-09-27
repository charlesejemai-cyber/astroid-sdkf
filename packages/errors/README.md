# @astroid/errors

Typed error classes for the Astroid SDK. Every failure is an `AstroidError` (or
a subclass) — never a generic exception.

```ts
import { PolicyViolationError, BudgetExceededError, isAstroidError } from '@astroid/errors';

try {
  await astroid.transactions.create(input);
} catch (err) {
  if (err instanceof PolicyViolationError) {
    console.error('Blocked by policy:', err.details);
  } else if (err instanceof BudgetExceededError) {
    console.error('Out of budget:', err.message);
  } else if (isAstroidError(err)) {
    console.error(err.code, err.requestId);
  }
}
```

## Classes

`AstroidError` (base) · `AuthenticationError` · `AuthorizationError` ·
`ValidationError` · `NotFoundError` · `ConflictError` · `PolicyViolationError` ·
`InsufficientFundsError` · `BudgetExceededError` · `ApprovalRequiredError` ·
`RateLimitError` · `NetworkError` · `ServerError`.

`AstroidError` extends the native `Error` and restores its prototype chain with
`Object.setPrototypeOf(this, new.target.prototype)`, so `instanceof` holds after
transpilation to any target.

Every error carries:

| property | meaning |
| --- | --- |
| `code` / `errorCode` | machine-readable API error code |
| `status` / `statusCode` | HTTP status code of the failed response |
| `requestId` | `x-request-id`, for correlating with backend logs |
| `details` | raw structured detail from the API error envelope |
| `isRetryable` | whether retrying could plausibly succeed |
| `cause` | the underlying failure, when one was supplied |

`RateLimitError.retryAfter` and `ValidationError.fieldErrors` are typed
convenience accessors, and `toJSON()` gives a log-safe plain object.

## Building errors from a response

`toAstroidError(response, body?)` is the canonical factory. It **resolves** rather
than throws, so you decide what to do with the result:

```ts
import { toAstroidError, fromErrorResponse, isRateLimitError } from '@astroid/errors';

const res = await fetch('/api/wallets/wal_123');
if (!res.ok) throw await toAstroidError(res);

// or, the fetch one-liner
if (!res.ok) await fromErrorResponse(res);
```

It resolves the class in this order: the machine-readable `code` in the body
envelope, then the HTTP `status` alone, then the base `AstroidError`.

Malformed input is expected, not exceptional. An HTML 502 from a load balancer, an
empty body, a JSON array, a string `error` field, an already-consumed stream, or a
`Response` shim without a `headers` map all still produce a correctly-typed error
instead of a `SyntaxError` or `TypeError`. Blank envelope `code`/`message` fields
are treated as absent so the status supplies a real code and message, and a
`Retry-After` header (delta-seconds or HTTP-date) is folded into
`details.retryAfter` so `RateLimitError.retryAfter` survives a non-JSON 429.

Pass `body` explicitly when the body was already consumed elsewhere (e.g. logged)
or when you have a pre-parsed value.

## Guards

`isAstroidError` plus one predicate per category, all accepting `unknown` so they
narrow cleanly inside `catch` blocks:

`isAuthenticationError` · `isForbiddenError` · `isValidationError` ·
`isNotFoundError` · `isConflictError` · `isPolicyViolationError` ·
`isInsufficientFundsError` · `isRateLimitError` · `isNetworkError` ·
`isServerError`.

```ts
try {
  await submit();
} catch (err) {
  if (isRateLimitError(err)) {
    await sleep((err.retryAfter ?? 1) * 1000);
    return submit();
  }
  throw err;
}
```

## Mapping helpers

- `errorClassForCode(code)` — API error code → error class.
- `errorClassForStatus(status)` / `statusCodeToCode(status)` — HTTP status → class/code.
- `codeForStatus(status)` / `fromStatus(...)` — aliases of the two above, kept for
  the existing API. They delegate, so there is a single status→code table.
- `mapStatusToError(status, message?, ctx?)` — the mapper behind the factory.
- `extractApiError(body)` — pull `{ code, message, details }` out of a body.
- `fromApiError(apiError, ctx?)` — build from a response envelope.
- `toNetworkError(cause)` — wrap a transport failure.

## Stellar / Horizon failures

Transaction failures reported by Horizon (`extras.result_codes`) get their own
domain classes: `InsufficientBalanceError`, `TrustlineMissingError`,
`StellarAuthError`, `SequenceConflictError`, `TransactionExpiredError`,
`StellarMalformedError`, `StellarNetworkError`.

```ts
import { isStellarError, InsufficientBalanceError } from '@astroid/errors';

if (isStellarError(err) && err instanceof InsufficientBalanceError) {
  await topUpWallet(err.code);
}
```

Use `errorClassForStellarCode`, `mapStellarError`, and `stellarCodeToApiError` to
drive that mapping yourself.

/**
 * `@astroid/errors` — base error class module.
 *
 * Re-exports the canonical {@link AstroidError} definition from the package
 * entrypoint so the repo layout matches the module structure documented in
 * issue #279 (`AstroidError.ts`, `mapper.ts`, `index.ts`). The authoritative
 * implementation lives in `index.ts` to keep the existing public surface and
 * import graph unchanged for all downstream SDK packages.
 *
 * @module
 */

export {
  AstroidError,
  AuthenticationError,
  AuthorizationError,
  ForbiddenError,
  ValidationError,
  NotFoundError,
  ConflictError,
  PolicyViolationError,
  InsufficientFundsError,
  BudgetExceededError,
  ApprovalRequiredError,
  RateLimitError,
  NetworkError,
  InternalServerError,
  ServerError,
  type AstroidErrorOptions,
} from './index.js';

/**
 * `@astroid/errors` — base error class.
 *
 * Contains the root {@link AstroidError} of the SDK error hierarchy in its own
 * module so specialized error modules (e.g. `stellar.ts`) can extend it without
 * creating circular imports with the package entrypoint.
 *
 * @module
 */

/** Structured context available on every Astroid error. */
export interface AstroidErrorOptions {
  code: string;
  status?: number;
  /** Explicit HTTP status; defaults to `status` when omitted (issue #279). */
  statusCode?: number;
  requestId?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

/**
 * Base class for all Astroid SDK errors.
 *
 * Consumers can branch on `instanceof` for any subclass, and inspect
 * `error.code`, `error.status`, `error.requestId`, and structured `details`.
 *
 * @example
 * ```ts
 * try {
 *   await astroid.transactions.create(input);
 * } catch (err) {
 *   if (err instanceof BudgetExceededError) {
 *     console.error(err.code, err.details);
 *   }
 * }
 * ```
 */
export class AstroidError extends Error {
  /** Machine-readable error code (mirrors the API error code where possible). */
  readonly code: string;
  /** HTTP status code, when the error originated from an HTTP response. */
  readonly status: number | undefined;
  /**
   * HTTP status code of the failed response that produced this error.
   *
   * Alias of {@link status} provided for issue #279 parity — consumers can
   * read either property; both always carry the same value.
   */
  readonly statusCode: number | undefined;
  /** The API request id, for correlating with backend logs. */
  readonly requestId: string | undefined;
  /** Structured, machine-readable detail. */
  readonly details: Record<string, unknown> | undefined;

  constructor(message: string, options: AstroidErrorOptions) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code;
    this.status = options.status;
    this.statusCode = options.statusCode ?? options.status;
    this.requestId = options.requestId;
    this.details = options.details;
    // Restore prototype chain for reliable `instanceof` across transpile targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Alias for {@link code} using the `errorCode` spelling from the API error
   * envelope, so callers can branch on either name.
   */
  get errorCode(): string {
    return this.code;
  }

  /** Whether retrying the request could plausibly succeed. */
  get isRetryable(): boolean {
    return false;
  }

  /** A plain, serialisable representation (safe to log — no secrets). */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
      statusCode: this.statusCode,
      requestId: this.requestId,
      details: this.details,
      stack: this.stack,
    };
  }
}

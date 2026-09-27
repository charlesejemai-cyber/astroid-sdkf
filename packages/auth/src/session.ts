/**
 * Session management and automatic token refresh for `@astroid/auth`.
 *
 * @packageDocumentation
 */

import { AuthenticationError } from '@astroid/errors';
import type { AuthTokens } from '@astroid/types';
import type { HttpClient, Middleware, PreparedRequest } from '@astroid/core';

/** Custom storage interface for persisting session tokens (e.g., localStorage). */
export interface TokenStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

/**
 * Authentication strategy a {@link SessionManager} operates in:
 *
 * - `'jwt'` — a bearer access/refresh token pair with automatic refresh.
 * - `'apiKey'` — a long-lived API key sent as a header (no refresh cycle).
 */
export type SessionAuthMode = 'jwt' | 'apiKey';

/** Options for constructing a {@link SessionManager}. */
export interface SessionManagerConfig {
  /** Authentication strategy. Inferred when omitted (see {@link SessionManager.mode}). */
  mode?: SessionAuthMode;
  accessToken?: string;
  refreshToken?: string;
  /** Long-lived API key used in `'apiKey'` mode. */
  apiKey?: string;
  /** Header that carries the API key. Defaults to `'x-api-key'`. */
  apiKeyHeader?: string;
  storage?: TokenStorage;
  storageKeyPrefix?: string;
  bufferSeconds?: number;
  onTokenUpdate?: (tokens: AuthTokens) => void | Promise<void>;
}

/** Standard JWT payload claims. */
export interface JwtPayload {
  exp?: number;
  iat?: number;
  sub?: string;
  [key: string]: unknown;
}

/**
 * Decode a base64 / base64url string without external dependencies.
 */
function decodeBase64(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  if (typeof atob === 'function') {
    return atob(base64);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(base64, 'base64').toString('utf-8');
  }
  throw new Error('No base64 decoding environment available');
}

/**
 * Parse a JWT string and extract its decoded payload object.
 * Returns null if the token is malformed or unparseable.
 */
export function parseJwt(token: string | undefined): JwtPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payloadJson = decodeBase64(parts[1]!);
    return JSON.parse(payloadJson) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Extract the expiration timestamp (`exp` in seconds) from a JWT token.
 * Returns null if the claim is missing or unparseable.
 */
export function getTokenExpiration(token: string | undefined): number | null {
  if (!token) return null;
  const payload = parseJwt(token);
  return typeof payload?.exp === 'number' ? payload.exp : null;
}

/**
 * Check if a token is expired or close to expiration (within bufferSeconds).
 */
export function isTokenExpired(token: string | undefined, bufferSeconds = 30): boolean {
  if (!token) return true;
  const exp = getTokenExpiration(token);
  if (exp === null) return false;
  const now = Math.floor(Date.now() / 1000);
  return now + bufferSeconds >= exp;
}

/**
 * Manages token lifecycles, persistence, and concurrent token refresh queuing.
 */
export class SessionManager {
  private accessToken?: string;
  private refreshToken?: string;
  private apiKey?: string;
  private readonly storage?: TokenStorage;
  private readonly prefix: string;
  private readonly bufferSeconds: number;
  private readonly authMode: SessionAuthMode;
  private readonly apiKeyHeader: string;
  private readonly onTokenUpdate?: (tokens: AuthTokens) => void | Promise<void>;
  private activeRefreshPromise: Promise<AuthTokens> | null = null;

  constructor(config: SessionManagerConfig = {}) {
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.apiKey = config.apiKey;
    this.storage = config.storage;
    this.prefix = config.storageKeyPrefix ?? 'astroid_auth_';
    this.bufferSeconds = config.bufferSeconds ?? 30;
    this.apiKeyHeader = config.apiKeyHeader ?? 'x-api-key';
    // Infer the mode when not explicit: an API key without bearer tokens means
    // key-based auth, otherwise default to the JWT flow.
    this.authMode =
      config.mode ?? (config.apiKey && !config.accessToken ? 'apiKey' : 'jwt');
    this.onTokenUpdate = config.onTokenUpdate;
  }

  /** The authentication strategy this session operates in. */
  get mode(): SessionAuthMode {
    return this.authMode;
  }

  /** The active access token. */
  getAccessToken(): string | undefined {
    return this.accessToken;
  }

  /** The active refresh token. */
  getRefreshToken(): string | undefined {
    return this.refreshToken;
  }

  /** The configured API key (only meaningful in `'apiKey'` mode). */
  getApiKey(): string | undefined {
    return this.apiKey;
  }

  /**
   * Adopt a long-lived API key, persist it when a storage backend is
   * configured, and switch the session into `'apiKey'` mode.
   */
  async setApiKey(apiKey: string): Promise<void> {
    if (typeof apiKey !== 'string' || apiKey.trim() === '') {
      throw new AuthenticationError('API key must be a non-empty string', {
        code: 'UNAUTHORIZED',
        status: 401,
      });
    }
    this.apiKey = apiKey;
    if (this.storage) {
      try {
        await this.storage.setItem(`${this.prefix}api_key`, apiKey);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('Failed to persist API key to storage:', err);
      }
    }
  }

  /**
   * The outbound auth header for the current credentials, or `undefined` when
   * the session is unauthenticated.
   *
   * In `'apiKey'` mode returns `{ 'x-api-key': key }` (header name configurable
   * via {@link SessionManagerConfig.apiKeyHeader}); in `'jwt'` mode returns
   * `{ authorization: 'Bearer <accessToken>' }`.
   */
  getAuthHeaders(): Record<string, string> | undefined {
    if (this.authMode === 'apiKey') {
      return this.apiKey ? { [this.apiKeyHeader]: this.apiKey } : undefined;
    }
    return this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : undefined;
  }

  /**
   * Return a copy of `headers` with the session's auth header merged in.
   * Headers are left untouched when the session is unauthenticated.
   */
  applyAuthHeaders(headers: Record<string, string> = {}): Record<string, string> {
    const auth = this.getAuthHeaders();
    return auth ? { ...headers, ...auth } : { ...headers };
  }

  /**
   * Whether the session currently holds usable credentials.
   *
   * API-key sessions are authenticated while a key is present. JWT sessions
   * are authenticated only while an access token is present and unexpired.
   */
  isAuthenticated(): boolean {
    if (this.authMode === 'apiKey') return this.apiKey !== undefined && this.apiKey !== '';
    return this.accessToken !== undefined && !isTokenExpired(this.accessToken, 0);
  }

  /**
   * Throw an {@link AuthenticationError} unless the session is authenticated.
   *
   * @throws {AuthenticationError} With code `UNAUTHENTICATED` when no
   *   credentials exist, or `TOKEN_EXPIRED` when the access token has lapsed.
   */
  assertAuthenticated(): void {
    if (this.isAuthenticated()) return;
    if (this.authMode === 'apiKey') {
      throw new AuthenticationError('No API key is configured for this session', {
        code: 'UNAUTHENTICATED',
        status: 401,
      });
    }
    if (!this.accessToken) {
      throw new AuthenticationError('No access token is configured for this session', {
        code: 'UNAUTHENTICATED',
        status: 401,
      });
    }
    throw new AuthenticationError('Access token has expired', {
      code: 'TOKEN_EXPIRED',
      status: 401,
    });
  }

  /**
   * Update active tokens and persist them to storage if configured.
   */
  async setTokens(tokens: { accessToken: string; refreshToken?: string }): Promise<void> {
    this.accessToken = tokens.accessToken;
    if (tokens.refreshToken !== undefined) {
      this.refreshToken = tokens.refreshToken;
    }

    if (this.storage) {
      try {
        await this.storage.setItem(`${this.prefix}access_token`, tokens.accessToken);
        if (tokens.refreshToken) {
          await this.storage.setItem(`${this.prefix}refresh_token`, tokens.refreshToken);
        }
      } catch (err) {
        // Storage quota exceptions should not crash token adoption
        // eslint-disable-next-line no-console
        console.warn('Failed to persist tokens to storage:', err);
      }
    }

    if (this.onTokenUpdate) {
      try {
        const exp = getTokenExpiration(tokens.accessToken);
        const now = Math.floor(Date.now() / 1000);
        const expiresIn = exp ? Math.max(0, exp - now) : 3600;
        await this.onTokenUpdate({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? this.refreshToken ?? '',
          expiresIn,
          tokenType: 'Bearer',
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('Failed to execute onTokenUpdate callback:', err);
      }
    }
  }

  /**
   * Clear active credentials from memory and storage securely.
   */
  async clearTokens(): Promise<void> {
    this.accessToken = undefined;
    this.refreshToken = undefined;

    if (this.storage) {
      try {
        await this.storage.removeItem(`${this.prefix}access_token`);
        await this.storage.removeItem(`${this.prefix}refresh_token`);
        await this.storage.removeItem(`${this.prefix}api_key`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('Failed to clear tokens from storage:', err);
      }
    }
  }

  /** Check if the current access token is expired or close to expiration. */
  isAccessTokenExpired(bufferSeconds = this.bufferSeconds): boolean {
    return isTokenExpired(this.accessToken, bufferSeconds);
  }

  /** Check if the current refresh token is expired or close to expiration. */
  isRefreshTokenExpired(bufferSeconds = this.bufferSeconds): boolean {
    return isTokenExpired(this.refreshToken, bufferSeconds);
  }

  /**
   * Queue mechanism for concurrent refresh calls:
   * Ensures only one refresh request is executed simultaneously when multiple calls
   * encounter an expired token concurrently.
   */
  async refreshSession(
    refreshFn: (refreshToken: string) => Promise<AuthTokens>,
  ): Promise<AuthTokens> {
    if (this.authMode === 'apiKey') {
      throw new AuthenticationError(
        'API key authentication does not support token refresh',
        { code: 'API_KEY_MODE', status: 401 },
      );
    }

    if (this.activeRefreshPromise) {
      return this.activeRefreshPromise;
    }

    if (!this.refreshToken || this.isRefreshTokenExpired(0)) {
      await this.clearTokens();
      throw new AuthenticationError('Refresh token is missing or expired', {
        code: 'TOKEN_EXPIRED',
        status: 401,
      });
    }

    const tokenToUse = this.refreshToken;

    this.activeRefreshPromise = (async () => {
      try {
        const tokens = await refreshFn(tokenToUse);
        await this.setTokens(tokens);
        return tokens;
      } catch (err) {
        await this.clearTokens();
        if (err instanceof AuthenticationError) {
          throw err;
        }
        throw new AuthenticationError('Failed to refresh session token', {
          code: 'TOKEN_EXPIRED',
          status: 401,
          cause: err,
        });
      } finally {
        this.activeRefreshPromise = null;
      }
    })();

    return this.activeRefreshPromise;
  }

  /** True while a refresh started by {@link refreshSession} is in flight. */
  isRefreshing(): boolean {
    return this.activeRefreshPromise !== null;
  }

  /**
   * Resolve once any in-flight refresh settles; resolves immediately when
   * idle. A failed refresh is swallowed here — waiting callers surface the
   * resulting authentication error through the normal 401 path instead of
   * duplicating it for every queued request.
   */
  async waitForRefresh(): Promise<void> {
    const pending = this.activeRefreshPromise;
    if (!pending) return;
    try {
      await pending;
    } catch {
      // The failed refresh already cleared tokens; the caller's own request
      // will produce the authoritative authentication error.
    }
  }
}

/**
 * Wire a {@link SessionManager} to an {@link HttpClient} so that 401
 * responses trigger automatic token refresh and the failed request is
 * retried with the new credentials.
 *
 * ```ts
 * import { SessionManager, wireSessionToHttpClient } from '@astroid/auth';
 *
 * const session = new SessionManager({ storage: localStorage });
 * const client = new Astroid({ baseUrl, apiKey });
 * wireSessionToHttpClient(client, session, refreshFn);
 * ```
 */
export function wireSessionToHttpClient(
  client: HttpClient,
  sessionManager: SessionManager,
  refreshFn: (refreshToken: string) => Promise<AuthTokens>,
): void {
  // API-key sessions have no refresh cycle: attach the key header via
  // middleware instead of a 401 handler.
  if (sessionManager.mode === 'apiKey') {
    client.use(createSessionMiddleware(sessionManager, refreshFn));
    return;
  }

  client.set401Handler(async () => {
    try {
      await sessionManager.refreshSession(refreshFn);
      const token = sessionManager.getAccessToken();
      if (token) client.setAccessToken(token);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Creates an SDK middleware interceptor that checks for token expiration
 * and automatically triggers queued session refresh before outgoing requests.
 */
export function createSessionMiddleware(
  sessionManager: SessionManager,
  refreshFn: (refreshToken: string) => Promise<AuthTokens>,
): Middleware {
  return {
    name: 'session-auto-refresh',
    async onRequest(req: PreparedRequest): Promise<PreparedRequest> {
      // API-key sessions carry a long-lived header and never refresh.
      if (sessionManager.mode === 'apiKey') {
        const apiKey = sessionManager.getApiKey();
        return apiKey
          ? { ...req, headers: sessionManager.applyAuthHeaders(req.headers) }
          : req;
      }

      // Do not intercept authentication endpoints to prevent cyclic calls
      if (
        req.url.includes('/auth/refresh') ||
        req.url.includes('/auth/login') ||
        req.url.includes('/auth/register')
      ) {
        return req;
      }

      if (sessionManager.getRefreshToken() && sessionManager.isAccessTokenExpired()) {
        try {
          const newTokens = await sessionManager.refreshSession(refreshFn);
          return {
            ...req,
            headers: {
              ...req.headers,
              authorization: `Bearer ${newTokens.accessToken}`,
            },
          };
        } catch (err) {
          if (err instanceof AuthenticationError) {
            throw err;
          }
          throw new AuthenticationError('Session expired and token refresh failed', {
            code: 'TOKEN_EXPIRED',
            status: 401,
            cause: err,
          });
        }
      }

      return req;
    },
    async onError(error: unknown, _req: PreparedRequest): Promise<void> {
      if (error instanceof AuthenticationError && error.status === 401) {
        await sessionManager.clearTokens();
      }
    },
  };
}

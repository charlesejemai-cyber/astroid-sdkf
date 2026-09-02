/**
 * Common shared types, pagination, and response metadata.
 */

/** Standard pagination request parameters. */
export interface PaginationParams {
  /** 1-based page number (offset pagination). */
  page?: number;
  /** Opaque cursor for keyset pagination. */
  cursor?: string;
  /** Maximum number of items to return per page. */
  limit?: number;
  /** Sort direction. */
  order?: 'asc' | 'desc';
}

/** Full pagination metadata attached to a list response. */
export interface PaginationMeta {
  /** The current 1-based page number. */
  page: number;
  /** The page size used for this response. */
  limit: number;
  /** Total number of matching items across all pages. */
  total: number;
  /** Total number of pages given `limit`. */
  totalPages: number;
  /** Whether a page exists after this one. */
  hasNextPage: boolean;
  /** Whether a page exists before this one. */
  hasPreviousPage: boolean;
}

/** Standard paginated response envelope. */
export interface PaginatedResponse<T> {
  data: T[];
  meta?: ResponseMeta;
}

/** A normalized page of results with complete pagination metadata. */
export interface Paginated<T> {
  /** The items on this page. */
  data: T[];
  /** Pagination metadata for navigating the result set. */
  meta: PaginationMeta;
}

/** Request parameters for cursor-based (keyset) pagination. */
export interface CursorPaginationParams {
  /** Opaque cursor identifying where the next page should start. */
  cursor?: string;
  /** Maximum number of items to return. */
  limit?: number;
  /** Sort direction relative to the cursor. */
  order?: 'asc' | 'desc';
}

/** A normalized page of results for cursor-based pagination. */
export interface CursorPaginated<T> {
  /** The items on this page. */
  items: T[];
  /** Cursor to pass back for the next page, or `null` when exhausted. */
  nextCursor: string | null;
  /** Whether more pages follow this one. */
  hasMore: boolean;
}

/** Standard metadata returned with API responses. */
export interface ResponseMeta {
  /** Opaque cursor for resuming keyset pagination. */
  cursor?: string;
  /** Cursor to pass back for the next page, or `null` when the result set is exhausted. */
  nextCursor?: string | null;
  /** The current 1-based page number (offset pagination). */
  page?: number;
  /** The page size used for this response. */
  limit?: number;
  /** Total number of matching items across all pages. */
  total?: number;
  /** Whether more pages follow this one. */
  hasMore?: boolean;
  [key: string]: unknown;
}

/** Standard API error payload structure. */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Machine-readable error codes returned by the Astroid API.
 *
 * Mirrors the backend error catalogue exactly so the SDK's error classes can
 * branch on a stable value rather than a message string.
 */
export const ApiErrorCode = {
  /** Missing or invalid credentials. */
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  /** Request was not authenticated. */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** The supplied API key is invalid or revoked. */
  INVALID_API_KEY: 'INVALID_API_KEY',
  /** The access token has expired. */
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  /** Authenticated but not permitted to perform this action. */
  FORBIDDEN: 'FORBIDDEN',
  /** The request failed schema or business validation. */
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  /** The request was malformed. */
  BAD_REQUEST: 'BAD_REQUEST',
  /** The requested resource does not exist. */
  NOT_FOUND: 'NOT_FOUND',
  /** The request conflicts with the current resource state. */
  CONFLICT: 'CONFLICT',
  /** A transaction violates one or more spending policies. */
  POLICY_VIOLATION: 'POLICY_VIOLATION',
  /** The transaction's risk score exceeds the configured threshold. */
  RISK_THRESHOLD_EXCEEDED: 'RISK_THRESHOLD_EXCEEDED',
  /** The transaction would exceed an available budget. */
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  /** The source account lacks sufficient funds. */
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  /** The wallet is frozen and cannot transact. */
  WALLET_FROZEN: 'WALLET_FROZEN',
  /** The action requires human approval before it can execute. */
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  /** Rate limit exceeded. */
  RATE_LIMITED: 'RATE_LIMITED',
  /** A network-level failure occurred before a response was received. */
  NETWORK_ERROR: 'NETWORK_ERROR',
  /** The request timed out. */
  TIMEOUT: 'TIMEOUT',
  /** An unexpected server error occurred. */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** The service is temporarily unavailable. */
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/** A successful API response envelope. */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: ResponseMeta;
  requestId?: string;
}

/** A failed API response envelope. */
export interface ApiErrorResponse {
  success: false;
  error: ApiError;
  requestId?: string;
}

/** The discriminated union of every API response shape. */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

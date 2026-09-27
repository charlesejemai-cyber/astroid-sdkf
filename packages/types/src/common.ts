/**
 * Common shared types, pagination, and response metadata.
 */

/** Machine-readable API error codes returned in the error envelope. */
export const ApiErrorCode = {
  // Auth
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_API_KEY: 'INVALID_API_KEY',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  // Domain
  POLICY_VIOLATION: 'POLICY_VIOLATION',
  POLICY_REJECTED: 'POLICY_REJECTED',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  RISK_THRESHOLD_EXCEEDED: 'RISK_THRESHOLD_EXCEEDED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  WALLET_FROZEN: 'WALLET_FROZEN',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  PROPOSAL_EXPIRED: 'PROPOSAL_EXPIRED',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  // Resource
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  // Rate / server
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  // Client-side (SDK generated)
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/** The `error` object embedded in a failed response envelope. */
export interface ApiError {
  code: ApiErrorCode | string;
  message: string;
  /** Optional structured detail (e.g. field validation errors, policy context). */
  details?: Record<string, unknown>;
}

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
  /** Cursor for the previous page, or `null` when this is the first page. */
  prevCursor?: string | null;
  /** Whether more pages follow this one. */
  hasMore: boolean;
}

/** Standard metadata returned with API responses. */
export interface ResponseMeta {
  /** Opaque cursor for resuming keyset pagination. */
  cursor?: string;
  /** Cursor to pass back for the next page, or `null` when the result set is exhausted. */
  nextCursor?: string | null;
  /** Cursor for the previous page, or `null` when this is the first page. */
  prevCursor?: string | null;
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

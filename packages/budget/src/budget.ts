/**
 * Budget resource client and allocation-tracking helpers.
 *
 * {@link BudgetClient} is a thin, typed wrapper over the Astroid budget
 * endpoints — create, read, update, delete, consume, history and metrics — plus
 * an {@link BudgetClient.allocationStatus | allocationStatus} check that reports
 * how much of a budget's allocation is spent.
 *
 * The client talks to the API through a minimal injected {@link BudgetHttpClient}
 * transport (satisfied by `@astroid/client`), which keeps this package free of a
 * hard dependency on the HTTP layer and makes every method trivial to unit-test
 * with a mocked transport.
 *
 * The allocation helpers ({@link deriveAllocationStatus},
 * {@link classifyAllocation}, {@link isAllocationExhausted}) are pure functions
 * that work offline against a {@link Budget} you already hold.
 *
 * @module
 */

import type {
  Budget,
  BudgetAlert,
  BudgetAllocationState,
  BudgetAllocationStatus,
  BudgetAllocationThresholds,
  BudgetHistoryEntry,
  BudgetHistoryQueryParams,
  BudgetMetrics,
  BudgetSimulationRequest,
  BudgetUtilization,
  BudgetCheckResult,
  ConsumeBudgetInput,
  CreateBudgetAlertInput,
  CreateBudgetInput,
  DecimalString,
  ListBudgetAlertsParams,
  PaginatedResponse,
  PaginationParams,
  UpdateBudgetAlertInput,
  UpdateBudgetInput,
} from '@astroid/types';
import {
  createBudgetAlert,
  listBudgetAlerts,
  getBudgetAlert,
  updateBudgetAlert,
  deleteBudgetAlert,
} from './alerts.js';

/* -------------------------------------------------------------------------- */
/* Transport                                                                   */
/* -------------------------------------------------------------------------- */

/** Query parameters passed to a transport request. */
export type BudgetQuery = Record<string, string | number | boolean | undefined | null>;

/** Per-request options accepted by the transport. */
export interface BudgetRequestOptions {
  query?: BudgetQuery;
  signal?: AbortSignal;
}

/**
 * The minimal HTTP surface {@link BudgetClient} needs. `@astroid/client`'s
 * `Astroid` instance satisfies this shape; tests pass a mock.
 */
export interface BudgetHttpClient {
  get<T>(path: string, options?: BudgetRequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: BudgetRequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: BudgetRequestOptions): Promise<T>;
  delete<T>(path: string, options?: BudgetRequestOptions): Promise<T>;
}

/** Filter + pagination parameters for listing budgets. */
export interface ListBudgetsParams extends PaginationParams {
  /** Only budgets scoped to this agent. */
  agentId?: string;
  /** Only child budgets of this parent. */
  parentBudgetId?: string;
  /** Only enabled / disabled budgets. */
  enabled?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Query helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Drop `undefined` / `null` entries so they never reach the query string. */
export function toBudgetQuery(params?: object): BudgetQuery {
  const out: BudgetQuery = {};
  if (!params) return out;
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Decimal helpers (shared with allocation math)                               */
/* -------------------------------------------------------------------------- */

function toNumber(value: DecimalString | number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clampFraction(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function formatAmount(n: number): DecimalString {
  return String(Math.max(0, Math.round(n * 1e7) / 1e7));
}

/* -------------------------------------------------------------------------- */
/* Allocation helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Default thresholds used when classifying an allocation. */
export const DEFAULT_ALLOCATION_THRESHOLDS: Required<BudgetAllocationThresholds> = Object.freeze({
  warnAt: 80,
  criticalAt: 95,
});

/**
 * Bucket a utilization percentage (`0`–`100+`) into a {@link BudgetAllocationState}.
 *
 * - `>= 100` → `exhausted`
 * - `>= criticalAt` → `critical`
 * - `>= warnAt` → `warning`
 * - otherwise → `healthy`
 */
export function classifyAllocation(
  percent: number,
  thresholds: BudgetAllocationThresholds = {},
): BudgetAllocationState {
  const warnAt = thresholds.warnAt ?? DEFAULT_ALLOCATION_THRESHOLDS.warnAt;
  const criticalAt = thresholds.criticalAt ?? DEFAULT_ALLOCATION_THRESHOLDS.criticalAt;

  if (percent >= 100) return 'exhausted';
  if (percent >= criticalAt) return 'critical';
  if (percent >= warnAt) return 'warning';
  return 'healthy';
}

/** Whether the budget's own counters indicate its allocation is fully consumed. */
export function isAllocationExhausted(budget: Pick<Budget, 'limitAmount' | 'spent'>): boolean {
  const limit = toNumber(budget.limitAmount);
  if (limit <= 0) return false;
  return toNumber(budget.spent) >= limit;
}

/** Options for {@link deriveAllocationStatus}. */
export interface DeriveAllocationOptions extends BudgetAllocationThresholds {
  /**
   * A prospective spend to test against the remaining allowance. When set, the
   * returned status reflects spending *including* this amount and
   * `wouldExceed` is populated.
   */
  prospectiveSpend?: DecimalString | number;
}

/**
 * Compute a {@link BudgetAllocationStatus} from a {@link Budget} using only
 * local arithmetic — no network calls.
 *
 * @param budget  The budget to inspect.
 * @param options Threshold overrides and an optional prospective spend.
 */
export function deriveAllocationStatus(
  budget: Budget,
  options: DeriveAllocationOptions = {},
): BudgetAllocationStatus {
  const limit = toNumber(budget.limitAmount);
  const baseSpent = toNumber(budget.spent);
  const prospective = toNumber(options.prospectiveSpend);
  const spent = baseSpent + prospective;

  const utilization = limit > 0 ? clampFraction(spent / limit) : spent > 0 ? 1 : 0;
  const percent = limit > 0 ? Math.round((spent / limit) * 10000) / 100 : spent > 0 ? 100 : 0;
  const remaining = Math.max(0, limit - spent);

  const status: BudgetAllocationStatus = {
    budgetId: budget.id,
    limit: formatAmount(limit),
    spent: formatAmount(spent),
    remaining: formatAmount(remaining),
    utilization,
    percent,
    state: classifyAllocation(percent, options),
  };

  if (options.prospectiveSpend !== undefined) {
    status.wouldExceed = limit > 0 && spent > limit;
  }

  return status;
}

/* -------------------------------------------------------------------------- */
/* Client                                                                      */
/* -------------------------------------------------------------------------- */

const BASE_PATH = '/v1/budgets';

/**
 * Options for {@link BudgetClient.getBudgetUtilization}: an optional abort
 * signal plus custom utilization threshold boundaries.
 */
export interface BudgetUtilizationOptions extends BudgetAllocationThresholds {
  /** Optional abort signal forwarded to the transport. */
  signal?: AbortSignal;
}

/**
 * Typed wrapper over the Astroid budget endpoints.
 *
 * @example
 * ```ts
 * import { Astroid } from '@astroid/client';
 * import { BudgetClient } from '@astroid/budget';
 *
 * const budgets = new BudgetClient(new Astroid({ apiKey }));
 * const budget = await budgets.create({ name: 'Q3 Ops', limitAmount: '5000' });
 * const status = await budgets.allocationStatus(budget.id);
 * ```
 */
export class BudgetClient {
  private readonly http: BudgetHttpClient;

  constructor(http: BudgetHttpClient) {
    this.http = http;
  }

  /** Create a new budget. */
  async create(input: CreateBudgetInput): Promise<Budget> {
    return this.http.post<Budget>(BASE_PATH, input);
  }

  /** Retrieve a single budget by id. */
  async get(budgetId: string, options?: { signal?: AbortSignal }): Promise<Budget> {
    return this.http.get<Budget>(`${BASE_PATH}/${encodeURIComponent(budgetId)}`, {
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }

  /**
   * Alias of {@link get} that matches the SDK's `getBudget` resource naming.
   *
   * @example
   * ```ts
   * const budget = await budgets.getBudget('bud_1');
   * ```
   */
  async getBudget(budgetId: string, options?: { signal?: AbortSignal }): Promise<Budget> {
    return this.get(budgetId, options);
  }

  /** List budgets with optional filters and pagination. */
  async list(params?: ListBudgetsParams): Promise<PaginatedResponse<Budget>> {
    return this.http.get<PaginatedResponse<Budget>>(BASE_PATH, { query: toBudgetQuery(params) });
  }

  /**
   * Alias of {@link list} that matches the SDK's `listBudgets` resource naming.
   *
   * @example
   * ```ts
   * const page = await budgets.listBudgets({ agentId: 'agt_1', limit: 25 });
   * ```
   */
  async listBudgets(params?: ListBudgetsParams): Promise<PaginatedResponse<Budget>> {
    return this.list(params);
  }

  /**
   * Simulate a prospective spend against a budget before executing it.
   *
   * The server evaluates the request against the budget's limit, active
   * window and policy rules, returning whether the spend is allowed and the
   * resulting headroom.
   *
   * @example
   * ```ts
   * const result = await budgets.simulateBudgetCheck('bud_1', {
   *   asset: 'USDC',
   *   amount: '250',
   * });
   * if (!result.allowed) {
   *   throw new Error(result.explanation);
   * }
   * ```
   */
  async simulateBudgetCheck(
    budgetId: string,
    request: BudgetSimulationRequest,
  ): Promise<BudgetCheckResult> {
    return this.http.post<BudgetCheckResult>(
      `${BASE_PATH}/${encodeURIComponent(budgetId)}/simulate`,
      request,
    );
  }

  /** Update an existing budget. */
  async update(budgetId: string, input: UpdateBudgetInput): Promise<Budget> {
    return this.http.patch<Budget>(`${BASE_PATH}/${encodeURIComponent(budgetId)}`, input);
  }

  /**
   * Alias of {@link update} that matches the SDK's `updateBudget` resource
   * naming.
   *
   * Spending limits and other monetary fields are sent as **decimal strings**
   * (e.g. `"7500.00"`) so amounts never round-trip through IEEE-754 floats and
   * lose precision.
   *
   * @param budgetId The budget to update.
   * @param input    The mutable budget fields (limit, period, rollover, enabled).
   * @returns        The updated {@link Budget}.
   *
   * @example
   * ```ts
   * const updated = await budgets.updateBudget('bud_1', { limitAmount: '7500.00' });
   * ```
   */
  async updateBudget(budgetId: string, input: UpdateBudgetInput): Promise<Budget> {
    return this.update(budgetId, input);
  }

  /** Delete a budget. */
  async delete(budgetId: string): Promise<void> {
    await this.http.delete<void>(`${BASE_PATH}/${encodeURIComponent(budgetId)}`);
  }

  /** Record consumption against a budget, returning the updated budget. */
  async consume(budgetId: string, input: ConsumeBudgetInput): Promise<Budget> {
    return this.http.post<Budget>(`${BASE_PATH}/${encodeURIComponent(budgetId)}/consume`, input);
  }

  /**
   * Page through a budget's consumption history.
   *
   * Supports keyset (`cursor`) or offset (`page`) pagination plus `from` / `to`
   * date filters, a `transactionId` filter and `minAmount` / `maxAmount` bounds.
   */
  async history(
    budgetId: string,
    params?: BudgetHistoryQueryParams,
  ): Promise<PaginatedResponse<BudgetHistoryEntry>> {
    return this.http.get<PaginatedResponse<BudgetHistoryEntry>>(
      `${BASE_PATH}/${encodeURIComponent(budgetId)}/history`,
      { query: toBudgetQuery(params) },
    );
  }

  /** Fetch the server-computed metrics for a budget. */
  async metrics(budgetId: string): Promise<BudgetMetrics> {
    return this.http.get<BudgetMetrics>(`${BASE_PATH}/${encodeURIComponent(budgetId)}/metrics`);
  }

  /**
   * Check how much of a budget's allocation is consumed locally.
   *
   * Fetches the budget and derives a {@link BudgetAllocationStatus} locally. Pass
   * `prospectiveSpend` to test whether an upcoming charge would exceed the
   * remaining allowance.
   */
  async allocationStatus(
    budgetId: string,
    options: DeriveAllocationOptions = {},
  ): Promise<BudgetAllocationStatus> {
    const budget = await this.get(budgetId);
    return deriveAllocationStatus(budget, options);
  }

  /**
   * Fetch the current utilization snapshot for a budget.
   *
   * Queries the server-side utilization endpoint, which evaluates the budget's
   * active window and returns the limit, amount spent, headroom and utilization
   * percentage as decimal-safe values (see {@link BudgetUtilization}).
   *
   * Pass `warnAt` / `criticalAt` to have the client re-bucket the returned
   * {@link BudgetUtilization.state} from its `percent` against custom threshold
   * boundaries instead of the server defaults (`80` / `95`). This is the same
   * classification used by {@link classifyAllocation}, so agents can enforce
   * their own velocity limits without a second round-trip.
   *
   * @param budgetId The budget to inspect.
   * @param options  Optional abort signal and threshold overrides.
   * @returns        The current {@link BudgetUtilization} snapshot.
   *
   * @example
   * ```ts
   * const u = await budgets.getBudgetUtilization('bud_1', { warnAt: 70 });
   * if (u.state === 'critical' || u.state === 'exhausted') pauseAgent();
   * ```
   */
  async getBudgetUtilization(
    budgetId: string,
    options: BudgetUtilizationOptions = {},
  ): Promise<BudgetUtilization> {
    const { signal, ...thresholds } = options;
    const utilization = await this.http.get<BudgetUtilization>(
      `${BASE_PATH}/${encodeURIComponent(budgetId)}/utilization`,
      signal ? { signal } : {},
    );

    if (thresholds.warnAt !== undefined || thresholds.criticalAt !== undefined) {
      return { ...utilization, state: classifyAllocation(utilization.percent, thresholds) };
    }

    return utilization;
  }

  /**
   * Create a budget threshold alert subscription.
   *
   * @param budgetId The budget to attach the alert to.
   * @param input    Threshold percentage, notification channel, and destination.
   */
  async createAlert(budgetId: string, input: CreateBudgetAlertInput): Promise<BudgetAlert> {
    return createBudgetAlert(this.http, budgetId, input);
  }

  /** Alias of {@link createAlert} for threshold-explicit naming. */
  async createThresholdAlert(
    budgetId: string,
    input: CreateBudgetAlertInput,
  ): Promise<BudgetAlert> {
    return this.createAlert(budgetId, input);
  }

  /**
   * List threshold alerts configured on a budget.
   *
   * @param budgetId The budget whose alerts to list.
   * @param params   Optional status and channel filters and pagination.
   */
  async listAlerts(
    budgetId: string,
    params?: ListBudgetAlertsParams,
  ): Promise<PaginatedResponse<BudgetAlert>> {
    return listBudgetAlerts(this.http, budgetId, params);
  }

  /** Alias of {@link listAlerts} for threshold-explicit naming. */
  async listThresholdAlerts(
    budgetId: string,
    params?: ListBudgetAlertsParams,
  ): Promise<PaginatedResponse<BudgetAlert>> {
    return this.listAlerts(budgetId, params);
  }

  /**
   * Retrieve a single budget alert by id.
   *
   * @param budgetId The budget id.
   * @param alertId  The alert id.
   */
  async getAlert(budgetId: string, alertId: string): Promise<BudgetAlert> {
    return getBudgetAlert(this.http, budgetId, alertId);
  }

  /** Alias of {@link getAlert} for threshold-explicit naming. */
  async getThresholdAlert(budgetId: string, alertId: string): Promise<BudgetAlert> {
    return this.getAlert(budgetId, alertId);
  }

  /**
   * Update a budget threshold alert subscription.
   *
   * @param budgetId The budget id.
   * @param alertId  The alert id.
   * @param input    Updated threshold percent, channel, destination, or status.
   */
  async updateAlert(
    budgetId: string,
    alertId: string,
    input: UpdateBudgetAlertInput,
  ): Promise<BudgetAlert> {
    return updateBudgetAlert(this.http, budgetId, alertId, input);
  }

  /** Alias of {@link updateAlert} for threshold-explicit naming. */
  async updateThresholdAlert(
    budgetId: string,
    alertId: string,
    input: UpdateBudgetAlertInput,
  ): Promise<BudgetAlert> {
    return this.updateAlert(budgetId, alertId, input);
  }

  /**
   * Delete a budget threshold alert subscription.
   *
   * @param budgetId The budget id.
   * @param alertId  The alert id to delete.
   */
  async deleteAlert(budgetId: string, alertId: string): Promise<void> {
    return deleteBudgetAlert(this.http, budgetId, alertId);
  }

  /** Alias of {@link deleteAlert} for threshold-explicit naming. */
  async deleteThresholdAlert(budgetId: string, alertId: string): Promise<void> {
    return this.deleteAlert(budgetId, alertId);
  }
}

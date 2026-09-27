/**
 * Budget threshold alert subscription helpers.
 *
 * Runaway automated spending on Stellar is best caught early. These helpers wrap
 * the Astroid budget-alert endpoints so developers can subscribe webhook / email
 * / Slack notifications to specific budget utilization percentages (commonly
 * `50%`, `80%`, `100%` — see {@link BUDGET_ALERT_THRESHOLDS}).
 *
 * Each function takes a {@link BudgetHttpClient} transport (satisfied by
 * `@astroid/client`) as its first argument, so they compose with
 * {@link BudgetClient} and are trivial to unit-test with a mock.
 *
 * @module
 */

import type {
  BudgetAlert,
  BudgetAlertChannel,
  CreateBudgetAlertInput,
  ListBudgetAlertsParams,
  PaginatedResponse,
  UpdateBudgetAlertInput,
} from '@astroid/types';
import { AstroidError } from '@astroid/errors';

import { toBudgetQuery, type BudgetHttpClient } from './budget.js';

export { BUDGET_ALERT_THRESHOLDS } from '@astroid/types';

/** Channels that require a non-empty `target`. */
const TARGETED_CHANNELS: readonly BudgetAlertChannel[] = ['EMAIL', 'WEBHOOK', 'SLACK'];

const VALID_CHANNELS: readonly BudgetAlertChannel[] = ['EMAIL', 'WEBHOOK', 'SLACK', 'DASHBOARD'];

/** Error thrown when a budget alert payload fails local validation. */
export class BudgetAlertValidationError extends AstroidError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { code: 'BUDGET_ALERT_VALIDATION_ERROR', status: 400, details });
    this.name = 'BudgetAlertValidationError';
  }
}

/** Whether `value` is a valid {@link BudgetAlertChannel}. */
export function isValidBudgetAlertChannel(value: unknown): value is BudgetAlertChannel {
  return typeof value === 'string' && (VALID_CHANNELS as readonly string[]).includes(value);
}

/**
 * Validate a threshold percentage: a finite number in `(0, 1000]`.
 *
 * @throws {BudgetAlertValidationError} When out of range.
 */
export function assertValidThresholdPercent(percent: number): void {
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0 || percent > 1000) {
    throw new BudgetAlertValidationError(
      'thresholdPercent must be a finite number greater than 0 and at most 1000.',
      { thresholdPercent: percent },
    );
  }
}

function validateCreateInput(input: CreateBudgetAlertInput): void {
  assertValidThresholdPercent(input.thresholdPercent);
  if (!isValidBudgetAlertChannel(input.channel)) {
    throw new BudgetAlertValidationError(
      `Unknown budget alert channel "${String(input.channel)}".`,
      {
        channel: input.channel,
      },
    );
  }
  if (
    (TARGETED_CHANNELS as readonly string[]).includes(input.channel) &&
    (typeof input.target !== 'string' || input.target.trim() === '')
  ) {
    throw new BudgetAlertValidationError(
      `A "${input.channel}" alert requires a non-empty target.`,
      { channel: input.channel },
    );
  }
}

const alertsPath = (budgetId: string): string =>
  `/v1/budgets/${encodeURIComponent(budgetId)}/alerts`;

const alertPath = (budgetId: string, alertId: string): string =>
  `${alertsPath(budgetId)}/${encodeURIComponent(alertId)}`;

/**
 * Create a budget threshold alert subscription.
 *
 * @param http     The HTTP transport.
 * @param budgetId The budget to attach the alert to.
 * @param input    Threshold, channel and destination.
 * @throws {BudgetAlertValidationError} When `input` is structurally invalid.
 */
export async function createBudgetAlert(
  http: BudgetHttpClient,
  budgetId: string,
  input: CreateBudgetAlertInput,
): Promise<BudgetAlert> {
  validateCreateInput(input);
  return http.post<BudgetAlert>(alertsPath(budgetId), input);
}

/** List the threshold alerts configured on a budget. */
export async function listBudgetAlerts(
  http: BudgetHttpClient,
  budgetId: string,
  params?: ListBudgetAlertsParams,
): Promise<PaginatedResponse<BudgetAlert>> {
  return http.get<PaginatedResponse<BudgetAlert>>(alertsPath(budgetId), {
    query: toBudgetQuery(params),
  });
}

/** Retrieve a single budget alert by id. */
export async function getBudgetAlert(
  http: BudgetHttpClient,
  budgetId: string,
  alertId: string,
): Promise<BudgetAlert> {
  return http.get<BudgetAlert>(alertPath(budgetId, alertId));
}

/**
 * Update a budget alert.
 *
 * @throws {BudgetAlertValidationError} When a supplied field is invalid.
 */
export async function updateBudgetAlert(
  http: BudgetHttpClient,
  budgetId: string,
  alertId: string,
  input: UpdateBudgetAlertInput,
): Promise<BudgetAlert> {
  if (input.thresholdPercent !== undefined) {
    assertValidThresholdPercent(input.thresholdPercent);
  }
  if (input.channel !== undefined && !isValidBudgetAlertChannel(input.channel)) {
    throw new BudgetAlertValidationError(
      `Unknown budget alert channel "${String(input.channel)}".`,
      {
        channel: input.channel,
      },
    );
  }
  return http.patch<BudgetAlert>(alertPath(budgetId, alertId), input);
}

/** Delete a budget alert subscription. */
export async function deleteBudgetAlert(
  http: BudgetHttpClient,
  budgetId: string,
  alertId: string,
): Promise<void> {
  await http.delete<void>(alertPath(budgetId, alertId));
}

// Re-exported for discoverability alongside the alert helpers.
export type {
  BudgetAlert,
  BudgetAlertChannel,
  CreateBudgetAlertInput,
  UpdateBudgetAlertInput,
  ListBudgetAlertsParams,
} from '@astroid/types';

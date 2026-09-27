/**
 * Budget-related DTOs for simulation and utilization queries.
 *
 * These complement the {@link Budget} entity. The budget API lets agents
 * simulate whether a prospective draw would breach their allocation before
 * committing to it, and exposes a per-budget utilization snapshot.
 *
 * @module
 */

import type { DecimalString, IsoDateTime } from './entities.js';
import type { Budget } from './entities.js';
import type { BudgetPeriod } from './enums.js';
import type { PaginationParams } from './common.js';

/** A prospective spend draw to simulate against a budget. */
export interface BudgetSimulationInput {
  /** Asset identifier (e.g. `"XLM"`, `"USDC"`, `"USDC:G...Issuer"`). */
  asset: string;
  /** Amount to draw (decimal string or number). */
  amount: DecimalString | number;
}

/** The outcome of simulating a draw against a budget (nothing is committed). */
export interface BudgetSimulationResult {
  /** The budget the simulation ran against. */
  budget: Budget;
  /** Whether the draw is permitted under the budget's rules. */
  allowed: boolean;
  /** Whether the draw would breach the budget's remaining allowance. */
  wouldExceed: boolean;
  /** Remaining headroom after applying the simulated draw (decimal string). */
  remainingAfter: DecimalString;
  /** When `wouldExceed` is true, a human-readable description of the breach. */
  restriction: string | null;
  /** The active window start the simulation was evaluated against (ISO-8601 UTC). */
  windowStart: IsoDateTime;
  /** The active window end the simulation was evaluated against (ISO-8601 UTC). */
  windowEnd: IsoDateTime;
}

/** Health of a budget's current allocation, bucketed by utilisation. */
export type BudgetAllocationState = 'healthy' | 'warning' | 'critical' | 'exhausted';

/** A point-in-time view of how much of a budget's allocation is consumed. */
export interface BudgetAllocationStatus {
  /** The budget this status describes. */
  budgetId: string;
  /** The active-window limit. */
  limit: DecimalString;
  /** Amount consumed in the active window. */
  spent: DecimalString;
  /** `limit - spent`, clamped at 0. */
  remaining: DecimalString;
  /** Fraction of the limit consumed, `0`–`1` (clamped). */
  utilization: number;
  /** {@link utilization} as a percentage, `0`–`100`, rounded to 2 dp. */
  percent: number;
  /** Bucketed health derived from {@link percent} and the configured thresholds. */
  state: BudgetAllocationState;
  /** Whether a prospective spend (when supplied) would push spending past the limit. */
  wouldExceed?: boolean;
}

/** A utilization snapshot for a single budget. */
export interface BudgetUtilization {
  budgetId: string;
  period: BudgetPeriod;
  periodStart: IsoDateTime;
  periodEnd: IsoDateTime;
  /** Configured spend limit for the active window (decimal string). */
  limit: DecimalString;
  /** Total consumption so far in the active window (decimal string). */
  spent: DecimalString;
  /** Headroom left (limit minus spent), as a decimal string. */
  remaining: DecimalString;
  /** Fraction consumed (0..1+), useful for progress bars. */
  utilization: number;
  /** {@link utilization} as a percentage, `0`–`100`, rounded to 2 dp. */
  percent: number;
  /** Bucketed health derived from {@link percent} and the configured thresholds. */
  state: BudgetAllocationState;
  /** Whether a prospective spend (when supplied) would push spending past the limit. */
  wouldExceed?: boolean;
}

/** Thresholds (percent of limit) that bucket an allocation into a {@link BudgetAllocationState}. */
export interface BudgetAllocationThresholds {
  /** Percent at which the state becomes `warning`. Default `80`. */
  warnAt?: number;
  /** Percent at which the state becomes `critical`. Default `95`. */
  criticalAt?: number;
}

/* -------------------------------------------------------------------------- */
/* Simulation                                                                  */
/* -------------------------------------------------------------------------- */

/** A prospective spend to simulate against a budget. */
export interface BudgetSimulationRequest {
  /** Asset identifier (e.g. `"USDC"`, `"XLM"`). */
  asset: string;
  /** Amount to spend (decimal string or number). */
  amount: DecimalString | number;
  /** Optional agent the spend is attributed to. */
  agentId?: string;
  /** Optional originating transaction. */
  transactionId?: string;
}

/** The outcome of a policy/budget check simulation (`simulateBudgetCheck`). */
export interface BudgetCheckResult {
  budgetId: string;
  /** Whether the spend is allowed under the budget's limits. */
  allowed: boolean;
  /** Whether the spend would push the budget past its limit. */
  wouldExceed: boolean;
  /** Remaining headroom after the simulated spend. */
  afterRemaining: DecimalString;
  /** Utilization fraction after the simulated spend, `0`–`1`. */
  utilizationAfter: number;
  /** Bucketed health after the simulated spend. */
  state: BudgetAllocationState;
  /** Violated rules (empty when `allowed` is true). */
  violations: string[];
  /** Human-readable explanation of the outcome. */
  explanation: string;
}

/* -------------------------------------------------------------------------- */
/* Threshold alerts                                                            */
/* -------------------------------------------------------------------------- */

/** Delivery channel for a budget threshold alert. */
export type BudgetAlertChannel = 'EMAIL' | 'WEBHOOK' | 'SLACK' | 'DASHBOARD';

/** Lifecycle status of a budget alert subscription. */
export type BudgetAlertStatus = 'ACTIVE' | 'PAUSED' | 'TRIGGERED';

/** The utilization percentages Astroid recommends configuring alerts at. */
export const BUDGET_ALERT_THRESHOLDS = Object.freeze([50, 80, 100] as const);

/** A configured budget threshold alert subscription. */
export interface BudgetAlert {
  id: string;
  budgetId: string;
  organizationId: string;
  /** Utilization percentage (`1`–`1000`) at which the alert fires. */
  thresholdPercent: number;
  /** Where the notification is delivered. */
  channel: BudgetAlertChannel;
  /**
   * Channel-specific destination: a URL for `WEBHOOK`, an email address for
   * `EMAIL`, a channel id for `SLACK`. Ignored for `DASHBOARD`.
   */
  target: string;
  /** Current status. */
  status: BudgetAlertStatus;
  /** Whether the alert re-arms after the budget period resets. */
  recurring: boolean;
  /** Last time this alert fired, if ever. */
  lastTriggeredAt?: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Payload for creating a budget threshold alert. */
export interface CreateBudgetAlertInput {
  /** Utilization percentage at which to fire (e.g. `50`, `80`, `100`). */
  thresholdPercent: number;
  /** Delivery channel. */
  channel: BudgetAlertChannel;
  /** Channel-specific destination. Required for every channel except `DASHBOARD`. */
  target?: string;
  /** Whether the alert re-arms each budget period. Defaults to `true` server-side. */
  recurring?: boolean;
}

/** Payload for updating a budget threshold alert (all fields optional). */
export interface UpdateBudgetAlertInput {
  thresholdPercent?: number;
  channel?: BudgetAlertChannel;
  target?: string;
  recurring?: boolean;
  status?: Extract<BudgetAlertStatus, 'ACTIVE' | 'PAUSED'>;
}

/** Filter + pagination parameters for listing budget alerts. */
export interface ListBudgetAlertsParams extends PaginationParams {
  /** Only alerts in this status. */
  status?: BudgetAlertStatus;
  /** Only alerts on this channel. */
  channel?: BudgetAlertChannel;
}

/** Alias for {@link BudgetAlert}. */
export type BudgetThresholdAlert = BudgetAlert;

/** Alias for {@link CreateBudgetAlertInput}. */
export type CreateBudgetThresholdAlertInput = CreateBudgetAlertInput;

/** Alias for {@link UpdateBudgetAlertInput}. */
export type UpdateBudgetThresholdAlertInput = UpdateBudgetAlertInput;

/** Alias for {@link ListBudgetAlertsParams}. */
export type ListBudgetThresholdAlertsParams = ListBudgetAlertsParams;

/* -------------------------------------------------------------------------- */
/* Budget history queries                                                      */
/* -------------------------------------------------------------------------- */

/** Filter + pagination parameters for a budget's consumption history. */
export interface BudgetHistoryQueryParams extends PaginationParams {
  /** Only entries created at or after this instant (ISO-8601). */
  from?: IsoDateTime;
  /** Only entries created at or before this instant (ISO-8601). */
  to?: IsoDateTime;
  /** Only entries linked to this transaction. */
  transactionId?: string;
  /** Only entries whose `amount` is at least this value. */
  minAmount?: DecimalString | number;
  /** Only entries whose `amount` is at most this value. */
  maxAmount?: DecimalString | number;
}

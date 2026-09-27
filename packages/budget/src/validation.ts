/**
 * Local budget-limit validation helper.
 *
 * Checks whether a prospective spend request violates the rules or would
 * exceed the maximum remaining allowance of a given budget — without any
 * network or database round-trip, so it works identically in Node and
 * browser runtimes.
 *
 * @module
 */

import type {
  Budget,
  BudgetHistoryEntry,
  BudgetPeriod,
  DecimalString,
  IsoDateTime,
} from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** A spend request to validate against a budget. */
export interface SpendRequest {
  /** Asset identifier (e.g. `"XLM"`, `"USDC"`, `"USDC:G...Issuer"`). */
  asset: string;
  /** Amount to spend (decimal string or number). */
  amount: DecimalString | number;
}

/** The outcome of a budget-limit validation check. */
export interface BudgetValidationResult {
  /** Whether the spend request is allowed by this budget. */
  allowed: boolean;
  /** Remaining headroom (budget limit minus already-spent), as a decimal string. */
  remaining: DecimalString;
  /** Whether the budget rule was actually violated (i.e. would exceed the limit). */
  violated: boolean;
  /**
   * When `violated` is true, a human-readable description of which
   * restriction was breached.  `null` otherwise.
   */
  restriction: string | null;
  /** How much of the budget is consumed so far in the active window, as a decimal string. */
  spent: DecimalString;
  /** The active window start (ISO-8601 UTC). */
  windowStart: IsoDateTime;
  /** The active window end (ISO-8601 UTC). */
  windowEnd: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Decimal-string addition.  Both operands are non-negative finite decimals.
 * Scales both to the longer fractional length using integer arithmetic.
 */
function decAdd(a: DecimalString | number, b: DecimalString | number): DecimalString {
  const sa = String(a);
  const sb = String(b);

  const [intA, fracA = ''] = sa.split('.');
  const [intB, fracB = ''] = sb.split('.');
  const scaleA = fracA.length;
  const scaleB = fracB.length;
  const maxScale = Math.max(scaleA, scaleB);

  const aScaled = BigInt(intA + fracA.padEnd(scaleA, '0') + '0'.repeat(maxScale - scaleA));
  const bScaled = BigInt(intB + fracB.padEnd(scaleB, '0') + '0'.repeat(maxScale - scaleB));
  const result = (aScaled + bScaled).toString();

  if (maxScale === 0) return result;

  const padded = result.padStart(maxScale + 1, '0');
  const intPart = padded.slice(0, padded.length - maxScale) || '0';
  const fracPart = padded.slice(padded.length - maxScale);
  return `${intPart}.${fracPart.replace(/0+$/, '')}`;
}

/**
 * Decimal-string subtraction (`a - b`).  Returns `"0"` if `b > a`.
 * Both operands are non-negative finite decimals.
 */
function decSub(a: DecimalString | number, b: DecimalString | number): DecimalString {
  const sa = String(a);
  const sb = String(b);

  const [intA, fracA = ''] = sa.split('.');
  const [intB, fracB = ''] = sb.split('.');
  const scaleA = fracA.length;
  const scaleB = fracB.length;
  const maxScale = Math.max(scaleA, scaleB);

  const aScaled = BigInt(intA + fracA.padEnd(scaleA, '0') + '0'.repeat(maxScale - scaleA));
  const bScaled = BigInt(intB + fracB.padEnd(scaleB, '0') + '0'.repeat(maxScale - scaleB));

  const diff = aScaled - bScaled;
  if (diff <= 0n) return '0';

  const result = diff.toString();
  if (maxScale === 0) return result;

  const padded = result.padStart(maxScale + 1, '0');
  const intPart = padded.slice(0, padded.length - maxScale) || '0';
  const fracPart = padded.slice(padded.length - maxScale);
  return `${intPart}.${fracPart.replace(/0+$/, '')}`;
}

/** Compare two decimal strings.  Returns -1, 0, or 1. */
function decCmp(a: DecimalString | number, b: DecimalString | number): -1 | 0 | 1 {
  const sa = String(a);
  const sb = String(b);

  const [intA, fracA = ''] = sa.split('.');
  const [intB, fracB = ''] = sb.split('.');
  const scaleA = fracA.length;
  const scaleB = fracB.length;
  const maxScale = Math.max(scaleA, scaleB);

  const aScaled = BigInt(intA + fracA.padEnd(scaleA, '0') + '0'.repeat(maxScale - scaleA));
  const bScaled = BigInt(intB + fracB.padEnd(scaleB, '0') + '0'.repeat(maxScale - scaleB));

  if (aScaled < bScaled) return -1;
  if (aScaled > bScaled) return 1;
  return 0;
}

/** Whether the decimal string representation of `a` is `> 0`. */
function decGtZero(a: DecimalString | number): boolean {
  return decCmp(a, 0) === 1;
}

/**
 * Sum a list of decimal-string amounts.
 * Returns `"0"` when the list is empty.
 */
function decSum(items: DecimalString[]): DecimalString {
  let acc: DecimalString = '0';
  for (const item of items) {
    acc = decAdd(acc, item);
  }
  return acc;
}

/* -------------------------------------------------------------------------- */
/* Window / boundary helpers                                                   */
/* -------------------------------------------------------------------------- */

/** ISO-8601 day boundaries (00:00 UTC) for a given Date. */
function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
}

function addYears(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCFullYear(r.getUTCFullYear() + n);
  return r;
}

/**
 * Determine the start and end of the active budget window based on the
 * budget's period type and its recorded `periodStart`.
 *
 * Boundaries are always normalised to 00:00 UTC for day-level alignment
 * so that cross-midnight scenarios behave correctly.
 */
function getWindow(period: BudgetPeriod, periodStart: IsoDateTime): { start: Date; end: Date } {
  const ps = new Date(periodStart);

  switch (period) {
    case 'ONE_TIME':
      return { start: ps, end: addYears(ps, 100) };

    case 'DAILY': {
      const dayStart = startOfDay(ps);
      return { start: dayStart, end: addDays(dayStart, 1) };
    }

    case 'WEEKLY': {
      const dayStart = startOfDay(ps);
      // Align to Monday (ISO week start)
      const dow = dayStart.getUTCDay(); // 0=Sun 1=Mon … 6=Sat
      const mondayOffset = dow === 0 ? -6 : 1 - dow;
      const monday = addDays(dayStart, mondayOffset);
      return { start: monday, end: addDays(monday, 7) };
    }

    case 'MONTHLY': {
      const monthStart = new Date(Date.UTC(ps.getUTCFullYear(), ps.getUTCMonth(), 1));
      return { start: monthStart, end: addMonths(monthStart, 1) };
    }

    case 'QUARTERLY': {
      const q = Math.floor(ps.getUTCMonth() / 3);
      const quarterStart = new Date(Date.UTC(ps.getUTCFullYear(), q * 3, 1));
      return { start: quarterStart, end: addMonths(quarterStart, 3) };
    }

    case 'YEARLY': {
      const yearStart = new Date(Date.UTC(ps.getUTCFullYear(), 0, 1));
      return { start: yearStart, end: addYears(yearStart, 1) };
    }

    default: {
      const _exhaustive: never = period;
      throw new Error(`Unhandled budget period: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Normalise a `SpendRequest.amount` to a `DecimalString`, stripping
 * trailing fractional zeros.
 */
function normaliseAmount(amount: DecimalString | number): DecimalString {
  if (typeof amount === 'number') {
    return String(amount);
  }
  return amount;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Check whether a prospective spend request is within the limits of a
 * budget, using only local arithmetic — no network or database calls.
 *
 * ### How it works
 *
 * 1. The budget's **active window** is derived from `budget.period` and
 *    `budget.periodStart` (normalised to 00:00 UTC for day-level periods).
 * 2. Only `BudgetHistoryEntry` entries whose `createdAt` falls within the
 *    active window are counted.
 * 3. The request's asset must match `budget.currency` — otherwise the
 *    budget simply does not apply and `allowed` is `true` (no restriction
 *    violated).
 * 4. Amount arithmetic uses **string-based / BigInt integer arithmetic**
 *    to avoid floating-point precision hazards.
 *
 * @param budget           The budget definition to validate against.
 * @param spentHistory     Historical consumption entries for the current window.
 * @param request          The prospective spend request.
 * @returns                A {@link BudgetValidationResult} describing whether
 *                         the request is allowed and why.
 */
export function checkBudgetLimit(
  budget: Budget,
  spentHistory: BudgetHistoryEntry[],
  request: SpendRequest,
): BudgetValidationResult {
  const requestAmount = normaliseAmount(request.amount);

  // 1. Compute the active window
  const { start: windowStart, end: windowEnd } = getWindow(budget.period, budget.periodStart);

  // 2. Filter history to entries within the active window
  const activeEntries = spentHistory.filter((entry) => {
    const t = new Date(entry.createdAt).getTime();
    return t >= windowStart.getTime() && t < windowEnd.getTime();
  });

  // 3. Sum the spent amount within the window (decimal strings)
  const totalSpent = decSum(activeEntries.map((e) => e.amount));

  // 4. Calculate remaining headroom
  const remaining = decSub(budget.limitAmount, totalSpent);

  // 5. Check if the request would exceed the budget
  const wouldExceed = decGtZero(requestAmount) && decCmp(requestAmount, remaining) === 1;

  // 6. Asset mismatch: budget doesn't apply to this asset
  const assetMismatch = request.asset.trim().toUpperCase() !== budget.currency.trim().toUpperCase();

  if (!budget.enabled || assetMismatch) {
    return {
      allowed: true,
      remaining,
      violated: false,
      restriction: null,
      spent: totalSpent,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    };
  }

  if (wouldExceed) {
    return {
      allowed: false,
      remaining,
      violated: true,
      restriction: `Spend of ${requestAmount} ${budget.currency} would exceed the ${budget.period.toLowerCase()} budget limit of ${budget.limitAmount} (remaining: ${remaining}).`,
      spent: totalSpent,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    };
  }

  return {
    allowed: true,
    remaining,
    violated: false,
    restriction: null,
    spent: totalSpent,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  };
}

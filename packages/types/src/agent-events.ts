/**
 * Agent lifecycle event types.
 *
 * Autonomous agents emit lifecycle events — creation, suspension, resumption,
 * and budget exhaustion. This module defines the event names, the shape of
 * their payloads, and the options a caller can pass when subscribing to (or
 * paginating) an agent's event stream.
 *
 * @module
 */

import type { Agent, Budget } from './entities.js';

/** Canonical agent lifecycle event names (dot.case). */
export const AgentLifecycleEvent = {
  CREATED: 'agent.created',
  SUSPENDED: 'agent.suspended',
  RESUMED: 'agent.resumed',
  BUDGET_EXHAUSTED: 'agent.budget_exhausted',
} as const;
export type AgentLifecycleEventName =
  (typeof AgentLifecycleEvent)[keyof typeof AgentLifecycleEvent];

/** A single agent lifecycle event record, as returned by list endpoints. */
export interface AgentLifecycleEventRecord {
  id: string;
  event: AgentLifecycleEventName;
  agentId: string;
  /** Payload data for the event (typed below). */
  data: AgentLifecycleEventPayload;
  createdAt: string;
}

/** Payload carried by an agent lifecycle event (discriminated by `event`). */
export interface AgentLifecycleEventPayload {
  event: AgentLifecycleEventName;
  agent: Agent;
  /** Human-readable reason/cause, when the event has one (e.g. suspension). */
  reason?: string | null;
  /** The budget that triggered the event (only `budget_exhausted`). */
  budget?: Budget | null;
}

/** Options for a subscription to an agent's lifecycle event stream. */
export interface AgentEventSubscriptionOptions {
  /**
   * Error handler invoked when the underlying stream/retry surfaces an error.
   * If omitted, the default behaviour re-throws so callers can handle it with
   * `try/catch`/`unhandledrejection`.
   */
  onError?: (error: Error) => void;
  /** Abort the subscription (cleans up internal polling/listeners). */
  signal?: AbortSignal;
  /**
   * Only deliver events at or after this cursor / ISO-8601 timestamp, when the
   * stream endpoint supports backfill. Pass the `id` or `createdAt` of the last
   * event you already processed to resume where you left off.
   */
  since?: string;
  /** Maximum number of events to ring-buffer when replaying from `since`. */
  replayLimit?: number;
}

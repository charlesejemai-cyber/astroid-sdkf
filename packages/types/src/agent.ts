/**
 * Core types and DTOs for agent resource management.
 *
 * The Astroid API models an **agent** as an autonomous AI financial actor that
 * transacts within an organization under a set of policies and budgets. This
 * module defines the wire shapes used to create, update, inspect and enumerate
 * agents, plus small runtime helpers for narrowing untyped payloads.
 *
 * The canonical persisted entity is {@link AgentEntity} (an alias of the
 * {@link Agent} model in `./entities.ts`); {@link AgentStatus} and
 * {@link AgentRole} are re-exported from `./enums.ts` so agent-related packages
 * can import everything they need from one module.
 *
 * @module
 */

import type { Agent } from './entities.js';
import { AgentRole, AgentStatus } from './enums.js';
import type { IsoDateTime } from './entities.js';
import type { PaginationParams } from './common.js';

export { AgentRole, AgentStatus } from './enums.js';
export type { Agent } from './entities.js';

/* -------------------------------------------------------------------------- */
/* Entity                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A persisted agent exactly as returned by the Astroid API.
 *
 * Alias of {@link Agent} — provided under the `*Entity` naming used across the
 * SDK's resource packages.
 */
export type AgentEntity = Agent;

/**
 * Free-form metadata attached to an agent.
 *
 * The backend stores this as JSONB, so arbitrary keys are permitted; a few
 * conventional keys are typed for convenience.
 */
export interface AgentMetadata {
  /** Human-facing team or department that owns the agent. */
  team?: string;
  /** External system identifier, for reconciliation. */
  externalId?: string;
  /** Free-form tags used for grouping and filtering. */
  tags?: string[];
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/* Create / Update DTOs                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The initial budget allocated to an agent at creation time.
 *
 * `amount` is a decimal string to preserve precision over the wire.
 */
export interface AgentInitialBudget {
  /** Asset the budget is denominated in (e.g. `"USDC"`, `"XLM"`). */
  currency: string;
  /** Budget ceiling as a decimal string (e.g. `"1000.00"`). */
  amount: string;
}

/**
 * Payload for creating a new agent (`POST /v1/agents`).
 *
 * Only `name`, `capabilities` and `initialBudget` are required; every other
 * field is optional and defaulted by the backend.
 */
export interface CreateAgentDto {
  /** Display name for the agent. Required, non-empty. */
  name: string;
  /** Capabilities the agent is permitted to use (e.g. `["trade", "transfer"]`). Required, non-empty. */
  capabilities: string[];
  /** The starting budget for the agent. Required. */
  initialBudget: AgentInitialBudget;
  /** Optional human-readable description. */
  description?: string;
  /** Functional role; defaults to {@link AgentRole.CUSTOM} server-side. */
  role?: AgentRole;
  /** Inference provider (e.g. `"anthropic"`). */
  provider?: string;
  /** Model identifier (e.g. `"claude-sonnet-5"`). */
  model?: string;
  /** Wallet to attach as the agent's primary wallet. */
  primaryWalletId?: string;
  /** Arbitrary metadata to persist alongside the agent. */
  metadata?: AgentMetadata;
}

/**
 * Payload for updating an existing agent (`PATCH /v1/agents/:id`).
 *
 * Every field is optional; omitted fields are left unchanged. `capabilities`,
 * when present, replaces the existing list wholesale.
 */
export interface UpdateAgentDto {
  /** New display name. */
  name?: string;
  /** New description. */
  description?: string;
  /** New functional role. */
  role?: AgentRole;
  /** New inference provider. */
  provider?: string;
  /** New model identifier. */
  model?: string;
  /** Replacement capability list. */
  capabilities?: string[];
  /** Lifecycle status transition (e.g. pause or archive the agent). */
  status?: AgentStatus;
  /** Replacement primary wallet. */
  primaryWalletId?: string | null;
  /** Metadata to merge into the stored metadata object. */
  metadata?: AgentMetadata;
}

/**
 * Alias of {@link CreateAgentDto}, matching the `*Params` naming used by the
 * `@astroid/agent` resource methods.
 */
export type CreateAgentParams = CreateAgentDto;

/**
 * Alias of {@link UpdateAgentDto}, matching the `*Params` naming used by the
 * `@astroid/agent` resource methods.
 */
export type UpdateAgentParams = UpdateAgentDto;

/* -------------------------------------------------------------------------- */
/* List / query params                                                        */
/* -------------------------------------------------------------------------- */

/** Filter and pagination parameters for listing agents (`GET /v1/agents`). */
export interface ListAgentsParams {
  /** 1-based page number. */
  page?: number;
  /** Page size. */
  limit?: number;
  /** Restrict to agents with this status. */
  status?: AgentStatus;
  /** Restrict to agents with this role. */
  role?: AgentRole;
  /** Case-insensitive substring match against the agent name. */
  search?: string;
}

/* -------------------------------------------------------------------------- */
/* Runtime helpers                                                             */
/* -------------------------------------------------------------------------- */

/** Every valid {@link AgentStatus} value, as a readonly tuple. */
export const AGENT_STATUS_VALUES = Object.freeze(
  Object.values(AgentStatus),
) as readonly AgentStatus[];

/** Every valid {@link AgentRole} value, as a readonly tuple. */
export const AGENT_ROLE_VALUES = Object.freeze(Object.values(AgentRole)) as readonly AgentRole[];

/** Runtime type guard: whether `value` is a valid {@link AgentStatus}. */
export function isAgentStatus(value: unknown): value is AgentStatus {
  return typeof value === 'string' && (AGENT_STATUS_VALUES as readonly string[]).includes(value);
}

/** Runtime type guard: whether `value` is a valid {@link AgentRole}. */
export function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === 'string' && (AGENT_ROLE_VALUES as readonly string[]).includes(value);
}

/**
 * Structural type guard for an {@link AgentEntity} deserialized from JSON.
 *
 * Checks the discriminating required fields (`id`, `organizationId`, `name`,
 * `role`, `status`, `capabilities`, timestamps) without asserting the exact
 * shape of `metadata`.
 */
export function isAgentEntity(value: unknown): value is AgentEntity {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'string' &&
    typeof v['organizationId'] === 'string' &&
    typeof v['name'] === 'string' &&
    isAgentRole(v['role']) &&
    isAgentStatus(v['status']) &&
    Array.isArray(v['capabilities']) &&
    v['capabilities'].every((c) => typeof c === 'string') &&
    typeof v['createdAt'] === 'string' &&
    typeof v['updatedAt'] === 'string'
  );
}

/**
 * Parse a JSON string (or already-parsed value) into an {@link AgentEntity}.
 *
 * @throws {TypeError} When the input is not valid JSON or does not match the
 *   {@link AgentEntity} shape.
 */
export function parseAgentEntity(input: string | unknown): AgentEntity {
  const value: unknown = typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
  if (!isAgentEntity(value)) {
    throw new TypeError('Value is not a valid AgentEntity.');
  }
  return value;
}

/**
 * Normalize a loosely-typed create payload into a {@link CreateAgentDto},
 * trimming strings and dropping `undefined` optional fields. Does **not**
 * validate business rules — see `@astroid/agent`'s `validateCreateAgentParams`.
 */
export function normalizeCreateAgentDto(input: CreateAgentDto): CreateAgentDto {
  const dto: CreateAgentDto = {
    name: input.name.trim(),
    capabilities: input.capabilities.map((c) => c.trim()).filter((c) => c.length > 0),
    initialBudget: {
      currency: input.initialBudget.currency.trim(),
      amount: String(input.initialBudget.amount).trim(),
    },
  };
  if (input.description !== undefined) dto.description = input.description.trim();
  if (input.role !== undefined) dto.role = input.role;
  if (input.provider !== undefined) dto.provider = input.provider.trim();
  if (input.model !== undefined) dto.model = input.model.trim();
  if (input.primaryWalletId !== undefined) dto.primaryWalletId = input.primaryWalletId;
  if (input.metadata !== undefined) dto.metadata = input.metadata;
  return dto;
}

/** Type-only marker retained for documentation of the timestamp format. */
export type AgentTimestamp = IsoDateTime;

/* -------------------------------------------------------------------------- */
/* Lifecycle events                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Lifecycle events an autonomous agent can emit.
 *
 * The API exposes these as an event stream; clients subscribe to receive
 * push-style notifications and can page through historical events.
 */
export const AgentLifecycleEventType = {
  CREATED: 'agent.created',
  SUSPENDED: 'agent.suspended',
  RESUMED: 'agent.resumed',
  BUDGET_EXHAUSTED: 'agent.budget_exhausted',
} as const;
export type AgentLifecycleEventType =
  (typeof AgentLifecycleEventType)[keyof typeof AgentLifecycleEventType];

/** Every valid {@link AgentLifecycleEventType} value, as a readonly tuple. */
export const AGENT_LIFECYCLE_EVENT_TYPE_VALUES = Object.freeze(
  Object.values(AgentLifecycleEventType),
) as readonly AgentLifecycleEventType[];

/** Structured payload attached to an agent lifecycle event. */
export interface AgentLifecycleEventPayload {
  /** The agent the event belongs to. */
  agentId: string;
  /** The organization that owns the agent. */
  organizationId: string;
  /** ISO-8601 instant the event occurred. */
  occurredAt: IsoDateTime;
  /** Free-form details, e.g. the exhausted budget for `agent.budget_exhausted`. */
  details?: Record<string, unknown>;
}

/** A single agent lifecycle event, as returned by the event endpoints. */
export interface AgentLifecycleEvent {
  id: string;
  type: AgentLifecycleEventType;
  agentId: string;
  organizationId: string;
  occurredAt: IsoDateTime;
  payload: AgentLifecycleEventPayload;
}

/** Filter + pagination parameters for listing agent lifecycle events. */
export interface ListAgentEventsParams extends PaginationParams {
  /** Only events of these types. */
  eventTypes?: AgentLifecycleEventType[];
  /** Only events at or after this instant (ISO-8601). */
  from?: IsoDateTime;
  /** Only events at or before this instant (ISO-8601). */
  to?: IsoDateTime;
}

/**
 * Options for creating an agent lifecycle event subscription.
 *
 * All fields are optional; the backend defaults to delivering every lifecycle
 * event type with no history replay.
 */
export interface AgentEventSubscriptionOptions {
  /** Only these event types are delivered. When omitted, all are delivered. */
  eventTypes?: AgentLifecycleEventType[];
  /** Replay events starting from this cursor. */
  cursor?: string;
  /** Whether to include historical events from before the subscription existed. */
  includeHistory?: boolean;
}

/** A subscription to an agent's lifecycle event stream. */
export interface AgentEventSubscription {
  id: string;
  agentId: string;
  organizationId: string;
  eventTypes: AgentLifecycleEventType[];
  includeHistory: boolean;
  status: 'ACTIVE' | 'PAUSED';
  createdAt: IsoDateTime;
}

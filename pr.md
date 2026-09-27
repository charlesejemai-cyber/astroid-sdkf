# feat(policy,transaction,analytics,auth): policy builder, memo-aware payment builder, time-series analytics & API-key sessions

Closes #225
Closes #226
Closes #227
Closes #228

---

## Overview

This PR lands four related agent-safety and agent-runtime capabilities across the
SDK. They share a theme — giving autonomous agents **type-safe, validated
primitives for the money-moving path** — so they are implemented together:

| Package | What changed |
| --- | --- |
| `@astroid/policy` | New fluent `PolicyBuilder` + rule validation utilities |
| `@astroid/transaction` | Payment builder now supports text/hash/return/id memos |
| `@astroid/analytics` + `@astroid/types` | `getTimeSeriesData` + strongly-typed time-series DTOs |
| `@astroid/auth` | `SessionManager` now supports API-key **and** JWT auth modes |

---

## Issue #225 — Policy condition builder & validation utilities (`@astroid/policy`)

New module `packages/policy/src/builder.ts`.

- **`PolicyBuilder`** — a fluent, chainable class for assembling a policy draft:
  - Destinations: `allowDestination(s)` / `denyDestination(s)`
  - Assets: `allowAsset(s)` / `denyAsset(s)` (`XLM`, bare codes, `CODE:ISSUER`)
  - Limits: `maxAmount`, `minAmount`, `dailyLimit`, `weeklyLimit`, `monthlyLimit`
  - Window/scope: `timeWindow`, `forAgent`, `withPriority`, `enabled`, `ofType`
  - `build()` returns the exact `PolicyDraft` payload accepted by
    `PolicyResource.create` and infers the policy `type` from the configured
    conditions (or `COMPOSITE` when several families are combined).
- **Validation during construction** — Stellar address format, asset identifiers,
  positive numeric bounds, and ordered `timeWindow` bounds are checked as the
  rule is built, throwing structured `ValidationError`s.
- **Standalone utilities** — `validatePolicyRule` (non-throwing, returns every
  issue), `assertValidPolicyRule` (throws), and the
  `isValidPolicyAddress` / `isValidPolicyAsset` predicates.
- Exported from `packages/policy/src/index.ts` with full TSDoc + usage example.

**Acceptance criteria**
- [x] Fluent `PolicyBuilder` with rule chaining for destinations, assets, and
      velocity limits.
- [x] Stellar public-key formats and numeric bounds validated at construction.
- [x] Exported from `@astroid/policy` with TSDoc + usage examples.
- [x] Unit tests cover serialization and validation-error throwing.

---

## Issue #226 — Memo-aware payment transaction builder (`@astroid/transaction`)

`packages/transaction/src/builder.ts` previously only supported `memoText`.
`BuildTransactionOptions` now accepts the full memo surface:

- `memoText` (≤28 bytes), `memoHash` / `memoReturn` (32 bytes as 64 hex chars),
  and `memoId` (uint64).
- Memo options are mutually exclusive — supplying more than one fails fast with
  a structured `ValidationError` (`CONFLICTING_MEMO`).
- New validators `isValidMemoHash` / `assertValidMemoHash` in
  `packages/transaction/src/validate.ts`.
- Existing `buildPaymentTransaction` continues to support native XLM and custom
  issued assets, fee configuration, and recipient address validation.

**Acceptance criteria**
- [x] `buildPaymentTransaction` supports native XLM and custom issued assets.
- [x] Memo handling for text, hash, and return (plus id) and fee options.
- [x] Validation for recipient Stellar addresses and memo values.
- [x] Unit tests decode the built envelope and assert memo structure + errors.

---

## Issue #227 — Analytics time-series query helpers (`@astroid/analytics`, `@astroid/types`)

- New DTOs in `packages/types/src/analytics.ts`: `TimeSeriesMetric`,
  `TimeSeriesDataParams`, `TimeSeriesDataPoint`, and `TimeSeriesDataResponse`.
- New `AnalyticsResource.getTimeSeriesData(query)` in
  `packages/analytics/src/index.ts`, hitting `/analytics/time-series` and
  serialising date range, granularity, metric family/ies, and agent/wallet/asset
  scope filters (undefined fields omitted).
- `getAgentMetrics` (already present) plus the new method round out the
  aggregated, strongly-typed metrics API. The new DTOs are re-exported from
  `@astroid/analytics`.

**Acceptance criteria**
- [x] `getAgentMetrics` and `getTimeSeriesData` available in `@astroid/analytics`.
- [x] Query parameters for date ranges, granularity, and metric types.
- [x] Strongly-typed metric DTOs live in `@astroid/types`.
- [x] Unit tests mock API responses for several time-series queries.

---

## Issue #228 — JWT & API-key session handlers (`@astroid/auth`)

`packages/auth/src/session.ts` already managed JWT access/refresh tokens. It now
models the auth strategy explicitly:

- `SessionAuthMode = 'jwt' | 'apiKey'`, inferred from the supplied credentials or
  set via config.
- **API-key mode** stores a long-lived key, persists it through the pluggable
  `TokenStorage`, and injects it via a configurable header (`x-api-key` by
  default) through `getAuthHeaders` / `applyAuthHeaders`.
- **JWT mode** keeps automatic expiration detection and queued refresh; the
  middleware continues to refresh before requests and clear credentials on 401.
- Clear error handling: `assertAuthenticated` throws structured
  `AuthenticationError`s (`UNAUTHENTICATED` / `TOKEN_EXPIRED`), and
  `refreshSession` rejects in API-key mode (`API_KEY_MODE`) since keys don't
  rotate.
- `createSessionMiddleware` and `wireSessionToHttpClient` are mode-aware.

**Acceptance criteria**
- [x] Session manager supports API-key and JWT modes.
- [x] Token expiration detection and automatic refresh (JWT).
- [x] Clear errors for unauthenticated / expired sessions.
- [x] Unit tests verify header injection and session state transitions.

---

## Files changed

**Added**
- `packages/policy/src/builder.ts`
- `packages/policy/__tests__/builder.test.ts`
- `packages/analytics/__tests__/time-series-data.test.ts`
- `packages/auth/__tests__/api-key-session.test.ts`

**Modified**
- `packages/policy/src/index.ts`
- `packages/transaction/src/builder.ts`
- `packages/transaction/src/validate.ts`
- `packages/transaction/__tests__/builder.test.ts`
- `packages/types/src/analytics.ts`
- `packages/analytics/src/index.ts`
- `packages/auth/src/session.ts`

---

## Validation

| package | command | result |
| --- | --- | --- |
| workspace | `pnpm build` | pass |
| workspace | `pnpm typecheck` | 16/16 packages pass |
| workspace | `pnpm lint` | pass |
| workspace | `pnpm test` | all packages pass |
| `@astroid/policy` | `pnpm test` | 4 files / 97 tests pass |
| `@astroid/transaction` | `pnpm test` | 14 files / 160 tests pass |
| `@astroid/analytics` | `pnpm test` | 9 files / 106 tests pass |
| `@astroid/auth` | `pnpm test` | 2 files / 22 tests pass |

---

## Notes / design decisions

- The policy builder stays dependency-free beyond `@astroid/errors`: address and
  asset checks are format validations, with the backend remaining the source of
  truth for full checksum verification.
- Memo options are intentionally mutually exclusive so a transaction can never
  silently carry two memos.
- `getTimeSeriesData` reuses the existing `AnalyticsResource` base so no new
  transport concerns are introduced.
- API-key sessions deliberately do not expose a refresh cycle; treating a key as
  unrefreshable surfaces a single, clear error instead of a confusing 401 loop.

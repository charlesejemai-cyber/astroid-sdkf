/**
 * Transaction simulation and fee-estimation contracts shared by
 * `@astroid/transaction` and API consumers.
 *
 * These types describe the structured result of the two pre-flight helpers the
 * transaction package exposes — {@link TransactionFeeEstimate} for fee bidding
 * and {@link TransactionSimulationOutcome} for execution viability — so callers
 * can reason about a transaction *before* it is broadcast, whether the estimate
 * came from local envelope decoding or a live Horizon / Astroid API round-trip.
 *
 * @module
 */

/**
 * Congestion classification derived from live Horizon fee statistics.
 *
 * - `normal`    — the live fee is at or near the network base fee.
 * - `busy`      — the live fee is more than 2× the base fee.
 * - `congested` — the live fee is extremely high (≥ 5000 stroops).
 * - `unknown`   — no live sample was available (offline / query failed).
 */
export type StellarNetworkState = 'normal' | 'busy' | 'congested' | 'unknown';

/** Machine-readable reason a simulated transaction was deemed non-viable. */
export type TransactionSimulationErrorCode =
  | 'INVALID_ENVELOPE'
  | 'ZERO_OR_NEGATIVE_FEE'
  | 'FEE_BELOW_MINIMUM'
  | 'FEE_TOO_HIGH'
  | 'NO_OPERATIONS'
  | 'VALIDATION_FAILED'
  | 'SIMULATION_FAILED'
  | 'NETWORK_ERROR';

/**
 * A transaction envelope accepted by the estimators: a base64 XDR string or any
 * object that can serialise itself to one (e.g. a built `Transaction`).
 *
 * Kept structural so `@astroid/types` stays free of a `@stellar/stellar-base`
 * dependency.
 */
export type TransactionEnvelopeLike = string | { toXDR(): string };

/* -------------------------------------------------------------------------- */
/* Fee estimation                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Options for the `estimateFee` helper.
 *
 * Supply either a `transaction` envelope (from which the operation count and
 * current fee bid are read) or an explicit `operationCount`. When `horizonUrl`
 * (or a custom `fetch`) is provided the estimator also samples live network fee
 * statistics; otherwise it falls back to the static base fee.
 */
export interface TransactionFeeEstimateOptions {
  /** Unsigned transaction envelope to estimate for. */
  transaction?: TransactionEnvelopeLike;
  /** Explicit operation count, used when no `transaction` is supplied. */
  operationCount?: number;
  /** Per-operation base fee in stroops. Defaults to the network minimum (100). */
  baseFee?: number;
  /** Safety buffer added on top of the live fee, as a percentage. Defaults to 30. */
  bufferPercentage?: number;
  /** Horizon endpoint used to sample live fee stats. */
  horizonUrl?: string;
  /** Network passphrase used to decode an XDR envelope. Defaults to public. */
  networkPassphrase?: string;
  /** Custom fetch implementation (proxies, tests). */
  fetch?: typeof fetch;
}

/**
 * A structured fee estimate: the minimum fee the network will accept, the
 * recommended bid including a safety buffer, and the congestion context.
 */
export interface TransactionFeeEstimate {
  /** Number of operations the fee covers (always ≥ 1). */
  operationCount: number;
  /** Per-operation base fee in stroops (network minimum or supplied value). */
  baseFee: number;
  /** Total minimum fee in stroops (`operationCount × baseFee`). */
  minFee: number;
  /** Recommended per-operation fee in stroops (buffered live fee or base fee). */
  recommendedBaseFee: number;
  /** Recommended total fee in stroops, including the safety buffer. */
  recommendedFee: number;
  /** Applied buffer percentage, e.g. `30` for a +30% bid. */
  bufferPercentage: number;
  /** Network congestion classification. */
  networkState: StellarNetworkState;
  /** Whether a live Horizon fee sample informed this estimate. */
  live: boolean;
  /** Base64 XDR the estimate was computed for, when one was supplied. */
  transactionXdr?: string;
}

/* -------------------------------------------------------------------------- */
/* Simulation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Minimal HTTP client surface needed for remote simulation.
 *
 * Matches the shape of `@astroid/core`'s `HttpClient`, so callers can pass
 * `astroid.http` directly without `@astroid/types` depending on core.
 */
export interface SimulateTransactionClient {
  post<T>(path: string, body?: unknown): Promise<{ data: T }>;
}

/** Options for the `simulateTransaction` helper. */
export interface TransactionSimulationOptions {
  /** Network passphrase used to decode the envelope. Defaults to public. */
  networkPassphrase?: string;
  /** Buffer applied to the estimated fee, as a percentage. Defaults to 15. */
  feeBufferPercentage?: number;
  /** Horizon endpoint used to sample live fee stats. */
  horizonUrl?: string;
  /** Custom fetch implementation (proxies, tests). */
  fetch?: typeof fetch;
  /** Astroid HTTP client used for a remote `/transactions/simulate` dry-run. */
  client?: SimulateTransactionClient;
  /** Skip the remote API call even when a `client` is supplied. */
  skipRemote?: boolean;
}

/** Outcome of an optional remote simulation round-trip. */
export interface TransactionSimulationRemoteResult {
  /** Whether the remote call was attempted. */
  performed: boolean;
  /** Whether the backend reported the transaction as acceptable. */
  success: boolean;
  /** Machine-readable failure reason when `success` is `false`. */
  errorCode?: TransactionSimulationErrorCode;
  /** Human-readable failure reason when `success` is `false`. */
  errorMessage?: string;
  /** Raw backend payload, when it returned one. */
  data?: Record<string, unknown>;
}

/**
 * The structured result of simulating a transaction before broadcast.
 *
 * `viable` is the headline signal: when `false`, `errorCode`/`errorMessage`
 * explain why the transaction would be rejected so the caller can fix it
 * without spending network fees.
 */
export interface TransactionSimulationOutcome {
  /** Whether the transaction is expected to be accepted by the network. */
  viable: boolean;
  /** Whether the envelope passed local protocol validation. */
  valid: boolean;
  /** Number of operations in the envelope. */
  operationCount: number;
  /** Base fee (stroops) decoded from the envelope, or `0` when unknown. */
  baseFee: number;
  /** Recommended total fee (stroops) to bid for the transaction. */
  estimatedFee: number;
  /** Full fee estimate, when one could be computed. */
  feeEstimate?: TransactionFeeEstimate;
  /** Decoded source account, when available. */
  sourceAccount?: string;
  /** Base64 XDR that was simulated. */
  transactionXdr?: string;
  /** Result of the optional remote simulation call. */
  remote?: TransactionSimulationRemoteResult;
  /** Machine-readable failure reason when `viable` is `false`. */
  errorCode?: TransactionSimulationErrorCode;
  /** Human-readable failure reason when `viable` is `false`. */
  errorMessage?: string;
}

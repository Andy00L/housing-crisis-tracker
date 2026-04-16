/**
 * Shared types for the resilience layer.
 *
 * Used by resilient-fetch.ts, circuit-breaker.ts, rate-limit.ts,
 * health-registry.ts, run-report.ts, and every pipeline script that wants
 * to log a fallback use or partial failure.
 */

/**
 * Canonical source names. Kept as a union so circuit breakers,
 * rate limits, and health registry entries stay in lockstep.
 *
 * Add new sources here before using them in resilientFetch.
 */
export type SourceName =
  | "legisinfo"
  | "openparliament"
  | "ourcommons"
  | "bc-laws"
  | "canlii"
  | "statcan"
  | "cmhc"
  | "bank-of-canada"
  | "canada-gazette"
  | "canada-ca"
  | "hud-gov"
  | "tavily"
  | "anthropic"
  | "rss";

/** Why a resilientFetch call failed. Distinct shapes so callers can switch. */
export type FailureReason =
  | { kind: "circuit-open"; source: SourceName; retryAfter: Date }
  | { kind: "timeout"; source: SourceName; timeoutMs: number }
  | { kind: "http-error"; source: SourceName; status: number; body?: string }
  | { kind: "network-error"; source: SourceName; message: string }
  | {
      kind: "schema-mismatch";
      source: SourceName;
      expected: string;
      receivedKeys?: string[];
    }
  | { kind: "rate-limited"; source: SourceName; retryAfter: Date }
  | { kind: "budget-exhausted"; source: SourceName; resetAt?: Date };

/** Outcome of a resilientFetch call. Discriminated by `ok`. */
export type FetchResult<T> =
  | { ok: true; data: T; source: SourceName; fromCache?: boolean }
  | { ok: false; reason: FailureReason };

/** Status of one source in data/raw/_health.json. */
export type HealthStatus = "healthy" | "degraded" | "down";

export type CircuitState = "closed" | "half-open" | "open";

export interface SourceHealth {
  status: HealthStatus;
  last_success: string | null;
  last_failure: string | null;
  circuit_state: CircuitState;
  /** ISO timestamp when the breaker will re-open to half-open. Only set when circuit_state === "open". */
  circuit_reopens_at?: string | null;
  /** Rolling failure rate over the last volumeThreshold requests, 0..1. */
  rolling_failure_rate: number;
  /** Last human-readable note about why the source is degraded or down. */
  note?: string;
}

export interface HealthFile {
  updated_at: string;
  sources: Partial<Record<SourceName, SourceHealth>>;
}

/**
 * Run report for one pipeline execution. Written by pipeline scripts to
 * data/raw/_run-reports/{pipeline}-{timestamp}.json. Summarized into
 * `/api/health` and into GitHub Actions logs.
 */
export type RunReportStatus = "healthy" | "partial" | "degraded" | "failed";

export interface RunReportFailure {
  /** Entity being processed when the failure occurred, or the empty string for non-entity failures. */
  entity: string;
  error: string;
  retryable: boolean;
  /** Human-readable next step, e.g. "retry next run" or "investigate manually". */
  next_action: string;
}

export interface RunReportSourceUsage {
  credits_consumed?: number;
  cache_hits?: number;
  cache_misses?: number;
  calls?: number;
  /** Estimated cost in USD. Approximate; used only for budget-watch. */
  approx_cost_usd?: number;
}

export interface RunReport {
  pipeline: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  status: RunReportStatus;
  entities_total: number;
  entities_successful: number;
  entities_failed: number;
  failures: RunReportFailure[];
  sources_used: Partial<Record<SourceName, RunReportSourceUsage>>;
  sources_degraded: SourceName[];
  sources_fallback_used: SourceName[];
  notes?: string[];
}

/** Options accepted by resilientFetch. */
export interface ResilientFetchOptions<T> {
  /** Override default timeout for this call (ms). */
  timeout?: number;
  /** Runtime validator. If present, the response must pass. */
  validator?: (data: unknown) => data is T;
  /** 4xx status codes that should be retried (e.g. [408]). 429 is always retryable. */
  retryable4xx?: number[];
  /** Override retry attempts (default 3). */
  maxAttempts?: number;
  /** Request init options. Method defaults to GET. */
  init?: RequestInit;
  /** Expected Content-Type prefix (e.g. "application/json"). Defaults to application/json. Pass null to skip the check. */
  expectContentType?: string | null;
}

/**
 * Per-source circuit breakers. One opossum CircuitBreaker per SourceName.
 *
 * A circuit has three states:
 *   closed    normal operation, requests go through
 *   open      too many recent failures, requests reject immediately
 *   half-open after resetTimeout, let one request through; success closes, fail reopens
 *
 * Tuning (applied to every source unless overridden in OVERRIDES):
 *   errorThresholdPercentage: 50   (open when > 50% of recent calls failed)
 *   volumeThreshold: 5             (ignore rate until at least 5 calls in window)
 *   rollingCountTimeout: 10_000    (10s rolling window)
 *   resetTimeout: 3_600_000        (1h before half-open retry)
 *
 * Timeouts vary per source; slower endpoints (CMHC export, Anthropic generation)
 * need more headroom than snappy ones (RSS feeds).
 *
 * Opossum docs reference (v9): https://nodeshift.dev/opossum/
 */

import CircuitBreaker from "opossum";
import type { SourceName } from "./types.js";

/** Default timeout per source in ms. Applied by opossum, not fetch. */
const TIMEOUTS: Record<SourceName, number> = {
  legisinfo: 30_000,
  openparliament: 30_000,
  ourcommons: 30_000,
  "bc-laws": 30_000,
  canlii: 30_000,
  statcan: 30_000,
  cmhc: 45_000,
  "bank-of-canada": 15_000,
  "canada-gazette": 15_000,
  "canada-ca": 15_000,
  tavily: 30_000,
  anthropic: 60_000,
  rss: 15_000,
};

/** Override breaker options per source if the default tuning doesn't fit. */
const OVERRIDES: Partial<
  Record<SourceName, Partial<CircuitBreaker.Options>>
> = {
  // Anthropic sometimes sheds load briefly (overloaded_error). Give it a bit
  // more volume headroom before opening.
  anthropic: { volumeThreshold: 8 },
  // Many RSS feeds under one breaker means occasional single-feed outages
  // should not trip everyone. Raise volume threshold to smooth that.
  rss: { volumeThreshold: 10 },
};

type BaseFn = (url: string, init?: RequestInit) => Promise<Response>;

/** The function every breaker wraps. Raw fetch, no retry, no parsing. */
const baseFetch: BaseFn = (url, init) => fetch(url, init);

const breakers = new Map<SourceName, CircuitBreaker<Parameters<BaseFn>, Awaited<ReturnType<BaseFn>>>>();
/** opossum v9 does not expose the options object publicly, so we keep a parallel map keyed by the same source. */
const breakerResetTimeouts = new Map<SourceName, number>();

/** Event listeners hooked once per breaker. Populated externally so health-registry does not import this file and create a cycle. */
type LifecycleListener = (source: SourceName, state: "open" | "half-open" | "close") => void;
const lifecycleListeners: LifecycleListener[] = [];

export function onCircuitLifecycle(fn: LifecycleListener): void {
  lifecycleListeners.push(fn);
}

function fireListeners(source: SourceName, state: "open" | "half-open" | "close"): void {
  for (const fn of lifecycleListeners) {
    try {
      fn(source, state);
    } catch (err) {
      // Listener errors must not sink the breaker; log and continue.
      console.error(`[circuit-breaker] listener failed for ${source}:`, err);
    }
  }
}

/** Get-or-create the breaker for a source. */
export function getBreaker(
  source: SourceName,
): CircuitBreaker<Parameters<BaseFn>, Awaited<ReturnType<BaseFn>>> {
  let b = breakers.get(source);
  if (b) return b;

  const timeout = TIMEOUTS[source] ?? 30_000;
  const override = OVERRIDES[source] ?? {};
  const options: CircuitBreaker.Options = {
    timeout,
    errorThresholdPercentage: 50,
    volumeThreshold: 5,
    rollingCountTimeout: 10_000,
    rollingCountBuckets: 10,
    resetTimeout: 3_600_000,
    // Every source gets its own group; otherwise opossum shares stats across
    // CircuitBreakers with the same name. Groups come from SourceName, which
    // is unique per upstream, so this is a safe partition.
    group: source,
    name: source,
    ...override,
  };

  b = new CircuitBreaker(baseFetch, options);
  b.on("open", () => fireListeners(source, "open"));
  b.on("halfOpen", () => fireListeners(source, "half-open"));
  b.on("close", () => fireListeners(source, "close"));

  breakers.set(source, b);
  breakerResetTimeouts.set(source, options.resetTimeout ?? 3_600_000);
  return b;
}

export function isBreakerOpen(source: SourceName): boolean {
  const b = breakers.get(source);
  if (!b) return false;
  return b.opened;
}

/**
 * When the breaker will transition to half-open. Returns null if the circuit
 * is not open or the breaker has never been created. opossum does not expose
 * the reset time directly, so we compute it from the last-open timestamp.
 */
const openedAt = new Map<SourceName, number>();

// Track when each breaker went open.
onCircuitLifecycle((source, state) => {
  if (state === "open") openedAt.set(source, Date.now());
  if (state === "close") openedAt.delete(source);
});

export function getBreakerResetAt(source: SourceName): Date | null {
  const b = breakers.get(source);
  if (!b || !b.opened) return null;
  const start = openedAt.get(source);
  if (!start) return null;
  const reset = breakerResetTimeouts.get(source) ?? 3_600_000;
  return new Date(start + reset);
}

export function getBreakerTimeout(source: SourceName): number {
  return TIMEOUTS[source] ?? 30_000;
}

/** Test-only. Drops every breaker so tests start clean. */
export function __resetBreakersForTests(): void {
  for (const b of breakers.values()) {
    b.shutdown();
  }
  breakers.clear();
  breakerResetTimeouts.clear();
  openedAt.clear();
}

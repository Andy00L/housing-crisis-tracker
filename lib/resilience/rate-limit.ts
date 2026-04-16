/**
 * Per-source token bucket. Simple, in-process rate limiter.
 *
 * A token bucket refills at a steady rate and holds up to `capacity` tokens.
 * Each request consumes one token. If no tokens are available, the caller
 * waits until one is. Ensures we respect polite limits on upstream APIs
 * without needing a distributed coordinator (every pipeline script is a
 * single Node process).
 *
 * Intentionally not a dependency. `p-limit` and `bottleneck` would both work
 * but add weight for behavior that fits in 40 lines.
 */

import type { SourceName } from "./types.js";

interface Bucket {
  capacity: number;
  /** Tokens refilled per second. capacity === ratePerSec for the simplest case. */
  ratePerSec: number;
  tokens: number;
  lastRefillMs: number;
}

/**
 * Per-source limits, requests per second. Keep these conservative to stay
 * polite with the upstream (OpenParliament is one maintainer; LEGISinfo is
 * public infra; BC Laws is a search endpoint).
 *
 * Any call from resilientFetch for a source not listed here falls back to
 * DEFAULT_LIMIT (4 req/s) to avoid silently allowing unlimited traffic.
 */
const RATE_LIMITS: Partial<Record<SourceName, number>> = {
  legisinfo: 4,
  openparliament: 2,
  ourcommons: 4,
  "bc-laws": 2,
  canlii: 2,
  statcan: 4,
  cmhc: 2,
  "bank-of-canada": 4,
  "canada-gazette": 4,
  "canada-ca": 2,
  "hud-gov": 2,
  tavily: 3,
  anthropic: 2,
  rss: 4,
  "congress-gov": 4,
  apify: 2,
  legiscan: 2,
};

const DEFAULT_LIMIT = 4;

const buckets = new Map<SourceName, Bucket>();

function getBucket(source: SourceName): Bucket {
  let b = buckets.get(source);
  if (b) return b;
  const rate = RATE_LIMITS[source] ?? DEFAULT_LIMIT;
  b = {
    capacity: rate,
    ratePerSec: rate,
    tokens: rate,
    lastRefillMs: Date.now(),
  };
  buckets.set(source, b);
  return b;
}

function refill(b: Bucket): void {
  const now = Date.now();
  const elapsedSec = (now - b.lastRefillMs) / 1000;
  if (elapsedSec <= 0) return;
  const add = elapsedSec * b.ratePerSec;
  b.tokens = Math.min(b.capacity, b.tokens + add);
  b.lastRefillMs = now;
}

/**
 * Acquire one token for the given source. Waits up to `maxWaitMs` for a
 * token to become available. Throws if the wait is exceeded (indicating
 * the source is severely rate-limited or a deadlock).
 */
export async function acquire(
  source: SourceName,
  maxWaitMs = 10_000,
): Promise<void> {
  const b = getBucket(source);
  const deadline = Date.now() + maxWaitMs;

  while (true) {
    refill(b);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `rate-limit: timeout waiting for ${source} token (cap ${b.capacity}/s, waited ${maxWaitMs}ms)`,
      );
    }
    // Wait roughly one token's worth of time. If ratePerSec=4, wait 250ms.
    const waitMs = Math.max(10, Math.ceil(1000 / b.ratePerSec));
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

/**
 * Test-only helper. Resets every bucket so tests can start from a clean
 * slate. Not exported from the public barrel.
 */
export function __resetBucketsForTests(): void {
  buckets.clear();
}

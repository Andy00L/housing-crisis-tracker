/**
 * Cached, budget-aware, rate-limited Tavily client.
 *
 * Every Tavily pipeline script imports searchTavily / extractTavily from here.
 * Never imports @tavily/core directly (so the resilience wrapper is never
 * bypassed).
 *
 * Layers applied:
 *   1. Cache lookup (data/raw/tavily/{hash}.json)
 *   2. Budget check (ensureBudget, throws TavilyBudgetExhausted at 950 credits)
 *   3. Rate limit (3 req/s for "tavily")
 *   4. Retry with exponential backoff (3 attempts, 1s/2s/4s + jitter)
 *   5. Health registry updates on every outcome
 *   6. Cache write on success
 *
 * On cache miss + circuit-down + no stale cache: throws TavilyUnavailable.
 * On budget exhausted: throws TavilyBudgetExhausted. Callers should catch
 * both and fall back to skip-this-pipeline behaviour.
 *
 * API key: process.env.TAVILY_API_KEY. Loaded by scripts/env.ts before any
 * pipeline script runs. Never logged. Never sent to the browser.
 */

import { tavily } from "@tavily/core";
import { acquire } from "./resilience/rate-limit.js";
import {
  recordFailure,
  recordSuccess,
} from "./resilience/health-registry.js";
import type { FailureReason } from "./resilience/types.js";
import {
  readCache,
  toExtractCacheKey,
  toSearchCacheKey,
  writeCache,
  type CacheKey,
} from "./tavily-cache.js";
import {
  ensureBudget,
  estimateExtractCost,
  estimateSearchCost,
  recordUsage,
} from "./tavily-budget.js";
import {
  TavilyBudgetExhausted,
  type TavilyExtractOptions,
  type TavilyExtractResponse,
  type TavilySearchOptions,
  type TavilySearchResponse,
} from "./tavily-types.js";

export class TavilyUnavailable extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "TavilyUnavailable";
    this.cause = cause;
  }
}

interface Client {
  search: (query: string, opts?: TavilySearchOptions) => Promise<TavilySearchResponse>;
  extract: (urls: string[], opts?: TavilyExtractOptions) => Promise<TavilyExtractResponse>;
}

let _client: Client | null = null;

function getClient(): Client {
  if (_client) return _client;
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new TavilyUnavailable(
      "TAVILY_API_KEY is not set. Add it to .env.local or the CI secrets.",
    );
  }
  // Construct with explicit apiKey (SDK also reads process.env.TAVILY_API_KEY,
  // but we want the check above to run first so missing config fails fast).
  _client = tavily({ apiKey }) as Client;
  return _client;
}

// ─── Retry loop ────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;

function backoffMs(attempt: number): number {
  const base = 1000 * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 200);
  return base + jitter;
}

function classifyError(err: unknown): FailureReason {
  const e = err as { status?: number; message?: string; response?: { status?: number } };
  const status = e?.status ?? e?.response?.status;
  const msg = e?.message ?? String(err);

  if (typeof status === "number") {
    if (status === 429) {
      return {
        kind: "rate-limited",
        source: "tavily",
        retryAfter: new Date(Date.now() + 5000),
      };
    }
    if (status >= 500 && status < 600) {
      return { kind: "http-error", source: "tavily", status, body: msg.slice(0, 200) };
    }
    return { kind: "http-error", source: "tavily", status, body: msg.slice(0, 200) };
  }
  if (/timeout|timed out/i.test(msg)) {
    return { kind: "timeout", source: "tavily", timeoutMs: 30_000 };
  }
  return { kind: "network-error", source: "tavily", message: msg.slice(0, 300) };
}

function isRetryable(reason: FailureReason): boolean {
  if (reason.kind === "network-error" || reason.kind === "timeout") return true;
  if (reason.kind === "rate-limited") return true;
  if (reason.kind === "http-error") return reason.status >= 500 || reason.status === 429;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Search ────────────────────────────────────────────────────────

export async function searchTavily(
  query: string,
  options: TavilySearchOptions = {},
): Promise<TavilySearchResponse> {
  if (!query || query.trim().length === 0) {
    throw new Error("searchTavily: query is required");
  }

  const key = toSearchCacheKey(query, options);
  const cached = readCache<TavilySearchResponse>(key);
  if (cached?.fresh) {
    return cached.envelope.response;
  }

  const expectedCost = estimateSearchCost(options.searchDepth);
  ensureBudget(expectedCost);

  return await attempt<TavilySearchResponse>(
    async () => {
      const client = getClient();
      await acquire("tavily");
      return client.search(query, options);
    },
    key,
    cached,
    "search",
    expectedCost,
  );
}

// ─── Extract ───────────────────────────────────────────────────────

export async function extractTavily(
  urls: string[],
  options: TavilyExtractOptions = {},
): Promise<TavilyExtractResponse> {
  if (!urls || urls.length === 0) {
    throw new Error("extractTavily: at least one URL is required");
  }

  const key = toExtractCacheKey(urls, options);
  const cached = readCache<TavilyExtractResponse>(key);
  if (cached?.fresh) {
    return cached.envelope.response;
  }

  const expectedCost = estimateExtractCost(urls.length, options.extractDepth);
  ensureBudget(expectedCost);

  return await attempt<TavilyExtractResponse>(
    async () => {
      const client = getClient();
      await acquire("tavily");
      return client.extract(urls, options);
    },
    key,
    cached,
    "extract",
    expectedCost,
  );
}

// ─── Shared attempt loop ───────────────────────────────────────────

async function attempt<T extends { usage?: { credits?: number } }>(
  call: () => Promise<T>,
  key: CacheKey,
  staleCache: { envelope: { response: T } } | null,
  kind: "search" | "extract",
  expectedCost: number,
): Promise<T> {
  let lastReason: FailureReason | null = null;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      const resp = await call();
      recordSuccess("tavily");
      const actualCost = resp?.usage?.credits ?? expectedCost;
      recordUsage(actualCost, kind);
      writeCache(key, resp);
      return resp;
    } catch (err) {
      // Budget errors are never retried; they would just re-throw.
      if (err instanceof TavilyBudgetExhausted) throw err;

      const reason = classifyError(err);
      recordFailure("tavily", reason);
      lastReason = reason;

      if (!isRetryable(reason) || i === MAX_ATTEMPTS - 1) break;
      await sleep(backoffMs(i));
    }
  }

  // Every attempt failed. If we have a stale cache, return that with a note.
  if (staleCache) {
    console.warn(
      `[tavily] live call failed (${lastReason?.kind}), returning stale cache`,
    );
    return staleCache.envelope.response;
  }

  throw new TavilyUnavailable(
    `Tavily ${kind} failed after ${MAX_ATTEMPTS} attempts: ${lastReason?.kind ?? "unknown"}`,
    lastReason,
  );
}

// ─── Re-exports for convenience ────────────────────────────────────

export {
  TavilyBudgetExhausted,
  type TavilySearchOptions,
  type TavilySearchResponse,
  type TavilyExtractOptions,
  type TavilyExtractResponse,
} from "./tavily-types.js";

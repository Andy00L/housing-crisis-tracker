/**
 * Tavily-related types. Where possible we re-export the SDK types so the
 * rest of the codebase has one source of truth. We add:
 *   - TavilyCacheEnvelope   wrapper around cached responses
 *   - TavilyMonthUsage      per-month counter schema on disk
 *   - TavilyBudgetExhausted thrown when the hard cap is crossed
 *
 * The SDK uses camelCase option keys (searchDepth, maxResults, etc.) which
 * it translates to snake_case over the wire. We keep camelCase at the
 * boundary so callers see what the SDK docs show.
 *
 * SDK reference: node_modules/@tavily/core/dist/index.d.ts (v0.7.2)
 */

export type {
  TavilyClient,
  TavilyClientOptions,
  TavilySearchOptions,
  TavilySearchResponse,
  TavilyExtractOptions,
  TavilyExtractResponse,
} from "@tavily/core";

/**
 * Per-result type. The SDK declares this internally but does not export it
 * from its public surface, so we mirror the shape here. Matches
 * node_modules/@tavily/core/dist/index.d.ts:75 as of v0.7.2.
 */
export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  rawContent?: string;
  score: number;
  publishedDate: string;
  favicon?: string;
}

/** File envelope for cached responses in data/raw/tavily/. */
export interface TavilyCacheEnvelope<T> {
  cached_at: string;
  expires_at: string;
  /** Parameters that produced this cache key. Debug only; never contains the API key. */
  request: Record<string, unknown>;
  response: T;
}

/** Per-month usage counter in data/raw/tavily/_usage.json. */
export interface TavilyMonthUsage {
  credits: number;
  searches: number;
  extracts: number;
}

export type TavilyUsageFile = Record<string, TavilyMonthUsage>;

/**
 * Thrown when a Tavily call would push us past the hard monthly cap.
 * Pipeline scripts must catch this and degrade gracefully (cache-only,
 * skip pipeline, etc.) rather than propagating to the workflow runner.
 */
export class TavilyBudgetExhausted extends Error {
  readonly used: number;
  readonly cap: number;
  readonly resetAt: Date;
  constructor(used: number, cap: number, resetAt: Date) {
    super(
      `Tavily monthly budget exhausted: ${used}/${cap} credits used. Resets ${resetAt.toISOString().slice(0, 10)}.`,
    );
    this.name = "TavilyBudgetExhausted";
    this.used = used;
    this.cap = cap;
    this.resetAt = resetAt;
  }
}

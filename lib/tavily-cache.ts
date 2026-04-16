/**
 * File-based cache for Tavily API responses.
 *
 * Key: sha256 of a canonical request payload (keys sorted, arrays sorted).
 * Path: data/raw/tavily/{hash}.json
 * Envelope: {cached_at, expires_at, request, response}
 *
 * TTL:
 *   topic === "news"              24h
 *   everything else (research)    7 days
 *   extract                       7 days (URL content rarely changes that fast)
 *
 * Design goal: a second pipeline run with the same queries consumes zero
 * Tavily credits. Makes re-runs safe and makes development (iterating on
 * prompts) cheap.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  TavilyCacheEnvelope,
  TavilyExtractOptions,
  TavilySearchOptions,
} from "./tavily-types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CACHE_DIR = join(ROOT, "data/raw/tavily");

const TTL_NEWS_MS = 24 * 60 * 60 * 1000;
const TTL_RESEARCH_MS = 7 * 24 * 60 * 60 * 1000;

/** Canonical JSON for hashing. Keys sorted so {a, b} and {b, a} collide. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    // Arrays of strings are sorted so include_domains order does not matter.
    // Anything else stays in order.
    if (value.every((v) => typeof v === "string")) {
      return `[${[...value].sort().map((v) => JSON.stringify(v)).join(",")}]`;
    }
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export interface CacheKey {
  kind: "search" | "extract";
  hash: string;
  path: string;
  ttlMs: number;
  payload: Record<string, unknown>;
}

export function toSearchCacheKey(
  query: string,
  opts: TavilySearchOptions = {},
): CacheKey {
  // Include every option that affects the response. Drop ones that don't.
  const payload: Record<string, unknown> = {
    kind: "search",
    query,
    searchDepth: opts.searchDepth ?? "basic",
    topic: opts.topic ?? "general",
    days: opts.days,
    maxResults: opts.maxResults,
    includeDomains: opts.includeDomains,
    excludeDomains: opts.excludeDomains,
    includeAnswer: opts.includeAnswer ?? false,
    includeRawContent: opts.includeRawContent ?? false,
    country: opts.country,
    timeRange: opts.timeRange,
    startDate: opts.startDate,
    endDate: opts.endDate,
    exactMatch: opts.exactMatch,
  };
  const hash = sha256Hex(canonicalJson(payload));
  const ttlMs = opts.topic === "news" ? TTL_NEWS_MS : TTL_RESEARCH_MS;
  return {
    kind: "search",
    hash,
    path: join(CACHE_DIR, `${hash}.json`),
    ttlMs,
    payload,
  };
}

export function toExtractCacheKey(
  urls: string[],
  opts: TavilyExtractOptions = {},
): CacheKey {
  const payload: Record<string, unknown> = {
    kind: "extract",
    urls: [...urls].sort(),
    extractDepth: opts.extractDepth ?? "basic",
    includeImages: opts.includeImages ?? false,
    format: opts.format,
  };
  const hash = sha256Hex(canonicalJson(payload));
  return {
    kind: "extract",
    hash,
    path: join(CACHE_DIR, `${hash}.json`),
    ttlMs: TTL_RESEARCH_MS,
    payload,
  };
}

function isFresh<T>(envelope: TavilyCacheEnvelope<T>): boolean {
  const expires = new Date(envelope.expires_at).getTime();
  return Number.isFinite(expires) && expires > Date.now();
}

export interface CacheReadResult<T> {
  envelope: TavilyCacheEnvelope<T>;
  fresh: boolean;
}

export function readCache<T>(key: CacheKey): CacheReadResult<T> | null {
  if (!existsSync(key.path)) return null;
  try {
    const raw = readFileSync(key.path, "utf8");
    const envelope = JSON.parse(raw) as TavilyCacheEnvelope<T>;
    return { envelope, fresh: isFresh(envelope) };
  } catch (err) {
    console.warn(
      `[tavily-cache] unreadable ${key.path} (${(err as Error).message})`,
    );
    return null;
  }
}

export function writeCache<T>(key: CacheKey, response: T): void {
  const now = new Date();
  const envelope: TavilyCacheEnvelope<T> = {
    cached_at: now.toISOString(),
    expires_at: new Date(now.getTime() + key.ttlMs).toISOString(),
    request: key.payload,
    response,
  };
  mkdirSync(dirname(key.path), { recursive: true });
  writeFileSync(key.path, JSON.stringify(envelope, null, 2) + "\n");
}

export const CACHE_ROOT = CACHE_DIR;

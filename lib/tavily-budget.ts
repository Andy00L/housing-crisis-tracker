/**
 * Tavily credit budget tracking.
 *
 * State file: data/raw/tavily/_usage.json
 *
 * Plan: Tavily free dev tier, 1000 credits/month (verified 2026-04-16).
 *
 * Call costs per tavily.com/pricing (2026-04):
 *   basic search     1 credit
 *   advanced search  2 credits
 *   fast search      0.5 credits (counted as 1 internally to stay conservative)
 *   extract (basic)  1 credit per URL
 *   extract (adv)    2 credits per URL
 *
 * Response objects expose the exact cost in `response.usage.credits`. Pipeline
 * scripts should call estimateCost() before the call (for budget projection)
 * and recordUsage() after with the exact cost from the response.
 *
 * Our caps (leave room for mistakes):
 *   Soft  900  warn, reduce future query depth
 *   Hard  950  throw TavilyBudgetExhausted, scripts fall back to cache-only
 *
 * The file lives under data/raw/ so it lands in the repo and carries across
 * CI runs. Not sensitive (just counts), useful for week-over-week audits.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TavilyBudgetExhausted,
  type TavilyMonthUsage,
  type TavilyUsageFile,
} from "./tavily-types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const USAGE_PATH = join(ROOT, "data/raw/tavily/_usage.json");

export const SOFT_CAP = 900;
export const HARD_CAP = 950;
export const PLAN_LIMIT = 1000;

export type TavilyCallKind = "search" | "extract";

/** "2026-04" style key. Always UTC to match Tavily's billing window. */
export function currentMonthKey(now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function emptyMonth(): TavilyMonthUsage {
  return { credits: 0, searches: 0, extracts: 0 };
}

function readUsageFile(): TavilyUsageFile {
  if (!existsSync(USAGE_PATH)) return {};
  try {
    const raw = readFileSync(USAGE_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as TavilyUsageFile;
  } catch (err) {
    console.warn(
      `[tavily-budget] unreadable ${USAGE_PATH}, resetting (${(err as Error).message})`,
    );
    return {};
  }
}

function writeUsageFile(usage: TavilyUsageFile): void {
  mkdirSync(dirname(USAGE_PATH), { recursive: true });
  writeFileSync(USAGE_PATH, JSON.stringify(usage, null, 2) + "\n");
}

function nextMonthStart(now: Date): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return new Date(Date.UTC(m === 11 ? y + 1 : y, (m + 1) % 12, 1, 0, 0, 0));
}

export interface UsageSnapshot {
  month: string;
  usage: TavilyMonthUsage;
  softCapHit: boolean;
  hardCapHit: boolean;
  planLimitHit: boolean;
}

/** Read-only snapshot of this month's usage. */
export function getUsage(now: Date = new Date()): UsageSnapshot {
  const month = currentMonthKey(now);
  const file = readUsageFile();
  const usage = file[month] ?? emptyMonth();
  return {
    month,
    usage,
    softCapHit: usage.credits >= SOFT_CAP,
    hardCapHit: usage.credits >= HARD_CAP,
    planLimitHit: usage.credits >= PLAN_LIMIT,
  };
}

/**
 * Estimate the cost of a search call. Tavily does not publish a detailed
 * cost table beyond basic/advanced, so we use a safe upper bound.
 */
export function estimateSearchCost(searchDepth?: string): number {
  if (searchDepth === "advanced") return 2;
  if (searchDepth === "fast" || searchDepth === "ultra-fast") return 1;
  return 1; // basic
}

export function estimateExtractCost(
  urlCount: number,
  extractDepth?: string,
): number {
  const perUrl = extractDepth === "advanced" ? 2 : 1;
  return Math.max(1, urlCount * perUrl);
}

/**
 * Throws TavilyBudgetExhausted if adding expectedCost would cross the hard
 * cap. Warns on soft cap. Call this BEFORE making the API call so we stop
 * early on guaranteed waste.
 */
export function ensureBudget(expectedCost: number, now: Date = new Date()): void {
  if (expectedCost <= 0 || !Number.isFinite(expectedCost)) {
    throw new Error(`tavily-budget: invalid cost ${expectedCost}`);
  }
  const { month, usage } = getUsage(now);
  const projected = usage.credits + expectedCost;

  if (projected > HARD_CAP) {
    throw new TavilyBudgetExhausted(usage.credits, HARD_CAP, nextMonthStart(now));
  }
  if (projected > SOFT_CAP) {
    console.warn(
      `[tavily-budget] soft cap reached: ${projected}/${SOFT_CAP} credits this month (${month}). ` +
        `Reducing future query depth is recommended.`,
    );
  }
}

/**
 * Record an actual cost after a successful API call. The `cost` argument
 * should come from response.usage.credits when available. Falls back to the
 * estimate if the response did not include usage (older SDK responses).
 */
export function recordUsage(
  cost: number,
  kind: TavilyCallKind,
  now: Date = new Date(),
): void {
  if (cost <= 0 || !Number.isFinite(cost)) return;
  const month = currentMonthKey(now);
  const file = readUsageFile();
  const m = file[month] ?? emptyMonth();
  m.credits += cost;
  if (kind === "search") m.searches += 1;
  else m.extracts += 1;
  file[month] = m;
  writeUsageFile(file);
}

/** Test-only. Overwrites the usage file. */
export function __writeUsageForTests(file: TavilyUsageFile): void {
  writeUsageFile(file);
}

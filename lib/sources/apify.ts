/**
 * Apify API v2 client. Supplementary scraping layer for state legislature
 * sites that do not expose JSON APIs.
 *
 * Docs reference: https://docs.apify.com/api/v2 (official).
 * Auth: Authorization: Bearer {APIFY_API_TOKEN}. Token configured at
 *   https://console.apify.com/settings/integrations. Free tier gives $5 of
 *   compute credit per month, which is plenty for a handful of scraper runs.
 *
 * Design notes:
 *   1. runActor() starts an actor, polls until it leaves the transient set
 *      { READY, RUNNING, TIMING-OUT, ABORTING }, then fetches the default
 *      dataset. The timeoutSecs caller option bounds the total wait.
 *   2. Usage tracking lives in data/raw/apify/_usage.json keyed by YYYY-MM.
 *      Soft warning fires at 4.0 CU, hard ApifyBudgetExhausted at 4.5 CU so
 *      we never accidentally overrun the free tier.
 *   3. All HTTP goes through resilientFetch with sourceName "apify" so the
 *      rate limit + circuit breaker + health registry cover this source the
 *      same way they cover LEGISinfo and Congress.gov.
 *
 * Not suitable for callers that need streaming output; we read the whole
 * dataset after the run finishes. If an actor produces > 10k items the
 * caller should paginate getDatasetItems() directly.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resilientFetch } from "../resilient-fetch.js";
import type { FetchResult } from "../resilience/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const USAGE_PATH = join(ROOT, "data/raw/apify/_usage.json");

const API_BASE = "https://api.apify.com/v2";
const DEFAULT_POLL_MS = 5000;
const DEFAULT_TIMEOUT_SECS = 300;
const SOFT_CAP_CU = 4.0;
const HARD_CAP_CU = 4.5;

export type ApifyActorStatus =
  | "READY"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "TIMING-OUT"
  | "TIMED-OUT"
  | "ABORTING"
  | "ABORTED";

const TRANSIENT_STATUSES = new Set<ApifyActorStatus>([
  "READY",
  "RUNNING",
  "TIMING-OUT",
  "ABORTING",
]);

export interface ApifyActorRun {
  id: string;
  status: ApifyActorStatus;
  defaultDatasetId: string;
  buildId: string;
  startedAt: string;
  finishedAt?: string;
  stats: {
    computeUnits: number;
  };
}

export interface RunActorParams {
  /** e.g. "apify/web-scraper" or "apify~web-scraper". Both forms accepted. */
  actorId: string;
  input: Record<string, unknown>;
  /** Total cap on run + poll wait. Default 300s. */
  timeoutSecs?: number;
  /** Memory hint passed to Apify (they pick the closest tier). Default 1024. */
  memoryMbytes?: number;
}

export interface RunActorResult<T = unknown> {
  run: ApifyActorRun;
  results: T[];
  computeUnitsUsed: number;
}

export class ApifyError extends Error {
  readonly kind: "auth" | "fetch" | "timeout" | "actor-failed" | "schema";
  constructor(kind: "auth" | "fetch" | "timeout" | "actor-failed" | "schema", message: string) {
    super(message);
    this.name = "ApifyError";
    this.kind = kind;
  }
}

export class ApifyBudgetExhausted extends Error {
  readonly monthUsed: number;
  readonly cap: number;
  constructor(monthUsed: number, cap: number) {
    super(
      `Apify monthly compute ${monthUsed.toFixed(3)} CU has reached the ${cap.toFixed(2)} CU hard cap. Skipping further runs.`,
    );
    this.name = "ApifyBudgetExhausted";
    this.monthUsed = monthUsed;
    this.cap = cap;
  }
}

function getToken(): string {
  const t = process.env.APIFY_API_TOKEN;
  if (!t || t.trim().length === 0) {
    throw new ApifyError(
      "auth",
      "APIFY_API_TOKEN is not set. Get a token at https://console.apify.com/settings/integrations and add it to .env.local.",
    );
  }
  return t.trim();
}

function normalizeActorId(actorId: string): string {
  // Apify accepts either "username/actor-name" (URL-encoded) or the
  // unambiguous "username~actor-name" form. We prefer the tilde form in the
  // URL path because it sidesteps percent-encoding subtleties.
  return actorId.includes("~") ? actorId : actorId.replace("/", "~");
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

interface UsageFile {
  [month: string]: {
    compute_units: number;
    actor_runs: number;
    last_updated: string;
  };
}

function readUsage(): UsageFile {
  if (!existsSync(USAGE_PATH)) return {};
  try {
    const raw = readFileSync(USAGE_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as UsageFile;
  } catch {
    // Corrupt file: rewrite with a fresh state rather than cascade failures.
    return {};
  }
}

function writeUsage(u: UsageFile): void {
  mkdirSync(dirname(USAGE_PATH), { recursive: true });
  writeFileSync(USAGE_PATH, JSON.stringify(u, null, 2) + "\n");
}

function monthTotal(u: UsageFile): number {
  return u[currentMonthKey()]?.compute_units ?? 0;
}

function checkBudget(): void {
  const usage = readUsage();
  const total = monthTotal(usage);
  if (total >= HARD_CAP_CU) {
    throw new ApifyBudgetExhausted(total, HARD_CAP_CU);
  }
}

function recordRun(computeUnitsUsed: number): void {
  const usage = readUsage();
  const key = currentMonthKey();
  const prev = usage[key] ?? { compute_units: 0, actor_runs: 0, last_updated: "" };
  const next = {
    compute_units: Math.round((prev.compute_units + computeUnitsUsed) * 10000) / 10000,
    actor_runs: prev.actor_runs + 1,
    last_updated: new Date().toISOString(),
  };
  usage[key] = next;
  writeUsage(usage);
  if (next.compute_units >= SOFT_CAP_CU && prev.compute_units < SOFT_CAP_CU) {
    console.warn(
      `[apify] soft budget cap reached: ${next.compute_units.toFixed(3)} CU consumed this month. Hard cap ${HARD_CAP_CU} CU.`,
    );
  }
}

// ── HTTP helpers (all go through resilientFetch) ────────────────────
function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

interface ApifyEnvelope<T> {
  data: T;
}

function isEnvelope<T>(validator: (inner: unknown) => inner is T) {
  return (x: unknown): x is ApifyEnvelope<T> => {
    if (typeof x !== "object" || x === null) return false;
    const inner = (x as { data?: unknown }).data;
    return validator(inner);
  };
}

function isActorRun(x: unknown): x is ApifyActorRun {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Partial<ApifyActorRun>;
  return (
    typeof o.id === "string" &&
    typeof o.status === "string" &&
    typeof o.defaultDatasetId === "string"
  );
}

function isArray(x: unknown): x is unknown[] {
  return Array.isArray(x);
}

function explainFailure(reason: { kind: string; status?: number }): ApifyError {
  const r = reason as { kind: string; status?: number };
  if (r.kind === "http-error" && r.status === 401) {
    return new ApifyError("auth", "Apify rejected the API token (401). Verify APIFY_API_TOKEN.");
  }
  if (r.kind === "http-error" && r.status === 403) {
    return new ApifyError("auth", "Apify returned 403 (forbidden). Check token scopes in the console.");
  }
  if (r.kind === "schema-mismatch") {
    return new ApifyError("schema", `Apify response did not match expected shape: ${JSON.stringify(reason).slice(0, 200)}`);
  }
  return new ApifyError("fetch", `Apify request failed (${r.kind}${r.status ? ` ${r.status}` : ""})`);
}

async function startActor(params: RunActorParams): Promise<ApifyActorRun> {
  const token = getToken();
  const actorSlug = normalizeActorId(params.actorId);
  const url = new URL(`${API_BASE}/acts/${actorSlug}/runs`);
  if (params.timeoutSecs) url.searchParams.set("timeout", String(params.timeoutSecs));
  if (params.memoryMbytes) url.searchParams.set("memory", String(params.memoryMbytes));

  const res: FetchResult<ApifyEnvelope<ApifyActorRun>> = await resilientFetch(
    "apify",
    url.toString(),
    {
      init: {
        method: "POST",
        headers: {
          ...authHeaders(token),
          "content-type": "application/json",
        },
        body: JSON.stringify(params.input ?? {}),
      },
      validator: isEnvelope(isActorRun),
      retryable4xx: [],
    },
  );
  if (!res.ok) throw explainFailure(res.reason);
  return res.data.data;
}

export async function getActorRun(runId: string): Promise<ApifyActorRun> {
  const token = getToken();
  const url = `${API_BASE}/actor-runs/${encodeURIComponent(runId)}`;
  const res: FetchResult<ApifyEnvelope<ApifyActorRun>> = await resilientFetch(
    "apify",
    url,
    {
      init: { headers: authHeaders(token) },
      validator: isEnvelope(isActorRun),
    },
  );
  if (!res.ok) throw explainFailure(res.reason);
  return res.data.data;
}

export async function getDatasetItems<T = unknown>(
  datasetId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<T[]> {
  const token = getToken();
  const url = new URL(`${API_BASE}/datasets/${encodeURIComponent(datasetId)}/items`);
  url.searchParams.set("format", "json");
  url.searchParams.set("clean", "1");
  if (typeof options.limit === "number") url.searchParams.set("limit", String(options.limit));
  if (typeof options.offset === "number") url.searchParams.set("offset", String(options.offset));

  // Datasets return an unwrapped JSON array (no `data` envelope).
  const res: FetchResult<unknown[]> = await resilientFetch(
    "apify",
    url.toString(),
    {
      init: { headers: authHeaders(token) },
      validator: isArray,
    },
  );
  if (!res.ok) throw explainFailure(res.reason);
  return res.data as T[];
}

// ── High-level runActor wrapper ─────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runActor<T = unknown>(
  params: RunActorParams,
): Promise<RunActorResult<T>> {
  checkBudget();

  const timeoutSecs = params.timeoutSecs ?? DEFAULT_TIMEOUT_SECS;
  const deadline = Date.now() + timeoutSecs * 1000;
  let run = await startActor(params);

  // Poll until the actor leaves the transient set or the deadline hits.
  while (TRANSIENT_STATUSES.has(run.status)) {
    if (Date.now() >= deadline) {
      throw new ApifyError(
        "timeout",
        `Apify actor ${params.actorId} did not finish within ${timeoutSecs}s (last status: ${run.status})`,
      );
    }
    await sleep(DEFAULT_POLL_MS);
    try {
      run = await getActorRun(run.id);
    } catch (err) {
      if (err instanceof ApifyError && err.kind === "auth") throw err;
      // Transient poll errors (network hiccups) should not abort the wait.
      console.warn(`[apify] poll warning for ${run.id}: ${(err as Error).message}`);
    }
  }

  const cuUsed = run.stats?.computeUnits ?? 0;
  recordRun(cuUsed);

  if (run.status !== "SUCCEEDED") {
    throw new ApifyError(
      "actor-failed",
      `Apify actor ${params.actorId} finished with status ${run.status} (run ${run.id}, ${cuUsed.toFixed(3)} CU)`,
    );
  }

  let items: T[] = [];
  try {
    items = await getDatasetItems<T>(run.defaultDatasetId);
  } catch (err) {
    // Run succeeded but dataset fetch failed. Surface the failure but preserve
    // the run metadata so the caller can see compute usage was still spent.
    throw new ApifyError(
      "fetch",
      `Apify dataset fetch failed for run ${run.id}: ${(err as Error).message}`,
    );
  }

  return { run, results: items, computeUnitsUsed: cuUsed };
}

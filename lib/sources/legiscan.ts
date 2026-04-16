/**
 * LegiScan API client. Canonical source for US state bills.
 *
 * Docs: https://legiscan.com/gaits/documentation/legiscan
 * Auth: ?key={LEGISCAN_API_KEY} query parameter.
 * Free tier: 30,000 requests/month.
 *
 * LegiScan response quirks to be aware of:
 *   - Every envelope starts with a status field. "OK" means success; "ERROR"
 *     carries an alert.message explaining the failure.
 *   - getSearch returns searchresult as an OBJECT (not an array) whose keys
 *     are the numeric index plus one special "summary" key. We normalize to
 *     a plain LegiScanBill[] for callers.
 *   - getBill returns { status, bill }. The bill's status field is a numeric
 *     code we map to the internal Stage union.
 *
 * Status code legend (from the official PDF docs):
 *   1 Introduced    2 Engrossed    3 Enrolled    4 Passed
 *   5 Vetoed        6 Failed       7 Override    8 Chaptered    9 Refer
 */

import { resilientFetch } from "../resilient-fetch.js";
import type { FetchResult } from "../resilience/types.js";
import type { Stage } from "@/types";

const API_BASE = "https://api.legiscan.com/";

export interface LegiScanSponsor {
  people_id: number;
  name: string;
  party: string;
  role: string;
}

export interface LegiScanBill {
  bill_id: number;
  bill_number: string;
  title: string;
  description: string;
  state: string;
  state_id: number;
  session: {
    session_id: number;
    year_start: number;
    year_end: number;
    session_name: string;
  };
  /** Numeric status code; see legend at top of this file. */
  status: number;
  status_desc: string;
  last_action_date: string;
  last_action: string;
  url: string;
  state_link: string;
  sponsors: LegiScanSponsor[];
}

export interface LegiScanSearchParams {
  query: string;
  /** Two-letter state code (e.g. "CA") or "US" for federal. */
  state?: string;
  year?: number;
  page?: number;
}

export class LegiScanError extends Error {
  readonly kind: "auth" | "api" | "fetch" | "schema";
  constructor(kind: "auth" | "api" | "fetch" | "schema", message: string) {
    super(message);
    this.name = "LegiScanError";
    this.kind = kind;
  }
}

function getApiKey(): string {
  const key = process.env.LEGISCAN_API_KEY?.trim();
  // LegiScan keys are 32 hex characters. Anything shorter is a placeholder
  // (e.g. "tbd", "pending") that the caller probably dropped in before they
  // had the real key. Treat placeholders as missing so we fall through to
  // the dormant path cleanly.
  if (!key || key.length < 16) {
    throw new LegiScanError(
      "auth",
      "LEGISCAN_API_KEY is not set or looks like a placeholder. Apply at https://legiscan.com/legiscan and add the 32-char key to .env.local.",
    );
  }
  return key;
}

function buildUrl(op: string, params: Record<string, string | number>): string {
  const u = new URL(API_BASE);
  u.searchParams.set("key", getApiKey());
  u.searchParams.set("op", op);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

/** Generic LegiScan envelope. */
interface LegiScanEnvelope {
  status: "OK" | "ERROR";
  alert?: { message?: string };
}

function isLegiScanEnvelope(x: unknown): x is LegiScanEnvelope {
  if (typeof x !== "object" || x === null) return false;
  const status = (x as { status?: unknown }).status;
  return status === "OK" || status === "ERROR";
}

function assertStatusOk(env: LegiScanEnvelope, op: string): void {
  if (env.status !== "OK") {
    const msg = env.alert?.message ?? "unknown";
    throw new LegiScanError("api", `LegiScan ${op} returned ERROR: ${msg}`);
  }
}

function explainFailure(
  reason: { kind: string; status?: number },
  op: string,
): LegiScanError {
  const r = reason as { kind: string; status?: number };
  if (r.kind === "http-error" && r.status === 401) {
    return new LegiScanError("auth", `LegiScan ${op} 401: invalid or missing API key`);
  }
  if (r.kind === "http-error" && r.status === 403) {
    return new LegiScanError("auth", `LegiScan ${op} 403: key rejected`);
  }
  if (r.kind === "schema-mismatch") {
    return new LegiScanError("schema", `LegiScan ${op} schema mismatch: ${JSON.stringify(reason).slice(0, 200)}`);
  }
  return new LegiScanError("fetch", `LegiScan ${op} failed (${r.kind}${r.status ? ` ${r.status}` : ""})`);
}

// ── Public: searchLegiScan ──────────────────────────────────────────
interface RawSearchEntry {
  relevance?: number;
  state?: string;
  bill_number?: string;
  bill_id?: number;
  url?: string;
  text_url?: string;
  last_action_date?: string;
  last_action?: string;
  title?: string;
  state_link?: string;
}

interface RawSearchResponse extends LegiScanEnvelope {
  searchresult?: Record<string, unknown>;
}

function isSearchResponse(x: unknown): x is RawSearchResponse {
  if (!isLegiScanEnvelope(x)) return false;
  if ((x as RawSearchResponse).status === "ERROR") return true;
  const sr = (x as RawSearchResponse).searchresult;
  return typeof sr === "object" && sr !== null;
}

function searchEntriesFromResult(
  searchresult: Record<string, unknown>,
): RawSearchEntry[] {
  const entries: RawSearchEntry[] = [];
  for (const [key, value] of Object.entries(searchresult)) {
    if (key === "summary") continue;
    if (typeof value === "object" && value !== null) {
      entries.push(value as RawSearchEntry);
    }
  }
  return entries;
}

/**
 * Convert a search row into a LegiScanBill-shaped object. getSearch returns
 * lean rows (no sponsors, no status code), so the caller must decide
 * whether a follow-up getLegiScanBill is worth the extra request for
 * metadata such as sponsors or numeric status.
 */
function normalizeSearchEntry(
  entry: RawSearchEntry,
  year: number,
): LegiScanBill {
  return {
    bill_id: typeof entry.bill_id === "number" ? entry.bill_id : 0,
    bill_number: entry.bill_number ?? "",
    title: entry.title ?? "",
    description: entry.title ?? "",
    state: entry.state ?? "",
    state_id: 0,
    session: {
      session_id: 0,
      year_start: year,
      year_end: year,
      session_name: `${year} session`,
    },
    status: 0, // unknown at list level
    status_desc: entry.last_action ?? "",
    last_action_date: entry.last_action_date ?? "",
    last_action: entry.last_action ?? "",
    url: entry.url ?? "",
    state_link: entry.state_link ?? entry.text_url ?? entry.url ?? "",
    sponsors: [],
  };
}

/**
 * Search LegiScan for bills matching `query` in the given state+year. Paged
 * output is flattened into a single array. A missing page_total means the
 * API already returned everything in one shot.
 */
export async function searchLegiScan(
  params: LegiScanSearchParams,
): Promise<LegiScanBill[]> {
  const year = params.year ?? new Date().getUTCFullYear();
  const baseParams: Record<string, string | number> = { query: params.query };
  if (params.state) baseParams.state = params.state;
  baseParams.year = year;

  const out: LegiScanBill[] = [];
  let page = params.page ?? 1;
  // LegiScan's page pagination is capped at 50 per API docs.
  const MAX_PAGES = 20;

  while (page <= MAX_PAGES) {
    const url = buildUrl("getSearch", { ...baseParams, page });
    const res: FetchResult<RawSearchResponse> = await resilientFetch<RawSearchResponse>(
      "legiscan",
      url,
      { validator: isSearchResponse },
    );
    if (!res.ok) throw explainFailure(res.reason, "getSearch");
    assertStatusOk(res.data, "getSearch");
    const sr = res.data.searchresult;
    if (!sr) break;

    const entries = searchEntriesFromResult(sr);
    out.push(...entries.map((e) => normalizeSearchEntry(e, year)));

    const summary = sr.summary as { page_total?: number; page_current?: number } | undefined;
    const total = summary?.page_total ?? 1;
    const current = summary?.page_current ?? page;
    if (current >= total) break;
    page += 1;
  }

  return out;
}

// ── Public: getLegiScanBill ─────────────────────────────────────────
interface RawBillResponse extends LegiScanEnvelope {
  bill?: LegiScanBill;
}

function isRawBillResponse(x: unknown): x is RawBillResponse {
  if (!isLegiScanEnvelope(x)) return false;
  if ((x as RawBillResponse).status === "ERROR") return true;
  const b = (x as RawBillResponse).bill;
  return typeof b === "object" && b !== null;
}

export async function getLegiScanBill(billId: number): Promise<LegiScanBill> {
  const url = buildUrl("getBill", { id: billId });
  const res: FetchResult<RawBillResponse> = await resilientFetch<RawBillResponse>(
    "legiscan",
    url,
    { validator: isRawBillResponse },
  );
  if (!res.ok) throw explainFailure(res.reason, "getBill");
  assertStatusOk(res.data, "getBill");
  if (!res.data.bill) {
    throw new LegiScanError("schema", `LegiScan getBill(${billId}) returned no bill field`);
  }
  return res.data.bill;
}

// ── Stage mapping ───────────────────────────────────────────────────
/**
 * Map LegiScan numeric status to the internal Stage union. Returns a
 * second flag (`flag`) for statuses that carry an auxiliary state like
 * "vetoed" or "failed"; downstream can decide whether to display it.
 */
export function legiscanStatusToStage(status: number): {
  stage: Stage;
  flag?: "vetoed" | "failed" | "override";
} {
  switch (status) {
    case 1:
      return { stage: "Filed" };
    case 2:
      return { stage: "Committee" };
    case 3:
      return { stage: "Floor" };
    case 4:
    case 8:
      return { stage: "Enacted" };
    case 5:
      return { stage: "Dead", flag: "vetoed" };
    case 6:
      return { stage: "Dead", flag: "failed" };
    case 7:
      return { stage: "Enacted", flag: "override" };
    case 9:
      return { stage: "Filed" };
    default:
      return { stage: "Filed" };
  }
}

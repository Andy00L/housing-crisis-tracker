/**
 * Congress.gov API v3 client. Primary source for US federal bills.
 *
 * Docs reference: https://api.congress.gov/ (official, Library of Congress).
 * Auth: ?api_key query parameter. Free tier is 5000 requests/hour.
 * Coverage: 93rd Congress (1973) through the current 119th.
 *
 * Key API shape notes (verified against the public schema at /v3/bill):
 *   1. The API does NOT expose server-side keyword search. Filtering by
 *      title/keyword is done client-side after paginating the bill list
 *      (see searchCongressBills below).
 *   2. The `url` field returned by the API points at api.congress.gov, not
 *      the user-facing canonical page. We build the canonical URL from
 *      congress + type + number via canonicalBillUrl().
 *   3. The list endpoint does not include sponsors, policyArea, or subjects.
 *      Callers that need those must follow up with getCongressBill().
 *
 * All network I/O goes through resilientFetch with sourceName "congress-gov"
 * so rate limiting, circuit breaker, health registry updates, and retries
 * happen consistently with the rest of the pipeline.
 */

import { resilientFetch } from "../resilient-fetch.js";
import type { FetchResult } from "../resilience/types.js";

const API_BASE = "https://api.congress.gov/v3";
const WEB_BASE = "https://www.congress.gov";

// Max pages the client will paginate before giving up on a list query. At
// the default limit=250 this caps per-call fetches at 5000 bills, which is
// enough to cover the entire active portion of any Congress while keeping
// one searchCongressBills call under ~20 API hits.
const MAX_PAGES = 20;
// Max page size Congress.gov accepts on /v3/bill. Anything higher is
// silently clamped server-side; we set it explicitly to minimize round trips.
const API_PAGE_LIMIT = 250;

export type CongressBillType =
  | "hr"
  | "s"
  | "hjres"
  | "sjres"
  | "hres"
  | "sres";

// Uppercase variants used in normalized output and external APIs (LegiScan,
// display). Kept separate from the lowercase path form above because the
// API requires lowercase in the URL path but returns uppercase in response
// bodies.
export type CongressBillTypeUpper = "HR" | "S" | "HJRES" | "SJRES" | "HRES" | "SRES";

export interface CongressGovSponsor {
  bioguideId: string;
  fullName: string;
  /** "D", "R", "I", "L", or other single-letter party codes. */
  party: string;
  /** Two-letter state code. */
  state: string;
  district?: number;
}

export interface CongressGovLatestAction {
  /** ISO date (YYYY-MM-DD). */
  actionDate: string;
  text: string;
}

export interface CongressGovBill {
  congress: number;
  type: CongressBillTypeUpper;
  number: number;
  title: string;
  /** ISO date. Falls back to updateDate when the API omits it. */
  introducedDate: string;
  sponsors: CongressGovSponsor[];
  cosponsorsCount?: number;
  latestAction: CongressGovLatestAction;
  /** Canonical user-facing congress.gov URL. NOT the api.congress.gov URL. */
  url: string;
  policyArea?: { name: string };
  subjects?: { count: number };
  /** ISO date. */
  updateDate: string;
}

export interface CongressGovSearchResult {
  bills: CongressGovBill[];
  pagination: {
    count: number;
    next?: string;
  };
}

export interface CongressGovSearchParams {
  /**
   * Free-text query. Filtered client-side against bill title because the
   * public Congress.gov API v3 does not expose a server-side search
   * parameter. Case-insensitive substring match.
   */
  query?: string;
  congress?: number;
  billType?: CongressBillType;
  /** ISO 8601. Passed through as fromDateTime on the underlying API. */
  fromDateTime?: string;
  /** ISO 8601. Passed through as toDateTime on the underlying API. */
  toDateTime?: string;
  sort?: "updateDate+desc" | "updateDate+asc";
  /** Max matches to return (post-filter). Defaults to 20. */
  limit?: number;
  /** Offset applied after filtering. Defaults to 0. */
  offset?: number;
}

/**
 * Raw bill summary as returned by /v3/bill. A subset of the Congress.gov
 * schema - only the fields we consume downstream. Fields we don't touch
 * are intentionally ignored.
 */
interface RawBillSummary {
  congress: number;
  /** Already uppercase in responses ("HR", "S", ...). */
  type: string;
  /** Numeric as string ("3076"). */
  number: string;
  title: string;
  /** Optional; returned by the detail endpoint, sometimes by the list. */
  introducedDate?: string;
  latestAction: {
    actionDate: string;
    text: string;
  };
  updateDate: string;
  /** Sponsors appear on the detail endpoint, occasionally on list responses. */
  sponsors?: Array<{
    bioguideId?: string;
    fullName?: string;
    party?: string;
    state?: string;
    district?: number;
  }>;
  cosponsors?: { count?: number };
  policyArea?: { name?: string };
  subjects?: { count?: number };
}

interface RawBillListResponse {
  bills: RawBillSummary[];
  pagination: {
    count: number;
    next?: string;
  };
}

interface RawBillDetailResponse {
  /**
   * The detail endpoint wraps the bill under `.bill`. Wrapped shape documented
   * at https://api.congress.gov/#/bill/bill_details.
   */
  bill: RawBillSummary;
}

export class CongressGovError extends Error {
  readonly kind: "auth" | "not-found" | "schema" | "fetch";
  constructor(kind: "auth" | "not-found" | "schema" | "fetch", message: string) {
    super(message);
    this.name = "CongressGovError";
    this.kind = kind;
  }
}

function getApiKey(): string {
  const key = process.env.CONGRESS_GOV_API_KEY;
  if (!key || key.trim().length === 0) {
    throw new CongressGovError(
      "auth",
      "CONGRESS_GOV_API_KEY is not set. Register at https://api.congress.gov/sign-up/ and add it to .env.local.",
    );
  }
  return key.trim();
}

/**
 * Build the user-facing canonical URL for a bill. Matches the slug scheme
 * used by congress.gov itself (verified for HR, S, HJRES, SJRES, HRES, SRES
 * at https://www.congress.gov/bill/119th-congress/house-bill/1).
 */
export function canonicalBillUrl(
  congress: number,
  type: CongressBillTypeUpper,
  number: number,
): string {
  const chamberSlug: Record<CongressBillTypeUpper, string> = {
    HR: "house-bill",
    S: "senate-bill",
    HJRES: "house-joint-resolution",
    SJRES: "senate-joint-resolution",
    HRES: "house-resolution",
    SRES: "senate-resolution",
  };
  const ordinal = ordinalSuffix(congress);
  return `${WEB_BASE}/bill/${congress}${ordinal}-congress/${chamberSlug[type]}/${number}`;
}

function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function toUpperBillType(raw: string): CongressBillTypeUpper {
  const up = raw.toUpperCase();
  switch (up) {
    case "HR":
    case "S":
    case "HJRES":
    case "SJRES":
    case "HRES":
    case "SRES":
      return up;
    default:
      // Unknown type. Surfacing this as schema mismatch lets the caller log
      // and skip instead of pretending it's a known chamber.
      throw new CongressGovError("schema", `Unknown bill type from Congress.gov: ${raw}`);
  }
}

function normalizeBill(raw: RawBillSummary): CongressGovBill {
  const type = toUpperBillType(raw.type);
  const number = Number(raw.number);
  if (!Number.isFinite(number)) {
    throw new CongressGovError(
      "schema",
      `Bill number not numeric: ${raw.number} (${raw.type})`,
    );
  }

  const sponsors: CongressGovSponsor[] = Array.isArray(raw.sponsors)
    ? raw.sponsors
        .filter((s) => s.bioguideId && s.fullName)
        .map((s) => ({
          bioguideId: s.bioguideId!,
          fullName: s.fullName!,
          party: (s.party ?? "").trim(),
          state: (s.state ?? "").trim(),
          district: typeof s.district === "number" ? s.district : undefined,
        }))
    : [];

  return {
    congress: raw.congress,
    type,
    number,
    title: raw.title ?? "",
    introducedDate: raw.introducedDate ?? raw.latestAction?.actionDate ?? raw.updateDate,
    sponsors,
    cosponsorsCount:
      typeof raw.cosponsors?.count === "number" ? raw.cosponsors.count : undefined,
    latestAction: {
      actionDate: raw.latestAction?.actionDate ?? "",
      text: raw.latestAction?.text ?? "",
    },
    url: canonicalBillUrl(raw.congress, type, number),
    policyArea:
      raw.policyArea?.name && raw.policyArea.name.length > 0
        ? { name: raw.policyArea.name }
        : undefined,
    subjects:
      typeof raw.subjects?.count === "number" ? { count: raw.subjects.count } : undefined,
    updateDate: raw.updateDate ?? "",
  };
}

function isRawBillListResponse(x: unknown): x is RawBillListResponse {
  if (typeof x !== "object" || x === null) return false;
  const o = x as { bills?: unknown; pagination?: unknown };
  return Array.isArray(o.bills) && typeof o.pagination === "object" && o.pagination !== null;
}

function isRawBillDetailResponse(x: unknown): x is RawBillDetailResponse {
  if (typeof x !== "object" || x === null) return false;
  const o = x as { bill?: unknown };
  return typeof o.bill === "object" && o.bill !== null;
}

function buildListUrl(
  path: string,
  params: {
    limit?: number;
    offset?: number;
    sort?: string;
    fromDateTime?: string;
    toDateTime?: string;
    apiKey: string;
  },
): string {
  const u = new URL(`${API_BASE}/${path}`);
  u.searchParams.set("format", "json");
  u.searchParams.set("limit", String(params.limit ?? API_PAGE_LIMIT));
  u.searchParams.set("offset", String(params.offset ?? 0));
  if (params.sort) u.searchParams.set("sort", params.sort);
  if (params.fromDateTime) u.searchParams.set("fromDateTime", params.fromDateTime);
  if (params.toDateTime) u.searchParams.set("toDateTime", params.toDateTime);
  u.searchParams.set("api_key", params.apiKey);
  return u.toString();
}

async function fetchListPage(
  url: string,
): Promise<FetchResult<RawBillListResponse>> {
  return resilientFetch<RawBillListResponse>("congress-gov", url, {
    validator: isRawBillListResponse,
    // 404 on a list query should not happen; treat 4xx as final.
    retryable4xx: [],
  });
}

function handleListFailure(res: { ok: false; reason: { kind: string; status?: number } }): never {
  const r = res.reason as { kind: string; status?: number; body?: string; source: string };
  if (r.kind === "http-error" && r.status === 403) {
    throw new CongressGovError(
      "auth",
      "Congress.gov rejected the API key (403). Verify CONGRESS_GOV_API_KEY.",
    );
  }
  if (r.kind === "schema-mismatch") {
    throw new CongressGovError(
      "schema",
      `Congress.gov response did not match expected shape: ${JSON.stringify(r).slice(0, 200)}`,
    );
  }
  throw new CongressGovError(
    "fetch",
    `Congress.gov fetch failed (${r.kind}${r.status ? ` ${r.status}` : ""})`,
  );
}

function titleMatchesQuery(title: string, query: string): boolean {
  if (!query) return true;
  // Treat the query as an AND of its whitespace-separated tokens so
  // "affordable housing" matches titles with both words (in any order).
  const haystack = title.toLowerCase();
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  return tokens.every((t) => haystack.includes(t));
}

/**
 * Search Congress.gov bills. Filters client-side against bill title because
 * the public v3 API exposes no keyword parameter.
 *
 * The iteration stops when one of three conditions is met:
 *   - The caller's offset + limit matching bills have been seen.
 *   - MAX_PAGES pages have been fetched from the API.
 *   - The API has no more pages.
 */
export async function searchCongressBills(
  params: CongressGovSearchParams,
): Promise<CongressGovSearchResult> {
  const apiKey = getApiKey();
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  const targetCount = offset + limit;

  // Build the path from the /v3/bill[/{congress}[/{billType}]] hierarchy.
  const segments = ["bill"];
  if (typeof params.congress === "number") segments.push(String(params.congress));
  if (params.billType) segments.push(params.billType);
  const path = segments.join("/");

  const matched: CongressGovBill[] = [];
  let totalFromApi = 0;
  let pagesFetched = 0;
  let apiOffset = 0;

  while (pagesFetched < MAX_PAGES && matched.length < targetCount) {
    const url = buildListUrl(path, {
      limit: API_PAGE_LIMIT,
      offset: apiOffset,
      sort: params.sort,
      fromDateTime: params.fromDateTime,
      toDateTime: params.toDateTime,
      apiKey,
    });

    const res = await fetchListPage(url);
    if (!res.ok) handleListFailure(res);
    totalFromApi = res.data.pagination.count;

    for (const raw of res.data.bills) {
      // Normalization can throw on unknown bill types (e.g., new JRES
      // subtype). Skip the offending row but keep iterating so one oddity
      // does not abort the run.
      let normalized: CongressGovBill;
      try {
        normalized = normalizeBill(raw);
      } catch (err) {
        console.warn(
          `[congress-gov] skipping row: ${(err as Error).message}`,
        );
        continue;
      }
      if (!titleMatchesQuery(normalized.title, params.query ?? "")) continue;
      matched.push(normalized);
      if (matched.length >= targetCount) break;
    }

    pagesFetched += 1;
    apiOffset += API_PAGE_LIMIT;
    // API says no more pages when `next` is absent.
    if (!res.data.pagination.next) break;
  }

  const sliced = matched.slice(offset, offset + limit);
  return {
    bills: sliced,
    pagination: {
      count: totalFromApi,
      next: matched.length > offset + limit ? "local-filter" : undefined,
    },
  };
}

/**
 * Fetch a single bill by (congress, type, number). Returns null on 404 so
 * callers can distinguish "not found" from a transport error.
 */
export async function getCongressBill(
  congress: number,
  billType: CongressBillType | CongressBillTypeUpper,
  billNumber: number,
): Promise<CongressGovBill | null> {
  const apiKey = getApiKey();
  const lower = billType.toLowerCase();
  const url = `${API_BASE}/bill/${congress}/${lower}/${billNumber}?format=json&api_key=${encodeURIComponent(apiKey)}`;

  const res = await resilientFetch<RawBillDetailResponse>("congress-gov", url, {
    validator: isRawBillDetailResponse,
    // 404 is a legitimate "no such bill" outcome, not a retryable transport
    // failure. resilient-fetch treats it as final (non-retryable 4xx) by
    // default; we special-case it here before raising.
  });

  if (res.ok) {
    try {
      return normalizeBill(res.data.bill);
    } catch (err) {
      throw new CongressGovError("schema", (err as Error).message);
    }
  }
  const r = res.reason;
  if (r.kind === "http-error" && r.status === 404) return null;
  if (r.kind === "http-error" && r.status === 403) {
    throw new CongressGovError(
      "auth",
      "Congress.gov rejected the API key (403). Verify CONGRESS_GOV_API_KEY.",
    );
  }
  if (r.kind === "schema-mismatch") {
    throw new CongressGovError(
      "schema",
      `Congress.gov response did not match expected shape: ${JSON.stringify(r).slice(0, 200)}`,
    );
  }
  throw new CongressGovError(
    "fetch",
    `Congress.gov fetch failed (${r.kind}${"status" in r && r.status ? ` ${r.status}` : ""})`,
  );
}

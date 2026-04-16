/**
 * OpenParliament.ca API client. Used as the LEGISinfo fallback.
 *
 * OpenParliament (https://openparliament.ca) mirrors federal Parliament
 * data. Free, no auth, maintained by a single developer since 2010. We use
 * it when parl.ca LEGISinfo is down.
 *
 * API reference: https://api.openparliament.ca/
 *
 * Limitations vs LEGISinfo:
 *   - No server-side text search. We paginate and filter client-side.
 *   - Minor field differences. We normalize in normalizeBill() below.
 *   - The per-page limit is 20.
 *
 * Rate limit: 2 req/s (set in lib/resilience/rate-limit.ts) to stay polite.
 */

import { resilientFetch } from "../resilient-fetch.js";
import type { FetchResult } from "../resilience/types.js";
import type { Stage } from "@/types";

interface OpenParlBillSummary {
  session: string;
  legisinfo_id: number;
  introduced: string;
  name: { en: string; fr?: string };
  number: string;
  url: string;
}

interface OpenParlBillList {
  objects: OpenParlBillSummary[];
  pagination: {
    limit: number;
    offset: number;
    next_url: string | null;
    previous_url: string | null;
  };
}

/** The normalized bill shape consumers expect. Mirrors the subset of LEGISinfo we use. */
export interface NormalizedBill {
  BillId: number;
  BillNumberFormatted: string;
  LongTitleEn: string;
  LongTitleFr?: string;
  SponsorEn?: string;
  CurrentStatusEn?: string;
  LatestActivityDateTime?: string;
  ReceivedRoyalAssentDateTime?: string;
  BillTypeEn?: string;
  /** Where the bill info came from. Helps downstream decide on confidence. */
  _source: "openparliament";
}

/**
 * Fetch every bill introduced on or after `sinceDate` (ISO YYYY-MM-DD) across
 * all pages. Uses resilientFetch so breaker/rate-limit/health logic applies.
 */
async function fetchAllBills(sinceDate: string): Promise<OpenParlBillSummary[]> {
  const out: OpenParlBillSummary[] = [];
  let url:
    | string
    | null = `https://api.openparliament.ca/bills/?introduced__gt=${encodeURIComponent(sinceDate)}&format=json&limit=20`;

  // Cap pagination to avoid runaway loops on bad data. 500 bills × 20 = 10k
  // entries, more than enough for 3+ sessions of housing-related ingestion.
  let pagesFetched = 0;
  const MAX_PAGES = 50;

  while (url && pagesFetched < MAX_PAGES) {
    const res: FetchResult<OpenParlBillList> = await resilientFetch<OpenParlBillList>(
      "openparliament",
      url,
      {
        validator: (x): x is OpenParlBillList =>
          typeof x === "object" && x !== null && Array.isArray((x as OpenParlBillList).objects),
      },
    );
    if (!res.ok) {
      throw new Error(
        `openparliament: fetch failed (${res.reason.kind}): ${JSON.stringify(res.reason).slice(0, 200)}`,
      );
    }
    out.push(...res.data.objects);
    const next: string | null = res.data.pagination?.next_url ?? null;
    url = next ? `https://api.openparliament.ca${next}` : null;
    pagesFetched += 1;
  }

  return out;
}

function matchesAnyKeyword(bill: OpenParlBillSummary, keywords: readonly string[]): boolean {
  const haystack = `${bill.name?.en ?? ""} ${bill.name?.fr ?? ""}`.toLowerCase();
  return keywords.some((k) => haystack.includes(k.toLowerCase()));
}

function normalizeBill(b: OpenParlBillSummary): NormalizedBill {
  return {
    BillId: b.legisinfo_id,
    BillNumberFormatted: b.number,
    LongTitleEn: b.name?.en ?? "",
    LongTitleFr: b.name?.fr,
    LatestActivityDateTime: b.introduced,
    CurrentStatusEn: "First reading", // OpenParliament summary does not include status
    _source: "openparliament",
  };
}

/**
 * Search OpenParliament for bills introduced on or after `sinceDate` that
 * match any of the keywords in their English or French title.
 *
 * This is the fallback surface exposed to canada-legislation.ts when the
 * LEGISinfo circuit opens.
 */
export async function searchOpenParliament(
  keywords: readonly string[],
  sinceDate: string,
): Promise<NormalizedBill[]> {
  if (keywords.length === 0) return [];
  const all = await fetchAllBills(sinceDate);
  const filtered = all.filter((b) => matchesAnyKeyword(b, keywords));
  return filtered.map(normalizeBill);
}

/**
 * Best-effort stage classification from OpenParliament URL path.
 * Not as detailed as LEGISinfo's CurrentStatusEn. Ingestion downstream
 * applies its own heuristics.
 */
export function guessStageFromSession(session: string): Stage {
  // Current session bills are still active; older sessions either died or
  // were enacted. Without more info, default to "Filed" which downstream
  // classification can upgrade if the bill title signals royal assent.
  if (session === "45-1" || session === "44-1") return "Filed";
  return "Dead";
}

/**
 * Fetch Canadian federal housing legislation.
 *
 * Primary source: LEGISinfo JSON feed (parl.ca).
 * Fallback:       OpenParliament.ca API (when the LEGISinfo circuit is open).
 *
 * Output: data/legislation/federal-ca.json
 * Cache:  data/raw/legisinfo/
 * Report: data/raw/_run-reports/legisinfo-ingest-{timestamp}.json
 *
 * Run via `npx tsx scripts/sync/canada-legislation.ts` (weekly cron) or
 * on-demand during development.
 */

import "../env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ImpactTag, LegislationCategory, Stage, StanceType } from "@/types";
import { resilientFetch } from "@/lib/resilient-fetch";
import { pickRouteWithReport } from "@/lib/resilience/fallback-router";
import { startRunReport } from "@/lib/resilience/run-report";
import { searchOpenParliament, type NormalizedBill } from "@/lib/sources/openparliament";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CACHE_DIR = join(ROOT, "data/raw/legisinfo");
const OUT_PATH = join(ROOT, "data/legislation/federal-ca.json");

mkdirSync(CACHE_DIR, { recursive: true });

// ── Keywords to search ──────────────────────────────────────────────
const KEYWORDS = [
  "housing",
  "zoning",
  "affordable",
  "rental",
  "residential",
  "homelessness",
  "mortgage",
  "logement",
  "habitation",
] as const;

const PARL_SESSION = "45-1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h per keyword cache file

// ── LEGISinfo types ─────────────────────────────────────────────────
interface LegisinfoBill {
  BillId: number;
  BillNumberPrefix?: string | null;
  BillNumber?: number | null;
  BillNumberSuffix?: string | null;
  BillNumberFormatted: string;
  LongTitleEn: string;
  LongTitleFr: string;
  ShortTitleEn?: string;
  ShortTitleFr?: string;
  SponsorEn?: string;
  CurrentStatusEn?: string;
  LatestCompletedMajorStageEn?: string;
  LatestActivityEn?: string;
  LatestActivityDateTime?: string;
  PassedHouseFirstReadingDateTime?: string;
  ReceivedRoyalAssentDateTime?: string;
  BillTypeEn?: string;
}

interface CacheEnvelope<T> {
  cached_at: string;
  expires_at: string;
  query: string;
  parlsession: string;
  data: T;
}

// ── Cache helpers ───────────────────────────────────────────────────
function cachePathFor(keyword: string): string {
  const slug = keyword.replace(/\s+/g, "_").toLowerCase();
  return join(CACHE_DIR, `search_${slug}.json`);
}

function readFreshCache(path: string): LegisinfoBill[] | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    // Back-compat: the old format was a bare array. New format is an envelope.
    if (Array.isArray(parsed)) return parsed as LegisinfoBill[];

    const env = parsed as CacheEnvelope<LegisinfoBill[]>;
    if (!env || !Array.isArray(env.data)) return null;
    const expires = new Date(env.expires_at).getTime();
    if (!Number.isFinite(expires) || expires <= Date.now()) return null;
    return env.data;
  } catch {
    return null;
  }
}

function writeCache(path: string, keyword: string, bills: LegisinfoBill[]): void {
  const now = new Date();
  const env: CacheEnvelope<LegisinfoBill[]> = {
    cached_at: now.toISOString(),
    expires_at: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
    query: keyword,
    parlsession: PARL_SESSION,
    data: bills,
  };
  writeFileSync(path, JSON.stringify(env, null, 2) + "\n");
}

// ── Primary: LEGISinfo ──────────────────────────────────────────────
async function fetchFromLegisinfo(keyword: string): Promise<LegisinfoBill[] | null> {
  const cachePath = cachePathFor(keyword);
  const fresh = readFreshCache(cachePath);
  if (fresh) {
    console.log(`  [cache] legisinfo ${keyword} (${fresh.length} bills)`);
    return fresh;
  }

  const url = `https://www.parl.ca/legisinfo/en/bills/json?text=${encodeURIComponent(keyword)}&parlsession=${PARL_SESSION}`;
  const res = await resilientFetch<LegisinfoBill[]>("legisinfo", url, {
    validator: (x): x is LegisinfoBill[] => Array.isArray(x),
  });

  if (!res.ok) {
    console.warn(
      `  [warn] legisinfo ${keyword}: ${res.reason.kind}${"status" in res.reason ? ` (${res.reason.status})` : ""}`,
    );
    return null;
  }

  writeCache(cachePath, keyword, res.data);
  console.log(`  [fetch] legisinfo ${keyword} (${res.data.length} bills)`);
  return res.data;
}

// ── Fallback: OpenParliament ────────────────────────────────────────
// Convert NormalizedBill (from openparliament.ts) to LegisinfoBill shape so
// the rest of the pipeline doesn't need to know where the data came from.
function promoteNormalized(n: NormalizedBill): LegisinfoBill {
  return {
    BillId: n.BillId,
    BillNumberFormatted: n.BillNumberFormatted,
    LongTitleEn: n.LongTitleEn,
    LongTitleFr: n.LongTitleFr ?? "",
    SponsorEn: n.SponsorEn,
    CurrentStatusEn: n.CurrentStatusEn,
    LatestActivityDateTime: n.LatestActivityDateTime,
    ReceivedRoyalAssentDateTime: n.ReceivedRoyalAssentDateTime,
    BillTypeEn: n.BillTypeEn,
  };
}

async function fetchFromOpenParliament(): Promise<LegisinfoBill[]> {
  // OpenParliament lacks server-side text search. Pull last 2 years of bills
  // then filter client-side by keywords.
  const sinceDate = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const normalized = await searchOpenParliament(KEYWORDS, sinceDate);
  return normalized.map(promoteNormalized);
}

// ── Stage mapping ───────────────────────────────────────────────────
// Known statuses from LEGISinfo observed during 2023-2026 scraping.
const STAGE_RULES: Array<{ match: RegExp; stage: Stage }> = [
  { match: /royal assent/i, stage: "Enacted" },
  { match: /defeated|prorogued|withdrawn/i, stage: "Dead" },
  { match: /third reading/i, stage: "Floor" },
  { match: /second reading/i, stage: "Floor" },
  { match: /at consideration in committee|report stage|committee/i, stage: "Committee" },
  { match: /first reading|introduced|reinstated/i, stage: "Filed" },
];

function mapStage(
  status: string | undefined,
  unmapped: Set<string>,
): Stage {
  if (!status) return "Filed";
  for (const { match, stage } of STAGE_RULES) {
    if (match.test(status)) return stage;
  }
  // Fail loud: track this status so the run report surfaces it.
  unmapped.add(status);
  return "Filed";
}

// ── Classification (housing-specific heuristics) ────────────────────
function classifyCategory(text: string): LegislationCategory {
  const rules: Array<{ cat: LegislationCategory; kw: RegExp }> = [
    { cat: "zoning-reform", kw: /\b(zon(e|ing)|density|land use|building|municipal planning)\b/i },
    { cat: "rent-regulation", kw: /\b(rent|rental (protect|regulat|stabiliz))\b/i },
    { cat: "affordable-housing", kw: /\b(affordab|social housing|co.?op|inclusionary|below.?market)\b/i },
    { cat: "development-incentive", kw: /\b(incentive|accelerat|fast.?track|housing supply|build.*homes)\b/i },
    { cat: "building-code", kw: /\b(building code|fire|construction|national building)\b/i },
    { cat: "foreign-investment", kw: /\b(foreign (buyer|purchas|invest)|non.?resident|speculation)\b/i },
    { cat: "homelessness-services", kw: /\b(homeless|shelter|supportive housing|encampment)\b/i },
    { cat: "tenant-protection", kw: /\b(evict|tenant|habitability|lease|renter)\b/i },
    { cat: "transit-housing", kw: /\b(transit|station area|corridor|infrastructure)\b/i },
    { cat: "property-tax", kw: /\b(property tax|assessment|vacant.*tax|underused housing)\b/i },
  ];
  for (const { cat, kw } of rules) {
    if (kw.test(text)) return cat;
  }
  return "affordable-housing";
}

function classifyTags(text: string): ImpactTag[] {
  const tags: ImpactTag[] = [];
  const rules: Array<{ tag: ImpactTag; kw: RegExp }> = [
    { tag: "affordability", kw: /\b(affordab|housing cost|price|cost.?burden)\b/i },
    { tag: "density", kw: /\b(density|multi.?family|duplex|fourplex|upzon)\b/i },
    { tag: "social-housing", kw: /\b(social housing|public housing|co.?op|non.?profit housing)\b/i },
    { tag: "homelessness", kw: /\b(homeless|unhoused|shelter|encampment|supportive)\b/i },
    { tag: "first-time-buyer", kw: /\b(first.?time (buyer|home)|homebuyer)\b/i },
    { tag: "foreign-buyer", kw: /\b(foreign (buyer|purchas|own)|non.?resident)\b/i },
    { tag: "rent-stabilization", kw: /\b(rent (control|stabiliz|cap|freeze))\b/i },
    { tag: "displacement", kw: /\b(displac|gentrif|relocat)\b/i },
    { tag: "indigenous-housing", kw: /\b(indigenous|First Nations|native housing|reserve)\b/i },
    { tag: "transit-oriented", kw: /\b(transit|infrastructure|corridor)\b/i },
    { tag: "mortgage-regulation", kw: /\b(mortgage|down payment|amortiz|stress test)\b/i },
  ];
  for (const { tag, kw } of rules) {
    if (kw.test(text)) tags.push(tag);
  }
  return tags.length > 0 ? tags.slice(0, 5) : ["affordability"];
}

function deriveStance(text: string, stage: Stage): StanceType {
  const isMoratorium = /moratorium|prohibit|ban|restrict|freeze/.test(text);
  const isIncentive = /incentive|accelerat|supply|build.*homes|fast.?track/.test(text);
  const isStudy = /study|commission|review|strategy|framework/.test(text);

  if (isMoratorium && stage === "Enacted") return "restrictive";
  if (isMoratorium) return "concerning";
  if (isIncentive) return "favorable";
  if (isStudy) return "review";
  return "review";
}

// ── Jurisdiction-level stance ───────────────────────────────────────
function overallStance(bills: Array<{ stance: StanceType; stage: Stage }>): StanceType {
  const tally: Record<StanceType, number> = {
    restrictive: 0,
    concerning: 0,
    review: 0,
    favorable: 0,
    none: 0,
  };
  let enactedRestrictive = 0;
  for (const b of bills) {
    tally[b.stance]++;
    if (b.stance === "restrictive" && b.stage === "Enacted") enactedRestrictive++;
  }
  if (enactedRestrictive >= 1) return "restrictive";
  const opposition = tally.concerning + tally.restrictive;
  if (opposition >= 3) return "concerning";
  if (tally.favorable >= 2 && tally.favorable >= opposition) return "favorable";
  if (tally.favorable >= 1 && opposition === 0) return "favorable";
  if (opposition >= 1 || tally.review >= 1) return "review";
  return "none";
}

function maxStance(a: StanceType, b: StanceType): StanceType {
  const rank: Record<StanceType, number> = {
    restrictive: 4,
    concerning: 3,
    review: 2,
    favorable: 1,
    none: 0,
  };
  return rank[a] >= rank[b] ? a : b;
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const report = startRunReport("legisinfo-ingest");
  report.incrementTotal(1);
  console.log("[canada-legislation] Starting...");

  const route = pickRouteWithReport(["legisinfo", "openparliament"], report);
  if (!route.ok) {
    console.error("[canada-legislation] both sources down, aborting");
    report.noteFailure({
      entity: "canada-federal",
      error: "primary and fallback sources both down",
      retryable: true,
      next_action: "retry on next scheduled run",
    });
    const finalReport = report.finish("failed");
    console.log(`[canada-legislation] exit status=${finalReport.status}`);
    return;
  }

  const seen = new Map<number, LegisinfoBill>();
  const unmappedStatuses = new Set<string>();
  let keywordsSucceeded = 0;
  let keywordsFailed = 0;

  if (route.source === "legisinfo") {
    // Primary path: one search per keyword.
    for (const kw of KEYWORDS) {
      const bills = await fetchFromLegisinfo(kw);
      if (bills === null) {
        keywordsFailed += 1;
        continue;
      }
      keywordsSucceeded += 1;
      for (const b of bills) {
        if (!seen.has(b.BillId)) seen.set(b.BillId, b);
      }
      report.recordUsage("legisinfo", { calls: 1 });
    }
    console.log(
      `  legisinfo: ${keywordsSucceeded}/${KEYWORDS.length} keyword searches ok, ${seen.size} unique bills`,
    );

    // If more than half the keyword searches failed, degrade to fallback.
    if (keywordsFailed > Math.floor(KEYWORDS.length / 2)) {
      console.warn(
        `[canada-legislation] ${keywordsFailed}/${KEYWORDS.length} LEGISinfo queries failed; topping up from OpenParliament`,
      );
      report.markSourceDegraded("legisinfo");
      report.markSourceFallbackUsed("openparliament");
      try {
        const fallback = await fetchFromOpenParliament();
        for (const b of fallback) {
          if (!seen.has(b.BillId)) seen.set(b.BillId, b);
        }
        report.recordUsage("openparliament", { calls: 1 });
      } catch (err) {
        console.error(`  [warn] openparliament fallback also failed:`, err);
        report.addNote(`openparliament fallback failed: ${(err as Error).message}`);
      }
    }
  } else {
    // route.source === "openparliament"
    try {
      const bills = await fetchFromOpenParliament();
      for (const b of bills) {
        if (!seen.has(b.BillId)) seen.set(b.BillId, b);
      }
      report.recordUsage("openparliament", { calls: 1 });
      console.log(`  openparliament: ${seen.size} bills`);
    } catch (err) {
      console.error(`[canada-legislation] openparliament failed:`, err);
      report.noteFailure({
        entity: "canada-federal",
        error: `openparliament fallback failed: ${(err as Error).message}`,
        retryable: true,
        next_action: "retry when primary source recovers",
      });
      const finalReport = report.finish("failed");
      console.log(`[canada-legislation] exit status=${finalReport.status}`);
      return;
    }
  }

  if (seen.size === 0) {
    console.warn("[canada-legislation] no bills retrieved");
    report.noteFailure({
      entity: "canada-federal",
      error: "no bills returned from any source",
      retryable: true,
      next_action: "investigate keyword list or source availability",
    });
    const finalReport = report.finish("failed");
    console.log(`[canada-legislation] exit status=${finalReport.status}`);
    return;
  }

  // ── Transform bills ───────────────────────────────────────────────
  const legislation = Array.from(seen.values()).map((b) => {
    const title = b.ShortTitleEn || b.LongTitleEn;
    const text = `${title} ${b.LongTitleEn}`.toLowerCase();
    const stage = mapStage(b.CurrentStatusEn, unmappedStatuses);
    const category = classifyCategory(text);
    const impactTags = classifyTags(text);
    const stance = deriveStance(text, stage);

    return {
      id: `ca-${b.BillNumberFormatted.replace(/\s+/g, "").toLowerCase()}`,
      billCode: b.BillNumberFormatted,
      title,
      summary: b.LongTitleEn,
      stage,
      stance,
      impactTags,
      category,
      updatedDate: b.LatestActivityDateTime
        ? b.LatestActivityDateTime.slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      sourceUrl: `https://www.parl.ca/legisinfo/en/bill/${b.BillId}`,
      sponsors: b.SponsorEn ? [b.SponsorEn] : [],
    };
  });

  if (unmappedStatuses.size > 0) {
    const list = [...unmappedStatuses].slice(0, 10);
    console.warn(
      `[canada-legislation] ${unmappedStatuses.size} unmapped status string(s): ${list.join(", ")}`,
    );
    report.addNote(
      `Unmapped LEGISinfo CurrentStatusEn values: ${list.join(", ")}. Consider extending STAGE_RULES.`,
    );
  }

  // Sort: Enacted first, then by date
  const STAGE_RANK: Record<Stage, number> = {
    Enacted: 5,
    Floor: 4,
    Committee: 3,
    Filed: 2,
    "Carried Over": 1,
    Dead: 0,
  };
  legislation.sort((a, b) => {
    const sr = (STAGE_RANK[b.stage] ?? 0) - (STAGE_RANK[a.stage] ?? 0);
    if (sr !== 0) return sr;
    return (b.updatedDate ?? "").localeCompare(a.updatedDate ?? "");
  });

  // ── Jurisdiction stance ───────────────────────────────────────────
  const stanceZoning = overallStance(
    legislation.filter(
      (b) =>
        b.category === "zoning-reform" ||
        b.category === "building-code" ||
        b.category === "transit-housing" ||
        b.category === "property-tax",
    ),
  );
  const stanceAffordability = overallStance(
    legislation.filter(
      (b) =>
        b.category === "affordable-housing" ||
        b.category === "rent-regulation" ||
        b.category === "tenant-protection" ||
        b.category === "homelessness-services" ||
        b.category === "foreign-investment" ||
        b.category === "development-incentive",
    ),
  );

  const output = {
    state: "Canada",
    stateCode: "CA",
    region: "na",
    stance: maxStance(stanceZoning, stanceAffordability),
    stanceZoning,
    stanceAffordability,
    lastUpdated: new Date().toISOString().slice(0, 10),
    contextBlurb:
      "Canada faces an acute housing affordability crisis. The federal government has introduced multiple housing supply and affordability bills in the 45th Parliament, including the Build Canada Homes program, CMHC-funded initiatives, and measures targeting foreign buyers and underused housing.",
    legislation,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
  console.log(
    `[canada-legislation] Wrote ${legislation.length} bills → ${OUT_PATH}`,
  );

  report.noteSuccess("canada-federal");
  const finalReport = report.finish();
  console.log(
    `[canada-legislation] exit status=${finalReport.status} duration=${finalReport.duration_ms}ms`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

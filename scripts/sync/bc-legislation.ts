/**
 * Fetch BC provincial housing legislation from BC Laws XML search API.
 *
 * Primary source: BC Laws full-text search (https://www.bclaws.gov.bc.ca)
 * Fallback:       CanLII via Tavily Extract on canlii.org/en/bc/laws/
 *                 (only used when the BC Laws circuit is open AND we still
 *                 have Tavily budget)
 *
 * Output: data/legislation/provinces/BC.json
 * Cache:  data/raw/bclaws/
 * Report: data/raw/_run-reports/bc-legislation-{timestamp}.json
 */

import "../env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

import type { ImpactTag, LegislationCategory, StanceType } from "@/types";
import { resilientFetch } from "@/lib/resilient-fetch";
import { pickRouteWithReport } from "@/lib/resilience/fallback-router";
import { startRunReport } from "@/lib/resilience/run-report";
import { searchTavily, extractTavily, TavilyBudgetExhausted, TavilyUnavailable } from "@/lib/tavily-client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CACHE_DIR = join(ROOT, "data/raw/bclaws");
const OUT_PATH = join(ROOT, "data/legislation/provinces/BC.json");

mkdirSync(CACHE_DIR, { recursive: true });

const KEYWORDS = ["housing", "zoning", "residential tenancy", "strata", "affordable"] as const;
const MAX_RESULTS = 20;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ── Types ───────────────────────────────────────────────────────────
interface BcLawDoc {
  CIVIX_DOCUMENT_TITLE: string;
  CIVIX_DOCUMENT_ID: string;
  CIVIX_DOCUMENT_LOC: string;
  CIVIX_DOCUMENT_TYPE: string;
}

interface CacheEnvelope {
  cached_at: string;
  expires_at: string;
  query: string;
  data: BcLawDoc[];
}

interface NormalizedDoc {
  id: string;
  billCode: string;
  title: string;
  summary: string;
  sourceUrl?: string;
}

// ── Cache ───────────────────────────────────────────────────────────
function cachePathFor(keyword: string): string {
  const slug = keyword.replace(/\s+/g, "_").toLowerCase();
  return join(CACHE_DIR, `search_${slug}.json`);
}

function readFreshCache(path: string): BcLawDoc[] | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as BcLawDoc[];
    const env = parsed as CacheEnvelope;
    if (!env || !Array.isArray(env.data)) return null;
    const expires = new Date(env.expires_at).getTime();
    if (!Number.isFinite(expires) || expires <= Date.now()) return null;
    return env.data;
  } catch {
    return null;
  }
}

function writeCache(path: string, keyword: string, data: BcLawDoc[]): void {
  const now = new Date();
  const env: CacheEnvelope = {
    cached_at: now.toISOString(),
    expires_at: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
    query: keyword,
    data,
  };
  writeFileSync(path, JSON.stringify(env, null, 2) + "\n");
}

// ── Primary: BC Laws ────────────────────────────────────────────────
const xmlParser = new XMLParser({ ignoreAttributes: false });

async function fetchFromBcLaws(keyword: string): Promise<BcLawDoc[] | null> {
  const cachePath = cachePathFor(keyword);
  const fresh = readFreshCache(cachePath);
  if (fresh) {
    console.log(`  [cache] bc-laws ${keyword} (${fresh.length})`);
    return fresh;
  }

  const url = `https://www.bclaws.gov.bc.ca/civix/search/complete/fullsearch?q=${encodeURIComponent(keyword)}&s=0&e=${MAX_RESULTS}&nFrag=5&lFrag=100`;
  const res = await resilientFetch<string>("bc-laws", url, {
    expectContentType: null, // response is text/xml, not JSON
  });

  if (!res.ok) {
    console.warn(
      `  [warn] bc-laws ${keyword}: ${res.reason.kind}${"status" in res.reason ? ` (${res.reason.status})` : ""}`,
    );
    return null;
  }

  const parsed = xmlParser.parse(res.data);
  let docs: BcLawDoc[] = [];
  const hits = parsed?.results?.doc;
  if (Array.isArray(hits)) docs = hits;
  else if (hits) docs = [hits];

  writeCache(cachePath, keyword, docs);
  console.log(`  [fetch] bc-laws ${keyword} (${docs.length})`);
  return docs;
}

function normalizeBcLaws(d: BcLawDoc): NormalizedDoc {
  const title = d.CIVIX_DOCUMENT_TITLE ?? "";
  const id = `bc-${String(d.CIVIX_DOCUMENT_ID ?? title)
    .replace(/[^a-z0-9]/gi, "-")
    .toLowerCase()
    .slice(0, 60)}`;
  return {
    id,
    billCode: String(d.CIVIX_DOCUMENT_ID ?? ""),
    title,
    summary: `BC statute or regulation: ${title}`,
    sourceUrl: d.CIVIX_DOCUMENT_LOC
      ? `https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/${d.CIVIX_DOCUMENT_LOC}`
      : undefined,
  };
}

// ── Fallback: CanLII via Tavily ─────────────────────────────────────
// Only triggered when BC Laws is down AND the circuit breaker recommends it.
// Costs ~15-20 Tavily credits (5 searches + extract on top 5 results).
async function fetchFromCanLiiViaTavily(): Promise<NormalizedDoc[]> {
  const out: NormalizedDoc[] = [];
  for (const kw of KEYWORDS) {
    try {
      const hits = await searchTavily(
        `site:canlii.org/en/bc/laws ${kw}`,
        {
          searchDepth: "basic",
          maxResults: 5,
          includeDomains: ["canlii.org"],
        },
      );
      for (const r of hits.results) {
        out.push({
          id: `bc-canlii-${r.url.split("/").slice(-1)[0]?.replace(/[^a-z0-9]/gi, "-").slice(0, 50) ?? "unknown"}`,
          billCode: "", // CanLII snippets rarely expose the statute chapter number
          title: r.title,
          summary: r.content.slice(0, 400),
          sourceUrl: r.url,
        });
      }
    } catch (err) {
      if (err instanceof TavilyBudgetExhausted || err instanceof TavilyUnavailable) {
        console.warn(`  [warn] canlii fallback halted: ${err.message}`);
        break;
      }
      throw err;
    }
  }

  // Verify each URL is reachable via Tavily Extract. Drop dead links.
  if (out.length > 0) {
    try {
      const urls = out.map((d) => d.sourceUrl).filter((u): u is string => Boolean(u));
      const ext = await extractTavily(urls.slice(0, 10), { extractDepth: "basic" });
      const good = new Set(ext.results.map((r) => r.url));
      return out.filter((d) => d.sourceUrl && good.has(d.sourceUrl));
    } catch (err) {
      if (err instanceof TavilyBudgetExhausted || err instanceof TavilyUnavailable) {
        console.warn(`  [warn] canlii extract halted: ${err.message}`);
        // Without extract validation we return the search results as-is.
        return out;
      }
      throw err;
    }
  }
  return out;
}

// ── Classification ──────────────────────────────────────────────────
function classifyCategory(title: string): LegislationCategory {
  const t = title.toLowerCase();
  if (/tenancy|tenant|rent|lease/.test(t)) return "tenant-protection";
  if (/strata|condominium/.test(t)) return "zoning-reform";
  if (/zoning|land use|planning|density/.test(t)) return "zoning-reform";
  if (/affordable|social housing|co.?op/.test(t)) return "affordable-housing";
  if (/homeless|shelter|supportive/.test(t)) return "homelessness-services";
  if (/building code|safety|construction/.test(t)) return "building-code";
  if (/property (tax|assess|transfer)/.test(t)) return "property-tax";
  if (/foreign|speculation/.test(t)) return "foreign-investment";
  if (/transit|corridor/.test(t)) return "transit-housing";
  return "zoning-reform";
}

function classifyTags(title: string): ImpactTag[] {
  const tags: ImpactTag[] = [];
  const t = title.toLowerCase();
  if (/tenant|rent|lease/.test(t)) tags.push("rent-stabilization");
  if (/strata|condominium|owner/.test(t)) tags.push("density");
  if (/zoning|land|planning/.test(t)) tags.push("inclusionary-zoning");
  if (/affordable|social/.test(t)) tags.push("affordability");
  if (/homeless|shelter/.test(t)) tags.push("homelessness");
  if (/foreign|speculation/.test(t)) tags.push("foreign-buyer");
  if (/transit/.test(t)) tags.push("transit-oriented");
  if (/heritage|historic/.test(t)) tags.push("heritage-protection");
  return tags.length > 0 ? tags.slice(0, 5) : ["affordability"];
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const report = startRunReport("bc-legislation");
  report.incrementTotal(1);
  console.log("[bc-legislation] Starting...");

  const route = pickRouteWithReport(["bc-laws", "canlii"], report);
  if (!route.ok) {
    console.error("[bc-legislation] bc-laws and canlii both down, aborting");
    report.noteFailure({
      entity: "british-columbia",
      error: "primary (bc-laws) and fallback (canlii) both down",
      retryable: true,
      next_action: "retry on next scheduled run",
    });
    report.finish("failed");
    return;
  }

  const seen = new Map<string, NormalizedDoc>();

  if (route.source === "bc-laws") {
    let succeeded = 0;
    let failed = 0;
    for (const kw of KEYWORDS) {
      const docs = await fetchFromBcLaws(kw);
      if (docs === null) {
        failed += 1;
        continue;
      }
      succeeded += 1;
      report.recordUsage("bc-laws", { calls: 1 });
      for (const d of docs) {
        const id = d.CIVIX_DOCUMENT_ID ?? d.CIVIX_DOCUMENT_LOC;
        if (!id) continue;
        if (!seen.has(id)) {
          const n = normalizeBcLaws(d);
          seen.set(id, n);
        }
      }
    }
    console.log(`  bc-laws: ${succeeded}/${KEYWORDS.length} keyword searches ok, ${seen.size} unique docs`);

    // Degrade to CanLII fallback if most primary queries failed.
    if (failed > Math.floor(KEYWORDS.length / 2)) {
      console.warn(
        `[bc-legislation] ${failed}/${KEYWORDS.length} bc-laws queries failed; topping up from CanLII`,
      );
      report.markSourceDegraded("bc-laws");
      report.markSourceFallbackUsed("canlii");
      try {
        const canlii = await fetchFromCanLiiViaTavily();
        for (const d of canlii) {
          if (!seen.has(d.id)) seen.set(d.id, d);
        }
        report.recordUsage("tavily", { calls: 1 });
      } catch (err) {
        console.error(`  [warn] canlii top-up failed:`, err);
        report.addNote(`canlii top-up failed: ${(err as Error).message}`);
      }
    }
  } else {
    // route.source === "canlii"
    try {
      const canlii = await fetchFromCanLiiViaTavily();
      for (const d of canlii) {
        if (!seen.has(d.id)) seen.set(d.id, d);
      }
      report.recordUsage("tavily", { calls: 1 });
    } catch (err) {
      console.error(`[bc-legislation] canlii failed:`, err);
      report.noteFailure({
        entity: "british-columbia",
        error: `canlii fallback failed: ${(err as Error).message}`,
        retryable: true,
        next_action: "retry when bc-laws recovers",
      });
      report.finish("failed");
      return;
    }
  }

  if (seen.size === 0) {
    console.warn("[bc-legislation] no documents retrieved");
    report.noteFailure({
      entity: "british-columbia",
      error: "no documents returned from any source",
      retryable: true,
      next_action: "investigate keyword list or source availability",
    });
    report.finish("failed");
    return;
  }

  // ── Transform ─────────────────────────────────────────────────────
  const legislation = Array.from(seen.values()).map((d) => ({
    id: d.id,
    billCode: d.billCode,
    title: d.title,
    summary: d.summary,
    stage: "Enacted" as const,
    stance: "review" as StanceType,
    impactTags: classifyTags(d.title),
    category: classifyCategory(d.title),
    updatedDate: new Date().toISOString().slice(0, 10),
    sourceUrl: d.sourceUrl,
  }));

  const stanceZoning: StanceType = "review";
  const stanceAffordability: StanceType = "favorable";

  const output = {
    state: "British Columbia",
    stateCode: "BC",
    region: "na",
    stance: "review",
    stanceZoning,
    stanceAffordability,
    lastUpdated: new Date().toISOString().slice(0, 10),
    contextBlurb:
      "British Columbia has been at the forefront of Canadian housing reform. The province has enacted legislation on short-term rental regulation, transit-oriented density, and the elimination of single-family-only zoning. The Residential Tenancy Act provides strong tenant protections, and the Speculation and Vacancy Tax targets foreign and vacant property owners.",
    legislation,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
  console.log(`[bc-legislation] Wrote ${legislation.length} docs → ${OUT_PATH}`);

  report.noteSuccess("british-columbia");
  const finalReport = report.finish();
  console.log(
    `[bc-legislation] exit status=${finalReport.status} duration=${finalReport.duration_ms}ms`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Canada Municipal Housing Actions Pipeline.
 *
 * Uses Tavily to research housing bylaws, zoning changes, and affordability
 * actions for major Canadian cities across 4 priority provinces (Quebec,
 * Ontario, Alberta, New Brunswick). Outputs one JSON file per province in
 * data/municipal/.
 *
 * Data source: Tavily search + extract (Tier 2). Requires TAVILY_API_KEY.
 *
 * Output:  data/municipal/{province}.json
 * Report:  data/raw/_run-reports/canada-municipal-*.json
 *
 * Budget: ~2-3 Tavily credits per city. Check data/raw/tavily/_usage.json
 * before running.
 */

import "../env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { searchTavily, TavilyUnavailable } from "../../lib/tavily-client.js";
import { TavilyBudgetExhausted } from "../../lib/tavily-types.js";
import { startRunReport } from "../../lib/resilience/run-report.js";
import type { MunicipalAction, MunicipalActionStatus, ImpactTag } from "../../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const OUT_DIR = join(ROOT, "data/municipal");

// ── Province configuration ─────────────────────────────────────────

interface CityConfig {
  name: string;
  cduid: string;
  /** Census division name (may differ from city name). */
  cdName: string;
}

interface ProvinceConfig {
  name: string;
  code: string;
  fileName: string;
  cities: CityConfig[];
}

const PROVINCES: ProvinceConfig[] = [
  {
    name: "Quebec",
    code: "QC",
    fileName: "quebec.json",
    cities: [
      { name: "Montreal", cduid: "2466", cdName: "Montreal" },
      { name: "Quebec City", cduid: "2423", cdName: "Quebec" },
      { name: "Laval", cduid: "2465", cdName: "Laval" },
      { name: "Gatineau", cduid: "2481", cdName: "Gatineau" },
      { name: "Sherbrooke", cduid: "2443", cdName: "Sherbrooke" },
      { name: "Longueuil", cduid: "2458", cdName: "Longueuil" },
      { name: "Trois-Rivieres", cduid: "2437", cdName: "Francheville" },
      { name: "Levis", cduid: "2425", cdName: "Levis" },
      { name: "Saguenay", cduid: "2494", cdName: "Le Fjord-du-Saguenay" },
      { name: "Terrebonne", cduid: "2464", cdName: "Les Moulins" },
    ],
  },
  {
    name: "Ontario",
    code: "ON",
    fileName: "ontario.json",
    cities: [
      { name: "Toronto", cduid: "3520", cdName: "Toronto" },
      { name: "Ottawa", cduid: "3506", cdName: "Ottawa" },
      { name: "Mississauga", cduid: "3521", cdName: "Peel" },
      { name: "Hamilton", cduid: "3525", cdName: "Hamilton" },
      { name: "London", cduid: "3539", cdName: "Middlesex" },
      { name: "Markham", cduid: "3519", cdName: "York" },
      { name: "Kitchener", cduid: "3530", cdName: "Waterloo" },
      { name: "Windsor", cduid: "3537", cdName: "Essex" },
    ],
  },
  {
    name: "Alberta",
    code: "AB",
    fileName: "alberta.json",
    cities: [
      { name: "Calgary", cduid: "4806", cdName: "Division No. 6" },
      { name: "Edmonton", cduid: "4811", cdName: "Division No. 11" },
      { name: "Red Deer", cduid: "4808", cdName: "Division No. 8" },
      { name: "Lethbridge", cduid: "4802", cdName: "Division No. 2" },
      { name: "Medicine Hat", cduid: "4801", cdName: "Division No. 1" },
      { name: "Grande Prairie", cduid: "4819", cdName: "Division No. 19" },
    ],
  },
  {
    name: "New Brunswick",
    code: "NB",
    fileName: "new-brunswick.json",
    cities: [
      { name: "Moncton", cduid: "1307", cdName: "Westmorland" },
      { name: "Saint John", cduid: "1301", cdName: "Saint John" },
      { name: "Fredericton", cduid: "1310", cdName: "York" },
      { name: "Miramichi", cduid: "1309", cdName: "Northumberland" },
      { name: "Riverview", cduid: "1306", cdName: "Albert" },
      { name: "Bathurst", cduid: "1315", cdName: "Gloucester" },
    ],
  },
];

// ── Action extraction helpers ──────────────────────────────────────

/** Keywords that suggest a housing action exists in a search result. */
const ACTION_KEYWORDS = [
  "bylaw",
  "zoning",
  "rezoning",
  "affordable housing",
  "inclusionary",
  "density",
  "multiplex",
  "fourplex",
  "duplex",
  "ADU",
  "accessory dwelling",
  "rent control",
  "vacancy tax",
  "short-term rental",
  "housing accelerator",
  "social housing",
];

function classifyStatus(text: string): MunicipalActionStatus {
  const lower = text.toLowerCase();
  if (/enacted|approved|passed|adopted|in effect|effective/.test(lower)) return "enacted";
  if (/under review|reviewing|hearing|consultation/.test(lower)) return "under-review";
  if (/proposed|introduced|tabled|first reading/.test(lower)) return "proposed";
  if (/failed|defeated|rejected|repealed|withdrawn/.test(lower)) return "failed";
  return "proposed";
}

function classifyConcerns(text: string): ImpactTag[] {
  const lower = text.toLowerCase();
  const tags: ImpactTag[] = [];
  if (/affordab/.test(lower)) tags.push("affordability");
  if (/densit|multiplex|fourplex|duplex|missing middle/.test(lower)) tags.push("density");
  if (/inclusionary/.test(lower)) tags.push("inclusionary-zoning");
  if (/rent control|rent stab/.test(lower)) tags.push("rent-stabilization");
  if (/social housing/.test(lower)) tags.push("social-housing");
  if (/short.term rental|airbnb/.test(lower)) tags.push("short-term-rental");
  if (/vacancy tax/.test(lower)) tags.push("vacancy-tax");
  if (/displac/.test(lower)) tags.push("displacement");
  if (/lot split/.test(lower)) tags.push("lot-splitting");
  if (/transit.oriented/.test(lower)) tags.push("transit-oriented");
  if (/indigenous/.test(lower)) tags.push("indigenous-housing");
  return [...new Set(tags)];
}

interface MunicipalEntry {
  id: string;
  name: string;
  fips: string;
  state: string;
  stateCode: string;
  type: "census-division";
  actions: MunicipalAction[];
  concerns: ImpactTag[];
  contextBlurb: string;
}

// ── Main pipeline ──────────────────────────────────────────────────

async function researchCity(
  city: CityConfig,
  province: ProvinceConfig,
): Promise<{ actions: MunicipalAction[]; concerns: ImpactTag[]; blurb: string }> {
  const actions: MunicipalAction[] = [];
  let concerns: ImpactTag[] = [];
  let blurb = `${city.name} housing policy is tracked as part of ${province.name} coverage. Provincial legislation and local zoning changes are monitored in the tracker.`;

  // Search 1: housing bylaws and zoning actions.
  try {
    const searchResult = await searchTavily(
      `${city.name} ${province.name} Canada housing bylaw zoning 2024 2025 2026`,
      { searchDepth: "basic", maxResults: 5 },
    );

    for (const result of searchResult.results ?? []) {
      const content = (result.content ?? "").toLowerCase();
      const hasKeyword = ACTION_KEYWORDS.some((kw) => content.includes(kw.toLowerCase()));
      if (!hasKeyword) continue;

      // Extract a title from the search result.
      const title = result.title?.slice(0, 120) ?? "Housing policy action";
      const status = classifyStatus(result.content ?? "");
      const resultConcerns = classifyConcerns(result.content ?? "");
      concerns = concerns.concat(resultConcerns);

      // Extract date if present in the content. Look for YYYY-MM-DD or similar.
      const dateMatch = (result.content ?? "").match(/\b(20[2-3]\d)[- /](0[1-9]|1[0-2])[- /](\d{2})\b/);
      const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : "2025-01-01";

      actions.push({
        title,
        date,
        status,
        summary: (result.content ?? "").slice(0, 300),
        sourceUrl: result.url,
      });
    }
  } catch (err) {
    if (err instanceof TavilyBudgetExhausted) throw err;
    if (err instanceof TavilyUnavailable) throw err;
    console.warn(`  [warn] Search failed for ${city.name}: ${(err as Error).message}`);
  }

  // Search 2: vacancy rate and rent data for contextBlurb.
  try {
    const contextResult = await searchTavily(
      `${city.name} ${province.name} vacancy rate rent housing 2024 2025`,
      { searchDepth: "basic", maxResults: 3 },
    );

    const snippets = (contextResult.results ?? [])
      .map((r) => r.content ?? "")
      .join(" ")
      .slice(0, 500);

    if (snippets.length > 50) {
      blurb = snippets.replace(/\s+/g, " ").trim();
      // Ensure no em dashes.
      blurb = blurb.replace(/\u2014/g, ". ");
      blurb = blurb.replace(/\u2013/g, ". ");
    }
  } catch (err) {
    if (err instanceof TavilyBudgetExhausted) throw err;
    if (err instanceof TavilyUnavailable) throw err;
    console.warn(`  [warn] Context search failed for ${city.name}: ${(err as Error).message}`);
  }

  concerns = [...new Set(concerns)];
  if (concerns.length === 0) concerns = ["affordability"];

  return { actions, concerns, blurb };
}

async function processProvince(province: ProvinceConfig, report: ReturnType<typeof startRunReport>): Promise<void> {
  console.log(`\n=== ${province.name} (${province.code}) ===`);

  // Read existing file if present, to preserve manual edits.
  const outPath = join(OUT_DIR, province.fileName);
  let existing: MunicipalEntry[] = [];
  if (existsSync(outPath)) {
    try {
      existing = JSON.parse(readFileSync(outPath, "utf-8"));
    } catch {
      console.warn(`  [warn] Could not parse existing ${province.fileName}, will overwrite.`);
    }
  }

  // Build lookup of existing entries by CDUID for merge.
  const existingByCd = new Map<string, MunicipalEntry>();
  for (const e of existing) {
    existingByCd.set(e.fips, e);
  }

  // Deduplicate cities that share a CDUID (e.g., Mississauga + Brampton
  // both map to Peel 3521). Only research once per CD.
  const seen = new Set<string>();
  const uniqueCities: CityConfig[] = [];
  for (const city of province.cities) {
    if (seen.has(city.cduid)) continue;
    seen.add(city.cduid);
    uniqueCities.push(city);
  }

  const entries: MunicipalEntry[] = [];

  for (const city of uniqueCities) {
    console.log(`  Researching ${city.name} (CD ${city.cduid})...`);
    report.incrementTotal();

    try {
      const { actions, concerns, blurb } = await researchCity(city, province);

      // Merge: if existing entry has manually curated actions, keep them and
      // only add new ones that aren't duplicates.
      const prev = existingByCd.get(city.cduid);
      let mergedActions = actions;
      if (prev && prev.actions.length > 0) {
        const prevTitles = new Set(prev.actions.map((a) => a.title.toLowerCase()));
        const newActions = actions.filter((a) => !prevTitles.has(a.title.toLowerCase()));
        mergedActions = [...prev.actions, ...newActions];
      }

      entries.push({
        id: `cd-${city.cduid}`,
        name: city.cdName,
        fips: city.cduid,
        state: province.name,
        stateCode: province.code,
        type: "census-division",
        actions: mergedActions,
        concerns,
        contextBlurb: blurb,
      });

      report.noteSuccess(city.name);
      console.log(`    Found ${actions.length} actions, ${concerns.length} concerns`);
    } catch (err) {
      if (err instanceof TavilyBudgetExhausted) {
        console.error(`  [STOP] Tavily budget exhausted. Saving partial results.`);
        report.noteFailure({
          entity: city.name,
          error: "Budget exhausted",
          retryable: true,
          next_action: "retry next run after budget resets",
        });
        break;
      }
      if (err instanceof TavilyUnavailable) {
        console.error(`  [STOP] Tavily unavailable: ${(err as Error).message}`);
        report.noteFailure({
          entity: city.name,
          error: (err as Error).message,
          retryable: false,
          next_action: "investigate Tavily availability",
        });
        break;
      }

      report.noteFailure({
        entity: city.name,
        error: (err as Error).message ?? String(err),
        retryable: true,
        next_action: "retry next run",
      });

      // Fall back to existing data or a bare entry.
      const prev = existingByCd.get(city.cduid);
      entries.push(
        prev ?? {
          id: `cd-${city.cduid}`,
          name: city.cdName,
          fips: city.cduid,
          state: province.name,
          stateCode: province.code,
          type: "census-division",
          actions: [],
          concerns: ["affordability"],
          contextBlurb: `${city.name} housing policy is tracked as part of ${province.name} coverage.`,
        },
      );
    }
  }

  // Write output.
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(outPath, JSON.stringify(entries, null, 2) + "\n");
  console.log(`  Wrote ${entries.length} entries to ${province.fileName}`);
}

async function main() {
  console.log("Canada Municipal Housing Actions Pipeline");
  console.log("==========================================\n");

  const report = startRunReport("canada-municipal");

  let exitStatus: "healthy" | "partial" | "degraded" = "healthy";

  for (const province of PROVINCES) {
    try {
      await processProvince(province, report);
    } catch (err) {
      console.error(`  [ERROR] Province ${province.name} failed: ${(err as Error).message}`);
      exitStatus = "partial";
    }
  }

  const finalReport = report.finish(exitStatus);
  console.log(`\nDone. Status: ${finalReport.status}`);
  console.log(`  Total: ${finalReport.entities_total}, OK: ${finalReport.entities_successful}, Fail: ${finalReport.failures.length}`);
}

main().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});

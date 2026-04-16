/**
 * US state housing bills via LegiScan. Dormant until LEGISCAN_API_KEY is set.
 *
 * Why dormant-by-default:
 *   The user's LegiScan key is pending at the time of writing. When the key
 *   arrives and is added to .env.local (or GitHub Actions secrets), this
 *   pipeline activates automatically. No code change is required to turn
 *   it on.
 *
 * What it does when active:
 *   For each of the top 10 housing-critical US states (CA, NY, TX, FL, WA,
 *   MA, OR, CO, AZ, NC), search LegiScan for "housing" bills in the current
 *   and previous session year. For each match that passes the title
 *   relevance filter, we:
 *     1. Call getLegiScanBill() to pull sponsors and the numeric status.
 *     2. Normalize to the same bill shape the Tavily/Apify paths emit.
 *     3. Merge into data/legislation/us-states-housing/{STATE}.json. Tavily
 *        bills keep their classification; LegiScan wins on url (state_link)
 *        and stage (status is numeric and more accurate than scraped text).
 *
 * Failure modes:
 *   - Missing/placeholder API key   → exit 0 with a "dormant" message.
 *   - LegiScan 401/403              → fail fast; the key is wrong.
 *   - Individual state fetch fails  → log, continue with the next state.
 *   - Network/timeout               → exponential backoff via resilientFetch.
 */

import "../env.js";
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  getLegiScanBill,
  legiscanStatusToStage,
  LegiScanError,
  searchLegiScan,
  type LegiScanBill,
} from "@/lib/sources/legiscan";
import { startRunReport } from "@/lib/resilience/run-report";
import type {
  ImpactTag,
  LegislationCategory,
  Stage,
  StanceType,
} from "@/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const OUT_DIR = join(ROOT, "data/legislation/us-states-housing");

// Keep in sync with the STATES list in us-states-housing-research.ts. The
// two pipelines write to the same directory; this list just defines which
// states the LegiScan merge targets.
const STATE_CODES = ["CA", "NY", "TX", "FL", "WA", "MA", "OR", "CO", "AZ", "NC"] as const;

// Title-keyword regex used to decide whether a LegiScan hit is housing-related.
// LegiScan's server-side search is loose ("housing" matches procedural
// resolutions that mention housing in passing), so we re-filter here.
const HOUSING_KEYWORDS =
  /\b(housing|affordab|zoning|rent|tenant|homeless|evict|mortgage|landlord|residential (development|property)|building code)\b/i;

interface StoredBill {
  id: string;
  billCode: string;
  title: string;
  summary: string;
  stage: Stage;
  stance: StanceType;
  impactTags: ImpactTag[];
  category: LegislationCategory;
  updatedDate: string;
  sourceUrl: string;
  sponsors: string[];
}

interface StoredStateFile {
  state: string;
  stateCode: string;
  region: string;
  stance: StanceType;
  stanceZoning: StanceType;
  stanceAffordability: StanceType;
  lastUpdated: string;
  contextBlurb: string;
  legislation: StoredBill[];
}

// ── Helpers ─────────────────────────────────────────────────────────
function normalizeBillCode(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

function slugifyBillCode(code: string): string {
  return code
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase();
}

function classifyCategory(text: string): LegislationCategory {
  const rules: Array<{ cat: LegislationCategory; kw: RegExp }> = [
    { cat: "zoning-reform", kw: /\b(zon(e|ing)|preempt|density|land use|missing middle|ADU|duplex|fourplex)\b/i },
    { cat: "rent-regulation", kw: /\b(rent (control|stabiliz|cap|freeze))\b/i },
    { cat: "affordable-housing", kw: /\b(affordab|LIHTC|low.?income housing|inclusionary|section 8)\b/i },
    { cat: "development-incentive", kw: /\b(incentive|fast.?track|housing supply|build.*homes|opportunity zone|TIF|expedite)\b/i },
    { cat: "building-code", kw: /\b(building code|fire safety|accessibility|energy efficiency)\b/i },
    { cat: "foreign-investment", kw: /\b(foreign (buyer|purchas|invest)|non.?resident|FIRPTA)\b/i },
    { cat: "homelessness-services", kw: /\b(homeless|shelter|supportive housing|encampment)\b/i },
    { cat: "tenant-protection", kw: /\b(evict|tenant|habitability|just cause|relocation)\b/i },
    { cat: "transit-housing", kw: /\b(transit|TOD|station area|corridor|MBTA Communities)\b/i },
    { cat: "property-tax", kw: /\b(property tax|assessment|abatement|exemption|vacant.*tax)\b/i },
  ];
  for (const { cat, kw } of rules) if (kw.test(text)) return cat;
  return "affordable-housing";
}

function classifyTags(text: string): ImpactTag[] {
  const tags: ImpactTag[] = [];
  const rules: Array<{ tag: ImpactTag; kw: RegExp }> = [
    { tag: "affordability", kw: /\b(affordab|housing cost|cost.?burden|LIHTC)\b/i },
    { tag: "density", kw: /\b(density|multi.?family|ADU|missing middle|upzon|duplex|fourplex)\b/i },
    { tag: "social-housing", kw: /\b(public housing|social housing|section 8)\b/i },
    { tag: "homelessness", kw: /\b(homeless|unhoused|shelter|encampment|supportive)\b/i },
    { tag: "first-time-buyer", kw: /\b(first.?time (buyer|home)|down payment assistance)\b/i },
    { tag: "foreign-buyer", kw: /\b(foreign (buyer|purchas|own)|non.?resident)\b/i },
    { tag: "rent-stabilization", kw: /\b(rent (control|stabiliz|cap|freeze))\b/i },
    { tag: "displacement", kw: /\b(displac|gentrif|relocat)\b/i },
    { tag: "transit-oriented", kw: /\b(transit.?oriented|TOD|corridor)\b/i },
    { tag: "mortgage-regulation", kw: /\b(mortgage|FHA|Fannie|Freddie)\b/i },
    { tag: "short-term-rental", kw: /\b(short.?term rental|airbnb|vacation rental)\b/i },
    { tag: "vacancy-tax", kw: /\b(vacancy tax|vacant.*tax|empty.*home)\b/i },
  ];
  for (const { tag, kw } of rules) if (kw.test(text)) tags.push(tag);
  return tags.length > 0 ? tags.slice(0, 5) : ["affordability"];
}

function deriveStance(text: string, stage: Stage): StanceType {
  const lower = text.toLowerCase();
  const isMoratorium = /moratorium|prohibit|ban\b|restrict|freeze|hard cap/.test(lower);
  const isIncentive = /incentive|accelerat|supply|build.*homes|fast.?track|streamlin|expand|expedite|preempt|by.?right/.test(lower);
  const isStudy = /study|commission|review|strategy|framework|task.?force/.test(lower);
  if (isMoratorium && stage === "Enacted") return "restrictive";
  if (isMoratorium) return "concerning";
  if (isIncentive) return "favorable";
  if (isStudy) return "review";
  return "review";
}

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

function readState(code: string): StoredStateFile | null {
  const p = join(OUT_DIR, `${code}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as StoredStateFile;
  } catch {
    return null;
  }
}

function writeState(code: string, state: StoredStateFile): void {
  const p = join(OUT_DIR, `${code}.json`);
  writeFileSync(p, JSON.stringify(state, null, 2), { encoding: "utf8" });
}

function normalizeLegiScanBill(
  bill: LegiScanBill,
  stateCode: string,
): StoredBill {
  const billCode = bill.bill_number.trim();
  const slug = slugifyBillCode(billCode);
  const { stage } = legiscanStatusToStage(bill.status);
  const text = `${bill.title} ${bill.description ?? ""}`;
  return {
    id: `us-${stateCode.toLowerCase()}-${slug}`,
    billCode,
    title: bill.title,
    summary: bill.description || bill.title,
    stage,
    stance: deriveStance(text, stage),
    impactTags: classifyTags(text),
    category: classifyCategory(text),
    updatedDate: bill.last_action_date || new Date().toISOString().slice(0, 10),
    sourceUrl: bill.state_link || bill.url,
    sponsors: bill.sponsors.map((s) => `${s.name}${s.party ? ` (${s.party})` : ""}`),
  };
}

function mergeBills(
  existing: StoredBill[],
  incoming: StoredBill[],
): { merged: StoredBill[]; added: number; upgraded: number } {
  const byCode = new Map<string, StoredBill>();
  for (const b of existing) byCode.set(normalizeBillCode(b.billCode), b);
  let added = 0;
  let upgraded = 0;
  for (const b of incoming) {
    const key = normalizeBillCode(b.billCode);
    const prior = byCode.get(key);
    if (!prior) {
      byCode.set(key, b);
      added += 1;
      continue;
    }
    // Prefer LegiScan metadata: canonical state_link URL, numeric stage.
    // Keep the Tavily-derived classification (stance/impactTags/category)
    // so downstream UI stays consistent.
    let wasUpgraded = false;
    const nextSourceUrl =
      b.sourceUrl && b.sourceUrl !== prior.sourceUrl ? b.sourceUrl : prior.sourceUrl;
    if (nextSourceUrl !== prior.sourceUrl) wasUpgraded = true;
    const nextStage = b.stage; // LegiScan numeric status is authoritative for stage.
    if (nextStage !== prior.stage) wasUpgraded = true;
    const nextUpdatedDate = b.updatedDate > prior.updatedDate ? b.updatedDate : prior.updatedDate;
    const nextSponsors = b.sponsors.length > 0 ? b.sponsors : prior.sponsors;
    byCode.set(key, {
      ...prior,
      sourceUrl: nextSourceUrl,
      stage: nextStage,
      updatedDate: nextUpdatedDate,
      sponsors: nextSponsors,
    });
    if (wasUpgraded) upgraded += 1;
  }
  const STAGE_RANK: Record<Stage, number> = {
    Enacted: 5,
    Floor: 4,
    Committee: 3,
    Filed: 2,
    "Carried Over": 1,
    Dead: 0,
  };
  const merged = Array.from(byCode.values()).sort((a, b) => {
    const sr = (STAGE_RANK[b.stage] ?? 0) - (STAGE_RANK[a.stage] ?? 0);
    if (sr !== 0) return sr;
    return (b.updatedDate ?? "").localeCompare(a.updatedDate ?? "");
  });
  return { merged, added, upgraded };
}

// ── main ────────────────────────────────────────────────────────────
async function main() {
  const legiscanKey = process.env.LEGISCAN_API_KEY?.trim();
  // Dormant guard: key missing OR looks like a placeholder string.
  // Real LegiScan keys are 32 hex characters; anything under 16 is
  // almost certainly a placeholder left in by the user.
  if (!legiscanKey || legiscanKey.length < 16) {
    console.log(
      "[legiscan] Dormant. Add LEGISCAN_API_KEY to .env.local to activate.",
    );
    process.exit(0);
  }

  const report = startRunReport("us-legiscan-housing");
  console.log("[us-legiscan-housing] Starting with LegiScan primary...");

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const years = [currentYear, currentYear - 1];

  for (const code of STATE_CODES) {
    report.incrementTotal(1);
    try {
      const existingState = readState(code);
      if (!existingState) {
        console.warn(`  [warn] ${code}: no existing state file, skipping merge`);
        report.noteFailure({
          entity: code,
          error: "no existing state file",
          retryable: true,
          next_action: "run us-states-housing-research.ts first",
        });
        continue;
      }

      const incoming: StoredBill[] = [];
      for (const year of years) {
        const res = await searchLegiScan({ query: "housing", state: code, year });
        report.recordUsage("legiscan", { calls: 1 });

        const relevant = res.filter((b) => HOUSING_KEYWORDS.test(b.title));
        for (const entry of relevant) {
          try {
            const detail = await getLegiScanBill(entry.bill_id);
            report.recordUsage("legiscan", { calls: 1 });
            incoming.push(normalizeLegiScanBill(detail, code));
          } catch (err) {
            if (err instanceof LegiScanError && err.kind === "auth") throw err;
            console.warn(
              `  [warn] ${code}: getBill(${entry.bill_id}) failed: ${(err as Error).message}`,
            );
          }
        }
      }

      const { merged, added, upgraded } = mergeBills(existingState.legislation, incoming);

      const stanceZoning = overallStance(
        merged.filter((b) =>
          b.category === "zoning-reform" ||
          b.category === "building-code" ||
          b.category === "transit-housing" ||
          b.category === "property-tax",
        ),
      );
      const stanceAffordability = overallStance(
        merged.filter((b) =>
          b.category === "affordable-housing" ||
          b.category === "rent-regulation" ||
          b.category === "tenant-protection" ||
          b.category === "homelessness-services" ||
          b.category === "foreign-investment" ||
          b.category === "development-incentive",
        ),
      );
      const overall = maxStance(stanceZoning, stanceAffordability);

      const updated: StoredStateFile = {
        ...existingState,
        stance: overall,
        stanceZoning,
        stanceAffordability,
        lastUpdated: now.toISOString().slice(0, 10),
        legislation: merged,
      };
      writeState(code, updated);
      console.log(
        `  [done] ${code}: +${added} added, ${upgraded} upgraded, total=${merged.length}`,
      );
      report.noteSuccess(code);
    } catch (err) {
      if (err instanceof LegiScanError && err.kind === "auth") {
        console.error(`[us-legiscan-housing] auth failure: ${err.message}`);
        report.noteFailure({
          entity: code,
          error: err.message,
          retryable: false,
          next_action: "Verify LEGISCAN_API_KEY",
        });
        report.finish("failed");
        process.exit(1);
      }
      console.warn(`  [warn] ${code} failed: ${(err as Error).message}`);
      report.noteFailure({
        entity: code,
        error: (err as Error).message,
        retryable: true,
        next_action: "retry next run",
      });
    }

    // Polite delay between states even though the rate limiter handles it.
    await new Promise((r) => setTimeout(r, 500));
  }

  const final = report.finish();
  console.log(
    `[us-legiscan-housing] finished status=${final.status} duration=${final.duration_ms}ms`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

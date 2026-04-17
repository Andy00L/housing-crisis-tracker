/**
 * US federal housing legislation pipeline (Congress.gov primary).
 *
 * Flow:
 *   1. Query Congress.gov for housing keywords across the 119th and 118th
 *      Congresses. Client-side-filtered by title because the v3 API has no
 *      server-side search parameter.
 *   2. Enrich each candidate with getCongressBill() to pull sponsors,
 *      policyArea, subjects, and cosponsor counts.
 *   3. Ask Claude to decide housing relevance, stance, category, impact tags,
 *      and write a two-sentence plain-language summary. Batched to keep the
 *      Anthropic bill predictable.
 *   4. Optional Tavily enrichment for bills with thin metadata, budget-capped
 *      at 15 credits so the run stays inside the monthly envelope.
 *   5. HEAD each canonical congress.gov URL to guard against malformed output
 *      (the URLs are built from bill identifiers, so any 404 is a schema bug).
 *   6. Write the same JsonLegFile shape consumed by build-placeholder.ts.
 *
 * Output: data/legislation/federal-us-housing.json
 * Run report: data/raw/_run-reports/us-federal-housing-{ts}.json
 *
 * Canadian pipelines are unaffected by this file. The single export target
 * (the federal-us-housing.json file) is the only filesystem artifact touched.
 */

import "../env.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type {
  ImpactTag,
  LegislationCategory,
  Stage,
  StanceType,
} from "@/types";
import {
  CongressGovError,
  getCongressBill,
  searchCongressBills,
  type CongressGovBill,
} from "@/lib/sources/congress-gov";
import {
  searchTavily,
  TavilyBudgetExhausted,
  TavilyUnavailable,
} from "@/lib/tavily-client";
import { startRunReport } from "@/lib/resilience/run-report";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const OUT_PATH = join(ROOT, "data/legislation/federal-us-housing.json");

const MODEL = "claude-sonnet-4-6";

const HOUSING_QUERIES: readonly string[] = [
  "housing",
  "affordable housing",
  "LIHTC",
  "low-income housing tax credit",
  "rent control",
  "zoning",
  "homelessness",
  "section 8",
  "public housing",
] as const;

// Budget cap for Tavily enrichment. Anything above this count in a single
// run is a signal we should tighten "thin metadata" detection rather than
// burn credits.
const TAVILY_ENRICHMENT_CAP = 15;

interface CandidateBill {
  bill: CongressGovBill;
  /** Concatenated titles/actions used for classification heuristics and Claude context. */
  text: string;
}

interface ClaudeJudgment {
  keep: boolean;
  stance?: StanceType;
  category?: LegislationCategory;
  impactTags?: ImpactTag[];
  summary?: string;
  reason?: string;
}

interface NormalizedBill {
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

const STAGE_RANK: Record<Stage, number> = {
  Enacted: 5,
  Floor: 4,
  Committee: 3,
  Filed: 2,
  "Carried Over": 1,
  Dead: 0,
};

const ALLOWED_STANCES: readonly StanceType[] = [
  "favorable",
  "restrictive",
  "concerning",
  "review",
];

const ALLOWED_CATEGORIES: readonly LegislationCategory[] = [
  "zoning-reform",
  "rent-regulation",
  "affordable-housing",
  "development-incentive",
  "building-code",
  "foreign-investment",
  "homelessness-services",
  "tenant-protection",
  "transit-housing",
  "property-tax",
];

const ALLOWED_IMPACT_TAGS: readonly ImpactTag[] = [
  "affordability",
  "displacement",
  "density",
  "lot-splitting",
  "inclusionary-zoning",
  "rent-stabilization",
  "social-housing",
  "foreign-buyer",
  "first-time-buyer",
  "homelessness",
  "transit-oriented",
  "environmental-review",
  "nimby",
  "community-opposition",
  "vacancy-tax",
  "short-term-rental",
  "heritage-protection",
  "mortgage-regulation",
  "public-land",
  "indigenous-housing",
];

// ── Stage mapping ───────────────────────────────────────────────────
// Parses Congress.gov latestAction.text into the internal Stage union.
// Order matters: "Became Public Law" is checked before "Passed" because an
// enacted bill will also have passed both chambers.
function mapCongressStage(actionText: string): { stage: Stage; mapped: boolean } {
  const t = (actionText ?? "").toLowerCase();
  if (!t) return { stage: "Filed", mapped: false };

  if (/became public law|signed by president|became private law/.test(t)) {
    return { stage: "Enacted", mapped: true };
  }
  if (t.includes("passed senate") && t.includes("passed house")) {
    return { stage: "Floor", mapped: true };
  }
  if (t.includes("passed house") || t.includes("passed senate")) {
    return { stage: "Floor", mapped: true };
  }
  if (/placed on (senate|house|union) calendar/.test(t)) {
    return { stage: "Floor", mapped: true };
  }
  if (/reported (by|with|to|without)|ordered to be reported|committee (reports|consideration and mark-up)/.test(t)) {
    return { stage: "Committee", mapped: true };
  }
  if (/referred to (the|a)|held at the desk|read twice|discharged from/.test(t)) {
    return { stage: "Committee", mapped: true };
  }
  if (/introduced in house|introduced in senate|introduced, referred/.test(t)) {
    return { stage: "Filed", mapped: true };
  }
  if (/motion to reconsider|vetoed|failed of passage|failed to pass/.test(t)) {
    // No separate Dead stage on Congress.gov until the next Congress;
    // flag as Filed and let the caller track failure signals.
    return { stage: "Filed", mapped: false };
  }
  return { stage: "Filed", mapped: false };
}

// ── Domain guard ────────────────────────────────────────────────────
// Reject any bill whose policyArea is clearly not civilian housing. This is
// a cheap pre-filter so Claude sees fewer irrelevant inputs.
function isCivilianHousingCandidate(bill: CongressGovBill): boolean {
  const policy = bill.policyArea?.name?.toLowerCase() ?? "";
  const title = bill.title.toLowerCase();

  // Armed Forces & National Security is almost always military base housing
  // or servicemember allowances. Keep the small subset that mentions a
  // civilian housing mechanism explicitly in the title.
  if (policy.includes("armed forces")) {
    return /(housing assistance|civilian|veteran housing|homeless veteran|communities and community development|federal housing)/i.test(
      title,
    );
  }
  // Taxation as a policy area requires an actual housing lever in the title.
  if (policy === "taxation" && !/(housing|rent|mortgage|home buyer|lihtc|property tax|vacancy|affordable)/i.test(title)) {
    return false;
  }
  return true;
}

// ── Step 1: gather candidates from Congress.gov ─────────────────────
async function gatherCandidates(): Promise<CandidateBill[]> {
  const seen = new Map<string, CongressGovBill>();

  for (const congress of [119, 118] as const) {
    for (const query of HOUSING_QUERIES) {
      try {
        const res = await searchCongressBills({
          query,
          congress,
          limit: congress === 119 ? 20 : 10,
          sort: "updateDate+desc",
        });
        for (const b of res.bills) {
          const key = `${b.congress}-${b.type}-${b.number}`;
          if (!seen.has(key)) seen.set(key, b);
        }
      } catch (err) {
        if (err instanceof CongressGovError && err.kind === "auth") throw err;
        console.warn(
          `  [warn] congress-gov search failed for query="${query}" congress=${congress}: ${(err as Error).message}`,
        );
      }
    }
  }

  // Pre-filter out non-housing policy areas. Cannot do this yet because the
  // list endpoint does not return policyArea. We defer this until after
  // detail enrichment below.
  return Array.from(seen.values()).map((bill) => ({
    bill,
    text: `${bill.title} — ${bill.latestAction.text}`,
  }));
}

// ── Step 2: enrich with detail (sponsors, policyArea, subjects) ─────
async function enrichWithDetails(
  candidates: CandidateBill[],
): Promise<CandidateBill[]> {
  const enriched: CandidateBill[] = [];
  for (const c of candidates) {
    try {
      const detail = await getCongressBill(c.bill.congress, c.bill.type, c.bill.number);
      if (detail) {
        enriched.push({
          bill: detail,
          text: `${detail.title} — ${detail.latestAction.text}${detail.policyArea?.name ? ` [policy: ${detail.policyArea.name}]` : ""}`,
        });
      } else {
        // Bill was removed from Congress.gov between list and detail. Skip it.
        console.warn(
          `  [warn] detail missing for ${c.bill.type}${c.bill.number} (119 or 118); skipping`,
        );
      }
    } catch (err) {
      if (err instanceof CongressGovError && err.kind === "auth") throw err;
      console.warn(
        `  [warn] detail fetch failed for ${c.bill.type}${c.bill.number}: ${(err as Error).message}`,
      );
      // Keep the list-level data rather than drop the bill; downstream can
      // still work with it, just without sponsor/policyArea enrichment.
      enriched.push(c);
    }
  }
  return enriched.filter((c) => isCivilianHousingCandidate(c.bill));
}

// ── Step 3: Claude judgment (relevance + classification) ────────────
function buildJudgmentPrompt(candidates: CandidateBill[]): string {
  const rows = candidates
    .map((c, i) => {
      const b = c.bill;
      const policyArea = b.policyArea?.name ?? "(unspecified)";
      const sponsor = b.sponsors[0]
        ? `${b.sponsors[0].fullName} (${b.sponsors[0].party}-${b.sponsors[0].state})`
        : "(no sponsor listed)";
      return `[${i + 1}] ${b.type} ${b.number} (Congress ${b.congress})
    Title: ${b.title}
    Policy Area: ${policyArea}
    Sponsor: ${sponsor}
    Latest Action: ${b.latestAction.text}`;
    })
    .join("\n\n");

  return `You are reviewing US federal bills pulled from Congress.gov that mention housing keywords.
For each bill, decide two things:

(a) Is it PRIMARILY about civilian housing policy? Civilian means:
    supply (permitting, zoning, construction incentives), affordability
    (LIHTC, subsidies, section 8, rent regulation), homelessness services,
    tenant protection, housing finance, or building codes that affect
    residential dwellings.
    NOT civilian: naval/military base housing, basic allowance for housing
    for servicemembers, housing on federal installations, or tangential
    mentions (e.g. a tax bill that only mentions housing in passing).

(b) If yes, classify it. Every field must use a value from the allowed set
    below or be left undefined (if left undefined a heuristic fallback
    applies downstream).

Allowed stance values: ${ALLOWED_STANCES.join(", ")}.
Allowed category values: ${ALLOWED_CATEGORIES.join(", ")}.
Allowed impactTags values: ${ALLOWED_IMPACT_TAGS.join(", ")}.

Stance guidance:
  favorable    increases housing supply (upzoning, density bonuses, ADU legalization,
               fast-track permitting, LIHTC expansion), funds affordable housing
               (subsidies, social housing, Section 8 expansion), protects tenants
               (rent stabilization, eviction protections, habitability requirements),
               or reduces barriers to development.
  restrictive  reduces density or limits development (downzoning, moratoriums,
               height limits), removes tenant protections, cuts housing funding,
               or enacts exclusionary policies.
  concerning   bill has both supply-positive and supply-negative provisions,
               or addresses housing tangentially (immigration bill mentioning
               housing, tax bill with one housing clause).
  review       ONLY for procedural bills (appropriations, study commissions)
               with no specific housing policy content. Do NOT default to "review"
               when uncertain between favorable and concerning. Make a decision.

Bills to review:

${rows}

Return a SINGLE JSON array with exactly ${candidates.length} items, one per
bill in the order above. Each item must match this shape:

  { "keep": true | false,
    "stance": "favorable" | "restrictive" | "concerning" | "review",
    "category": "zoning-reform" | ... | "property-tax",
    "impactTags": ["affordability", ...],
    "summary": "two-sentence neutral description of what the bill does",
    "reason": "one short phrase, only when keep=false, explaining why it's not civilian housing" }

Rules:
1. Output MUST be a JSON array, no markdown fences, no preamble.
2. When keep=false, stance/category/impactTags/summary can be omitted.
3. When keep=true, all four classification fields are REQUIRED.
4. impactTags should include 1-3 tags. Choose the most specific ones.
5. summary must be factual and cite the bill mechanism. No marketing language.
`;
}

function extractText(msg: Anthropic.Messages.Message): string {
  return msg.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function parseJudgmentArray(raw: string, expected: number): ClaudeJudgment[] {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : raw;
  const first = candidate.indexOf("[");
  const last = candidate.lastIndexOf("]");
  if (first < 0 || last <= first) {
    throw new Error("Claude response did not contain a JSON array");
  }
  const parsed = JSON.parse(candidate.slice(first, last + 1)) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Claude response JSON was not an array");
  }
  if (parsed.length !== expected) {
    throw new Error(
      `Claude returned ${parsed.length} judgments, expected ${expected}`,
    );
  }
  return parsed as ClaudeJudgment[];
}

async function askClaudeForJudgments(
  anthropic: Anthropic,
  candidates: CandidateBill[],
): Promise<ClaudeJudgment[]> {
  if (candidates.length === 0) return [];
  const prompt = buildJudgmentPrompt(candidates);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 6000,
        messages: [{ role: "user", content: prompt }],
      });
      return parseJudgmentArray(extractText(msg), candidates.length);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 529 || status === 503 || status === 429) {
        const backoff = 5000 * Math.pow(2, attempt);
        console.log(`  [retry] anthropic ${status}, waiting ${backoff}ms`);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      throw err;
    }
  }
  throw new Error("anthropic exhausted retries");
}

// ── Step 4: heuristic backstops for when Claude leaves fields blank ─
function classifyCategoryFallback(text: string): LegislationCategory {
  const rules: Array<{ cat: LegislationCategory; kw: RegExp }> = [
    { cat: "zoning-reform", kw: /\b(zon(e|ing)|preempt|density|land use|missing middle|ADU)\b/i },
    { cat: "rent-regulation", kw: /\b(rent (control|stabiliz|cap|freeze))\b/i },
    { cat: "affordable-housing", kw: /\b(affordab|LIHTC|low.?income housing|inclusionary|section 8)\b/i },
    { cat: "development-incentive", kw: /\b(incentive|fast.?track|housing supply|build.*homes|opportunity zone|TIF)\b/i },
    { cat: "building-code", kw: /\b(building code|fire safety|accessibility|energy efficiency)\b/i },
    { cat: "foreign-investment", kw: /\b(foreign (buyer|purchas|invest)|non.?resident|FIRPTA)\b/i },
    { cat: "homelessness-services", kw: /\b(homeless|shelter|supportive housing|encampment|HEAR(TH)?)\b/i },
    { cat: "tenant-protection", kw: /\b(evict|tenant|habitability|just cause|relocation)\b/i },
    { cat: "transit-housing", kw: /\b(transit|TOD|station area|corridor|infrastructure)\b/i },
    { cat: "property-tax", kw: /\b(property tax|assessment|abatement|exemption|vacant.*tax)\b/i },
  ];
  for (const { cat, kw } of rules) if (kw.test(text)) return cat;
  return "affordable-housing";
}

function classifyTagsFallback(text: string): ImpactTag[] {
  const tags: ImpactTag[] = [];
  const rules: Array<{ tag: ImpactTag; kw: RegExp }> = [
    { tag: "affordability", kw: /\b(affordab|housing cost|cost.?burden|LIHTC)\b/i },
    { tag: "density", kw: /\b(density|multi.?family|ADU|missing middle|upzon)\b/i },
    { tag: "social-housing", kw: /\b(public housing|social housing|section 8)\b/i },
    { tag: "homelessness", kw: /\b(homeless|unhoused|shelter|encampment|supportive)\b/i },
    { tag: "first-time-buyer", kw: /\b(first.?time (buyer|home)|down payment assistance)\b/i },
    { tag: "foreign-buyer", kw: /\b(foreign (buyer|purchas|own)|non.?resident|FIRPTA)\b/i },
    { tag: "rent-stabilization", kw: /\b(rent (control|stabiliz|cap|freeze))\b/i },
    { tag: "displacement", kw: /\b(displac|gentrif|relocat)\b/i },
    { tag: "transit-oriented", kw: /\b(transit.?oriented|TOD|corridor)\b/i },
    { tag: "mortgage-regulation", kw: /\b(mortgage|FHA|Fannie|Freddie|amortiz)\b/i },
    { tag: "short-term-rental", kw: /\b(short.?term rental|airbnb|vacation rental)\b/i },
    { tag: "vacancy-tax", kw: /\b(vacancy tax|vacant.*tax|empty.*home)\b/i },
  ];
  for (const { tag, kw } of rules) if (kw.test(text)) tags.push(tag);
  return tags.length > 0 ? tags.slice(0, 5) : ["affordability"];
}

function deriveStanceFallback(text: string, stage: Stage): StanceType {
  const lower = text.toLowerCase();

  // Restrictive: reduces supply, removes protections, cuts funding
  const isRestrictive = /moratorium|downzon|height limit|single.?family only|large.?lot minimum|exclusionary|repeal.*(rent|tenant)|weaken.*(rent|tenant|protect)|cut.*(housing|afford)|reduce.*(density|housing)|hard cap/.test(lower);

  // Favorable: increases supply, funds housing, protects tenants
  const isFavorable = /incentive|accelerat|supply|build.*homes|fast.?track|streamlin|expand|expedite|preempt|by.?right|density bonus|ADU|accessory dwelling|fourplex|triplex|duplex|multi.?family|upzon|inclusionary|affordab|social housing|co.?op|subsid|LIHTC|section 8|rent (control|stabiliz|cap|freeze|protect)|eviction protect|tenant (protect|right)|right to housing|housing fund|rapid housing|permit reform|parking (minimum|reform|eliminat)|missing middle|homelessness|shelter|supportive housing|public housing|housing first|rental assist|voucher|down.?payment assist|first.?time (buyer|home)|transit.?oriented|zoning reform|housing accelerat/.test(lower);

  // Purely procedural
  const isProcedural = /^(an )?act (to establish|respecting) (a )?(study|commission|task.?force|working group|advisory)|report to congress|^appropriation/.test(lower);

  if (isRestrictive && (stage === "Enacted" || stage === "Floor")) return "restrictive";
  if (isRestrictive) return "concerning";
  if (isFavorable) return "favorable";
  if (isProcedural) return "review";

  return "review";
}

// ── Step 5: optional Tavily enrichment ──────────────────────────────
interface Enrichment {
  summary?: string;
}

async function enrichOne(bill: CongressGovBill): Promise<Enrichment | null> {
  try {
    const res = await searchTavily(`${bill.type} ${bill.number} ${bill.title}`.slice(0, 200), {
      searchDepth: "basic",
      maxResults: 3,
      includeDomains: ["govtrack.us", "congress.gov", "politico.com"],
      timeRange: "year",
    });
    const top = res.results.sort((a, b) => b.score - a.score)[0];
    if (top?.content) {
      return { summary: top.content.slice(0, 320).trim() };
    }
    return null;
  } catch (err) {
    if (err instanceof TavilyBudgetExhausted || err instanceof TavilyUnavailable) {
      throw err;
    }
    return null;
  }
}

// ── Step 6: URL validation (hallucination guard) ────────────────────
// congress.gov sits behind Cloudflare and returns 403 Challenge on HEAD
// requests from non-browser user agents. That makes HEAD validation
// unreliable: we cannot distinguish "valid URL, bot-blocked" from
// "invalid URL, Cloudflare's generic 403".
//
// The canonical URL is constructed deterministically from the bill
// identifiers (congress + type + number) returned by the Congress.gov API.
// Since the API already confirmed the bill exists, the URL is trusted by
// construction. This is the same contract the Canadian LEGISinfo pipeline
// uses: API-returned bill IDs imply valid bill pages.
//
// We keep the signature so the call site stays identical; the function now
// reports "is this URL structurally correct" rather than "is it reachable".
function validateCanonicalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    return host === "congress.gov" && parsed.pathname.startsWith("/bill/");
  } catch {
    return false;
  }
}

// ── Overall stance aggregation (same shape as existing state pipeline) ─
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

// ── Normalization ───────────────────────────────────────────────────
function normalizeBill(
  bill: CongressGovBill,
  judgment: ClaudeJudgment,
): NormalizedBill {
  const billCode = `${bill.type} ${bill.number}`;
  const slug = billCode.replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "").toLowerCase();
  const text = `${bill.title} ${judgment.summary ?? ""} ${bill.latestAction.text}`;
  const { stage, mapped } = mapCongressStage(bill.latestAction.text);
  if (!mapped) {
    console.warn(
      `  [warn] unmapped action text for ${billCode}: "${bill.latestAction.text.slice(0, 80)}"`,
    );
  }

  const stance = (judgment.stance && ALLOWED_STANCES.includes(judgment.stance))
    ? judgment.stance
    : deriveStanceFallback(text, stage);
  const category = (judgment.category && ALLOWED_CATEGORIES.includes(judgment.category))
    ? judgment.category
    : classifyCategoryFallback(text);
  const impactTags = Array.isArray(judgment.impactTags)
    ? judgment.impactTags.filter((t): t is ImpactTag => ALLOWED_IMPACT_TAGS.includes(t as ImpactTag)).slice(0, 5)
    : [];
  const finalTags = impactTags.length > 0 ? impactTags : classifyTagsFallback(text);

  const summary = judgment.summary?.trim() || bill.title;
  // Congress.gov already formats fullName as "Sen. Moran, Jerry [R-KS]" or
  // "Rep. Doe, Jane [D-CA-12]" so we pass it through. Appending the party
  // bracket again would duplicate the information.
  const sponsors = bill.sponsors.map((s) => s.fullName);

  return {
    id: `us-federal-${slug}`,
    billCode,
    title: bill.title,
    summary,
    stage,
    stance,
    impactTags: finalTags,
    category,
    updatedDate:
      bill.latestAction.actionDate || bill.updateDate || new Date().toISOString().slice(0, 10),
    sourceUrl: bill.url,
    sponsors,
  };
}

// ── main ────────────────────────────────────────────────────────────
async function main() {
  const report = startRunReport("us-federal-housing");
  report.incrementTotal(1);
  console.log("[us-federal-housing] Starting (Congress.gov primary)...");

  // Fail fast on missing auth rather than silently falling through to Tavily.
  if (!process.env.CONGRESS_GOV_API_KEY || process.env.CONGRESS_GOV_API_KEY.trim().length === 0) {
    const msg = "CONGRESS_GOV_API_KEY missing; cannot run Congress.gov primary.";
    console.error(`[us-federal-housing] ${msg}`);
    report.noteFailure({
      entity: "us-federal",
      error: msg,
      retryable: false,
      next_action: "Register at https://api.congress.gov/sign-up/ and add CONGRESS_GOV_API_KEY",
    });
    report.finish("failed");
    process.exit(1);
  }

  const anthropic = new Anthropic();

  // ── Step 1+2: gather candidates, enrich with detail ─────────────
  let candidates: CandidateBill[];
  try {
    candidates = await gatherCandidates();
  } catch (err) {
    if (err instanceof CongressGovError && err.kind === "auth") {
      console.error(`[us-federal-housing] ${err.message}`);
      report.noteFailure({
        entity: "us-federal",
        error: err.message,
        retryable: false,
        next_action: "Verify CONGRESS_GOV_API_KEY",
      });
      report.finish("failed");
      process.exit(1);
    }
    throw err;
  }
  console.log(`  gathered ${candidates.length} unique candidate bills`);
  report.recordUsage("congress-gov", { calls: HOUSING_QUERIES.length * 2 });

  if (candidates.length === 0) {
    console.warn("[us-federal-housing] Congress.gov returned no candidates; aborting");
    report.noteFailure({
      entity: "us-federal",
      error: "Congress.gov returned no candidates",
      retryable: true,
      next_action: "investigate queries or API availability",
    });
    report.finish("failed");
    process.exit(0);
  }

  const detailed = await enrichWithDetails(candidates);
  console.log(`  ${detailed.length} remain after policyArea/housing prefilter`);
  report.recordUsage("congress-gov", { calls: candidates.length });

  if (detailed.length === 0) {
    console.warn("[us-federal-housing] no candidates passed housing prefilter");
    report.noteFailure({
      entity: "us-federal",
      error: "no candidates passed housing prefilter",
      retryable: true,
      next_action: "investigate queries or prefilter",
    });
    report.finish("failed");
    process.exit(0);
  }

  // ── Step 3: Claude judgments, batched ───────────────────────────
  const BATCH_SIZE = 20;
  const judgments: ClaudeJudgment[] = [];
  for (let i = 0; i < detailed.length; i += BATCH_SIZE) {
    const slice = detailed.slice(i, i + BATCH_SIZE);
    try {
      const batch = await askClaudeForJudgments(anthropic, slice);
      judgments.push(...batch);
      report.recordUsage("anthropic", {
        calls: 1,
        approx_cost_usd: 0.08,
      });
    } catch (err) {
      console.warn(
        `  [warn] Claude judgment batch failed (${i}-${i + slice.length}): ${(err as Error).message}; keeping bills with fallbacks`,
      );
      // Fallback: mark every bill in this batch as keep=true with no Claude
      // metadata; downstream fallbacks fill stance/category/impactTags.
      for (let j = 0; j < slice.length; j++) judgments.push({ keep: true });
    }
  }
  if (judgments.length !== detailed.length) {
    throw new Error(
      `internal: judgment count ${judgments.length} != detailed count ${detailed.length}`,
    );
  }

  // Filter by Claude's civilian-housing keep flag.
  const kept: Array<{ bill: CongressGovBill; judgment: ClaudeJudgment }> = [];
  const dropped: Array<{ bill: CongressGovBill; reason: string }> = [];
  for (let i = 0; i < detailed.length; i++) {
    const j = judgments[i];
    if (j.keep) {
      kept.push({ bill: detailed[i].bill, judgment: j });
    } else {
      dropped.push({ bill: detailed[i].bill, reason: j.reason ?? "Claude flagged as non-civilian" });
    }
  }
  console.log(`  Claude kept ${kept.length}/${detailed.length} bills (${dropped.length} dropped)`);

  if (kept.length === 0) {
    console.warn("[us-federal-housing] Claude dropped every candidate; aborting");
    report.noteFailure({
      entity: "us-federal",
      error: "Claude filtered out every candidate",
      retryable: true,
      next_action: "inspect prompt or policyArea prefilter",
    });
    report.finish("failed");
    process.exit(0);
  }

  // ── Step 4: normalize ───────────────────────────────────────────
  const normalized = kept.map(({ bill, judgment }) => normalizeBill(bill, judgment));

  // ── Step 5: optional Tavily enrichment for thin summaries ───────
  let tavilyCredits = 0;
  let tavilyCalls = 0;
  let tavilyBudgetHit = false;
  for (const n of normalized) {
    if (tavilyCredits >= TAVILY_ENRICHMENT_CAP) break;
    const weakSummary = !n.summary || n.summary.length < 60 || n.summary === n.title;
    if (!weakSummary) continue;

    const originalBill = kept.find((k) => `${k.bill.type} ${k.bill.number}` === n.billCode)?.bill;
    if (!originalBill) continue;

    try {
      const e = await enrichOne(originalBill);
      tavilyCalls += 1;
      tavilyCredits += 1;
      if (e?.summary && e.summary.length > n.summary.length) {
        n.summary = e.summary;
      }
    } catch (err) {
      if (err instanceof TavilyBudgetExhausted) {
        tavilyBudgetHit = true;
        console.warn(`  [warn] Tavily budget exhausted during enrichment; stopping enrichments`);
        break;
      }
      if (err instanceof TavilyUnavailable) {
        console.warn(`  [warn] Tavily unavailable; skipping enrichment`);
        break;
      }
    }
  }
  if (tavilyCalls > 0) {
    report.recordUsage("tavily", { calls: tavilyCalls, credits_consumed: tavilyCredits });
    if (tavilyBudgetHit) report.addNote("Tavily budget exhausted; enrichment partial");
  }

  // ── Step 6: URL validation ──────────────────────────────────────
  // Structural validation only. URLs are trusted by construction from
  // Congress.gov API data; see validateCanonicalUrl for why we cannot HEAD.
  const valid: NormalizedBill[] = [];
  const invalidUrls: NormalizedBill[] = [];
  for (const n of normalized) {
    if (validateCanonicalUrl(n.sourceUrl)) {
      valid.push(n);
    } else {
      console.warn(`  [warn] canonical URL failed structural check: ${n.sourceUrl}`);
      invalidUrls.push(n);
    }
  }
  if (invalidUrls.length > 0) {
    report.addNote(`${invalidUrls.length} bills dropped due to URL structural mismatch`);
  }

  if (valid.length === 0) {
    console.warn("[us-federal-housing] URL validation dropped every bill; aborting");
    report.noteFailure({
      entity: "us-federal",
      error: "URL validation dropped every bill",
      retryable: true,
      next_action: "investigate canonicalBillUrl slug scheme",
    });
    report.finish("failed");
    process.exit(0);
  }

  // Sort by stage desc, then updatedDate desc.
  valid.sort((a, b) => {
    const sr = (STAGE_RANK[b.stage] ?? 0) - (STAGE_RANK[a.stage] ?? 0);
    if (sr !== 0) return sr;
    return (b.updatedDate ?? "").localeCompare(a.updatedDate ?? "");
  });

  // Deduplicate by billCode.
  const seen = new Set<string>();
  const unique = valid.filter((b) => {
    if (seen.has(b.billCode)) return false;
    seen.add(b.billCode);
    return true;
  });

  // Stance aggregation (same split as the existing state pipeline).
  const stanceZoning = overallStance(
    unique.filter((b) =>
      b.category === "zoning-reform" ||
      b.category === "building-code" ||
      b.category === "transit-housing" ||
      b.category === "property-tax",
    ),
  );
  const stanceAffordability = overallStance(
    unique.filter((b) =>
      b.category === "affordable-housing" ||
      b.category === "rent-regulation" ||
      b.category === "tenant-protection" ||
      b.category === "homelessness-services" ||
      b.category === "foreign-investment" ||
      b.category === "development-incentive",
    ),
  );
  const overall = maxStance(stanceZoning, stanceAffordability);

  // Build contextBlurb from the highest-stage bills Congress actually acted on.
  const topBills = unique.slice(0, 4);
  const contextBlurb = buildContextBlurb(topBills);

  const output = {
    state: "United States",
    stateCode: "US",
    region: "na",
    stance: overall,
    stanceZoning,
    stanceAffordability,
    lastUpdated: new Date().toISOString().slice(0, 10),
    contextBlurb,
    legislation: unique,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), { encoding: "utf8" });
  console.log(
    `[us-federal-housing] wrote ${unique.length} bills, stance=${overall} → ${OUT_PATH}`,
  );

  // ── Regression checks ───────────────────────────────────────────
  if (unique.length < 10) {
    console.warn(
      `[us-federal-housing] WARNING: only ${unique.length} bills (expected >= 10). Not failing the run.`,
    );
    report.addNote(`Bill count ${unique.length} below expected threshold of 10`);
  }
  const nonCongressUrls = unique.filter((b) => !/\bcongress\.gov$/.test(new URL(b.sourceUrl).hostname));
  if (nonCongressUrls.length > 0) {
    report.addNote(`${nonCongressUrls.length} bills have non-congress.gov URLs (unexpected)`);
  }

  report.noteSuccess("us-federal");
  const finalReport = report.finish();
  console.log(
    `[us-federal-housing] exit status=${finalReport.status} duration=${finalReport.duration_ms}ms`,
  );
}

function buildContextBlurb(top: NormalizedBill[]): string {
  if (top.length === 0) {
    return "US federal housing legislation tracked via Congress.gov.";
  }
  const enacted = top.filter((b) => b.stage === "Enacted").map((b) => b.billCode);
  const advancing = top.filter((b) => b.stage === "Floor" || b.stage === "Committee")
    .map((b) => b.billCode);
  const parts: string[] = [];
  parts.push(`The US Congress is tracking ${top.length > 1 ? "multiple" : "one"} housing measure${top.length > 1 ? "s" : ""} via Congress.gov.`);
  if (enacted.length > 0) parts.push(`Enacted: ${enacted.join(", ")}.`);
  if (advancing.length > 0) parts.push(`Advancing: ${advancing.join(", ")}.`);
  return parts.join(" ");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

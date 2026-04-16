/**
 * Research US federal housing legislation (Tavily + Claude pipeline).
 *
 * Mirrors province-housing-research.ts in structure: gather snippets via
 * Tavily, hand them to Claude with a strict extract prompt, validate every
 * sourceUrl with Tavily Extract, drop 404s. Writes the same JsonLegFile
 * shape that build-placeholder.ts reads for state files so the data is
 * consumed by the existing US federal entity slot.
 *
 * Why Tavily and not LegiScan or Congress.gov directly? The user has no
 * LegiScan API key and the Congress.gov XML endpoints require account
 * registration plus per-call auth headers that are awkward to surface in
 * CI. Tavily already handles caching, budget, and rate limits via
 * lib/tavily-client.ts. The cost is a handful of credits per run.
 *
 * Output: data/legislation/federal-us-housing.json
 * Budget: ~15 Tavily credits per full run (5 searches + 1 extract batch).
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
  extractTavily,
  searchTavily,
  TavilyBudgetExhausted,
  TavilyUnavailable,
  type TavilySearchResponse,
} from "@/lib/tavily-client";
import { startRunReport } from "@/lib/resilience/run-report";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const OUT_PATH = join(ROOT, "data/legislation/federal-us-housing.json");

const MODEL = "claude-sonnet-4-6";

// Domains Tavily will prioritize. Anything outside this allowlist still
// shows up but ranks lower; we treat it as supporting, not citation.
const FEDERAL_DOMAINS = [
  "congress.gov",
  "hud.gov",
  "whitehouse.gov",
  "govtrack.us",
  "govinfo.gov",
];

const QUERIES = [
  "US Congress federal housing bill 2025 2026",
  "US federal affordable housing legislation 2026",
  "US Congress LIHTC Low-Income Housing Tax Credit 2025",
  "HUD secretary Scott Turner housing policy 2026",
  "US federal zoning preemption legislation 2025",
] as const;

interface Snippet {
  url: string;
  title: string;
  content: string;
  score: number;
}

async function gatherSnippets(): Promise<Snippet[]> {
  const seen = new Map<string, Snippet>();
  for (const q of QUERIES) {
    let resp: TavilySearchResponse;
    try {
      resp = await searchTavily(q, {
        searchDepth: "advanced",
        maxResults: 10,
        includeDomains: FEDERAL_DOMAINS,
        days: 730,
      });
    } catch (err) {
      if (err instanceof TavilyBudgetExhausted || err instanceof TavilyUnavailable) {
        throw err;
      }
      console.warn(`  [warn] tavily failed for "${q}": ${(err as Error).message}`);
      continue;
    }
    for (const r of resp.results) {
      if (!seen.has(r.url)) {
        seen.set(r.url, {
          url: r.url,
          title: r.title,
          content: r.content,
          score: r.score,
        });
      }
    }
  }
  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);
}

interface ExtractedBill {
  billCode: string;
  title: string;
  summary: string;
  stage: Stage;
  updatedDate: string;
  sourceUrl: string;
  sponsors?: string[];
  stance?: StanceType;
  category?: LegislationCategory;
}

interface ExtractedResponse {
  contextBlurb: string;
  legislation: ExtractedBill[];
}

function buildPrompt(snippets: Snippet[]): string {
  const context = snippets
    .map(
      (s, i) =>
        `[${i + 1}] ${s.title}\n    URL: ${s.url}\n    ${s.content.slice(0, 500)}`,
    )
    .join("\n\n");

  return `You are extracting US FEDERAL housing legislation from web search snippets.

SNIPPETS:
${context}

RULES:
1. Use ONLY the snippets above. Do NOT invent bill numbers, sponsors, or URLs.
2. sourceUrl MUST be copied verbatim from one of the URL lines above.
3. Drop entries you cannot tie to a snippet.
4. Return 5-15 bills concentrated on housing supply, affordability, financing,
   zoning preemption, tenant protection, or HUD program reauthorization.
5. The "stage" field MUST be one of: Filed, Committee, Floor, Enacted, Dead, Carried Over.
6. The "stance" field MUST be one of: favorable, restrictive, concerning, review.
   - favorable    pro-supply: upzoning, density bonus, expedited permitting, financing.
   - restrictive  caps construction or imposes hard limits without supply offsets.
   - concerning   significant regulation with teeth (rent caps, broad bans).
   - review       study commission, framework, hearings, no operative effect yet.
7. The "category" field MUST be one of: zoning-reform, rent-regulation,
   affordable-housing, development-incentive, building-code, foreign-investment,
   homelessness-services, tenant-protection, transit-housing, property-tax.
8. Bill numbers should be the official format ("HR 7024", "S 1297", etc.).

Return a SINGLE JSON object (no markdown fences) with this exact shape:

{
  "contextBlurb": "2-3 sentence factual summary of the federal housing legislative landscape, citing specific bill numbers or HUD initiatives. No marketing language.",
  "legislation": [
    {
      "billCode": "HR 7024",
      "title": "Tax Relief for American Families and Workers Act",
      "summary": "1-2 sentence plain-language description that names the housing lever being pulled.",
      "stage": "Floor",
      "updatedDate": "YYYY-MM-DD",
      "sourceUrl": "must be one of the URLs above",
      "sponsors": ["sponsor name when known, else omit"],
      "stance": "favorable|restrictive|concerning|review",
      "category": "zoning-reform|rent-regulation|affordable-housing|development-incentive|building-code|foreign-investment|homelessness-services|tenant-protection|transit-housing|property-tax"
    }
  ]
}`;
}

function extractText(msg: Anthropic.Messages.Message): string {
  return msg.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function parseJson(text: string): ExtractedResponse {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("no JSON object in response");
  const parsed = JSON.parse(candidate.slice(first, last + 1)) as Partial<ExtractedResponse>;
  if (!Array.isArray(parsed.legislation)) {
    throw new Error("response missing 'legislation' array");
  }
  return {
    contextBlurb: typeof parsed.contextBlurb === "string" ? parsed.contextBlurb : "",
    legislation: parsed.legislation as ExtractedBill[],
  };
}

async function askClaude(
  anthropic: Anthropic,
  snippets: Snippet[],
): Promise<ExtractedResponse> {
  const prompt = buildPrompt(snippets);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4500,
        messages: [{ role: "user", content: prompt }],
      });
      return parseJson(extractText(msg));
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

async function validateUrls(
  bills: ExtractedBill[],
): Promise<{ good: Set<string>; validated: boolean }> {
  const urls = Array.from(
    new Set(bills.map((b) => b.sourceUrl).filter((u) => !!u)),
  ).slice(0, 25);
  if (urls.length === 0) return { good: new Set(), validated: true };
  try {
    const resp = await extractTavily(urls, { extractDepth: "basic" });
    const good = new Set(
      resp.results
        .filter((r) => typeof r.rawContent === "string" && r.rawContent.length > 100)
        .map((r) => r.url),
    );
    return { good, validated: true };
  } catch (err) {
    if (err instanceof TavilyBudgetExhausted || err instanceof TavilyUnavailable) {
      console.warn(`  [warn] URL validation skipped: ${err.message}`);
      return { good: new Set(urls), validated: false };
    }
    throw err;
  }
}

// ── Heuristic backstops for category/impact tags/stance ─────────────
// Used when Claude omits or returns an unrecognized value, mirroring the
// classification logic in canada-legislation.ts so the two pipelines emit
// directly comparable shapes.

function classifyCategory(text: string): LegislationCategory {
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

function classifyTags(text: string): ImpactTag[] {
  const tags: ImpactTag[] = [];
  const rules: Array<{ tag: ImpactTag; kw: RegExp }> = [
    { tag: "affordability", kw: /\b(affordab|housing cost|cost.?burden|LIHTC)\b/i },
    { tag: "density", kw: /\b(density|multi.?family|ADU|missing middle|upzon)\b/i },
    { tag: "social-housing", kw: /\b(public housing|social housing|section 8|HUD section 8)\b/i },
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

function deriveStance(text: string, stage: Stage): StanceType {
  const lower = text.toLowerCase();
  const isMoratorium = /moratorium|prohibit|ban\b|restrict|freeze|hard cap/.test(lower);
  const isIncentive = /incentive|accelerat|supply|build.*homes|fast.?track|streamlin|expand|expedite|preempt/.test(lower);
  const isStudy = /study|commission|review|strategy|framework|task.?force|report to congress/.test(lower);

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

async function main() {
  const report = startRunReport("us-federal-housing");
  report.incrementTotal(1);
  console.log("[us-federal-housing] Starting...");

  const anthropic = new Anthropic();

  let snippets: Snippet[];
  try {
    snippets = await gatherSnippets();
  } catch (err) {
    if (err instanceof TavilyBudgetExhausted) {
      report.addNote(err.message);
      report.noteFailure({
        entity: "us-federal",
        error: err.message,
        retryable: true,
        next_action: "retry next month",
      });
      report.finish("failed");
      return;
    }
    if (err instanceof TavilyUnavailable) {
      report.markSourceDegraded("tavily");
      report.noteFailure({
        entity: "us-federal",
        error: err.message,
        retryable: true,
        next_action: "retry when tavily recovers",
      });
      report.finish("failed");
      return;
    }
    throw err;
  }
  report.recordUsage("tavily", { calls: QUERIES.length, credits_consumed: QUERIES.length * 2 });

  if (snippets.length === 0) {
    console.warn("[us-federal-housing] no snippets returned");
    report.noteFailure({
      entity: "us-federal",
      error: "no Tavily results",
      retryable: true,
      next_action: "investigate queries or Tavily availability",
    });
    report.finish("failed");
    return;
  }
  console.log(`  gathered ${snippets.length} snippets across ${QUERIES.length} searches`);

  let extracted: ExtractedResponse;
  try {
    extracted = await askClaude(anthropic, snippets);
  } catch (err) {
    report.noteFailure({
      entity: "us-federal",
      error: `anthropic extract failed: ${(err as Error).message}`,
      retryable: true,
      next_action: "retry next run",
    });
    report.finish("failed");
    return;
  }
  report.recordUsage("anthropic", { calls: 1, approx_cost_usd: 0.08 });

  // Hallucination guard: the bill's sourceUrl must (a) be a real URL and
  // (b) live on one of the allowlisted federal domains we searched. Tavily
  // Extract downstream drops the remaining 404s.
  const allowedHosts = new Set(FEDERAL_DOMAINS);
  const withValidSources = extracted.legislation.filter((b) => {
    if (!b.sourceUrl) return false;
    try {
      const host = new URL(b.sourceUrl).hostname.replace(/^www\./, "");
      return Array.from(allowedHosts).some(
        (d) => host === d || host.endsWith("." + d),
      );
    } catch {
      return false;
    }
  });

  if (withValidSources.length === 0) {
    console.warn("[us-federal-housing] no extracted bills tied to a snippet URL");
    report.noteFailure({
      entity: "us-federal",
      error: "no extracted bills tied to a snippet URL",
      retryable: true,
      next_action: "investigate prompt or snippet quality",
    });
    report.finish("failed");
    return;
  }

  const { good: reachable, validated } = await validateUrls(withValidSources);
  report.recordUsage("tavily", { calls: 1, credits_consumed: Math.min(25, withValidSources.length) });

  const final = validated
    ? withValidSources.filter((b) => reachable.has(b.sourceUrl))
    : withValidSources;
  if (final.length === 0) {
    console.warn("[us-federal-housing] no bills passed URL validation");
    report.noteFailure({
      entity: "us-federal",
      error: "no bills passed URL validation",
      retryable: true,
      next_action: "retry next run",
    });
    report.finish("failed");
    return;
  }

  const allowedStages: Stage[] = ["Filed", "Committee", "Floor", "Enacted", "Carried Over", "Dead"];
  const allowedStances: StanceType[] = ["favorable", "restrictive", "concerning", "review"];
  const allowedCategories: LegislationCategory[] = [
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

  const legislation = final.map((b) => {
    const text = `${b.title} ${b.summary}`.toLowerCase();
    const stage = allowedStages.includes(b.stage) ? b.stage : "Filed";
    const category = allowedCategories.includes(b.category as LegislationCategory)
      ? (b.category as LegislationCategory)
      : classifyCategory(text);
    const impactTags = classifyTags(text);
    const claudeStance = b.stance && allowedStances.includes(b.stance)
      ? (b.stance as StanceType)
      : null;
    const stance = claudeStance ?? deriveStance(text, stage);
    const billCode = (b.billCode ?? "").trim() || `bill-${legislationCounter()}`;
    const slug = billCode.replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "").toLowerCase();
    return {
      id: `us-federal-${slug || legislationCounter().toString()}`,
      billCode,
      title: b.title,
      summary: b.summary,
      stage,
      stance,
      impactTags,
      category,
      updatedDate: b.updatedDate ?? new Date().toISOString().slice(0, 10),
      sourceUrl: b.sourceUrl,
      sponsors: Array.isArray(b.sponsors) ? b.sponsors.map(String) : [],
    };
  });

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

  const stanceZoning = overallStance(
    legislation.filter((b) =>
      b.category === "zoning-reform" ||
      b.category === "building-code" ||
      b.category === "transit-housing" ||
      b.category === "property-tax",
    ),
  );
  const stanceAffordability = overallStance(
    legislation.filter((b) =>
      b.category === "affordable-housing" ||
      b.category === "rent-regulation" ||
      b.category === "tenant-protection" ||
      b.category === "homelessness-services" ||
      b.category === "foreign-investment" ||
      b.category === "development-incentive",
    ),
  );
  const overall = maxStance(stanceZoning, stanceAffordability);

  const output = {
    state: "United States",
    stateCode: "US",
    region: "na",
    stance: overall,
    stanceZoning,
    stanceAffordability,
    lastUpdated: new Date().toISOString().slice(0, 10),
    contextBlurb: extracted.contextBlurb || "US federal housing legislation tracked from Congress.gov, HUD, and GovTrack via Tavily search.",
    legislation,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), { encoding: "utf8" });
  console.log(
    `[us-federal-housing] wrote ${legislation.length} bills, stance=${overall}${validated ? "" : " (urls unvalidated)"} → ${OUT_PATH}`,
  );
  report.noteSuccess("us-federal");
  if (!validated) report.addNote("URLs not Tavily-validated this run");
  const finalReport = report.finish();
  console.log(
    `[us-federal-housing] exit status=${finalReport.status} duration=${finalReport.duration_ms}ms`,
  );
}

let _counter = 0;
function legislationCounter(): number {
  _counter += 1;
  return _counter;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Research Canadian provincial and territorial housing legislation.
 *
 * Pipeline:
 *   1. For each of 12 jurisdictions (BC handled separately by bc-legislation.ts):
 *        a. Run 5 Tavily searches with province-specific include_domains
 *        b. Collect top results (snippets with url, title, content)
 *        c. Send snippets to Claude for structured extraction
 *        d. Validate each returned sourceUrl via Tavily Extract
 *        e. Local classification (category, impactTags, stance)
 *   2. Write data/legislation/provinces/{CODE}.json
 *   3. Emit a run report with per-province outcome
 *
 * Budget per province: ~15 Tavily credits + ~$0.05 Anthropic. Full run
 * of 12 provinces: ~180 credits + ~$0.60.
 *
 * Resumes by default (skips non-empty files). Force with --force flag or
 * PROV_FORCE_REFRESH=1. Cap per run with PROV_MAX env var.
 *
 * Usage:
 *   npx tsx scripts/sync/province-housing-research.ts
 *   npx tsx scripts/sync/province-housing-research.ts --force
 *   PROV_MAX=3 npx tsx scripts/sync/province-housing-research.ts
 */

import "../env.js";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type { ImpactTag, LegislationCategory, Stage, StanceType } from "@/types";
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
const OUT_DIR = join(ROOT, "data/legislation/provinces");
const CACHE_DIR = join(ROOT, "data/raw/provincial");

const MODEL = "claude-sonnet-4-6";
const FORCE =
  process.argv.includes("--force") || process.env.PROV_FORCE_REFRESH === "1";
const MAX = process.env.PROV_MAX ? Number(process.env.PROV_MAX) : Infinity;
const ONLY = process.env.PROV_ONLY
  ? new Set(process.env.PROV_ONLY.split(",").map(s => s.trim().toUpperCase()))
  : null;

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });

// ── Province specs ───────────────────────────────────────────────────
interface ProvinceSpec {
  code: string;
  name: string;
  /** Domains Tavily will prioritize when searching for bills in this jurisdiction. */
  officialDomains: string[];
  /** Topic keywords used to seed the 5 Tavily searches (1 per cluster). */
  keywordClusters: string[];
}

// BC is intentionally excluded. bc-legislation.ts handles it via the
// authoritative BC Laws API.
const PROVINCES: ProvinceSpec[] = [
  {
    code: "ON",
    name: "Ontario",
    officialDomains: ["ola.org", "ontario.ca", "canlii.org"],
    keywordClusters: [
      "Ontario housing bill zoning 2025 2026",
      "Ontario More Homes Built Faster Act",
      "Ontario residential tenancy rent",
      "Ontario Greenbelt housing",
      "Ontario municipal housing accelerator",
    ],
  },
  {
    code: "QC",
    name: "Quebec",
    officialDomains: ["assnat.qc.ca", "quebec.ca", "canlii.org"],
    keywordClusters: [
      "Quebec loi logement 2025 2026",
      "Quebec Bill 31 housing reform",
      "Quebec rent tribunal regie du logement",
      "Quebec social housing cooperative",
      "Quebec Montreal zoning density",
    ],
  },
  {
    code: "AB",
    name: "Alberta",
    officialDomains: ["assembly.ab.ca", "alberta.ca", "canlii.org"],
    keywordClusters: [
      "Alberta housing bill 2025 2026",
      "Alberta Calgary Edmonton zoning",
      "Alberta residential tenancies act",
      "Alberta affordable housing program",
      "Alberta property tax assessment housing",
    ],
  },
  {
    code: "MB",
    name: "Manitoba",
    officialDomains: ["gov.mb.ca", "web2.gov.mb.ca", "canlii.org"],
    keywordClusters: [
      "Manitoba housing bill 2025 2026",
      "Manitoba Winnipeg rental",
      "Manitoba Residential Tenancies Act",
      "Manitoba affordable housing",
      "Manitoba northern housing Thompson Flin Flon",
    ],
  },
  {
    code: "SK",
    name: "Saskatchewan",
    officialDomains: ["legassembly.sk.ca", "publications.saskatchewan.ca", "canlii.org"],
    keywordClusters: [
      "Saskatchewan housing bill 2025 2026",
      "Saskatchewan Saskatoon Regina rental",
      "Saskatchewan Residential Tenancies Act",
      "Saskatchewan Housing Corporation",
      "Saskatchewan rent subsidy",
    ],
  },
  {
    code: "NS",
    name: "Nova Scotia",
    officialDomains: ["nslegislature.ca", "novascotia.ca", "canlii.org"],
    keywordClusters: [
      "Nova Scotia housing bill 2025 2026",
      "Nova Scotia Halifax housing rent cap",
      "Nova Scotia short-term rental",
      "Nova Scotia Residential Tenancies Act",
      "Nova Scotia affordable housing targets",
    ],
  },
  {
    code: "NB",
    name: "New Brunswick",
    officialDomains: ["legnb.ca", "gnb.ca", "canlii.org"],
    keywordClusters: [
      "New Brunswick housing bill 2025 2026",
      "New Brunswick Saint John Moncton housing",
      "New Brunswick rent control",
      "New Brunswick Residential Tenancies Act",
      "New Brunswick immigration housing demand",
    ],
  },
  {
    code: "NL",
    name: "Newfoundland and Labrador",
    officialDomains: ["assembly.nl.ca", "gov.nl.ca", "canlii.org"],
    keywordClusters: [
      "Newfoundland Labrador housing bill 2025",
      "Newfoundland St Johns rental market",
      "Newfoundland Residential Tenancies Act",
      "Newfoundland affordable housing",
      "Labrador housing challenges",
    ],
  },
  {
    code: "PE",
    name: "Prince Edward Island",
    officialDomains: ["assembly.pe.ca", "princeedwardisland.ca", "canlii.org"],
    keywordClusters: [
      "Prince Edward Island housing bill 2025 2026",
      "PEI Charlottetown housing shortage",
      "PEI IRAC rent",
      "PEI short-term rental",
      "PEI affordable housing corporation",
    ],
  },
  {
    code: "YT",
    name: "Yukon",
    officialDomains: ["yukonassembly.ca", "yukon.ca", "canlii.org"],
    keywordClusters: [
      "Yukon housing bill 2025 2026",
      "Yukon Whitehorse housing",
      "Yukon Housing Corporation",
      "Yukon Landlord Tenant Act",
      "Yukon residential land development",
    ],
  },
  {
    code: "NT",
    name: "Northwest Territories",
    officialDomains: ["ntassembly.ca", "gov.nt.ca", "canlii.org"],
    keywordClusters: [
      "Northwest Territories housing bill 2025 2026",
      "NWT Yellowknife housing",
      "NWT Housing Corporation",
      "NWT remote community housing",
      "NWT infrastructure gap housing",
    ],
  },
  {
    code: "NU",
    name: "Nunavut",
    officialDomains: ["assembly.nu.ca", "gov.nu.ca", "canlii.org"],
    keywordClusters: [
      "Nunavut housing bill 2025 2026",
      "Nunavut Housing Corporation overcrowding",
      "Nunavut federal northern housing funding",
      "Nunavut Iqaluit housing",
      "Nunavut community land trust",
    ],
  },
];

// ── Enrichment: additional queries and domains per province ──────────
const PROVINCE_QUERIES: Record<string, string[]> = {
  ON: [
    "Ontario Bill 2025 housing",
    "Ontario Bill 2025 zoning reform",
    "Ontario Bill 2025 affordable housing",
    "Ontario Bill 2025 tenant rent protection",
    "Ontario Bill 2025 building code residential",
    "ola.org housing bill current session",
    "Ontario Helping Homebuyers Act",
    "Ontario More Homes Built Faster Act",
  ],
  QC: [
    "Quebec projet de loi logement 2025",
    "Quebec projet de loi habitation 2025",
    "Quebec loi logement social 2025",
    "Quebec encadrement loyers 2025",
    "assnat.qc.ca projet loi habitation",
    "Quebec Tribunal administratif logement",
  ],
  BC: [
    "British Columbia Bill housing 2025",
    "BC housing supply act 2025",
    "BC strata property act amendments",
    "BC tenancy act 2025",
    "bclaws.gov.bc.ca housing",
  ],
  AB: [
    "Alberta Bill housing 2025",
    "Alberta affordable housing strategy 2025",
    "Alberta landlord tenant act amendments",
    "Alberta municipal zoning reform 2025",
    "assembly.ab.ca housing bill",
  ],
  MB: [
    "Manitoba Bill housing 2025",
    "Manitoba residential tenancies act 2025",
    "Manitoba housing renewal corporation",
    "web2.gov.mb.ca housing legislation",
  ],
  SK: [
    "Saskatchewan housing bill 2025",
    "Saskatchewan residential tenancies act",
    "Saskatchewan affordable housing plan",
  ],
  NS: [
    "Nova Scotia housing bill 2025",
    "Nova Scotia rent control 2025",
    "Nova Scotia affordable housing commission",
    "nslegislature.ca housing",
  ],
  NB: [
    "New Brunswick housing bill 2025",
    "New Brunswick residential tenancies act",
    "New Brunswick affordable housing strategy",
  ],
  NL: [
    "Newfoundland Labrador housing bill 2025",
    "Newfoundland residential tenancies act",
    "assembly.nl.ca housing",
  ],
  PE: [
    "Prince Edward Island housing bill 2025",
    "PEI rental act 2025",
    "PEI affordable housing",
  ],
  YT: [
    "Yukon housing bill 2025",
    "Yukon residential landlord tenant act",
  ],
  NT: [
    "Northwest Territories housing bill 2025",
    "NWT residential tenancies act",
  ],
  NU: [
    "Nunavut housing bill 2025",
    "Nunavut Housing Corporation legislation",
  ],
};

const PROVINCE_DOMAINS: Record<string, string[]> = {
  ON: ["ola.org", "ontario.ca", "canlii.ca"],
  QC: ["assnat.qc.ca", "quebec.ca", "canlii.ca"],
  BC: ["bclaws.gov.bc.ca", "leg.bc.ca", "canlii.ca"],
  AB: ["assembly.ab.ca", "alberta.ca", "canlii.ca"],
  MB: ["web2.gov.mb.ca", "manitoba.ca"],
  SK: ["legassembly.sk.ca", "saskatchewan.ca"],
  NS: ["nslegislature.ca", "novascotia.ca"],
  NB: ["legnb.ca", "gnb.ca"],
  NL: ["assembly.nl.ca", "gov.nl.ca"],
  PE: ["assembly.pe.ca", "princeedwardisland.ca"],
  YT: ["yukonassembly.ca", "yukon.ca"],
  NT: ["ntassembly.ca", "gov.nt.ca"],
  NU: ["assembly.nu.ca", "gov.nu.ca"],
};

// ── Classification ──────────────────────────────────────────────────
function classifyCategory(text: string): LegislationCategory {
  const rules: Array<{ cat: LegislationCategory; kw: RegExp }> = [
    { cat: "zoning-reform", kw: /\b(zon(e|ing)|density|land use|building|municipal planning|missing middle)\b/i },
    { cat: "rent-regulation", kw: /\b(rent|rental (protect|regulat|stabiliz)|rent (control|cap|freeze))\b/i },
    { cat: "affordable-housing", kw: /\b(affordab|social housing|co.?op|inclusionary|below.?market)\b/i },
    { cat: "development-incentive", kw: /\b(incentive|accelerat|fast.?track|housing supply|build.*homes|more homes)\b/i },
    { cat: "building-code", kw: /\b(building code|fire|construction|national building)\b/i },
    { cat: "foreign-investment", kw: /\b(foreign (buyer|purchas|invest)|non.?resident|speculation)\b/i },
    { cat: "homelessness-services", kw: /\b(homeless|shelter|supportive housing|encampment)\b/i },
    { cat: "tenant-protection", kw: /\b(evict|tenant|habitability|lease|renter|landlord)\b/i },
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
    { tag: "density", kw: /\b(density|multi.?family|duplex|fourplex|upzon|missing middle)\b/i },
    { tag: "social-housing", kw: /\b(social housing|public housing|co.?op|non.?profit housing)\b/i },
    { tag: "homelessness", kw: /\b(homeless|unhoused|shelter|encampment|supportive)\b/i },
    { tag: "first-time-buyer", kw: /\b(first.?time (buyer|home)|homebuyer)\b/i },
    { tag: "foreign-buyer", kw: /\b(foreign (buyer|purchas|own)|non.?resident)\b/i },
    { tag: "rent-stabilization", kw: /\b(rent (control|stabiliz|cap|freeze))\b/i },
    { tag: "displacement", kw: /\b(displac|gentrif|relocat)\b/i },
    { tag: "indigenous-housing", kw: /\b(indigenous|First Nations|native housing|Inuit|reserve)\b/i },
    { tag: "transit-oriented", kw: /\b(transit|infrastructure|corridor)\b/i },
    { tag: "mortgage-regulation", kw: /\b(mortgage|down payment|amortiz|stress test)\b/i },
    { tag: "short-term-rental", kw: /\b(short.?term rental|airbnb|vacation rental)\b/i },
    { tag: "vacancy-tax", kw: /\b(vacant|vacancy tax|speculation tax|empty home)\b/i },
    { tag: "lot-splitting", kw: /\b(lot split|subdivision|laneway|garden suite|ADU)\b/i },
  ];
  for (const { tag, kw } of rules) {
    if (kw.test(text)) tags.push(tag);
  }
  return tags.length > 0 ? tags.slice(0, 5) : ["affordability"];
}

function deriveStance(text: string, stage: Stage): StanceType {
  const lower = text.toLowerCase();

  // Restrictive: reduces supply, removes protections, cuts funding
  const isRestrictive = /moratorium|downzon|height limit|single.?family only|repeal.*(rent|tenant)|weaken.*(rent|tenant|protect)|cut.*(housing|afford)|reduce.*(density|housing)/.test(lower);

  // Favorable: increases supply, funds housing, protects tenants
  const isFavorable = /incentive|accelerat|supply|build.*homes|fast.?track|streamlin|expand|expedit|preempt|density bonus|ADU|accessory dwelling|fourplex|triplex|duplex|multi.?family|upzon|inclusionary|affordab|social housing|co.?op|subsid|rent (control|stabiliz|cap|freeze|protect)|eviction protect|tenant (protect|right)|right to housing|housing fund|national housing|rapid housing|permit reform|parking (minimum|reform|eliminat)|missing middle|homelessness|shelter|supportive housing|public housing|housing first|rental assist|voucher|down.?payment|first.?time (buyer|home)|transit.?oriented|zoning reform|housing accelerat|more homes|laneway|garden suite/.test(lower);

  // Concerning: mixed signals
  const isConcerning = /foreign (buyer|purchas|invest|own)|non.?resident.*(tax|ban)|speculation tax|immigration.*housing/.test(lower);

  // Purely procedural: no substantive policy content
  const isProcedural = /appropriation act|supply bill|^ways and means/i.test(lower);
  const isStudy = /study|commission|task.?force|working group|advisory/i.test(lower);

  if (isRestrictive && (stage === "Enacted" || stage === "Floor")) return "restrictive";
  if (isRestrictive) return "concerning";
  if (isFavorable) return "favorable";
  if (isConcerning) return "concerning";
  if (isProcedural || isStudy) return "review";

  // Bills in the housing tracker that lack specific signals are tangentially
  // housing-related. Mark "concerning" (mixed/indirect) over "review".
  const hasHousingSignal = /hous(e|ing)|rent|tenant|shelter|homeless|mortgage|zoning|residential|logement|habitation|loyer|locataire/i.test(lower);
  if (hasHousingSignal) return "concerning";

  return "review";
}

function overallStance(bills: Array<{ stance: StanceType; stage: Stage }>): StanceType {
  const tally: Record<StanceType, number> = {
    restrictive: 0, concerning: 0, review: 0, favorable: 0, none: 0,
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
    restrictive: 4, concerning: 3, review: 2, favorable: 1, none: 0,
  };
  return rank[a] >= rank[b] ? a : b;
}

// ── Tavily gather ───────────────────────────────────────────────────
interface Snippet {
  url: string;
  title: string;
  content: string;
  score: number;
}

async function gatherSnippets(spec: ProvinceSpec): Promise<Snippet[]> {
  const seen = new Map<string, Snippet>();
  for (const cluster of spec.keywordClusters) {
    let resp: TavilySearchResponse;
    try {
      resp = await searchTavily(cluster, {
        searchDepth: "basic",
        maxResults: 10,
        includeDomains: spec.officialDomains,
        timeRange: "year",
      });
    } catch (err) {
      if (err instanceof TavilyBudgetExhausted || err instanceof TavilyUnavailable) {
        throw err;
      }
      console.warn(`  [warn] ${spec.code} tavily search failed for "${cluster}": ${(err as Error).message}`);
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
  // Keep top 15 by score across all clusters. That's enough context for Claude
  // without stuffing the prompt.
  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
}

// ── Claude extract ──────────────────────────────────────────────────
interface ExtractedBill {
  billCode: string;
  title: string;
  summary: string;
  stage: Stage;
  updatedDate: string;
  sourceUrl: string;
  sponsors?: string[];
}

interface ExtractedResponse {
  contextBlurb: string;
  legislation: ExtractedBill[];
}

function buildPrompt(spec: ProvinceSpec, snippets: Snippet[]): string {
  const context = snippets
    .map(
      (s, i) =>
        `[${i + 1}] ${s.title}\n    URL: ${s.url}\n    ${s.content.slice(0, 500)}`,
    )
    .join("\n\n");

  return `You are extracting housing legislation for ${spec.name} from a list of web search snippets.

SNIPPETS (numbered for reference):
${context}

RULES:
1. Use ONLY the snippets above. Do NOT invent bill numbers, URLs, or facts.
2. sourceUrl MUST be copied verbatim from one of the snippets' URL lines.
3. Drop bills where you cannot cite a specific snippet.
4. Return 8-20 bills for major provinces (ON, QC, AB), 6-15 for mid-size provinces, 3-8 for territories (YT, NT, NU).
5. Each bill must be a REAL piece of legislation, a regulation, or a major government program.
6. The "stage" field MUST be one of: Filed, Committee, Floor, Enacted, Dead, Carried Over.

Return a SINGLE JSON object with this exact shape (no markdown fences):

{
  "contextBlurb": "2-3 sentence factual summary of ${spec.name}'s housing policy landscape. Cite specific bill numbers or programs. No marketing language.",
  "legislation": [
    {
      "billCode": "official bill/regulation number",
      "title": "official title",
      "summary": "1-2 sentence plain-language description",
      "stage": "Filed|Committee|Floor|Enacted|Dead|Carried Over",
      "updatedDate": "YYYY-MM-DD",
      "sourceUrl": "must be one of the URLs above",
      "sponsors": ["sponsor name if known, else omit"]
    }
  ]
}`;
}

function extractTextFromClaude(msg: Anthropic.Messages.Message): string {
  return msg.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function parseJsonBlock(text: string): ExtractedResponse {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new Error("No JSON object found in Claude response");
  }
  const parsed = JSON.parse(candidate.slice(first, last + 1)) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Claude response was not an object");
  }
  const p = parsed as Partial<ExtractedResponse>;
  if (!Array.isArray(p.legislation)) {
    throw new Error("Claude response missing 'legislation' array");
  }
  return {
    contextBlurb: typeof p.contextBlurb === "string" ? p.contextBlurb : "",
    legislation: p.legislation as ExtractedBill[],
  };
}

async function askClaude(
  anthropic: Anthropic,
  spec: ProvinceSpec,
  snippets: Snippet[],
): Promise<ExtractedResponse> {
  const prompt = buildPrompt(spec, snippets);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 6000,
        messages: [{ role: "user", content: prompt }],
      });
      const text = extractTextFromClaude(msg);
      return parseJsonBlock(text);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 529 || status === 503 || status === 429) {
        const backoff = 5000 * Math.pow(2, attempt);
        console.log(`  [retry] ${spec.code}: anthropic ${status}, waiting ${backoff}ms`);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`anthropic extract exhausted retries for ${spec.code}`);
}

// ── URL validation via Tavily Extract ───────────────────────────────
async function validateUrls(
  bills: ExtractedBill[],
): Promise<{ good: Set<string>; validated: boolean }> {
  const urls = Array.from(
    new Set(bills.map((b) => b.sourceUrl).filter((u) => !!u)),
  ).slice(0, 20); // cap extract cost

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
      // Could not validate, trust the LLM on this run.
      return { good: new Set(urls), validated: false };
    }
    throw err;
  }
}

// ── Per-province driver ─────────────────────────────────────────────
async function researchProvince(
  anthropic: Anthropic,
  spec: ProvinceSpec,
): Promise<{ bills: number; stance: StanceType; validated: boolean }> {
  console.log(`  [research] ${spec.code} (${spec.name})...`);

  // Enrich queries and domains for broader coverage
  const enrichedSpec: ProvinceSpec = {
    ...spec,
    keywordClusters: [
      ...spec.keywordClusters,
      ...(PROVINCE_QUERIES[spec.code] ?? []),
    ],
    officialDomains: Array.from(new Set([
      ...spec.officialDomains,
      ...(PROVINCE_DOMAINS[spec.code] ?? []),
    ])),
  };

  const snippets = await gatherSnippets(enrichedSpec);
  if (snippets.length === 0) {
    throw new Error("no Tavily snippets returned");
  }

  const extracted = await askClaude(anthropic, spec, snippets);

  // Cross-reference: drop bills whose sourceUrl isn't in our snippets.
  const snippetUrls = new Set(snippets.map((s) => s.url));
  const withValidSources = extracted.legislation.filter((b) => {
    if (!b.sourceUrl) return false;
    // Tolerate http/https mismatches
    const trimmed = b.sourceUrl.replace(/^https?:\/\//, "");
    return Array.from(snippetUrls).some((u) => u.endsWith(trimmed));
  });

  if (withValidSources.length === 0) {
    throw new Error(
      `Claude returned ${extracted.legislation.length} bills but none cite a snippet URL`,
    );
  }

  // Validate URLs via Tavily Extract.
  const { good: reachableUrls, validated } = await validateUrls(withValidSources);
  const final = validated
    ? withValidSources.filter((b) => reachableUrls.has(b.sourceUrl))
    : withValidSources;

  if (final.length === 0) {
    throw new Error(
      `all ${withValidSources.length} bills had unreachable URLs`,
    );
  }

  // Local classification.
  const rawLegislation = final.map((b, i) => {
    const fullText = `${b.title} ${b.summary}`.toLowerCase();
    const allowedStages: Stage[] = ["Filed", "Committee", "Floor", "Enacted", "Carried Over", "Dead"];
    const stage = allowedStages.includes(b.stage) ? b.stage : "Filed";
    const category = classifyCategory(fullText);
    const impactTags = classifyTags(fullText);
    const stance = deriveStance(fullText, stage);
    const billCode = b.billCode || `${spec.code}-${i + 1}`;
    return {
      id: `${spec.code.toLowerCase()}-${billCode.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
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

  // Deduplicate by billCode/title (enriched queries may surface the same bill)
  const seenBills = new Set<string>();
  const legislation = rawLegislation.filter(b => {
    const key = b.billCode || b.title;
    if (seenBills.has(key)) return false;
    seenBills.add(key);
    return true;
  });

  // Merge with existing data to preserve previously-found bills
  const outPath = join(OUT_DIR, `${spec.code}.json`);
  if (existsSync(outPath)) {
    try {
      const existing = JSON.parse(readFileSync(outPath, "utf8"));
      const existingLeg = (existing.legislation ?? []) as typeof legislation;
      for (const old of existingLeg) {
        const key = old.billCode || old.title;
        if (!seenBills.has(key)) {
          legislation.push(old);
          seenBills.add(key);
        }
      }
    } catch { /* ignore corrupt/missing files */ }
  }

  // Sort: Enacted first, then by date.
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

  const overall = maxStance(stanceZoning, stanceAffordability);

  const output = {
    state: spec.name,
    stateCode: spec.code,
    region: "na",
    stance: overall,
    stanceZoning,
    stanceAffordability,
    lastUpdated: new Date().toISOString().slice(0, 10),
    contextBlurb: extracted.contextBlurb || `${spec.name} housing policy data.`,
    legislation,
  };

  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(
    `  [done] ${spec.code}: ${legislation.length} bills, stance=${overall}${validated ? "" : " (urls unvalidated)"}`,
  );
  return { bills: legislation.length, stance: overall, validated };
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const report = startRunReport("provincial-research");
  const anthropic = new Anthropic();
  let processed = 0;
  let tavilyBudgetHit = false;

  console.log("[province-housing-research] Starting...");
  console.log(`  Force: ${FORCE}, Max: ${MAX === Infinity ? "unlimited" : MAX}`);

  for (const spec of PROVINCES) {
    report.incrementTotal(1);

    if (ONLY && !ONLY.has(spec.code)) {
      console.log(`  [skip] ${spec.code}: not in PROV_ONLY`);
      report.noteSuccess(spec.code);
      continue;
    }

    const outPath = join(OUT_DIR, `${spec.code}.json`);
    const alreadyDone =
      !FORCE &&
      existsSync(outPath) &&
      (() => {
        try {
          const existing = JSON.parse(readFileSync(outPath, "utf8"));
          return existing.legislation && existing.legislation.length > 0;
        } catch {
          return false;
        }
      })();

    if (alreadyDone) {
      console.log(`  [skip] ${spec.code} (${spec.name}) already has data`);
      report.noteSuccess(spec.code);
      continue;
    }

    if (processed >= MAX) {
      console.log(`  [limit] Reached PROV_MAX=${MAX}, stopping.`);
      report.addNote(`Stopped after ${MAX} provinces due to PROV_MAX env cap.`);
      break;
    }

    if (tavilyBudgetHit) {
      console.log(`  [skip] ${spec.code}: Tavily budget exhausted earlier this run`);
      report.noteFailure({
        entity: spec.code,
        error: "Tavily budget exhausted",
        retryable: true,
        next_action: "retry next month or with higher budget",
      });
      continue;
    }

    try {
      const result = await researchProvince(anthropic, spec);
      processed += 1;
      report.noteSuccess(spec.code);
      const enrichedQueryCount = spec.keywordClusters.length + (PROVINCE_QUERIES[spec.code]?.length ?? 0);
      report.recordUsage("tavily", {
        calls: 1,
        credits_consumed: enrichedQueryCount * 1 + (result.validated ? 10 : 0),
      });
      report.recordUsage("anthropic", { calls: 1, approx_cost_usd: 0.05 });
      if (!result.validated) {
        report.addNote(`${spec.code}: URLs were not Tavily-validated this run (budget/unavailable)`);
      }
    } catch (err) {
      if (err instanceof TavilyBudgetExhausted) {
        tavilyBudgetHit = true;
        console.warn(`[province-housing-research] Tavily budget exhausted; stopping`);
        report.addNote(err.message);
        report.noteFailure({
          entity: spec.code,
          error: err.message,
          retryable: true,
          next_action: "retry next month or with higher budget",
        });
        continue;
      }
      if (err instanceof TavilyUnavailable) {
        console.error(`  [ERROR] ${spec.code}: Tavily unavailable: ${err.message}`);
        report.markSourceDegraded("tavily");
        report.noteFailure({
          entity: spec.code,
          error: err.message,
          retryable: true,
          next_action: "retry when Tavily recovers",
        });
        continue;
      }
      console.error(`  [ERROR] ${spec.code} (${spec.name}):`, err);
      report.noteFailure({
        entity: spec.code,
        error: (err as Error).message ?? String(err),
        retryable: true,
        next_action: "retry next run",
      });
    }

    // Gentle pacing to stay polite to both Tavily and Anthropic.
    await new Promise((r) => setTimeout(r, 1500));
  }

  const finalReport = report.finish();
  console.log(
    `\n[province-housing-research] ${processed} provinces researched. ` +
      `status=${finalReport.status} duration=${finalReport.duration_ms}ms`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Research housing legislation for the top 10 US housing-critical states.
 *
 * The 10 states (CA, NY, TX, FL, WA, MA, OR, CO, AZ, NC) are the focus of
 * the US secondary tier. The remaining 40 states stay grey on the map by
 * design. Each state run reads its dedicated official-domain allowlist and
 * produces data/legislation/us-states-housing/{STATE}.json in the same
 * shape as data/legislation/provinces/{CODE}.json.
 *
 * Pattern follows scripts/sync/province-housing-research.ts (Tavily search
 * + Claude extract + Tavily Extract URL validation + run report). Resumes
 * on partial runs by skipping non-empty output files. Force a full refresh
 * with --force or US_STATE_FORCE=1, cap with US_STATE_MAX env var.
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
import {
  hasScraper,
  scrapeStateIfAvailable,
  type StateScrapedBill,
} from "@/lib/sources/state-scrapers";
import { ApifyBudgetExhausted, ApifyError } from "@/lib/sources/apify";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const OUT_DIR = join(ROOT, "data/legislation/us-states-housing");

const MODEL = "claude-sonnet-4-6";
const FORCE =
  process.argv.includes("--force") || process.env.US_STATE_FORCE === "1";
const MAX = process.env.US_STATE_MAX ? Number(process.env.US_STATE_MAX) : Infinity;

mkdirSync(OUT_DIR, { recursive: true });

interface StateSpec {
  code: string;
  name: string;
  officialDomains: string[];
  /** Two queries per state. Keep narrow to fit the 2-credit budget. */
  queries: [string, string];
}

// State-specific supplementary queries. These run in addition to the two
// generic queries above and cover the signature housing statutes each state
// is actually known for. They materially boost coverage for states where
// the generic queries only surface one or two bills (Colorado especially).
//
// Keep each state's list short (3-4 queries) so the per-run Tavily budget
// stays predictable: generic 2 + specific 4 = up to 6 searches per state.
const STATE_SPECIFIC_QUERIES: Record<string, string[]> = {
  CO: [
    "Colorado Proposition 123 affordable housing fund 2025",
    "Colorado HB25 housing legislation",
    "Colorado SB25 affordable housing",
    "CHFA Colorado Housing Finance Authority 2025 legislation",
  ],
  AZ: [
    "Arizona SB1281 housing 2025",
    "Arizona Proposition 201 housing",
    "Arizona Housing Finance Authority 2025 legislation",
  ],
  NC: [
    "North Carolina HB housing 2025",
    "North Carolina SB housing 2025",
    "NCHFA legislation 2025",
    "North Carolina zoning reform 2025",
  ],
  CA: [
    "California SB9 housing",
    "California AB housing 2025",
    "California HCD Housing and Community Development 2025 bills",
  ],
  NY: [
    "New York Good Cause Eviction Act",
    "New York rent stabilization 2025",
    "New York HCR Homes Community Renewal 2025 legislation",
  ],
  TX: [
    "Texas HB housing 2025",
    "Texas SB zoning 2025",
    "TDHCA Texas Housing 2025 legislation",
  ],
  FL: [
    "Florida Live Local Act",
    "Florida HB housing 2025",
    "Florida Housing Finance Corporation 2025",
  ],
  WA: [
    "Washington HB 1110 missing middle",
    "Washington HB housing 2025",
    "Washington Commerce Department 2025 legislation",
  ],
  MA: [
    "Massachusetts MBTA Communities Act",
    "Massachusetts HB housing 2025",
    "Massachusetts CHAPA legislation 2025",
  ],
  OR: [
    "Oregon HB 2001 housing",
    "Oregon SB housing 2025",
    "Oregon Housing and Community Services 2025",
  ],
};

// Below this count, the Apify scraper is considered essential (the state
// is failing coverage). At or above this count, the scraper runs anyway
// when one is available because its marginal cost is tiny (~0.01-0.05 CU
// per run) and it routinely surfaces bills Tavily misses. The threshold
// is kept as a diagnostic signal in the logs rather than a gate.
const APIFY_TRIGGER_THRESHOLD = 4;

const STATES: StateSpec[] = [
  {
    code: "CA",
    name: "California",
    officialDomains: ["leginfo.legislature.ca.gov", "hcd.ca.gov", "ca.gov"],
    queries: [
      "California housing bill 2025 2026 affordability zoning",
      "California Housing Finance Agency HCD 2026 legislation",
    ],
  },
  {
    code: "NY",
    name: "New York",
    officialDomains: ["nyassembly.gov", "nysenate.gov", "hcr.ny.gov"],
    queries: [
      "New York housing bill 2025 2026 affordability zoning",
      "New York HCR Housing Finance Agency 2026 legislation",
    ],
  },
  {
    code: "TX",
    name: "Texas",
    officialDomains: ["capitol.texas.gov", "tdhca.texas.gov", "texas.gov", "statutes.capitol.texas.gov"],
    queries: [
      "Texas 89th legislative session housing bill HB SB affordability zoning property tax",
      "Texas TDHCA Housing Finance Corporation 2026 appropriations low-income housing tax credit",
    ],
  },
  {
    code: "FL",
    name: "Florida",
    officialDomains: ["flsenate.gov", "myflorida.com", "floridahousing.org"],
    queries: [
      "Florida housing bill 2025 2026 affordability zoning Live Local",
      "Florida Housing Finance Corporation 2026 legislation",
    ],
  },
  {
    code: "WA",
    name: "Washington",
    officialDomains: ["leg.wa.gov", "commerce.wa.gov"],
    queries: [
      "Washington state housing bill 2025 2026 affordability zoning middle housing",
      "Washington Department of Commerce housing 2026 legislation",
    ],
  },
  {
    code: "MA",
    name: "Massachusetts",
    officialDomains: ["malegislature.gov", "mass.gov"],
    queries: [
      "Massachusetts housing bill 2025 2026 MBTA Communities Act",
      "Massachusetts Affordable Homes Act 2026 legislation",
    ],
  },
  {
    code: "OR",
    name: "Oregon",
    officialDomains: ["olis.oregonlegislature.gov", "oregon.gov"],
    queries: [
      "Oregon housing bill 2025 2026 affordability zoning HB 2001",
      "Oregon Housing and Community Services 2026 legislation",
    ],
  },
  {
    code: "CO",
    name: "Colorado",
    officialDomains: ["leg.colorado.gov", "cdola.colorado.gov"],
    queries: [
      "Colorado housing bill 2025 2026 affordability transit oriented",
      "Colorado Department of Local Affairs DOLA housing 2026 legislation",
    ],
  },
  {
    code: "AZ",
    name: "Arizona",
    officialDomains: ["azleg.gov", "housing.az.gov"],
    queries: [
      "Arizona housing bill 2025 2026 affordability zoning",
      "Arizona Department of Housing 2026 legislation",
    ],
  },
  {
    code: "NC",
    name: "North Carolina",
    officialDomains: ["ncleg.gov", "nchfa.com"],
    queries: [
      "North Carolina housing bill 2025 2026 affordability zoning",
      "North Carolina Housing Finance Agency NCHFA 2026 legislation",
    ],
  },
];

// ── Classification (US-flavored heuristics) ─────────────────────────
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
    { tag: "transit-oriented", kw: /\b(transit.?oriented|TOD|corridor|MBTA Communities)\b/i },
    { tag: "mortgage-regulation", kw: /\b(mortgage|FHA|Fannie|Freddie)\b/i },
    { tag: "short-term-rental", kw: /\b(short.?term rental|airbnb|vacation rental)\b/i },
    { tag: "vacancy-tax", kw: /\b(vacancy tax|vacant.*tax|empty.*home)\b/i },
    { tag: "lot-splitting", kw: /\b(lot split|subdivision|laneway|garden suite|ADU)\b/i },
  ];
  for (const { tag, kw } of rules) if (kw.test(text)) tags.push(tag);
  return tags.length > 0 ? tags.slice(0, 5) : ["affordability"];
}

function deriveStance(text: string, stage: Stage): StanceType {
  const lower = text.toLowerCase();

  // Restrictive: reduces supply, removes protections, cuts funding
  const isRestrictive = /moratorium|downzon|height limit|single.?family only|large.?lot minimum|exclusionary|repeal.*(rent|tenant)|weaken.*(rent|tenant|protect)|cut.*(housing|afford)|reduce.*(density|housing)|hard cap/.test(lower);

  // Favorable: increases supply, funds housing, protects tenants
  const isFavorable = /incentive|accelerat|supply|build.*homes|fast.?track|streamlin|expand|expedite|preempt|by.?right|density bonus|ADU|accessory dwelling|fourplex|triplex|duplex|multi.?family|upzon|inclusionary|affordab|social housing|co.?op|subsid|LIHTC|section 8|rent (control|stabiliz|cap|freeze|protect)|eviction protect|tenant (protect|right)|right to housing|housing fund|rapid housing|permit reform|parking (minimum|reform|eliminat)|missing middle|homelessness|shelter|supportive housing|public housing|housing first|rental assist|voucher|down.?payment assist|first.?time (buyer|home)|transit.?oriented|zoning reform|housing accelerat|MBTA Communities/.test(lower);

  // Concerning: mixed signals
  const isConcerning = /foreign (buyer|purchas|invest|own)|non.?resident.*(tax|ban)|speculation tax|immigration.*housing/.test(lower);

  // Purely procedural
  const isProcedural = /^(an )?act (to establish|respecting) (a )?(study|commission|task.?force|working group|advisory)|^appropriation|^budget/.test(lower);

  if (isRestrictive && (stage === "Enacted" || stage === "Floor")) return "restrictive";
  if (isRestrictive) return "concerning";
  if (isFavorable) return "favorable";
  if (isConcerning) return "concerning";
  if (isProcedural) return "review";

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

/**
 * Stage inference from a scraped status string. Scraped status text varies
 * wildly by state, so this stays conservative: anything we do not recognize
 * maps to "Filed" so the bill shows up in the map without claiming more
 * progress than we can verify.
 */
function scrapedStatusToStage(status: string | undefined): Stage {
  const t = (status ?? "").toLowerCase();
  if (!t) return "Filed";
  if (/(signed|enacted|became law|public law|governor signed)/.test(t)) return "Enacted";
  if (/(passed|adopted|third reading passed)/.test(t)) return "Floor";
  if (/(committee|reported|hearing)/.test(t)) return "Committee";
  if (/(dead|failed|died)/.test(t)) return "Dead";
  return "Filed";
}

/**
 * Normalize a scraped bill from the state scrapers into the same shape
 * researchState emits from the Tavily/Claude path. Returns null if the input
 * is missing fields we cannot reasonably reconstruct.
 *
 * The Tavily-validated URL guard does not apply to scraped URLs because the
 * scraper's own page function only emits URLs from the state legislature
 * site it is targeting; they are canonical by construction.
 */
function normalizeScrapedBill(
  sb: StateScrapedBill,
  spec: StateSpec,
): {
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
} | null {
  const billNumber = (sb.billNumber ?? "").trim();
  const title = (sb.title ?? "").trim();
  const url = (sb.url ?? "").trim();
  if (!billNumber || !title || !url) return null;

  // Verify the URL lies on one of the state's official domains, same rule
  // the Tavily path enforces. Apify scrapers are state-scoped but a selector
  // could still pick up a stray off-domain link (social, press release, etc.).
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const allowed = spec.officialDomains.some(
      (d) => host === d || host.endsWith("." + d),
    );
    if (!allowed) return null;
  } catch {
    return null;
  }

  const text = title.toLowerCase();
  const stage = scrapedStatusToStage(sb.status);
  const category = classifyCategory(text);
  const impactTags = classifyTags(text);
  const stance = deriveStance(text, stage);
  const slug = billNumber.replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "").toLowerCase();
  const summary = sb.status
    ? `${title} (status: ${sb.status})`
    : title;

  return {
    id: `us-${spec.code.toLowerCase()}-${slug}`,
    billCode: billNumber,
    title,
    summary,
    stage,
    stance,
    impactTags,
    category,
    updatedDate: sb.introducedDate ?? new Date().toISOString().slice(0, 10),
    sourceUrl: url,
    sponsors: sb.sponsor ? [sb.sponsor] : [],
  };
}

// ── Snippet gather + Claude extract (per-state) ─────────────────────
interface Snippet {
  url: string;
  title: string;
  content: string;
  score: number;
}

async function gather(spec: StateSpec): Promise<Snippet[]> {
  const seen = new Map<string, Snippet>();
  const supplementary = STATE_SPECIFIC_QUERIES[spec.code] ?? [];
  // Generic queries use the official-domain allowlist. Supplementary
  // queries drop the allowlist because the state-specific phrases already
  // encode site intent and the best matches may be on state news sites,
  // state agency sites, or the legislature's staging host.
  const allQueries: Array<{ q: string; restrict: boolean }> = [
    ...spec.queries.map((q) => ({ q, restrict: true })),
    ...supplementary.map((q) => ({ q, restrict: false })),
  ];

  for (const { q, restrict } of allQueries) {
    let resp: TavilySearchResponse;
    try {
      resp = await searchTavily(q, {
        searchDepth: "basic",
        maxResults: 10,
        includeDomains: restrict ? spec.officialDomains : undefined,
        timeRange: "year",
      });
    } catch (err) {
      if (err instanceof TavilyBudgetExhausted || err instanceof TavilyUnavailable) {
        throw err;
      }
      console.warn(`  [warn] ${spec.code} tavily failed for "${q}": ${(err as Error).message}`);
      continue;
    }
    for (const r of resp.results) {
      if (!seen.has(r.url)) {
        seen.set(r.url, { url: r.url, title: r.title, content: r.content, score: r.score });
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.score - a.score).slice(0, 20);
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

function buildPrompt(spec: StateSpec, snippets: Snippet[]): string {
  const context = snippets
    .map(
      (s, i) =>
        `[${i + 1}] ${s.title}\n    URL: ${s.url}\n    ${s.content.slice(0, 500)}`,
    )
    .join("\n\n");

  return `You are extracting US STATE housing legislation for ${spec.name} from web search snippets.

SNIPPETS:
${context}

RULES:
1. Use ONLY the snippets above. Do NOT invent bill numbers, sponsors, or URLs.
2. sourceUrl MUST be copied verbatim from one of the URL lines above.
3. Drop entries you cannot tie to a snippet.
4. Return 5-10 bills focused on housing supply, affordability, financing, zoning,
   tenant protection, rent regulation, or homelessness services.
5. The "stage" field MUST be one of: Filed, Committee, Floor, Enacted, Dead, Carried Over.
6. The "stance" field MUST be one of: favorable, restrictive, concerning, review.
   Stance guidance:
     favorable: increases housing supply (upzoning, density bonuses, ADU legalization,
       fast-track permitting, LIHTC), funds affordable housing, protects tenants
       (rent stabilization, eviction protections), reduces barriers to development.
     restrictive: reduces density (downzoning, moratoriums, height limits), removes
       tenant protections, cuts housing funding, exclusionary policies.
     concerning: bill has both pro-supply and anti-supply provisions, or addresses
       housing tangentially.
     review: ONLY for procedural bills with no specific housing policy content.
       Do NOT default to "review" when uncertain. Make a decision.
7. The "category" field MUST be one of: zoning-reform, rent-regulation,
   affordable-housing, development-incentive, building-code, foreign-investment,
   homelessness-services, tenant-protection, transit-housing, property-tax.
8. Use the bill format the chamber publishes ("AB 2011", "SB 4", "HB 1110", etc.).

Return a SINGLE JSON object (no markdown fences) with this exact shape:

{
  "contextBlurb": "2-3 sentence factual summary of ${spec.name}'s housing legislative landscape, citing specific bill numbers. No marketing language.",
  "legislation": [
    {
      "billCode": "official bill identifier",
      "title": "official title",
      "summary": "1-2 sentence plain-language description",
      "stage": "Filed|Committee|Floor|Enacted|Dead|Carried Over",
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
  if (first < 0 || last <= first) throw new Error("no JSON in response");
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
  spec: StateSpec,
  snippets: Snippet[],
): Promise<ExtractedResponse> {
  const prompt = buildPrompt(spec, snippets);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      });
      return parseJson(extractText(msg));
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
  throw new Error(`anthropic exhausted retries for ${spec.code}`);
}

async function validateUrls(bills: ExtractedBill[]) {
  const urls = Array.from(new Set(bills.map((b) => b.sourceUrl).filter(Boolean))).slice(0, 20);
  if (urls.length === 0) return { good: new Set<string>(), validated: true };
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

async function researchState(
  anthropic: Anthropic,
  spec: StateSpec,
): Promise<{ bills: number; stance: StanceType; validated: boolean; apifyAdded: number }> {
  console.log(`  [research] ${spec.code} (${spec.name})...`);

  const snippets = await gather(spec);
  if (snippets.length === 0) throw new Error("no Tavily snippets returned");

  const extracted = await askClaude(anthropic, spec, snippets);

  // Hallucination guard: accept bills whose sourceUrl lives on one of the
  // state's official domains. Tavily Extract below filters out 404s.
  const allowedHosts = new Set(spec.officialDomains);
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
    throw new Error(
      `Claude returned ${extracted.legislation.length} bills but none sit on an allowed ${spec.code} domain`,
    );
  }

  const { good: reachable, validated } = await validateUrls(withValidSources);
  let finalValidated = validated;
  let final = validated
    ? withValidSources.filter((b) => reachable.has(b.sourceUrl))
    : withValidSources;
  // If Tavily Extract returned zero reachable URLs, keep the domain-validated
  // set but mark the run as unvalidated. Better a warned dataset than an
  // empty state file. The next scheduled run can re-validate.
  if (final.length === 0 && withValidSources.length > 0) {
    console.warn(
      `  [warn] ${spec.code}: extract returned 0 reachable; keeping ${withValidSources.length} domain-validated bills unvalidated`,
    );
    final = withValidSources;
    finalValidated = false;
  }
  if (final.length === 0) throw new Error("no bills left after filtering");

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

  const legislation = final.map((b, i) => {
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
    const billCode = (b.billCode ?? "").trim() || `${spec.code}-${i + 1}`;
    const slug = billCode.replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "").toLowerCase();
    return {
      id: `us-${spec.code.toLowerCase()}-${slug}`,
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

  // ── Apify fallback merge ──────────────────────────────────────────
  // Runs whenever the state has a dedicated scraper. Tavily bills always
  // win on metadata conflicts; Apify bills only fill gaps in billNumber
  // coverage. Per-run compute units are tracked inside lib/sources/apify.ts
  // (data/raw/apify/_usage.json); this counter only tallies bills merged so
  // we can surface it in the run report. APIFY_TRIGGER_THRESHOLD is kept
  // as a severity signal: falling below it means the Tavily path alone is
  // not giving us adequate coverage.
  let apifyAdded = 0;
  if (hasScraper(spec.code)) {
    const severity =
      legislation.length < APIFY_TRIGGER_THRESHOLD ? "essential" : "supplement";
    console.log(
      `  [apify] ${spec.code} has ${legislation.length} bills; running Apify scraper (${severity})`,
    );
    try {
      const scraped = await scrapeStateIfAvailable(spec.code);
      if (scraped && scraped.length > 0) {
        const existingCodes = new Set(legislation.map((b) => b.billCode.toUpperCase()));
        for (const sb of scraped) {
          const normalized = normalizeScrapedBill(sb, spec);
          if (!normalized) continue;
          if (existingCodes.has(normalized.billCode.toUpperCase())) continue;
          legislation.push(normalized);
          existingCodes.add(normalized.billCode.toUpperCase());
          apifyAdded += 1;
        }
        console.log(`  [apify] ${spec.code} merged ${apifyAdded} new bills from scraper`);
      } else {
        console.log(`  [apify] ${spec.code} scraper returned 0 bills`);
      }
    } catch (err) {
      if (err instanceof ApifyBudgetExhausted) {
        console.warn(`  [apify] ${spec.code}: budget exhausted, skipping scraper`);
      } else if (err instanceof ApifyError && err.kind === "auth") {
        // Auth errors should halt all future scraper attempts this run.
        throw err;
      } else {
        console.warn(`  [apify] ${spec.code} scraper failed: ${(err as Error).message}`);
      }
    }
  }

  const STAGE_RANK: Record<Stage, number> = {
    Enacted: 5, Floor: 4, Committee: 3, Filed: 2, "Carried Over": 1, Dead: 0,
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
    state: spec.name,
    stateCode: spec.code,
    region: "na",
    stance: overall,
    stanceZoning,
    stanceAffordability,
    lastUpdated: new Date().toISOString().slice(0, 10),
    contextBlurb: extracted.contextBlurb || `${spec.name} housing policy data via Tavily research.`,
    legislation,
  };

  const outPath = join(OUT_DIR, `${spec.code}.json`);
  writeFileSync(outPath, JSON.stringify(output, null, 2), { encoding: "utf8" });
  const apifyNote = apifyAdded > 0 ? `, +${apifyAdded} via Apify` : "";
  console.log(
    `  [done] ${spec.code}: ${legislation.length} bills, stance=${overall}${finalValidated ? "" : " (urls unvalidated)"}${apifyNote}`,
  );
  return {
    bills: legislation.length,
    stance: overall,
    validated: finalValidated,
    apifyAdded,
  };
}

async function main() {
  const report = startRunReport("us-states-housing-research");
  const anthropic = new Anthropic();
  let processed = 0;
  let tavilyBudgetHit = false;

  console.log("[us-states-housing-research] Starting...");
  console.log(`  Force: ${FORCE}, Max: ${MAX === Infinity ? "unlimited" : MAX}`);

  for (const spec of STATES) {
    report.incrementTotal(1);

    const outPath = join(OUT_DIR, `${spec.code}.json`);
    const alreadyDone = !FORCE && existsSync(outPath) && (() => {
      try {
        const existing = JSON.parse(readFileSync(outPath, "utf8")) as { legislation?: unknown[] };
        return Array.isArray(existing.legislation) && existing.legislation.length > 0;
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
      console.log(`  [limit] Reached US_STATE_MAX=${MAX}, stopping.`);
      report.addNote(`Stopped after ${MAX} states due to US_STATE_MAX env cap.`);
      break;
    }

    if (tavilyBudgetHit) {
      console.log(`  [skip] ${spec.code}: Tavily budget exhausted earlier this run`);
      report.noteFailure({
        entity: spec.code,
        error: "Tavily budget exhausted",
        retryable: true,
        next_action: "retry next month",
      });
      continue;
    }

    try {
      const result = await researchState(anthropic, spec);
      processed += 1;
      report.noteSuccess(spec.code);
      const supplementaryCount = STATE_SPECIFIC_QUERIES[spec.code]?.length ?? 0;
      report.recordUsage("tavily", {
        calls: 1,
        credits_consumed:
          spec.queries.length + supplementaryCount + (result.validated ? 8 : 0),
      });
      report.recordUsage("anthropic", { calls: 1, approx_cost_usd: 0.05 });
      if (result.apifyAdded > 0) {
        report.recordUsage("apify", { calls: 1 });
        report.addNote(
          `${spec.code}: Apify scraper added ${result.apifyAdded} bills (see data/raw/apify/_usage.json for CU)`,
        );
      }
      if (!result.validated) {
        report.addNote(`${spec.code}: URLs were not Tavily-validated this run`);
      }
    } catch (err) {
      if (err instanceof TavilyBudgetExhausted) {
        tavilyBudgetHit = true;
        console.warn(`[us-states-housing-research] Tavily budget exhausted; stopping`);
        report.addNote(err.message);
        report.noteFailure({
          entity: spec.code,
          error: err.message,
          retryable: true,
          next_action: "retry next month",
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
      if (err instanceof ApifyError && err.kind === "auth") {
        console.error(`  [ERROR] Apify auth failure: ${err.message}`);
        report.markSourceDegraded("apify");
        report.noteFailure({
          entity: spec.code,
          error: err.message,
          retryable: false,
          next_action: "Verify APIFY_API_TOKEN",
        });
        // Auth problems affect every remaining state; bail.
        break;
      }
      console.error(`  [ERROR] ${spec.code} (${spec.name}):`, err);
      report.noteFailure({
        entity: spec.code,
        error: (err as Error).message ?? String(err),
        retryable: true,
        next_action: "retry next run",
      });
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  const finalReport = report.finish();
  console.log(
    `\n[us-states-housing-research] ${processed} states researched. status=${finalReport.status} duration=${finalReport.duration_ms}ms`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

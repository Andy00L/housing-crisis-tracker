/**
 * Light-touch European housing research, one country at a time.
 *
 * This pipeline is DORMANT by default. It exits immediately unless the
 * caller sets EXECUTE_EUROPE=1 in the environment. Reason: Prompt E.1
 * (Canada + US refresh) executed this session; Prompt E.2 is reserved
 * for the following month and will trigger these scripts manually via
 * the europe-asia-sync.yml workflow.
 *
 * Invocation (once EXECUTE_EUROPE=1 is set):
 *   npx tsx scripts/sync/europe-housing.ts <country-code>
 *
 * Country codes: uk, de, fr, it, es, pl, nl, se, fi, ie, eu
 *
 * Per-country budget: 4 Tavily searches (2 bills, 2 projects) + 2 extracts
 * + 1 Claude extract. About 8 credits + $0.05.
 *
 * Output:
 *   data/legislation/europe/{code}.json
 *   data/projects/europe/{code}.json
 *
 * The output shape matches the JsonLegFile and projects.json shapes that
 * build-placeholder.ts reads for the US + Canada data, so ingesting these
 * files later requires no pipeline rewrite.
 */

import "../env.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import {
  HOUSING_ISSUES,
  type HousingIssue,
  type HousingProjectStatus,
  type ImpactTag,
  type LegislationCategory,
  type Stage,
  type StanceType,
} from "@/types";
import {
  extractTavily,
  searchTavily,
  TavilyBudgetExhausted,
  TavilyUnavailable,
  type TavilySearchResponse,
} from "@/lib/tavily-client";
import { startRunReport } from "@/lib/resilience/run-report";
import { validateHousingProject } from "@/lib/schemas/housing-project";

// Guard: refuse to run unless explicitly opted in. The prompt spec
// requires this to live at module-evaluation top level so the first
// EXECUTE_EUROPE check shows up in the log BEFORE any Tavily / Anthropic
// client is constructed. Prompt E.1 ships this dormant; Prompt E.2
// flips EXECUTE_EUROPE=1 in the workflow to run it.
if (process.env.EXECUTE_EUROPE !== "1") {
  console.log("[europe-housing] Dormant. Set EXECUTE_EUROPE=1 to run.");
  process.exit(0);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const LEG_DIR = join(ROOT, "data/legislation/europe");
const PROJ_DIR = join(ROOT, "data/projects/europe");

const MODEL = "claude-sonnet-4-6";

interface CountrySpec {
  code: string;
  name: string;
  /** Domains Tavily will prioritize. Empty = general search. */
  domains: string[];
  /** Currency used for project costs in this country. */
  currency: string;
  /** Language hint Tavily can lean on; keeps queries concrete. */
  languageNote?: string;
}

const SPECS: Record<string, CountrySpec> = {
  uk: {
    code: "UK",
    name: "United Kingdom",
    domains: ["gov.uk", "parliament.uk", "legislation.gov.uk", "local.gov.uk"],
    currency: "GBP",
  },
  de: {
    code: "DE",
    name: "Germany",
    domains: ["bmwsb.bund.de", "bundestag.de", "bmi.bund.de"],
    currency: "EUR",
    languageNote: "mix German and English terms (Wohnungsbau, Mietpreisbremse)",
  },
  fr: {
    code: "FR",
    name: "France",
    domains: ["legifrance.gouv.fr", "assemblee-nationale.fr", "ecologie.gouv.fr"],
    currency: "EUR",
    languageNote: "use French terms (logement, loi SRU, encadrement loyers)",
  },
  it: {
    code: "IT",
    name: "Italy",
    domains: ["camera.it", "senato.it", "mit.gov.it"],
    currency: "EUR",
    languageNote: "use Italian terms (edilizia, alloggi sociali)",
  },
  es: {
    code: "ES",
    name: "Spain",
    domains: ["congreso.es", "mitma.gob.es", "boe.es"],
    currency: "EUR",
    languageNote: "use Spanish terms (vivienda, alquiler)",
  },
  pl: {
    code: "PL",
    name: "Poland",
    domains: ["sejm.gov.pl", "gov.pl"],
    currency: "PLN",
    languageNote: "use Polish terms (mieszkanie, ustawa)",
  },
  nl: {
    code: "NL",
    name: "Netherlands",
    domains: ["tweedekamer.nl", "rijksoverheid.nl", "volkshuisvestingnederland.nl"],
    currency: "EUR",
    languageNote: "use Dutch terms (volkshuisvesting, huur)",
  },
  se: {
    code: "SE",
    name: "Sweden",
    domains: ["riksdagen.se", "regeringen.se", "boverket.se"],
    currency: "SEK",
    languageNote: "use Swedish terms (bostad, hyresrätt)",
  },
  fi: {
    code: "FI",
    name: "Finland",
    domains: ["eduskunta.fi", "ym.fi"],
    currency: "EUR",
    languageNote: "use Finnish terms (asuminen, ARA)",
  },
  ie: {
    code: "IE",
    name: "Ireland",
    domains: ["oireachtas.ie", "gov.ie", "housingagency.ie"],
    currency: "EUR",
  },
  eu: {
    code: "EU",
    name: "European Parliament",
    domains: ["europarl.europa.eu", "consilium.europa.eu", "ec.europa.eu"],
    currency: "EUR",
  },
};

function allowedDomainFilter(url: string, allowed: string[]): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return allowed.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

interface Snippet {
  url: string;
  title: string;
  content: string;
  publishedDate?: string;
  score: number;
}

async function gatherSearches(
  spec: CountrySpec,
  queries: string[],
): Promise<Snippet[]> {
  const seen = new Map<string, Snippet>();
  for (const q of queries) {
    let resp: TavilySearchResponse;
    try {
      resp = await searchTavily(q, {
        searchDepth: "basic",
        maxResults: 8,
        includeDomains: spec.domains,
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
        seen.set(r.url, {
          url: r.url,
          title: r.title,
          content: r.content,
          publishedDate: r.publishedDate,
          score: r.score,
        });
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.score - a.score).slice(0, 20);
}

// ── Bills extraction ────────────────────────────────────────────────
interface ExtractedBill {
  billCode: string;
  title: string;
  summary: string;
  stage: Stage;
  updatedDate: string;
  sourceUrl: string;
  stance?: StanceType;
  category?: LegislationCategory;
  sponsors?: string[];
}

function buildBillsPrompt(spec: CountrySpec, snippets: Snippet[]): string {
  const context = snippets
    .map(
      (s, i) =>
        `[${i + 1}] ${s.title}\n    URL: ${s.url}\n    ${s.content.slice(0, 500)}`,
    )
    .join("\n\n");

  return `Extract up to 3 housing bills for ${spec.name} from the snippets below.
${spec.languageNote ? `LANGUAGE NOTE: ${spec.languageNote}.` : ""}

SNIPPETS:
${context}

RULES:
1. Use ONLY the snippets above. Do NOT invent bill numbers or URLs.
2. sourceUrl MUST be copied verbatim from one of the URL lines above.
3. Return AT MOST 3 bills. Prefer enacted or in-debate legislation over white papers.
4. stage MUST be one of: Filed, Committee, Floor, Enacted, Dead, Carried Over.
5. stance MUST be one of: favorable, restrictive, concerning, review.
6. category MUST be one of: zoning-reform, rent-regulation, affordable-housing,
   development-incentive, building-code, foreign-investment, homelessness-services,
   tenant-protection, transit-housing, property-tax.

Return a single JSON object (no markdown fences) with this exact shape:

{
  "contextBlurb": "2-3 sentence summary of ${spec.name}'s housing legislative landscape",
  "legislation": [
    {
      "billCode": "string",
      "title": "string",
      "summary": "1-2 sentences",
      "stage": "enum above",
      "stance": "enum above",
      "category": "enum above",
      "updatedDate": "YYYY-MM-DD",
      "sourceUrl": "must be one of the URLs above",
      "sponsors": ["optional"]
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

function parseJson<T>(text: string): T {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("no JSON in response");
  return JSON.parse(candidate.slice(first, last + 1)) as T;
}

async function extractBills(
  anthropic: Anthropic,
  spec: CountrySpec,
  snippets: Snippet[],
): Promise<{ contextBlurb: string; legislation: ExtractedBill[] }> {
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2500,
    messages: [{ role: "user", content: buildBillsPrompt(spec, snippets) }],
  });
  const parsed = parseJson<{ contextBlurb?: string; legislation?: ExtractedBill[] }>(
    extractText(msg),
  );
  return {
    contextBlurb: typeof parsed.contextBlurb === "string" ? parsed.contextBlurb : "",
    legislation: Array.isArray(parsed.legislation) ? parsed.legislation : [],
  };
}

// ── Projects extraction ─────────────────────────────────────────────
interface ExtractedProject {
  name: string;
  developer: string;
  city?: string;
  unitCount?: number;
  affordableUnits?: number;
  projectCost?: number;
  projectType?: "rental" | "condo" | "mixed" | "social" | "cooperative";
  status: HousingProjectStatus;
  announceDate?: string;
  sourceUrl: string;
  primaryBeneficiary?: string;
  storyBlurb?: string;
  issues?: HousingIssue[];
  sources?: Array<{ title: string; publisher: string; url: string; date: string }>;
}

function buildProjectsPrompt(spec: CountrySpec, snippets: Snippet[]): string {
  const context = snippets
    .map(
      (s, i) =>
        `[${i + 1}] ${s.title}\n    URL: ${s.url}\n    ${s.content.slice(0, 500)}`,
    )
    .join("\n\n");
  return `Extract up to 3 housing projects for ${spec.name} from the snippets below.

SNIPPETS:
${context}

RULES:
1. Use ONLY the snippets above. Do NOT invent facts or URLs.
2. sourceUrl MUST be copied verbatim from one of the URL lines.
3. Return AT MOST 3 projects. Prefer named developments with concrete unit counts.
4. status MUST be one of: operational, under-construction, proposed.
5. projectType MUST be one of: rental, condo, mixed, social, cooperative.
6. issues MUST be a subset of: ${HOUSING_ISSUES.join(", ")}.
7. sources MUST cite at least one URL from the snippets.

Return a single JSON object (no markdown fences):

{
  "projects": [
    {
      "name": "string",
      "developer": "string",
      "city": "optional",
      "unitCount": 100,
      "affordableUnits": 40,
      "projectCost": 25000000,
      "projectType": "enum",
      "status": "enum",
      "announceDate": "YYYY-MM-DD",
      "sourceUrl": "URL from snippets",
      "primaryBeneficiary": "one phrase",
      "storyBlurb": "120-180 words",
      "issues": ["subset of HOUSING_ISSUES"],
      "sources": [{"title": "", "publisher": "", "url": "", "date": "YYYY-MM-DD"}]
    }
  ]
}`;
}

async function extractProjects(
  anthropic: Anthropic,
  spec: CountrySpec,
  snippets: Snippet[],
): Promise<ExtractedProject[]> {
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3000,
    messages: [{ role: "user", content: buildProjectsPrompt(spec, snippets) }],
  });
  const parsed = parseJson<{ projects?: unknown[] }>(extractText(msg));
  if (!Array.isArray(parsed.projects)) return [];
  const out: ExtractedProject[] = [];
  for (const raw of parsed.projects as Array<Record<string, unknown>>) {
    if (!raw.name || !raw.developer || !raw.sourceUrl) continue;
    const status = String(raw.status ?? "");
    if (!["operational", "under-construction", "proposed"].includes(status)) continue;
    out.push({
      name: String(raw.name),
      developer: String(raw.developer),
      city: typeof raw.city === "string" ? raw.city : undefined,
      unitCount: typeof raw.unitCount === "number" && raw.unitCount > 0 ? raw.unitCount : undefined,
      affordableUnits:
        typeof raw.affordableUnits === "number" && raw.affordableUnits >= 0 ? raw.affordableUnits : undefined,
      projectCost:
        typeof raw.projectCost === "number" && raw.projectCost > 0 ? raw.projectCost : undefined,
      projectType: ["rental", "condo", "mixed", "social", "cooperative"].includes(String(raw.projectType))
        ? (raw.projectType as ExtractedProject["projectType"])
        : undefined,
      status: status as HousingProjectStatus,
      announceDate: typeof raw.announceDate === "string" ? raw.announceDate : undefined,
      sourceUrl: String(raw.sourceUrl),
      primaryBeneficiary: typeof raw.primaryBeneficiary === "string" ? raw.primaryBeneficiary : undefined,
      storyBlurb: typeof raw.storyBlurb === "string" ? raw.storyBlurb : undefined,
      issues: Array.isArray(raw.issues)
        ? (raw.issues as unknown[])
            .map(String)
            .filter((s): s is HousingIssue => (HOUSING_ISSUES as readonly string[]).includes(s))
        : undefined,
      sources: Array.isArray(raw.sources)
        ? (raw.sources as Array<Record<string, unknown>>).map((s) => ({
            title: String(s.title ?? ""),
            publisher: String(s.publisher ?? ""),
            url: String(s.url ?? ""),
            date: String(s.date ?? ""),
          }))
        : undefined,
    });
  }
  return out;
}

// ── Shared: URL validation ──────────────────────────────────────────
async function validateUrls(urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  try {
    const resp = await extractTavily(urls.slice(0, 20), { extractDepth: "basic" });
    return new Set(
      resp.results
        .filter((r) => typeof r.rawContent === "string" && r.rawContent.length > 100)
        .map((r) => r.url),
    );
  } catch (err) {
    if (err instanceof TavilyBudgetExhausted || err instanceof TavilyUnavailable) {
      return new Set(urls);
    }
    throw err;
  }
}

// ── Stance aggregation (mirrors canada-legislation.ts) ──────────────
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

function classifyTags(text: string): ImpactTag[] {
  const rules: Array<{ tag: ImpactTag; kw: RegExp }> = [
    { tag: "affordability", kw: /\b(affordab|price|loyer|mieten|bezahlbar|alquiler|abordab)\b/i },
    { tag: "density", kw: /\b(density|verdichtung|densité|densidad|höjning|bouwhoogte)\b/i },
    { tag: "social-housing", kw: /\b(social housing|sozialwohnung|logement social|edilizia sociale|volkshuisvesting|allmännytta|mieszkanie komunalne)\b/i },
    { tag: "homelessness", kw: /\b(homeless|obdachlos|sans.?abri|senzatetto|sin hogar|bezdomn)\b/i },
    { tag: "rent-stabilization", kw: /\b(rent (control|cap|freeze)|mietpreisbremse|encadrement loyers|alquiler)\b/i },
    { tag: "displacement", kw: /\b(displac|gentrif|verdrängung|expulsion)\b/i },
    { tag: "short-term-rental", kw: /\b(short.?term rental|ferienwohnung|airbnb)\b/i },
  ];
  const out: ImpactTag[] = [];
  for (const { tag, kw } of rules) if (kw.test(text)) out.push(tag);
  return out.length > 0 ? out.slice(0, 5) : ["affordability"];
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const countryCode = process.argv[2];
  if (!countryCode || !SPECS[countryCode]) {
    console.error("usage: tsx europe-housing.ts <code>");
    console.error("codes:", Object.keys(SPECS).join(", "));
    process.exit(1);
  }
  const spec = SPECS[countryCode];
  const report = startRunReport(`europe-housing-${countryCode}`);
  report.incrementTotal(1);
  console.log(`[europe-housing] Starting ${spec.name}...`);

  const anthropic = new Anthropic();
  mkdirSync(LEG_DIR, { recursive: true });
  mkdirSync(PROJ_DIR, { recursive: true });

  const billQueries = [
    `${spec.name} housing bill 2025 2026 affordability`,
    `${spec.name} tenant protection rent control 2025`,
  ];
  const projectQueries = [
    `${spec.name} housing project 2025 2026 social housing development`,
    `${spec.name} affordable housing investment 2026`,
  ];

  // Bills
  let billSnippets: Snippet[];
  try {
    billSnippets = await gatherSearches(spec, billQueries);
  } catch (err) {
    handleTavilyFailure(err, report, `${spec.code}-bills`);
    report.finish("failed");
    return;
  }
  report.recordUsage("tavily", { calls: billQueries.length, credits_consumed: billQueries.length });

  let bills: ExtractedBill[] = [];
  let contextBlurb = "";
  if (billSnippets.length > 0) {
    try {
      const extracted = await extractBills(anthropic, spec, billSnippets);
      contextBlurb = extracted.contextBlurb;
      bills = extracted.legislation;
      report.recordUsage("anthropic", { calls: 1, approx_cost_usd: 0.04 });
    } catch (err) {
      report.noteFailure({
        entity: `${spec.code}-bills`,
        error: (err as Error).message,
        retryable: true,
        next_action: "retry next run",
      });
    }
  }

  const billUrls = bills
    .map((b) => b.sourceUrl)
    .filter((u) => allowedDomainFilter(u, spec.domains));
  const reachableBills = await validateUrls(billUrls);
  report.recordUsage("tavily", { calls: 1, credits_consumed: Math.min(20, billUrls.length) });
  const finalBills = bills
    .filter((b) => allowedDomainFilter(b.sourceUrl, spec.domains))
    .filter((b) => reachableBills.has(b.sourceUrl))
    .slice(0, 3);

  const allowedStages: Stage[] = ["Filed", "Committee", "Floor", "Enacted", "Carried Over", "Dead"];
  const allowedCats: LegislationCategory[] = [
    "zoning-reform", "rent-regulation", "affordable-housing", "development-incentive",
    "building-code", "foreign-investment", "homelessness-services", "tenant-protection",
    "transit-housing", "property-tax",
  ];
  const allowedStances: StanceType[] = ["favorable", "restrictive", "concerning", "review"];

  const legislation = finalBills.map((b, i) => {
    const stage = allowedStages.includes(b.stage) ? b.stage : "Filed";
    const category = allowedCats.includes(b.category as LegislationCategory)
      ? (b.category as LegislationCategory)
      : "affordable-housing";
    const stance = allowedStances.includes(b.stance as StanceType)
      ? (b.stance as StanceType)
      : "review";
    const text = `${b.title} ${b.summary}`;
    const billCode = (b.billCode ?? "").trim() || `${spec.code}-${i + 1}`;
    const slug = slugify(billCode);
    return {
      id: `eu-${spec.code.toLowerCase()}-${slug}`,
      billCode,
      title: b.title,
      summary: b.summary,
      stage,
      stance,
      impactTags: classifyTags(text),
      category,
      updatedDate: b.updatedDate ?? new Date().toISOString().slice(0, 10),
      sourceUrl: b.sourceUrl,
      sponsors: Array.isArray(b.sponsors) ? b.sponsors.map(String) : [],
    };
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
  const overall = legislation.length === 0 ? "none" : maxStance(stanceZoning, stanceAffordability);

  const legFile = {
    state: spec.name,
    stateCode: spec.code,
    region: "eu",
    stance: overall,
    stanceZoning,
    stanceAffordability,
    lastUpdated: new Date().toISOString().slice(0, 10),
    contextBlurb:
      contextBlurb ||
      `${spec.name} housing policy record is sparse in this dataset. Coverage expands in future data cycles.`,
    legislation,
  };
  writeFileSync(join(LEG_DIR, `${spec.code.toLowerCase()}.json`), JSON.stringify(legFile, null, 2), {
    encoding: "utf8",
  });

  // Projects
  let projectSnippets: Snippet[];
  try {
    projectSnippets = await gatherSearches(spec, projectQueries);
  } catch (err) {
    handleTavilyFailure(err, report, `${spec.code}-projects`);
    report.finish("partial");
    return;
  }
  report.recordUsage("tavily", {
    calls: projectQueries.length,
    credits_consumed: projectQueries.length,
  });

  let rawProjects: ExtractedProject[] = [];
  if (projectSnippets.length > 0) {
    try {
      rawProjects = await extractProjects(anthropic, spec, projectSnippets);
      report.recordUsage("anthropic", { calls: 1, approx_cost_usd: 0.05 });
    } catch (err) {
      report.noteFailure({
        entity: `${spec.code}-projects`,
        error: (err as Error).message,
        retryable: true,
        next_action: "retry next run",
      });
    }
  }
  const projUrls = rawProjects
    .map((p) => p.sourceUrl)
    .filter((u) => allowedDomainFilter(u, spec.domains));
  const reachableProj = await validateUrls(projUrls);
  report.recordUsage("tavily", { calls: 1, credits_consumed: Math.min(20, projUrls.length) });
  const finalProjects = rawProjects
    .filter((p) => allowedDomainFilter(p.sourceUrl, spec.domains))
    .filter((p) => reachableProj.has(p.sourceUrl))
    .slice(0, 3);

  const projects: Array<Record<string, unknown>> = [];
  for (const p of finalProjects) {
    const candidate = {
      id: `eu-${spec.code.toLowerCase()}-${slugify(p.name)}`,
      developer: p.developer,
      projectName: p.name,
      location: p.city,
      state: spec.code,
      country: spec.name,
      unitCount: p.unitCount,
      affordableUnits: p.affordableUnits,
      projectCost: p.projectCost,
      projectType: p.projectType,
      status: p.status,
      yearProposed: p.announceDate ? Number(p.announceDate.slice(0, 4)) || undefined : undefined,
      notes: p.storyBlurb?.slice(0, 240),
      source: p.sourceUrl,
      primaryBeneficiary: p.primaryBeneficiary,
      storyBlurb: p.storyBlurb,
      issues: p.issues,
      sources: p.sources?.filter((s) => s.url),
    };
    const { project, errors } = validateHousingProject(candidate);
    if (!project) {
      console.warn(`  [drop] ${candidate.id}: ${errors.slice(0, 3).join("; ")}`);
      continue;
    }
    projects.push(project as unknown as Record<string, unknown>);
  }

  const projFile = {
    country: spec.name,
    countryCode: spec.code,
    currency: spec.currency,
    lastUpdated: new Date().toISOString().slice(0, 10),
    projects,
  };
  writeFileSync(join(PROJ_DIR, `${spec.code.toLowerCase()}.json`), JSON.stringify(projFile, null, 2), {
    encoding: "utf8",
  });

  console.log(
    `[europe-housing] ${spec.code}: ${legislation.length} bills, ${projects.length} projects, stance=${overall}`,
  );
  report.noteSuccess(spec.code);
  report.finish();
}

function handleTavilyFailure(
  err: unknown,
  report: ReturnType<typeof startRunReport>,
  entity: string,
): void {
  if (err instanceof TavilyBudgetExhausted) {
    report.addNote(err.message);
    report.noteFailure({
      entity,
      error: err.message,
      retryable: true,
      next_action: "retry next month",
    });
    return;
  }
  if (err instanceof TavilyUnavailable) {
    report.markSourceDegraded("tavily");
    report.noteFailure({
      entity,
      error: err.message,
      retryable: true,
      next_action: "retry when Tavily recovers",
    });
    return;
  }
  throw err;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Light-touch Asia-Pacific housing research, one country at a time.
 *
 * Dormant by default. Exits immediately unless EXECUTE_ASIA=1. Reserved
 * for Prompt E.2 (manual workflow trigger).
 *
 * Invocation (once EXECUTE_ASIA=1 is set):
 *   npx tsx scripts/sync/asia-pacific-housing.ts <country-code>
 *
 * Country codes: jp, kr, cn, in, id, tw, au
 *
 * Per-country budget identical to europe-housing.ts. Output:
 *   data/legislation/asia-pacific/{code}.json
 *   data/projects/asia-pacific/{code}.json
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

if (process.env.EXECUTE_ASIA !== "1") {
  console.log("[asia-pacific-housing] Dormant. Set EXECUTE_ASIA=1 to run.");
  process.exit(0);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const LEG_DIR = join(ROOT, "data/legislation/asia-pacific");
const PROJ_DIR = join(ROOT, "data/projects/asia-pacific");

const MODEL = "claude-sonnet-4-6";

interface CountrySpec {
  code: string;
  name: string;
  domains: string[];
  currency: string;
  /** Optional language hint passed to Claude so non-English terms are
   *  used when the official corpora are not English-first. */
  languageNote?: string;
  /** Extra issue labels to respect. Non-Western systems have housing
   *  concepts that don't map cleanly to HOUSING_ISSUES, so Claude is
   *  allowed to add one or two regional tags as plain strings. These are
   *  NOT validated against the enum; they flow through as-is to the
   *  HousingProject.notes field if used. */
  regionalTags?: string[];
}

const SPECS: Record<string, CountrySpec> = {
  jp: {
    code: "JP",
    name: "Japan",
    domains: ["mlit.go.jp", "sangiin.go.jp", "shugiin.go.jp"],
    currency: "JPY",
    languageNote: "mix Japanese (住宅, 賃貸, 公営住宅) and English search terms",
    regionalTags: ["akiya-vacancy", "public-housing-danchi"],
  },
  kr: {
    code: "KR",
    name: "South Korea",
    domains: ["molit.go.kr", "korea.kr", "lh.or.kr"],
    currency: "KRW",
    languageNote: "mix Korean (주택, 전세, 임대) and English",
    regionalTags: ["jeonse-deposit", "LH-public-housing"],
  },
  cn: {
    code: "CN",
    name: "China",
    domains: ["mohurd.gov.cn", "npc.gov.cn", "gov.cn"],
    currency: "CNY",
    languageNote: "mix simplified Chinese (住房, 保障房) and English",
    regionalTags: ["state-owned-housing", "hukou-coupling"],
  },
  in: {
    code: "IN",
    name: "India",
    domains: ["mohua.gov.in", "sansad.in", "pib.gov.in"],
    currency: "INR",
    regionalTags: ["pmay-scheme", "slum-redevelopment"],
  },
  id: {
    code: "ID",
    name: "Indonesia",
    domains: ["pu.go.id", "dpr.go.id", "pkp.go.id"],
    currency: "IDR",
    languageNote: "use Indonesian terms (rumah susun, perumahan)",
  },
  tw: {
    code: "TW",
    name: "Taiwan",
    domains: ["ly.gov.tw", "lis.ly.gov.tw", "cpami.gov.tw", "moi.gov.tw"],
    currency: "TWD",
    languageNote: "use traditional Chinese (社會住宅, 公共住宅)",
  },
  au: {
    code: "AU",
    name: "Australia",
    domains: ["aph.gov.au", "legislation.gov.au", "housing.gov.au", "dhw.gov.au"],
    currency: "AUD",
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

async function gatherSearches(spec: CountrySpec, queries: string[]): Promise<Snippet[]> {
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

// Bill + project extraction: same shape as europe-housing.ts but adapted
// for regional context. Kept inline so each pipeline stays self-contained.

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

function buildBillsPrompt(spec: CountrySpec, snippets: Snippet[]): string {
  const ctx = snippets
    .map((s, i) => `[${i + 1}] ${s.title}\n    URL: ${s.url}\n    ${s.content.slice(0, 500)}`)
    .join("\n\n");
  return `Extract up to 3 housing bills for ${spec.name} from the snippets below.
${spec.languageNote ? `LANGUAGE NOTE: ${spec.languageNote}.` : ""}

SNIPPETS:
${ctx}

RULES:
1. Use ONLY the snippets above.
2. sourceUrl MUST be copied verbatim from one of the URL lines.
3. Return AT MOST 3 bills.
4. stage: Filed | Committee | Floor | Enacted | Dead | Carried Over.
5. stance: favorable | restrictive | concerning | review.
6. category: zoning-reform | rent-regulation | affordable-housing | development-incentive |
   building-code | foreign-investment | homelessness-services | tenant-protection |
   transit-housing | property-tax.

Return a single JSON object (no markdown fences):
{"contextBlurb": "...", "legislation": [ { "billCode": "", "title": "", "summary": "", "stage": "", "stance": "", "category": "", "updatedDate": "YYYY-MM-DD", "sourceUrl": "" } ]}`;
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
  const parsed = parseJson<{ contextBlurb?: string; legislation?: ExtractedBill[] }>(extractText(msg));
  return {
    contextBlurb: typeof parsed.contextBlurb === "string" ? parsed.contextBlurb : "",
    legislation: Array.isArray(parsed.legislation) ? parsed.legislation : [],
  };
}

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
  const ctx = snippets
    .map((s, i) => `[${i + 1}] ${s.title}\n    URL: ${s.url}\n    ${s.content.slice(0, 500)}`)
    .join("\n\n");
  return `Extract up to 3 housing projects for ${spec.name} from the snippets below.
${spec.languageNote ? `LANGUAGE NOTE: ${spec.languageNote}.` : ""}

SNIPPETS:
${ctx}

RULES:
1. Use ONLY the snippets above.
2. sourceUrl MUST be copied verbatim from one of the URL lines.
3. Return AT MOST 3 projects.
4. status: operational | under-construction | proposed.
5. projectType: rental | condo | mixed | social | cooperative.
6. issues: subset of ${HOUSING_ISSUES.join(", ")}.
7. If a regionally-specific concept matters (e.g., akiya vacancy for Japan,
   jeonse for Korea, hukou coupling for China), put it in storyBlurb; do not
   invent new issue tags.

Return a single JSON object (no markdown fences):
{"projects": [{"name": "", "developer": "", "city": "", "unitCount": 0, "affordableUnits": 0, "projectCost": 0, "projectType": "", "status": "", "announceDate": "", "sourceUrl": "", "primaryBeneficiary": "", "storyBlurb": "", "issues": [], "sources": []}]}`;
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
    { tag: "affordability", kw: /\b(affordab|price|housing cost)\b/i },
    { tag: "density", kw: /\b(density|multi.?family|high.?rise)\b/i },
    { tag: "social-housing", kw: /\b(social housing|public housing|koei|gongying|subsidized)\b/i },
    { tag: "homelessness", kw: /\b(homeless|shelter|encampment)\b/i },
    { tag: "rent-stabilization", kw: /\b(rent (control|stabiliz|cap|freeze))\b/i },
    { tag: "foreign-buyer", kw: /\b(foreign buyer|non.?resident)\b/i },
  ];
  const out: ImpactTag[] = [];
  for (const { tag, kw } of rules) if (kw.test(text)) out.push(tag);
  return out.length > 0 ? out.slice(0, 5) : ["affordability"];
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

async function main() {
  const countryCode = process.argv[2];
  if (!countryCode || !SPECS[countryCode]) {
    console.error("usage: tsx asia-pacific-housing.ts <code>");
    console.error("codes:", Object.keys(SPECS).join(", "));
    process.exit(1);
  }
  const spec = SPECS[countryCode];
  const report = startRunReport(`asia-pacific-housing-${countryCode}`);
  report.incrementTotal(1);
  console.log(`[asia-pacific-housing] Starting ${spec.name}...`);

  const anthropic = new Anthropic();
  mkdirSync(LEG_DIR, { recursive: true });
  mkdirSync(PROJ_DIR, { recursive: true });

  // Native language queries for countries where English-only searches
  // return zero results because official sources publish in the local language.
  const nativeQueries: Record<string, string[]> = {
    AU: [
      "Housing Australia Future Fund 2025",
      "National Housing Accord 2025 parliament",
      "Help to Buy scheme Australia 2025",
    ],
    ID: [
      "undang-undang perumahan Indonesia 2025",
      "rumah susun peraturan 2025",
      "Kementerian Perumahan 2025",
    ],
    TW: [
      "\u4f4f\u5b85\u6cd5 \u4fee\u6b63 2025 \u7acb\u6cd5\u9662",
      "\u793e\u6703\u4f4f\u5b85 \u653f\u7b56 2025",
      "\u623f\u5c4b\u5e02\u5834 \u6cd5\u898f 2025",
    ],
  };

  const billQueries = [
    `${spec.name} housing bill 2025 2026 affordability`,
    `${spec.name} tenant protection rent control 2025`,
    ...(nativeQueries[spec.code] ?? []),
  ];
  const projectQueries = [
    `${spec.name} housing project 2025 2026 social housing development`,
    `${spec.name} affordable housing investment 2026`,
  ];

  let billSnippets: Snippet[];
  try {
    billSnippets = await gatherSearches(spec, billQueries);
  } catch (err) {
    handleTavily(err, report, `${spec.code}-bills`);
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

  const billUrls = bills.map((b) => b.sourceUrl).filter((u) => allowedDomainFilter(u, spec.domains));
  const reachable = await validateUrls(billUrls);
  report.recordUsage("tavily", { calls: 1, credits_consumed: Math.min(20, billUrls.length) });
  const finalBills = bills
    .filter((b) => allowedDomainFilter(b.sourceUrl, spec.domains))
    .filter((b) => reachable.has(b.sourceUrl))
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
    const billCode = (b.billCode ?? "").trim() || `${spec.code}-${i + 1}`;
    return {
      id: `ap-${spec.code.toLowerCase()}-${slugify(billCode)}`,
      billCode,
      title: b.title,
      summary: b.summary,
      stage,
      stance,
      impactTags: classifyTags(`${b.title} ${b.summary}`),
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
    region: "asia",
    stance: overall,
    stanceZoning,
    stanceAffordability,
    lastUpdated: new Date().toISOString().slice(0, 10),
    contextBlurb:
      contextBlurb ||
      `${spec.name} housing record is sparse in this dataset. Coverage expands in future data cycles.`,
    legislation,
  };
  writeFileSync(join(LEG_DIR, `${spec.code.toLowerCase()}.json`), JSON.stringify(legFile, null, 2), {
    encoding: "utf8",
  });

  let projectSnippets: Snippet[];
  try {
    projectSnippets = await gatherSearches(spec, projectQueries);
  } catch (err) {
    handleTavily(err, report, `${spec.code}-projects`);
    report.finish("partial");
    return;
  }
  report.recordUsage("tavily", { calls: projectQueries.length, credits_consumed: projectQueries.length });

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
  const projUrls = rawProjects.map((p) => p.sourceUrl).filter((u) => allowedDomainFilter(u, spec.domains));
  const reachableProj = await validateUrls(projUrls);
  report.recordUsage("tavily", { calls: 1, credits_consumed: Math.min(20, projUrls.length) });
  const finalProjects = rawProjects
    .filter((p) => allowedDomainFilter(p.sourceUrl, spec.domains))
    .filter((p) => reachableProj.has(p.sourceUrl))
    .slice(0, 3);

  const projects: Array<Record<string, unknown>> = [];
  for (const p of finalProjects) {
    const candidate = {
      id: `ap-${spec.code.toLowerCase()}-${slugify(p.name)}`,
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
    `[asia-pacific-housing] ${spec.code}: ${legislation.length} bills, ${projects.length} projects, stance=${overall}`,
  );
  report.noteSuccess(spec.code);
  report.finish();
}

function handleTavily(
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

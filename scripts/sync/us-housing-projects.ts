/**
 * Research US housing projects (federal + top 10 states), enriched.
 *
 * Mirrors scripts/sync/housing-projects.ts (Canada) but emits the enriched
 * J5-style fields documented in types/index.ts: primaryBeneficiary,
 * storyBlurb, issues, relatedBillIds, relatedLocalActions, sources.
 *
 * The relatedBillIds list cross-references whatever shipped from
 * us-federal-housing.ts and us-states-housing-research.ts; if those files
 * are missing or empty the field stays empty (no fabrication).
 *
 * Output: data/projects/us.json
 * Budget target: ~32 Tavily credits (federal 2 + 10 states × 2 = 22 search
 * credits, plus ~10 extract credits for URL validation).
 */

import "../env.js";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import {
  HOUSING_ISSUES,
  type HousingIssue,
  type HousingProjectStatus,
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const OUT_PATH = join(ROOT, "data/projects/us.json");
const FEDERAL_BILLS_PATH = join(ROOT, "data/legislation/federal-us-housing.json");
const STATES_BILLS_DIR = join(ROOT, "data/legislation/us-states-housing");

const MODEL = "claude-sonnet-4-6";

interface SearchPlan {
  scope: "federal" | string; // "federal" or 2-letter state code
  label: string;
  query: string;
  includeDomains?: string[];
}

const FEDERAL_PLANS: SearchPlan[] = [
  {
    scope: "federal",
    label: "Build America Buy America housing",
    query: "Build America Buy America housing project 2026 affordable units announcement",
    includeDomains: ["hud.gov", "whitehouse.gov", "transportation.gov", "congress.gov"],
  },
  {
    scope: "federal",
    label: "HUD Section 8 major housing project",
    query: "HUD Section 8 major housing development 2026 affordable units announcement",
    includeDomains: ["hud.gov", "huduser.gov"],
  },
];

const STATE_PLANS: SearchPlan[] = [
  { scope: "CA", label: "California major housing", query: "California major housing development 2025 2026 units affordable groundbreaking",
    includeDomains: ["hcd.ca.gov", "ca.gov", "lahsa.org"] },
  { scope: "NY", label: "New York major housing", query: "New York City State major housing development 2025 2026 units affordable groundbreaking",
    includeDomains: ["hcr.ny.gov", "nyc.gov", "ny.gov"] },
  { scope: "TX", label: "Texas major housing", query: "Texas major housing development 2025 2026 units affordable groundbreaking Houston Dallas Austin",
    includeDomains: ["tdhca.texas.gov", "texas.gov"] },
  { scope: "FL", label: "Florida major housing", query: "Florida major housing development 2025 2026 units affordable groundbreaking Live Local",
    includeDomains: ["floridahousing.org", "myflorida.com"] },
  { scope: "WA", label: "Washington major housing", query: "Washington state major housing development 2025 2026 units affordable groundbreaking Seattle",
    includeDomains: ["commerce.wa.gov", "seattle.gov"] },
  { scope: "MA", label: "Massachusetts major housing", query: "Massachusetts major housing development 2025 2026 units affordable Boston MBTA Communities",
    includeDomains: ["mass.gov", "boston.gov"] },
  { scope: "OR", label: "Oregon major housing", query: "Oregon major housing development 2025 2026 units affordable Portland",
    includeDomains: ["oregon.gov", "portland.gov"] },
  { scope: "CO", label: "Colorado major housing", query: "Colorado major housing development 2025 2026 units affordable Denver",
    includeDomains: ["cdola.colorado.gov", "denvergov.org"] },
  { scope: "AZ", label: "Arizona major housing", query: "Arizona major housing development 2025 2026 units affordable Phoenix",
    includeDomains: ["housing.az.gov", "phoenix.gov"] },
  { scope: "NC", label: "North Carolina major housing", query: "North Carolina major housing development 2025 2026 units affordable Raleigh Charlotte",
    includeDomains: ["nchfa.com", "nc.gov"] },
];

const STATE_NAME: Record<string, string> = {
  CA: "California", NY: "New York", TX: "Texas", FL: "Florida", WA: "Washington",
  MA: "Massachusetts", OR: "Oregon", CO: "Colorado", AZ: "Arizona", NC: "North Carolina",
};

interface Snippet {
  url: string;
  title: string;
  content: string;
  publishedDate?: string;
  score: number;
  scope: string;
}

async function gather(plans: SearchPlan[]): Promise<Snippet[]> {
  const seen = new Map<string, Snippet>();
  for (const p of plans) {
    let resp: TavilySearchResponse;
    try {
      resp = await searchTavily(p.query, {
        searchDepth: "basic",
        topic: "news",
        maxResults: 12,
        days: 365,
        includeDomains: p.includeDomains,
      });
    } catch (err) {
      if (err instanceof TavilyBudgetExhausted || err instanceof TavilyUnavailable) {
        throw err;
      }
      console.warn(`  [warn] search "${p.label}" failed: ${(err as Error).message}`);
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
          scope: p.scope,
        });
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.score - a.score).slice(0, 60);
}

interface ExtractedProject {
  name: string;
  developer: string;
  state: string;
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

function buildPrompt(snippets: Snippet[]): string {
  const context = snippets
    .map(
      (s, i) =>
        `[${i + 1}] (${s.scope}) ${s.title}\n    URL: ${s.url}${s.publishedDate ? `\n    DATE: ${s.publishedDate}` : ""}\n    ${s.content.slice(0, 500)}`,
    )
    .join("\n\n");

  return `You are extracting US housing development projects from web search snippets.

SNIPPETS:
${context}

RULES:
1. Use ONLY the snippets above. Do NOT invent projects, unit counts, or URLs.
2. sourceUrl MUST be copied verbatim from one of the snippet URL lines.
3. Drop entries you cannot tie to a specific snippet.
4. Return 20-30 projects across all 10 states + federal. Prefer named developments
   with concrete unit counts. For unknown numerics, OMIT the field rather than guess.
   Keep the storyBlurb to 120-220 words to fit the response budget.
5. status MUST be one of: operational, under-construction, proposed.
6. projectType MUST be one of: rental, condo, mixed, social, cooperative.
7. state MUST be a 2-letter state code (CA, NY, TX, FL, WA, MA, OR, CO, AZ, NC) or
   "FEDERAL" for federally-led national programs that don't tie to one state.
8. issues MUST be a subset of:
   ${HOUSING_ISSUES.join(", ")}
9. primaryBeneficiary is one short phrase ("Low-income renters", "Seniors",
   "Young families", "Mixed-income tenure", "Veterans", etc.).
10. storyBlurb is 2-3 paragraphs (150-300 words) explaining the project: who
    backed it, opposition or controversy if any, where the funding comes from.
11. sources is an array of 2+ citations: { title, publisher, url, date }.
    URLs there MUST also come from the snippets above.

Return a SINGLE JSON object (no markdown fences) with this exact shape:

{
  "projects": [
    {
      "name": "project or development name",
      "developer": "lead developer or agency",
      "state": "two-letter code or FEDERAL",
      "city": "city if known",
      "unitCount": 220,
      "affordableUnits": 88,
      "projectCost": 75000000,
      "projectType": "rental|condo|mixed|social|cooperative",
      "status": "proposed|under-construction|operational",
      "announceDate": "YYYY-MM-DD",
      "sourceUrl": "one of the URLs above",
      "primaryBeneficiary": "short phrase",
      "storyBlurb": "2-3 paragraph narrative",
      "issues": ["zero or more from HOUSING_ISSUES"],
      "sources": [
        { "title": "Headline", "publisher": "Outlet name", "url": "URL from snippets", "date": "YYYY-MM-DD" }
      ]
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

function parseProjects(text: string): ExtractedProject[] {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("no JSON in response");
  const parsed = JSON.parse(candidate.slice(first, last + 1)) as { projects?: unknown[] };
  if (!Array.isArray(parsed.projects)) throw new Error("response missing 'projects' array");
  const out: ExtractedProject[] = [];
  for (const p of parsed.projects as Array<Record<string, unknown>>) {
    if (!p.name || !p.developer || !p.state || !p.sourceUrl || !p.status) continue;
    const status = String(p.status);
    if (!["proposed", "under-construction", "operational"].includes(status)) continue;
    out.push({
      name: String(p.name),
      developer: String(p.developer),
      state: String(p.state).toUpperCase(),
      city: typeof p.city === "string" ? p.city : undefined,
      unitCount: typeof p.unitCount === "number" && p.unitCount > 0 ? p.unitCount : undefined,
      affordableUnits:
        typeof p.affordableUnits === "number" && p.affordableUnits >= 0 ? p.affordableUnits : undefined,
      projectCost:
        typeof p.projectCost === "number" && p.projectCost > 0 ? p.projectCost : undefined,
      projectType: ["rental", "condo", "mixed", "social", "cooperative"].includes(String(p.projectType))
        ? (p.projectType as ExtractedProject["projectType"])
        : undefined,
      status: status as HousingProjectStatus,
      announceDate: typeof p.announceDate === "string" ? p.announceDate : undefined,
      sourceUrl: String(p.sourceUrl),
      primaryBeneficiary: typeof p.primaryBeneficiary === "string" ? p.primaryBeneficiary : undefined,
      storyBlurb: typeof p.storyBlurb === "string" ? p.storyBlurb : undefined,
      issues: Array.isArray(p.issues)
        ? (p.issues as unknown[])
            .map(String)
            .filter((s): s is HousingIssue => (HOUSING_ISSUES as readonly string[]).includes(s))
        : undefined,
      sources: Array.isArray(p.sources)
        ? (p.sources as Array<Record<string, unknown>>)
            .filter((s) => typeof s.url === "string")
            .map((s) => ({
              title: String(s.title ?? ""),
              publisher: String(s.publisher ?? ""),
              url: String(s.url),
              date: typeof s.date === "string" ? s.date : "",
            }))
        : undefined,
    });
  }
  return out;
}

async function askClaude(anthropic: Anthropic, snippets: Snippet[]): Promise<ExtractedProject[]> {
  const prompt = buildPrompt(snippets);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      console.log(`  [claude] extracting projects (attempt ${attempt + 1})...`);
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 16000,
        messages: [{ role: "user", content: prompt }],
      });
      console.log(`  [claude] got response (${msg.usage?.output_tokens ?? "?"} output tokens)`);
      try {
        return parseProjects(extractText(msg));
      } catch (parseErr) {
        console.warn(`  [warn] parse failed, raw text length=${extractText(msg).length}`);
        console.warn(`  [warn] trailing 400 chars: ${extractText(msg).slice(-400)}`);
        throw parseErr;
      }
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

async function validateUrls(projects: ExtractedProject[]): Promise<Set<string>> {
  const urls = Array.from(new Set(projects.map((p) => p.sourceUrl))).slice(0, 40);
  if (urls.length === 0) return new Set();
  try {
    const resp = await extractTavily(urls, { extractDepth: "basic" });
    return new Set(
      resp.results
        .filter((r) => typeof r.rawContent === "string" && r.rawContent.length > 100)
        .map((r) => r.url),
    );
  } catch (err) {
    if (err instanceof TavilyBudgetExhausted || err instanceof TavilyUnavailable) {
      console.warn(`  [warn] URL validation skipped: ${err.message}`);
      return new Set(urls);
    }
    throw err;
  }
}

interface BillIndex {
  byState: Map<string, Array<{ id: string; tokens: string[] }>>;
  federal: Array<{ id: string; tokens: string[] }>;
}

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((t) => t.length > 3);
}

function loadBillIndex(): BillIndex {
  const idx: BillIndex = { byState: new Map(), federal: [] };
  if (existsSync(FEDERAL_BILLS_PATH)) {
    try {
      const f = JSON.parse(readFileSync(FEDERAL_BILLS_PATH, "utf8")) as {
        legislation?: Array<{ id: string; title: string; summary: string }>;
      };
      for (const b of f.legislation ?? []) {
        idx.federal.push({ id: b.id, tokens: tokenize(`${b.title} ${b.summary}`) });
      }
    } catch (err) {
      console.warn(`  [warn] could not load federal bills: ${(err as Error).message}`);
    }
  }
  if (existsSync(STATES_BILLS_DIR)) {
    try {
      for (const f of readdirSync(STATES_BILLS_DIR)) {
        if (!f.endsWith(".json")) continue;
        const code = f.replace(/\.json$/, "");
        try {
          const data = JSON.parse(readFileSync(join(STATES_BILLS_DIR, f), "utf8")) as {
            legislation?: Array<{ id: string; title: string; summary: string }>;
          };
          const list = (data.legislation ?? []).map((b) => ({
            id: b.id,
            tokens: tokenize(`${b.title} ${b.summary}`),
          }));
          idx.byState.set(code, list);
        } catch (err) {
          console.warn(`  [warn] could not load state bills ${f}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      console.warn(`  [warn] could not list state bills dir: ${(err as Error).message}`);
    }
  }
  return idx;
}

function relatedBillsFor(
  project: { state: string; storyBlurb?: string; primaryBeneficiary?: string; name: string; developer: string },
  idx: BillIndex,
  limit = 3,
): string[] {
  const text = `${project.name} ${project.developer} ${project.storyBlurb ?? ""} ${project.primaryBeneficiary ?? ""}`;
  const ptokens = new Set(tokenize(text));
  const candidates = [
    ...(idx.byState.get(project.state) ?? []),
    ...idx.federal,
  ];
  const scored: Array<{ id: string; score: number }> = [];
  for (const c of candidates) {
    let overlap = 0;
    for (const t of c.tokens) if (ptokens.has(t)) overlap++;
    if (overlap >= 2) scored.push({ id: c.id, score: overlap });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.id);
}

function slugId(name: string, state: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 50);
  return `us-${state.toLowerCase()}-${slug}`;
}

async function main() {
  const report = startRunReport("us-housing-projects");
  report.incrementTotal(1);
  console.log("[us-housing-projects] Starting...");

  const anthropic = new Anthropic();
  const plans = [...FEDERAL_PLANS, ...STATE_PLANS];

  let snippets: Snippet[];
  try {
    snippets = await gather(plans);
  } catch (err) {
    if (err instanceof TavilyBudgetExhausted) {
      report.addNote(err.message);
      report.noteFailure({
        entity: "us-housing-projects",
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
        entity: "us-housing-projects",
        error: err.message,
        retryable: true,
        next_action: "retry when Tavily recovers",
      });
      report.finish("failed");
      return;
    }
    throw err;
  }
  report.recordUsage("tavily", { calls: plans.length, credits_consumed: plans.length });

  if (snippets.length === 0) {
    console.warn("[us-housing-projects] no snippets");
    report.noteFailure({
      entity: "us-housing-projects",
      error: "no Tavily results",
      retryable: true,
      next_action: "investigate queries",
    });
    report.finish("failed");
    return;
  }
  console.log(`  gathered ${snippets.length} snippets across ${plans.length} searches`);

  let extracted: ExtractedProject[];
  try {
    extracted = await askClaude(anthropic, snippets);
    console.log(`  claude returned ${extracted.length} projects`);
  } catch (err) {
    report.noteFailure({
      entity: "us-housing-projects",
      error: `anthropic extract failed: ${(err as Error).message}`,
      retryable: true,
      next_action: "retry next run",
    });
    report.finish("failed");
    return;
  }
  report.recordUsage("anthropic", { calls: 1, approx_cost_usd: 0.18 });

  // Hallucination guard: accept any sourceUrl on one of the per-state
  // official domains we searched. Tavily Extract filters 404s below.
  const allowedHosts = new Set<string>();
  for (const plan of plans) {
    for (const d of plan.includeDomains ?? []) allowedHosts.add(d);
  }
  const snippetUrls = new Set(snippets.map((s) => s.url));
  const tied = extracted.filter((p) => {
    if (!p.sourceUrl) return false;
    try {
      const host = new URL(p.sourceUrl).hostname.replace(/^www\./, "");
      const onAllowed = Array.from(allowedHosts).some(
        (d) => host === d || host.endsWith("." + d),
      );
      if (onAllowed) return true;
      // Also accept the URL if it was returned directly by Tavily in the
      // snippet set (covers valid press-release outlets we didn't list).
      return snippetUrls.has(p.sourceUrl);
    } catch {
      return false;
    }
  });

  console.log(`  ${tied.length} projects passed domain/snippet guard; validating URLs...`);
  const reachable = await validateUrls(tied);
  report.recordUsage("tavily", { calls: 1, credits_consumed: Math.min(40, tied.length) });
  const final = tied.filter((p) => reachable.has(p.sourceUrl));
  console.log(`  ${final.length} projects survived URL validation`);
  if (final.length === 0) {
    console.warn("[us-housing-projects] no projects passed URL validation");
    report.noteFailure({
      entity: "us-housing-projects",
      error: "no projects passed URL validation",
      retryable: true,
      next_action: "re-run next week",
    });
    report.finish("failed");
    return;
  }

  const billIndex = loadBillIndex();

  // Map to HousingProject + run validator. Bad records are dropped with a warning.
  const projects: Array<Record<string, unknown>> = [];
  for (const p of final) {
    const stateLabel = p.state === "FEDERAL" ? "FEDERAL" : p.state;
    const candidate = {
      id: slugId(p.name, stateLabel),
      developer: p.developer,
      projectName: p.name,
      location: p.city,
      state: stateLabel,
      country: "United States",
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
      relatedBillIds: relatedBillsFor(
        { state: stateLabel, storyBlurb: p.storyBlurb, primaryBeneficiary: p.primaryBeneficiary, name: p.name, developer: p.developer },
        billIndex,
      ),
      sources:
        p.sources && p.sources.length > 0
          ? p.sources.filter((s) => snippetUrls.has(s.url) || reachable.has(s.url))
          : undefined,
    };
    const { project, errors } = validateHousingProject(candidate);
    if (!project) {
      console.warn(`  [drop] ${candidate.id}: ${errors.slice(0, 3).join("; ")}`);
      continue;
    }
    projects.push(project as unknown as Record<string, unknown>);
  }

  const STATUS_RANK: Record<HousingProjectStatus, number> = {
    operational: 3,
    "under-construction": 2,
    proposed: 1,
  };
  projects.sort((a, b) => STATUS_RANK[b.status as HousingProjectStatus] - STATUS_RANK[a.status as HousingProjectStatus]);

  const output = {
    country: "United States",
    currency: "USD",
    lastUpdated: new Date().toISOString().slice(0, 10),
    projects,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), { encoding: "utf8" });
  console.log(`[us-housing-projects] wrote ${projects.length} projects → ${OUT_PATH}`);
  report.noteSuccess("us-housing-projects");
  const finalReport = report.finish();
  console.log(
    `[us-housing-projects] exit status=${finalReport.status} duration=${finalReport.duration_ms}ms`,
  );

  // Quick console summary by state for the operator running the script.
  const byState = new Map<string, number>();
  for (const p of projects) {
    const k = String((p as { state?: string }).state ?? "?");
    byState.set(k, (byState.get(k) ?? 0) + 1);
  }
  console.log("  per-state count:", Object.fromEntries(byState));
  console.log("  state names:", Object.values(STATE_NAME).join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

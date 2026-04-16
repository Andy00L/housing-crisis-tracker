/**
 * Research major Canadian housing projects. Tavily-backed.
 *
 * Pipeline:
 *   1. Federal search: Build Canada Homes + CMHC announcements
 *   2. Per-province search: major developments, CMHC co-funded, social housing
 *   3. Claude extracts structured project records from Tavily snippets
 *   4. Tavily Extract validates every sourceUrl (drops 404s)
 *   5. Write data/projects/canada.json
 *
 * Budget: ~120 Tavily credits for a full refresh. Safe to run weekly.
 *
 * Output shape matches HousingProject in @/types plus id, blurb, and
 * announceDate for the UI "Projects we're tracking" table.
 */

import "../env.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type { ImpactTag, HousingProjectStatus } from "@/types";
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
const OUT_PATH = join(ROOT, "data/projects/canada.json");

const MODEL = "claude-sonnet-4-6";

// ── Search plan ──────────────────────────────────────────────────────
interface SearchPlan {
  label: string;
  query: string;
  includeDomains?: string[];
}

const FEDERAL_SEARCHES: SearchPlan[] = [
  {
    label: "Build Canada Homes",
    query: "Build Canada Homes project 2026 affordable housing announcement",
    includeDomains: ["canada.ca", "cmhc-schl.gc.ca", "housing-infrastructure.canada.ca"],
  },
  {
    label: "CMHC announcements",
    query: "CMHC Canada 2025 2026 affordable housing development funding announcement",
    includeDomains: ["cmhc-schl.gc.ca", "canada.ca"],
  },
  {
    label: "Apartment Construction Loan Program",
    query: "Canada Apartment Construction Loan Program ACLP affordable housing 2026",
    includeDomains: ["cmhc-schl.gc.ca", "canada.ca"],
  },
];

const PROVINCIAL_SEARCHES: SearchPlan[] = [
  {
    label: "Ontario major developments",
    query: "Ontario Toronto major housing development 2025 2026 affordable units announcement",
    includeDomains: ["ontario.ca", "toronto.ca", "cmhc-schl.gc.ca"],
  },
  {
    label: "Quebec major developments",
    query: "Quebec Montreal major housing development 2025 2026 logement abordable annonce",
    includeDomains: ["quebec.ca", "montreal.ca", "cmhc-schl.gc.ca"],
  },
  {
    label: "BC major developments",
    query: "British Columbia Vancouver major housing development 2025 2026 affordable announcement BC Builds",
    includeDomains: ["gov.bc.ca", "vancouver.ca", "cmhc-schl.gc.ca"],
  },
  {
    label: "Alberta major developments",
    query: "Alberta Calgary Edmonton major housing development 2025 2026 affordable announcement",
    includeDomains: ["alberta.ca", "calgary.ca", "edmonton.ca", "cmhc-schl.gc.ca"],
  },
  {
    label: "Other provinces",
    query: "Manitoba Saskatchewan Nova Scotia New Brunswick major housing development 2025 2026",
    includeDomains: ["cmhc-schl.gc.ca", "canada.ca"],
  },
];

// ── Types ───────────────────────────────────────────────────────────
interface Snippet {
  url: string;
  title: string;
  content: string;
  score: number;
  source: string;
}

interface ExtractedProject {
  id: string;
  name: string;
  developer: string;
  province: string;
  city?: string;
  unitCount?: number;
  affordableUnits?: number;
  projectCost?: number;
  currency: "CAD";
  projectType: "rental" | "condo" | "mixed" | "social" | "cooperative";
  status: HousingProjectStatus;
  announceDate?: string;
  sourceUrl: string;
  blurb: string;
  concerns?: ImpactTag[];
}

// ── Gather ──────────────────────────────────────────────────────────
async function gatherSnippets(plan: SearchPlan[]): Promise<Snippet[]> {
  const seen = new Map<string, Snippet>();
  for (const p of plan) {
    let resp: TavilySearchResponse;
    try {
      resp = await searchTavily(p.query, {
        searchDepth: "basic",
        topic: "news",
        maxResults: 15,
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
          score: r.score,
          source: p.label,
        });
      }
    }
  }
  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 50); // Claude context budget
}

// ── Claude extract ──────────────────────────────────────────────────
function buildPrompt(snippets: Snippet[]): string {
  const context = snippets
    .map(
      (s, i) =>
        `[${i + 1}] (${s.source}) ${s.title}\n    URL: ${s.url}\n    ${s.content.slice(0, 500)}`,
    )
    .join("\n\n");

  return `You are extracting Canadian housing development projects from web search snippets.

SNIPPETS:
${context}

RULES:
1. Use ONLY the snippets above. Do NOT invent projects, unit counts, or URLs.
2. sourceUrl MUST be copied verbatim from one of the snippet URL lines.
3. Drop entries where you cannot cite a specific snippet.
4. Return 15-40 housing projects. Prefer projects with concrete unit counts.
5. For unknown unit counts, set unitCount to null (DO NOT fabricate).
6. Each project must be a REAL residential development: new construction, renovation, or a named funding announcement that ties to a specific site.
7. Exclude pure policy announcements with no site (those belong in legislation, not projects).
8. projectType must be one of: rental, condo, mixed, social, cooperative.
9. status must be one of: operational, under-construction, proposed.
10. Use Canadian provincial codes: ON, QC, BC, AB, MB, SK, NS, NB, NL, PE, YT, NT, NU.
11. currency is always "CAD".

Return a SINGLE JSON object (no markdown fences) with this exact shape:

{
  "projects": [
    {
      "name": "project or development name",
      "developer": "lead developer, agency, or proponent",
      "province": "two-letter code",
      "city": "city name (optional)",
      "unitCount": 120,
      "affordableUnits": 30,
      "projectCost": 45000000,
      "currency": "CAD",
      "projectType": "rental|condo|mixed|social|cooperative",
      "status": "proposed|under-construction|operational",
      "announceDate": "YYYY-MM-DD",
      "sourceUrl": "one of the URLs above",
      "blurb": "1-2 sentence plain-language summary",
      "concerns": ["impact tag if relevant: affordability, density, displacement, social-housing, indigenous-housing, transit-oriented"]
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
  const parsed = JSON.parse(candidate.slice(first, last + 1)) as {
    projects?: unknown[];
  };
  if (!Array.isArray(parsed.projects)) {
    throw new Error("response missing 'projects' array");
  }
  const out: ExtractedProject[] = [];
  for (const p of parsed.projects as Array<Record<string, unknown>>) {
    if (!p.name || !p.developer || !p.province || !p.sourceUrl) continue;
    const projectType = String(p.projectType ?? "rental");
    const status = String(p.status ?? "proposed");
    const allowedTypes = ["rental", "condo", "mixed", "social", "cooperative"];
    const allowedStatus: HousingProjectStatus[] = ["proposed", "under-construction", "operational"];
    if (!allowedTypes.includes(projectType)) continue;
    if (!allowedStatus.includes(status as HousingProjectStatus)) continue;
    const id = `ca-${String(p.province).toLowerCase()}-${String(p.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 50)}`;
    out.push({
      id,
      name: String(p.name),
      developer: String(p.developer),
      province: String(p.province).toUpperCase(),
      city: typeof p.city === "string" ? p.city : undefined,
      unitCount:
        typeof p.unitCount === "number" && p.unitCount > 0 ? p.unitCount : undefined,
      affordableUnits:
        typeof p.affordableUnits === "number" && p.affordableUnits >= 0
          ? p.affordableUnits
          : undefined,
      projectCost:
        typeof p.projectCost === "number" && p.projectCost > 0
          ? p.projectCost
          : undefined,
      currency: "CAD",
      projectType: projectType as ExtractedProject["projectType"],
      status: status as HousingProjectStatus,
      announceDate: typeof p.announceDate === "string" ? p.announceDate : undefined,
      sourceUrl: String(p.sourceUrl),
      blurb: typeof p.blurb === "string" ? p.blurb : String(p.name),
      concerns: Array.isArray(p.concerns)
        ? (p.concerns as string[]).filter(Boolean).map(String) as ImpactTag[]
        : undefined,
    });
  }
  return out;
}

async function askClaude(
  anthropic: Anthropic,
  snippets: Snippet[],
): Promise<ExtractedProject[]> {
  const prompt = buildPrompt(snippets);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 8000,
        messages: [{ role: "user", content: prompt }],
      });
      return parseProjects(extractText(msg));
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

// ── URL validation ──────────────────────────────────────────────────
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
      return new Set(urls); // trust the LLM, mark this in the report
    }
    throw err;
  }
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const report = startRunReport("housing-projects");
  const anthropic = new Anthropic();

  console.log("[housing-projects] Starting...");

  const plan = [...FEDERAL_SEARCHES, ...PROVINCIAL_SEARCHES];
  report.incrementTotal(1);

  let snippets: Snippet[];
  try {
    snippets = await gatherSnippets(plan);
  } catch (err) {
    if (err instanceof TavilyBudgetExhausted) {
      report.addNote(err.message);
      report.noteFailure({
        entity: "housing-projects",
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
        entity: "housing-projects",
        error: err.message,
        retryable: true,
        next_action: "retry when Tavily recovers",
      });
      report.finish("failed");
      return;
    }
    throw err;
  }

  report.recordUsage("tavily", {
    calls: plan.length,
    credits_consumed: plan.length,
  });

  if (snippets.length === 0) {
    console.warn("[housing-projects] no snippets returned");
    report.noteFailure({
      entity: "housing-projects",
      error: "no Tavily results",
      retryable: true,
      next_action: "investigate queries or Tavily availability",
    });
    report.finish("failed");
    return;
  }
  console.log(`  gathered ${snippets.length} snippets from ${plan.length} searches`);

  let extracted: ExtractedProject[];
  try {
    extracted = await askClaude(anthropic, snippets);
  } catch (err) {
    report.noteFailure({
      entity: "housing-projects",
      error: `anthropic extract failed: ${(err as Error).message}`,
      retryable: true,
      next_action: "retry next run",
    });
    report.finish("failed");
    return;
  }
  report.recordUsage("anthropic", { calls: 1, approx_cost_usd: 0.12 });

  // Only keep projects whose sourceUrl matches a snippet we saw.
  const snippetUrls = new Set(snippets.map((s) => s.url));
  const vetted = extracted.filter((p) => {
    const trimmed = p.sourceUrl.replace(/^https?:\/\//, "");
    return Array.from(snippetUrls).some((u) => u.endsWith(trimmed));
  });

  const reachable = await validateUrls(vetted);
  report.recordUsage("tavily", {
    calls: 1,
    credits_consumed: Math.min(40, vetted.length),
  });

  const final = vetted.filter((p) => reachable.has(p.sourceUrl));

  if (final.length === 0) {
    console.warn("[housing-projects] no projects passed validation");
    report.noteFailure({
      entity: "housing-projects",
      error: "no projects passed URL validation",
      retryable: true,
      next_action: "re-run next week",
    });
    report.finish("failed");
    return;
  }

  // Sort: operational first, then by announceDate desc.
  const STATUS_ORDER: Record<HousingProjectStatus, number> = {
    operational: 3,
    "under-construction": 2,
    proposed: 1,
  };
  final.sort((a, b) => {
    const s = STATUS_ORDER[b.status] - STATUS_ORDER[a.status];
    if (s !== 0) return s;
    return (b.announceDate ?? "").localeCompare(a.announceDate ?? "");
  });

  const output = {
    country: "Canada",
    currency: "CAD",
    lastUpdated: new Date().toISOString().slice(0, 10),
    projects: final,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
  console.log(`[housing-projects] wrote ${final.length} projects → ${OUT_PATH}`);
  report.noteSuccess("housing-projects");
  const finalReport = report.finish();
  console.log(
    `[housing-projects] exit status=${finalReport.status} duration=${finalReport.duration_ms}ms`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

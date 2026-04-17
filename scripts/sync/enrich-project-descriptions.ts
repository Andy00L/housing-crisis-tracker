/**
 * Enrich NHS housing project descriptions with Tavily search + Claude Haiku.
 *
 * Reads:  data/projects/canada.json
 * Writes: data/projects/canada.json (in-place update, adds storyBlurb field)
 * Report: data/raw/_run-reports/enrich-projects-{ts}.json
 *
 * Selects the top 100 projects by unit count that have generic CMHC boilerplate
 * descriptions and enriches each with a 2-3 sentence factual blurb based on
 * Tavily search results and Claude Haiku summarization.
 *
 * Budget: ~100 Tavily credits (basic search, 1 credit each) + ~50K Haiku tokens.
 * One-time enrichment, not a weekly pipeline. Not wired into GitHub Actions.
 *
 * Usage:
 *   npx tsx scripts/sync/enrich-project-descriptions.ts
 *   npx tsx scripts/sync/enrich-project-descriptions.ts --dry-run
 *   ENRICH_MAX=20 npx tsx scripts/sync/enrich-project-descriptions.ts
 */

import "../env.js";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import {
  searchTavily,
  TavilyBudgetExhausted,
  TavilyUnavailable,
} from "@/lib/tavily-client";
import { startRunReport } from "@/lib/resilience/run-report";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const DATA_PATH = join(ROOT, "data/projects/canada.json");

const MODEL = "claude-haiku-4-5-20251001";
const MAX_PROJECTS = process.env.ENRICH_MAX
  ? Number(process.env.ENRICH_MAX)
  : 100;
const DRY_RUN = process.argv.includes("--dry-run");

// ── Types (matching the on-disk JSON shape) ─────────────────────────
interface CaProject {
  id: string;
  name: string;
  developer?: string;
  province?: string;
  city?: string;
  unitCount?: number;
  affordableUnits?: number;
  projectCost?: number;
  currency?: string;
  projectType?: string;
  status?: string;
  sourceUrl?: string;
  blurb?: string;
  concerns?: string[];
  lat?: number;
  lng?: number;
  storyBlurb?: string;
  [key: string]: unknown;
}

interface CanadaProjectsFile {
  country: string;
  currency: string;
  lastUpdated: string;
  projects: CaProject[];
  [key: string]: unknown;
}

// ── Generic description detection ───────────────────────────────────
function isGenericDescription(blurb?: string): boolean {
  if (!blurb || blurb.length < 30) return true;
  const lower = blurb.toLowerCase();
  return (
    lower.includes("affordable and in good condition") ||
    lower.includes("housing is adequate") ||
    lower.includes("housing is in good condition") ||
    (lower.startsWith("nhs program:") && !lower.includes(". ")) ||
    /^federal commitment:\s*\$[\d.,]+[mk]?\.?$/i.test(blurb.trim())
  );
}

// ── Tavily search + Claude enrichment ───────────────────────────────
async function enrichProject(
  anthropic: Anthropic,
  project: CaProject,
): Promise<string | null> {
  const city = project.city ?? "";
  const province = project.province ?? "";
  const name = project.name ?? "";
  if (!city && !name) return null;

  const query = `"${city}" "${name}" housing project ${province} Canada`;

  let context = "";
  try {
    const results = await searchTavily(query, {
      searchDepth: "basic",
      maxResults: 3,
    });
    if (!results.results || results.results.length === 0) return null;

    context = results.results
      .map((r) => r.content?.substring(0, 300))
      .filter(Boolean)
      .join("\n\n");

    if (!context || context.length < 50) return null;
  } catch (err) {
    if (
      err instanceof TavilyBudgetExhausted ||
      err instanceof TavilyUnavailable
    ) {
      throw err;
    }
    console.warn(`  [skip] tavily failed for "${name}": ${(err as Error).message}`);
    return null;
  }

  // Extract the NHS program from existing blurb if present
  const nhsProgram = project.blurb?.match(/NHS program: ([^.]+)/)?.[1] ?? "NHS";

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `Write a 2-3 sentence factual description of this housing project based on the search results below. Include the developer or organization name if found, the neighborhood, and what makes this project notable (size, target population, construction method). No marketing language. No superlatives. No long dashes.

Project: ${name}
Location: ${city}, ${province}
Units: ${project.unitCount ?? "unknown"}
Program: ${nhsProgram}

Search results:
${context}

Description (2-3 sentences, factual, direct):`,
        },
      ],
    });

    const text = msg.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!text || text.length < 20) return null;

    // Discard if the description mentions a different city (hallucination guard)
    if (city && !text.toLowerCase().includes(city.toLowerCase().slice(0, 5))) {
      console.warn(`  [skip] "${name}": description mentions wrong city`);
      return null;
    }

    return text;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 529 || status === 503 || status === 429) {
      throw err; // let caller handle retryable errors
    }
    console.warn(`  [skip] claude failed for "${name}": ${(err as Error).message}`);
    return null;
  }
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const report = startRunReport("enrich-projects");
  console.log("[enrich-projects] Starting...");
  console.log(`  Max projects: ${MAX_PROJECTS}, Dry run: ${DRY_RUN}`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[enrich-projects] ANTHROPIC_API_KEY not set");
    process.exit(1);
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let fileContent: string;
  try {
    fileContent = readFileSync(DATA_PATH, "utf8");
  } catch {
    console.error(`[enrich-projects] Cannot read ${DATA_PATH}`);
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch (err) {
    console.error(
      `[enrich-projects] Malformed JSON in ${DATA_PATH}: ${(err as Error).message}`,
    );
    process.exit(1);
  }

  let wrapper: CanadaProjectsFile | null = null;
  let projects: CaProject[];

  if (Array.isArray(parsed)) {
    projects = parsed as CaProject[];
  } else if (
    parsed !== null &&
    typeof parsed === "object" &&
    Array.isArray((parsed as CanadaProjectsFile).projects)
  ) {
    wrapper = parsed as CanadaProjectsFile;
    projects = wrapper.projects;
  } else {
    console.error("[enrich-projects] Unexpected data format in canada.json");
    process.exit(1);
  }

  // Select projects with generic descriptions, sorted by unit count
  const candidates = projects
    .filter((p) => isGenericDescription(p.blurb) && !p.storyBlurb && p.city)
    .sort((a, b) => (b.unitCount ?? 0) - (a.unitCount ?? 0))
    .slice(0, MAX_PROJECTS);

  const genericTotal = projects.filter((p) => isGenericDescription(p.blurb) && !p.storyBlurb).length;
  console.log(
    `  Total projects: ${projects.length}, generic: ${genericTotal}, selected (with city): ${candidates.length}`,
  );
  report.incrementTotal(candidates.length);

  // Build a lookup by ID for efficient in-place updates
  const projectById = new Map<string, CaProject>();
  for (const p of projects) {
    projectById.set(p.id, p);
  }

  let enriched = 0;
  let skipped = 0;
  let tavilyBudgetHit = false;

  for (const candidate of candidates) {
    if (tavilyBudgetHit) {
      console.log(`  [stop] Tavily budget exhausted, stopping enrichment`);
      break;
    }

    try {
      const description = await enrichProject(anthropic, candidate);
      if (description) {
        if (!DRY_RUN) {
          const target = projectById.get(candidate.id);
          if (target) {
            target.storyBlurb = description;
          }
        }
        enriched++;
        report.noteSuccess(candidate.id);
        if (enriched <= 5 || enriched % 20 === 0) {
          console.log(
            `  [${enriched}/${candidates.length}] ${candidate.name} (${candidate.city}): ${description.substring(0, 80)}...`,
          );
        }
      } else {
        skipped++;
        report.noteSuccess(candidate.id);
      }
    } catch (err) {
      if (err instanceof TavilyBudgetExhausted) {
        tavilyBudgetHit = true;
        console.warn(`[enrich-projects] Tavily budget exhausted`);
        report.addNote(err.message);
        continue;
      }
      if (err instanceof TavilyUnavailable) {
        console.error(`  [ERROR] Tavily unavailable: ${err.message}`);
        report.markSourceDegraded("tavily");
        break;
      }
      // Anthropic retryable errors: back off and retry once
      const status = (err as { status?: number }).status;
      if (status === 529 || status === 503 || status === 429) {
        console.log(`  [retry] anthropic ${status}, waiting 10s`);
        await new Promise((r) => setTimeout(r, 10000));
        // retry once
        try {
          const description = await enrichProject(anthropic, candidate);
          if (description && !DRY_RUN) {
            const target = projectById.get(candidate.id);
            if (target) target.storyBlurb = description;
            enriched++;
          } else {
            skipped++;
          }
          report.noteSuccess(candidate.id);
        } catch {
          skipped++;
          report.noteFailure({
            entity: candidate.id,
            error: `anthropic retry failed`,
            retryable: true,
            next_action: "retry next run",
          });
        }
        continue;
      }
      console.error(`  [ERROR] ${candidate.name}:`, err);
      report.noteFailure({
        entity: candidate.id,
        error: (err as Error).message,
        retryable: true,
        next_action: "retry next run",
      });
    }

    // Rate limit: 500ms between Tavily calls
    await new Promise((r) => setTimeout(r, 500));
  }

  // Write back, preserving the wrapper object if present
  if (!DRY_RUN && enriched > 0) {
    const output = wrapper ?? projects;
    writeFileSync(DATA_PATH, JSON.stringify(output, null, 2) + "\n");
    console.log(`\n[enrich-projects] Wrote ${enriched} enriched projects back to ${DATA_PATH}`);
  } else if (DRY_RUN) {
    console.log(`\n[enrich-projects] Dry run. ${enriched} projects would have been enriched.`);
  }

  const finalReport = report.finish();
  console.log(
    `[enrich-projects] enriched=${enriched} skipped=${skipped} ` +
      `status=${finalReport.status} duration=${finalReport.duration_ms}ms`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

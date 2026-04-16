/**
 * Research municipal (county / city) AI & data-center actions for states
 * not yet covered in data/municipal/.
 *
 * For each target state, asks Claude Opus to identify notable 2024–2026
 * local-government actions (moratoriums, zoning votes, utility contracts,
 * community oversight, etc.) with real, cite-able source URLs.
 *
 * Writes one JSON file per state into data/municipal/.
 * Uses a cache at data/raw/claude/municipal-research.json keyed by state.
 *
 * Budget controls:
 *   - Incremental cache: re-runs skip already-fetched states.
 *   - RESEARCH_MAX env var caps calls per run.
 */

import "../env.js";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const OUT_DIR = join(ROOT, "data/municipal");
const CACHE_DIR = join(ROOT, "data/raw/claude");
const CACHE_PATH = join(CACHE_DIR, "municipal-research.json");

const MODEL = "claude-opus-4-6";
const MAX_CALLS = process.env.RESEARCH_MAX
  ? Number(process.env.RESEARCH_MAX)
  : Infinity;

// Target states — notable DC / AI local-gov activity, not yet in data/municipal/.
const TARGETS: { name: string; code: string; slug: string }[] = [
  { name: "Arizona", code: "AZ", slug: "arizona" },
  { name: "Ohio", code: "OH", slug: "ohio" },
  { name: "Washington", code: "WA", slug: "washington" },
  { name: "Nevada", code: "NV", slug: "nevada" },
  { name: "Indiana", code: "IN", slug: "indiana" },
  { name: "Illinois", code: "IL", slug: "illinois" },
  { name: "Iowa", code: "IA", slug: "iowa" },
  { name: "Nebraska", code: "NE", slug: "nebraska" },
  { name: "Utah", code: "UT", slug: "utah" },
  { name: "New Jersey", code: "NJ", slug: "new-jersey" },
  { name: "Pennsylvania", code: "PA", slug: "pennsylvania" },
  { name: "Massachusetts", code: "MA", slug: "massachusetts" },
  { name: "Mississippi", code: "MS", slug: "mississippi" },
  { name: "Alabama", code: "AL", slug: "alabama" },
  { name: "Colorado", code: "CO", slug: "colorado" },
  { name: "Michigan", code: "MI", slug: "michigan" },
  { name: "Missouri", code: "MO", slug: "missouri" },
  { name: "Kentucky", code: "KY", slug: "kentucky" },
  { name: "Louisiana", code: "LA", slug: "louisiana" },
  { name: "Oklahoma", code: "OK", slug: "oklahoma" },
];

type Status = "enacted" | "proposed" | "under-review" | "failed";

type ImpactTag =
  | "affordability"
  | "environmental-review"
  | "public-land"
  | "environmental-review"
  | "transit-oriented"
  | "density"
  | "mortgage-regulation"
  | "social-housing"
  | "community-opposition"
  | "inclusionary-zoning"
  | "nimby"
  | "displacement"
  | "affordability"
  | "vacancy-tax"
  | "first-time-buyer"
  | "density"
  | "heritage-protection"
  | "rent-stabilization"
  | "homelessness"
  | "short-term-rental"
  | "social-housing"
  | "displacement"
  | "indigenous-housing"
  | "community-opposition"
  | "foreign-buyer";

interface ResearchedAction {
  title: string;
  date: string;
  status: Status;
  summary: string;
  sourceUrl: string;
  confidence: "high" | "medium" | "low";
}

interface ResearchedMunicipality {
  id: string;
  name: string;
  fips: string;
  state: string;
  stateCode: string;
  type: "county" | "city" | "town" | "township";
  actions: ResearchedAction[];
  concerns: ImpactTag[];
  contextBlurb: string;
}

type CacheFile = Record<string, ResearchedMunicipality[]>;

const SYSTEM_PROMPT = `You are a policy research analyst. For a given US state, identify notable 2024–2026 county/city-level government actions related to AI or data-center policy (moratoriums, zoning amendments, utility agreements, siting approvals, noise ordinances, tax-incentive votes, etc.).

Critical rules:
  - Return ONLY real, well-documented actions you can cite with a real source URL. If you cannot find a genuine source, DO NOT include the entry.
  - Prefer entries you have high confidence about. Set "confidence" accurately: "high" = direct recollection of specific coverage; "medium" = general awareness; "low" = uncertain (usually skip these).
  - COUNTY-LEVEL ONLY. Municipal actions taken by cities/towns must be FOLDED INTO the county they sit in — e.g. Mesa actions go into the Maricopa County entry with "(Mesa)" or "(City of Mesa)" prefixed to the action title. This is because our map renders county shapes, not cities.
  - Return at most 6 counties per state. Fewer is better than made up.
  - Each county needs a real 5-digit FIPS code (state 2-digit prefix + 3-digit county code, zero-padded). If you don't know the exact FIPS, skip the entry.
  - Dates: YYYY-MM-DD format. Prefer real calendar dates; if only the month is known, use the first of the month.
  - If the state has no notable municipal-level AI/DC activity, return an empty array.

Status semantics:
  - enacted: passed / in effect
  - proposed: filed but not yet voted on / under active consideration
  - under-review: in committee, study, or public-hearing phase
  - failed: voted down, vetoed, or legally overturned

Return ONLY a JSON array — no prose, no markdown fences — matching this schema:

[
  {
    "id": "<slug>-<statecode-lower>",      // e.g. "maricopa-county-az"
    "name": "<County Name>",                // e.g. "Maricopa County"
    "fips": "<5-digit>",                    // e.g. "04013"
    "state": "<State Name>",
    "stateCode": "<XX>",
    "type": "county",
    "actions": [
      {
        "title": "<what the action is>",
        "date": "YYYY-MM-DD",
        "status": "enacted" | "proposed" | "under-review" | "failed",
        "summary": "<1–2 sentences, plain language>",
        "sourceUrl": "<full https URL>",
        "confidence": "high" | "medium" | "low"
      }
    ],
    "concerns": ["<ImpactTag>", ...],      // from: water-consumption, carbon-emissions, protected-land, environmental-review, renewable-energy, grid-capacity, energy-rates, water-infrastructure, noise-vibration, local-zoning, local-control, residential-proximity, property-values, tax-incentives, job-creation, economic-development, nda-transparency
    "contextBlurb": "<2–3 sentence summary of this municipality's situation>"
  }
]

If nothing qualifies, return [].`;

function loadCache(): CacheFile {
  if (!existsSync(CACHE_PATH)) return {};
  return JSON.parse(readFileSync(CACHE_PATH, "utf8")) as CacheFile;
}

function saveCache(cache: CacheFile) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

function parseJsonBlock(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const first = candidate.indexOf("[");
  const last = candidate.lastIndexOf("]");
  if (first === -1 || last === -1) return [];
  return JSON.parse(candidate.slice(first, last + 1));
}

function extractText(msg: Anthropic.Messages.Message): string {
  const parts: string[] = [];
  for (const block of msg.content) {
    if (block.type === "text") parts.push(block.text);
  }
  return parts.join("\n");
}

async function researchState(
  anthropic: Anthropic,
  state: { name: string; code: string },
): Promise<ResearchedMunicipality[]> {
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `State: ${state.name} (${state.code})\n\nReturn the JSON array.`,
      },
    ],
  });

  const parsed = parseJsonBlock(extractText(msg));
  if (!Array.isArray(parsed)) return [];
  return parsed as ResearchedMunicipality[];
}

function stripConfidence(r: ResearchedMunicipality): unknown {
  return {
    id: r.id,
    name: r.name,
    fips: r.fips,
    state: r.state,
    stateCode: r.stateCode,
    type: r.type,
    actions: r.actions.map((a) => ({
      title: a.title,
      date: a.date,
      status: a.status,
      summary: a.summary,
      sourceUrl: a.sourceUrl,
    })),
    concerns: r.concerns,
    contextBlurb: r.contextBlurb,
  };
}

async function main() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("[muni-research] ANTHROPIC_API_KEY not set");
    process.exit(1);
  }
  const anthropic = new Anthropic({ apiKey: key });

  const cache = loadCache();
  mkdirSync(OUT_DIR, { recursive: true });

  const todo = TARGETS.filter((s) => !cache[s.name]);
  console.log(
    `[muni-research] ${TARGETS.length} target states · ${todo.length} uncached · cap=${MAX_CALLS}`,
  );

  let calls = 0;
  let written = 0;
  for (const state of todo) {
    if (calls >= MAX_CALLS) {
      console.log(`[muni-research] cap reached`);
      break;
    }
    try {
      const result = await researchState(anthropic, state);
      cache[state.name] = result;
      calls += 1;
      saveCache(cache);

      const highConf = result.filter((m) =>
        m.actions.some((a) => a.confidence === "high"),
      );
      console.log(
        `[muni-research] ${state.name}: ${result.length} municipalities, ${highConf.length} with high-confidence actions`,
      );
      for (const m of result) {
        const c = m.actions.map((a) => a.confidence[0]).join("");
        console.log(`                · ${m.name} [${c}]`);
      }
    } catch (e) {
      console.warn(
        `[muni-research] ${state.name} failed:`,
        (e as Error).message,
      );
    }
  }

  // Write JSONs (strip confidence before writing)
  for (const state of TARGETS) {
    const data = cache[state.name];
    if (!data || data.length === 0) continue;
    // Drop any entry whose actions are ALL low-confidence.
    const filtered = data.filter((m) =>
      m.actions.some((a) => a.confidence !== "low"),
    );
    if (filtered.length === 0) continue;
    const out = filtered.map(stripConfidence);
    writeFileSync(
      join(OUT_DIR, `${state.slug}.json`),
      JSON.stringify(out, null, 2),
    );
    written += 1;
  }

  console.log(
    `\n[muni-research] done · ${calls} Claude calls · ${written} JSON files written`,
  );
}

main().catch((e) => {
  console.error("[muni-research] fatal:", e.message);
  process.exit(1);
});

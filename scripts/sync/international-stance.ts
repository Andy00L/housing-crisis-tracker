/**
 * Research-grade per-lens stance classification for international entities.
 *
 * Hand-curated country/bloc entries in lib/international-entities.ts and
 * data/international/*.json currently have stanceZoning === stanceAffordability
 * (mechanical migration from the old single-stance field). This script
 * asks Claude Opus to re-evaluate each entity under both lenses, using
 * the entity's own contextBlurb + bill summaries + Opus's prior knowledge
 * of major international AI/DC frameworks.
 *
 * Writes to: data/raw/claude/international-stances.json
 *            keyed by entity id.
 *
 * Follow-up: run scripts/sync/international-stance-apply.ts to patch the
 * source files.
 */

import "../env.js";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type { StanceType } from "../../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const INTL_TS = join(ROOT, "lib/international-entities.ts");
const INTL_JSON_DIR = join(ROOT, "data/international");
const CACHE_DIR = join(ROOT, "data/raw/claude");
const CACHE_PATH = join(CACHE_DIR, "international-stances.json");

const MODEL = "claude-opus-4-6";
const MAX_CALLS = process.env.RESEARCH_MAX
  ? Number(process.env.RESEARCH_MAX)
  : Infinity;

interface StanceResult {
  stanceZoning: StanceType;
  stanceAffordability: StanceType;
  reasoning: string;
  classifiedAt: string;
}

type CacheFile = Record<string, StanceResult>;

interface EntityLite {
  id: string;
  name: string;
  contextBlurb: string;
  billSummaries: string[];
  source: "ts" | "json";
}

function loadCache(): CacheFile {
  if (!existsSync(CACHE_PATH)) return {};
  return JSON.parse(readFileSync(CACHE_PATH, "utf8")) as CacheFile;
}

function saveCache(cache: CacheFile) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

/**
 * Pull entity stubs from the TS file by matching the {id, name, contextBlurb}
 * triple within each object. This is fragile to formatting but the file is
 * hand-maintained with a stable shape.
 */
function loadTsEntities(): EntityLite[] {
  const src = readFileSync(INTL_TS, "utf8");
  const entities: EntityLite[] = [];
  // Entities sit at 4-space indent; keyFigures/legislation entries are
  // deeper. Anchor to ^    id to skip nested objects.
  const idRegex = /^    id: "([^"]+)",\n    geoId:[\s\S]*?^    name: "([^"]+)"[\s\S]*?^    contextBlurb:\s*("[^"]+"|`[^`]+`)/gm;
  let m: RegExpExecArray | null;
  while ((m = idRegex.exec(src))) {
    const id = m[1];
    const name = m[2];
    let raw = m[3];
    raw = raw.slice(1, -1);
    // Grab any bill titles/summaries following this entity until the next
    // `id: "..."` entity marker.
    const startIdx = idRegex.lastIndex;
    const nextIdIdx = src.indexOf('id: "', startIdx);
    const slice = src.slice(startIdx, nextIdIdx === -1 ? undefined : nextIdIdx);
    const billMatches = [
      ...slice.matchAll(/title: "([^"]+)"[\s\S]*?summary: "([^"]+)"/g),
    ];
    const billSummaries = billMatches
      .slice(0, 8)
      .map((b) => `- ${b[1]}: ${b[2]}`);
    entities.push({
      id,
      name,
      contextBlurb: raw,
      billSummaries,
      source: "ts",
    });
  }
  return entities;
}

function loadJsonEntities(): EntityLite[] {
  const files = readdirSync(INTL_JSON_DIR).filter((f) => f.endsWith(".json"));
  const entities: EntityLite[] = [];
  for (const f of files) {
    const data = JSON.parse(
      readFileSync(join(INTL_JSON_DIR, f), "utf8"),
    ) as {
      id: string;
      name: string;
      contextBlurb: string;
      legislation?: Array<{ title: string; summary: string }>;
    };
    const billSummaries = (data.legislation ?? [])
      .slice(0, 8)
      .map((l) => `- ${l.title}: ${l.summary}`);
    entities.push({
      id: data.id,
      name: data.name,
      contextBlurb: data.contextBlurb,
      billSummaries,
      source: "json",
    });
  }
  return entities;
}

const SYSTEM_PROMPT = `You are a senior AI and data-center policy analyst. You classify jurisdictions under two independent lenses:

1. Data-center lens — how the jurisdiction treats physical AI infrastructure buildout: siting, energy, water, zoning, environmental review, grid impact. Example DC-relevant laws: US state moratoriums, Ireland's grid connection pause, Ontario Bill 40, EU energy reporting rules (EnEfG), Virginia data center setback laws.

2. AI-regulation lens — how the jurisdiction treats AI systems: governance frameworks, risk classification, transparency, consumer/worker protection, synthetic media, sectoral AI rules. Example AI-relevant laws: EU AI Act, China's Generative AI Services rules + Algorithmic Recommendation provisions, Colorado AI Act, South Korea AI Basic Act, UK Principles-Based framework.

For each jurisdiction return JSON with these exact keys:

{
  "stanceZoning": "restrictive | concerning | review | favorable | none",
  "stanceAffordability": "restrictive | concerning | review | favorable | none",
  "reasoning": "1-2 sentences explaining the split — name the specific law(s) driving each stance"
}

Stance definitions:
  restrictive — active ban, moratorium, or enforceable prohibition on activity in this lens
  concerning — mandatory heavy regulation or strong restrictions advancing in this lens (EU AI Act = concerning on AI)
  review — studies, voluntary frameworks, exploratory work without hard restrictions (UK AI White Paper = review on AI)
  favorable — incentives, tax breaks, fast-tracking, permissive posture (Ontario Bill 40 = favorable on DC)
  none — this lens is not substantively addressed

Critical: a jurisdiction can (and often does) split across the two lenses. China is favorable on DC buildout but concerning on generative-AI services. The EU is review/favorable on DC infra but concerning on AI governance via the AI Act. Do not mirror stances unless they genuinely match.

Return ONLY the JSON — no prose, no markdown fences.`;

function parseJsonBlock(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  return JSON.parse(candidate.slice(first, last + 1));
}

function extractText(msg: Anthropic.Messages.Message): string {
  const parts: string[] = [];
  for (const block of msg.content) {
    if (block.type === "text") parts.push(block.text);
  }
  return parts.join("\n");
}

const VALID_STANCES: StanceType[] = [
  "restrictive",
  "concerning",
  "review",
  "favorable",
  "none",
];

async function classifyOne(
  anthropic: Anthropic,
  e: EntityLite,
): Promise<StanceResult> {
  const userContent = `Jurisdiction: ${e.name} (id: ${e.id})

Current contextBlurb: ${e.contextBlurb}
${
  e.billSummaries.length > 0
    ? `\nLegislation we have on file:\n${e.billSummaries.join("\n")}`
    : "\nNo legislation on file in our dataset."
}

Use this context plus your knowledge of major international AI & data-center policy frameworks through 2026. Return the JSON.`;

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userContent }],
  });

  const parsed = parseJsonBlock(extractText(msg)) as {
    stanceZoning: string;
    stanceAffordability: string;
    reasoning?: string;
  };

  if (!(VALID_STANCES as string[]).includes(parsed.stanceZoning)) {
    throw new Error(`invalid stanceZoning: ${parsed.stanceZoning}`);
  }
  if (!(VALID_STANCES as string[]).includes(parsed.stanceAffordability)) {
    throw new Error(`invalid stanceAffordability: ${parsed.stanceAffordability}`);
  }

  return {
    stanceZoning: parsed.stanceZoning as StanceType,
    stanceAffordability: parsed.stanceAffordability as StanceType,
    reasoning: parsed.reasoning ?? "",
    classifiedAt: new Date().toISOString(),
  };
}

async function main() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("[intl-stance] ANTHROPIC_API_KEY not set");
    process.exit(1);
  }
  const anthropic = new Anthropic({ apiKey: key });

  const cache = loadCache();
  const tsEntities = loadTsEntities();
  const jsonEntities = loadJsonEntities();

  // Dedupe by id — TS wins if duplicated.
  const seen = new Set<string>();
  const all: EntityLite[] = [];
  for (const e of [...tsEntities, ...jsonEntities]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    all.push(e);
  }

  const todo = all.filter((e) => !cache[e.id]);
  console.log(
    `[intl-stance] ${all.length} total entities · ${todo.length} uncached · cap=${MAX_CALLS}`,
  );

  let calls = 0;
  for (const e of todo) {
    if (calls >= MAX_CALLS) {
      console.log(`[intl-stance] cap reached`);
      break;
    }
    try {
      const result = await classifyOne(anthropic, e);
      cache[e.id] = result;
      calls += 1;
      saveCache(cache);
      console.log(
        `[intl-stance] ${calls}/${todo.length} · ${e.name} → DC=${result.stanceZoning}, AI=${result.stanceAffordability}`,
      );
      console.log(`              ${result.reasoning}`);
    } catch (err) {
      console.warn(
        `[intl-stance] ${e.id} (${e.name}) failed:`,
        (err as Error).message,
      );
    }
  }

  saveCache(cache);
  console.log(
    `\n[intl-stance] done · ${calls} calls · ${Object.keys(cache).length} entities cached`,
  );
}

main().catch((e) => {
  console.error("[intl-stance] fatal:", e.message);
  process.exit(1);
});

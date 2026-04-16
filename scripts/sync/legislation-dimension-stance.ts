/**
 * Per-dimension stance classification for multi-dimension bills.
 *
 * Some bills cut different ways across dimensions — e.g. a bill that
 * streamlines data-center permits (favorable on dc-energy) while adding
 * strict consumer data rules (restrictive on ai-consumer). The existing
 * cached bill-level `stance` collapses that nuance.
 *
 * This script: for every bill whose impactTags span ≥2 dimensions, asks
 * Claude for a per-dimension stance map and writes it to a separate cache.
 * Single-dimension / no-dimension bills are skipped — their bill-level
 * stance already reads correctly for their one dimension.
 *
 * Reads:
 *   - data/raw/legiscan/bills/{STATE}.json
 *   - data/raw/claude/classifications.json   (for impactTags)
 * Writes:
 *   - data/raw/claude/dimension-stances.json (keyed by bill_id)
 *
 * Budget controls:
 *   - Incremental cache: re-runs skip already-classified bills.
 *   - RECLASSIFY_MAX env var caps calls per run.
 */

import "../env.js";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type {
  Dimension,
  ImpactTag,
  StanceType,
} from "../../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const RAW_BILLS_DIR = join(ROOT, "data/raw/legiscan/bills");
const CACHE_DIR = join(ROOT, "data/raw/claude");
const SINGLE_STANCE_CACHE = join(CACHE_DIR, "classifications.json");
const DIM_STANCE_CACHE = join(CACHE_DIR, "dimension-stances.json");

const MODEL = "claude-sonnet-4-6";
const MAX_CALLS = process.env.RECLASSIFY_MAX
  ? Number(process.env.RECLASSIFY_MAX)
  : Infinity;

type DimKey = Exclude<Dimension, "overall">;

const DIMENSION_TAGS: Record<DimKey, ImpactTag[]> = {
  environmental: [
    "affordability",
    "environmental-review",
    "public-land",
    "environmental-review",
    "transit-oriented",
  ],
  supply: ["density", "mortgage-regulation", "social-housing"],
  "rental-market": [
    "community-opposition",
    "inclusionary-zoning",
    "nimby",
    "displacement",
    "affordability",
  ],
  "community-impact": [
    "public-land",
    "inclusionary-zoning",
    "displacement",
    "affordability",
  ],
  "social-housing": ["rent-stabilization", "homelessness"],
  "affordability": ["foreign-buyer", "community-opposition"],
  "ownership": ["short-term-rental", "displacement"],
};

const DIMENSION_DESCRIPTION: Record<DimKey, string> = {
  environmental: "environmental impact of data centers (water, carbon, land, reviews, renewables)",
  supply: "energy & grid impact of data centers (grid capacity, ratepayer costs, water infra)",
  "community-impact": "community impact of data centers (noise, zoning, local control, property values)",
  "social-housing": "AI governance (algorithmic transparency, safety, risk oversight)",
  "affordability": "AI consumer protection (privacy, data rights, child safety)",
  "rental-market": "AI in public services (healthcare, education)",
  "ownership": "synthetic media / deepfake regulation",
};

type SingleStanceCache = Record<
  string,
  { stance: StanceType; impactTags: ImpactTag[] }
>;

type DimStanceCache = Record<string, Partial<Record<DimKey, StanceType>>>;

interface RawBill {
  bill_id: number;
  bill_number: string;
  title: string;
  description?: string;
  state?: string;
}

function loadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function saveCache(cache: DimStanceCache) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(DIM_STANCE_CACHE, JSON.stringify(cache, null, 2));
}

function loadBills(): RawBill[] {
  const bills: RawBill[] = [];
  const files = readdirSync(RAW_BILLS_DIR).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const arr = JSON.parse(
      readFileSync(join(RAW_BILLS_DIR, f), "utf8"),
    ) as RawBill[];
    bills.push(...arr);
  }
  return bills;
}

function dimensionsForTags(tags: ImpactTag[]): DimKey[] {
  const dims: DimKey[] = [];
  for (const [dim, dimTags] of Object.entries(DIMENSION_TAGS) as [
    DimKey,
    ImpactTag[],
  ][]) {
    if (tags.some((t) => dimTags.includes(t))) dims.push(dim);
  }
  return dims;
}

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

function buildSystemPrompt(): string {
  return `You classify US legislation per policy dimension for an AI & data-center tracker.

Given a bill and a list of relevant dimensions, return a stance per dimension. Stances:
  - restrictive: active ban, moratorium, or enforceable prohibition on activity in that dimension
  - concerning:  mandatory heavy regulation or strong restrictions advancing in that dimension
  - review:      studies, commissions, exploratory work without hard restrictions
  - favorable:   incentives, tax breaks, fast-tracking, permissive/deregulatory for that dimension
  - none:        the bill is not actually substantive for that dimension

Critical: a single bill can have different stances across dimensions. Example: a bill that
fast-tracks data-center permits (favorable on "energy") while requiring strict consumer data
rules (restrictive on "affordability"). Do not default to one stance for all dimensions.

Return ONLY a JSON object — no prose, no markdown fences — matching this schema:
  { "<dimension>": "<stance>", ... }

Include every dimension I list. No extra dimensions.`;
}

async function classifyOne(
  anthropic: Anthropic,
  bill: RawBill,
  dims: DimKey[],
): Promise<Partial<Record<DimKey, StanceType>>> {
  const dimList = dims
    .map((d) => `  - ${d}: ${DIMENSION_DESCRIPTION[d]}`)
    .join("\n");
  const userContent = `State: ${bill.state ?? "unknown"}
Bill: ${bill.bill_number}
Title: ${bill.title}
${bill.description ? `Description: ${bill.description.slice(0, 1800)}` : ""}

Relevant dimensions for this bill:
${dimList}

Return stances for exactly these dimensions.`;

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: [
      {
        type: "text",
        text: buildSystemPrompt(),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userContent }],
  });

  const parsed = parseJsonBlock(extractText(msg)) as Record<string, string>;
  const out: Partial<Record<DimKey, StanceType>> = {};
  for (const d of dims) {
    const v = parsed[d];
    if (typeof v === "string" && (VALID_STANCES as string[]).includes(v)) {
      out[d] = v as StanceType;
    }
  }
  return out;
}

async function main() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("[dim-stance] ANTHROPIC_API_KEY not set");
    process.exit(1);
  }
  const anthropic = new Anthropic({ apiKey: key });

  const singleCache = loadJson<SingleStanceCache>(SINGLE_STANCE_CACHE, {});
  const dimCache = loadJson<DimStanceCache>(DIM_STANCE_CACHE, {});
  const bills = loadBills();

  const todo: { bill: RawBill; dims: DimKey[] }[] = [];
  for (const bill of bills) {
    const id = String(bill.bill_id);
    if (dimCache[id]) continue;
    const cls = singleCache[id];
    if (!cls) continue;
    const dims = dimensionsForTags(cls.impactTags ?? []);
    if (dims.length < 2) continue;
    todo.push({ bill, dims });
  }

  console.log(
    `[dim-stance] ${bills.length} total · ${todo.length} multi-dim bills to classify · cap=${MAX_CALLS}`,
  );

  let calls = 0;
  for (const { bill, dims } of todo) {
    if (calls >= MAX_CALLS) {
      console.log(`[dim-stance] cap reached`);
      break;
    }
    try {
      const result = await classifyOne(anthropic, bill, dims);
      dimCache[String(bill.bill_id)] = result;
      calls += 1;
      if (calls % 10 === 0 || calls <= 3) {
        saveCache(dimCache);
        console.log(
          `[dim-stance] ${calls}/${todo.length} · ${bill.state} ${bill.bill_number} → ${JSON.stringify(result)}`,
        );
      }
    } catch (e) {
      console.warn(
        `[dim-stance] ${bill.bill_id} ${bill.bill_number} failed:`,
        (e as Error).message,
      );
    }
  }

  saveCache(dimCache);
  console.log(
    `\n[dim-stance] done · ${calls} calls · ${Object.keys(dimCache).length} bills cached`,
  );
}

main().catch((e) => {
  console.error("[dim-stance] fatal:", e.message);
  process.exit(1);
});

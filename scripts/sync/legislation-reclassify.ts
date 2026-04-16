/**
 * Semantically reclassify cached LegiScan bills using Claude.
 *
 * Reads:  data/raw/legiscan/bills/{STATE}.json
 * Writes: data/raw/claude/classifications.json   (incremental cache keyed by bill_id)
 *
 * The downstream `legislation-classify.ts` script checks this cache first
 * and uses the Claude result when available; it falls back to the heuristic
 * classifier for any bill we didn't (or couldn't) classify with Claude.
 *
 * Budget controls:
 *   - Incremental cache: reruns skip bills that are already classified.
 *   - `RECLASSIFY_MAX` env var: cap calls per run (default: no cap).
 *   - Prompt caching via Anthropic's `cache_control` on the system prompt.
 *   - Logs running call + token counts to stdout.
 *
 * Expected total: ~608 bills × ~$0.006/call ≈ $3.60 for a full run.
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
  ImpactTag,
  LegislationCategory,
  StanceType,
} from "../../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const RAW_BILLS_DIR = join(ROOT, "data/raw/legiscan/bills");
const CACHE_DIR = join(ROOT, "data/raw/claude");
const CACHE_PATH = join(CACHE_DIR, "classifications.json");

const MODEL = "claude-sonnet-4-6";
const MAX_CALLS = process.env.RECLASSIFY_MAX
  ? Number(process.env.RECLASSIFY_MAX)
  : Infinity;

interface Classification {
  category: LegislationCategory;
  impactTags: ImpactTag[];
  stance: StanceType;
  summary: string;
  classifiedAt: string;
}

type CacheFile = Record<string, Classification>;

interface RawBill {
  bill_id: number;
  bill_number: string;
  title: string;
  description?: string;
  state?: string;
}

const SYSTEM_PROMPT = `You classify US state and federal legislation for a public policy tracker focused on AI regulation and data-center policy.

Return ONLY a JSON object — no prose, no markdown fences — matching this exact schema:

{
  "category": "<LegislationCategory>",
  "impactTags": ["<ImpactTag>", ...],
  "stance": "<StanceType>",
  "summary": "<1-2 plain language sentences>"
}

Allowed LegislationCategory values (pick one — the single best fit):
  - data-center-siting          moratoriums, construction bans, siting rules, setbacks, zoning specific to data centers
  - data-center-energy          energy reporting, efficiency standards, grid impact, cooling water use
  - ai-governance               comprehensive AI frameworks, risk management, oversight, transparency
  - synthetic-media             deepfakes, digital replicas, political synthetic media, voice clones
  - ai-healthcare               AI in medical decisions, therapy bots, health insurance algorithms
  - ai-workforce                hiring algorithms, workplace surveillance, automated employment decisions
  - ai-education                AI in schools, student data, AI literacy requirements
  - ai-government               government use of AI, procurement, public sector oversight
  - data-privacy                AI-related privacy, training data, consumer data rights
  - ai-criminal-justice         facial recognition, predictive policing, biometric surveillance, law enforcement AI

Allowed ImpactTag values (include every tag that substantively applies, 0 to 5 max):
  Environmental: water-consumption, carbon-emissions, protected-land, environmental-review, renewable-energy
  Infrastructure: grid-capacity, energy-rates, water-infrastructure
  Community: noise-vibration, local-zoning, local-control, residential-proximity, property-values
  Economic: tax-incentives, job-creation, economic-development, nda-transparency
  AI-specific: algorithmic-transparency, ai-safety, deepfake-regulation, ai-in-healthcare, ai-in-employment, ai-in-education, child-safety, data-privacy

Allowed StanceType values:
  - restrictive   active ban, moratorium, or enforceable prohibition
  - concerning    heavy regulation, mandatory review, strong restrictions advancing toward enactment
  - review        studies, commissions, task forces, exploratory work without hard restrictions
  - favorable     incentives, tax breaks, fast-tracking, permissive/deregulatory
  - none          the bill is not actually about AI policy or data-center policy despite keyword matches

Rules:
  - If the bill is NOT relevant to AI or data-center policy, set stance to "none", category to your best guess, and impactTags to [].
  - The summary MUST be 1-2 complete sentences in plain language a non-expert could understand. No bill jargon.
  - impactTags are for things the bill substantively addresses, not passing references.`;

function loadCache(): CacheFile {
  if (!existsSync(CACHE_PATH)) return {};
  return JSON.parse(readFileSync(CACHE_PATH, "utf8")) as CacheFile;
}

function saveCache(cache: CacheFile) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
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

async function classifyOne(
  anthropic: Anthropic,
  bill: RawBill,
): Promise<Classification> {
  const userContent = `State: ${bill.state ?? "unknown"}
Bill: ${bill.bill_number}
Title: ${bill.title}
${bill.description ? `Description: ${bill.description.slice(0, 1800)}` : ""}`;

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userContent }],
  });

  const text = extractText(msg);
  const parsed = parseJsonBlock(text) as Classification;

  return {
    category: parsed.category,
    impactTags: Array.isArray(parsed.impactTags)
      ? parsed.impactTags.slice(0, 5)
      : [],
    stance: parsed.stance,
    summary: parsed.summary ?? bill.title,
    classifiedAt: new Date().toISOString(),
  };
}

async function main() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("[reclassify] ANTHROPIC_API_KEY not set");
    process.exit(1);
  }
  const anthropic = new Anthropic({ apiKey: key });
  const cache = loadCache();
  const bills = loadBills();

  const todo = bills.filter((b) => !cache[String(b.bill_id)]);
  console.log(
    `[reclassify] ${bills.length} total bills · ${todo.length} uncached · cap=${MAX_CALLS}`,
  );

  let calls = 0;
  let cachedRead = 0;
  let cachedWrite = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const bill of todo) {
    if (calls >= MAX_CALLS) {
      console.log(`[reclassify] cap reached`);
      break;
    }
    try {
      const result = await classifyOne(anthropic, bill);
      cache[String(bill.bill_id)] = result;
      calls += 1;
      if (calls % 10 === 0 || calls <= 3) {
        saveCache(cache); // periodic incremental save
        console.log(
          `[reclassify] ${calls}/${todo.length} · ${bill.state} ${bill.bill_number} → ${result.category} / ${result.stance} / ${result.impactTags.length} tags`,
        );
      }
    } catch (e) {
      console.warn(
        `[reclassify] ${bill.bill_id} ${bill.bill_number} failed:`,
        (e as Error).message,
      );
    }
  }

  saveCache(cache);
  console.log(
    `\n[reclassify] done · ${calls} calls · ${Object.keys(cache).length} bills cached total`,
  );
  if (cachedRead || cachedWrite) {
    console.log(
      `[reclassify] prompt cache read=${cachedRead} write=${cachedWrite}`,
    );
  }
  if (inputTokens || outputTokens) {
    console.log(
      `[reclassify] usage input=${inputTokens} output=${outputTokens}`,
    );
  }
}

main().catch((e) => {
  console.error("[reclassify] fatal:", e.message);
  process.exit(1);
});

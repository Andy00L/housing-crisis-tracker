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
const FORCE = process.argv.includes("--force");

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

const SYSTEM_PROMPT = `You classify US state and federal legislation for a housing crisis tracker focused on housing supply, affordability, and tenant protections.

Return ONLY a JSON object, no prose, no markdown fences, matching this exact schema:

{
  "category": "<LegislationCategory>",
  "impactTags": ["<ImpactTag>", ...],
  "stance": "<StanceType>",
  "summary": "<1-2 plain language sentences>"
}

Allowed LegislationCategory values (pick one, the single best fit):
  - zoning-reform              upzoning, density bonuses, ADU legalization, parking reform, missing middle, setback changes, lot splitting
  - rent-regulation            rent control, rent stabilization, rent caps, rent freeze, rental protections
  - affordable-housing         inclusionary zoning, LIHTC, below-market housing, subsidized housing, social housing
  - development-incentive      tax incentives, fast-track permitting, density bonuses, opportunity zones, expedited review
  - building-code              construction standards, energy efficiency, accessibility, fire safety for residential
  - foreign-investment         foreign buyer restrictions, non-resident taxes, beneficial ownership, speculation taxes
  - homelessness-services      shelters, supportive housing, encampment policy, Housing First programs
  - tenant-protection          eviction protections, just cause, habitability, relocation assistance, lease rights
  - transit-housing            transit-oriented development, station area plans, corridor planning
  - property-tax               property tax reform, assessment changes, vacancy taxes, abatements

Allowed ImpactTag values (include every tag that substantively applies, 0 to 5 max):
  Supply: affordability, density, lot-splitting, inclusionary-zoning, transit-oriented, public-land
  Protection: rent-stabilization, displacement, homelessness, social-housing, indigenous-housing
  Market: foreign-buyer, first-time-buyer, vacancy-tax, short-term-rental, mortgage-regulation
  Community: community-opposition, heritage-protection, environmental-review, nimby

Allowed StanceType values:
  - favorable     increases housing supply (upzoning, density bonuses, ADU legalization, reduced parking minimums), funds affordable housing (LIHTC expansion, subsidies, social housing), protects tenants (rent stabilization, eviction protections), reduces barriers to development
  - restrictive   reduces density or limits development (downzoning, moratoriums, height limits), removes tenant protections, cuts housing funding, exclusionary policies (large lot minimums, single-family-only zoning)
  - concerning    bill has both supply-positive and supply-negative provisions, good intent but implementation may backfire, addresses housing tangentially (immigration bill with housing provisions)
  - review        ONLY for bills where the text is genuinely unavailable, the bill is purely procedural with no housing policy content, or is an appropriations/budget bill with no specific housing provisions
  - none          the bill is not about housing policy despite keyword matches

Classification rules:
  - If the bill increases housing supply (more units, higher density, faster approvals, funding): favorable
  - If the bill protects tenants or improves affordability (rent stabilization, subsidies, eviction protections): favorable
  - If the bill reduces supply or adds barriers (downzoning, moratoriums, excessive regulations): restrictive
  - If the bill removes protections or cuts funding: restrictive
  - If the bill has both supply-positive and supply-negative provisions: concerning
  - If the bill touches housing tangentially (tax bill with one housing clause): concerning
  - If the bill title and summary clearly indicate a housing policy direction, classify it even if the full text is not available
  - DO NOT default to "review" when uncertain between favorable and concerning. Make a decision. "review" is for bills with NO housing policy signal.
  - If the bill is NOT relevant to housing policy, set stance to "none", category to your best guess, and impactTags to [].
  - The summary MUST be 1-2 complete sentences in plain language. No bill jargon.
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
  const cache = FORCE ? {} as CacheFile : loadCache();
  const bills = loadBills();

  if (FORCE) {
    console.log("[reclassify] --force: clearing classification cache, all bills will be re-classified");
  }

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

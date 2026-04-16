/**
 * Generate per-region housing legislation overviews (ca / us / eu / ap)
 * straight from the bill files. Output is plain prose intended for the
 * About page or a future Section 02 expansion. Not consumed by the live
 * UI today; the existing data/news/summaries.json with three NA/EU/Asia
 * buckets continues to drive the home page AI Overview block.
 *
 * Run: npx tsx scripts/sync/regional-overviews.ts
 *
 * Input files (read directly, no Tavily):
 *   data/legislation/federal-ca.json
 *   data/legislation/provinces/*.json
 *   data/legislation/federal-us-housing.json
 *   data/legislation/us-states-housing/*.json
 *   data/legislation/europe/*.json
 *   data/legislation/asia-pacific/*.json
 *
 * Output: data/news/regional-overviews.json
 *   { generatedAt, ca, us, eu, ap }
 *
 * Cost: 4 Claude Sonnet calls (one per region), ~$0.08 total.
 */

import "../env.js";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const OUT_PATH = join(ROOT, "data/news/regional-overviews.json");

const MODEL = "claude-sonnet-4-6";
const MAX_BILLS_PER_REGION = 10;

type RegionKey = "ca" | "us" | "eu" | "ap";

interface BillRow {
  billCode: string;
  title: string;
  summary?: string;
  stage?: string;
  stance?: string;
  category?: string;
  updatedDate?: string;
  jurisdiction: string;
}

// ── File loaders ────────────────────────────────────────────────────
function readJsonOrNull<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

interface BillsContainer {
  legislation?: unknown[];
  state?: string;
  stateCode?: string;
}

function pullBills(file: BillsContainer | null, jurisdictionFallback: string): BillRow[] {
  if (!file) return [];
  // Some files are bare arrays; some are objects with a `legislation` field.
  const raw = Array.isArray(file) ? file : Array.isArray(file.legislation) ? file.legislation : [];
  const jurisdiction = file.state ?? file.stateCode ?? jurisdictionFallback;
  return (raw as Array<Record<string, unknown>>).map((b) => ({
    billCode: String(b.billCode ?? b.id ?? ""),
    title: String(b.title ?? ""),
    summary: typeof b.summary === "string" ? b.summary : undefined,
    stage: typeof b.stage === "string" ? b.stage : undefined,
    stance: typeof b.stance === "string" ? b.stance : undefined,
    category: typeof b.category === "string" ? b.category : undefined,
    updatedDate: typeof b.updatedDate === "string" ? b.updatedDate : undefined,
    jurisdiction,
  }));
}

function loadDirectory(dir: string, jurisdictionPrefix: string): BillRow[] {
  if (!existsSync(dir)) return [];
  const out: BillRow[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const content = readJsonOrNull<BillsContainer>(join(dir, f));
    out.push(...pullBills(content, `${jurisdictionPrefix}/${f.replace(".json", "")}`));
  }
  return out;
}

function loadCanada(): BillRow[] {
  const fed = readJsonOrNull<BillsContainer | unknown[]>(join(ROOT, "data/legislation/federal-ca.json"));
  // Canada federal file is an array of bills, not the wrapped JsonLegFile shape.
  const fedBills = Array.isArray(fed)
    ? pullBills({ legislation: fed }, "Canada Federal")
    : pullBills(fed as BillsContainer | null, "Canada Federal");
  const provincial = loadDirectory(join(ROOT, "data/legislation/provinces"), "Province");
  return [...fedBills, ...provincial];
}

function loadUS(): BillRow[] {
  const fed = readJsonOrNull<BillsContainer>(join(ROOT, "data/legislation/federal-us-housing.json"));
  const states = loadDirectory(join(ROOT, "data/legislation/us-states-housing"), "State");
  return [...pullBills(fed, "US Federal"), ...states];
}

function loadEurope(): BillRow[] {
  return loadDirectory(join(ROOT, "data/legislation/europe"), "Europe");
}

function loadAsiaPacific(): BillRow[] {
  return loadDirectory(join(ROOT, "data/legislation/asia-pacific"), "AsiaPacific");
}

// ── Sort + select ───────────────────────────────────────────────────
function topBillsForRegion(bills: BillRow[]): BillRow[] {
  return bills
    .filter((b) => b.title)
    .sort((a, b) => (b.updatedDate ?? "").localeCompare(a.updatedDate ?? ""))
    .slice(0, MAX_BILLS_PER_REGION);
}

// ── Claude prompt ───────────────────────────────────────────────────
const REGION_LABELS: Record<RegionKey, string> = {
  ca: "Canada (federal + provincial)",
  us: "the United States (federal + top 10 states)",
  eu: "Europe (UK plus 10 EU countries)",
  ap: "Asia-Pacific (7 countries)",
};

function buildPrompt(region: RegionKey, bills: BillRow[]): string {
  const lines = bills
    .map(
      (b, i) =>
        `[${i + 1}] ${b.jurisdiction} ${b.billCode} (${b.stage ?? "?"}, ${b.stance ?? "?"}): ${b.title}${b.summary ? ` — ${b.summary.slice(0, 220)}` : ""}`,
    )
    .join("\n");

  return `Summarize the top 3-5 housing policy themes in ${REGION_LABELS[region]} based on the bills below.

BILLS (most recently updated first):
${lines || "(no bills returned for this region)"}

WRITING RULES:
1. One paragraph total, 4-7 sentences. Plain prose, no bullets.
2. Cite specific bill identifiers (HR 1234, S 5678, C-20, AB 2011) where they
   are central to a theme.
3. Neutral tone. No marketing language. No superlatives.
4. Acknowledge gaps if the bills are sparse rather than padding the text.
5. Do NOT use long dashes. Use periods or short dashes if you must connect.
6. Output only the paragraph. No preamble, no headers, no markdown fences.`;
}

function extractText(msg: Anthropic.Messages.Message): string {
  return msg.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

async function summarize(
  anthropic: Anthropic,
  region: RegionKey,
  bills: BillRow[],
): Promise<string> {
  const prompt = buildPrompt(region, bills);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      });
      return extractText(msg);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 529 || status === 503 || status === 429) {
        const backoff = 5000 * Math.pow(2, attempt);
        console.log(`  [retry] anthropic ${status} for region=${region}, waiting ${backoff}ms`);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`anthropic exhausted retries for region=${region}`);
}

// ── main ────────────────────────────────────────────────────────────
async function main() {
  console.log("[regional-overviews] Starting...");
  const anthropic = new Anthropic();

  const regions: Array<{ key: RegionKey; bills: BillRow[] }> = [
    { key: "ca", bills: topBillsForRegion(loadCanada()) },
    { key: "us", bills: topBillsForRegion(loadUS()) },
    { key: "eu", bills: topBillsForRegion(loadEurope()) },
    { key: "ap", bills: topBillsForRegion(loadAsiaPacific()) },
  ];

  for (const r of regions) {
    console.log(`  region=${r.key}: ${r.bills.length} bills selected`);
  }

  const out: Record<string, string> = {};
  for (const r of regions) {
    try {
      const prose = await summarize(anthropic, r.key, r.bills);
      out[r.key] = prose;
      console.log(`  [done] ${r.key}: ${prose.length} chars`);
    } catch (err) {
      console.warn(`  [warn] ${r.key} failed: ${(err as Error).message}`);
      out[r.key] = `Coverage for ${REGION_LABELS[r.key]} is pending. The next sync will refresh this paragraph.`;
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    ...out,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2), { encoding: "utf8" });
  console.log(`[regional-overviews] wrote ${Object.keys(out).length} regions → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

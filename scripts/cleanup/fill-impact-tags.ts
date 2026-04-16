/**
 * Fill empty impactTags arrays using Claude API.
 *
 * Run: npx tsx scripts/cleanup/fill-impact-tags.ts
 */

import "../env.js";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const STATES_DIR = join(ROOT, "data/legislation/states");
const FEDERAL_PATH = join(ROOT, "data/legislation/federal-us.json");

const MODEL = "claude-sonnet-4-6";
const BATCH_SIZE = 10;

interface Bill {
  id: string;
  billCode: string;
  title: string;
  summary: string;
  category: string;
  impactTags: string[];
  [key: string]: unknown;
}

interface StateFile {
  state: string;
  legislation: Bill[];
  [key: string]: unknown;
}

interface PendingTag {
  bill: Bill;
  stateName: string;
  filePath: string;
}

function extractText(msg: Anthropic.Messages.Message): string {
  return msg.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function parseJsonArray(text: string): string[][] {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const first = candidate.indexOf("[");
  const last = candidate.lastIndexOf("]");
  if (first < 0 || last < 0) throw new Error("no JSON array in response");
  return JSON.parse(candidate.slice(first, last + 1));
}

const VALID_TAGS = new Set([
  "affordability", "environmental-review", "public-land", "environmental-review", "transit-oriented",
  "density", "mortgage-regulation", "social-housing",
  "community-opposition", "inclusionary-zoning", "nimby", "displacement", "affordability",
  "vacancy-tax", "first-time-buyer", "density", "heritage-protection",
  "rent-stabilization", "homelessness", "short-term-rental", "social-housing",
  "displacement", "indigenous-housing", "community-opposition", "foreign-buyer",
]);

async function tagBatch(
  anthropic: Anthropic,
  bills: PendingTag[],
): Promise<string[][]> {
  const numbered = bills.map((p, i) =>
    `${i + 1}. ${p.bill.billCode} — ${p.bill.title}\n   Category: ${p.bill.category}\n   Summary: ${p.bill.summary.slice(0, 200)}`
  ).join("\n\n");

  const prompt = `Assign impact tags to each of these bills. Pick ALL that apply from this list:

Environmental: water-consumption, carbon-emissions, protected-land, environmental-review, renewable-energy
Infrastructure: grid-capacity, energy-rates, water-infrastructure
Community: noise-vibration, local-zoning, local-control, residential-proximity, property-values
Economic: tax-incentives, job-creation, economic-development, nda-transparency
AI-specific: algorithmic-transparency, ai-safety, deepfake-regulation, ai-in-healthcare,
             ai-in-employment, ai-in-education, child-safety, data-privacy

Rules:
- Every AI bill should have at least one AI-specific tag
- Every data center bill should have at least one infrastructure or environmental tag
- If the bill genuinely has no applicable tags, return empty array []

Return ONLY a JSON array of arrays (one inner array per bill, in order):
[["tag1", "tag2"], ["tag3"], ...]

Bills:
${numbered}`;

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const text = extractText(msg);
  const arr = parseJsonArray(text);
  if (!Array.isArray(arr) || arr.length !== bills.length) {
    throw new Error(`expected ${bills.length} items, got ${Array.isArray(arr) ? arr.length : "non-array"}`);
  }
  return arr.map((tags) => tags.filter((t: string) => VALID_TAGS.has(t)));
}

async function main() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("[fill-tags] ANTHROPIC_API_KEY not set");
    process.exit(1);
  }
  const anthropic = new Anthropic({ apiKey: key });

  // Collect all untagged bills
  const pending: PendingTag[] = [];
  const allFiles = [
    ...readdirSync(STATES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => join(STATES_DIR, f)),
    FEDERAL_PATH,
  ];

  for (const filePath of allFiles) {
    const data = JSON.parse(readFileSync(filePath, "utf8")) as StateFile;
    for (const bill of data.legislation) {
      if (!bill.impactTags || bill.impactTags.length === 0) {
        pending.push({ bill, stateName: data.state, filePath });
      }
    }
  }

  console.log(`[fill-tags] ${pending.length} untagged bills to process`);

  // Track which files need saving
  const dirtyFiles = new Set<string>();

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(pending.length / BATCH_SIZE);
    console.log(`[fill-tags] batch ${batchNum}/${totalBatches} · ${batch.length} bills`);

    try {
      const results = await tagBatch(anthropic, batch);
      for (let j = 0; j < batch.length; j++) {
        const tags = results[j];
        if (tags && tags.length > 0) {
          batch[j].bill.impactTags = tags;
          dirtyFiles.add(batch[j].filePath);
          console.log(`  ${batch[j].stateName} ${batch[j].bill.billCode}: ${tags.join(", ")}`);
        } else {
          console.log(`  ${batch[j].stateName} ${batch[j].bill.billCode}: (no tags)`);
        }
      }
    } catch (e) {
      console.warn(`[fill-tags] batch ${batchNum} failed:`, (e as Error).message);
    }
  }

  // Save dirty files
  for (const filePath of dirtyFiles) {
    const data = JSON.parse(readFileSync(filePath, "utf8"));
    // Re-read to get the bill references we mutated
    // Actually the bill objects are the same references, so just re-serialize
    // We need to re-read because we mutated bill objects in-memory
    // but the file still has the old data on disk
  }

  // Actually we need to save properly — re-read all files and update bills
  for (const filePath of allFiles) {
    const data = JSON.parse(readFileSync(filePath, "utf8")) as StateFile;
    let changed = false;
    for (const bill of data.legislation) {
      const match = pending.find((p) => p.bill.id === bill.id && p.filePath === filePath);
      if (match && match.bill.impactTags.length > 0) {
        bill.impactTags = match.bill.impactTags;
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    }
  }

  console.log(`\n[fill-tags] DONE`);
}

main().catch((e) => {
  console.error("[fill-tags] fatal:", e.message);
  process.exit(1);
});

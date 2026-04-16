/**
 * Use Claude to flag state bills that don't actually concern AI or
 * data-centre policy — false positives that slipped through the
 * keyword-driven LegiScan ingest. Writes a list of bill IDs to remove.
 *
 * Reads:  data/legislation/states/*.json
 * Writes: data/legislation/_irrelevant.json   (id list + reasons)
 *
 * Apply by re-running the cleanup with APPLY=1 to actually delete the
 * flagged entries from the state files.
 *
 * Budget: 1 streaming call, ~$0.50.
 *
 * Run: npx tsx scripts/cleanup/flag-irrelevant-bills.ts
 *      APPLY=1 npx tsx scripts/cleanup/flag-irrelevant-bills.ts
 */
import "../env.js";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const STATE_DIR = "data/legislation/states";
const FLAGGED_OUT = "data/legislation/_irrelevant.json";
const APPLY = process.env.APPLY === "1";
const MODEL = "claude-sonnet-4-6";

interface CompactBill {
  id: string;
  state: string;
  code: string;
  title: string;
  summary: string;
  category: string;
}

interface FlaggedFile {
  generatedAt: string;
  flagged: Array<{ id: string; reason: string }>;
}

function loadCompact(): CompactBill[] {
  const out: CompactBill[] = [];
  for (const f of readdirSync(STATE_DIR)) {
    const j = JSON.parse(readFileSync(join(STATE_DIR, f), "utf8"));
    for (const b of j.legislation ?? []) {
      out.push({
        id: b.id,
        state: j.stateCode,
        code: b.billCode,
        title: b.title?.slice(0, 200) ?? "",
        summary: b.summary?.slice(0, 300) ?? "",
        category: b.category,
      });
    }
  }
  return out;
}

function parseJsonBlock(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return JSON.parse(candidate.slice(first, last + 1));
  }
  throw new Error("no JSON object found in response");
}

async function flag(bills: CompactBill[]): Promise<FlaggedFile["flagged"]> {
  const anthropic = new Anthropic();
  const prompt = `You are reviewing state-level US bills for inclusion in an AI & data-centre policy tracker. The tracker covers:
- AI regulation (any aspect: governance, safety, deepfakes, healthcare AI, employment AI, AI in education / criminal justice / government)
- Data-centre policy (siting, energy, water, taxes, zoning, permits)
- Data privacy laws that interact with AI/automated systems
- Algorithmic decision-making rules

Below is a JSON array of bills currently in the tracker. For each bill, decide if it actually concerns AI or data-centre policy. Flag only bills that are CLEARLY off-topic — e.g. pregnancy centres, road maintenance, horse racing, generic procurement reform, plain agriculture without data/AI angle. When in doubt, KEEP the bill (false negatives are worse than false positives — better to over-include than to drop a borderline-AI bill).

Return a SINGLE JSON object (no prose, no markdown fences):
{
  "flagged": [
    { "id": "<bill id>", "reason": "<one short sentence why it's off-topic>" }
  ]
}

BILLS:
${JSON.stringify(bills, null, 2)}`;

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    messages: [{ role: "user", content: prompt }],
  });
  const msg = await stream.finalMessage();
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");
  const data = parseJsonBlock(text) as { flagged?: FlaggedFile["flagged"] };
  return data.flagged ?? [];
}

function applyRemovals(flaggedIds: Set<string>) {
  let removed = 0;
  for (const f of readdirSync(STATE_DIR)) {
    const path = join(STATE_DIR, f);
    const j = JSON.parse(readFileSync(path, "utf8"));
    const before = (j.legislation ?? []).length;
    j.legislation = (j.legislation ?? []).filter((b: { id: string }) => !flaggedIds.has(b.id));
    const after = j.legislation.length;
    if (after !== before) {
      writeFileSync(path, JSON.stringify(j, null, 2) + "\n");
      console.log(`[cleanup] ${f}: ${before} → ${after}`);
      removed += before - after;
    }
  }
  return removed;
}

async function main() {
  const bills = loadCompact();
  console.log(`[cleanup] reviewing ${bills.length} state bills…`);

  let flagged: FlaggedFile["flagged"];
  if (existsSync(FLAGGED_OUT) && !APPLY) {
    const cached = JSON.parse(readFileSync(FLAGGED_OUT, "utf8")) as FlaggedFile;
    console.log(`[cleanup] reusing cached flag list (${cached.flagged.length} entries) — set APPLY=1 to remove them`);
    flagged = cached.flagged;
  } else if (existsSync(FLAGGED_OUT) && APPLY) {
    flagged = (JSON.parse(readFileSync(FLAGGED_OUT, "utf8")) as FlaggedFile).flagged;
  } else {
    flagged = await flag(bills);
    const out: FlaggedFile = { generatedAt: new Date().toISOString(), flagged };
    writeFileSync(FLAGGED_OUT, JSON.stringify(out, null, 2) + "\n");
    console.log(`[cleanup] flagged ${flagged.length} bills → ${FLAGGED_OUT}`);
  }

  console.log("\n[cleanup] sample of flagged bills:");
  for (const f of flagged.slice(0, 15)) {
    const bill = bills.find((b) => b.id === f.id);
    console.log(`  ${f.id} [${bill?.state} ${bill?.code}] ${bill?.title?.slice(0, 70)} — ${f.reason}`);
  }

  if (APPLY) {
    const ids = new Set(flagged.map((f) => f.id));
    const removed = applyRemovals(ids);
    console.log(`\n[cleanup] removed ${removed} bills from state files`);
  } else {
    console.log(`\n[cleanup] dry run — set APPLY=1 to remove the ${flagged.length} flagged bills`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

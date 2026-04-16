/**
 * Research the US senators and representatives most active on AI and
 * data-centre policy via Claude web_search. Writes
 * data/politicians/us-summaries.json — an overlay keyed by bioguide ID
 * that the politicians-data layer merges on top of the FEC-sourced
 * roster.
 *
 * One big call (cheaper + more coherent than per-person calls) asking
 * Claude to survey the landscape and return a structured list.
 *
 * Budget: ~$1.
 * Rerun with US_POLS_FORCE=1 to overwrite.
 *
 * Run: npx tsx scripts/sync/us-politicians-ai.ts
 */
import "../env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const OUT = join(ROOT, "data/politicians/us-summaries.json");
const CROSSWALK = join(ROOT, "data/crosswalk/fec-to-bioguide.json");

const MODEL = "claude-sonnet-4-6";
const FORCE = process.env.US_POLS_FORCE === "1";

type Batch = { slug: "senate" | "house"; directive: string };

const BATCHES: Batch[] = [
  {
    slug: "senate",
    directive: `Focus on US SENATORS active on AI and data-centre policy. Target 20–25 senators. Loud voices: Josh Hawley, Bernie Sanders, Ted Cruz, Elizabeth Warren, Ed Markey, Richard Blumenthal, Mark Warner. Committee leaders: Chuck Schumer (AI Roadmap), Maria Cantwell (COPIED Act), Todd Young (Create AI Act), Martin Heinrich (AI Caucus), Mike Rounds (AI Working Group), John Thune (Majority Leader). Also include Chris Coons, Amy Klobuchar, Gary Peters, Marsha Blackburn, Mike Lee.`,
  },
  {
    slug: "house",
    directive: `Focus on US REPRESENTATIVES and House LEADERSHIP active on AI and data-centre policy. Target 15–20 members. Must include: Speaker Mike Johnson, AOC (AI Data Center Moratorium), Jay Obernolte (AI Task Force Chair), Ted Lieu (AI Task Force Co-Chair), Anna Eshoo (AI Caucus), Ro Khanna (Silicon Valley), Zoe Lofgren, Don Beyer, Yvette Clarke, Hakeem Jeffries, Nancy Mace, Ayanna Pressley, Michael McCaul, Darrell Issa.`,
  },
];

const BASE_PROMPT = (directive: string) => `${directive}

Return a SINGLE JSON object (no prose, no markdown fences):
{
  "politicians": [
    {
      "name": "<full name as it appears in Congress.gov>",
      "bioguideId": "<bioguide ID if you can verify it, else omit>",
      "role": "<e.g. 'Senator · AI Insight Forum co-host' or 'Representative · House Oversight'>",
      "stance": "restrictive|concerning|review|favorable|none",
      "summary": "1–3 sentences naming specific bills, statements, or actions that show their position on AI & data centres. Concrete > abstract. Cite named bills when possible.",
      "keyPoints": [
        "Specific amendment, bill, committee role, public statement, or vote — ≤25 words each.",
        "At least 2, up to 4 bullets."
      ],
      "bills": [
        {
          "code": "S.3682 | H.R.5764 | H.RES.123",
          "title": "Power for the People Act",
          "role": "sponsor|cosponsor|vote-yea|vote-nay|champion",
          "year": 2026,
          "summary": "1-sentence plain-English description of what the bill does."
        }
      ]
    }
  ]
}

RULES:
- CRITICAL: The \`bills\` array MUST list 3–6 bills per politician — every bill mentioned in \`summary\` or \`keyPoints\` must appear here. If you mention "the No FAKES Act" in summary, it must show up in bills. Under-citing is worse than skipping a politician entirely.
- Each bill needs: official \`code\` (S.123 / H.R.123 / S.RES.123 format, with periods — "S.3682" not "SB3682"), full \`title\`, \`role\` (sponsor|cosponsor|vote-yea|vote-nay|champion), \`year\`, and a ONE-sentence \`summary\` of what the bill does.
- Every \`summary\` and \`keyPoints\` entry MUST cite a concrete fact (a named bill + date, a specific hearing, a dated statement).
- If you can't verify a bill's official code, omit that bill rather than guessing.
- Prefer verifiable positions over speculation. If you aren't sure about a person, omit them.
- bioguideId examples: Van Hollen = V000128, Hawley = H001089, AOC = O000172, Bernie = S000033, Cruz = C001098, Warren = W000817. If you don't know one, omit the field.`;

interface CrosswalkOverlay {
  generatedAt: string;
  politicians: Array<{
    name: string;
    bioguideId?: string;
    role?: string;
    stance?: string;
    summary?: string;
    keyPoints?: string[];
    bills?: Array<{
      code: string;
      title: string;
      role: string;
      year: number;
      summary?: string;
    }>;
  }>;
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

function extractText(msg: Anthropic.Messages.Message): string {
  const parts: string[] = [];
  for (const b of msg.content) if (b.type === "text") parts.push(b.text);
  return parts.join("\n");
}

async function main() {
  if (!FORCE && existsSync(OUT)) {
    console.log(`[us-pols] ${OUT} exists — skipping (US_POLS_FORCE=1 to overwrite)`);
    return;
  }

  const anthropic = new Anthropic();
  const allPols: CrosswalkOverlay["politicians"] = [];
  for (const batch of BATCHES) {
    console.log(`[us-pols] researching ${batch.slug} (streaming)…`);
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 10 }],
      messages: [{ role: "user", content: BASE_PROMPT(batch.directive) }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "max_tokens") {
      console.warn(`[us-pols] ${batch.slug} hit max_tokens — output may be truncated`);
    }
    const data = parseJsonBlock(extractText(msg)) as {
      politicians?: CrosswalkOverlay["politicians"];
    };
    const batchPols = data.politicians ?? [];
    console.log(
      `[us-pols] ${batch.slug}: ${batchPols.length} entries, avg ${(batchPols.reduce((n, p) => n + (p.bills?.length ?? 0), 0) / Math.max(1, batchPols.length)).toFixed(1)} bills each`,
    );
    allPols.push(...batchPols);
  }
  const pols = allPols;
  console.log(`[us-pols] total ${pols.length} entries`);

  // Sanity check: how many bioguide IDs resolve?
  const crosswalk: Record<string, string> = existsSync(CROSSWALK)
    ? JSON.parse(readFileSync(CROSSWALK, "utf8"))
    : {};
  const validBioguides = new Set(Object.values(crosswalk));
  const matched = pols.filter((p) => p.bioguideId && validBioguides.has(p.bioguideId)).length;
  console.log(`[us-pols] ${matched}/${pols.length} have verifiable bioguide IDs`);

  if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
  const out: CrosswalkOverlay = {
    generatedAt: new Date().toISOString(),
    politicians: pols,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`[us-pols] wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Rewrite formulaic state blurbs using Claude API.
 *
 * Replaces blurbs that start with "{State} has X relevant bills..."
 * with unique editorial context blurbs.
 *
 * Run: npx tsx scripts/cleanup/rewrite-blurbs.ts
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

interface Bill {
  billCode: string;
  title: string;
  category: string;
  stage: string;
  impactTags: string[];
  [key: string]: unknown;
}

interface StateFile {
  state: string;
  stateCode: string;
  stance: string;
  contextBlurb: string;
  legislation: Bill[];
  [key: string]: unknown;
}

function extractText(msg: Anthropic.Messages.Message): string {
  return msg.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

async function generateBlurb(
  anthropic: Anthropic,
  data: StateFile,
): Promise<string> {
  const billLines = data.legislation
    .map((b) => `  ${b.billCode}: ${b.title} [${b.category}, ${b.stage}, tags: ${b.impactTags.join(", ") || "none"}]`)
    .join("\n");

  const prompt = `Write a 2-3 sentence context blurb for ${data.state}'s AI and data center policy landscape. This appears in a side panel when a user clicks the state on a map.

The state's current stance is: ${data.stance}
Bills:
${billLines}

Rules:
- Do NOT start with "${data.state} has X bills" — the user can already see the bills
- DO mention specific bill codes if they're significant (moratoriums, landmark legislation)
- DO explain what makes this state DISTINCTIVE — what's the story here?
- DO mention real-world context (is this a major data center hub? tech corridor? rural opposition?)
- Be specific and factual, not generic
- 2-3 sentences maximum

Good examples:
- "Maine is poised to become the first state to enact a statewide data center moratorium. LD 307 would ban facilities over 20 MW until November 2027, driven by concerns about energy costs and grid strain in rural communities."
- "Virginia hosts more data center capacity than any other state, but growing community pushback in Loudoun and Prince William counties has shifted the legislative conversation from incentives to impact mitigation."
- "Texas offers aggressive data center incentives through SB 1308's extended sales tax exemptions, even as ERCOT's grid struggles to keep pace with projected AI-driven load growth."

Return ONLY the blurb text, no quotes or formatting.`;

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  return extractText(msg);
}

async function main() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("[rewrite-blurbs] ANTHROPIC_API_KEY not set");
    process.exit(1);
  }
  const anthropic = new Anthropic({ apiKey: key });

  const files = readdirSync(STATES_DIR).filter((f) => f.endsWith(".json"));
  let rewritten = 0;

  // Process states
  for (const f of files) {
    const path = join(STATES_DIR, f);
    const data = JSON.parse(readFileSync(path, "utf8")) as StateFile;

    // Only rewrite formulaic blurbs
    if (!data.contextBlurb.startsWith(data.state + " has ")) {
      console.log(`[rewrite-blurbs] SKIP ${data.state} — already editorial`);
      continue;
    }

    try {
      const blurb = await generateBlurb(anthropic, data);
      console.log(`[rewrite-blurbs] ${data.state}: "${blurb.slice(0, 80)}…"`);
      data.contextBlurb = blurb;
      writeFileSync(path, JSON.stringify(data, null, 2));
      rewritten++;
    } catch (e) {
      console.warn(`[rewrite-blurbs] FAILED ${data.state}:`, (e as Error).message);
    }
  }

  // Process federal
  const fedData = JSON.parse(readFileSync(FEDERAL_PATH, "utf8")) as StateFile;
  if (fedData.contextBlurb.startsWith("The US federal government has ") || fedData.contextBlurb.startsWith(fedData.state + " has ")) {
    try {
      const blurb = await generateBlurb(anthropic, fedData);
      console.log(`[rewrite-blurbs] Federal: "${blurb.slice(0, 80)}…"`);
      fedData.contextBlurb = blurb;
      writeFileSync(FEDERAL_PATH, JSON.stringify(fedData, null, 2));
      rewritten++;
    } catch (e) {
      console.warn(`[rewrite-blurbs] FAILED Federal:`, (e as Error).message);
    }
  }

  console.log(`\n[rewrite-blurbs] DONE — rewrote ${rewritten} blurbs`);
}

main().catch((e) => {
  console.error("[rewrite-blurbs] fatal:", e.message);
  process.exit(1);
});

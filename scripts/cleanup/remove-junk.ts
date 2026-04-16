/**
 * Remove junk bills from state legislation JSON files.
 *
 * 1. Backs up all state files to data/backup/
 * 2. Removes known junk bills by billCode
 * 3. Scans remaining bills for zero AI/DC keyword matches and removes those
 * 4. Logs every removal
 * 5. Updates each state JSON in place
 *
 * Run: npx tsx scripts/cleanup/remove-junk.ts
 */

import "../env.js";
import { readFileSync, writeFileSync, copyFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const STATES_DIR = join(ROOT, "data/legislation/states");
const BACKUP_DIR = join(ROOT, "data/backup");

const KNOWN_JUNK: Record<string, string[]> = {
  delaware: ["SCR86"],
  kansas: ["HB2329"],
  "north-dakota": ["HB1068"],
  "south-carolina": ["H3064"],
  texas: ["HR616", "HR1444"],
};

const AI_DC_KEYWORDS = [
  "artificial intelligence",
  "\\bai\\b",
  "data center",
  "data centre",
  "algorithm",
  "deepfake",
  "deep fake",
  "machine learning",
  "automated decision",
  "chatbot",
  "facial recognition",
  "synthetic media",
  "generative",
  "neural network",
  "large language model",
  "llm",
  "automation",
  "autonomous",
  "biometric",
  "surveillance",
  "license plate reader",
  "predictive policing",
  "robotic",
  "digital twin",
  "provenance data",
  "ai-generated",
  "data broker",
  "data privacy",
  "personal data",
  "consumer data",
  "algorithmic",
  "cloud computing",
  "hyperscale",
  "colocation",
  "co-location",
  "server farm",
  "cooling system",
  "grid capacity",
  "energy campus",
  "moratorium",
  "electric generation",
  "sales tax exemption.*data center",
  "data center.*sales tax",
  "deepseek",
  "workforce.*ai",
  "ai.*workforce",
  "agentic",
  "regulatory sandbox",
  "automated.*quota",
];

const keywordRegex = new RegExp(AI_DC_KEYWORDS.join("|"), "i");

interface Bill {
  id: string;
  billCode: string;
  title: string;
  summary: string;
  [key: string]: unknown;
}

interface StateFile {
  state: string;
  stateCode: string;
  legislation: Bill[];
  [key: string]: unknown;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function main() {
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

  const files = readdirSync(STATES_DIR).filter((f) => f.endsWith(".json"));

  // Step 1: backup
  for (const f of files) {
    copyFileSync(join(STATES_DIR, f), join(BACKUP_DIR, f));
  }
  console.log(`[remove-junk] backed up ${files.length} state files to data/backup/`);

  let totalRemoved = 0;
  let totalKnownRemoved = 0;
  let totalScanRemoved = 0;

  for (const f of files) {
    const path = join(STATES_DIR, f);
    const data = JSON.parse(readFileSync(path, "utf8")) as StateFile;
    const slug = slugify(data.state);
    const originalCount = data.legislation.length;
    const knownJunkCodes = KNOWN_JUNK[slug] ?? [];

    // Step 2: remove known junk
    const afterKnown = data.legislation.filter((bill) => {
      if (knownJunkCodes.includes(bill.billCode)) {
        console.log(`[remove-junk] KNOWN JUNK: ${data.state} ${bill.billCode} — "${bill.title.slice(0, 80)}"`);
        totalKnownRemoved++;
        return false;
      }
      return true;
    });

    // Step 3: scan for zero-keyword bills
    const afterScan = afterKnown.filter((bill) => {
      const text = `${bill.title} ${bill.summary}`;
      if (!keywordRegex.test(text)) {
        console.log(`[remove-junk] ZERO KEYWORDS: ${data.state} ${bill.billCode} — "${bill.title.slice(0, 80)}"`);
        totalScanRemoved++;
        return false;
      }
      return true;
    });

    data.legislation = afterScan;

    if (afterScan.length < originalCount) {
      const removed = originalCount - afterScan.length;
      totalRemoved += removed;
      console.log(`[remove-junk] ${data.state}: removed ${removed} of ${originalCount} bills, ${afterScan.length} remaining`);
      writeFileSync(path, JSON.stringify(data, null, 2));
    }
  }

  console.log(`\n[remove-junk] DONE`);
  console.log(`  Known junk removed: ${totalKnownRemoved}`);
  console.log(`  Zero-keyword removed: ${totalScanRemoved}`);
  console.log(`  Total removed: ${totalRemoved}`);
}

main();

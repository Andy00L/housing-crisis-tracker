/**
 * Second-pass junk removal: remove bills whose own summary explicitly
 * says they're not relevant to AI or data center policy.
 *
 * Also removes bills with empty impactTags whose titles clearly indicate
 * no AI/DC connection (appropriation acts, literacy, health insurance, etc.)
 *
 * Run: npx tsx scripts/cleanup/remove-irrelevant.ts
 */

import "../env.js";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const STATES_DIR = join(ROOT, "data/legislation/states");
const FEDERAL_PATH = join(ROOT, "data/legislation/federal-us.json");

interface Bill {
  id: string;
  billCode: string;
  title: string;
  summary: string;
  impactTags: string[];
  [key: string]: unknown;
}

interface StateFile {
  state: string;
  legislation: Bill[];
  [key: string]: unknown;
}

const SELF_DECLARED_IRRELEVANT = /has no (?:relevance|relation|connection|substantive connection) to AI|does not (?:appear to )?(?:address|involve|relate to) AI|not related to AI|no connection to AI|has no relevance to AI|does not address AI or data.center/i;

function isIrrelevant(bill: Bill): boolean {
  // Bill's own summary says it's irrelevant
  if (SELF_DECLARED_IRRELEVANT.test(bill.summary)) return true;

  // Untagged bills with clearly non-AI/DC titles
  if (bill.impactTags.length === 0) {
    const title = bill.title.toLowerCase();
    // Appropriation/budget bills
    if (/appropriation for the fiscal/i.test(bill.title)) return true;
    // Pure education with no AI mention
    if (/literacy|statewide assessment|testing window|career and technical education grants/i.test(title) &&
        !/artificial intelligence|ai|algorithm|automat/i.test(bill.summary)) return true;
    // Pure health with no AI mention
    if (/health insurance allowable|nursing home|home care employment|health outcomes data/i.test(title) &&
        !/artificial intelligence|ai|algorithm|automat/i.test(bill.summary)) return true;
    // Miscellaneous clearly irrelevant
    if (/rename|buoy outages|food assistance|wildfire smoke/i.test(title) &&
        !/artificial intelligence|ai|data center|algorithm/i.test(bill.summary)) return true;
  }

  return false;
}

function main() {
  const allFiles = [
    ...readdirSync(STATES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ path: join(STATES_DIR, f), name: f })),
    { path: FEDERAL_PATH, name: "federal-us.json" },
  ];

  let totalRemoved = 0;

  for (const { path } of allFiles) {
    const data = JSON.parse(readFileSync(path, "utf8")) as StateFile;
    const originalCount = data.legislation.length;

    data.legislation = data.legislation.filter((bill) => {
      if (isIrrelevant(bill)) {
        console.log(`[remove-irrelevant] ${data.state} ${bill.billCode}: "${bill.title.slice(0, 70)}"`);
        return false;
      }
      return true;
    });

    const removed = originalCount - data.legislation.length;
    if (removed > 0) {
      totalRemoved += removed;
      writeFileSync(path, JSON.stringify(data, null, 2));
    }
  }

  console.log(`\n[remove-irrelevant] DONE — removed ${totalRemoved} bills`);
}

main();

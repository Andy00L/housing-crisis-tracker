/**
 * Recompute state-level stances based on actual data center impact,
 * not just any AI regulation.
 *
 * Run: npx tsx scripts/cleanup/fix-stances.ts
 */

import "../env.js";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const STATES_DIR = join(ROOT, "data/legislation/states");
const FEDERAL_PATH = join(ROOT, "data/legislation/federal-us.json");

type StanceType = "restrictive" | "concerning" | "review" | "favorable" | "none";

interface Bill {
  id: string;
  billCode: string;
  title: string;
  summary: string;
  stage: string;
  stance?: string;
  impactTags: string[];
  category: string;
  [key: string]: unknown;
}

interface StateFile {
  state: string;
  stateCode: string;
  stance: string;
  legislation: Bill[];
  [key: string]: unknown;
}

function computeStance(bills: Bill[]): StanceType {
  const live = bills.filter((b) => b.stage !== "Dead");

  // Moratorium language must relate to data center construction/operation,
  // not just "prohibiting" something tangential like NDAs or tax exemptions
  function isDcMoratorium(b: Bill): boolean {
    if (b.category !== "zoning-reform") return false;
    const text = b.title + " " + b.summary;
    // Exclude NDA/transparency and tax exemption bills
    if (/nondisclosure|nda|tax exemption/i.test(b.title)) return false;
    const hasMoratoriumWord = /moratorium|prohibit.*(?:data center|construction|operation|permit|development|subsidiz)|(?:data center|construction).*prohibit|limit.*(?:construction|data center)|(?:data center).*limit/i.test(text);
    return hasMoratoriumWord;
  }

  // Enacted or Floor moratorium on DC siting → strongest signal
  const hasEnactedMoratorium = live.some(
    (b) => ["Enacted", "Floor"].includes(b.stage) && isDcMoratorium(b),
  );

  // Active moratorium bills in any live stage
  const dcMoratoriumBills = live.filter((b) => isDcMoratorium(b));

  const dcRestrictions = live.filter(
    (b) =>
      ["zoning-reform", "building-code"].includes(b.category) &&
      b.impactTags.some((t) =>
        [
          "density",
          "affordability",
          "nimby",
          "community-opposition",
          "environmental-review",
          "mortgage-regulation",
        ].includes(t),
      ),
  );

  const incentives = live.filter((b) =>
    b.impactTags.some((t) =>
      ["vacancy-tax", "first-time-buyer", "density"].includes(t),
    ),
  );

  const aiGovernance = live.filter((b) =>
    [
      "affordable-housing",
      "tenant-protection",
      "homelessness-services",
      "transit-housing",
      "foreign-buyer",
      "rent-regulation",
      "development-incentive",
      "property-tax",
    ].includes(b.category),
  );

  // Enacted/Floor moratorium → restrictive
  if (hasEnactedMoratorium) return "restrictive";

  // Active moratorium proposals + other DC restrictions → restrictive
  if (dcMoratoriumBills.length > 0 && dcRestrictions.length >= 2) return "restrictive";

  // Multiple moratorium bills moving → restrictive
  if (dcMoratoriumBills.length >= 2) return "restrictive";

  // Single moratorium bill in pipeline → concerning
  if (dcMoratoriumBills.length === 1) return "concerning";

  if (dcRestrictions.length >= 2 && incentives.length === 0) return "concerning";

  if (incentives.length > 0 && dcRestrictions.length === 0) return "favorable";

  if (incentives.length > 0 && dcRestrictions.length > 0) return "review";

  if (bills.length === 0) return "none";

  // States with minimal AI-only activity (no DC restrictions)
  // are barely engaged, not "under discussion"
  if (aiGovernance.length <= 3 && dcRestrictions.length === 0 &&
      live.length <= 3 && live.every(b => ["Committee", "Filed"].includes(b.stage))) return "none";

  if (aiGovernance.length > 0 && dcRestrictions.length === 0) return "review";

  if (dcRestrictions.length > 0) return "concerning";

  return "none";
}

function main() {
  const files = readdirSync(STATES_DIR).filter((f) => f.endsWith(".json"));
  const distribution: Record<StanceType, string[]> = {
    restrictive: [],
    concerning: [],
    review: [],
    favorable: [],
    none: [],
  };

  for (const f of files) {
    const path = join(STATES_DIR, f);
    const data = JSON.parse(readFileSync(path, "utf8")) as StateFile;
    const oldStance = data.stance;
    const newStance = computeStance(data.legislation);

    if (oldStance !== newStance) {
      console.log(
        `[fix-stances] ${data.state}: ${oldStance} → ${newStance}`,
      );
      data.stance = newStance;
      writeFileSync(path, JSON.stringify(data, null, 2));
    }

    distribution[newStance].push(data.state);
  }

  // Fix federal stance
  const fedData = JSON.parse(readFileSync(FEDERAL_PATH, "utf8")) as StateFile;
  const oldFedStance = fedData.stance;
  if (oldFedStance !== "review") {
    console.log(`[fix-stances] Federal: ${oldFedStance} → review`);
    fedData.stance = "review";
    writeFileSync(FEDERAL_PATH, JSON.stringify(fedData, null, 2));
  }

  console.log("\n[fix-stances] Distribution:");
  for (const [stance, states] of Object.entries(distribution)) {
    console.log(`  ${stance}: ${states.length} — ${states.join(", ")}`);
  }
  console.log(`\n  Federal: review`);
}

main();

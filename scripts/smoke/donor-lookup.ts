import "../env.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findDonor, isDonorRelevant } from "../../lib/donor-data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

// Pull a few real sponsor names out of Virginia bills and see how many
// we can cross-reference to the donor index.
interface LegFile {
  stateCode: string;
  legislation: Array<{
    billCode: string;
    category: string;
    sponsors?: string[];
  }>;
}
const va = JSON.parse(
  readFileSync(join(ROOT, "data/legislation/states/virginia.json"), "utf8"),
) as LegFile;

let hits = 0;
let misses = 0;
let relevantHighlights = 0;
const sample: string[] = [];
for (const bill of va.legislation.slice(0, 8)) {
  for (const name of bill.sponsors ?? []) {
    const profile = findDonor(name, va.stateCode);
    if (!profile) {
      misses += 1;
      sample.push(`  ✗ ${bill.billCode} · ${name}`);
      continue;
    }
    hits += 1;
    const relevant = profile.topDonors.filter((d) =>
      isDonorRelevant(d.industry, bill.category as any),
    );
    if (relevant.length) relevantHighlights += 1;
    sample.push(
      `  ✓ ${bill.billCode} · ${name} → ${profile.name} (${profile.party}-${profile.state}) · top donor: ${profile.topDonors[0]?.name ?? "—"} [${profile.topDonors[0]?.industry ?? "—"}]${relevant.length ? " ★ industry match" : ""}`,
    );
  }
}

console.log(`[donor-smoke] hits=${hits} misses=${misses} industry-highlights=${relevantHighlights}`);
for (const line of sample.slice(0, 20)) console.log(line);

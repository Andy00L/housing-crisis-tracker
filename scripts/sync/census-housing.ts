/**
 * Fetch US housing data from Census Bureau American Community Survey.
 *
 * Output: data/housing/us/census-housing.json
 * Auth:   None
 */

import "../env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CACHE_DIR = join(ROOT, "data/raw/census");
const OUT_DIR = join(ROOT, "data/housing/us");

mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const CENSUS_URL =
  "https://api.census.gov/data/2023/acs/acs1?get=NAME,B25077_001E,B25064_001E,B25001_001E&for=state:*";

interface CensusState {
  name: string;
  fips: string;
  medianHomeValue: number | null;
  medianGrossRent: number | null;
  totalHousingUnits: number | null;
}

async function main() {
  console.log("[census-housing] Fetching ACS data...");

  const cachePath = join(CACHE_DIR, "acs_housing.json");
  let data: string[][];

  if (existsSync(cachePath)) {
    console.log("  [cache hit]");
    data = JSON.parse(readFileSync(cachePath, "utf8"));
  } else {
    console.log(`  [fetch] ${CENSUS_URL.slice(0, 70)}...`);
    const res = await fetch(CENSUS_URL);
    if (!res.ok) throw new Error(`Census API → ${res.status}`);
    data = (await res.json()) as string[][];
    writeFileSync(cachePath, JSON.stringify(data, null, 2));
  }

  // First row is headers: ["NAME","B25077_001E","B25064_001E","B25001_001E","state"]
  const [, ...rows] = data;

  const states: CensusState[] = rows.map((row) => ({
    name: row[0],
    fips: row[4],
    medianHomeValue: row[1] && row[1] !== "-666666666" ? parseInt(row[1]) : null,
    medianGrossRent: row[2] && row[2] !== "-666666666" ? parseInt(row[2]) : null,
    totalHousingUnits: row[3] && row[3] !== "-666666666" ? parseInt(row[3]) : null,
  }));

  const output = {
    source: "US Census Bureau, American Community Survey 1-Year Estimates",
    year: 2023,
    lastUpdated: new Date().toISOString().slice(0, 10),
    fields: {
      medianHomeValue: "B25077_001E — Median value (dollars) of owner-occupied housing units",
      medianGrossRent: "B25064_001E — Median gross rent (dollars)",
      totalHousingUnits: "B25001_001E — Total housing units",
    },
    states,
  };

  writeFileSync(join(OUT_DIR, "census-housing.json"), JSON.stringify(output, null, 2));
  console.log(`  ${states.length} states → census-housing.json`);
  console.log("[census-housing] Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

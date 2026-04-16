/**
 * Fetch OECD housing price data from the new SDMX API.
 *
 * Output: data/housing/global/oecd-hpi.json
 * Cache:  data/raw/oecd/
 * Auth:   None
 *
 * IMPORTANT: The old stats.oecd.org endpoint is dead. Use sdmx.oecd.org.
 * Query per country individually — multi-country queries sometimes return NoRecordsFound.
 */

import "../env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CACHE_DIR = join(ROOT, "data/raw/oecd");
const OUT_DIR = join(ROOT, "data/housing/global");

mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

// OECD member countries (ISO 3-letter codes)
const COUNTRIES = [
  "AUS", "AUT", "BEL", "CAN", "CHL", "COL", "CRI", "CZE", "DNK", "EST",
  "FIN", "FRA", "DEU", "GRC", "HUN", "ISL", "IRL", "ISR", "ITA", "JPN",
  "KOR", "LVA", "LTU", "LUX", "MEX", "NLD", "NZL", "NOR", "POL", "PRT",
  "SVK", "SVN", "ESP", "SWE", "CHE", "TUR", "GBR", "USA",
];

const COUNTRY_NAMES: Record<string, string> = {
  AUS: "Australia", AUT: "Austria", BEL: "Belgium", CAN: "Canada", CHL: "Chile",
  COL: "Colombia", CRI: "Costa Rica", CZE: "Czech Republic", DNK: "Denmark",
  EST: "Estonia", FIN: "Finland", FRA: "France", DEU: "Germany", GRC: "Greece",
  HUN: "Hungary", ISL: "Iceland", IRL: "Ireland", ISR: "Israel", ITA: "Italy",
  JPN: "Japan", KOR: "South Korea", LVA: "Latvia", LTU: "Lithuania",
  LUX: "Luxembourg", MEX: "Mexico", NLD: "Netherlands", NZL: "New Zealand",
  NOR: "Norway", POL: "Poland", PRT: "Portugal", SVK: "Slovakia",
  SVN: "Slovenia", ESP: "Spain", SWE: "Sweden", CHE: "Switzerland",
  TUR: "Turkey", GBR: "United Kingdom", USA: "United States",
};

async function fetchCountry(iso3: string): Promise<Array<{ year: string; measure: string; value: number }>> {
  const cachePath = join(CACHE_DIR, `${iso3}.csv`);

  if (existsSync(cachePath)) {
    return parseCsv(readFileSync(cachePath, "utf8"));
  }

  const url = `https://sdmx.oecd.org/public/rest/data/OECD.ECO.MPD,DSD_AN_HOUSE_PRICES@DF_HOUSE_PRICES,/${iso3}.A..?format=csvfilewithlabels&startPeriod=2015`;

  try {
    const res = await fetch(url, {
      headers: { "Accept": "text/csv", "User-Agent": "housing-crisis-tracker/0.1" },
    });
    if (!res.ok) {
      if (res.status === 404) return []; // No data for this country
      console.warn(`  [OECD ${res.status}] ${iso3}`);
      return [];
    }
    const text = await res.text();
    if (text.includes("NoRecordsFound") || text.trim().length < 50) return [];
    writeFileSync(cachePath, text);
    return parseCsv(text);
  } catch {
    return [];
  }
}

function parseCsv(csv: string): Array<{ year: string; measure: string; value: number }> {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());

  const yearIdx = header.findIndex((h) => h === "TIME_PERIOD");
  const measureIdx = header.findIndex((h) => h === "MEASURE");
  const valueIdx = header.findIndex((h) => h === "OBS_VALUE");

  if (yearIdx < 0 || valueIdx < 0) return [];

  const results: Array<{ year: string; measure: string; value: number }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.replace(/"/g, "").trim());
    const value = parseFloat(cells[valueIdx]);
    if (isNaN(value)) continue;
    results.push({
      year: cells[yearIdx],
      measure: cells[measureIdx] ?? "HPI",
      value,
    });
  }
  return results;
}

async function main() {
  console.log("[oecd-housing] Starting OECD sync...");

  const countries: Record<string, {
    name: string;
    measures: Record<string, Array<{ year: string; value: number }>>;
  }> = {};

  for (let i = 0; i < COUNTRIES.length; i++) {
    const iso3 = COUNTRIES[i];
    if (i > 0) await new Promise((r) => setTimeout(r, 1500)); // Rate limit: 1.5s between requests
    const data = await fetchCountry(iso3);
    if (data.length === 0) continue;

    const measures: Record<string, Array<{ year: string; value: number }>> = {};
    for (const d of data) {
      if (!measures[d.measure]) measures[d.measure] = [];
      measures[d.measure].push({ year: d.year, value: d.value });
    }

    // Sort each measure by year
    for (const m of Object.values(measures)) {
      m.sort((a, b) => a.year.localeCompare(b.year));
    }

    countries[iso3] = { name: COUNTRY_NAMES[iso3] ?? iso3, measures };
  }

  const output = {
    source: "OECD Housing Prices (sdmx.oecd.org)",
    measures: {
      HPI: "Nominal house price indices",
      RHP: "Real house price indices",
      RPI: "Rent prices",
      HPI_RPI: "Price to rent ratio",
      HPI_YDH: "Price to income ratio",
    },
    lastUpdated: new Date().toISOString().slice(0, 10),
    countries,
  };

  writeFileSync(join(OUT_DIR, "oecd-hpi.json"), JSON.stringify(output, null, 2));
  console.log(`[oecd-housing] Wrote ${Object.keys(countries).length} countries → oecd-hpi.json`);
}

main().catch((err) => { console.error(err); process.exit(1); });

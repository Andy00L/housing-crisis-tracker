/**
 * Fetch EU housing metrics from Eurostat SDMX API.
 *
 * Output: data/housing/eu/eurostat-hpi.json, eurostat-rents.json
 * Cache:  data/raw/eurostat/
 * Auth:   None
 */

import "../env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CACHE_DIR = join(ROOT, "data/raw/eurostat");
const OUT_DIR = join(ROOT, "data/housing/eu");

mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const GEO_CODES = ["DE", "FR", "ES", "IT", "NL", "IE", "SE", "PL", "AT", "EU27_2020"];
const GEO_NAMES: Record<string, string> = {
  DE: "Germany", FR: "France", ES: "Spain", IT: "Italy", NL: "Netherlands",
  IE: "Ireland", SE: "Sweden", PL: "Poland", AT: "Austria", EU27_2020: "EU-27",
};

// ── Eurostat SDMX JSON parser ────────────────────────────────────────
interface EurostatJson {
  value: Record<string, number>;
  dimension: {
    time: { category: { index: Record<string, number>; label: Record<string, string> } };
  };
}

function parseEurostat(data: EurostatJson): Array<{ period: string; value: number }> {
  const timeIdx = data.dimension.time.category.index;
  const values: Array<{ period: string; value: number }> = [];

  for (const [period, idx] of Object.entries(timeIdx)) {
    const val = data.value[String(idx)];
    if (val !== undefined && val !== null) {
      values.push({ period, value: val });
    }
  }

  return values.sort((a, b) => a.period.localeCompare(b.period));
}

// ── Fetch + cache ────────────────────────────────────────────────────
async function fetchEurostat(dataset: string, geo: string, params: string, cachePrefix: string): Promise<Array<{ period: string; value: number }>> {
  const cachePath = join(CACHE_DIR, `${cachePrefix}_${geo}.json`);

  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, "utf8"));
  }

  const url = `https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/${dataset}/${params}.${geo}?format=JSON&lastNPeriods=8`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  [Eurostat ${res.status}] ${dataset} ${geo}`);
    return [];
  }

  const data = (await res.json()) as EurostatJson;
  const values = parseEurostat(data);
  writeFileSync(cachePath, JSON.stringify(values, null, 2));
  return values;
}

// ── HPI (quarterly) ─────────────────────────────────────────────────
async function fetchHpi() {
  console.log("  [HPI] Fetching quarterly house price index...");
  const countries: Record<string, { name: string; values: Array<{ period: string; value: number }> }> = {};

  for (const geo of GEO_CODES) {
    const values = await fetchEurostat("prc_hpi_q", geo, "Q.TOTAL.I15_Q", "hpi");
    if (values.length > 0) {
      countries[geo] = { name: GEO_NAMES[geo], values };
    }
  }

  const output = {
    source: "Eurostat House Price Index (prc_hpi_q)",
    unit: "Quarterly index, 2015=100",
    lastUpdated: new Date().toISOString().slice(0, 10),
    countries,
  };

  writeFileSync(join(OUT_DIR, "eurostat-hpi.json"), JSON.stringify(output, null, 2));
  console.log(`    ${Object.keys(countries).length} countries → eurostat-hpi.json`);
}

// ── Rents (monthly CPI shelter component) ────────────────────────────
async function fetchRents() {
  console.log("  [Rents] Fetching monthly rent index...");
  const countries: Record<string, { name: string; values: Array<{ period: string; value: number }> }> = {};

  for (const geo of GEO_CODES) {
    const values = await fetchEurostat("prc_hicp_midx", geo, "M.I15.CP041", "rents");
    if (values.length > 0) {
      countries[geo] = { name: GEO_NAMES[geo], values };
    }
  }

  const output = {
    source: "Eurostat HICP - Actual rentals for housing (CP041)",
    unit: "Monthly index, 2015=100",
    lastUpdated: new Date().toISOString().slice(0, 10),
    countries,
  };

  writeFileSync(join(OUT_DIR, "eurostat-rents.json"), JSON.stringify(output, null, 2));
  console.log(`    ${Object.keys(countries).length} countries → eurostat-rents.json`);
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log("[eurostat-housing] Starting Eurostat sync...");
  await fetchHpi();
  await fetchRents();
  console.log("[eurostat-housing] Done.");
}

main().catch((err) => { console.error(err); process.exit(1); });

/**
 * Fetch US housing metrics from FRED (Federal Reserve Economic Data).
 *
 * Output: data/housing/us/case-shiller.json, fred-starts.json, fred-mortgage.json
 * Cache:  data/raw/fred/
 * Auth:   FRED_API_KEY
 */

import "../env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CACHE_DIR = join(ROOT, "data/raw/fred");
const OUT_DIR = join(ROOT, "data/housing/us");

mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const API_KEY = process.env.FRED_API_KEY;
if (!API_KEY) {
  console.error("[fred] FRED_API_KEY not set in .env.local");
  process.exit(1);
}

// ── State FIPS → FRED HPI prefix mapping ─────────────────────────────
const STATE_HPI_PREFIX: Record<string, string> = {
  AL: "AL", AK: "AK", AZ: "AZ", AR: "AR", CA: "CA", CO: "CO", CT: "CT",
  DE: "DE", FL: "FL", GA: "GA", HI: "HI", ID: "ID", IL: "IL", IN: "IN",
  IA: "IA", KS: "KS", KY: "KY", LA: "LA", ME: "ME", MD: "MD", MA: "MA",
  MI: "MI", MN: "MN", MS: "MS", MO: "MO", MT: "MT", NE: "NE", NV: "NV",
  NH: "NH", NJ: "NJ", NM: "NM", NY: "NY", NC: "NC", ND: "ND", OH: "OH",
  OK: "OK", OR: "OR", PA: "PA", RI: "RI", SC: "SC", SD: "SD", TN: "TN",
  TX: "TX", UT: "UT", VT: "VT", VA: "VA", WA: "WA", WV: "WV", WI: "WI",
  WY: "WY", DC: "DC",
};

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin",
  WY: "Wyoming", DC: "District of Columbia",
};

// ── Fetch + cache ────────────────────────────────────────────────────
interface FredObs { date: string; value: string; }

async function fetchSeries(seriesId: string, limit = 12): Promise<FredObs[]> {
  const cachePath = join(CACHE_DIR, `${seriesId}_${limit}.json`);
  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, "utf8"));
  }

  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${API_KEY}&file_type=json&sort_order=desc&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  [FRED ${res.status}] ${seriesId}`);
    return [];
  }

  const data = await res.json() as { observations?: FredObs[] };
  const obs = data.observations ?? [];
  writeFileSync(cachePath, JSON.stringify(obs, null, 2));
  return obs;
}

function obsToValues(obs: FredObs[]): Array<{ period: string; value: number }> {
  return obs
    .filter((o) => o.value !== ".")
    .map((o) => ({ period: o.date.slice(0, 7), value: parseFloat(o.value) }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

// ── National series ──────────────────────────────────────────────────
interface NationalConfig {
  seriesId: string;
  name: string;
  outFile: string;
  limit: number;
}

const NATIONAL_SERIES: NationalConfig[] = [
  { seriesId: "CSUSHPISA", name: "S&P Case-Shiller National Home Price Index", outFile: "case-shiller.json", limit: 12 },
  { seriesId: "HOUST", name: "Housing Starts: Total New Privately Owned", outFile: "fred-starts.json", limit: 12 },
  { seriesId: "MORTGAGE30US", name: "30-Year Fixed Rate Mortgage Average", outFile: "fred-mortgage.json", limit: 24 },
  { seriesId: "RRVRUSQ156N", name: "Rental Vacancy Rate", outFile: "fred-vacancy.json", limit: 8 },
];

async function fetchNationalSeries() {
  for (const cfg of NATIONAL_SERIES) {
    console.log(`  [national] ${cfg.name}...`);
    const obs = await fetchSeries(cfg.seriesId, cfg.limit);
    const values = obsToValues(obs);
    const output = {
      seriesId: cfg.seriesId,
      name: cfg.name,
      lastUpdated: values.length > 0 ? values[values.length - 1].period : null,
      values,
    };
    writeFileSync(join(OUT_DIR, cfg.outFile), JSON.stringify(output, null, 2));
    console.log(`    ${values.length} observations → ${cfg.outFile}`);
  }
}

// ── Per-state HPI ────────────────────────────────────────────────────
async function fetchStateHpi() {
  console.log("  [state HPI] Fetching All-Transactions HPI for 50 states + DC...");
  const states: Record<string, { values: Array<{ period: string; value: number }>; stateName: string }> = {};

  for (const [code, prefix] of Object.entries(STATE_HPI_PREFIX)) {
    const seriesId = `${prefix}STHPI`;
    const obs = await fetchSeries(seriesId, 8);
    const values = obsToValues(obs);
    if (values.length > 0) {
      states[code] = { stateName: STATE_NAMES[code], values };
    }
  }

  const output = {
    name: "All-Transactions House Price Index by State",
    source: "FRED / FHFA",
    lastUpdated: new Date().toISOString().slice(0, 10),
    states,
  };

  writeFileSync(join(OUT_DIR, "fred-state-hpi.json"), JSON.stringify(output, null, 2));
  console.log(`    ${Object.keys(states).length} states → fred-state-hpi.json`);
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log("[fred-housing] Starting FRED sync...");
  await fetchNationalSeries();
  await fetchStateHpi();
  console.log("[fred-housing] Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

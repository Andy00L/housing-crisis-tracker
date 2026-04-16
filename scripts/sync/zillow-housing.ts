/**
 * Fetch Zillow home value and rent data from public CSV downloads.
 *
 * Output: data/housing/us/zillow-zhvi.json, zillow-zori.json
 * Cache:  data/raw/zillow/
 * Auth:   None
 */

import "../env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CACHE_DIR = join(ROOT, "data/raw/zillow");
const OUT_DIR = join(ROOT, "data/housing/us");

mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const ZHVI_URL = "https://files.zillowstatic.com/research/public_csvs/zhvi/State_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv";
const ZORI_URL = "https://files.zillowstatic.com/research/public_csvs/zori/Metro_zori_uc_sfrcondomfr_sm_sa_month.csv";

// ── Fetch + cache ────────────────────────────────────────────────────
async function fetchCsv(url: string, name: string): Promise<string> {
  const cachePath = join(CACHE_DIR, `${name}.csv`);
  if (existsSync(cachePath)) {
    console.log(`  [cache hit] ${name}`);
    return readFileSync(cachePath, "utf8");
  }

  console.log(`  [fetch] ${name} (${url.slice(0, 80)}...)`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Zillow ${name} → ${res.status}`);
  const text = await res.text();
  writeFileSync(cachePath, text);
  return text;
}

// ── CSV parsing ──────────────────────────────────────────────────────
function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { cells.push(current); current = ""; continue; }
    current += ch;
  }
  cells.push(current);
  return cells;
}

function parseCsv(text: string): string[][] {
  return text.trim().split("\n").map(parseCsvRow);
}

// ── ZHVI (State Home Values) ─────────────────────────────────────────
interface ZhviEntry {
  state: string;
  regionName: string;
  currentValue: number;
  currentPeriod: string;
  yearAgoValue: number | null;
  changeYoY: number | null;
}

function processZhvi(csv: string): ZhviEntry[] {
  const rows = parseCsv(csv);
  const header = rows[0];

  // Find latest column with data and the one ~12 months prior
  const latestIdx = header.length - 1;
  const yearAgoIdx = Math.max(5, latestIdx - 12);
  const latestPeriod = header[latestIdx];

  const results: ZhviEntry[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const regionName = row[1]?.trim();
    const state = row[4]?.trim();
    const current = parseFloat(row[latestIdx]);
    const yearAgo = parseFloat(row[yearAgoIdx]);

    if (!regionName || isNaN(current)) continue;

    results.push({
      state: state || regionName,
      regionName,
      currentValue: Math.round(current),
      currentPeriod: latestPeriod,
      yearAgoValue: isNaN(yearAgo) ? null : Math.round(yearAgo),
      changeYoY: !isNaN(yearAgo) && yearAgo > 0
        ? Math.round((current / yearAgo - 1) * 1000) / 10
        : null,
    });
  }
  return results;
}

// ── ZORI (Metro Rents) ───────────────────────────────────────────────
interface ZoriEntry {
  metro: string;
  currentRent: number;
  currentPeriod: string;
  yearAgoRent: number | null;
  changeYoY: number | null;
}

function processZori(csv: string): ZoriEntry[] {
  const rows = parseCsv(csv);
  const header = rows[0];
  const latestIdx = header.length - 1;
  const yearAgoIdx = Math.max(5, latestIdx - 12);
  const latestPeriod = header[latestIdx];

  const results: ZoriEntry[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const metro = row[1]?.trim();
    const current = parseFloat(row[latestIdx]);
    const yearAgo = parseFloat(row[yearAgoIdx]);

    if (!metro || isNaN(current)) continue;

    results.push({
      metro,
      currentRent: Math.round(current),
      currentPeriod: latestPeriod,
      yearAgoRent: isNaN(yearAgo) ? null : Math.round(yearAgo),
      changeYoY: !isNaN(yearAgo) && yearAgo > 0
        ? Math.round((current / yearAgo - 1) * 1000) / 10
        : null,
    });
  }
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log("[zillow-housing] Starting Zillow sync...");

  const zhviCsv = await fetchCsv(ZHVI_URL, "state_zhvi");
  const zhvi = processZhvi(zhviCsv);
  writeFileSync(
    join(OUT_DIR, "zillow-zhvi.json"),
    JSON.stringify({
      source: "Zillow Home Value Index (ZHVI)",
      level: "state",
      lastUpdated: new Date().toISOString().slice(0, 10),
      states: zhvi,
    }, null, 2),
  );
  console.log(`  ${zhvi.length} states → zillow-zhvi.json`);

  const zoriCsv = await fetchCsv(ZORI_URL, "metro_zori");
  const zori = processZori(zoriCsv);
  writeFileSync(
    join(OUT_DIR, "zillow-zori.json"),
    JSON.stringify({
      source: "Zillow Observed Rent Index (ZORI)",
      level: "metro",
      lastUpdated: new Date().toISOString().slice(0, 10),
      metros: zori,
    }, null, 2),
  );
  console.log(`  ${zori.length} metros → zillow-zori.json`);

  console.log("[zillow-housing] Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

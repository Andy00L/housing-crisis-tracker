/**
 * Fetch Australian housing price data from ABS SDMX API.
 *
 * Output: data/housing/asia/aus-rppi.json
 * Cache:  data/raw/abs/
 * Auth:   None
 */

import "../env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CACHE_DIR = join(ROOT, "data/raw/abs");
const OUT_DIR = join(ROOT, "data/housing/asia");

mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

// ABS regions for RPPI
const REGIONS: Record<string, string> = {
  "1": "Australia",
  "1GSYD": "Greater Sydney",
  "1GMEL": "Greater Melbourne",
  "1GBRI": "Greater Brisbane",
  "1GADE": "Greater Adelaide",
  "1GPER": "Greater Perth",
  "1GHOB": "Greater Hobart",
  "1GDAR": "Greater Darwin",
  "1GCAN": "Greater Canberra",
  "1NSW": "New South Wales",
  "1VIC": "Victoria",
  "1QLD": "Queensland",
  "1SA": "South Australia",
  "1WA": "Western Australia",
  "1TAS": "Tasmania",
  "1NT": "Northern Territory",
  "1ACT": "Australian Capital Territory",
};

// ── ABS SDMX-JSON 2.0 parser ────────────────────────────────────────
interface AbsResponse {
  data: {
    dataSets: Array<{
      series: Record<string, { observations: Record<string, [number]> }>;
    }>;
    structures: Array<{
      dimensions: {
        series: Array<{ id: string; values: Array<{ id: string; name: string }> }>;
        observation: Array<{ id: string; values: Array<{ id: string; name: string }> }>;
      };
    }>;
  };
}

async function fetchAbs(): Promise<AbsResponse | null> {
  const cachePath = join(CACHE_DIR, "rppi.json");
  if (existsSync(cachePath)) {
    console.log("  [cache hit] rppi");
    return JSON.parse(readFileSync(cachePath, "utf8"));
  }

  const url = "https://api.data.abs.gov.au/data/ABS,RPPI/all?format=jsondata";
  console.log("  [fetch] ABS RPPI...");

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    console.warn(`  [ABS ${res.status}] RPPI`);
    return null;
  }

  const data = (await res.json()) as AbsResponse;
  writeFileSync(cachePath, JSON.stringify(data));
  return data;
}

function parseSdmxSeries(resp: AbsResponse): Record<string, Array<{ period: string; value: number }>> {
  const result: Record<string, Array<{ period: string; value: number }>> = {};

  const ds = resp.data.dataSets[0];
  const struct = resp.data.structures[0];
  if (!ds || !struct) return result;

  const seriesDims = struct.dimensions.series;
  const obsDims = struct.dimensions.observation;

  // Find dimension indices
  const measureDim = seriesDims.find((d) => d.id === "MEASURE");
  const regionDim = seriesDims.find((d) => d.id === "REGION");
  const timeDim = obsDims.find((d) => d.id === "TIME_PERIOD");

  const measureIdx = seriesDims.indexOf(measureDim!);
  const regionIdx = seriesDims.indexOf(regionDim!);

  const timeValues = timeDim?.values ?? [];
  const regionValues = regionDim?.values ?? [];
  const measureValues = measureDim?.values ?? [];

  for (const [seriesKey, series] of Object.entries(ds.series)) {
    const parts = seriesKey.split(":");
    const mIdx = parseInt(parts[measureIdx]);
    const rIdx = parseInt(parts[regionIdx]);

    // Only take "Index" measure (typically id "1" or named "Index Number")
    const measureName = measureValues[mIdx]?.name ?? "";
    if (!measureName.toLowerCase().includes("index")) continue;

    const regionId = regionValues[rIdx]?.id ?? `r-${rIdx}`;
    const regionName = REGIONS[regionId] ?? regionValues[rIdx]?.name ?? regionId;

    const values: Array<{ period: string; value: number }> = [];
    for (const [obsKey, obsVal] of Object.entries(series.observations)) {
      const tIdx = parseInt(obsKey);
      const period = timeValues[tIdx]?.id ?? `t-${tIdx}`;
      if (obsVal[0] !== null && obsVal[0] !== undefined) {
        values.push({ period, value: obsVal[0] });
      }
    }
    values.sort((a, b) => a.period.localeCompare(b.period));

    // Keep only last 8 quarters
    const recent = values.slice(-8);
    if (recent.length > 0) result[regionName] = recent;
  }

  return result;
}

async function main() {
  console.log("[abs-housing] Starting ABS sync...");

  const data = await fetchAbs();
  if (!data) {
    console.log("[abs-housing] ABS API unavailable — writing empty stub.");
    writeFileSync(join(OUT_DIR, "aus-rppi.json"), JSON.stringify({
      source: "Australian Bureau of Statistics — Residential Property Price Indexes",
      status: "endpoint-unavailable",
      lastUpdated: new Date().toISOString().slice(0, 10),
      regions: {},
    }, null, 2));
    return;
  }

  const regions = parseSdmxSeries(data);

  const output = {
    source: "Australian Bureau of Statistics — Residential Property Price Indexes",
    lastUpdated: new Date().toISOString().slice(0, 10),
    regions,
  };

  writeFileSync(join(OUT_DIR, "aus-rppi.json"), JSON.stringify(output, null, 2));
  console.log(`[abs-housing] Wrote ${Object.keys(regions).length} regions → aus-rppi.json`);
}

main().catch((err) => { console.error(err); process.exit(1); });

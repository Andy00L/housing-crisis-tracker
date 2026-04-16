/**
 * Fetch UK house price data from the Land Registry HPI API.
 *
 * Output: data/housing/uk/land-registry.json
 * Cache:  data/raw/uk-landregistry/
 * Auth:   None
 */

import "../env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CACHE_DIR = join(ROOT, "data/raw/uk-landregistry");
const OUT_DIR = join(ROOT, "data/housing/uk");

mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const REGIONS = [
  "united-kingdom", "england", "wales", "scotland", "northern-ireland",
  "london", "east-midlands", "east-of-england", "north-east", "north-west",
  "south-east", "south-west", "west-midlands", "yorkshire-and-the-humber",
];

// Generate last 12 months as YYYY-MM strings
function lastNMonths(n: number): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

interface HpiData {
  averagePrice?: number;
  housePriceIndex?: number;
  percentageAnnualChange?: number;
  percentageChange?: number;
  averagePriceDetached?: number;
  averagePriceSemiDetached?: number;
  averagePriceTerraced?: number;
  averagePriceFlatMaisonette?: number;
}

async function fetchRegionMonth(region: string, month: string): Promise<HpiData | null> {
  const slug = `${region}_${month}`;
  const cachePath = join(CACHE_DIR, `${slug}.json`);

  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, "utf8"));
  }

  const url = `https://landregistry.data.gov.uk/data/ukhpi/region/${region}/month/${month}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as { result?: { primaryTopic?: HpiData } };
    const topic = data?.result?.primaryTopic ?? null;
    if (topic) writeFileSync(cachePath, JSON.stringify(topic, null, 2));
    return topic;
  } catch {
    return null;
  }
}

async function main() {
  console.log("[uk-landregistry] Fetching UK HPI...");
  const months = lastNMonths(12);

  const regions: Record<string, { values: Array<{ period: string } & Partial<HpiData>> }> = {};

  for (const region of REGIONS) {
    console.log(`  ${region}...`);
    const values: Array<{ period: string } & Partial<HpiData>> = [];

    for (const month of months) {
      const data = await fetchRegionMonth(region, month);
      if (data) {
        values.push({
          period: month,
          averagePrice: data.averagePrice,
          housePriceIndex: data.housePriceIndex,
          percentageAnnualChange: data.percentageAnnualChange,
        });
      }
    }

    if (values.length > 0) {
      values.sort((a, b) => a.period.localeCompare(b.period));
      regions[region] = { values };
    }
  }

  const output = {
    source: "UK Land Registry House Price Index",
    lastUpdated: new Date().toISOString().slice(0, 10),
    regions,
  };

  writeFileSync(join(OUT_DIR, "land-registry.json"), JSON.stringify(output, null, 2));
  console.log(`[uk-landregistry] Wrote ${Object.keys(regions).length} regions → land-registry.json`);
}

main().catch((err) => { console.error(err); process.exit(1); });

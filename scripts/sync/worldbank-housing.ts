/**
 * Fetch housing-related indicators from World Bank API.
 *
 * Output: data/housing/global/worldbank.json
 * Auth:   None
 */

import "../env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CACHE_DIR = join(ROOT, "data/raw/worldbank");
const OUT_DIR = join(ROOT, "data/housing/global");

mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

// Key countries for housing comparison
const COUNTRIES = [
  "CAN", "USA", "GBR", "DEU", "FRA", "ESP", "ITA", "NLD", "IRL", "SWE",
  "AUS", "NZL", "JPN", "KOR", "SGP", "HKG", "CHN",
];

// Housing-related indicators
const INDICATORS: Array<{ id: string; name: string }> = [
  { id: "SP.POP.TOTL", name: "Total Population" },
  { id: "NY.GDP.PCAP.CD", name: "GDP per capita (current US$)" },
  { id: "FP.CPI.TOTL.ZG", name: "Inflation, consumer prices (annual %)" },
  { id: "SP.URB.TOTL.IN.ZS", name: "Urban population (% of total)" },
];

interface WbResponse {
  page: number;
  pages: number;
  total: number;
}

interface WbDataPoint {
  indicator: { id: string; value: string };
  country: { id: string; value: string };
  date: string;
  value: number | null;
}

async function fetchIndicator(country: string, indicator: string): Promise<WbDataPoint[]> {
  const slug = `${country}_${indicator}`;
  const cachePath = join(CACHE_DIR, `${slug}.json`);

  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, "utf8"));
  }

  const url = `https://api.worldbank.org/v2/country/${country}/indicator/${indicator}?format=json&per_page=10&date=2018:2024`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as [WbResponse, WbDataPoint[]] | [WbResponse];
    const points = data[1] ?? [];
    writeFileSync(cachePath, JSON.stringify(points, null, 2));
    return points;
  } catch {
    return [];
  }
}

async function main() {
  console.log("[worldbank-housing] Starting World Bank sync...");

  const countries: Record<string, {
    name: string;
    indicators: Record<string, Array<{ year: string; value: number }>>;
  }> = {};

  for (const iso3 of COUNTRIES) {
    console.log(`  ${iso3}...`);
    const indicatorData: Record<string, Array<{ year: string; value: number }>> = {};

    for (const ind of INDICATORS) {
      const points = await fetchIndicator(iso3, ind.id);
      const values = points
        .filter((p) => p.value !== null)
        .map((p) => ({ year: p.date, value: p.value as number }))
        .sort((a, b) => a.year.localeCompare(b.year));

      if (values.length > 0) {
        indicatorData[ind.id] = values;
        // Use first result's country name
        if (!countries[iso3]) {
          countries[iso3] = { name: points[0]?.country?.value ?? iso3, indicators: {} };
        }
      }
    }

    if (countries[iso3]) {
      countries[iso3].indicators = indicatorData;
    }
  }

  const output = {
    source: "World Bank Open Data",
    indicators: Object.fromEntries(INDICATORS.map((i) => [i.id, i.name])),
    lastUpdated: new Date().toISOString().slice(0, 10),
    countries,
  };

  writeFileSync(join(OUT_DIR, "worldbank.json"), JSON.stringify(output, null, 2));
  console.log(`[worldbank-housing] Wrote ${Object.keys(countries).length} countries → worldbank.json`);
}

main().catch((err) => { console.error(err); process.exit(1); });

/**
 * Fetch Singapore HDB resale flat prices from data.gov.sg.
 *
 * Output: data/housing/asia/sg-hdb.json
 * Cache:  data/raw/sg/
 * Auth:   None
 *
 * Aggregates ~228K transactions by town + month to get median prices.
 * Only fetches recent data (last 12 months) to keep the output manageable.
 */

import "../env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CACHE_DIR = join(ROOT, "data/raw/sg");
const OUT_DIR = join(ROOT, "data/housing/asia");

mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const RESOURCE_ID = "f1765b54-a209-4718-8d38-a39237f502b3";
const PAGE_SIZE = 1000;

interface HdbRecord {
  month: string;
  town: string;
  flat_type: string;
  resale_price: string;
  floor_area_sqm: string;
}

interface DatastoreResponse {
  result: {
    records: HdbRecord[];
    total: number;
  };
}

async function fetchPage(offset: number): Promise<{ records: HdbRecord[]; total: number }> {
  const cachePath = join(CACHE_DIR, `hdb_${offset}.json`);
  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, "utf8"));
  }

  // Only fetch recent data — filter by month >= 12 months ago
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 12);
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}`;

  const url = `https://data.gov.sg/api/action/datastore_search?resource_id=${RESOURCE_ID}&limit=${PAGE_SIZE}&offset=${offset}&filters={"month":"${cutoffStr}"}`;

  // Use a broader query — fetch without filter and filter locally
  const simpleUrl = `https://data.gov.sg/api/action/datastore_search?resource_id=${RESOURCE_ID}&limit=${PAGE_SIZE}&offset=${offset}&sort=month desc`;

  const res = await fetch(simpleUrl);
  if (!res.ok) {
    console.warn(`  [SG ${res.status}] offset=${offset}`);
    return { records: [], total: 0 };
  }

  const data = (await res.json()) as DatastoreResponse;
  const result = { records: data.result.records, total: data.result.total };
  writeFileSync(cachePath, JSON.stringify(result));
  return result;
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function main() {
  console.log("[sg-hdb] Fetching HDB resale prices...");

  // Fetch enough pages to get recent transactions
  const allRecords: HdbRecord[] = [];
  const MAX_PAGES = 10; // 10K records is enough for recent data

  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    console.log(`  page ${page + 1}/${MAX_PAGES} (offset ${offset})...`);
    const { records, total } = await fetchPage(offset);
    allRecords.push(...records);

    if (records.length < PAGE_SIZE || allRecords.length >= total) break;

    // Rate limit: wait 1 second between requests
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`  ${allRecords.length} total records fetched`);

  // Filter to recent months (last 12)
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 12);
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}`;

  const recent = allRecords.filter((r) => r.month >= cutoffStr);
  console.log(`  ${recent.length} records in last 12 months`);

  // Aggregate by town
  const byTown = new Map<string, number[]>();
  for (const r of recent) {
    const price = parseFloat(r.resale_price);
    if (isNaN(price)) continue;
    if (!byTown.has(r.town)) byTown.set(r.town, []);
    byTown.get(r.town)!.push(price);
  }

  const towns = Array.from(byTown.entries())
    .map(([town, prices]) => ({
      town,
      medianPrice: Math.round(median(prices)),
      transactionCount: prices.length,
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
    }))
    .sort((a, b) => b.medianPrice - a.medianPrice);

  // Overall stats
  const allPrices = recent.map((r) => parseFloat(r.resale_price)).filter((p) => !isNaN(p));

  const output = {
    source: "Housing & Development Board (HDB) via data.gov.sg",
    lastUpdated: new Date().toISOString().slice(0, 10),
    period: `${cutoffStr} to present`,
    totalTransactions: recent.length,
    overallMedianPrice: allPrices.length > 0 ? Math.round(median(allPrices)) : null,
    currency: "SGD",
    towns,
  };

  writeFileSync(join(OUT_DIR, "sg-hdb.json"), JSON.stringify(output, null, 2));
  console.log(`[sg-hdb] Wrote ${towns.length} towns → sg-hdb.json`);
}

main().catch((err) => { console.error(err); process.exit(1); });

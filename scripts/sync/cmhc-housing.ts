/**
 * Fetch Canadian rental market data from CMHC HMIP portal.
 *
 * Output: data/housing/canada/cmhc-rental.json
 * Cache:  data/raw/cmhc/
 * Auth:   None (undocumented endpoint — may break without notice)
 *
 * WARNING: This endpoint is not officially documented. If it fails,
 * the script writes an empty stub so downstream consumers aren't broken.
 */

import "../env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CACHE_DIR = join(ROOT, "data/raw/cmhc");
const OUT_DIR = join(ROOT, "data/housing/canada");

mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const CMHC_BASE = "https://www03.cmhc-schl.gc.ca/hmip-pimh/en/TableMapChart/ExportTable";

interface RentalData {
  geography: string;
  vacancyRate?: number;
  averageRent?: number;
  medianRent?: number;
  universe?: number;
}

// Province geography IDs from CMHC portal (GeographyTypeId=1)
const PROVINCE_GEOS: Array<{ id: number; name: string; code: string }> = [
  { id: 10, name: "Newfoundland and Labrador", code: "NL" },
  { id: 11, name: "Prince Edward Island", code: "PE" },
  { id: 12, name: "Nova Scotia", code: "NS" },
  { id: 13, name: "New Brunswick", code: "NB" },
  { id: 24, name: "Quebec", code: "QC" },
  { id: 35, name: "Ontario", code: "ON" },
  { id: 46, name: "Manitoba", code: "MB" },
  { id: 47, name: "Saskatchewan", code: "SK" },
  { id: 48, name: "Alberta", code: "AB" },
  { id: 59, name: "British Columbia", code: "BC" },
];

async function fetchCmhcTable(tableId: string, geoId: number, geoTypeId: number): Promise<string | null> {
  const slug = `${tableId}_${geoId}_${geoTypeId}`;
  const cachePath = join(CACHE_DIR, `${slug}.csv`);

  if (existsSync(cachePath)) {
    return readFileSync(cachePath, "utf8");
  }

  const body = new URLSearchParams({
    TableId: tableId,
    GeographyId: String(geoId),
    GeographyTypeId: String(geoTypeId),
    DisplayAs: "Table",
  });

  try {
    const res = await fetch(CMHC_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      console.warn(`  [CMHC ${res.status}] table=${tableId} geo=${geoId}`);
      return null;
    }

    const text = await res.text();
    // Check if we got CSV (not an HTML error page)
    if (text.includes("<!DOCTYPE") || text.includes("<html")) {
      console.warn(`  [CMHC] Got HTML instead of CSV for table=${tableId} geo=${geoId}`);
      return null;
    }

    writeFileSync(cachePath, text);
    return text;
  } catch (err) {
    console.warn(`  [CMHC] fetch failed: ${err}`);
    return null;
  }
}

function parseCsv(csv: string): string[][] {
  return csv
    .split("\n")
    .map((line) => line.split(",").map((cell) => cell.replace(/^"|"$/g, "").trim()));
}

async function main() {
  console.log("[cmhc-housing] Attempting CMHC rental data sync...");

  const results: RentalData[] = [];
  let anySuccess = false;

  for (const prov of PROVINCE_GEOS) {
    // Table 2.1.31.2 = Rental Market Summary by province
    const csv = await fetchCmhcTable("2.1.31.2", prov.id, 1);
    if (!csv) continue;

    anySuccess = true;
    const rows = parseCsv(csv);

    // Try to extract vacancy rate and average rent from the CSV
    // CMHC CSV format varies, but typically has headers in first row
    const data: RentalData = { geography: prov.name };

    for (const row of rows) {
      const label = (row[0] ?? "").toLowerCase();
      const value = parseFloat(row[row.length - 1] ?? "");
      if (isNaN(value)) continue;

      if (label.includes("vacancy rate")) data.vacancyRate = value;
      if (label.includes("average rent") && !label.includes("change")) data.averageRent = value;
      if (label.includes("median rent")) data.medianRent = value;
      if (label.includes("universe") || label.includes("total units")) data.universe = value;
    }

    results.push(data);
  }

  const output = {
    source: "CMHC Housing Market Information Portal",
    lastUpdated: new Date().toISOString().slice(0, 10),
    status: anySuccess ? "ok" : "endpoint-unavailable",
    provinces: results,
  };

  const outPath = join(OUT_DIR, "cmhc-rental.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  if (anySuccess) {
    console.log(`[cmhc-housing] Wrote ${results.length} provinces → cmhc-rental.json`);
  } else {
    console.log("[cmhc-housing] CMHC endpoint unavailable — wrote empty stub. StatsCan data is the primary source.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

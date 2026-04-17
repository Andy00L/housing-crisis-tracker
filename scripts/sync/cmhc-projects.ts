/**
 * CMHC Housing Construction Data Pipeline.
 *
 * Downloads Statistics Canada CSV tables (ZIP format) containing CMHC
 * housing starts, completions, and under-construction counts by Census
 * Metropolitan Area (CMA). Aggregates the data into city-level project
 * records and merges them with the existing Tavily-sourced projects in
 * data/projects/canada.json.
 *
 * Data source: StatsCan open CSV downloads (Tier 1). No API key required.
 *
 * Tables used:
 *   34-10-0154  Monthly starts/completions/under-construction by CMA
 *   34-10-0148  Starts by dwelling type and intended market by CMA/CA/CSD
 *
 * Output:  data/projects/canada.json  (merged)
 * Cache:   data/raw/statcan-cache/    (ZIP files, 7-day TTL)
 * Report:  data/raw/_run-reports/cmhc-projects-*.json
 */

import "../env.js";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import {
  recordFailure,
  recordSuccess,
} from "../../lib/resilience/health-registry.js";
import { startRunReport } from "../../lib/resilience/run-report.js";
import type { SourceName } from "../../lib/resilience/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CACHE_DIR = join(ROOT, "data/raw/statcan-cache");
const OUT_PATH = join(ROOT, "data/projects/canada.json");

const SOURCE: SourceName = "statcan";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const WINDOW_YEARS = 5;
const MIN_YEAR = new Date().getFullYear() - WINDOW_YEARS;

// ── StatsCan table configuration ────────────────────────────────────

interface TableConfig {
  id: string;
  name: string;
  url: string;
  /** Column name for the housing estimate dimension (starts/completions/etc.).
   *  When null, all rows are treated as the defaultEstimate value. */
  estimateCol: string | null;
  /** Default estimate label when estimateCol is null or missing. */
  defaultEstimate?: string;
  /** Column name for the dwelling/unit type dimension */
  typeCol: string;
}

const STATCAN_TABLES: TableConfig[] = [
  {
    id: "34100154",
    name: "Monthly starts/completions by CMA",
    url: "https://www150.statcan.gc.ca/n1/tbl/csv/34100154-eng.zip",
    estimateCol: "Housing estimates",
    typeCol: "Type of unit",
  },
  {
    id: "34100148",
    name: "Starts by type and market by CMA/CA/CSD",
    url: "https://www150.statcan.gc.ca/n1/tbl/csv/34100148-eng.zip",
    estimateCol: null, // table is exclusively about starts; no estimate column
    defaultEstimate: "Housing starts",
    typeCol: "Type of dwelling unit",
  },
];

// ── Province name to code mapping ───────────────────────────────────

const PROVINCE_NAME_TO_CODE: Record<string, string> = {
  "Newfoundland and Labrador": "NL",
  "Prince Edward Island": "PE",
  "Nova Scotia": "NS",
  "New Brunswick": "NB",
  "Quebec": "QC",
  "Ontario": "ON",
  "Manitoba": "MB",
  "Saskatchewan": "SK",
  "Alberta": "AB",
  "British Columbia": "BC",
  "Yukon": "YT",
  "Northwest Territories": "NT",
  "Nunavut": "NU",
};

/**
 * Normalize accented characters and common misspellings, then look up
 * the province code. Returns undefined when no match is found.
 */
function provinceToCode(name: string): string | undefined {
  const normalized = name
    .trim()
    .replace(/\u00A0/g, " ") // non-breaking space
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // strip diacritics

  // Direct lookup
  if (PROVINCE_NAME_TO_CODE[normalized]) return PROVINCE_NAME_TO_CODE[normalized];

  // Case-insensitive fallback
  const lower = normalized.toLowerCase();
  for (const [key, code] of Object.entries(PROVINCE_NAME_TO_CODE)) {
    if (key.toLowerCase() === lower) return code;
  }

  // Common misspellings
  if (/british\s+colom?bia/i.test(normalized)) return "BC";

  return undefined;
}

// ── RFC 4180 CSV parser ─────────────────────────────────────────────
//
// StatsCan CSVs contain quoted fields with commas inside (e.g.
// "Toronto, Ontario"). A naive comma-split would break these. This
// state-machine parser handles quoted fields, escaped quotes (""),
// and mixed quoted/unquoted columns correctly.

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote ("") or end of quoted field
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip the second quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

interface ParsedCSV {
  headers: string[];
  rows: string[][];
}

function parseCSV(text: string): ParsedCSV {
  // Handle both \r\n and \n line endings
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  const rows: string[][] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseCSVLine(line);
    // Validate row has the right number of columns
    if (fields.length === headers.length) {
      rows.push(fields);
    }
  }

  return { headers, rows };
}

// ── StatsCan row types ──────────────────────────────────────────────

interface StatCanRow {
  refDate: string;        // "2025-01"
  geo: string;            // "Toronto, Ontario"
  housingEstimate: string; // "Housing starts" | "Housing completions" | "Housing under construction"
  unitType: string;       // "Total units" | "Single-detached" | etc.
  value: number | null;
}

// ── ZIP download with retry and cache ───────────────────────────────
//
// resilientFetch is designed for text/JSON responses. StatsCan serves
// binary ZIP files, so we use fetch() directly with retry + backoff
// and record outcomes to the health registry.

function isCacheFresh(cachePath: string): boolean {
  if (!existsSync(cachePath)) return false;
  try {
    const stat = statSync(cachePath);
    return Date.now() - stat.mtimeMs < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function downloadZip(
  url: string,
  cachePath: string,
  tableName: string,
): Promise<Buffer> {
  // Serve from cache when fresh
  if (isCacheFresh(cachePath)) {
    console.log(`  [cache] ${tableName}: using cached ZIP`);
    return readFileSync(cachePath);
  }

  const maxAttempts = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      console.log(
        `  [download] ${tableName}: attempt ${attempt + 1}/${maxAttempts}`,
      );
      const response = await fetch(url, {
        headers: {
          "user-agent": "housing-crisis-tracker/1.0 (+https://github.com)",
          accept: "application/zip, application/octet-stream, */*",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // Validate we got something substantial (a valid ZIP is at least ~22 bytes)
      if (buffer.length < 22) {
        throw new Error(
          `Response too small (${buffer.length} bytes), likely not a valid ZIP`,
        );
      }

      // Write to cache
      mkdirSync(dirname(cachePath), { recursive: true });
      writeFileSync(cachePath, buffer);
      recordSuccess(SOURCE);
      console.log(
        `  [download] ${tableName}: OK (${(buffer.length / 1024).toFixed(0)} KB)`,
      );
      return buffer;
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxAttempts - 1) {
        const backoff =
          1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
        console.warn(
          `  [retry] ${tableName} attempt ${attempt + 1} failed: ${lastError.message}, retrying in ${backoff}ms`,
        );
        await sleep(backoff);
        continue;
      }
    }
  }

  // All attempts failed. Try stale cache as last resort.
  if (existsSync(cachePath)) {
    console.warn(
      `  [fallback] ${tableName}: download failed, using stale cache`,
    );
    recordFailure(SOURCE, {
      kind: "network-error",
      source: SOURCE,
      message: `Download failed (${lastError?.message}), used stale cache`,
    });
    return readFileSync(cachePath);
  }

  recordFailure(SOURCE, {
    kind: "network-error",
    source: SOURCE,
    message: lastError?.message ?? "download failed",
  });
  throw new Error(
    `Failed to download ${tableName} after ${3} attempts: ${lastError?.message}`,
  );
}

// ── ZIP extraction ──────────────────────────────────────────────────

function extractCSVFromZip(zipBuffer: Buffer, tableName: string): string {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch (err) {
    throw new Error(
      `Corrupted ZIP for ${tableName}: ${(err as Error).message}`,
    );
  }

  const entries = zip.getEntries();
  const csvEntry = entries.find(
    (e) => e.entryName.endsWith(".csv") && !e.entryName.startsWith("__MACOSX"),
  );

  if (!csvEntry) {
    const names = entries.map((e) => e.entryName).join(", ");
    throw new Error(
      `No CSV file found in ZIP for ${tableName}. Entries: ${names}`,
    );
  }

  const buffer = csvEntry.getData();
  // StatsCan CSVs are UTF-8 with optional BOM
  let text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1); // Strip BOM
  }
  return text;
}

// ── Parse StatsCan CSV into structured rows ─────────────────────────

function parseStatCanCSV(
  csvText: string,
  config: TableConfig,
): StatCanRow[] {
  const { headers, rows } = parseCSV(csvText);

  // Locate required columns
  const refDateIdx = headers.indexOf("REF_DATE");
  const geoIdx = headers.indexOf("GEO");
  const valueIdx = headers.indexOf("VALUE");

  if (refDateIdx < 0 || geoIdx < 0 || valueIdx < 0) {
    throw new Error(
      `Missing required columns in ${config.id}. Found: ${headers.join(", ")}`,
    );
  }

  // Locate dimension columns (case-insensitive match)
  const estimateIdx = config.estimateCol
    ? headers.findIndex(
        (h) => h.toLowerCase() === config.estimateCol!.toLowerCase(),
      )
    : -1;
  const typeIdx = headers.findIndex(
    (h) => h.toLowerCase() === config.typeCol.toLowerCase(),
  );

  if (config.estimateCol && estimateIdx < 0) {
    console.warn(
      `  [warn] Column "${config.estimateCol}" not found in ${config.id}. Headers: ${headers.join(", ")}`,
    );
  }
  if (typeIdx < 0) {
    console.warn(
      `  [warn] Column "${config.typeCol}" not found in ${config.id}. Headers: ${headers.join(", ")}`,
    );
  }

  const parsed: StatCanRow[] = [];

  for (const fields of rows) {
    const rawValue = fields[valueIdx]?.trim();

    // StatsCan uses "" (empty), ".." (suppressed), "x" (confidential),
    // "F" (unreliable) for missing data. Skip these.
    if (!rawValue || rawValue === ".." || rawValue === "x" || rawValue === "F") {
      continue;
    }

    const value = parseFloat(rawValue);
    if (Number.isNaN(value)) continue;

    parsed.push({
      refDate: fields[refDateIdx]?.trim() ?? "",
      geo: fields[geoIdx]?.trim() ?? "",
      housingEstimate:
        estimateIdx >= 0
          ? (fields[estimateIdx]?.trim() ?? "")
          : (config.defaultEstimate ?? ""),
      unitType: typeIdx >= 0 ? (fields[typeIdx]?.trim() ?? "") : "",
      value,
    });
  }

  return parsed;
}

// ── Geography parsing ───────────────────────────────────────────────

interface ParsedGeo {
  city: string;
  province: string;
  provinceCode: string;
}

/**
 * Parse a StatsCan GEO string like "Toronto, Ontario" into a city name
 * and province code. Returns null for national/provincial aggregates or
 * unrecognizable values.
 */
function parseGeoName(geo: string): ParsedGeo | null {
  // Skip national or provincial aggregates (no comma)
  if (!geo.includes(",")) return null;

  // Split on the LAST comma to handle names like "Ottawa - Gatineau, Ontario part"
  const lastComma = geo.lastIndexOf(",");
  let city = geo.slice(0, lastComma).trim();
  let province = geo.slice(lastComma + 1).trim();

  // Strip "part" suffix for multi-province CMAs
  // e.g. "Ottawa - Gatineau, Ontario part" -> province = "Ontario"
  province = province.replace(/\s+part$/i, "").trim();

  // Strip non-breaking spaces and normalize whitespace
  city = city.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
  province = province.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();

  // Normalize accents for lookup
  const provinceCode = provinceToCode(province);
  if (!provinceCode) return null;

  return { city, province, provinceCode };
}

/**
 * Normalize a city name for deduplication. Strips accents, lowercases,
 * and collapses the " - " separator used in multi-city CMAs.
 */
function normalizeCityKey(city: string): string {
  return city
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build a URL-safe slug from a string.
 */
function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

// ── Data aggregation ────────────────────────────────────────────────

interface CityAggregate {
  city: string;
  provinceCode: string;
  year: number;
  starts: number;
  completions: number;
  underConstruction: number;
}

/**
 * Filter rows for total-units estimates and group by geography. For each
 * geography, keep only the most recent year's data and sum monthly values
 * to annual totals.
 */
function aggregateByCity(rows: StatCanRow[]): CityAggregate[] {
  // Filter to "Total units" (or all rows if the type column was missing)
  const totalRows = rows.filter((r) => {
    if (!r.unitType) return true; // no type column, keep everything
    return /^total\s+unit/i.test(r.unitType);
  });

  // Group by normalized geography
  const byCityKey = new Map<
    string,
    { geo: ParsedGeo; rows: StatCanRow[] }
  >();

  for (const row of totalRows) {
    const geo = parseGeoName(row.geo);
    if (!geo) continue;

    const key = `${normalizeCityKey(geo.city)}|${geo.provinceCode}`;
    let entry = byCityKey.get(key);
    if (!entry) {
      entry = { geo, rows: [] };
      byCityKey.set(key, entry);
    }
    entry.rows.push(row);
  }

  const aggregates: CityAggregate[] = [];

  for (const { geo, rows: cityRows } of byCityKey.values()) {
    // Find the most recent year with data
    const years = new Set(
      cityRows
        .map((r) => parseInt(r.refDate.split("-")[0], 10))
        .filter((y) => !Number.isNaN(y)),
    );
    if (years.size === 0) continue;

    const recentYear = Math.max(...years);
    const yearRows = cityRows.filter((r) =>
      r.refDate.startsWith(String(recentYear)),
    );

    // Deduplicate by (refDate, housingEstimate) to avoid double counting
    const seen = new Set<string>();
    const dedupedRows: StatCanRow[] = [];
    for (const r of yearRows) {
      const dedupeKey = `${r.refDate}|${r.housingEstimate}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      dedupedRows.push(r);
    }

    // Sum by estimate type across all months in the year
    let starts = 0;
    let completions = 0;
    let underConstruction = 0;

    for (const r of dedupedRows) {
      const estimate = r.housingEstimate.toLowerCase();
      const val = r.value ?? 0;

      if (estimate.includes("start")) {
        starts += val;
      } else if (estimate.includes("completion")) {
        completions += val;
      } else if (estimate.includes("under construction")) {
        // Under-construction is a snapshot, not cumulative. Take the latest month.
        const existingMonths = dedupedRows
          .filter(
            (x) =>
              x.housingEstimate.toLowerCase().includes("under construction") &&
              x.value !== null,
          )
          .sort((a, b) => b.refDate.localeCompare(a.refDate));
        if (existingMonths.length > 0) {
          underConstruction = existingMonths[0].value ?? 0;
        }
      }
    }

    // Negative values are valid (CMHC data revisions). Zero is valid too.
    aggregates.push({
      city: geo.city,
      provinceCode: geo.provinceCode,
      year: recentYear,
      starts,
      completions,
      underConstruction,
    });
  }

  return aggregates;
}

// ── Project generation ──────────────────────────────────────────────

/** Shape matching the CaProject interface in build-placeholder.ts */
interface CaProject {
  id: string;
  name: string;
  developer: string;
  province: string;
  city?: string;
  unitCount?: number;
  currency: string;
  projectType: string;
  status: string;
  announceDate?: string;
  sourceUrl: string;
  blurb: string;
  concerns: string[];
}

function aggregateToProject(agg: CityAggregate): CaProject {
  const status =
    agg.underConstruction > 0 ? "under-construction" : "operational";

  // unitCount = cumulative starts for the year (total activity measure)
  const unitCount = agg.starts > 0 ? agg.starts : undefined;

  const parts: string[] = [];
  if (agg.starts > 0) parts.push(`${agg.starts.toLocaleString("en-CA")} starts`);
  if (agg.completions > 0)
    parts.push(`${agg.completions.toLocaleString("en-CA")} completions`);
  if (agg.underConstruction > 0)
    parts.push(
      `${agg.underConstruction.toLocaleString("en-CA")} under construction`,
    );

  const metricsLine =
    parts.length > 0 ? parts.join(", ") : "No activity recorded";

  return {
    id: `cmhc-aggregate-${slugify(agg.city)}`,
    name: `${agg.city} Total Construction (${agg.year})`,
    developer: "Multiple (CMHC aggregate data)",
    province: agg.provinceCode,
    city: agg.city,
    unitCount,
    currency: "CAD",
    projectType: "mixed",
    status,
    announceDate: `${agg.year}-01-01`,
    sourceUrl: `https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3410015401`,
    blurb: `${metricsLine} in ${agg.year}. Source: Statistics Canada Table 34-10-0154 (CMHC).`,
    concerns: [],
  };
}

// ── Merge logic ─────────────────────────────────────────────────────

interface CaProjectsFile {
  country: string;
  currency: string;
  lastUpdated: string;
  projects: CaProject[];
}

function readExistingProjects(): CaProjectsFile | null {
  if (!existsSync(OUT_PATH)) return null;

  try {
    const raw = readFileSync(OUT_PATH, "utf8");
    const parsed = JSON.parse(raw);

    // Handle both { projects: [...] } wrapper and plain array
    if (Array.isArray(parsed)) {
      return {
        country: "Canada",
        currency: "CAD",
        lastUpdated: new Date().toISOString().slice(0, 10),
        projects: parsed,
      };
    }
    if (parsed && Array.isArray(parsed.projects)) {
      return parsed as CaProjectsFile;
    }

    console.warn("[cmhc-projects] canada.json has unexpected shape, treating as empty");
    return null;
  } catch (err) {
    console.warn(
      `[cmhc-projects] Could not parse canada.json: ${(err as Error).message}`,
    );
    return null;
  }
}

/**
 * Merge CMHC aggregate projects into the existing dataset.
 *
 * Strategy:
 *   1. Keep all existing non-CMHC projects untouched.
 *   2. Replace any existing CMHC aggregate entries (id starts with "cmhc-aggregate-")
 *      with fresh data from this run.
 *   3. Add new CMHC aggregates for cities not yet represented.
 */
function mergeProjects(
  existing: CaProject[],
  cmhc: CaProject[],
): CaProject[] {
  // Separate existing projects into CMHC aggregates and everything else
  const nonCmhc = existing.filter(
    (p) => !p.id.startsWith("cmhc-aggregate-"),
  );

  // Build a set of (city, province) keys from non-CMHC projects for reference
  const existingCityKeys = new Set(
    nonCmhc
      .filter((p) => p.city)
      .map((p) => `${normalizeCityKey(p.city!)}|${p.province}`),
  );

  // All CMHC aggregates get added (they replace old CMHC aggregates)
  const merged = [...nonCmhc, ...cmhc];

  const citiesWithExisting = cmhc.filter(
    (p) => p.city && existingCityKeys.has(`${normalizeCityKey(p.city)}|${p.province}`),
  ).length;
  const citiesNew = cmhc.length - citiesWithExisting;

  console.log(
    `  [merge] ${nonCmhc.length} existing + ${cmhc.length} CMHC aggregates (${citiesNew} new cities, ${citiesWithExisting} supplementary)`,
  );

  return merged;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const report = startRunReport("cmhc-projects");

  console.log("[cmhc-projects] Starting CMHC housing construction pipeline...");
  mkdirSync(CACHE_DIR, { recursive: true });

  // Step 1: Download and parse StatsCan CSVs
  const allRows: StatCanRow[] = [];
  let tablesDownloaded = 0;

  for (const table of STATCAN_TABLES) {
    const cachePath = join(CACHE_DIR, `${table.id}.zip`);

    let zipBuffer: Buffer;
    try {
      zipBuffer = await downloadZip(table.url, cachePath, table.name);
    } catch (err) {
      report.noteFailure({
        entity: table.id,
        error: `Download failed: ${(err as Error).message}`,
        retryable: true,
        next_action: "retry next run (StatsCan CDN may be temporarily down)",
      });
      report.markSourceDegraded(SOURCE);
      continue;
    }

    let csvText: string;
    try {
      csvText = extractCSVFromZip(zipBuffer, table.name);
    } catch (err) {
      report.noteFailure({
        entity: table.id,
        error: `ZIP extraction failed: ${(err as Error).message}`,
        retryable: true,
        next_action: "retry next run or investigate corrupt ZIP",
      });
      continue;
    }

    let rows: StatCanRow[];
    try {
      rows = parseStatCanCSV(csvText, table);
    } catch (err) {
      report.noteFailure({
        entity: table.id,
        error: `CSV parse failed: ${(err as Error).message}`,
        retryable: false,
        next_action: "investigate CSV format change",
      });
      continue;
    }

    console.log(`  [parse] ${table.name}: ${rows.length} data rows`);
    // Avoid spread for large arrays (340K+ rows causes stack overflow)
    for (const row of rows) allRows.push(row);
    tablesDownloaded++;
    report.recordUsage(SOURCE, { calls: 1, cache_hits: isCacheFresh(cachePath) ? 1 : 0 });
  }

  if (tablesDownloaded === 0) {
    console.error("[cmhc-projects] No tables could be downloaded or parsed.");
    report.noteFailure({
      entity: "cmhc-projects",
      error: "All table downloads/parses failed",
      retryable: true,
      next_action: "retry when StatsCan CDN recovers",
    });
    report.finish("failed");
    process.exit(1);
  }

  // Step 2: Aggregate into city-level records
  const allAggregates = aggregateByCity(allRows);

  // Filter to rolling 5-year window
  const aggregates = allAggregates.filter((a) => a.year >= MIN_YEAR);
  console.log(
    `  [filter] ${allAggregates.length} → ${aggregates.length} aggregates (dropped ${allAggregates.length - aggregates.length} older than ${MIN_YEAR})`,
  );
  console.log(`  [aggregate] ${aggregates.length} city-level aggregates`);

  if (aggregates.length === 0) {
    console.warn("[cmhc-projects] No city aggregates produced from CSV data.");
    report.addNote("Zero aggregates. Possible CSV format change.");
    report.finish("degraded");
    return;
  }

  // Step 3: Generate project records
  const cmhcProjects = aggregates.map(aggregateToProject);
  report.incrementTotal(cmhcProjects.length);

  // Log cities that lack coordinates (will be missing map dots)
  const { CANADIAN_CITY_COORDS } = await import(
    "../../lib/projects-map.js"
  );
  const missingCoords = cmhcProjects.filter(
    (p) => p.city && !CANADIAN_CITY_COORDS[p.city],
  );
  if (missingCoords.length > 0) {
    const names = missingCoords.map((p) => p.city).join(", ");
    console.warn(`  [warn] ${missingCoords.length} cities missing coordinates: ${names}`);
    report.addNote(`Missing coords for: ${names}`);
  }

  // Step 4: Merge with existing Tavily-sourced projects
  const existingFile = readExistingProjects();
  const existingProjects = existingFile?.projects ?? [];
  const merged = mergeProjects(existingProjects, cmhcProjects);

  // Step 5: Write output
  const output: CaProjectsFile = {
    country: "Canada",
    currency: "CAD",
    lastUpdated: new Date().toISOString().slice(0, 10),
    projects: merged,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(
    `[cmhc-projects] Wrote ${merged.length} projects (${cmhcProjects.length} CMHC) to ${OUT_PATH}`,
  );

  // Step 6: Finalize report
  for (const p of cmhcProjects) {
    report.noteSuccess(p.id);
  }
  report.addNote(
    `Existing: ${existingProjects.length}, CMHC added: ${cmhcProjects.length}, Total: ${merged.length}`,
  );
  report.addNote(`Tables processed: ${tablesDownloaded}/${STATCAN_TABLES.length}`);

  const finalReport = report.finish();
  console.log(
    `[cmhc-projects] Done. status=${finalReport.status} duration=${finalReport.duration_ms}ms`,
  );
}

main().catch((err) => {
  console.error("[cmhc-projects] Fatal error:", err);
  process.exit(1);
});

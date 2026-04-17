/**
 * NHS Individual Project Data Pipeline (Tier 2).
 *
 * Downloads the Housing, Infrastructure and Communities Canada (HICC)
 * project map CSV export containing individual NHS-funded housing projects.
 * Filters for housing records, normalizes to CaProject format, and merges
 * with the existing data in data/projects/canada.json.
 *
 * Data source: HICC Project Map bulk CSV export (POST).
 *   Endpoint: housing-infrastructure.canada.ca/gmap-gcarte/download-gmap-data-eng.php
 *   No API key required.
 *
 * The CSV contains ~13,000 infrastructure projects of which ~2,100 are
 * Housing category records with project name, municipality, province,
 * unit counts, funding, lat/lng, program name, and status.
 *
 * Output:  data/projects/canada.json  (merged)
 * Cache:   data/raw/nhs-cache/        (CSV, 7-day TTL)
 * Report:  data/raw/_run-reports/cmhc-nhs-projects-*.json
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
import { resilientFetch } from "../../lib/resilient-fetch.js";
import { startRunReport } from "../../lib/resilience/run-report.js";
import type { SourceName } from "../../lib/resilience/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CACHE_DIR = join(ROOT, "data/raw/nhs-cache");
const CACHE_PATH = join(CACHE_DIR, "hicc-projects.csv");
const OUT_PATH = join(ROOT, "data/projects/canada.json");

const SOURCE: SourceName = "cmhc-nhs";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const WINDOW_YEARS = 5;
const MIN_YEAR = new Date().getFullYear() - WINDOW_YEARS;

const HICC_CSV_URL =
  "https://housing-infrastructure.canada.ca/gmap-gcarte/download-gmap-data-eng.php";

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

function provinceToCode(name: string): string | undefined {
  const normalized = name
    .trim()
    .replace(/\u00A0/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (PROVINCE_NAME_TO_CODE[normalized]) return PROVINCE_NAME_TO_CODE[normalized];

  const lower = normalized.toLowerCase();
  for (const [key, code] of Object.entries(PROVINCE_NAME_TO_CODE)) {
    if (key.toLowerCase() === lower) return code;
  }
  // Already a 2-letter code?
  const upper = name.trim().toUpperCase();
  if (Object.values(PROVINCE_NAME_TO_CODE).includes(upper)) return upper;

  return undefined;
}

// ── RFC 4180 CSV parser ─────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
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

interface ParsedRow {
  [key: string]: string;
}

function parseCSV(text: string): ParsedRow[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length === 0) return [];

  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseCSVLine(line);
    if (fields.length !== headers.length) continue;
    const row: ParsedRow = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = fields[j]?.trim() ?? "";
    }
    rows.push(row);
  }
  return rows;
}

// ── Column name detection ───────────────────────────────────────────
// The HICC CSV has 24 columns. We match by partial name to handle
// minor label changes across releases.

function findCol(headers: string[], ...patterns: string[]): string | null {
  for (const pattern of patterns) {
    const lower = pattern.toLowerCase();
    const match = headers.find((h) => h.toLowerCase().includes(lower));
    if (match) return match;
  }
  return null;
}

// ── CaProject shape (matches canada.json / build-placeholder.ts) ────

interface CaProject {
  id: string;
  name: string;
  developer: string;
  province: string;
  city?: string;
  unitCount?: number;
  affordableUnits?: number;
  projectCost?: number;
  currency: string;
  projectType: string;
  status: string;
  announceDate?: string;
  sourceUrl: string;
  blurb: string;
  concerns: string[];
  lat?: number;
  lng?: number;
}

interface CaProjectsFile {
  country: string;
  currency: string;
  lastUpdated: string;
  projects: CaProject[];
}

// ── Program and status mapping ──────────────────────────────────────

function mapProgramToType(program: string): string {
  const p = program.toLowerCase();
  if (p.includes("rapid housing")) return "social";
  if (p.includes("co-operative") || p.includes("cooperative") || p.includes("chdp")) return "cooperative";
  if (p.includes("apartment construction") || p.includes("rental construction") || p.includes("rcfi")) return "rental";
  if (p.includes("affordable housing fund")) return "mixed";
  if (p.includes("innovation")) return "mixed";
  if (p.includes("federal lands")) return "mixed";
  return "mixed";
}

function mapStatus(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("complete")) return "operational";
  if (s.includes("progress") || s.includes("construction") || s.includes("started")) return "under-construction";
  if (s.includes("pre-construction") || s.includes("committed")) return "proposed";
  // Exclude cancelled/withdrawn
  if (s.includes("cancel") || s.includes("withdraw") || s.includes("terminated")) return "__excluded__";
  return "proposed";
}

function expandProgram(abbrev: string): string {
  const MAP: Record<string, string> = {
    "affordable housing fund": "Affordable Housing Fund (AHF)",
    "rapid housing initiative": "Rapid Housing Initiative (RHI)",
    "apartment construction loan program": "Apartment Construction Loan Program (ACLP)",
    "affordable housing innovation fund": "Affordable Housing Innovation Fund (AHIF)",
    "federal lands initiative": "Federal Lands Initiative (FLI)",
    "co-operative housing development program": "Co-operative Housing Development Program (CHDP)",
    "rental construction financing initiative": "Rental Construction Financing Initiative (RCFI)",
  };
  const lower = abbrev.toLowerCase();
  for (const [key, val] of Object.entries(MAP)) {
    if (lower.includes(key)) return val;
  }
  return abbrev;
}

function buildConcerns(program: string, indigenous: boolean): string[] {
  const concerns: string[] = ["affordability"];
  const p = program.toLowerCase();
  if (p.includes("rapid housing") || p.includes("social")) {
    concerns.push("social-housing");
  }
  if (indigenous) {
    concerns.push("indigenous-housing");
  }
  return concerns;
}

// ── Slug / normalize helpers ────────────────────────────────────────

function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function normalizeKey(name?: string, city?: string, province?: string): string {
  const n = (name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
  const c = (city ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
  return `${n}_${c}_${province ?? ""}`;
}

// ── Cache ───────────────────────────────────────────────────────────

function isCacheFresh(): boolean {
  if (!existsSync(CACHE_PATH)) return false;
  try {
    const stat = statSync(CACHE_PATH);
    return Date.now() - stat.mtimeMs < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

// ── CSV download ────────────────────────────────────────────────────

async function downloadHICC(): Promise<string> {
  // Serve from cache if fresh
  if (isCacheFresh()) {
    console.log("  [cache] Using cached HICC CSV");
    return readFileSync(CACHE_PATH, "utf8");
  }

  console.log("  [download] Fetching HICC project map CSV...");
  const result = await resilientFetch<string>(SOURCE, HICC_CSV_URL, {
    expectContentType: "text/csv",
    maxAttempts: 3,
    init: {
      method: "POST",
      body: "AllData=Download+All+Data",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    },
  });

  if (!result.ok) {
    // Try stale cache as fallback
    if (existsSync(CACHE_PATH)) {
      console.warn(
        `  [fallback] HICC download failed (${result.reason.kind}), using stale cache`,
      );
      return readFileSync(CACHE_PATH, "utf8");
    }
    throw new Error(`HICC CSV download failed: ${result.reason.kind}`);
  }

  const csvText = result.data as string;

  // Validate we got CSV (not an HTML error page)
  if (csvText.startsWith("<!DOCTYPE") || csvText.startsWith("<html")) {
    if (existsSync(CACHE_PATH)) {
      console.warn("  [fallback] HICC returned HTML instead of CSV, using stale cache");
      return readFileSync(CACHE_PATH, "utf8");
    }
    throw new Error("HICC endpoint returned HTML instead of CSV");
  }

  // Cache to disk
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_PATH, csvText);
  console.log(`  [download] OK (${(csvText.length / 1024).toFixed(0)} KB)`);
  return csvText;
}

// ── Parse and normalize housing records ─────────────────────────────

function parseHousingProjects(csvText: string): CaProject[] {
  const rows = parseCSV(csvText);
  if (rows.length === 0) {
    throw new Error("HICC CSV parsed to zero rows");
  }

  const headers = Object.keys(rows[0]);
  console.log(`  [parse] ${rows.length} total records, detecting columns...`);

  // Detect column names
  const colCategory = findCol(headers, "Category");
  const colProjectName = findCol(headers, "Project Name");
  const colDepartment = findCol(headers, "Department");
  const colProgram = findCol(headers, "Program Name");
  const colDescription = findCol(headers, "Project Description", "Description");
  const colContribution = findCol(headers, "Federal Contribution");
  const colTotalCost = findCol(headers, "Estimated Total Cost", "Total Cost");
  const colProvince = findCol(headers, "Province", "Province/Territory");
  const colMunicipality = findCol(headers, "Municipality");
  const colLat = findCol(headers, "Latitude");
  const colLng = findCol(headers, "Longitude");
  const colStartDate = findCol(headers, "Estimated Start Date", "Start Date");
  const colStatus = findCol(headers, "Project Status", "Status");
  const colIndigenous = findCol(headers, "Indigenous");
  const colUnits = findCol(headers, "Number of Units");
  const colAffordable = findCol(headers, "Number of Affordable");
  const colExpectedResult = findCol(headers, "Expected Result");

  if (!colCategory) {
    throw new Error(
      `Cannot find Category column. Headers: ${headers.join(", ")}`,
    );
  }

  // Filter for Housing category
  const housingRows = rows.filter((r) => {
    const cat = r[colCategory!]?.toLowerCase() ?? "";
    return cat === "housing" || cat.includes("housing");
  });

  console.log(`  [parse] ${housingRows.length} housing records`);

  const projects: CaProject[] = [];
  const seenIds = new Set<string>();

  for (const row of housingRows) {
    const projectName = colProjectName ? row[colProjectName] : "";
    const department = colDepartment ? row[colDepartment] : "";
    const program = colProgram ? row[colProgram] : "";
    const description = colDescription ? row[colDescription] : "";
    const expectedResult = colExpectedResult ? row[colExpectedResult] : "";
    const contribution = colContribution ? row[colContribution] : "";
    const totalCost = colTotalCost ? row[colTotalCost] : "";
    const province = colProvince ? row[colProvince] : "";
    const municipality = colMunicipality ? row[colMunicipality] : "";
    const latStr = colLat ? row[colLat] : "";
    const lngStr = colLng ? row[colLng] : "";
    const startDate = colStartDate ? row[colStartDate] : "";
    const statusRaw = colStatus ? row[colStatus] : "";
    const indigenousRaw = colIndigenous ? row[colIndigenous] : "";
    const unitsRaw = colUnits ? row[colUnits] : "";
    const affordableRaw = colAffordable ? row[colAffordable] : "";

    // Skip if no province (can't map it)
    const provinceCode = provinceToCode(province);
    if (!provinceCode) continue;

    // Skip cancelled/withdrawn
    const status = mapStatus(statusRaw);
    if (status === "__excluded__") continue;

    // Skip if no municipality (can't place on map or in panels)
    if (!municipality) continue;

    // Parse numeric fields
    const unitCount = parsePositiveInt(unitsRaw);
    const affordableUnits = parsePositiveInt(affordableRaw);
    const projectCost = parsePositiveFloat(
      totalCost || contribution,
    );
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    const indigenous = /yes|true|1|oui/i.test(indigenousRaw);

    // Build a display name
    const displayName =
      projectName || `${expandProgram(program)} project in ${municipality}`;

    // Generate unique ID
    let baseId = `nhs-${slugify(displayName)}`;
    if (seenIds.has(baseId)) {
      // Append province + municipality for uniqueness
      baseId = `nhs-${slugify(displayName)}-${provinceCode.toLowerCase()}-${slugify(municipality)}`;
    }
    // If still duplicate, append counter
    let finalId = baseId;
    let counter = 2;
    while (seenIds.has(finalId)) {
      finalId = `${baseId}-${counter}`;
      counter++;
    }
    seenIds.add(finalId);

    // Build blurb from description, expected result, and metrics
    const blurbParts: string[] = [];
    if (description && description.length > 10) {
      blurbParts.push(description.slice(0, 300));
    } else if (expectedResult && expectedResult.length > 10) {
      blurbParts.push(expectedResult.slice(0, 300));
    }
    if (program) {
      blurbParts.push(`NHS program: ${expandProgram(program)}.`);
    }
    if (projectCost && projectCost > 0) {
      const costM = projectCost / 1_000_000;
      blurbParts.push(
        `Federal commitment: $${costM >= 1 ? costM.toFixed(1) + "M" : (projectCost / 1000).toFixed(0) + "K"}.`,
      );
    }
    const blurb =
      blurbParts.join(" ").slice(0, 500) ||
      `NHS-funded housing project in ${municipality}, ${province}.`;

    const project: CaProject = {
      id: finalId,
      name: displayName,
      developer: department || "CMHC",
      province: provinceCode,
      city: municipality,
      unitCount,
      affordableUnits,
      projectCost,
      currency: "CAD",
      projectType: mapProgramToType(program),
      status,
      announceDate: startDate || undefined,
      sourceUrl:
        "https://housing-infrastructure.canada.ca/gmap-gcarte/index-eng.html",
      blurb,
      concerns: buildConcerns(program, indigenous),
      lat: Number.isFinite(lat) && lat !== 0 ? lat : undefined,
      lng: Number.isFinite(lng) && lng !== 0 ? lng : undefined,
    };

    projects.push(project);
  }

  return projects;
}

function parsePositiveInt(s: string): number | undefined {
  if (!s) return undefined;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parsePositiveFloat(s: string): number | undefined {
  if (!s) return undefined;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// ── Merge logic ─────────────────────────────────────────────────────

function readExistingProjects(): CaProjectsFile | null {
  if (!existsSync(OUT_PATH)) return null;
  try {
    const raw = readFileSync(OUT_PATH, "utf8");
    const parsed = JSON.parse(raw);
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
    console.warn("[cmhc-nhs] canada.json has unexpected shape, treating as empty");
    return null;
  } catch (err) {
    console.warn(
      `[cmhc-nhs] Could not parse canada.json: ${(err as Error).message}`,
    );
    return null;
  }
}

function mergeProjects(
  existing: CaProject[],
  nhs: CaProject[],
): { merged: CaProject[]; added: number; skipped: number } {
  // Remove old NHS entries (re-generated each run)
  const nonNhs = existing.filter((p) => !p.id.startsWith("nhs-"));

  // Build dedup keys from non-NHS entries
  const existingKeys = new Set(
    nonNhs.map((p) => normalizeKey(p.name, p.city, p.province)),
  );

  const merged = [...nonNhs];
  let added = 0;
  let skipped = 0;

  for (const project of nhs) {
    const key = normalizeKey(project.name, project.city, project.province);
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }
    merged.push(project);
    existingKeys.add(key);
    added++;
  }

  return { merged, added, skipped };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const report = startRunReport("cmhc-nhs-projects");

  console.log("[cmhc-nhs] Starting NHS individual project pipeline...");
  mkdirSync(CACHE_DIR, { recursive: true });

  // Count existing before merge
  const existingFile = readExistingProjects();
  const existingCount = existingFile?.projects.length ?? 0;
  console.log(`  [existing] ${existingCount} projects in canada.json`);

  // Step 1: Download HICC CSV
  let csvText: string;
  try {
    csvText = await downloadHICC();
  } catch (err) {
    report.noteFailure({
      entity: "hicc-csv",
      error: `Download failed: ${(err as Error).message}`,
      retryable: true,
      next_action: "retry next run (HICC may be temporarily down)",
    });
    report.markSourceDegraded(SOURCE);
    report.finish("failed");
    console.error(`[cmhc-nhs] Download failed: ${(err as Error).message}`);
    process.exit(1);
  }

  report.recordUsage(SOURCE, {
    calls: 1,
    cache_hits: isCacheFresh() ? 1 : 0,
  });

  // Step 2: Parse and filter housing records
  let nhsProjects: CaProject[];
  try {
    nhsProjects = parseHousingProjects(csvText);
  } catch (err) {
    report.noteFailure({
      entity: "hicc-parse",
      error: `Parse failed: ${(err as Error).message}`,
      retryable: false,
      next_action: "investigate CSV format change",
    });
    report.finish("failed");
    console.error(`[cmhc-nhs] Parse failed: ${(err as Error).message}`);
    process.exit(1);
  }

  // Filter to rolling 5-year window using announceDate (HICC "Estimated Start Date").
  // Projects with no parseable date are kept (don't drop data we can't date).
  const beforeFilter = nhsProjects.length;
  nhsProjects = nhsProjects.filter((p) => {
    if (!p.announceDate) return true;
    const year = parseInt(p.announceDate.slice(0, 4), 10);
    if (!Number.isFinite(year)) return true;
    return year >= MIN_YEAR;
  });
  console.log(
    `  [filter] ${beforeFilter} → ${nhsProjects.length} (dropped ${beforeFilter - nhsProjects.length} projects older than ${MIN_YEAR})`,
  );

  console.log(`  [normalize] ${nhsProjects.length} NHS housing projects`);
  report.incrementTotal(nhsProjects.length);

  if (nhsProjects.length === 0) {
    console.warn("[cmhc-nhs] No housing projects after filtering.");
    report.addNote("Zero housing records. Possible CSV format or category change.");
    report.finish("degraded");
    return;
  }

  // Step 3: Log geocoding coverage
  const withCoords = nhsProjects.filter(
    (p) => typeof p.lat === "number" && typeof p.lng === "number",
  );
  const withoutCoords = nhsProjects.length - withCoords.length;
  console.log(
    `  [geocoding] ${withCoords.length} with HICC coords, ${withoutCoords} without`,
  );
  if (withoutCoords > 0) {
    const cities = [
      ...new Set(
        nhsProjects
          .filter((p) => p.lat === undefined)
          .map((p) => p.city)
          .filter(Boolean),
      ),
    ];
    report.addNote(
      `${withoutCoords} projects without HICC coordinates. Cities: ${cities.slice(0, 20).join(", ")}`,
    );
  }

  // Step 4: Merge with existing data
  const existingProjects = existingFile?.projects ?? [];
  const { merged: rawMerged, added, skipped } = mergeProjects(existingProjects, nhsProjects);

  // Drop StatsCan aggregates superseded by NHS individual data.
  const aggregateCount = rawMerged.filter((p) => p.id.startsWith("cmhc-aggregate-")).length;
  const merged = rawMerged.filter((p) => !p.id.startsWith("cmhc-aggregate-"));
  if (aggregateCount > 0) {
    console.log(
      `  [cleanup] Removed ${aggregateCount} cmhc-aggregate entries (superseded by NHS individual data)`,
    );
  }

  console.log(
    `  [merge] ${added} added, ${skipped} skipped (dedup), ${aggregateCount} aggregates removed, total: ${merged.length}`,
  );

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
    `[cmhc-nhs] Wrote ${merged.length} projects (${added} NHS added) to ${OUT_PATH}`,
  );

  // Step 6: Finalize report
  for (let i = 0; i < added; i++) {
    report.noteSuccess();
  }
  report.addNote(
    `Before: ${existingCount}, NHS fetched: ${nhsProjects.length}, Added: ${added}, Skipped: ${skipped}, After: ${merged.length}`,
  );
  report.addNote(
    `HICC coords: ${withCoords.length}/${nhsProjects.length}`,
  );

  const finalReport = report.finish();
  console.log(
    `[cmhc-nhs] Done. status=${finalReport.status} duration=${finalReport.duration_ms}ms`,
  );
}

main().catch((err) => {
  console.error("[cmhc-nhs] Fatal error:", err);
  process.exit(1);
});

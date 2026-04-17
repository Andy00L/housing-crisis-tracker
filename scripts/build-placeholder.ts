/**
 * Regenerate lib/placeholder-data.ts from data/*.json.
 *
 * Composes the North America entity list from:
 *   - data/legislation/federal-us.json            → US federal entity
 *   - data/legislation/states/*.json           → all 50 US states
 *   - data/figures/federal-us.json                → US federal key figures
 *   - data/figures/states/{State}.json         → per-state key figures
 *
 * The EU and Asia entities are preserved via lib/international-entities.ts
 * (hand-curated). This script does NOT touch that file.
 *
 * The Canada entity and regional overviews (North America, EU, Asia) are
 * also produced here from lightweight inline definitions.
 *
 * Output: lib/placeholder-data.ts (overwritten, deterministic).
 */

import "./env.js";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const FEDERAL_LEG = join(ROOT, "data/legislation/federal-us.json");
const FEDERAL_US_HOUSING_LEG = join(ROOT, "data/legislation/federal-us-housing.json");
const FEDERAL_CA_LEG = join(ROOT, "data/legislation/federal-ca.json");
const STATES_LEG_DIR = join(ROOT, "data/legislation/states");
const US_STATES_HOUSING_DIR = join(ROOT, "data/legislation/us-states-housing");
const PROVINCES_LEG_DIR = join(ROOT, "data/legislation/provinces");
const EUROPE_LEG_DIR = join(ROOT, "data/legislation/europe");
const ASIA_LEG_DIR = join(ROOT, "data/legislation/asia-pacific");
const FEDERAL_FIGURES = join(ROOT, "data/figures/federal-us.json");
const FEDERAL_CA_FIGURES = join(ROOT, "data/figures/federal-ca.json");
const STATES_FIGURES_DIR = join(ROOT, "data/figures/states");
const PROVINCES_FIGURES_DIR = join(ROOT, "data/figures/provinces");
const NEWS_PATH = join(ROOT, "data/news/summaries.json");
const HOUSING_CA_DIR = join(ROOT, "data/housing/canada");
const HOUSING_US_DIR = join(ROOT, "data/housing/us");
const OFFICIALS_CA_PATH = join(ROOT, "data/politicians/canada.json");
const OFFICIALS_US_PATH = join(ROOT, "data/politicians/us.json");
const OFFICIALS_EU_PATH = join(ROOT, "data/politicians/europe.json");
const OFFICIALS_AP_PATH = join(ROOT, "data/politicians/asia-pacific.json");
const PROJECTS_CA_PATH = join(ROOT, "data/projects/canada.json");
const PROJECTS_US_PATH = join(ROOT, "data/projects/us.json");
const PROJECTS_EUROPE_DIR = join(ROOT, "data/projects/europe");
const PROJECTS_ASIA_DIR = join(ROOT, "data/projects/asia-pacific");
const OUT = join(ROOT, "lib/placeholder-data.ts");

// ── 10 US states tracked in depth. The remaining 40 states are rendered
// as grey (unknown) stubs so the map stays honest about coverage.
const TOP_US_STATES: Array<{ code: string; name: string }> = [
  { code: "CA", name: "California" },
  { code: "NY", name: "New York" },
  { code: "TX", name: "Texas" },
  { code: "FL", name: "Florida" },
  { code: "WA", name: "Washington" },
  { code: "MA", name: "Massachusetts" },
  { code: "OR", name: "Oregon" },
  { code: "CO", name: "Colorado" },
  { code: "AZ", name: "Arizona" },
  { code: "NC", name: "North Carolina" },
];

// ── Europe + Asia-Pacific dormant entity specs. Empty legislation and
// projects arrays produce grey (unknown) stances on the map. Populated
// when Prompt E.2 runs europe-asia-sync.yml.
const EUROPE_SPECS: Array<{ code: string; name: string; geoId: string }> = [
  { code: "UK", name: "United Kingdom", geoId: "826" },
  { code: "DE", name: "Germany", geoId: "276" },
  { code: "FR", name: "France", geoId: "250" },
  { code: "IT", name: "Italy", geoId: "380" },
  { code: "ES", name: "Spain", geoId: "724" },
  { code: "PL", name: "Poland", geoId: "616" },
  { code: "NL", name: "Netherlands", geoId: "528" },
  { code: "SE", name: "Sweden", geoId: "752" },
  { code: "FI", name: "Finland", geoId: "246" },
  { code: "IE", name: "Ireland", geoId: "372" },
  { code: "EU", name: "European Parliament", geoId: "eu-parliament" },
];

const ASIA_SPECS: Array<{ code: string; name: string; geoId: string }> = [
  { code: "JP", name: "Japan", geoId: "392" },
  { code: "KR", name: "South Korea", geoId: "410" },
  { code: "CN", name: "China", geoId: "156" },
  { code: "IN", name: "India", geoId: "356" },
  { code: "ID", name: "Indonesia", geoId: "360" },
  { code: "TW", name: "Taiwan", geoId: "158" },
  { code: "AU", name: "Australia", geoId: "036" },
];

interface JsonLegFile {
  state: string;
  stateCode: string;
  region: string;
  /** Lens-agnostic overall stance — max severity of DC + AI. */
  stance?: string;
  stanceZoning: string;
  stanceAffordability: string;
  lastUpdated: string;
  contextBlurb: string;
  legislation: unknown[];
}

interface JsonFigure {
  id: string;
  name: string;
  role: string;
  party: string;
  stance: string;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function toLegislator(f: JsonFigure): {
  id: string;
  name: string;
  role: string;
  party: string;
  stance: string;
} {
  return {
    id: f.id,
    name: f.name,
    role: f.role,
    party: f.party,
    stance: f.stance,
  };
}

function loadFigures(path: string, limit: number): ReturnType<typeof toLegislator>[] {
  if (!existsSync(path)) return [];
  const arr = readJson<JsonFigure[]>(path);
  return arr.slice(0, limit).map(toLegislator);
}

// ── Canadian officials from data/politicians/canada.json ────────────
interface CaOfficial {
  id: string;
  name: string;
  role: string;
  party?: string;
  stance: string;
  country?: string;
  chamber?: string;
  constituency?: string;
  summary?: string;
  keyPoints?: string[];
}

interface CaOfficialsFile {
  country: string;
  lastUpdated: string;
  officials: CaOfficial[];
}

/** 2-letter province code found in an official's ID prefix, or null for federal. */
function inferProvinceFromOfficialId(id: string): string | null {
  // City mayors live within a province. The ID uses the city name, so
  // map the 5 tracked mayors to their province explicitly. Anything else
  // with a 2-letter prefix (ca-on-, ca-qc-, etc.) is provincial.
  const cityToProvince: Record<string, string> = {
    toronto: "ON",
    ottawa: "ON",
    vancouver: "BC",
    montreal: "QC",
    calgary: "AB",
  };
  const cityMatch = id.match(/^ca-([a-z]+)-mayor$/);
  if (cityMatch) {
    return cityToProvince[cityMatch[1]] ?? null;
  }
  const provMatch = id.match(/^ca-([a-z]{2})-/i);
  if (provMatch) return provMatch[1].toUpperCase();
  return null;
}

const caOfficialsFile: CaOfficialsFile | null = existsSync(OFFICIALS_CA_PATH)
  ? (() => {
      try {
        const parsed = readJson<CaOfficialsFile>(OFFICIALS_CA_PATH);
        if (!parsed || !Array.isArray(parsed.officials)) {
          console.warn(
            `[build-placeholder] ${OFFICIALS_CA_PATH} missing 'officials' array — skipping`,
          );
          return null;
        }
        return parsed;
      } catch (err) {
        console.warn(
          `[build-placeholder] could not parse ${OFFICIALS_CA_PATH}: ${(err as Error).message}`,
        );
        return null;
      }
    })()
  : null;

function caOfficialsFor(scope: "federal" | string): CaOfficial[] {
  if (!caOfficialsFile) return [];
  if (scope === "federal") {
    return caOfficialsFile.officials.filter(
      (o) => inferProvinceFromOfficialId(o.id) === null,
    );
  }
  return caOfficialsFile.officials.filter(
    (o) => inferProvinceFromOfficialId(o.id) === scope,
  );
}

function toCaLegislator(o: CaOfficial) {
  // Match the shape of Legislator in types/index.ts. Only emit fields with
  // defined values — the TS emitter drops undefined keys.
  return {
    id: o.id,
    name: o.name,
    role: o.role,
    party: o.party ?? "Independent",
    stance: o.stance,
    country: o.country ?? "CA",
    chamber: o.chamber,
    constituency: o.constituency,
    summary: o.summary,
    keyPoints: o.keyPoints && o.keyPoints.length > 0 ? o.keyPoints : undefined,
  };
}

// ── Canadian projects from data/projects/canada.json ────────────────
interface CaProject {
  id: string;
  name?: string;
  developer: string;
  province: string;
  city?: string;
  unitCount?: number;
  affordableUnits?: number;
  projectCost?: number;
  currency?: string;
  projectType?: string;
  status: string;
  announceDate?: string;
  sourceUrl?: string;
  blurb?: string;
  concerns?: string[];
  lat?: number;
  lng?: number;
}

interface CaProjectsFile {
  projects: CaProject[];
}

// Canonical province/territory 2-letter codes, mirrored from types/index.ts:PROVINCE_ABBR.
// Kept inline here so the build script doesn't reach into a runtime module.
const VALID_PROVINCE_CODES = new Set([
  "NL",
  "PE",
  "NS",
  "NB",
  "QC",
  "ON",
  "MB",
  "SK",
  "AB",
  "BC",
  "YT",
  "NT",
  "NU",
]);
const VALID_STATUSES = new Set(["operational", "under-construction", "proposed"]);
const VALID_PROJECT_TYPES = new Set([
  "rental",
  "condo",
  "mixed",
  "social",
  "cooperative",
]);

const caProjectsFile: CaProjectsFile | null = existsSync(PROJECTS_CA_PATH)
  ? (() => {
      try {
        const parsed = readJson<CaProjectsFile>(PROJECTS_CA_PATH);
        if (!parsed || !Array.isArray(parsed.projects)) {
          console.warn(
            `[build-placeholder] ${PROJECTS_CA_PATH} missing 'projects' array — skipping`,
          );
          return null;
        }
        return parsed;
      } catch (err) {
        console.warn(
          `[build-placeholder] could not parse ${PROJECTS_CA_PATH}: ${(err as Error).message}`,
        );
        return null;
      }
    })()
  : null;

/** Build a HousingProject-compatible record from a Canadian project. */
function toHousingProject(p: CaProject): Record<string, unknown> | null {
  if (!p.id || !p.developer || !p.province) {
    console.warn(`[build-placeholder] dropping project missing required field: ${p.id ?? "?"}`);
    return null;
  }
  const provinceCode = String(p.province).toUpperCase();
  if (!VALID_PROVINCE_CODES.has(provinceCode)) {
    console.warn(
      `[build-placeholder] dropping project ${p.id}: invalid province "${p.province}"`,
    );
    return null;
  }
  if (!VALID_STATUSES.has(p.status)) {
    console.warn(
      `[build-placeholder] dropping project ${p.id}: invalid status "${p.status}"`,
    );
    return null;
  }
  const projectType =
    p.projectType && VALID_PROJECT_TYPES.has(p.projectType)
      ? p.projectType
      : undefined;
  return {
    id: p.id,
    developer: p.developer,
    projectName: p.name,
    location: p.city,
    state: provinceCode,
    country: "Canada",
    lat: typeof p.lat === "number" ? p.lat : undefined,
    lng: typeof p.lng === "number" ? p.lng : undefined,
    unitCount: p.unitCount,
    affordableUnits: p.affordableUnits,
    projectCost: p.projectCost,
    projectType,
    status: p.status,
    yearProposed: p.announceDate
      ? Number(p.announceDate.slice(0, 4)) || undefined
      : undefined,
    notes: p.blurb,
    concerns: Array.isArray(p.concerns) && p.concerns.length > 0 ? p.concerns : undefined,
    source: p.sourceUrl,
  };
}

function caProjectsFor(provinceCode: string): Array<Record<string, unknown>> {
  if (!caProjectsFile) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const p of caProjectsFile.projects) {
    if (String(p.province).toUpperCase() !== provinceCode) continue;
    const mapped = toHousingProject(p);
    if (mapped) out.push(mapped);
  }
  // Dedupe by id — prefer the most recent announceDate if collision.
  const seen = new Map<string, Record<string, unknown>>();
  for (const p of out) {
    const id = p.id as string;
    const prior = seen.get(id);
    if (!prior) {
      seen.set(id, p);
      continue;
    }
    const priorYear = (prior.yearProposed as number) ?? 0;
    const nextYear = (p.yearProposed as number) ?? 0;
    if (nextYear >= priorYear) seen.set(id, p);
  }
  return Array.from(seen.values());
}

interface NewsFile {
  entities?: Record<string, { news: Array<{ id: string; headline: string; source: string; date: string; url: string }> }>;
}

const newsData: NewsFile = existsSync(NEWS_PATH)
  ? (readJson(NEWS_PATH) as NewsFile)
  : {};

function loadEntityNews(entityName: string) {
  return newsData.entities?.[entityName]?.news ?? [];
}

// ── Housing metrics from StatsCan data ─────────────────────────────
interface NhpiFile {
  geographies: Record<string, { values: Array<{ period: string; value: number }> }>;
  lastUpdated: string;
}

interface StartsFile {
  geographies: Record<string, { values: Array<{ period: string; value: number }> }>;
}

const nhpiData: NhpiFile | null = existsSync(join(HOUSING_CA_DIR, "nhpi.json"))
  ? readJson<NhpiFile>(join(HOUSING_CA_DIR, "nhpi.json"))
  : null;

const startsData: StartsFile | null = existsSync(join(HOUSING_CA_DIR, "starts.json"))
  ? readJson<StartsFile>(join(HOUSING_CA_DIR, "starts.json"))
  : null;

function loadHousingMetrics(geoName: string): Record<string, unknown> | undefined {
  if (!nhpiData) return undefined;

  const nhpi = nhpiData.geographies[geoName];
  if (!nhpi || nhpi.values.length === 0) return undefined;

  const latest = nhpi.values[nhpi.values.length - 1];
  const yearAgo = nhpi.values.find((v) => {
    const latestDate = new Date(latest.period + "-01");
    const vDate = new Date(v.period + "-01");
    return Math.abs(latestDate.getTime() - vDate.getTime() - 365 * 24 * 60 * 60 * 1000) < 45 * 24 * 60 * 60 * 1000;
  });

  const metrics: Record<string, unknown> = {
    nhpiIndex: latest.value,
    lastUpdated: nhpiData.lastUpdated,
    currency: "CAD",
  };

  if (yearAgo) {
    metrics.nhpiChangeYoY = Math.round((latest.value / yearAgo.value - 1) * 1000) / 10;
  }

  // Housing starts
  const starts = startsData?.geographies[geoName];
  if (starts && starts.values.length > 0) {
    metrics.startsQuarterly = starts.values[starts.values.length - 1].value;
  }

  return metrics;
}

// ── US housing metrics from FRED + Zillow + Census ─────────────────
interface StateHpiFile {
  states: Record<string, { stateName: string; values: Array<{ period: string; value: number }> }>;
}
interface ZhviFile {
  states: Array<{ state: string; regionName: string; currentValue: number; changeYoY: number | null }>;
}
interface CensusFile {
  states: Array<{ name: string; medianHomeValue: number | null; medianGrossRent: number | null; totalHousingUnits: number | null }>;
}
interface FredSeriesFile {
  values: Array<{ period: string; value: number }>;
}

const stateHpiData: StateHpiFile | null = existsSync(join(HOUSING_US_DIR, "fred-state-hpi.json"))
  ? readJson<StateHpiFile>(join(HOUSING_US_DIR, "fred-state-hpi.json"))
  : null;

const zhviData: ZhviFile | null = existsSync(join(HOUSING_US_DIR, "zillow-zhvi.json"))
  ? readJson<ZhviFile>(join(HOUSING_US_DIR, "zillow-zhvi.json"))
  : null;

const censusData: CensusFile | null = existsSync(join(HOUSING_US_DIR, "census-housing.json"))
  ? readJson<CensusFile>(join(HOUSING_US_DIR, "census-housing.json"))
  : null;

const mortgageData: FredSeriesFile | null = existsSync(join(HOUSING_US_DIR, "fred-mortgage.json"))
  ? readJson<FredSeriesFile>(join(HOUSING_US_DIR, "fred-mortgage.json"))
  : null;

const vacancyData: FredSeriesFile | null = existsSync(join(HOUSING_US_DIR, "fred-vacancy.json"))
  ? readJson<FredSeriesFile>(join(HOUSING_US_DIR, "fred-vacancy.json"))
  : null;

function loadUsHousingMetrics(stateName: string): Record<string, unknown> | undefined {
  const metrics: Record<string, unknown> = { currency: "USD" };
  let hasData = false;

  // State HPI from FRED
  if (stateHpiData) {
    // Match by state code — find code from name
    const entry = Object.entries(stateHpiData.states).find(([, v]) => v.stateName === stateName);
    if (entry) {
      const vals = entry[1].values;
      if (vals.length > 0) {
        const latest = vals[vals.length - 1];
        metrics.nhpiIndex = latest.value;
        if (vals.length >= 4) {
          const yearAgo = vals[0];
          metrics.nhpiChangeYoY = Math.round((latest.value / yearAgo.value - 1) * 1000) / 10;
        }
        hasData = true;
      }
    }
  }

  // Zillow median home value
  if (zhviData) {
    const match = zhviData.states.find((s) => s.regionName === stateName);
    if (match) {
      metrics.medianHomePrice = match.currentValue;
      hasData = true;
    }
  }

  // Census median rent + home value
  if (censusData) {
    const match = censusData.states.find((s) => s.name === stateName);
    if (match) {
      if (match.medianGrossRent) metrics.avgRent = match.medianGrossRent;
      if (!metrics.medianHomePrice && match.medianHomeValue) metrics.medianHomePrice = match.medianHomeValue;
      hasData = true;
    }
  }

  // National mortgage rate (same for all states)
  if (mortgageData && mortgageData.values.length > 0) {
    metrics.mortgageRate = mortgageData.values[mortgageData.values.length - 1].value;
  }

  // National vacancy rate (same for all states)
  if (vacancyData && vacancyData.values.length > 0) {
    metrics.vacancyRate = vacancyData.values[vacancyData.values.length - 1].value;
  }

  if (!hasData) return undefined;
  metrics.lastUpdated = new Date().toISOString().slice(0, 10);
  return metrics;
}

/** JSON.stringify that emits TS-style identifier keys where possible. */
function toTs(value: unknown, indent = 2, level = 0): string {
  const pad = " ".repeat(level * indent);
  const pad2 = " ".repeat((level + 1) * indent);
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => `${pad2}${toTs(v, indent, level + 1)}`);
    return `[\n${items.join(",\n")},\n${pad}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    );
    if (entries.length === 0) return "{}";
    const lines = entries.map(
      ([k, v]) => `${pad2}${/^[a-zA-Z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${toTs(v, indent, level + 1)}`,
    );
    return `{\n${lines.join(",\n")},\n${pad}}`;
  }
  return "null";
}

// ── US housing projects from data/projects/us.json ────────────────
interface UsProjectFile {
  country?: string;
  projects: Array<Record<string, unknown>>;
}

const usProjectsFile: UsProjectFile | null = existsSync(PROJECTS_US_PATH)
  ? (() => {
      try {
        const parsed = readJson<UsProjectFile>(PROJECTS_US_PATH);
        if (!parsed || !Array.isArray(parsed.projects)) return null;
        return parsed;
      } catch (err) {
        console.warn(`[build-placeholder] cannot parse ${PROJECTS_US_PATH}: ${(err as Error).message}`);
        return null;
      }
    })()
  : null;

function usProjectsFor(scope: "federal" | string): Array<Record<string, unknown>> {
  if (!usProjectsFile) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const p of usProjectsFile.projects) {
    const s = String((p as { state?: string }).state ?? "").toUpperCase();
    if (scope === "federal" && s === "FEDERAL") out.push(p);
    else if (scope !== "federal" && s === scope) out.push(p);
  }
  return out;
}

// ── US officials from data/politicians/us.json ─────────────────────
interface UsOfficial {
  id: string;
  name: string;
  role: string;
  party?: string;
  stance: string;
  country?: string;
  chamber?: string;
  constituency?: string;
  summary?: string;
  keyPoints?: string[];
}

interface UsOfficialsFile {
  country: string;
  lastUpdated: string;
  officials: UsOfficial[];
}

const usOfficialsFile: UsOfficialsFile | null = existsSync(OFFICIALS_US_PATH)
  ? (() => {
      try {
        return readJson<UsOfficialsFile>(OFFICIALS_US_PATH);
      } catch (err) {
        console.warn(`[build-placeholder] cannot parse ${OFFICIALS_US_PATH}: ${(err as Error).message}`);
        return null;
      }
    })()
  : null;

/** Two-letter state code found in a US official's id (ca-, ny-, etc.), null for federal. */
function inferStateFromUsOfficialId(id: string): string | null {
  const m = id.match(/^us-([a-z]{2})-/i);
  if (m) return m[1].toUpperCase();
  return null;
}

function usOfficialsFor(scope: "federal" | string): UsOfficial[] {
  if (!usOfficialsFile) return [];
  if (scope === "federal") {
    return usOfficialsFile.officials.filter(
      (o) => inferStateFromUsOfficialId(o.id) === null,
    );
  }
  return usOfficialsFile.officials.filter(
    (o) => inferStateFromUsOfficialId(o.id) === scope,
  );
}

function toUsLegislator(o: UsOfficial) {
  return {
    id: o.id,
    name: o.name,
    role: o.role,
    party: o.party ?? "Nonpartisan",
    stance: o.stance,
    country: o.country ?? "US",
    chamber: o.chamber,
    constituency: o.constituency,
    summary: o.summary,
    keyPoints: o.keyPoints && o.keyPoints.length > 0 ? o.keyPoints : undefined,
  };
}

// ── Europe + Asia officials loaders ────────────────────────────────
interface RegionOfficialsFile {
  region: string;
  officials: UsOfficial[];
}

function loadRegionOfficials(path: string): UsOfficial[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = readJson<RegionOfficialsFile>(path);
    return Array.isArray(parsed.officials) ? parsed.officials : [];
  } catch (err) {
    console.warn(`[build-placeholder] cannot parse ${path}: ${(err as Error).message}`);
    return [];
  }
}

const euOfficials = loadRegionOfficials(OFFICIALS_EU_PATH);
const apOfficials = loadRegionOfficials(OFFICIALS_AP_PATH);

function regionOfficialsFor(region: "eu" | "ap", countryCode: string): UsOfficial[] {
  const pool = region === "eu" ? euOfficials : apOfficials;
  return pool.filter((o) => (o.country ?? "").toUpperCase() === countryCode);
}

// ── Europe + Asia-Pacific housing data loaders ─────────────────────
function loadRegionLegFile(path: string): JsonLegFile | null {
  if (!existsSync(path)) return null;
  try {
    return readJson<JsonLegFile>(path);
  } catch {
    return null;
  }
}

function loadRegionProjects(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  try {
    const parsed = readJson<{ projects?: Array<Record<string, unknown>> }>(path);
    return Array.isArray(parsed.projects) ? parsed.projects : [];
  } catch {
    return [];
  }
}

/** Merge US-housing-pipeline figures with legacy federal figure cards,
 *  dedupe by id, cap at `limit`. US housing pipeline output is preferred
 *  for ordering so Scott Turner (HUD Secretary) lands on top. */
function mergedUsFederalFigures(limit: number) {
  const pipeline = usOfficialsFor("federal").map(toUsLegislator);
  const curated = loadFigures(FEDERAL_FIGURES, limit);
  const seen = new Set<string>();
  const merged: Array<ReturnType<typeof toUsLegislator> | ReturnType<typeof toLegislator>> = [];
  for (const f of [...pipeline, ...curated]) {
    if (!f.id || seen.has(f.id)) continue;
    seen.add(f.id);
    merged.push(f);
  }
  return merged.slice(0, limit);
}

function buildFederalEntity() {
  // Prefer the housing-pipeline output. Fall back to the legacy AI/DC
  // federal-us.json so this function always returns a stance-carrying
  // entity even before the US pipelines run for the first time.
  const housingPath = existsSync(FEDERAL_US_HOUSING_LEG) ? FEDERAL_US_HOUSING_LEG : FEDERAL_LEG;
  const leg = readJson<JsonLegFile>(housingPath);
  const figures = mergedUsFederalFigures(10);
  return {
    id: "us-federal",
    geoId: "840",
    name: "United States",
    region: "na",
    level: "federal",
    isOverview: true,
    canDrillDown: true,
    stance: leg.stance ?? leg.stanceZoning,
    stanceZoning: leg.stanceZoning,
    stanceAffordability: leg.stanceAffordability,
    contextBlurb: leg.contextBlurb,
    legislation: leg.legislation,
    keyFigures: figures,
    news: loadEntityNews("United States"),
    housingMetrics: loadUsHousingMetrics("United States"),
    projects: usProjectsFor("federal"),
  };
}

function buildStateEntities() {
  const entities: unknown[] = [];
  const topCodes = new Set(TOP_US_STATES.map((s) => s.code));
  const seen = new Set<string>();

  // Top 10 states first: prefer the us-states-housing file when present,
  // fall back to the legacy AI/DC file so the entity is never missing.
  for (const spec of TOP_US_STATES) {
    const housingPath = join(US_STATES_HOUSING_DIR, `${spec.code}.json`);
    const legacyPath = join(STATES_LEG_DIR, `${slugify(spec.name)}.json`);
    const path = existsSync(housingPath) ? housingPath : legacyPath;
    if (!existsSync(path)) continue;
    const leg = readJson<JsonLegFile>(path);
    const pipelineFigures = usOfficialsFor(spec.code).map(toUsLegislator);
    const curated = loadFigures(join(STATES_FIGURES_DIR, `${slugify(spec.name)}.json`), 5);
    const figures: Array<ReturnType<typeof toUsLegislator> | ReturnType<typeof toLegislator>> = [];
    const seenFig = new Set<string>();
    for (const f of [...pipelineFigures, ...curated]) {
      if (!f.id || seenFig.has(f.id)) continue;
      seenFig.add(f.id);
      figures.push(f);
    }
    const projects = usProjectsFor(spec.code);
    entities.push({
      id: slugify(spec.name),
      geoId: spec.name,
      name: spec.name,
      region: "na",
      level: "state",
      stance: leg.stance ?? leg.stanceZoning,
      stanceZoning: leg.stanceZoning,
      stanceAffordability: leg.stanceAffordability,
      contextBlurb: leg.contextBlurb,
      legislation: leg.legislation,
      keyFigures: figures.slice(0, 5),
      news: loadEntityNews(spec.name),
      housingMetrics: loadUsHousingMetrics(spec.name),
      projects: projects.length > 0 ? projects : undefined,
    });
    seen.add(spec.name);
  }

  // The other 40 US states: render as grey stubs. The legacy state files
  // carry AI-era contextBlurb copy, which we replace with a short notice
  // so the UI doesn't claim housing data we don't have yet.
  const legacyFiles = readdirSync(STATES_LEG_DIR).filter((f) => f.endsWith(".json"));
  for (const f of legacyFiles) {
    const leg = readJson<JsonLegFile>(join(STATES_LEG_DIR, f));
    const stateName = leg.state;
    if (seen.has(stateName)) continue;
    if (topCodes.has(leg.stateCode)) continue;
    const figures = loadFigures(join(STATES_FIGURES_DIR, `${slugify(stateName)}.json`), 5);
    entities.push({
      id: slugify(stateName),
      geoId: stateName,
      name: stateName,
      region: "na",
      level: "state",
      stance: "none",
      stanceZoning: "none",
      stanceAffordability: "none",
      contextBlurb: `${stateName} housing legislation is not yet tracked. Coverage expands in future data cycles; the top 10 housing-critical states are the current focus.`,
      legislation: [],
      keyFigures: figures,
      news: loadEntityNews(stateName),
      housingMetrics: loadUsHousingMetrics(stateName),
    });
  }

  entities.sort((a, b) => {
    const an = (a as { name: string }).name;
    const bn = (b as { name: string }).name;
    return an.localeCompare(bn);
  });
  return entities;
}

/** Merge curated figures from data/figures/federal-ca.json with pipeline
 *  officials from data/politicians/canada.json, dedupe by id, cap at `limit`. */
function mergedCaKeyFigures(
  figuresPath: string,
  scope: "federal" | string,
  limit: number,
): Array<ReturnType<typeof toCaLegislator> | ReturnType<typeof toLegislator>> {
  const curated = loadFigures(figuresPath, limit);
  const pipeline = caOfficialsFor(scope).map(toCaLegislator);
  const seen = new Set<string>();
  const merged: Array<
    ReturnType<typeof toCaLegislator> | ReturnType<typeof toLegislator>
  > = [];
  for (const f of [...curated, ...pipeline]) {
    if (!f.id || seen.has(f.id)) continue;
    seen.add(f.id);
    merged.push(f);
  }
  return merged.slice(0, limit);
}

function buildCanadaEntity() {
  if (existsSync(FEDERAL_CA_LEG)) {
    const leg = readJson<JsonLegFile>(FEDERAL_CA_LEG);
    const figures = mergedCaKeyFigures(FEDERAL_CA_FIGURES, "federal", 10);
    return {
      id: "canada-federal",
      geoId: "124",
      name: "Canada",
      region: "na",
      level: "federal",
      isOverview: false,
      canDrillDown: true,
      stance: leg.stance ?? leg.stanceZoning,
      stanceZoning: leg.stanceZoning,
      stanceAffordability: leg.stanceAffordability,
      contextBlurb: leg.contextBlurb,
      legislation: leg.legislation,
      keyFigures: figures,
      news: loadEntityNews("Canada"),
      housingMetrics: loadHousingMetrics("Canada"),
    };
  }
  return {
    id: "canada-federal",
    geoId: "124",
    name: "Canada",
    region: "na",
    level: "federal",
    canDrillDown: true,
    stanceZoning: "review",
    stanceAffordability: "review",
    contextBlurb:
      "Canada faces an acute housing affordability crisis. Federal legislation on housing supply and affordability is under active development.",
    legislation: [],
    keyFigures: mergedCaKeyFigures(FEDERAL_CA_FIGURES, "federal", 10),
    news: loadEntityNews("Canada"),
    housingMetrics: loadHousingMetrics("Canada"),
  };
}

function buildProvinceEntities() {
  if (!existsSync(PROVINCES_LEG_DIR)) return [];
  const files = readdirSync(PROVINCES_LEG_DIR).filter((f) => f.endsWith(".json"));
  const entities: unknown[] = [];
  for (const f of files) {
    const leg = readJson<JsonLegFile>(join(PROVINCES_LEG_DIR, f));
    const provName = leg.state;
    const provCode = leg.stateCode;
    const figuresPath = join(PROVINCES_FIGURES_DIR, `${provCode}.json`);
    const figures = mergedCaKeyFigures(figuresPath, provCode, 5);
    const projects = caProjectsFor(provCode);
    entities.push({
      id: slugify(provName),
      geoId: `CA-${provCode}`,
      name: provName,
      region: "na",
      level: "state",
      stance: leg.stance ?? leg.stanceZoning,
      stanceZoning: leg.stanceZoning,
      stanceAffordability: leg.stanceAffordability,
      contextBlurb: leg.contextBlurb,
      legislation: leg.legislation,
      keyFigures: figures,
      news: loadEntityNews(provName),
      housingMetrics: loadHousingMetrics(provName),
      projects: projects.length > 0 ? projects : undefined,
    });
  }
  entities.sort((a, b) => {
    const an = (a as { name: string }).name;
    const bn = (b as { name: string }).name;
    return an.localeCompare(bn);
  });
  return entities;
}

/** Build one Europe entity. Reads data/legislation/europe/{code}.json and
 *  data/projects/europe/{code}.json when present; emits a grey stub
 *  otherwise. This is the shape that makes the map render in the right
 *  position with the right color. */
function buildEuropeEntity(spec: { code: string; name: string; geoId: string }) {
  const legPath = join(EUROPE_LEG_DIR, `${spec.code.toLowerCase()}.json`);
  const projPath = join(PROJECTS_EUROPE_DIR, `${spec.code.toLowerCase()}.json`);
  const leg = loadRegionLegFile(legPath);
  const projects = loadRegionProjects(projPath);
  const officials = regionOfficialsFor("eu", spec.code).map(toUsLegislator);

  return {
    id: `eu-${spec.code.toLowerCase()}`,
    geoId: spec.geoId,
    name: spec.name,
    region: "eu",
    level: spec.code === "EU" ? "bloc" : "federal",
    isOverview: false,
    stance: leg?.stance ?? "none",
    stanceZoning: leg?.stanceZoning ?? "none",
    stanceAffordability: leg?.stanceAffordability ?? "none",
    contextBlurb:
      leg?.contextBlurb ??
      `${spec.name} housing coverage is pending. The dormant Europe pipeline will populate this entity when triggered via the europe-asia-sync workflow.`,
    legislation: leg?.legislation ?? [],
    keyFigures: officials,
    news: loadEntityNews(spec.name),
    projects: projects.length > 0 ? projects : undefined,
  };
}

function buildAsiaEntity(spec: { code: string; name: string; geoId: string }) {
  const legPath = join(ASIA_LEG_DIR, `${spec.code.toLowerCase()}.json`);
  const projPath = join(PROJECTS_ASIA_DIR, `${spec.code.toLowerCase()}.json`);
  const leg = loadRegionLegFile(legPath);
  const projects = loadRegionProjects(projPath);
  const officials = regionOfficialsFor("ap", spec.code).map(toUsLegislator);

  return {
    id: `ap-${spec.code.toLowerCase()}`,
    geoId: spec.geoId,
    name: spec.name,
    region: "asia",
    level: "federal",
    isOverview: false,
    stance: leg?.stance ?? "none",
    stanceZoning: leg?.stanceZoning ?? "none",
    stanceAffordability: leg?.stanceAffordability ?? "none",
    contextBlurb:
      leg?.contextBlurb ??
      `${spec.name} housing coverage is pending. The dormant Asia-Pacific pipeline will populate this entity when triggered via the europe-asia-sync workflow.`,
    legislation: leg?.legislation ?? [],
    keyFigures: officials,
    news: loadEntityNews(spec.name),
    projects: projects.length > 0 ? projects : undefined,
  };
}

function main() {
  const na: unknown[] = [];
  na.push(buildFederalEntity());
  na.push(buildCanadaEntity());
  na.push(...buildProvinceEntities());
  na.push(...buildStateEntities());

  const eu: unknown[] = EUROPE_SPECS.map(buildEuropeEntity);
  const asia: unknown[] = ASIA_SPECS.map(buildAsiaEntity);

  const body = `import type { Entity, Region } from "@/types";
import { INTERNATIONAL_ENTITIES } from "./international-entities";

/**
 * Generated by scripts/build-placeholder.ts from data/legislation/ and
 * data/figures/. Do not edit US entities here — they will be overwritten
 * on the next sync run. Edit data/*.json or the sync scripts instead.
 *
 * EU + Asia + Canada-adjacent entities live in lib/international-entities.ts
 * and are hand-curated.
 */

const NA_ENTITIES: Entity[] = ${toTs(na, 2, 0)};

// Europe + Asia-Pacific entities generated from data/legislation/europe/
// and data/legislation/asia-pacific/. They override the hand-curated
// INTERNATIONAL_ENTITIES entries when the same geoId appears in both.
const EU_PIPELINE_ENTITIES: Entity[] = ${toTs(eu, 2, 0)};
const ASIA_PIPELINE_ENTITIES: Entity[] = ${toTs(asia, 2, 0)};

const _pipelineGeoIds = new Set([
  ...EU_PIPELINE_ENTITIES.map((e) => e.geoId),
  ...ASIA_PIPELINE_ENTITIES.map((e) => e.geoId),
]);

export const ENTITIES: Entity[] = [
  ...NA_ENTITIES,
  ...EU_PIPELINE_ENTITIES,
  ...ASIA_PIPELINE_ENTITIES,
  // Retain hand-curated international entries that the pipelines do NOT
  // yet cover (EU bloc overview, hand-curated non-tracked countries).
  ...INTERNATIONAL_ENTITIES.filter((e) => !_pipelineGeoIds.has(e.geoId)),
];

export function getEntity(geoId: string, region: Region): Entity | null {
  return ENTITIES.find((e) => e.geoId === geoId && e.region === region) ?? null;
}

export function getOverviewEntity(region: Region): Entity | null {
  return ENTITIES.find((e) => e.region === region && e.isOverview) ?? null;
}

export function getEntitiesByRegion(region: Region): Entity[] {
  return ENTITIES.filter((e) => e.region === region);
}
`;

  writeFileSync(OUT, body);
  console.log(
    `[build-placeholder] wrote ${na.length} NA + ${eu.length} EU + ${asia.length} AP pipeline entities → lib/placeholder-data.ts`,
  );
}

main();

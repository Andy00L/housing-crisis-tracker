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
const FEDERAL_CA_LEG = join(ROOT, "data/legislation/federal-ca.json");
const STATES_LEG_DIR = join(ROOT, "data/legislation/states");
const PROVINCES_LEG_DIR = join(ROOT, "data/legislation/provinces");
const FEDERAL_FIGURES = join(ROOT, "data/figures/federal-us.json");
const FEDERAL_CA_FIGURES = join(ROOT, "data/figures/federal-ca.json");
const STATES_FIGURES_DIR = join(ROOT, "data/figures/states");
const PROVINCES_FIGURES_DIR = join(ROOT, "data/figures/provinces");
const NEWS_PATH = join(ROOT, "data/news/summaries.json");
const HOUSING_CA_DIR = join(ROOT, "data/housing/canada");
const HOUSING_US_DIR = join(ROOT, "data/housing/us");
const OFFICIALS_CA_PATH = join(ROOT, "data/politicians/canada.json");
const PROJECTS_CA_PATH = join(ROOT, "data/projects/canada.json");
const OUT = join(ROOT, "lib/placeholder-data.ts");

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

function buildFederalEntity() {
  const leg = readJson<JsonLegFile>(FEDERAL_LEG);
  const figures = loadFigures(FEDERAL_FIGURES, 10);
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
  };
}

function buildStateEntities() {
  const files = readdirSync(STATES_LEG_DIR).filter((f) => f.endsWith(".json"));
  const entities: unknown[] = [];
  for (const f of files) {
    const leg = readJson<JsonLegFile>(join(STATES_LEG_DIR, f));
    const stateName = leg.state;
    const figuresPath = join(STATES_FIGURES_DIR, `${slugify(stateName)}.json`);
    const figures = loadFigures(figuresPath, 5);
    entities.push({
      id: slugify(stateName),
      geoId: stateName,
      name: stateName,
      region: "na",
      level: "state",
      stance: leg.stance ?? leg.stanceZoning,
      stanceZoning: leg.stanceZoning,
      stanceAffordability: leg.stanceAffordability,
      contextBlurb: leg.contextBlurb,
      legislation: leg.legislation,
      keyFigures: figures,
      news: loadEntityNews(stateName),
      housingMetrics: loadUsHousingMetrics(stateName),
    });
  }
  // Stable alphabetical order
  entities.sort((a: any, b: any) => a.name.localeCompare(b.name));
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
  entities.sort((a: any, b: any) => a.name.localeCompare(b.name));
  return entities;
}

function main() {
  const na: unknown[] = [];
  na.push(buildFederalEntity());
  na.push(buildCanadaEntity());
  na.push(...buildProvinceEntities());
  na.push(...buildStateEntities());

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

export const ENTITIES: Entity[] = [...NA_ENTITIES, ...INTERNATIONAL_ENTITIES];

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
    `[build-placeholder] wrote ${na.length} NA entities + INTERNATIONAL_ENTITIES passthrough → lib/placeholder-data.ts`,
  );
}

main();

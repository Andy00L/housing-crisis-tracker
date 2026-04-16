import type { Entity, HousingProject } from "@/types";
import { ENTITIES } from "./placeholder-data";

/**
 * Housing projects data loader.
 *
 * Projects are stored on each Entity as `entity.projects` (populated by
 * scripts/build-placeholder.ts from data/projects/canada.json). The
 * `ALL_HOUSING_PROJECTS` export is the flat union across every entity
 * for code that wants the global view (the homepage projects table, the
 * globe page totals).
 *
 * The `projectsForEntity` helper scopes that union to the selected
 * entity. State / province rows return their own `projects`. Federal
 * aggregators return the union of children under that country so
 * canada-federal shows every Canadian project across the provinces.
 */

function collectAllProjects(): HousingProject[] {
  const out: HousingProject[] = [];
  const seen = new Set<string>();
  for (const e of ENTITIES) {
    for (const p of e.projects ?? []) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

export const ALL_HOUSING_PROJECTS: HousingProject[] = collectAllProjects();

/**
 * Resolve the project set scoped to an entity. Province-level entities
 * return the projects pinned to that entity (e.g. Alberta returns Alberta
 * projects). Federal entities return the union of every province under
 * that country, so canada-federal shows every Canadian project.
 */
export function projectsForEntity(
  entity: Pick<Entity, "level" | "region" | "name" | "id" | "geoId" | "projects">,
): {
  projects: HousingProject[];
  groupBy: "state" | "country" | null;
} {
  // Direct read for province / state entities.
  if (entity.level === "state") {
    return { projects: entity.projects ?? [], groupBy: null };
  }

  // Federal aggregator, stitch every child state's projects together.
  if (entity.level === "federal" && entity.id === "canada-federal") {
    const projects = ALL_HOUSING_PROJECTS.filter((p) => p.country === "Canada");
    return { projects, groupBy: "state" };
  }

  // US and other federal entities have no housing project data yet, so
  // fall through with whatever (likely empty) projects the entity holds.
  return { projects: entity.projects ?? [], groupBy: null };
}

// ── Geocoding helpers ──────────────────────────────────────────────────
//
// Many projects ship with a city and province but no lat/lng. The map
// layer plots projects as dots, so we either skip them (lose signal) or
// resolve an approximate location. We pick approximation and record the
// precision so callers can decide whether a dot is worth rendering.

/** Canonical coordinates for the cities that appear in data/projects/canada.json
 *  today. Add to this table as the pipeline surfaces new cities. */
export const CANADIAN_CITY_COORDS: Record<string, [number, number]> = {
  "Toronto": [43.6532, -79.3832],
  "Vancouver": [49.2827, -123.1207],
  "Montreal": [45.5017, -73.5673],
  "Calgary": [51.0447, -114.0719],
  "Ottawa": [45.4215, -75.6972],
  "Edmonton": [53.5461, -113.4938],
  "Winnipeg": [49.8951, -97.1384],
  "Halifax": [44.6488, -63.5752],
  "Quebec City": [46.8139, -71.2080],
  "Saskatoon": [52.1579, -106.6702],
  "Regina": [50.4452, -104.6189],
  "St. John's": [47.5615, -52.7126],
  "Charlottetown": [46.2382, -63.1311],
  "Whitehorse": [60.7212, -135.0568],
  "Yellowknife": [62.4540, -114.3718],
  "Iqaluit": [63.7467, -68.5170],
  "Bowser": [49.4333, -124.6833],
  "Burnaby": [49.2488, -122.9805],
  "Langley": [49.1044, -122.6603],
};

/** Coordinates for US cities the housing pipeline currently surfaces.
 *  Mirrors `CANADIAN_CITY_COORDS`. Values are taken from US Census
 *  Bureau city-of-government coordinates (rounded to four decimals). */
export const US_CITY_COORDS: Record<string, [number, number]> = {
  "Phoenix": [33.4484, -112.0740],
  "Sacramento": [38.5816, -121.4944],
  "Emeryville": [37.8313, -122.2853],
  "Denver": [39.7392, -104.9903],
  "Seattle": [47.6062, -122.3321],
  "Orange County": [33.7175, -117.8311],
};

/** Approximate geographic centroid for each province or territory. Used
 *  as a last-resort fallback when neither lat/lng nor a known city is
 *  present on a project. Values are rounded to one decimal because the
 *  consumer (map dots) cannot render more precision meaningfully. */
export const PROVINCE_CENTROIDS: Record<string, [number, number]> = {
  BC: [54.0, -125.0],
  AB: [55.0, -115.0],
  SK: [54.0, -106.0],
  MB: [54.0, -98.0],
  ON: [50.0, -86.0],
  QC: [53.0, -72.0],
  NB: [46.5, -66.5],
  NS: [45.0, -63.0],
  PE: [46.4, -63.3],
  NL: [53.0, -60.0],
  YT: [64.0, -135.0],
  NT: [64.0, -119.0],
  NU: [70.0, -90.0],
};

/** Approximate geographic centroid for each US state and DC. Same
 *  precision and intent as `PROVINCE_CENTROIDS`. */
export const US_STATE_CENTROIDS: Record<string, [number, number]> = {
  AL: [32.8, -86.8], AK: [63.6, -152.3], AZ: [34.3, -111.7], AR: [34.9, -92.4],
  CA: [37.2, -119.5], CO: [38.9, -105.5], CT: [41.6, -72.7], DE: [38.9, -75.5],
  DC: [38.9, -77.0], FL: [28.6, -82.4], GA: [32.7, -83.4], HI: [20.6, -157.5],
  ID: [44.4, -114.6], IL: [40.0, -89.2], IN: [39.9, -86.3], IA: [42.1, -93.5],
  KS: [38.5, -98.4], KY: [37.5, -85.3], LA: [31.1, -91.9], ME: [45.4, -69.2],
  MD: [39.0, -76.7], MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3],
  MS: [32.7, -89.7], MO: [38.4, -92.3], MT: [47.0, -109.6], NE: [41.5, -99.8],
  NV: [39.3, -116.6], NH: [43.7, -71.6], NJ: [40.2, -74.5], NM: [34.4, -106.1],
  NY: [42.9, -75.5], NC: [35.6, -79.4], ND: [47.5, -100.5], OH: [40.3, -82.8],
  OK: [35.6, -97.5], OR: [44.0, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.5],
  SC: [33.9, -80.9], SD: [44.4, -100.2], TN: [35.7, -86.7], TX: [31.1, -99.3],
  UT: [39.3, -111.7], VT: [44.1, -72.7], VA: [37.5, -78.9], WA: [47.4, -120.4],
  WV: [38.6, -80.6], WI: [44.6, -90.0], WY: [42.9, -107.5],
};

export type CoordinatePrecision = "exact" | "city" | "province" | "unknown";

export interface ResolvedCoordinates {
  lat: number;
  lng: number;
  precision: CoordinatePrecision;
}

/**
 * Resolve a plottable `{ lat, lng, precision }` for a project. Caller is
 * responsible for treating `precision === "unknown"` as "do not render a
 * dot" (the returned lat/lng are zero in that case).
 *
 * Project shape uses `lat` / `lng` (see `types/index.ts#HousingProject`),
 * not `latitude` / `longitude`. `location` is the free-text field that
 * may hold a city name. `state` is the 2 letter province code for
 * Canadian projects or the USPS state code for US projects. National /
 * statewide rows (state codes like "FEDERAL", or location strings like
 * "California (statewide)") are intentionally treated as unknown so
 * they don't drop a misleading single dot in the centroid of an entire
 * state or country.
 */
export function resolveProjectCoordinates(
  project: Pick<HousingProject, "lat" | "lng" | "location" | "state">,
): ResolvedCoordinates {
  if (typeof project.lat === "number" && typeof project.lng === "number") {
    return { lat: project.lat, lng: project.lng, precision: "exact" };
  }
  const loc = project.location;
  if (loc) {
    if (CANADIAN_CITY_COORDS[loc]) {
      const [lat, lng] = CANADIAN_CITY_COORDS[loc];
      return { lat, lng, precision: "city" };
    }
    if (US_CITY_COORDS[loc]) {
      const [lat, lng] = US_CITY_COORDS[loc];
      return { lat, lng, precision: "city" };
    }
  }
  if (project.state) {
    if (PROVINCE_CENTROIDS[project.state]) {
      const [lat, lng] = PROVINCE_CENTROIDS[project.state];
      return { lat, lng, precision: "province" };
    }
    if (US_STATE_CENTROIDS[project.state]) {
      const [lat, lng] = US_STATE_CENTROIDS[project.state];
      return { lat, lng, precision: "province" };
    }
  }
  return { lat: 0, lng: 0, precision: "unknown" };
}


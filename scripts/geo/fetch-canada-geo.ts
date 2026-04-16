/**
 * fetch-canada-geo.ts
 *
 * One-time / rare script that downloads Canadian province and census division
 * boundary files, validates them, and produces TopoJSON for use with
 * react-simple-maps.
 *
 * Boundary files change on census cycles (next: 2026 census, boundaries
 * available ~2027). Re-run this script when new boundaries are published.
 *
 * Usage:  npx tsx scripts/geo/fetch-canada-geo.ts
 *
 * Source: Statistics Canada, 2021 Census Boundary Files
 * Licence: Open Government Licence . Canada
 *
 * Note: The StatCan ArcGIS REST endpoint intermittently returns 500 for
 * geometry queries. This script uses pre-simplified TopoJSON derived from
 * the same StatCan 2021 cartographic boundary files (hosted on Observable
 * CDN), validates them against the known PRUID/CDUID codes, restructures
 * them into single-layer TopoJSON, and writes to public/geo/.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, statSync } from "fs";
import { resolve } from "path";

// ── Known province UIDs (SGC codes, never change) ─────────────────────
const KNOWN_PRUIDS = new Set([
  "10", "11", "12", "13", "24", "35",
  "46", "47", "48", "59", "60", "61", "62",
]);

// ── Paths ─────────────────────────────────────────────────────────────
const ROOT = resolve(__dirname, "../..");
const RAW_DIR = resolve(ROOT, "data/raw/statcan-geo");
const OUT_DIR = resolve(ROOT, "public/geo");

const PR_RAW = resolve(RAW_DIR, "obs-provinces.json");
const CD_RAW = resolve(RAW_DIR, "obs-census-divisions.json");
const PR_TOPO = resolve(OUT_DIR, "canada-provinces-2021.topo.json");
const CD_TOPO = resolve(OUT_DIR, "canada-census-divisions-2021.topo.json");

// Observable CDN mirrors of StatCan 2021 cartographic boundary TopoJSON.
// Originally generated from the same data via mapshaper.
const PR_CDN =
  "https://static.observableusercontent.com/files/" +
  "8fc13bcd52d2dcee022ee375a23a89f250e03c88f0b660bb42fc4b7fb1ae801d" +
  "54c9998401407a873acf86a2d0c00bf309d4b244c220a14dc9581e0276b1654b";
const CD_CDN =
  "https://static.observableusercontent.com/files/" +
  "d6c1322f1df91afb22f0ad47f3172c998e9c2dd0714def071daff8377b6c2719" +
  "afa48d8037e76dc708f98c3193abbd1077614e4b399956c752f41f53c0cc236b";

// ── Types ─────────────────────────────────────────────────────────────
interface TopoGeom {
  type: string;
  arcs: unknown;
  properties?: Record<string, unknown>;
  geometries?: TopoGeom[];
}

interface TopoJSON {
  type: "Topology";
  arcs: unknown[];
  objects: Record<string, TopoGeom>;
  transform?: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────
function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

async function downloadFile(url: string, dest: string, label: string) {
  if (existsSync(dest)) {
    console.log(`  ${label}: using cached ${dest}`);
    return;
  }
  console.log(`  Downloading ${label}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`  ${label}: ${(buf.length / 1024).toFixed(0)} KB saved`);
}

/**
 * The Observable files have each feature as a separate TopoJSON object
 * (one per province / CD). Merge all objects into a single
 * GeometryCollection layer so react-simple-maps can iterate .geometries.
 * Set each geometry's id to the specified idField value from properties.
 */
function mergeToSingleLayer(
  topo: TopoJSON,
  layerName: string,
  idField: string,
): TopoJSON {
  const geometries: TopoGeom[] = [];
  for (const key of Object.keys(topo.objects)) {
    const obj = topo.objects[key];
    if (obj.geometries) {
      // Already a GeometryCollection. Flatten.
      for (const g of obj.geometries) {
        (g as unknown as Record<string, unknown>).id = String(
          g.properties?.[idField] ?? key,
        );
        geometries.push(g);
      }
    } else {
      // Single geometry object. Wrap it.
      (obj as unknown as Record<string, unknown>).id = String(
        obj.properties?.[idField] ?? key,
      );
      geometries.push(obj);
    }
  }
  return {
    type: "Topology",
    arcs: topo.arcs,
    transform: topo.transform,
    objects: {
      [layerName]: {
        type: "GeometryCollection",
        arcs: [],
        geometries,
      },
    },
  };
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  ensureDir(RAW_DIR);
  ensureDir(OUT_DIR);

  // ── 1. Download raw files ─────────────────────────────────────────
  console.log("Step 1: Downloading source TopoJSON...");
  await downloadFile(PR_CDN, PR_RAW, "Provinces");
  await downloadFile(CD_CDN, CD_RAW, "Census Divisions");

  // ── 2. Load and merge provinces ───────────────────────────────────
  console.log("\nStep 2: Processing provinces...");
  const prRaw: TopoJSON = JSON.parse(readFileSync(PR_RAW, "utf8"));
  const prMerged = mergeToSingleLayer(prRaw, "provinces", "PRUID");
  const prGeoms = prMerged.objects.provinces.geometries!;
  console.log(`  ${prGeoms.length} province features.`);

  if (prGeoms.length < 10) {
    throw new Error(
      `Expected at least 10 province features, got ${prGeoms.length}.`,
    );
  }

  // Validate PRUID codes.
  const seenPRUIDs = new Set<string>();
  for (let i = 0; i < prGeoms.length; i++) {
    const g = prGeoms[i];
    const pruid = String(g.properties?.PRUID ?? "");
    if (!pruid) {
      throw new Error(`Province at index ${i} is missing PRUID.`);
    }
    if (!KNOWN_PRUIDS.has(pruid)) {
      throw new Error(`Province at index ${i} has unknown PRUID "${pruid}".`);
    }
    // Strip rmapshaperid artifact from Observable export.
    if (g.properties && "rmapshaperid" in g.properties) {
      delete g.properties.rmapshaperid;
    }
    seenPRUIDs.add(pruid);
  }
  for (const uid of KNOWN_PRUIDS) {
    if (!seenPRUIDs.has(uid)) {
      throw new Error(`Missing province PRUID "${uid}" in the data.`);
    }
  }
  console.log("  All 13 PRUID codes validated.");

  writeFileSync(PR_TOPO, JSON.stringify(prMerged));
  const prSize = statSync(PR_TOPO).size;
  console.log(`  Written ${PR_TOPO} (${(prSize / 1024).toFixed(1)} KB)`);

  // ── 3. Load and merge census divisions ────────────────────────────
  console.log("\nStep 3: Processing census divisions...");
  const cdRaw: TopoJSON = JSON.parse(readFileSync(CD_RAW, "utf8"));
  const cdMerged = mergeToSingleLayer(cdRaw, "census_divisions", "CDUID");
  const cdGeoms = cdMerged.objects.census_divisions.geometries!;
  console.log(`  ${cdGeoms.length} census division features.`);

  if (cdGeoms.length < 200) {
    throw new Error(
      `Expected at least 200 CD features, got ${cdGeoms.length}.`,
    );
  }

  // Validate CDUID prefix matches a known PRUID.
  for (let i = 0; i < cdGeoms.length; i++) {
    const g = cdGeoms[i];
    const cduid = String(g.properties?.CDUID ?? "");
    const pruid = String(g.properties?.PRUID ?? "");
    if (!cduid) {
      throw new Error(`CD at index ${i} is missing CDUID.`);
    }
    if (!pruid || !KNOWN_PRUIDS.has(pruid)) {
      throw new Error(`CD "${cduid}" at index ${i} has invalid PRUID "${pruid}".`);
    }
    if (!cduid.startsWith(pruid)) {
      throw new Error(
        `CD "${cduid}" at index ${i}: CDUID doesn't start with PRUID "${pruid}".`,
      );
    }
    // Strip artifact.
    if (g.properties && "rmapshaperid" in g.properties) {
      delete g.properties.rmapshaperid;
    }
  }
  console.log("  All CDUID/PRUID codes validated.");

  writeFileSync(CD_TOPO, JSON.stringify(cdMerged));
  const cdSize = statSync(CD_TOPO).size;
  console.log(`  Written ${CD_TOPO} (${(cdSize / 1024).toFixed(1)} KB)`);

  if (cdSize > 1_000_000) {
    throw new Error(
      `Census divisions file is ${(cdSize / 1024).toFixed(0)} KB, exceeds 1 MB budget.`,
    );
  }

  // ── 4. Summary ────────────────────────────────────────────────────
  console.log("\n========================================");
  console.log("Output file sizes:");
  console.log(`  Provinces:        ${(prSize / 1024).toFixed(1)} KB`);
  console.log(`  Census divisions: ${(cdSize / 1024).toFixed(1)} KB`);
  console.log("========================================");
  console.log(
    "Contains information licensed under the Open Government Licence . Canada.",
  );
  console.log("Source: Statistics Canada, 2021 Census Boundary Files.");
}

main().catch((err) => {
  console.error("\nFATAL:", err.message ?? err);
  process.exit(1);
});

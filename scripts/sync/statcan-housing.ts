/**
 * Fetch Canadian housing metrics from Statistics Canada WDS API.
 *
 * Output: data/housing/canada/nhpi.json, starts.json, cpi-shelter.json
 * Cache:  data/raw/statcan/
 * Auth:   None
 *
 * Tables:
 *   18100205 — New Housing Price Index (monthly)
 *   34100135 — Housing starts & completions (quarterly)
 *   18100004 — CPI shelter component (monthly)
 */

import "../env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CACHE_DIR = join(ROOT, "data/raw/statcan");
const OUT_DIR = join(ROOT, "data/housing/canada");

mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const BASE = "https://www150.statcan.gc.ca/t1/wds/rest";

// ── Types ────────────────────────────────────────────────────────────
interface GeoMember {
  memberId: number;
  memberNameEn: string;
  geoLevel: number | null;
  parentMemberId: number | null;
}

interface DataPoint {
  refPer: string;
  value: number | null;
  releaseTime: string;
}

interface MetadataResponse {
  status: string;
  object: {
    productId: string;
    cubeTitleEn: string;
    releaseTime: string;
    dimension: Array<{
      dimensionPositionId: number;
      dimensionNameEn: string;
      member: GeoMember[];
    }>;
  };
}

interface DataResponse {
  status: string;
  object: {
    vectorDataPoint: DataPoint[];
  };
}

// ── API helpers ──────────────────────────────────────────────────────
async function postJson<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`StatsCan ${endpoint} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function getMetadata(productId: number): Promise<MetadataResponse["object"]> {
  const cachePath = join(CACHE_DIR, `meta_${productId}.json`);
  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, "utf8"));
  }
  const [result] = await postJson<MetadataResponse[]>("getCubeMetadata", [{ productId }]);
  if (result.status !== "SUCCESS") throw new Error(`Metadata failed for ${productId}`);
  writeFileSync(cachePath, JSON.stringify(result.object, null, 2));
  return result.object;
}

async function getData(
  productId: number,
  coordinate: string,
  latestN: number,
): Promise<DataPoint[]> {
  const slug = coordinate.replace(/\./g, "_");
  const cachePath = join(CACHE_DIR, `data_${productId}_${slug}_${latestN}.json`);
  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, "utf8"));
  }
  const [result] = await postJson<DataResponse[]>(
    "getDataFromCubePidCoordAndLatestNPeriods",
    [{ productId, coordinate, latestN }],
  );
  if (result.status !== "SUCCESS") {
    console.warn(`  [skip] ${productId} coord ${coordinate}: ${result.status}`);
    return [];
  }
  const points = result.object.vectorDataPoint;
  writeFileSync(cachePath, JSON.stringify(points, null, 2));
  return points;
}

// ── Table configs ────────────────────────────────────────────────────
interface TableConfig {
  productId: number;
  name: string;
  outFile: string;
  latestN: number;
  /** Extra dimension member IDs after geography (e.g., [1] for "Total" NHPI). */
  extraDims: number[];
  /** GeoLevels to include: 0=Canada, 2=Province, 503/504=CMA. */
  geoLevels: number[];
}

const TABLES: TableConfig[] = [
  {
    productId: 18100205,
    name: "New Housing Price Index",
    outFile: "nhpi.json",
    latestN: 12,
    extraDims: [1], // dim2: Total (house and land)
    geoLevels: [0, 2, 503, 504],
  },
  {
    productId: 34100135,
    name: "Housing starts and completions",
    outFile: "starts.json",
    latestN: 8,
    extraDims: [1, 1, 1], // dim2: Starts, dim3: Total units, dim4: Unadjusted
    geoLevels: [0, 2],
  },
  {
    productId: 18100004,
    name: "CPI - Shelter component",
    outFile: "cpi-shelter.json",
    latestN: 12,
    extraDims: [79], // dim2: Shelter (memberId 79)
    geoLevels: [0, 2],
  },
];

// ── Build coordinate string ──────────────────────────────────────────
/** StatsCan expects exactly 10 coordinate positions, zero-padded. */
function makeCoord(geoMemberId: number, extraDims: number[]): string {
  const parts = new Array(10).fill(0);
  parts[0] = geoMemberId;
  for (let i = 0; i < extraDims.length; i++) {
    parts[i + 1] = extraDims[i];
  }
  return parts.join(".");
}

// ── Main ─────────────────────────────────────────────────────────────
async function processTable(cfg: TableConfig) {
  console.log(`\n[statcan] Fetching ${cfg.name} (${cfg.productId})...`);

  const meta = await getMetadata(cfg.productId);
  const geoDim = meta.dimension.find((d) => d.dimensionPositionId === 1);
  if (!geoDim) throw new Error(`No geography dimension for ${cfg.productId}`);

  // Filter to desired geoLevels
  const geos = geoDim.member.filter(
    (m) => m.geoLevel !== null && cfg.geoLevels.includes(m.geoLevel),
  );
  console.log(`  ${geos.length} geographies to fetch`);

  const geographies: Record<string, { values: Array<{ period: string; value: number }> }> = {};

  for (const geo of geos) {
    const coord = makeCoord(geo.memberId, cfg.extraDims);
    const points = await getData(cfg.productId, coord, cfg.latestN);
    const values = points
      .filter((p) => p.value !== null)
      .map((p) => ({
        period: p.refPer.slice(0, 7), // "2026-02"
        value: p.value as number,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));

    if (values.length > 0) {
      geographies[geo.memberNameEn] = { values };
    }
  }

  const output = {
    table: String(cfg.productId),
    name: cfg.name,
    lastUpdated: meta.releaseTime?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    geographies,
  };

  const outPath = join(OUT_DIR, cfg.outFile);
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(
    `  Wrote ${Object.keys(geographies).length} geographies → ${cfg.outFile}`,
  );
}

async function main() {
  console.log("[statcan-housing] Starting StatsCan sync...");

  for (const cfg of TABLES) {
    await processTable(cfg);
  }

  console.log("\n[statcan-housing] Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

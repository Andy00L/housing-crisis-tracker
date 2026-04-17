"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { geoCentroid, geoMercator, geoPath } from "d3-geo";
import type { FeatureCollection, Geometry } from "geojson";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { NEUTRAL_FILL, NEUTRAL_STROKE, type SetTooltip } from "@/lib/map-utils";
import {
  getCensusDivisionByUid,
} from "@/lib/census-division-data";
import { PROVINCE_ABBR, PROVINCE_UID, type HousingProject, type MunicipalActionStatus } from "@/types";
import { ALL_HOUSING_PROJECTS } from "@/lib/projects-map";
import ProjectDots from "./ProjectDots";

interface CensusDivisionMapProps {
  provinceName: string;
  onSelectCd: (cduid: string) => void;
  selectedCduid: string | null;
  setTooltip: SetTooltip;
  showProjects?: boolean;
  showCompleted?: boolean;
  onHoverProject?: (
    project: HousingProject,
    x: number,
    y: number,
    clusterSize: number,
  ) => void;
  onLeaveProject?: () => void;
  onSelectProject?: (project: HousingProject) => void;
  /** Emits the geographic centroid [lat, lng] of the selected CD,
   *  or null when nothing is selected. MapShell uses this to filter
   *  the side panel's Projects tab by proximity. */
  onCdCentroidChange?: (centroid: [number, number] | null) => void;
}

const CD_URL = "/geo/canada-census-divisions-2021.topo.json";
const PR_URL = "/geo/canada-provinces-2021.topo.json";

type CdCollection = FeatureCollection<Geometry, { CDUID?: string; CDNAME?: string; CDTYPE?: string; PRUID?: string }>;

// Module-level cache so multiple mounts share one fetch.
let cdPromise: Promise<CdCollection> | null = null;
let prPromise: Promise<CdCollection> | null = null;

function loadCds(): Promise<CdCollection> {
  if (!cdPromise) {
    cdPromise = fetch(CD_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`Census divisions: HTTP ${r.status}`);
        return r.json();
      })
      .then((topo: Topology) => {
        return feature(
          topo,
          topo.objects.census_divisions as GeometryCollection,
        ) as unknown as CdCollection;
      })
      .catch((err) => {
        cdPromise = null;
        throw err;
      });
  }
  return cdPromise;
}

function loadProvinces(): Promise<CdCollection> {
  if (!prPromise) {
    prPromise = fetch(PR_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`Provinces: HTTP ${r.status}`);
        return r.json();
      })
      .then((topo: Topology) => {
        return feature(
          topo,
          topo.objects.provinces as GeometryCollection,
        ) as unknown as CdCollection;
      })
      .catch((err) => {
        prPromise = null;
        throw err;
      });
  }
  return prPromise;
}

// Census division type codes → human-readable labels.
const CD_TYPE_LABEL: Record<string, string> = {
  CDR: "Census division",
  CTY: "County",
  MRC: "MRC",
  RD: "Regional district",
  DM: "District municipality",
  UC: "United counties",
  RM: "Regional municipality",
  CT: "County",
  DR: "District",
  REG: "Region",
  TER: "Territory",
  DIS: "District",
};

/** Restore accented French names broken by Latin-1 to UTF-8 conversion
 *  in the census divisions TopoJSON. */
const CDNAME_FIX: Record<string, string> = {
  "2401": "Les \u00CEles-de-la-Madeleine",
  "2402": "Le Rocher-Perc\u00E9",
  "2403": "La C\u00F4te-de-Gasp\u00E9",
  "2404": "La Haute-Gasp\u00E9sie",
  "2407": "La Matap\u00E9dia",
  "2412": "Rivi\u00E8re-du-Loup",
  "2413": "T\u00E9miscouata",
  "2420": "L'\u00CEle-d'Orl\u00E9ans",
  "2421": "La C\u00F4te-de-Beaupr\u00E9",
  "2423": "Qu\u00E9bec",
  "2425": "L\u00E9vis",
  "2432": "L'\u00C9rable",
  "2433": "Lotbini\u00E8re",
  "2435": "M\u00E9kinac",
  "2438": "B\u00E9cancour",
  "2441": "Le Haut-Saint-Fran\u00E7ois",
  "2442": "Le Val-Saint-Fran\u00E7ois",
  "2445": "Memphr\u00E9magog",
  "2451": "Maskinong\u00E9",
  "2457": "La Vall\u00E9e-du-Richelieu",
  "2466": "Montr\u00E9al",
  "2473": "Th\u00E9r\u00E8se-De Blainville",
  "2475": "La Rivi\u00E8re-du-Nord",
  "2483": "La Vall\u00E9e-de-la-Gatineau",
  "2485": "T\u00E9miscamingue",
  "2489": "La Vall\u00E9e-de-l'Or",
  "2495": "La Haute-C\u00F4te-Nord",
  "2497": "Sept-Rivi\u00E8res--Caniapiscau",
  "2499": "Nord-du-Qu\u00E9bec",
};

function cdTypeLabel(code: string | undefined): string {
  if (!code) return "Census division";
  return CD_TYPE_LABEL[code] ?? code;
}

function statusFill(status: MunicipalActionStatus | null): string {
  if (status === "enacted") return "var(--color-stance-restrictive)";
  if (status === "under-review") return "var(--color-stance-concerning)";
  if (status === "proposed") return "var(--color-stance-review)";
  if (status === "failed") return "var(--color-stance-none)";
  return NEUTRAL_FILL;
}

function dominantStatus(
  statuses: MunicipalActionStatus[],
): MunicipalActionStatus | null {
  const order: MunicipalActionStatus[] = [
    "enacted",
    "under-review",
    "proposed",
    "failed",
  ];
  for (const s of order) {
    if (statuses.includes(s)) return s;
  }
  return null;
}

const VIEWBOX_W = 960;
const VIEWBOX_H = 600;
const INSET = 56;

export default function CensusDivisionMap({
  provinceName,
  onSelectCd,
  selectedCduid,
  setTooltip,
  showProjects = false,
  showCompleted = false,
  onHoverProject,
  onLeaveProject,
  onSelectProject,
  onCdCentroidChange,
}: CensusDivisionMapProps) {
  const provinceUid = PROVINCE_UID[provinceName];
  const [cds, setCds] = useState<CdCollection | null>(null);
  const [provinces, setProvinces] = useState<CdCollection | null>(null);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadCds()
      .then((c) => { if (!cancelled) setCds(c); })
      .catch(() => { if (!cancelled) setFetchError(true); });
    loadProvinces()
      .then((p) => { if (!cancelled) setProvinces(p); })
      .catch(() => { /* province silhouette is optional */ });
    return () => { cancelled = true; };
  }, []);

  const computed = useMemo(() => {
    if (!cds || !provinceUid) return null;

    // Filter CDs by PRUID prefix (same pattern as FIPS filtering in CountyMap).
    const filtered = cds.features.filter((f) =>
      String(f.id).startsWith(provinceUid),
    );

    // Province silhouette underlay.
    const provFeature =
      provinces?.features.find((f) => String(f.id) === provinceUid) ?? null;

    // Autofit projection to the filtered CDs.
    const collection: FeatureCollection = {
      type: "FeatureCollection",
      features: filtered,
    };

    // Use Mercator for Canada. geoAlbersUsa only works for US geography.
    const projection = geoMercator();
    projection.fitExtent(
      [
        [INSET, INSET],
        [VIEWBOX_W - INSET, VIEWBOX_H - INSET],
      ],
      collection,
    );

    const path = geoPath(projection);
    const paths = filtered.map((f) => path(f) ?? "");
    const provincePath = provFeature ? path(provFeature) ?? "" : "";

    // Compute starting bbox for zoom animation. Use the provinces-level
    // Canada Mercator projection to get the province's screen position,
    // then compute the transform to animate from that to the fitted view.
    const caProj = geoMercator().center([-96, 60]).scale(500).translate([480, 350]);
    const caPath = geoPath(caProj);
    const bbox = provFeature
      ? (caPath.bounds(provFeature) as [[number, number], [number, number]])
      : null;

    // Filter housing projects for this province.
    const provCode = PROVINCE_ABBR[provinceUid];
    const provinceProjects = provCode
      ? ALL_HOUSING_PROJECTS.filter(
          (f) => f.state === provCode
            && (showCompleted || f.status !== "operational"),
        )
      : [];

    return {
      projection,
      cdFeatures: filtered,
      zoomedPaths: paths,
      provincePaths: provincePath ? [provincePath] : [],
      bbox,
      provinceProjects,
    };
  }, [cds, provinces, provinceUid, showCompleted]);

  // Transform-based zoom animation (mirrors CountyMap).
  const [animateReady, setAnimateReady] = useState(false);
  const firstMountRef = useRef(true);

  useEffect(() => {
    if (!computed || computed.zoomedPaths.length === 0) return;
    // Intentional: reset animation state then schedule the "ready" frame.
    // Same pattern as CountyMap's zoom-in animation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnimateReady(false);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimateReady(true));
    });
    return () => cancelAnimationFrame(id);
  }, [provinceName, computed]);

  useEffect(() => {
    firstMountRef.current = false;
  }, []);

  // Emit the geographic centroid of the selected CD so MapShell can
  // filter the side panel's Projects tab by proximity.
  useEffect(() => {
    if (!onCdCentroidChange) return;
    if (!selectedCduid || !computed) {
      onCdCentroidChange(null);
      return;
    }
    const feat = computed.cdFeatures.find(
      (f) => String(f.id ?? "").padStart(4, "0") === selectedCduid,
    );
    if (!feat) {
      onCdCentroidChange(null);
      return;
    }
    const [lng, lat] = geoCentroid(feat);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      onCdCentroidChange([lat, lng]);
    } else {
      onCdCentroidChange(null);
    }
  }, [selectedCduid, computed, onCdCentroidChange]);

  const fromTransform = useMemo(() => {
    const bbox = computed?.bbox ?? null;
    if (!bbox) return "translate(480 300) scale(0.3) translate(-480 -300)";
    const [[x0, y0], [x1, y1]] = bbox;
    const bw = x1 - x0;
    const bh = y1 - y0;
    if (bw <= 0 || bh <= 0)
      return "translate(480 300) scale(0.3) translate(-480 -300)";
    const scale = Math.min(
      bw / (VIEWBOX_W - 2 * INSET),
      bh / (VIEWBOX_H - 2 * INSET),
    );
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const tx = cx - (VIEWBOX_W / 2) * scale;
    const ty = cy - (VIEWBOX_H / 2) * scale;
    return `translate(${tx} ${ty}) scale(${scale})`;
  }, [computed]);

  if (!provinceUid) {
    return (
      <div className="flex items-center justify-center text-sm text-muted">
        Census divisions not available for {provinceName}
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex items-center justify-center text-sm text-muted">
        Failed to load census division boundaries.
      </div>
    );
  }

  if (!cds || !computed) {
    return (
      <div className="w-full h-full flex items-center justify-center text-sm text-muted">
        Loading census divisions...
      </div>
    );
  }

  const { cdFeatures, zoomedPaths, provincePaths, provinceProjects } = computed;

  return (
    <div
      className="relative w-full h-full"
      onMouseMove={(e) =>
        setTooltip((current) =>
          current ? { ...current, x: e.clientX, y: e.clientY } : current,
        )
      }
      onMouseLeave={() => setTooltip(null)}
    >
      <svg
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: "100%",
          height: "100%",
          shapeRendering: "geometricPrecision",
        }}
      >
        <g
          style={{
            transform: animateReady ? "none" : fromTransform,
            transformOrigin: "0 0",
            transition:
              "transform 650ms cubic-bezier(0.32, 0.72, 0, 1), opacity 400ms ease",
            opacity: animateReady ? 1 : 0.85,
          }}
        >
          {/* Province silhouette underlay */}
          {provincePaths.map((d, i) => (
            <path
              key={`outline-${i}`}
              d={d}
              fill={NEUTRAL_FILL}
              stroke={NEUTRAL_STROKE}
              strokeWidth={1.5}
            />
          ))}

          {/* Census divisions (choropleth) */}
          {zoomedPaths.map((d, i) => {
            const f = cdFeatures[i];
            const cduid = String(f.id ?? "").padStart(4, "0");
            const cdName = CDNAME_FIX[cduid] ?? f.properties?.CDNAME ?? cduid;
            const cdType = f.properties?.CDTYPE;
            const cd = getCensusDivisionByUid(cduid);
            const statuses: MunicipalActionStatus[] =
              cd?.actions.map((a) => a.status) ?? [];
            const dominant = dominantStatus(statuses);
            const hasData = !!cd;
            const isSelected = selectedCduid === cduid;
            const fill = hasData ? statusFill(dominant) : NEUTRAL_FILL;
            const stroke = isSelected ? "#1D1D1F" : NEUTRAL_STROKE;
            const strokeWidth = isSelected ? 2 : 0.5;

            return (
              <path
                key={cduid}
                d={d}
                fill={fill}
                fillOpacity={hasData ? 0.92 : 0.78}
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeLinejoin="round"
                style={{
                  cursor: hasData ? "pointer" : "default",
                  transition:
                    "stroke 200ms, stroke-width 200ms, filter 200ms",
                  filter: isSelected
                    ? "drop-shadow(0 4px 12px rgba(0,0,0,0.15))"
                    : undefined,
                  outline: "none",
                }}
                onMouseEnter={(e) =>
                  setTooltip({
                    x: e.clientX,
                    y: e.clientY,
                    label: `${cdName} (${cdTypeLabel(cdType)})`,
                    countyFips: hasData ? cduid : undefined,
                  })
                }
                onMouseLeave={() => setTooltip(null)}
                onClick={() => hasData && onSelectCd(cduid)}
              />
            );
          })}

          {/* Compact project dots (small circles colored by projectType) */}
          {showProjects && onHoverProject && onLeaveProject && (
            <ProjectDots
              projects={provinceProjects}
              projection={(coords) => computed.projection(coords)}
              compact
              clusterDeg={0.4}
              onHoverProject={onHoverProject}
              onLeaveProject={onLeaveProject}
              onSelectProject={onSelectProject}
            />
          )}
        </g>
      </svg>
    </div>
  );
}

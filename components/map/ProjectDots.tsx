"use client";

import { useEffect, useMemo, useState } from "react";
import { useMapContext } from "react-simple-maps";
import type { HousingProject, HousingProjectStatus } from "@/types";
import { statusColorForProject } from "@/lib/project-colors";
import { resolveProjectCoordinates } from "@/lib/projects-map";

interface ProjectDotsProps {
  projects: HousingProject[];
  /** Called on mouse enter/move with the hovered project (or cluster
   *  representative) and screen coords. Prop name kept as
   *  `onHoverProject` for API compatibility with existing consumers. */
  onHoverProject: (
    project: HousingProject,
    x: number,
    y: number,
    clusterSize: number,
  ) => void;
  onLeaveProject: () => void;
  /** Called on click. Pins the project in the side panel. */
  onSelectProject?: (project: HousingProject) => void;
  /** Lng/lat cell size for grid clustering. Default 1.8 degrees. */
  clusterDeg?: number;
  /**
   * Optional projection override. Pass the same d3 projection your
   * <ComposableMap> uses. When omitted we fall back to react-simple-maps
   * MapContext. Context-derived projection has been unreliable under
   * Turbopack / React 19 (returns non-iterables for some calls) so going
   * direct via prop is the reliable path.
   */
  projection?: (coords: [number, number]) => [number, number] | null;
}

interface Cluster {
  key: string;
  projects: HousingProject[];
  repr: HousingProject;
  lat: number;
  lng: number;
  totalUnits: number;
  dominantStatus: HousingProjectStatus | "mixed";
}

export type ProjectDotStatus = HousingProjectStatus | "mixed";

/**
 * County-view project icon. iOS app-icon shape (squircle) with a
 * subtle vertical gradient, a top sheen, and a soft drop shadow. Designed
 * to sit cleanly on a map full of circular power-plant dots. States and
 * continent views keep the simpler `ProjectDot` circle.
 *
 * Depends on these SVG defs being present in the parent SVG:
 *   - #project-shadow, #project-grad-operational, #project-grad-construction,
 *     #project-grad-mixed, #project-sheen
 */
export function ProjectIcon({
  x,
  y,
  size,
  status,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  onClick,
  interactive = true,
}: {
  x: number;
  y: number;
  /** Matches ProjectDot radius at the same capacity band so the visual weight
   *  stays consistent across map zooms. */
  size: number;
  status: ProjectDotStatus;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  onClick?: () => void;
  interactive?: boolean;
}) {
  const color = statusColorForProject(status);
  const isProposed = status === "proposed";
  // Square 1:1 body with squircle-ish corner radius (~34% of edge).
  const d = size * 3.2;
  const half = d / 2;
  const rx = d * 0.34;
  const gradId =
    status === "under-construction"
      ? "project-grad-construction"
      : status === "mixed"
        ? "project-grad-mixed"
        : "project-grad-operational";
  const bodyFill = isProposed ? "#FFFFFF" : `url(#${gradId})`;
  return (
    <g
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      shapeRendering="geometricPrecision"
      style={{
        cursor: interactive && onClick ? "pointer" : "default",
      }}
    >
      {/* Drop shadow plate. Slightly offset downward, blurred via filter. */}
      <rect
        x={x - half}
        y={y - half + 1.2}
        width={d}
        height={d}
        rx={rx}
        fill="black"
        fillOpacity={0.14}
        style={{ filter: "url(#project-shadow)", pointerEvents: "none" }}
      />
      {/* Body */}
      <rect
        x={x - half}
        y={y - half}
        width={d}
        height={d}
        rx={rx}
        fill={bodyFill}
        stroke={isProposed ? color : "rgba(255,255,255,0.35)"}
        strokeWidth={isProposed ? 1.4 : 0.7}
      />
      {/* Top-half sheen. White linear gradient that fades to clear.
          Skipped on proposed (already white body). */}
      {!isProposed && (
        <rect
          x={x - half + 0.6}
          y={y - half + 0.6}
          width={d - 1.2}
          height={(d - 1.2) * 0.48}
          rx={rx - 0.6}
          fill="url(#project-sheen)"
          style={{ pointerEvents: "none" }}
        />
      )}
      {/* Center glyph. A tiny rounded pill that reads as a server-rack
          stripe without the literal "two horizontal lines" feel. */}
      <rect
        x={x - d * 0.18}
        y={y - d * 0.055}
        width={d * 0.36}
        height={d * 0.11}
        rx={d * 0.055}
        fill={isProposed ? color : "#FFFFFF"}
        fillOpacity={isProposed ? 0.9 : 0.85}
        style={{ pointerEvents: "none" }}
      />
    </g>
  );
}

interface ProjectDotProps {
  /** When omitted, the parent must wrap this in a <Marker> that
   *  positions it. When present, renders at explicit screen coords. */
  x?: number;
  y?: number;
  r: number;
  status: ProjectDotStatus;
  /** Cluster count: shows the number when > 1. */
  count?: number;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  onClick?: () => void;
  interactive?: boolean;
}

/**
 * Single source of truth for the project dot visual: halo, body
 * circle, and optional cluster number. Used by both the projected
 * (countries / states) and the locally-projected (county) renderings
 * so the dots look identical at every drill level.
 */
export function ProjectDot({
  x,
  y,
  r,
  status,
  count = 1,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  onClick,
  interactive = true,
}: ProjectDotProps) {
  const color = statusColorForProject(status);
  const isProposed = status === "proposed";
  const isCluster = count > 1;
  const positioned = typeof x === "number" && typeof y === "number";
  const haloProps = positioned ? { cx: x, cy: y } : {};
  const bodyProps = positioned ? { cx: x, cy: y } : {};
  const textProps = positioned ? { x, y } : {};

  return (
    <>
      <circle
        {...haloProps}
        r={r + 2.2}
        fill={color}
        opacity={0.18}
        style={{ pointerEvents: "none" }}
      />
      <circle
        {...bodyProps}
        r={r}
        fill={isProposed ? "#FFFFFF" : color}
        stroke={isProposed ? color : "#FFFFFF"}
        strokeWidth={isProposed ? 1.6 : 1.1}
        shapeRendering="geometricPrecision"
        style={{
          cursor: interactive && onClick ? "pointer" : "default",
          pointerEvents: "all",
        }}
        onMouseEnter={onMouseEnter}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
      />
      {/* Cluster count is only readable on the medium / large bands.
          On the small (4px) band we drop it entirely. The dot itself
          is the signal, the number was unreadable noise. */}
      {isCluster && r >= 7 && (
        <text
          {...textProps}
          textAnchor="middle"
          dominantBaseline="central"
          style={{
            fontSize: r >= 10 ? "9px" : "8px",
            fontWeight: 600,
            fontFamily: "inherit",
            fill: isProposed ? color : "#FFFFFF",
            pointerEvents: "none",
            letterSpacing: "-0.02em",
            transform: "translateY(-0.1px)",
          }}
        >
          {count}
        </text>
      )}
    </>
  );
}

function clusterProjects(facs: HousingProject[], cellDeg: number): Cluster[] {
  const buckets = new Map<string, HousingProject[]>();
  for (const f of facs) {
    // Projects without coords get a city-centroid (or province-centroid)
    // fallback via `resolveProjectCoordinates`. Anything still unknown
    // (e.g. national / statewide rows with no specific city) is left out
    // of the map so we don't drop a misleading dot at a country centroid.
    const resolved = resolveProjectCoordinates(f);
    if (resolved.precision === "unknown") continue;
    const lat = resolved.lat;
    const lng = resolved.lng;
    const key = `${Math.round(lat / cellDeg)}|${Math.round(lng / cellDeg)}`;
    const bucket = buckets.get(key) ?? [];
    // Carry the resolved coords forward so cluster math + projection
    // both see the same numbers, regardless of whether the project
    // shipped with lat/lng or relied on the fallback.
    bucket.push({ ...f, lat, lng });
    buckets.set(key, bucket);
  }
  const clusters: Cluster[] = [];
  for (const [key, bucket] of buckets) {
    let totalUnits = 0;
    let sumLat = 0;
    let sumLng = 0;
    let repr = bucket[0];
    for (const f of bucket) {
      const count = f.unitCount ?? 0;
      totalUnits += count;
      sumLat += f.lat ?? 0;
      sumLng += f.lng ?? 0;
      if ((f.unitCount ?? 0) > (repr.unitCount ?? 0)) repr = f;
    }
    const statuses = new Set(bucket.map((f) => f.status));
    clusters.push({
      key,
      projects: bucket,
      repr,
      lat: sumLat / bucket.length,
      lng: sumLng / bucket.length,
      totalUnits,
      dominantStatus: statuses.size === 1 ? bucket[0].status : "mixed",
    });
  }
  // Biggest first so small dots render on top and aren't hidden.
  clusters.sort((a, b) => b.totalUnits - a.totalUnits);
  return clusters;
}

// Three discrete size buckets keyed off cluster total units. Discrete > continuous
// because the eye reads "small / medium / large" instantly, but a continuous
// log scale just looks like a uniformly noisy field. Bands match the legend
// shown to the user (< 100 / 100-500 / 500+).
export const SIZE_BANDS = [
  { key: "sm" as const, label: "< 100 units", max: 100, r: 4 },
  { key: "md" as const, label: "100\u2013500 units", max: 500, r: 7 },
  { key: "lg" as const, label: "500+ units", max: Infinity, r: 11 },
];

function clusterRadius(totalUnits: number): number {
  for (const band of SIZE_BANDS) {
    if (totalUnits < band.max) return band.r;
  }
  return SIZE_BANDS[SIZE_BANDS.length - 1].r;
}

export default function ProjectDots({
  projects,
  onHoverProject,
  onLeaveProject,
  onSelectProject,
  clusterDeg = 1.8,
  projection: projectionProp,
}: ProjectDotsProps) {
  const clusters = useMemo(
    () => clusterProjects(projects, clusterDeg),
    [projects, clusterDeg],
  );

  // Gate on mount. Projection output is float-sensitive, so server vs
  // client renders can diverge by a trailing digit. The dots have no
  // SEO / a11y value pre-hydration, so skip them until mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Prefer the projection passed as a prop. Fall back to MapContext only
  // when no prop is supplied. Context-derived projection has been flaky
  // under Turbopack / React 19 for reasons we don't fully understand,
  // going direct via prop is the reliable path.
  const ctx = useMapContext();
  const projection = (projectionProp ??
    (ctx as { projection?: (c: [number, number]) => [number, number] | null } | undefined)
      ?.projection) as
    | ((c: [number, number]) => [number, number] | null | undefined)
    | undefined;

  if (!mounted || typeof projection !== "function") return null;

  return (
    <g shapeRendering="geometricPrecision">
      {clusters.map((c) => {
        let projected: [number, number] | null | undefined;
        try {
          projected = projection([c.lng, c.lat]);
        } catch {
          return null;
        }
        if (!projected || !Array.isArray(projected) || projected.length < 2) {
          return null;
        }
        const [x, y] = projected;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const r = clusterRadius(c.totalUnits);
        return (
          <g key={c.key} transform={`translate(${x}, ${y})`}>
            <ProjectDot
              r={r}
              status={c.dominantStatus}
              count={c.projects.length}
              onMouseEnter={(e) =>
                onHoverProject(
                  c.repr,
                  e.clientX,
                  e.clientY,
                  c.projects.length,
                )
              }
              onMouseMove={(e) =>
                onHoverProject(
                  c.repr,
                  e.clientX,
                  e.clientY,
                  c.projects.length,
                )
              }
              onMouseLeave={() => onLeaveProject()}
              onClick={
                onSelectProject ? () => onSelectProject(c.repr) : undefined
              }
              interactive={!!onSelectProject}
            />
          </g>
        );
      })}
    </g>
  );
}

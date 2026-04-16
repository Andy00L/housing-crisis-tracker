"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — vendored fork with country-id texture patch
import createGlobe from "./cobe-patched.js";
import NumberFlow from "@number-flow/react";
import * as topojson from "topojson-client";
import { geoEquirectangular, geoPath, geoContains } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import MapShell from "@/components/map/MapShell";
import SummaryBar from "@/components/sections/SummaryBar";
import DimensionToggle from "@/components/sections/DimensionToggle";
import { useScrollProgress } from "@/lib/use-scroll-progress";
import { ALL_HOUSING_PROJECTS } from "@/lib/projects-map";
import type { Dimension, DimensionLens, Region, ViewTarget } from "@/types";

const WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const MAP_W = 2048;
const MAP_H = 1024;

const { PI } = Math;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

// Map each country's numeric ID (from world-atlas) to a region so region click still works.
const NA_IDS = new Set<number>([840, 124, 484]);
const EU_IDS = new Set<number>([8, 20, 31, 40, 51, 56, 70, 100, 112, 191, 196, 203, 208, 233, 246, 250, 268, 276, 292, 300, 336, 348, 352, 372, 380, 428, 438, 440, 442, 470, 492, 498, 499, 528, 578, 616, 620, 642, 643, 674, 688, 703, 705, 724, 752, 756, 792, 804, 807, 826]);
const ASIA_IDS = new Set<number>([4, 31, 50, 51, 64, 96, 104, 116, 144, 156, 158, 196, 268, 275, 296, 344, 356, 360, 364, 368, 376, 392, 398, 400, 408, 410, 414, 417, 418, 422, 446, 458, 462, 469, 496, 512, 524, 586, 608, 626, 634, 643, 682, 686, 702, 704, 706, 716, 760, 762, 764, 784, 792, 795, 860, 887]);
function countryToRegion(numId: number): Region | null {
  if (NA_IDS.has(numId)) return "na";
  if (EU_IDS.has(numId)) return "eu";
  if (ASIA_IDS.has(numId)) return "asia";
  return null;
}

// Rasterize world countries to an equirectangular canvas where each pixel's
// R channel encodes the country index (1-based). Shader samples this texture
// and checks against the hoveredCountry uniform.
function buildCountryMap(features: Feature<Geometry>[]): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, MAP_W, MAP_H);

  // Pacific-centered: cobe's base-map texture is encoded so that lng=0 is at
  // u=0 and lng=180 is at u=0.5. Standard equirectangular puts lng=0 at x=W/2;
  // we rotate by -180° so our country canvas aligns with cobe's UV convention.
  const projection = geoEquirectangular()
    .rotate([-180, 0, 0])
    .translate([MAP_W / 2, MAP_H / 2])
    .scale(MAP_W / (2 * PI));
  const path = geoPath(projection, ctx);

  // 255 countries fit in one byte. Skip 0 since shader treats 0 as "no country".
  features.forEach((f, i) => {
    const id = (i + 1) & 0xff;
    if (!id) return;
    ctx.fillStyle = `rgb(${id},0,0)`;
    ctx.beginPath();
    path(f);
    ctx.fill();
  });
  return canvas;
}

interface TopoCountries {
  objects: { countries: unknown };
}

function ForkedGlobe({
  features, scrollPhiOffset, onRegionClick,
  hoveredCountry, setHoveredCountry,
}: {
  features: Feature<Geometry>[];
  scrollPhiOffset: number;
  onRegionClick: (r: Region) => void;
  hoveredCountry: number;
  setHoveredCountry: (id: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const phiRef = useRef(0);
  const thetaRef = useRef(0.18);
  const pausedRef = useRef(false);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const didDragRef = useRef(false);
  const dragOffsetRef = useRef({ phi: 0, theta: 0 });
  const phiOffsetRef = useRef(0);
  const thetaOffsetRef = useRef(0);
  const scrollPhiRef = useRef(scrollPhiOffset);
  const globeRef = useRef<{ update: (opts: Record<string, unknown>) => void; destroy: () => void } | null>(null);
  const countryCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => { scrollPhiRef.current = scrollPhiOffset; }, [scrollPhiOffset]);
  useEffect(() => {
    globeRef.current?.update({ hoveredCountry });
  }, [hoveredCountry]);

  // Build the country-id texture once features are loaded
  useEffect(() => {
    if (!features.length) return;
    countryCanvasRef.current = buildCountryMap(features);
    globeRef.current?.update({ countryMap: countryCanvasRef.current });
  }, [features]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const width = canvas.offsetWidth;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const globe = createGlobe(canvas, {
      devicePixelRatio: dpr,
      width, height: width,
      phi: 0, theta: 0.18,
      dark: 0, diffuse: 1.15,
      mapSamples: 22000, mapBrightness: 5.2,
      baseColor: [0.78, 0.76, 0.68],
      markerColor: [0.04, 0.52, 1],
      glowColor: [0.92, 0.95, 0.98],
      markers: [],
      opacity: 1,
      highlightColor: [0.91, 0.48, 0.36], // coral
      hoveredCountry: 0,
    });
    globeRef.current = globe;
    // If texture was built before globe init, upload it now
    if (countryCanvasRef.current) {
      globe.update({ countryMap: countryCanvasRef.current });
    }

    let animId = 0;
    const animate = () => {
      if (!pausedRef.current) phiRef.current += 0.0022;
      const currentPhi = phiRef.current + scrollPhiRef.current + phiOffsetRef.current + dragOffsetRef.current.phi;
      const currentTheta = clamp(thetaRef.current + thetaOffsetRef.current + dragOffsetRef.current.theta, -0.5, 0.5);
      globe.update({ phi: currentPhi, theta: currentTheta });
      animId = requestAnimationFrame(animate);
    };
    animate();
    return () => { cancelAnimationFrame(animId); globe.destroy(); globeRef.current = null; };
  }, []);

  // Screen → lat/lng via inverse of cobe's rotation matrix
  const unproject = (nx: number, ny: number): { lat: number; lng: number } | null => {
    const r2 = nx * nx + ny * ny;
    if (r2 > 0.64) return null;
    const nz = Math.sqrt(0.64 - r2) / 0.8;
    const x = nx / 0.8, y = ny / 0.8, z = nz;
    const phi = phiRef.current + scrollPhiRef.current + phiOffsetRef.current;
    const theta = thetaRef.current + thetaOffsetRef.current;
    const cx = Math.cos(-theta), sx = Math.sin(-theta);
    const cy = Math.cos(-phi), sy = Math.sin(-phi);
    const x1 = x, y1 = cx * y - sx * z, z1 = sx * y + cx * z;
    const x2 = cy * x1 + sy * z1, y2 = y1, z2 = -sy * x1 + cy * z1;
    const lat = Math.asin(y2) * 180 / PI;
    const lng = Math.atan2(z2, -x2) * 180 / PI;
    return { lat, lng };
  };

  const findCountry = (lat: number, lng: number): { index: number; feature: Feature<Geometry> } | null => {
    for (let i = 0; i < features.length; i++) {
      if (geoContains(features[i], [lng, lat])) return { index: i, feature: features[i] };
    }
    return null;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    pointerDownRef.current = { x: e.clientX, y: e.clientY };
    didDragRef.current = false;
    pausedRef.current = true;
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (pointerDownRef.current) {
      const dx = e.clientX - pointerDownRef.current.x;
      const dy = e.clientY - pointerDownRef.current.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) didDragRef.current = true;
      if (didDragRef.current) {
        dragOffsetRef.current = { phi: dx / 200, theta: dy / 600 };
        return;
      }
    }
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((e.clientY - rect.top) / rect.height) * 2;
    const ll = unproject(nx, ny);
    if (!ll) { setHoveredCountry(0); return; }
    const hit = findCountry(ll.lat, ll.lng);
    setHoveredCountry(hit ? hit.index + 1 : 0);
  };
  const handlePointerUp = (e: React.PointerEvent) => {
    if (pointerDownRef.current) {
      phiOffsetRef.current += dragOffsetRef.current.phi;
      thetaOffsetRef.current += dragOffsetRef.current.theta;
      dragOffsetRef.current = { phi: 0, theta: 0 };
      if (!didDragRef.current) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          const ny = 1 - ((e.clientY - rect.top) / rect.height) * 2;
          const ll = unproject(nx, ny);
          if (ll) {
            const hit = findCountry(ll.lat, ll.lng);
            const countryId = hit?.feature.id ? parseInt(String(hit.feature.id), 10) : 0;
            const region = countryToRegion(countryId);
            if (region) onRegionClick(region);
          }
        }
      }
    }
    pointerDownRef.current = null;
    pausedRef.current = false;
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full cursor-grab active:cursor-grabbing select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => { setHoveredCountry(0); }}
    >
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}

function SandboxHero({
  progress, features, onRegionClick,
}: {
  progress: number;
  features: Feature<Geometry>[];
  onRegionClick: (r: Region) => void;
}) {
  const [hoveredCountry, setHoveredCountry] = useState(0);
  const headlineOpacity = clamp(1 - progress / 0.2, 0, 1);
  const headlineY = -progress * 40;
  const hintOpacity = clamp(1 - (progress - 0.45) / 0.15, 0, 1);
  const hintProgress = Math.min(100, (progress / 0.55) * 100);

  const rotate = clamp((progress - 0.18) / 0.35, 0, 1);
  const scrollPhi = rotate * 0.6;

  const zoom = clamp((progress - 0.45) / 0.55, 0, 1);
  const globeScale = 1 + zoom * 1.6;
  const globeOpacity = 1 - clamp((progress - 0.6) / 0.25, 0, 1);
  const bgOpacity = 1 - clamp((progress - 0.55) / 0.4, 0, 1);
  const inactive = progress > 0.96;

  const stats = useMemo(() => {
    let totalUnits = 0;
    for (const f of ALL_HOUSING_PROJECTS) totalUnits += f.unitCount ?? 0;
    return { total: ALL_HOUSING_PROJECTS.length, totalUnits };
  }, []);

  const hoveredFeature = hoveredCountry > 0 ? features[hoveredCountry - 1] : null;
  const hoveredName = hoveredFeature ? String((hoveredFeature.properties as { name?: string } | null)?.name ?? "—") : "—";

  return (
    <section
      className="fixed inset-0 z-20 overflow-hidden"
      style={{ pointerEvents: inactive ? "none" : "auto" }}
      aria-hidden={inactive}
    >
      <div className="absolute inset-0 bg-bg" style={{ opacity: bgOpacity }} />

      <div
        className="absolute inset-x-0 top-[24vh] md:top-[18vh] z-0 px-6 text-center pointer-events-none"
        style={{
          opacity: headlineOpacity,
          transform: `translateY(${headlineY}px)`,
          willChange: "transform, opacity",
        }}
      >
        <h1 className="text-3xl sm:text-5xl md:text-6xl font-semibold tracking-tight text-ink leading-[1.1] md:leading-[1.05]">
          Tracking AI policies
          <br />in your hometown
        </h1>
      </div>

      <div
        className="absolute bottom-6 left-6 z-20 flex items-center gap-6 text-ink"
        style={{ opacity: clamp(1 - (progress - 0.45) / 0.2, 0, 1) }}
      >
        <div>
          <div className="text-xs text-muted tracking-tight">Projects</div>
          <div className="text-xl md:text-2xl font-semibold tabular-nums">
            <NumberFlow value={stats.total} />
          </div>
        </div>
        <div>
          <div className="text-xs text-muted tracking-tight">Total units</div>
          <div className="text-xl md:text-2xl font-semibold tabular-nums">
            <NumberFlow value={stats.totalUnits} />
          </div>
        </div>
      </div>

      <div
        className="absolute inset-x-0 top-[40vh] z-10 flex justify-center"
        style={{
          opacity: globeOpacity,
          transform: `scale(${globeScale})`,
          transformOrigin: "center center",
          visibility: globeOpacity <= 0.01 ? "hidden" : "visible",
          willChange: "transform, opacity",
        }}
      >
        <div className="w-[78vh] h-[78vh] aspect-square">
          <ForkedGlobe
            features={features}
            scrollPhiOffset={scrollPhi}
            onRegionClick={onRegionClick}
            hoveredCountry={hoveredCountry}
            setHoveredCountry={setHoveredCountry}
          />
        </div>
      </div>

      <div className="absolute top-4 left-4 z-30 text-[11px] font-mono text-ink/70 bg-white/70 backdrop-blur px-3 py-1.5 rounded-full border border-black/10">
        hover: <span className="font-semibold text-ink">{hoveredName}</span>
      </div>

      <div
        className="absolute inset-x-0 bottom-[5.5vh] z-20 flex flex-col items-center gap-2.5 pointer-events-none"
        style={{ opacity: hintOpacity }}
        aria-hidden
      >
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-ink tracking-tight">Hover any country · Scroll to reveal</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-ink" style={{ animation: "scroll-hint 1.8s ease-in-out infinite" }}>
            <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="relative w-40 h-[2px] rounded-full bg-ink/10 overflow-hidden">
          <div className="absolute inset-y-0 left-0 rounded-full bg-ink" style={{ width: `${hintProgress}%` }} />
        </div>
      </div>
    </section>
  );
}

export default function SandboxCobeHeroPage() {
  const progress = useScrollProgress();
  const [dimension, setDimension] = useState<Dimension>("overall");
  const [lens, setLens] = useState<DimensionLens>("zoning");
  const [features, setFeatures] = useState<Feature<Geometry>[]>([]);
  const navigateRef = useRef<((t: ViewTarget) => void) | null>(null);

  // Load world countries once
  useEffect(() => {
    (async () => {
      const res = await fetch(WORLD_URL);
      const topology = (await res.json()) as TopoCountries;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fc = topojson.feature(topology as any, (topology.objects as any).countries) as unknown as FeatureCollection<Geometry>;
      setFeatures(fc.features);
    })();
  }, []);

  const handleRegionClick = (region: Region) => {
    navigateRef.current?.({ region, naView: "countries", selectedGeoId: null });
  };

  return (
    <>
      <MapShell
        revealProgress={progress}
        dimension={dimension}
        lens={lens}
        navigateRef={navigateRef}
      />
      <SandboxHero progress={progress} features={features} onRegionClick={handleRegionClick} />
      <div className="h-[400vh]" aria-hidden />

      <section className="relative z-10 bg-white border-t border-black/[.06]">
        <div className="max-w-5xl mx-auto px-8 pt-20 pb-16">
          <div className="text-[13px] font-medium text-muted tracking-tight mb-2">sandbox · forked cobe · per-country tint</div>
          <h2 className="text-3xl md:text-4xl font-semibold text-ink tracking-tight leading-[1.1] mb-10">State of US policy</h2>
          <SummaryBar lens={lens} />
          <div className="mt-12">
            <DimensionToggle dimension={dimension} onChange={setDimension} lens={lens} onLensChange={setLens} />
          </div>
          <p className="text-xs text-muted mt-10">
            <Link href="/" className="underline decoration-muted/40 underline-offset-4 hover:text-ink">← back to real homepage</Link>
          </p>
        </div>
      </section>
    </>
  );
}

"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import createGlobe from "cobe";
import Link from "next/link";
import NumberFlow from "@number-flow/react";
import { ALL_HOUSING_PROJECTS } from "@/lib/projects-map";
import type { HousingProject } from "@/types";

const { PI, sin, cos } = Math;
const GLOBE_R = 0.8;

function latLonTo3D([lat, lon]: [number, number]): [number, number, number] {
  const latRad = (lat * PI) / 180;
  const lonRad = (lon * PI) / 180 - PI;
  const cosLat = cos(latRad);
  return [-cosLat * cos(lonRad), sin(latRad), cosLat * sin(lonRad)];
}

function projectMarker(
  location: [number, number],
  phi: number,
  theta: number,
  elevation: number,
  scale: number = 1,
): { x: number; y: number; visible: boolean } {
  const pos3D = latLonTo3D(location);
  const r = GLOBE_R + elevation;
  const p: [number, number, number] = [pos3D[0] * r, pos3D[1] * r, pos3D[2] * r];

  const cx = cos(theta), cy = cos(phi), sx = sin(theta), sy = sin(phi);
  const rx = cy * p[0] + sy * p[2];
  const ry = sy * sx * p[0] + cx * p[1] - cy * sx * p[2];
  const rz = -sy * cx * p[0] + sx * p[1] + cy * cx * p[2];

  return {
    x: (rx * scale + 1) / 2,
    y: (-ry * scale + 1) / 2,
    visible: rz >= 0 || rx * rx + ry * ry >= 0.64,
  };
}

const STATUS_LABEL: Record<HousingProject["status"], string> = {
  operational: "Operational",
  "under-construction": "Under construction",
  proposed: "Proposed",
};

function formatUnits(count: number | undefined): string | null {
  if (!count) return null;
  return `${count.toLocaleString()} units`;
}

function formatCost(n: number | undefined): string | null {
  if (!n) return null;
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  return `$${n}`;
}

function stripConfidence(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return s.replace(/\s*#\w+/g, "").trim();
}

interface GlobeMarker {
  id: string;
  location: [number, number];
  size: number;
  totalUnits: number;
  count: number;
  project: HousingProject;
}

const LABEL_PAD_X = 80;
const LABEL_PAD_Y = 22;
const MIN_SCALE = 1;
const MAX_SCALE = 3.5;
const ZOOM_SPEED = 0.002;

function clusterProjectsGlobe(projects: HousingProject[], cellDeg: number): GlobeMarker[] {
  const buckets = new Map<string, HousingProject[]>();
  for (const f of projects) {
    // Skip projects without geocoded coords. They still appear in tables
    // and side panels, but the globe needs lat/lng to plot them.
    if (typeof f.lat !== "number" || typeof f.lng !== "number") continue;
    const key = `${Math.round(f.lat / cellDeg)}|${Math.round(f.lng / cellDeg)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(f);
    buckets.set(key, bucket);
  }
  const markers: GlobeMarker[] = [];
  for (const [, bucket] of buckets) {
    let repr = bucket[0];
    let sumLat = 0, sumLng = 0, totalUnits = 0;
    for (const f of bucket) {
      sumLat += f.lat ?? 0;
      sumLng += f.lng ?? 0;
      totalUnits += f.unitCount ?? 0;
      if ((f.unitCount ?? 0) > (repr.unitCount ?? 0)) repr = f;
    }
    const size = totalUnits > 500 ? 0.045 : totalUnits > 100 ? 0.03 : 0.018;
    markers.push({
      id: `dc-${repr.id}`,
      location: [sumLat / bucket.length, sumLng / bucket.length],
      size, totalUnits, count: bucket.length, project: repr,
    });
  }
  markers.sort((a, b) => b.totalUnits - a.totalUnits);
  return markers;
}

function StatusLoader() {
  return (
    <svg width="10" height="8" viewBox="0 0 10 8" className="shrink-0">
      <rect x="0" y="1" width="2" height="6" rx="0.5" fill="#FF9500">
        <animate attributeName="opacity" values="0.3;1;0.3" dur="1s" repeatCount="indefinite" begin="0s" />
      </rect>
      <rect x="4" y="0" width="2" height="8" rx="0.5" fill="#FF9500">
        <animate attributeName="opacity" values="0.3;1;0.3" dur="1s" repeatCount="indefinite" begin="0.2s" />
      </rect>
      <rect x="8" y="2" width="2" height="4" rx="0.5" fill="#FF9500">
        <animate attributeName="opacity" values="0.3;1;0.3" dur="1s" repeatCount="indefinite" begin="0.4s" />
      </rect>
    </svg>
  );
}

export default function GlobePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const phiRef = useRef(0);
  const isPausedRef = useRef(false);
  const pointerDown = useRef<{ x: number; y: number } | null>(null);
  const dragOffset = useRef({ phi: 0, theta: 0 });
  const phiOffset = useRef(0);
  const thetaOffset = useRef(0);
  const scaleRef = useRef(1);
  const scaleTargetRef = useRef(1);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const labelRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const [selectedProject, setSelectedProject] = useState<HousingProject | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerOpenRef = useRef(false);
  const [statsReady, setStatsReady] = useState(false);

  const markers = useMemo(() => clusterProjectsGlobe(ALL_HOUSING_PROJECTS, 4), []);

  const topIds = useMemo(() => {
    const GEO_CELL = 40;
    const regions = new Map<string, GlobeMarker>();
    for (const m of markers) {
      const key = `${Math.round(m.location[0] / GEO_CELL)}|${Math.round(m.location[1] / GEO_CELL)}`;
      const existing = regions.get(key);
      if (!existing || m.totalUnits > existing.totalUnits) {
        regions.set(key, m);
      }
    }
    return new Set(Array.from(regions.values()).map((m) => m.id));
  }, [markers]);

  const handleSelectProject = useCallback((project: HousingProject) => {
    setSelectedProject(project);
    setDrawerOpen(true);
    drawerOpenRef.current = true;
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerDown.current = { x: e.clientX, y: e.clientY };
    isPausedRef.current = true;
    if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
  }, []);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (pointerDown.current) {
      const dx = e.clientX - pointerDown.current.x;
      const dy = e.clientY - pointerDown.current.y;
      const s = scaleRef.current;
      dragOffset.current = { phi: dx / (200 * s), theta: dy / (600 * s) };
    }
  }, []);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * ZOOM_SPEED;
    scaleTargetRef.current = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scaleTargetRef.current * (1 + delta)));
    isPausedRef.current = true;
    clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = setTimeout(() => {
      if (!pointerDown.current) isPausedRef.current = false;
    }, 800);
  }, []);

  const lastPinchDist = useRef<number | null>(null);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (lastPinchDist.current !== null) {
        const delta = (dist - lastPinchDist.current) * 0.005;
        scaleTargetRef.current = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scaleTargetRef.current * (1 + delta)));
      }
      lastPinchDist.current = dist;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    lastPinchDist.current = null;
  }, []);

  const handlePointerUp = useCallback(() => {
    if (pointerDown.current) {
      phiOffset.current += dragOffset.current.phi;
      thetaOffset.current += dragOffset.current.theta;
      dragOffset.current = { phi: 0, theta: 0 };
    }
    pointerDown.current = null;
    isPausedRef.current = false;
    if (canvasRef.current) canvasRef.current.style.cursor = "grab";
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", handlePointerUp, { passive: true });
    const container = containerRef.current;
    if (container) {
      container.addEventListener("wheel", handleWheel, { passive: false });
      container.addEventListener("touchmove", handleTouchMove, { passive: false });
      container.addEventListener("touchend", handleTouchEnd, { passive: true });
    }
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      if (container) {
        container.removeEventListener("wheel", handleWheel);
        container.removeEventListener("touchmove", handleTouchMove);
        container.removeEventListener("touchend", handleTouchEnd);
      }
    };
  }, [handlePointerMove, handlePointerUp, handleWheel, handleTouchMove, handleTouchEnd]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const width = canvas.offsetWidth;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const elevation = 0.02;

    const globe = createGlobe(canvas, {
      devicePixelRatio: dpr, width, height: width,
      phi: 0, theta: 0.15, dark: 1, diffuse: 1.2,
      mapSamples: 20000, mapBrightness: 6,
      baseColor: [0.3, 0.3, 0.3],
      markerColor: [0.04, 0.52, 1],
      glowColor: [0.05, 0.05, 0.08],
      markers: [], markerElevation: elevation, opacity: 0.9,
    });

    let animId: number;
    function animate() {
      if (!isPausedRef.current && !drawerOpenRef.current) {
        phiRef.current += 0.003;
      }

      scaleRef.current += (scaleTargetRef.current - scaleRef.current) * 0.12;
      const currentScale = scaleRef.current;

      const currentPhi = phiRef.current + phiOffset.current + dragOffset.current.phi;
      const thetaRange = 0.4 + (currentScale - 1) * 0.3;
      const currentTheta = Math.max(
        -thetaRange,
        Math.min(thetaRange, 0.15 + thetaOffset.current + dragOffset.current.theta),
      );
      globe.update({ phi: currentPhi, theta: currentTheta, scale: currentScale });

      const containerW = canvas.offsetWidth;
      const placed: { x: number; y: number }[] = [];
      for (const m of markers) {
        const el = labelRefs.current.get(m.id);
        if (!el) continue;
        const pos = projectMarker(m.location, currentPhi, currentTheta, elevation, currentScale);
        el.style.left = `${pos.x * 100}%`;
        el.style.top = `${pos.y * 100}%`;

        const onScreen = pos.x > -0.05 && pos.x < 1.05 && pos.y > -0.05 && pos.y < 1.05;
        const isTop = topIds.has(m.id);
        let hide = !pos.visible || !onScreen;
        if (!hide && isTop) {
          for (const p of placed) {
            if (
              Math.abs(pos.x * containerW - p.x * containerW) < LABEL_PAD_X &&
              Math.abs(pos.y * containerW - p.y * containerW) < LABEL_PAD_Y
            ) {
              hide = true;
              break;
            }
          }
          if (!hide) placed.push(pos);
        }

        el.style.opacity = hide ? "0" : "1";
        el.style.filter = hide ? "blur(6px)" : "none";
      }

      animId = requestAnimationFrame(animate);
    }
    animate();

    setStatsReady(true);

    return () => {
      cancelAnimationFrame(animId);
      globe.destroy();
      setStatsReady(false);
    };
  }, [markers]);

  const developer = selectedProject && (stripConfidence(selectedProject.developer) ?? selectedProject.developer);
  const units = selectedProject && formatUnits(selectedProject.unitCount);
  const cost = selectedProject && formatCost(selectedProject.projectCost);

  const details: { label: string; value: string }[] = [];
  if (selectedProject) {
    if (selectedProject.projectType) details.push({ label: "Project type", value: selectedProject.projectType });
    if (units) details.push({ label: "Units", value: units });
    if (selectedProject.affordableUnits) details.push({ label: "Affordable units", value: String(selectedProject.affordableUnits) });
    if (cost) details.push({ label: "Project cost", value: cost });
    if (selectedProject.yearCompleted)
      details.push({ label: "Completed", value: String(selectedProject.yearCompleted) });
    else if (selectedProject.yearProposed)
      details.push({ label: "Proposed", value: String(selectedProject.yearProposed) });
    if (selectedProject.country) details.push({ label: "Country", value: selectedProject.country });
    if (selectedProject.state) details.push({ label: "State", value: selectedProject.state });
    if (selectedProject.location) details.push({ label: "Address", value: selectedProject.location });
  }

  const stats = useMemo(() => {
    let totalUnits = 0;
    for (const f of ALL_HOUSING_PROJECTS) totalUnits += f.unitCount ?? 0;
    return { total: ALL_HOUSING_PROJECTS.length, totalUnits };
  }, []);

  return (
    <div className="h-dvh w-screen overflow-hidden bg-[#0a0a0c] relative flex font-sans touch-none">
      <div className={`flex-1 relative flex justify-center overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${drawerOpen ? "items-start pt-10 md:pt-0 md:items-center md:pr-[380px]" : "items-center"}`}>
        <Link
          href="/#projects"
          className="absolute top-3 left-3 md:top-6 md:left-6 z-20 inline-flex items-center gap-1.5 text-xs md:text-sm text-white/50 hover:text-white/80 transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M7.5 2L3.5 6L7.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          TrackPolicy
        </Link>

        <div className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 md:bottom-6 md:left-6 z-20 flex items-center gap-5 md:gap-6">
          <div>
            <div className="text-xs text-white/40 tracking-tight">Projects</div>
            <div className="text-xl md:text-2xl font-semibold text-white/90 tabular-nums">
              <NumberFlow value={statsReady ? stats.total : 0} />
            </div>
          </div>
          <div>
            <div className="text-xs text-white/40 tracking-tight">Total units</div>
            <div className="text-xl md:text-2xl font-semibold text-white/90 tabular-nums">
              <NumberFlow value={statsReady ? stats.totalUnits : 0} />
            </div>
          </div>
        </div>

        {/* Globe + labels */}
        <div ref={containerRef} className="globe-markers-container w-full max-w-[720px] aspect-square relative">
          <canvas
            ref={canvasRef}
            className="w-full h-full cursor-grab"
            onPointerDown={handlePointerDown}
          />

          {markers.map((m) => {
            const name = stripConfidence(m.project.developer) ?? "Unknown";
            const unitLabel = m.totalUnits ? `${m.totalUnits.toLocaleString()} units` : null;
            const markerColor = m.project.status === "proposed" ? "bg-[#BF5AF2]" : m.project.status === "under-construction" ? "bg-[#FF9500]" : "bg-[#0A84FF]";
            const isTop = topIds.has(m.id);
            return (
              <div
                key={m.id}
                ref={(el) => { if (el) labelRefs.current.set(m.id, el); else labelRefs.current.delete(m.id); }}
                className="globe-marker absolute z-10 -translate-x-1/2 -translate-y-1/2 pointer-events-auto cursor-pointer"
                onMouseEnter={() => { isPausedRef.current = true; }}
                onMouseLeave={() => { if (!pointerDown.current) isPausedRef.current = false; }}
                onClick={() => handleSelectProject(m.project)}
              >
                <div className={`globe-marker-icon w-[14px] h-[14px] rounded-full ${markerColor} border-2 border-white shadow-[0_1px_4px_rgba(0,0,0,0.35)]`} />
                <div className="absolute -inset-3 md:hidden" />
                <div
                  className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 pointer-events-none transition-all duration-150 ${
                    isTop ? "hidden md:block opacity-100 scale-100" : "globe-marker-tooltip opacity-0 scale-95"
                  }`}
                >
                  <div
                    className="globe-marker-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#1D1D1F] text-white/90 shadow-lg whitespace-nowrap"
                    style={{ fontSize: "11px", letterSpacing: "-0.01em" }}
                  >
                    <span className="font-medium tracking-tight truncate">{name}</span>
                    {unitLabel && <span className="text-white/50 shrink-0">{unitLabel}</span>}
                    <span className="globe-marker-cta text-white/30 shrink-0">↗</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="absolute bottom-3 right-3 md:bottom-6 md:right-6 z-20 text-[11px] text-white/25 tracking-tight hidden md:block">
          Drag to rotate · Scroll to zoom · Click to inspect
        </div>
      </div>

      {/* Drawer: bottom sheet on mobile, right sidebar on desktop */}
      <div
        className={`absolute z-30 bg-[#141416] shadow-[0_-8px_32px_rgba(0,0,0,0.4)] md:shadow-[-8px_0_32px_rgba(0,0,0,0.4)] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] flex flex-col bottom-0 left-0 right-0 max-h-[70vh] rounded-t-2xl border-t border-white/8 md:rounded-none md:border-t-0 md:border-l md:border-white/8 md:top-0 md:left-auto md:right-0 md:bottom-0 md:max-h-full md:h-full md:w-[380px] md:max-w-[90vw] ${drawerOpen && selectedProject ? "translate-y-0 md:translate-x-0" : "translate-y-full md:translate-y-0 md:translate-x-full"}`}
      >
        {selectedProject && (
          <>
            <div className="flex justify-center pt-2 pb-0 md:hidden">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>
            <div className="px-6 pt-4 md:pt-5 pb-4 border-b border-white/8 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold text-white tracking-tight leading-tight truncate">{developer}</h2>
                <div className="mt-1.5 flex items-center gap-2 text-xs text-white/50">
                  {selectedProject.status === "under-construction" ? (
                    <StatusLoader />
                  ) : (
                    <span className={`inline-block w-[6px] h-[6px] rounded-full shrink-0 ${selectedProject.status === "proposed" ? "bg-[#BF5AF2]" : "bg-[#0A84FF]"}`} />
                  )}
                  <span>{STATUS_LABEL[selectedProject.status]}</span>
                  {units && (
                    <>
                      <span aria-hidden className="text-white/20">·</span>
                      <span>{units}</span>
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() => { setDrawerOpen(false); drawerOpenRef.current = false; setTimeout(() => setSelectedProject(null), 300); }}
                className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[.08] transition-colors"
                aria-label="Close"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="p-6 flex flex-col gap-5">
                {selectedProject.notes && (
                  <p className="text-[13px] text-white/60 leading-relaxed">{selectedProject.notes}</p>
                )}
                {details.length > 0 && (
                  <dl className="flex flex-col">
                    {details.map((d, i) => (
                      <div key={d.label} className={`flex items-start justify-between gap-4 py-2.5 text-[13px] ${i === 0 ? "" : "border-t border-white/[.06]"}`}>
                        <dt className="text-white/40 shrink-0">{d.label}</dt>
                        <dd className="text-white/90 font-medium text-right tracking-tight">{d.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {selectedProject.concerns && selectedProject.concerns.length > 0 && (
                  <div>
                    <h3 className="text-[13px] font-medium text-white/80 mb-2">Community concerns</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedProject.concerns.map((c) => (
                        <span key={c} className="text-[11px] px-2 py-1 rounded-full bg-white/[.06] text-white/60 tracking-tight">
                          {c.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-white/30 pt-2">
                  Sourced from public records
                </p>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-white/[.06] pb-[max(1rem,env(safe-area-inset-bottom))]">
              <Link href="/projects" className="text-[13px] text-white/40 hover:text-white/80 transition-colors">
                View all projects →
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import StaticAdapter from "@/components/map/sandbox/StaticAdapter";
import ZoomableSvgMap from "@/components/map/sandbox/ZoomableSvgMap";
import GLMap from "@/components/map/sandbox/GLMap";
import CountyMap from "@/components/map/CountyMap";
import { configFor, type SandboxView } from "@/components/map/sandbox/configs";
import type { Dimension, DimensionLens, Region } from "@/types";
import { REGION_LABEL } from "@/types";
import type { TooltipState } from "@/lib/map-utils";

const REGIONS: Region[] = ["na", "eu", "asia"];
const DIMENSIONS: Dimension[] = [
  "overall",
  "environmental",
  "supply",
  "community-impact",
];

export default function MapSandboxPage() {
  const [view, setView] = useState<SandboxView>({ kind: "region", region: "na" });
  const [dimension, setDimension] = useState<Dimension>("overall");
  const [lens] = useState<DimensionLens>("zoning");
  const [showDCs, setShowDCs] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [, setTooltip] = useState<TooltipState | null>(null);

  const config = useMemo(() => configFor(view), [view]);

  const onDrill = (target: SandboxView) => {
    setView(target);
    setSelected(null);
  };

  const viewLabel =
    view.kind === "us-states"
      ? "US · states"
      : view.kind === "counties"
        ? `US · ${view.state} · counties`
        : REGION_LABEL[view.region];
  const viewKey =
    view.kind === "us-states"
      ? "us-states"
      : view.kind === "counties"
        ? `counties-${view.state}`
        : view.region;

  return (
    <main className="min-h-dvh bg-[#F5F3EE] text-neutral-900">
      <div className="max-w-[1800px] mx-auto px-6 py-6">
        <header className="mb-6 space-y-3">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-lg font-medium">Map sandbox</h1>
            <p className="text-sm text-neutral-500">
              Three renderers × three regions. Double-click a US state to
              drill.
            </p>
          </div>

          <div className="flex items-center gap-6 flex-wrap">
            {/* Region tabs */}
            <div className="flex gap-1 p-0.5 bg-white rounded-md border border-neutral-200 text-sm">
              {REGIONS.map((r) => {
                const active =
                  view.kind === "region" && view.region === r;
                return (
                  <button
                    key={r}
                    onClick={() => {
                      setView({ kind: "region", region: r });
                      setSelected(null);
                    }}
                    className={`px-3 py-1 rounded transition ${
                      active
                        ? "bg-black text-white"
                        : "text-neutral-600 hover:text-neutral-900"
                    }`}
                  >
                    {REGION_LABEL[r]}
                  </button>
                );
              })}
            </div>

            {/* Breadcrumb / back */}
            {view.kind === "us-states" && (
              <button
                onClick={() => setView({ kind: "region", region: "na" })}
                className="text-sm text-neutral-600 hover:text-neutral-900 underline"
              >
                ← back to North America
              </button>
            )}
            {view.kind === "counties" && (
              <div className="text-sm flex items-center gap-2">
                <button
                  onClick={() => setView({ kind: "region", region: "na" })}
                  className="text-neutral-500 hover:text-neutral-900 underline"
                >
                  North America
                </button>
                <span className="text-neutral-400">/</span>
                <button
                  onClick={() => setView({ kind: "us-states" })}
                  className="text-neutral-500 hover:text-neutral-900 underline"
                >
                  US states
                </button>
                <span className="text-neutral-400">/</span>
                <span className="text-neutral-900">{view.state}</span>
              </div>
            )}

            {/* Dimension */}
            <div className="flex gap-1 p-0.5 bg-white rounded-md border border-neutral-200 text-sm">
              {DIMENSIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDimension(d)}
                  className={`px-3 py-1 rounded transition ${
                    dimension === d
                      ? "bg-black text-white"
                      : "text-neutral-600 hover:text-neutral-900"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>

            <label className="text-sm flex items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={showDCs}
                onChange={(e) => setShowDCs(e.target.checked)}
              />
              projects
            </label>

            {selected && (
              <div className="text-sm text-neutral-600 flex items-center gap-2">
                <span>
                  selected:{" "}
                  <span className="text-neutral-900">{selected}</span>
                </span>
                <button
                  className="text-neutral-500 hover:text-neutral-900 underline"
                  onClick={() => setSelected(null)}
                >
                  clear
                </button>
              </div>
            )}

            <div className="ml-auto text-xs text-neutral-500">
              <kbd className="px-1 bg-white border rounded">↑↓←→</kbd> pan ·{" "}
              <kbd className="px-1 bg-white border rounded">scroll</kbd> pan ·{" "}
              <kbd className="px-1 bg-white border rounded">⌘/ctrl + scroll</kbd>{" "}
              zoom · <kbd className="px-1 bg-white border rounded">dbl-click</kbd>{" "}
              drill
            </div>
          </div>

          <div className="text-xs text-neutral-500">
            Current view: <span className="text-neutral-800">{viewLabel}</span>
          </div>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {view.kind === "counties" ? (
            <>
              <Panel title="Static" subtitle="CountyMap">
                <CountyMap
                  key={viewKey + "-a"}
                  stateName={view.state}
                  onSelectCounty={setSelected}
                  selectedCountyFips={selected}
                  setTooltip={setTooltip}
                  showDataCenters={showDCs}
                />
              </Panel>
              <Panel
                title="SVG · zoomable"
                subtitle="CountyMap (shared at county level)"
              >
                <CountyMap
                  key={viewKey + "-b"}
                  stateName={view.state}
                  onSelectCounty={setSelected}
                  selectedCountyFips={selected}
                  setTooltip={setTooltip}
                  showDataCenters={showDCs}
                />
              </Panel>
              <Panel
                title="MapLibre GL"
                subtitle="CountyMap (shared at county level)"
              >
                <CountyMap
                  key={viewKey + "-c"}
                  stateName={view.state}
                  onSelectCounty={setSelected}
                  selectedCountyFips={selected}
                  setTooltip={setTooltip}
                  showDataCenters={showDCs}
                />
              </Panel>
            </>
          ) : config ? (
            <>
              <Panel title="Static" subtitle="react-simple-maps (current)">
                <StaticAdapter
                  key={viewKey}
                  view={view}
                  onSelectEntity={setSelected}
                  onDrill={onDrill}
                  selectedGeoId={selected}
                  setTooltip={setTooltip}
                  dimension={dimension}
                  lens={lens}
                  showDataCenters={showDCs}
                />
              </Panel>

              <Panel
                title="SVG · zoomable"
                subtitle="arrows, swipe, pinch, dbl-click"
              >
                <ZoomableSvgMap
                  key={viewKey}
                  config={config}
                  onSelectEntity={setSelected}
                  onDrill={onDrill}
                  selectedGeoId={selected}
                  setTooltip={setTooltip}
                  dimension={dimension}
                  lens={lens}
                  showDataCenters={showDCs}
                  onHoverFacility={() => {}}
                  onLeaveFacility={() => {}}
                  onSelectFacility={() => {}}
                />
              </Panel>

              <Panel title="MapLibre GL" subtitle="WebGL · clustered points">
                <GLMap
                  key={viewKey}
                  config={config}
                  onSelectEntity={setSelected}
                  onDrill={onDrill}
                  selectedGeoId={selected}
                  setTooltip={setTooltip}
                  dimension={dimension}
                  lens={lens}
                  showDataCenters={showDCs}
                  onHoverFacility={() => {}}
                  onLeaveFacility={() => {}}
                  onSelectFacility={() => {}}
                />
              </Panel>
            </>
          ) : null}
        </div>

        <footer className="mt-8 max-w-3xl text-sm text-neutral-600 space-y-2">
          <p>
            Panels share region, selection, dimension, DC toggle, and drill
            state. Dbl-click a US state in the NA view to drill into the
            US states map.
          </p>
          <p className="text-xs text-neutral-500">
            County drill is omitted from the sandbox — the existing CountyMap
            is the right follow-up if we decide to ship this pattern.
          </p>
        </footer>
      </div>
    </main>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col min-w-0">
      <div className="mb-2 flex items-baseline gap-2 min-w-0">
        <h2 className="text-sm font-medium text-neutral-900 truncate">
          {title}
        </h2>
        <span className="text-xs text-neutral-500 truncate">{subtitle}</span>
      </div>
      <div className="aspect-[16/11] bg-white rounded-lg border border-neutral-200 overflow-hidden shadow-sm">
        {children}
      </div>
    </section>
  );
}

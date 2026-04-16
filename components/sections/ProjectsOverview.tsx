"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import {
  IMPACT_TAG_LABEL,
  STATE_FIPS,
  type HousingProject,
  type HousingProjectStatus,
  type ImpactTag,
  type ViewTarget,
} from "@/types";
import { ALL_HOUSING_PROJECTS } from "@/lib/projects-map";
import { statusColorForProject } from "@/lib/project-colors";
import FadeInOnView from "@/components/ui/FadeInOnView";
import ProjectCard from "./ProjectCard";

interface ProjectsOverviewProps {
  onNavigateToEntity: (target: ViewTarget) => void;
  /** Render every filtered project — used on the dedicated /projects page. */
  showAll?: boolean;
}

type StatusFilter = "all" | HousingProjectStatus;
type SortKey = "relevance" | "units" | "cost" | "developer" | "state";
type RegionScope = "all" | "na" | "eu" | "asia";

const REGION_OPTIONS: { key: RegionScope; label: string }[] = [
  { key: "all", label: "All regions" },
  { key: "na", label: "North America" },
  { key: "eu", label: "Europe" },
  { key: "asia", label: "Asia-Pacific" },
];

/** Classify a project's region from its country field. Europe/Asia
 *  projects land with the 2-letter country code from the pipeline; we
 *  map those to the region buckets used by the switcher. */
function projectRegion(project: HousingProject): RegionScope {
  const country = project.country ?? "";
  if (country === "Canada" || country === "United States") return "na";
  if (
    [
      "United Kingdom", "Germany", "France", "Italy", "Spain", "Poland",
      "Netherlands", "Sweden", "Finland", "Ireland", "European Parliament",
    ].includes(country)
  ) return "eu";
  if (
    ["Japan", "South Korea", "China", "India", "Indonesia", "Taiwan", "Australia"].includes(country)
  ) return "asia";
  return "all";
}
const STATUS_LABEL: Record<HousingProjectStatus, string> = {
  operational: "Operational",
  "under-construction": "Under construction",
  proposed: "Proposed",
};

const STATUS_FILTER_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "operational", label: "Operational" },
  { key: "under-construction", label: "Under construction" },
  { key: "proposed", label: "Proposed" },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "relevance", label: "Relevance" },
  { key: "units", label: "Units" },
  { key: "cost", label: "Investment" },
  { key: "developer", label: "Developer" },
  { key: "state", label: "Location" },
];

// Relevance ranks projects by how much we know about them combined
// with raw scale. Disclosed cost is the strongest signal — those are the
// publicly-announced flagship projects.
function relevanceScore(f: HousingProject): number {
  let s = 0;
  if (f.projectCost) s += 10000;
  if (f.affordableUnits) s += 4000;
  if (f.projectType) s += 800;
  s += Math.log10((f.unitCount ?? 1) + 1) * 200;
  return s;
}

function formatUnits(count: number | undefined): string {
  if (!count) return "—";
  return count.toLocaleString();
}

function formatCost(n: number | undefined): string {
  if (!n) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}

function formatAffordable(n: number | undefined): string {
  if (!n) return "—";
  return n.toLocaleString();
}

function stripConfidence(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return s.replace(/\s*#\w+/g, "").trim();
}

// Concerns are stored as kebab-case impact tags (or bespoke strings).
// Prefer the canonical IMPACT_TAG_LABEL, fall back to title-casing.
function prettyConcern(tag: string): string {
  return (
    IMPACT_TAG_LABEL[tag as ImpactTag] ??
    tag
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

interface Stat {
  label: string;
  value: string;
}

function buildStats(projects: HousingProject[]): Stat[] {
  const totalUnits = projects.reduce((acc, f) => acc + (f.unitCount ?? 0), 0);
  const totalCost = projects.reduce((acc, f) => acc + (f.projectCost ?? 0), 0);
  const totalAffordable = projects.reduce((acc, f) => acc + (f.affordableUnits ?? 0), 0);

  return [
    { label: "Tracked", value: projects.length.toLocaleString() },
    { label: "Total units", value: totalUnits.toLocaleString() },
    { label: "Investment", value: formatCost(totalCost) },
    { label: "Affordable units", value: formatAffordable(totalAffordable) },
  ];
}

function targetForProject(f: HousingProject): ViewTarget | null {
  if (f.country === "United States" && f.state && STATE_FIPS[f.state]) {
    return {
      region: "na",
      naView: "states",
      selectedGeoId: f.state,
    };
  }
  if (f.country) {
    if (f.country === "United States") {
      return { region: "na", naView: "countries", selectedGeoId: "840" };
    }
    return {
      region: "asia",
      naView: "countries",
      selectedGeoId: null,
    };
  }
  return null;
}

const PREVIEW_ROWS = 12;

export default function ProjectsOverview({
  onNavigateToEntity,
  showAll = false,
}: ProjectsOverviewProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("relevance");
  const [query, setQuery] = useState("");
  const [regionScope, setRegionScope] = useState<RegionScope>("all");
  // Row selection tints and expands the inline row.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Modal for the enriched ProjectCard, opened via the "Full detail" link
  // inside the expanded row. Separate state so the inline row behaviour
  // stays put when the modal opens.
  const [modalId, setModalId] = useState<string | null>(null);

  const disclosedCostCount = useMemo(
    () => ALL_HOUSING_PROJECTS.filter((f) => !!f.projectCost).length,
    [],
  );

  // Live counts for the status pills, keyed off the unfiltered set so the
  // numbers don't change as the user toggles between them.
  const statusCounts = useMemo<Record<StatusFilter, number>>(() => {
    const counts: Record<StatusFilter, number> = {
      all: ALL_HOUSING_PROJECTS.length,
      operational: 0,
      "under-construction": 0,
      proposed: 0,
    };
    for (const f of ALL_HOUSING_PROJECTS) counts[f.status] += 1;
    return counts;
  }, []);

  const filtered = useMemo(() => {
    const regionFiltered =
      regionScope === "all"
        ? ALL_HOUSING_PROJECTS
        : ALL_HOUSING_PROJECTS.filter((f) => projectRegion(f) === regionScope);
    const base =
      statusFilter === "all"
        ? regionFiltered
        : regionFiltered.filter((f) => f.status === statusFilter);
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((f) => {
      const haystack = [
        f.developer,
        f.projectType,
        f.location,
        f.state,
        f.country,
        f.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [statusFilter, query, regionScope]);

  // Per-region counts keyed off the unfiltered set so the chip numbers
  // don't move as the user filters other axes.
  const regionCounts = useMemo<Record<RegionScope, number>>(() => {
    const counts: Record<RegionScope, number> = { all: ALL_HOUSING_PROJECTS.length, na: 0, eu: 0, asia: 0 };
    for (const f of ALL_HOUSING_PROJECTS) {
      const r = projectRegion(f);
      if (r !== "all") counts[r] += 1;
    }
    return counts;
  }, []);

  // Stats roll up whatever the user has filtered into — so the headline
  // numbers reflect "what am I looking at right now" instead of staying
  // frozen on the whole dataset.
  const stats = useMemo(
    () => buildStats(filtered),
    [filtered],
  );

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      switch (sortKey) {
        case "relevance":
          return relevanceScore(b) - relevanceScore(a);
        case "units":
          return (b.unitCount ?? 0) - (a.unitCount ?? 0);
        case "cost":
          return (b.projectCost ?? 0) - (a.projectCost ?? 0);
        case "developer":
          return (a.developer ?? "").localeCompare(b.developer ?? "");
        case "state":
          return (a.state ?? a.country ?? "").localeCompare(
            b.state ?? b.country ?? "",
          );
      }
    });
    return copy;
  }, [filtered, sortKey]);

  const visible = showAll ? sorted : sorted.slice(0, PREVIEW_ROWS);
  const hasMore = !showAll && sorted.length > PREVIEW_ROWS;

  const modalProject = modalId ? ALL_HOUSING_PROJECTS.find((p) => p.id === modalId) ?? null : null;

  return (
    <div>
      {/* Region switcher — mirrors the PoliticiansOverview scope pattern.
          Keeps the US/Canada split local to projects without pulling in
          the heavy map-level region concept. */}
      <div className="flex flex-wrap gap-1.5 mb-6">
        {REGION_OPTIONS.map((opt) => {
          const active = regionScope === opt.key;
          const count = regionCounts[opt.key];
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => setRegionScope(opt.key)}
              className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                active
                  ? "bg-ink text-white"
                  : "bg-black/[.04] text-muted hover:bg-black/[.08] hover:text-ink"
              }`}
            >
              {opt.label}
              <span className={`ml-1.5 ${active ? "text-white/60" : "text-muted/70"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Stats strip — wide, dense, scannable. Each cell stands alone but
          the row reads as a single cohesive unit. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-6 gap-x-8 pb-8 mb-10 border-b border-black/[.06]">
        {stats.map((s, i) => (
          <FadeInOnView
            key={s.label}
            delay={i * 60}
            className="flex flex-col gap-2 min-w-0"
          >
            <div className="text-[11px] text-muted tracking-tight">
              {s.label}
            </div>
            <div className="text-[22px] font-semibold text-ink tracking-tight leading-none tabular-nums truncate">
              {s.value}
            </div>
          </FadeInOnView>
        ))}
      </div>

      {/* Search — free-text match over operator, user, location, and notes.
          Matches the LiveNews search pattern so the chrome feels unified. */}
      <div className="mb-6">
        <div className="max-w-md flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-white border border-black/[.06] focus-within:border-black/20 transition-colors">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            className="text-muted flex-shrink-0"
          >
            <circle
              cx="6"
              cy="6"
              r="4.5"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M9.5 9.5L12.5 12.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects…"
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none min-w-0"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="text-muted hover:text-ink flex-shrink-0"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M3 3L9 9M9 3L3 9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Status row — pill chips matching the legislation table's pattern. */}
      <div className="mb-4">
        <div className="text-[13px] font-medium text-muted tracking-tight mb-2">
          Status
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTER_OPTIONS.map((opt) => {
            const active = opt.key === statusFilter;
            const count = statusCounts[opt.key];
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setStatusFilter(opt.key)}
                className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] ${
                  active
                    ? "bg-ink text-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                    : "border border-black/[.06] text-muted hover:text-ink hover:bg-black/[.02]"
                }`}
              >
                <span>{opt.label}</span>
                <span
                  className={`text-[10px] ${active ? "text-white/70" : "text-muted"}`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sort row — same chip-and-dropdown pattern as the legislation
          section. The MW / GW unit toggle now lives on the Power column
          header itself, so the whole bar reads as one decision. */}
      <div className="flex items-center gap-2 mb-6">
        <span className="text-[13px] font-medium text-muted tracking-tight">
          Sort
        </span>
        <div className="relative">
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="appearance-none rounded-full bg-black/[.04] hover:bg-black/[.06] text-ink text-xs font-medium pl-3 pr-7 py-1.5 cursor-pointer transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted"
          >
            <path
              d="M2.5 3.75L5 6.25L7.5 3.75"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      {/* Table — clean rows, no card chrome. Row click takes you to the
          relevant region/state on the map. */}
      <div className="overflow-x-auto -mx-2">
        {/* border-separate lets individual row cells round + own their own
            background. border-spacing-0 keeps rows flush; the hairline
            between rows lives on the cells themselves. */}
        <table className="w-full min-w-[720px] text-sm border-separate border-spacing-0">
          <thead>
            <tr className="text-[11px] text-muted tracking-tight text-left">
              <th className="font-medium py-3 px-2">Project</th>
              <th className="font-medium py-3 px-2 hidden md:table-cell">Type</th>
              <th className="font-medium py-3 px-2">Units</th>
              <th className="font-medium py-3 px-2 hidden lg:table-cell">Cost</th>
              <th className="font-medium py-3 px-2 hidden lg:table-cell">Affordable</th>
              <th className="font-medium py-3 px-2">Location</th>
              <th className="font-medium py-3 px-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((f) => {
              const developer = stripConfidence(f.developer) ?? f.developer;
              const color = statusColorForProject(f.status);
              const isProposed = f.status === "proposed";
              const target = targetForProject(f);
              const location = f.state ?? f.country ?? "—";

              const isExpanded = selectedId === f.id;
              const concerns = f.concerns ?? [];
              const notes = stripConfidence(f.notes);
              const hasExpandedContent = concerns.length > 0 || !!notes;

              // Hover AND expanded states both wash the row grey + round
              // its outer corners into a pill. Expanded stays put so the
              // user can see what they opened even after the cursor
              // leaves; hover is the transient version.
              //
              // Border-top on every cell acts as the row separator under
              // border-separate. We clear it on the active row AND the
              // row right after it (via group-hover on next-sibling) so
              // the pill's rounded corners aren't cut by a hairline.
              // Transition border-radius too so the parent row's corner
               // switch (rounded-l-xl → rounded-tl-xl) animates in sync
               // with the expansion panel opening.
              const cellBase =
                "py-3.5 px-2 border-t border-black/[.05] transition-[background-color,border-color,border-top-left-radius,border-top-right-radius,border-bottom-left-radius,border-bottom-right-radius] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]";
              const rowBg = isExpanded
                ? "bg-black/[.05]"
                : "group-hover:bg-black/[.05]";
              // When the expansion below is going to render, round only
              // the TOP corners of the header row so the two rows fuse
              // into one continuous pill. Without this the row looks like
              // its own card and the expansion looks like a second one
              // floating underneath.
              const roundLeft = isExpanded
                ? hasExpandedContent
                  ? "rounded-tl-xl"
                  : "rounded-l-xl"
                : "group-hover:rounded-l-xl";
              const roundRight = isExpanded
                ? hasExpandedContent
                  ? "rounded-tr-xl"
                  : "rounded-r-xl"
                : "group-hover:rounded-r-xl";
              const clearTopBorder = isExpanded
                ? "border-transparent"
                : "group-hover:border-transparent";

              return (
                <Fragment key={f.id}>
                  <tr
                    onClick={() =>
                      setSelectedId((prev) => (prev === f.id ? null : f.id))
                    }
                    aria-expanded={isExpanded && hasExpandedContent}
                    className="group cursor-pointer"
                  >
                    <td className={`${cellBase} ${clearTopBorder} ${rowBg} ${roundLeft}`}>
                      {target ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onNavigateToEntity(target);
                          }}
                          className="text-left font-medium text-ink tracking-tight truncate max-w-[18rem] hover:underline decoration-muted/40 decoration-[0.5px] underline-offset-4 hover:decoration-ink"
                        >
                          {developer}
                        </button>
                      ) : (
                        <div className="font-medium text-ink tracking-tight truncate max-w-[18rem]">
                          {developer}
                        </div>
                      )}
                      <div className="text-[11px] text-muted truncate max-w-[18rem] mt-0.5">
                        {stripConfidence(f.location) ?? location}
                      </div>
                    </td>
                    <td className={`${cellBase} ${clearTopBorder} ${rowBg} text-muted hidden md:table-cell truncate max-w-[10rem]`}>
                      {f.projectType ?? "—"}
                    </td>
                    <td className={`${cellBase} ${clearTopBorder} ${rowBg} text-ink tabular-nums`}>
                      {formatUnits(f.unitCount)}
                    </td>
                    <td className={`${cellBase} ${clearTopBorder} ${rowBg} text-ink tabular-nums hidden lg:table-cell`}>
                      {formatCost(f.projectCost)}
                    </td>
                    <td className={`${cellBase} ${clearTopBorder} ${rowBg} text-ink tabular-nums hidden lg:table-cell`}>
                      {formatAffordable(f.affordableUnits)}
                    </td>
                    <td className={`${cellBase} ${clearTopBorder} ${rowBg} text-muted whitespace-nowrap`}>
                      {location}
                    </td>
                    <td className={`${cellBase} ${clearTopBorder} ${rowBg} ${roundRight}`}>
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-ink whitespace-nowrap">
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: isProposed ? "transparent" : color,
                            border: isProposed ? `1.25px solid ${color}` : "none",
                          }}
                        />
                        {STATUS_LABEL[f.status]}
                      </span>
                    </td>
                  </tr>

                  {/* Expanded detail — fractionally lighter wash than the
                      row header so the disclosure reads as nested content
                      (Apple grouped-table / iOS disclosure pattern), while
                      still fusing into one continuous pill via the flat
                      inner edges. Concerns chips get a matching bump to
                      stay visible against the lighter surface. */}
                  {hasExpandedContent && (
                    <tr>
                      <td colSpan={7} className="p-0">
                        {/* Accordion animation via the grid-template-rows
                            0fr ↔ 1fr trick — collapses to zero height with
                            no measurement needed. Bg + corner fade in step
                            with the height so the panel reads as growing
                            out of the row above. */}
                        <div
                          className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                          style={{
                            gridTemplateRows: isExpanded ? "1fr" : "0fr",
                          }}
                        >
                          <div className="min-h-0 overflow-hidden">
                            <div
                              className={`transition-[opacity,background-color,border-radius] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] px-2 pt-3 pb-4 ${
                                isExpanded
                                  ? "opacity-100 bg-black/[.025] rounded-b-xl"
                                  : "opacity-0 bg-transparent"
                              }`}
                            >
                              <div className="flex flex-col gap-3 max-w-prose pl-4">
                                {notes && (
                                  <p className="text-[12px] text-muted leading-relaxed">
                                    {notes}
                                  </p>
                                )}
                                {concerns.length > 0 && (
                                  <ul className="flex flex-wrap gap-1.5">
                                    {concerns.map((c) => (
                                      <li
                                        key={c}
                                        className="text-[11px] px-2 py-[3px] rounded-full border border-black/[.08] bg-white/70 text-ink/75 tracking-tight"
                                      >
                                        {prettyConcern(c)}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setModalId(f.id);
                                  }}
                                  className="self-start text-[11px] text-ink hover:underline"
                                >
                                  Full detail →
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {sorted.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm text-muted">
            No projects match your search.
          </p>
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-3 inline-block text-xs text-ink hover:underline"
            >
              Clear search
            </button>
          )}
        </div>
      )}

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <Link
            href="/projects"
            className="rounded-full border border-black/[.06] text-muted hover:text-ink px-5 py-2 text-xs font-medium transition-colors"
          >
            Show all {sorted.length} projects →
          </Link>
        </div>
      )}

      <p className="mt-6 text-[11px] text-muted/80 leading-relaxed">
        Cost and unit counts appear only when publicly disclosed.{" "}
        {disclosedCostCount} of {ALL_HOUSING_PROJECTS.length} projects
        {ALL_HOUSING_PROJECTS.length > 0
          ? ` (${Math.round((disclosedCostCount / ALL_HOUSING_PROJECTS.length) * 100)}%)`
          : ""}{" "}
        have an announced investment figure. Most private builds never publish
        a budget, so totals should be read as a floor rather than a full count.
      </p>

      {/* Enriched project modal. Opened by the "Full detail" link inside
          the inline expanded row. Uses a fixed-position overlay so the
          card sits above the table without pushing the page. */}
      {modalProject ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center px-4 py-12 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label={`Project detail: ${modalProject.projectName ?? modalProject.developer}`}
        >
          <button
            type="button"
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setModalId(null)}
            aria-label="Close"
          />
          <div className="relative z-10 w-full max-w-2xl">
            <ProjectCard project={modalProject} onClose={() => setModalId(null)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

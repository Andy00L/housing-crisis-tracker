"use client";

import type { HousingProject } from "@/types";
import { statusColorForProject } from "@/lib/project-colors";

interface ProjectsListProps {
  facilities: HousingProject[];
  /** What field to group the rows by. `null` renders a flat list. */
  groupBy: "state" | "country" | null;
  onSelectFacility?: (dc: HousingProject) => void;
}

function stripConfidence(s: string | undefined): string {
  return (s ?? "").replace(/\s*#\w+/g, "").trim();
}

function formatUnits(count: number | undefined): string | null {
  if (!count) return null;
  return `${count.toLocaleString()} units`;
}

const STATUS_LABEL: Record<HousingProject["status"], string> = {
  operational: "Operational",
  "under-construction": "Under construction",
  proposed: "Proposed",
};

function sortByUnitCountDesc(a: HousingProject, b: HousingProject): number {
  return (b.unitCount ?? 0) - (a.unitCount ?? 0);
}

function groupFacilities(
  facilities: HousingProject[],
  key: "state" | "country",
): Array<{ label: string; items: HousingProject[] }> {
  const map = new Map<string, HousingProject[]>();
  for (const f of facilities) {
    const k = (f[key] ?? "Unknown").toString();
    const list = map.get(k) ?? [];
    list.push(f);
    map.set(k, list);
  }
  // Sort groups by total unit count desc (bigger projects first).
  return Array.from(map.entries())
    .map(([label, items]) => ({
      label,
      items: items.slice().sort(sortByUnitCountDesc),
      total: items.reduce((s, f) => s + (f.unitCount ?? 0), 0),
    }))
    .sort((a, b) => b.total - a.total)
    .map(({ label, items }) => ({ label, items }));
}

function FacilityRow({
  facility,
  onSelect,
}: {
  facility: HousingProject;
  onSelect?: (dc: HousingProject) => void;
}) {
  const developer = stripConfidence(facility.developer) || "Housing project";
  const units = formatUnits(facility.unitCount);
  const color = statusColorForProject(facility.status);
  const isProposed = facility.status === "proposed";

  const clickable = !!onSelect;
  const Inner = (
    <>
      <span
        className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[7px]"
        style={{
          backgroundColor: isProposed ? "transparent" : color,
          border: isProposed ? `1.25px solid ${color}` : "none",
        }}
      />
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-medium text-ink tracking-tight truncate">
          {developer}
        </span>
        <span className="block text-[11px] text-muted truncate">
          {STATUS_LABEL[facility.status]}
          {units ? ` · ${units}` : ""}
        </span>
      </span>
    </>
  );

  if (clickable) {
    return (
      <button
        type="button"
        onClick={() => onSelect!(facility)}
        className="w-full flex items-start gap-2.5 py-2 px-2 -mx-2 rounded-lg text-left hover:bg-black/[.03] transition-colors"
      >
        {Inner}
      </button>
    );
  }
  return (
    <div className="flex items-start gap-2.5 py-2 px-2 -mx-2">{Inner}</div>
  );
}

export default function ProjectsList({
  facilities,
  groupBy,
  onSelectFacility,
}: ProjectsListProps) {
  if (facilities.length === 0) {
    return (
      <p className="text-xs text-muted">No projects tracked here yet.</p>
    );
  }

  if (!groupBy) {
    const sorted = facilities.slice().sort(sortByUnitCountDesc);
    return (
      <div className="flex flex-col">
        {sorted.map((f) => (
          <FacilityRow
            key={f.id}
            facility={f}
            onSelect={onSelectFacility}
          />
        ))}
      </div>
    );
  }

  const groups = groupFacilities(facilities, groupBy);
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g.label}>
          <div className="flex items-baseline justify-between mb-1.5">
            <h3 className="text-[11px] font-semibold tracking-tight text-muted">
              {g.label}
            </h3>
            <span className="text-[11px] text-muted/70">
              {g.items.length} {g.items.length === 1 ? "site" : "sites"}
            </span>
          </div>
          <div className="flex flex-col">
            {g.items.map((f) => (
              <FacilityRow
                key={f.id}
                facility={f}
                onSelect={onSelectFacility}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

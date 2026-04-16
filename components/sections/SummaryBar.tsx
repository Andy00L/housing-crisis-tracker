"use client";

import { useState } from "react";
import { ENTITIES } from "@/lib/placeholder-data";
import {
  STANCE_LABEL,
  type DimensionLens,
  type Entity,
  type StanceType,
} from "@/types";

interface Bucket {
  key: StanceType;
  label: string;
  color: string;
  textColor: string;
}

const BUCKETS: Bucket[] = [
  {
    key: "restrictive",
    label: STANCE_LABEL.restrictive,
    color: "var(--color-stance-restrictive)",
    textColor: "#1D1D1F",
  },
  {
    key: "concerning",
    label: STANCE_LABEL.concerning,
    color: "var(--color-stance-concerning)",
    textColor: "#1D1D1F",
  },
  {
    key: "review",
    label: STANCE_LABEL.review,
    color: "var(--color-stance-review)",
    textColor: "#1D1D1F",
  },
  {
    key: "none",
    label: STANCE_LABEL.none,
    color: "var(--color-stance-none)",
    textColor: "#1D1D1F",
  },
  {
    key: "favorable",
    label: STANCE_LABEL.favorable,
    color: "var(--color-stance-favorable)",
    textColor: "#1D1D1F",
  },
];

/** Supported scopes. Canada stays the default for the homepage header.
 *  The extra scopes (na/eu/asia) are enabled as section 01 grows to
 *  cover multi-region housing policy. */
export type SummaryScope = "ca" | "us" | "na" | "eu" | "asia";

interface SummaryBarProps {
  lens: DimensionLens;
  /** Which jurisdiction set to summarize. Defaults to Canada. */
  scope?: SummaryScope;
}

/**
 * Select the jurisdiction set that feeds the bar.
 *  - ca: 13 Canadian provinces + territories (geoId starts with "CA-").
 *  - us: 50 US states (NA-region state-level entities minus Canadian ones).
 *  - na: ca + us combined (63 jurisdictions).
 *  - eu: 11 European entities (region === "eu", excluding the bloc overview).
 *  - asia: 7 Asia-Pacific countries (region === "asia", federal-level pipelines).
 */
function pickJurisdictions(scope: SummaryScope): Entity[] {
  if (scope === "eu") {
    return ENTITIES.filter((e) => e.region === "eu" && !e.isOverview);
  }
  if (scope === "asia") {
    return ENTITIES.filter((e) => e.region === "asia" && !e.isOverview);
  }
  const stateEntities = ENTITIES.filter(
    (e) => e.region === "na" && e.level === "state",
  );
  if (scope === "ca") {
    return stateEntities.filter((e) => e.geoId?.startsWith("CA-"));
  }
  if (scope === "us") {
    return stateEntities.filter((e) => !e.geoId?.startsWith("CA-"));
  }
  // na: both combined
  return stateEntities;
}

/** Expected denominator by scope. Hardcoded to match political geography. */
const EXPECTED_TOTAL: Record<SummaryScope, number> = {
  ca: 13,
  us: 50,
  na: 63,
  eu: 11,
  asia: 7,
};

const UNIT_LABEL: Record<SummaryScope, string> = {
  ca: "provinces/territories",
  us: "states",
  na: "jurisdictions",
  eu: "countries",
  asia: "countries",
};

export default function SummaryBar({ lens, scope = "ca" }: SummaryBarProps) {
  const [hovered, setHovered] = useState<StanceType | null>(null);

  const jurisdictions = pickJurisdictions(scope);

  const grouped: Record<StanceType, Entity[]> = {
    restrictive: [],
    concerning: [],
    review: [],
    favorable: [],
    none: [],
  };
  for (const s of jurisdictions) {
    const stance = lens === "affordability" ? s.stanceAffordability : s.stanceZoning;
    grouped[stance].push(s);
  }

  const restrictingCount =
    grouped.restrictive.length + grouped.concerning.length;
  const incentivesCount = grouped.favorable.length;
  // Use the observed count if it exceeds the expected total (e.g. when data
  // lands for extra sub-entities). Otherwise prefer the expected geography.
  const totalStates = Math.max(EXPECTED_TOTAL[scope], jurisdictions.length);

  const activeBucket = hovered
    ? (BUCKETS.find((b) => b.key === hovered) ?? null)
    : null;
  const activeStates = hovered ? grouped[hovered] : [];

  const unit = UNIT_LABEL[scope];
  const restrictionsLabel =
    lens === "affordability"
      ? `${unit} restricting development`
      : `${unit} with zoning restrictions`;
  const incentivesLabel =
    lens === "affordability"
      ? `${unit} with active housing reform`
      : `${unit} with pro-density zoning`;

  return (
    <div className="relative">
      {/* Legend row */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-8">
        {BUCKETS.map((b) => (
          <div key={b.key} className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-[4px] flex-shrink-0"
              style={{ backgroundColor: b.color }}
            />
            <span className="text-sm font-medium text-ink tracking-tight">
              {b.label}
            </span>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4 mb-4 text-sm sm:text-base">
        <div className="text-muted leading-snug">
          <span className="font-semibold text-ink">{restrictingCount}</span> of{" "}
          {totalStates} {restrictionsLabel}
        </div>
        <div className="text-muted leading-snug sm:text-right">
          <span className="font-semibold text-ink">{incentivesCount}</span>{" "}
          {incentivesLabel}
        </div>
      </div>

      {/* Segmented bar */}
      <div
        className="flex h-8 rounded-full overflow-hidden"
        onMouseLeave={() => setHovered(null)}
      >
        {BUCKETS.map((bucket) => {
          const count = grouped[bucket.key].length;
          if (count === 0) return null;
          const isDimmed = hovered !== null && hovered !== bucket.key;
          return (
            <div
              key={bucket.key}
              onMouseEnter={() => setHovered(bucket.key)}
              className="flex items-center justify-center text-sm font-semibold cursor-default transition-opacity duration-200"
              style={{
                flexGrow: count,
                flexBasis: 0,
                backgroundColor: bucket.color,
                color: bucket.textColor,
                opacity: isDimmed ? 0.35 : 1,
              }}
            >
              {count}
            </div>
          );
        })}
      </div>

      {/* Below the bar — help text OR active bucket detail */}
      <div className="mt-4 min-h-[3.5rem]">
        {activeBucket ? (
          <div>
            <div
              className="text-sm font-semibold tracking-tight mb-1"
              style={{ color: activeBucket.color }}
            >
              {activeBucket.label}. {activeStates.length} {unit}
            </div>
            <div className="text-xs text-muted leading-relaxed">
              {activeStates.map((s) => s.name).join(", ")}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted">
            <span className="hidden sm:inline">Hover over</span>
            <span className="sm:hidden">Tap</span> a segment to see which {unit}
            fall into each category.
          </p>
        )}
      </div>
    </div>
  );
}

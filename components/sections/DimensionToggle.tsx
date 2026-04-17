"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  AFFORDABILITY_DIMENSIONS,
  ZONING_DIMENSIONS,
  DIMENSION_LABEL,
  type Dimension,
  type DimensionLens,
} from "@/types";
import { DIMENSION_COLOR, DIMENSION_TEXT } from "@/lib/dimensions";

interface DimensionToggleProps {
  dimension: Dimension;
  onChange: (d: Dimension) => void;
  lens: DimensionLens;
  onLensChange: (l: DimensionLens) => void;
}

const LENS_LABEL: Record<DimensionLens, string> = {
  zoning: "Zoning",
  affordability: "Affordability",
};

const LENS_BLURB: Record<DimensionLens, string> = {
  zoning:
    "Where zoning reforms ease or restrict new housing development — and how jurisdictions balance density with neighborhood character.",
  affordability:
    "How governments are addressing housing costs through rent regulation, subsidies, tenant protections, and incentive programs.",
};

// One-liner shown under the active dimension chip explaining what the map
// coloring measures.
const CRISIS_LEGEND: { label: string; color: string }[] = [
  { label: "Severe (7+)", color: "#DC2626" },
  { label: "Moderate (4-6)", color: "#F59E0B" },
  { label: "Mild (1-3)", color: "#FBBF24" },
  { label: "Manageable (0)", color: "#22C55E" },
  { label: "No data", color: "#D1D5DB" },
];

const DIMENSION_BLURB: Record<Dimension, string> = {
  overall:
    "Each jurisdiction's net stance across all bills we're tracking — darker red is more restrictive, green is more permissive.",
  crisis:
    "Composite score from housing price indices, year-over-year price change, average rent, and median home prices. Higher scores signal deeper affordability strain.",
  // Zoning lens
  affordability:
    "Weighted by bills addressing housing affordability, rent control, and cost-of-living measures.",
  supply:
    "Weighted by bills on new housing construction, density bonuses, and development approvals.",
  "rental-market":
    "Weighted by bills on rental regulations, vacancy rates, and short-term rental restrictions.",
  ownership:
    "Weighted by bills on homeownership programs, mortgage assistance, and first-time buyer incentives.",
  "social-housing":
    "Weighted by bills on public housing, social housing development, and subsidized units.",
  // Affordability lens
  environmental:
    "Weighted by bills on environmental review, green building standards, and sustainable development.",
  "community-impact":
    "Weighted by bills on community displacement, neighborhood preservation, and local impact assessments.",
};

export default function DimensionToggle({
  dimension,
  onChange,
  lens,
  onLensChange,
}: DimensionToggleProps) {
  // Lens is now controlled by the page. The same state drives which
  // dimension chips are shown here AND whether project dots render on
  // the map. When the user switches lens, if the current dimension
  // isn't valid for the new lens, we reset to "overall".
  const lensDimensions = useMemo<Dimension[]>(() => {
    return lens === "zoning" ? ZONING_DIMENSIONS : AFFORDABILITY_DIMENSIONS;
  }, [lens]);

  const handleLensChange = (next: DimensionLens) => {
    onLensChange(next);
    const valid: Dimension[] =
      next === "zoning" ? ZONING_DIMENSIONS : AFFORDABILITY_DIMENSIONS;
    if (
      dimension !== "overall" &&
      dimension !== "crisis" &&
      !valid.includes(dimension)
    ) {
      onChange("overall");
    }
  };

  return (
    <div>
      {/* Lens toggle — Zoning vs Affordability */}
      <div className="text-[13px] font-medium text-muted tracking-tight mb-2">
        Focus
      </div>
      {/* iOS-style segmented control — the white pill SLIDES between
          options instead of cross-fading. `layoutId` shares the same
          motion node across both buttons so framer interpolates its
          position with a spring. The non-active button's text color
          eases to ink on hover and on the way in. */}
      <div
        className="relative inline-flex items-center gap-1 p-1 rounded-full bg-black/[.04] mb-2"
        role="tablist"
      >
        {(Object.keys(LENS_LABEL) as DimensionLens[]).map((l) => {
          const active = l === lens;
          return (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => handleLensChange(l)}
              className={`relative text-xs font-medium px-3.5 py-1.5 rounded-full transition-colors duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] ${
                active ? "text-ink" : "text-muted hover:text-ink"
              }`}
              style={{ transitionProperty: "color, transform" }}
            >
              {active && (
                <motion.span
                  layoutId="lens-indicator"
                  className="absolute inset-0 rounded-full bg-white"
                  style={{
                    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                  }}
                  transition={{
                    type: "spring",
                    stiffness: 480,
                    damping: 26,
                    mass: 0.7,
                  }}
                />
              )}
              <span className="relative z-10">{LENS_LABEL[l]}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted leading-relaxed max-w-prose mb-6">
        {LENS_BLURB[lens]}
      </p>

      {/* Dimension chips — Overall + current lens */}
      <div className="text-[13px] font-medium text-muted tracking-tight mb-3">
        Color map by
      </div>
      <div className="flex flex-wrap gap-2">
        {(["overall", "crisis", ...lensDimensions] as Dimension[]).map((d) => {
          const active = d === dimension;
          let activeStyle: React.CSSProperties | undefined;
          if (active) {
            if (d === "overall") {
              activeStyle = {
                backgroundColor: "#1D1D1F",
                borderColor: "#1D1D1F",
                color: "#FFFFFF",
              };
            } else {
              activeStyle = {
                backgroundColor: DIMENSION_COLOR[d],
                borderColor: DIMENSION_COLOR[d],
                color: DIMENSION_TEXT[d],
              };
            }
          }
          return (
            <button
              key={d}
              type="button"
              onClick={() => onChange(d)}
              style={activeStyle}
              className={`inline-flex items-center rounded-full border px-4 py-2 text-xs font-medium transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] ${
                active
                  ? "border-transparent"
                  : "border-black/[.06] text-muted hover:text-ink hover:bg-black/[.02]"
              }`}
            >
              {DIMENSION_LABEL[d]}
            </button>
          );
        })}
      </div>

      {/* Explainer for the active dimension. Reserve enough vertical space
          so the layout doesn't jump when the blurb length changes. */}
      <div className="mt-4 min-h-[2.75rem]">
        <p
          key={dimension}
          className="text-xs text-muted leading-relaxed max-w-prose"
        >
          <span className="font-medium text-ink tracking-tight">
            {DIMENSION_LABEL[dimension]}.
          </span>{" "}
          {DIMENSION_BLURB[dimension]}
        </p>
      </div>

      {/* Crisis severity legend, shown only when crisis dimension is active. */}
      {dimension === "crisis" && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {CRISIS_LEGEND.map(({ label, color }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1.5 text-[11px] text-muted"
            >
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: color }}
              />
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

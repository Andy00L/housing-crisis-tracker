import type { Dimension, DimensionLens, Entity, ImpactTag } from "@/types";
import { STANCE_HEX } from "./map-utils";

/**
 * Which impact tags belong to which dimension. Used both for map recoloring
 * and for filtering the legislation table when a dimension is active.
 */
export const DIMENSION_TAGS: Record<Exclude<Dimension, "overall">, ImpactTag[]> =
  {
    // Crisis uses metric-based scoring, not tag density. Empty array
    // keeps the Record exhaustive so other call-sites compile.
    crisis: [],
    // ─── Zoning lens ─────────────────────────────────────────────────
    affordability: [
      "affordability",
      "displacement",
      "first-time-buyer",
      "foreign-buyer",
    ],
    supply: ["density", "lot-splitting", "transit-oriented", "nimby"],
    "rental-market": [
      "rent-stabilization",
      "vacancy-tax",
      "short-term-rental",
    ],
    ownership: [
      "first-time-buyer",
      "mortgage-regulation",
      "foreign-buyer",
    ],
    // ─── Affordability lens ──────────────────────────────────────────
    "social-housing": [
      "social-housing",
      "inclusionary-zoning",
      "public-land",
      "indigenous-housing",
    ],
    environmental: ["environmental-review", "heritage-protection"],
    "community-impact": [
      "community-opposition",
      "nimby",
      "displacement",
      "homelessness",
    ],
  };

/**
 * One representative color per dimension — used for the active state of the
 * DimensionToggle pill and the dot in the NuanceLegend.
 */
export const DIMENSION_COLOR: Record<
  Exclude<Dimension, "overall">,
  string
> = {
  crisis: "#B91C1C",
  // Zoning lens
  affordability: "#D67A4A",
  supply: "#4F8B58",
  "rental-market": "#7090C8",
  ownership: "#C89554",
  // Affordability lens
  "social-housing": "#9B6BC5",
  environmental: "#5AA5A5",
  "community-impact": "#C8534A",
};

/**
 * Foreground text color to pair with each DIMENSION_COLOR background. Picked
 * by hand to keep readable contrast on each pastel.
 */
export const DIMENSION_TEXT: Record<
  Exclude<Dimension, "overall">,
  string
> = {
  crisis: "#FFFFFF",
  affordability: "#FFFFFF",
  supply: "#FFFFFF",
  "rental-market": "#FFFFFF",
  ownership: "#1D1D1F",
  "social-housing": "#FFFFFF",
  environmental: "#FFFFFF",
  "community-impact": "#FFFFFF",
};

/**
 * Per-dimension gradient — `from` is the score=0 (lowest intensity) end, `to`
 * is the score=1 (highest intensity) end. The map interpolates between them
 * based on each entity's tag-density score for the active dimension.
 */
export const DIMENSION_GRADIENT: Record<
  Exclude<Dimension, "overall">,
  { from: string; to: string }
> = {
  // Crisis bypasses gradient interpolation (has its own bucket logic).
  // Placeholder keeps the Record exhaustive.
  crisis: { from: "#D1D5DB", to: "#DC2626" },
  // Zoning lens
  affordability: { from: "#F0C5A0", to: "#A04830" },
  supply: { from: "#3D7849", to: "#7A4F2A" },
  "rental-market": { from: "#5A8FD9", to: "#7B5EA5" },
  ownership: { from: "#F0D5A0", to: "#8A5A2A" },
  // Affordability lens
  "social-housing": { from: "#C4A8E0", to: "#5A3F7A" },
  environmental: { from: "#A8D0D0", to: "#2E6565" },
  "community-impact": { from: "#C84A3F", to: "#F4C9A0" },
};

/**
 * Linear hex interpolation. `t` ∈ [0,1].
 */
function lerpHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const blue = Math.round(ab + (bb - ab) * t);
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(blue)}`;
}

/**
 * Score 0..1 for an entity under a given dimension — based on how many of its
 * bills' impactTags intersect the dimension's tag set, capped at 5 matches.
 */
function getDimensionScore(
  entity: Entity,
  dimension: Exclude<Dimension, "overall">,
): number {
  const relevantTags = DIMENSION_TAGS[dimension];
  const allTags = entity.legislation.flatMap((l) => l.impactTags ?? []);
  const matches = allTags.filter((t) => relevantTags.includes(t)).length;
  return Math.min(1, matches / 5);
}

/**
 * Composite crisis severity score built from populated housingMetrics fields.
 *
 * Factors (0..3 each, max total 12):
 *   nhpiIndex        cumulative price level (thresholds tuned to Canadian
 *                    StatCan NHPI base=100. US FHFA values always max out,
 *                    which correctly lifts every US state above the CA floor.)
 *   nhpiChangeYoY    year-over-year price acceleration
 *   avgRent          monthly rent burden (US entities)
 *   medianHomePrice  ownership barrier (US entities)
 *
 * Returns null when no scoring factor is available (EU/Asia entities with
 * no housingMetrics, or metrics that contain only metadata fields).
 */
export function crisisSeverityScore(entity: Entity): number | null {
  const m = entity.housingMetrics;
  if (!m) return null;

  let score = 0;
  let factors = 0;

  if (typeof m.nhpiIndex === "number") {
    factors++;
    if (m.nhpiIndex > 130) score += 3;
    else if (m.nhpiIndex > 120) score += 2;
    else if (m.nhpiIndex > 110) score += 1;
  }

  if (typeof m.nhpiChangeYoY === "number") {
    factors++;
    if (m.nhpiChangeYoY >= 10) score += 3;
    else if (m.nhpiChangeYoY >= 7) score += 2;
    else if (m.nhpiChangeYoY >= 3) score += 1;
  }

  if (typeof m.avgRent === "number") {
    factors++;
    if (m.avgRent >= 1800) score += 3;
    else if (m.avgRent >= 1400) score += 2;
    else if (m.avgRent >= 1000) score += 1;
  }

  if (typeof m.medianHomePrice === "number") {
    factors++;
    if (m.medianHomePrice >= 500000) score += 3;
    else if (m.medianHomePrice >= 350000) score += 2;
    else if (m.medianHomePrice >= 250000) score += 1;
  }

  if (factors === 0) return null;
  return score;
}

const CRISIS_NO_DATA = "#D1D5DB";
const CRISIS_SEVERE = "#DC2626";
const CRISIS_MODERATE = "#F59E0B";
const CRISIS_MILD = "#FBBF24";
const CRISIS_MANAGEABLE = "#22C55E";

/**
 * Returns the fill color for an entity under the given dimension.
 *  - "overall" → uses the entity's stance from STANCE_HEX (diverging palette).
 *  - "crisis"  → buckets crisisSeverityScore into 4 severity tiers + gray.
 *  - any other → interpolates the dimension's gradient based on the entity's
 *    tag-density score (continuous, not bucketed).
 */
export function getEntityColorForDimension(
  entity: Entity,
  dimension: Dimension,
  lens: DimensionLens = "zoning",
): string {
  if (dimension === "overall") {
    const stance = lens === "affordability" ? entity.stanceAffordability : entity.stanceZoning;
    return STANCE_HEX[stance];
  }

  if (dimension === "crisis") {
    const s = crisisSeverityScore(entity);
    if (s === null) return CRISIS_NO_DATA;
    if (s >= 7) return CRISIS_SEVERE;
    if (s >= 4) return CRISIS_MODERATE;
    if (s >= 1) return CRISIS_MILD;
    return CRISIS_MANAGEABLE;
  }

  const score = getDimensionScore(entity, dimension);
  const grad = DIMENSION_GRADIENT[dimension];
  return lerpHex(grad.from, grad.to, score);
}

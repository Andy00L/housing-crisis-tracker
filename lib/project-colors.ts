/**
 * Canonical color palette for housing project status rendering.
 * Use this for map markers, chips, badges, and any status indicator.
 *
 * Colors were carried over from the former `DC_COLOR` const in
 * `components/map/ProjectDots.tsx` to preserve the existing visual
 * design. `operational`, `under-construction`, `proposed`, and `mixed`
 * keep their Apple system palette hex values. `delayed` and `unknown`
 * are new additive keys used by `statusColorForProject` as a safe
 * fallback path when a status string is missing, stale, or outside the
 * `HousingProjectStatus` enum.
 */
export const PROJECT_STATUS_COLORS = {
  operational: "#0A84FF", // systemBlue: built, occupied, complete
  "under-construction": "#FF9500", // systemOrange: active construction
  proposed: "#5856D6", // systemIndigo: announced, pre-construction
  mixed: "#0A84FF", // cluster dominance fallback when a marker represents projects with multiple statuses
  delayed: "#ef4444", // red: stalled or cancelled
  unknown: "#6b7280", // gray: missing or unclassified
} as const;

export type ProjectStatusKey = keyof typeof PROJECT_STATUS_COLORS;

/**
 * Returns the canonical color for a project status.
 * Handles null, undefined, or out-of-enum inputs by returning the
 * `unknown` gray so callers never see a transparent or broken swatch.
 */
export function statusColorForProject(
  status: string | null | undefined,
): string {
  if (!status) return PROJECT_STATUS_COLORS.unknown;
  const normalized = status.toLowerCase().trim() as ProjectStatusKey;
  return PROJECT_STATUS_COLORS[normalized] ?? PROJECT_STATUS_COLORS.unknown;
}

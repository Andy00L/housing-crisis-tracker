import type { HousingProject } from "@/types";

function stripConfidence(s: string | undefined): string {
  return (s ?? "").replace(/\s*#\w+/g, "").trim();
}

function isGenericName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("canada mortgage") ||
    lower.includes("cmhc") ||
    lower.includes("housing is affordable") ||
    lower.includes("in good condition") ||
    lower === "unknown"
  );
}

/**
 * Pick the best human-readable display name for a housing project.
 *
 * Fallback chain:
 *   1. projectName (when present and not a generic funder name)
 *   2. Descriptive composite: city + type + unit count
 *   3. developer (when not generic)
 *   4. id with prefix stripped
 */
export function projectDisplayName(project: HousingProject): string {
  const name = stripConfidence(project.projectName);
  if (name && !isGenericName(name)) return name;

  const parts: string[] = [];
  const loc = stripConfidence(project.location);
  if (loc) parts.push(loc);
  if (project.projectType && project.projectType !== "mixed") {
    parts.push(
      project.projectType.charAt(0).toUpperCase() + project.projectType.slice(1),
    );
  }
  if (project.unitCount) parts.push(`${project.unitCount} units`);
  if (parts.length > 0) return parts.join(" \u00b7 ");

  const dev = stripConfidence(project.developer);
  if (dev && !isGenericName(dev)) return dev;

  return project.id.replace(/^nhs-/, "").replace(/-/g, " ");
}

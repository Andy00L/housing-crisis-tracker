import type { HousingProject, MunicipalAction } from "@/types";

/**
 * Strip confidence markers like "#likely" / "#confident" from developer
 * strings so keyword matching is clean.
 */
function cleanOperator(op: string | undefined): string {
  if (!op) return "";
  return op.replace(/\s*#\w+/g, "").trim();
}

/**
 * Extract keyword tokens from a project that can be matched against an
 * action's free text. Operator name + location city tokens, lowercased,
 * de-duplicated, length ≥ 3 so we don't match stopwords.
 */
function projectKeywords(p: HousingProject): string[] {
  const op = cleanOperator(p.developer);
  const loc = (p.location ?? "").trim();
  const raw = [op, loc]
    .filter(Boolean)
    // Split multi-word values. "Belvedere Affordable Housing" splits
    // to "Belvedere", "Affordable", "Housing"; the stopword filter
    // below drops the generic ones so only the distinctive token
    // remains for matching.
    .flatMap((s) => s.split(/[,/&\s]+/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
  return Array.from(new Set(raw.map((s) => s.toLowerCase())));
}

/**
 * Return the IDs of projects whose operator or location appears in the
 * action's title or summary. Conservative match. Requires the keyword
 * to appear as a whole word in the action text. Skips generic tokens
 * ("county", "city", "housing") that would over-match.
 */
const GENERIC_TOKENS = new Set([
  "county",
  "city",
  "township",
  "corporation",
  "inc",
  "llc",
  "group",
  "holdings",
  "housing",
  "homes",
  "residential",
  "apartments",
  "development",
  "project",
  "projects",
  "us",
  "usa",
]);

export function findRelatedProjects(
  action: MunicipalAction,
  projects: HousingProject[],
): string[] {
  const text = `${action.title} ${action.summary}`.toLowerCase();
  const matches = new Set<string>();
  for (const p of projects) {
    const keywords = projectKeywords(p).filter(
      (k) => !GENERIC_TOKENS.has(k),
    );
    if (keywords.length === 0) continue;
    // Require at least one non-generic keyword to appear as a whole-word
    // boundary in the action text.
    for (const k of keywords) {
      const pattern = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      if (pattern.test(text)) {
        matches.add(p.id);
        break;
      }
    }
  }
  return Array.from(matches);
}

/**
 * Reverse lookup: which actions (across a set of municipalities)
 * reference this project? Used by the project detail view to surface
 * local political context.
 */
export function findActionsForProject(
  project: HousingProject,
  actions: Array<MunicipalAction & { municipalityName: string }>,
): Array<MunicipalAction & { municipalityName: string }> {
  const keywords = projectKeywords(project).filter(
    (k) => !GENERIC_TOKENS.has(k),
  );
  if (keywords.length === 0) return [];
  return actions.filter((a) => {
    const text = `${a.title} ${a.summary}`.toLowerCase();
    return keywords.some((k) => {
      const pattern = new RegExp(
        `\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      );
      return pattern.test(text);
    });
  });
}

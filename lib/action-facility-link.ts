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
 * Extract keyword tokens from a facility that can be matched against an
 * action's free text. Operator name + location city tokens, lowercased,
 * de-duplicated, length ≥ 3 so we don't match stopwords.
 */
function facilityKeywords(f: HousingProject): string[] {
  const op = cleanOperator(f.developer);
  const loc = (f.location ?? "").trim();
  const raw = [op, loc]
    .filter(Boolean)
    // Split multi-word values — "Data Center Alley" → "Alley", "Loudoun"
    .flatMap((s) => s.split(/[,/&\s]+/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
  return Array.from(new Set(raw.map((s) => s.toLowerCase())));
}

/**
 * Return the IDs of facilities whose operator or location appears in the
 * action's title or summary. Conservative match — requires the keyword
 * to appear as a whole word in the action text. Skips generic tokens
 * ("county", "data", "center") that would over-match.
 */
const GENERIC_TOKENS = new Set([
  "county",
  "data",
  "center",
  "centers",
  "city",
  "township",
  "corporation",
  "inc",
  "llc",
  "group",
  "holdings",
  "technologies",
  "technology",
  "tech",
  "corp",
  "co",
  "industries",
  "us",
  "usa",
]);

export function findRelatedFacilities(
  action: MunicipalAction,
  facilities: HousingProject[],
): string[] {
  const text = `${action.title} ${action.summary}`.toLowerCase();
  const matches = new Set<string>();
  for (const f of facilities) {
    const keywords = facilityKeywords(f).filter(
      (k) => !GENERIC_TOKENS.has(k),
    );
    if (keywords.length === 0) continue;
    // Require at least one non-generic keyword to appear as a whole-word
    // boundary in the action text.
    for (const k of keywords) {
      const pattern = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      if (pattern.test(text)) {
        matches.add(f.id);
        break;
      }
    }
  }
  return Array.from(matches);
}

/**
 * Reverse lookup: which actions (across a set of municipalities) reference
 * this facility? Used by the facility detail view to surface local
 * political context.
 */
export function findActionsForFacility(
  facility: HousingProject,
  actions: Array<MunicipalAction & { municipalityName: string }>,
): Array<MunicipalAction & { municipalityName: string }> {
  const keywords = facilityKeywords(facility).filter(
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

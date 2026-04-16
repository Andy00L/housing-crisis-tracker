/**
 * Validator for HousingProject records.
 *
 * Hand-rolled rather than pulled in from a schema library (Zod, Yup, etc.)
 * because the project intentionally keeps its dependency surface small.
 * The pipelines call `validateHousingProject` after Claude extraction so a
 * malformed payload never reaches `data/projects/*.json` or the placeholder
 * blob the UI consumes.
 *
 * The shape mirrors `HousingProject` in `types/index.ts`. Required fields
 * are minimal on purpose. The pipeline often only knows id/developer/state/
 * status during the first pass; enrichments (primaryBeneficiary, issues,
 * sources) come from a follow-up Claude call and may be absent.
 */

import {
  HOUSING_ISSUES,
  type HousingIssue,
  type HousingProject,
  type HousingProjectStatus,
  type ProjectSource,
  type RelatedLocalAction,
} from "@/types";

const VALID_STATUS: ReadonlySet<HousingProjectStatus> = new Set([
  "operational",
  "under-construction",
  "proposed",
]);

const VALID_TYPE = new Set(["rental", "condo", "mixed", "social", "cooperative"]);

const VALID_LOCAL_STATUS = new Set(["enacted", "pending", "failed"]);

const VALID_ISSUES: ReadonlySet<HousingIssue> = new Set(HOUSING_ISSUES);

export interface ValidationResult {
  ok: boolean;
  /** Path-prefixed messages so the caller can surface multiple problems. */
  errors: string[];
}

function isUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // YYYY-MM-DD or full ISO timestamp.
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.test(
    value,
  );
}

function validateLocalAction(
  raw: unknown,
  prefix: string,
  errors: string[],
): RelatedLocalAction | null {
  if (!raw || typeof raw !== "object") {
    errors.push(`${prefix}: expected object`);
    return null;
  }
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === "string" ? r.title : "";
  const jurisdiction = typeof r.jurisdiction === "string" ? r.jurisdiction : "";
  const status = String(r.status ?? "");
  const date = String(r.date ?? "");
  const sourceUrl = String(r.sourceUrl ?? "");
  let ok = true;
  if (!title) {
    errors.push(`${prefix}.title: required`);
    ok = false;
  }
  if (!jurisdiction) {
    errors.push(`${prefix}.jurisdiction: required`);
    ok = false;
  }
  if (!VALID_LOCAL_STATUS.has(status)) {
    errors.push(`${prefix}.status: must be enacted|pending|failed`);
    ok = false;
  }
  if (!isIsoDate(date)) {
    errors.push(`${prefix}.date: invalid ISO date`);
    ok = false;
  }
  if (!isUrl(sourceUrl)) {
    errors.push(`${prefix}.sourceUrl: invalid URL`);
    ok = false;
  }
  if (!ok) return null;
  return {
    title,
    jurisdiction,
    status: status as RelatedLocalAction["status"],
    date,
    sourceUrl,
  };
}

function validateProjectSource(
  raw: unknown,
  prefix: string,
  errors: string[],
): ProjectSource | null {
  if (!raw || typeof raw !== "object") {
    errors.push(`${prefix}: expected object`);
    return null;
  }
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === "string" ? r.title : "";
  const publisher = typeof r.publisher === "string" ? r.publisher : "";
  const url = typeof r.url === "string" ? r.url : "";
  const date = typeof r.date === "string" ? r.date : "";
  let ok = true;
  if (!title) {
    errors.push(`${prefix}.title: required`);
    ok = false;
  }
  if (!publisher) {
    errors.push(`${prefix}.publisher: required`);
    ok = false;
  }
  if (!isUrl(url)) {
    errors.push(`${prefix}.url: invalid URL`);
    ok = false;
  }
  if (date && !isIsoDate(date)) {
    errors.push(`${prefix}.date: invalid ISO date when present`);
    ok = false;
  }
  if (!ok) return null;
  return { title, publisher, url, date };
}

/**
 * Validate a candidate HousingProject. Returns the typed record when every
 * required field is present and well-formed, otherwise null. Always
 * populates `errors` with a path-prefixed list so the caller can decide
 * whether to log, drop, or repair.
 *
 * Required: id, developer, status. Optional fields are checked for type
 * sanity (URLs are real URLs, enums are in their enum set, dates parse).
 */
export function validateHousingProject(
  raw: unknown,
): { project: HousingProject | null; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") {
    return { project: null, errors: ["root: expected object"] };
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.id !== "string" || r.id.length === 0) {
    errors.push("id: required string");
  }
  if (typeof r.developer !== "string" || r.developer.length === 0) {
    errors.push("developer: required string");
  }
  const status = String(r.status ?? "");
  if (!VALID_STATUS.has(status as HousingProjectStatus)) {
    errors.push("status: must be operational|under-construction|proposed");
  }

  if (r.source !== undefined && !isUrl(r.source)) {
    errors.push("source: must be http(s) URL when present");
  }
  if (r.projectType !== undefined && !VALID_TYPE.has(String(r.projectType))) {
    errors.push("projectType: invalid value");
  }

  // Issues array: must be a subset of the enum.
  let issues: HousingIssue[] | undefined;
  if (r.issues !== undefined) {
    if (!Array.isArray(r.issues)) {
      errors.push("issues: expected array");
    } else {
      const filtered: HousingIssue[] = [];
      for (let i = 0; i < r.issues.length; i++) {
        const candidate = r.issues[i];
        if (typeof candidate !== "string" || !VALID_ISSUES.has(candidate as HousingIssue)) {
          errors.push(
            `issues[${i}]: "${String(candidate)}" not in HOUSING_ISSUES`,
          );
          continue;
        }
        filtered.push(candidate as HousingIssue);
      }
      issues = filtered;
    }
  }

  // relatedLocalActions
  let relatedLocalActions: RelatedLocalAction[] | undefined;
  if (r.relatedLocalActions !== undefined) {
    if (!Array.isArray(r.relatedLocalActions)) {
      errors.push("relatedLocalActions: expected array");
    } else {
      const out: RelatedLocalAction[] = [];
      for (let i = 0; i < r.relatedLocalActions.length; i++) {
        const v = validateLocalAction(
          r.relatedLocalActions[i],
          `relatedLocalActions[${i}]`,
          errors,
        );
        if (v) out.push(v);
      }
      relatedLocalActions = out;
    }
  }

  // sources
  let sources: ProjectSource[] | undefined;
  if (r.sources !== undefined) {
    if (!Array.isArray(r.sources)) {
      errors.push("sources: expected array");
    } else {
      const out: ProjectSource[] = [];
      for (let i = 0; i < r.sources.length; i++) {
        const v = validateProjectSource(r.sources[i], `sources[${i}]`, errors);
        if (v) out.push(v);
      }
      sources = out;
    }
  }

  if (errors.length > 0) {
    return { project: null, errors };
  }

  // Build the typed shape. Optional numerics pass through unchanged when
  // present; downstream UI handles undefined.
  const project: HousingProject = {
    id: String(r.id),
    developer: String(r.developer),
    status: status as HousingProjectStatus,
    projectName: typeof r.projectName === "string" ? r.projectName : undefined,
    location: typeof r.location === "string" ? r.location : undefined,
    state: typeof r.state === "string" ? r.state : undefined,
    country: typeof r.country === "string" ? r.country : undefined,
    lat: typeof r.lat === "number" ? r.lat : undefined,
    lng: typeof r.lng === "number" ? r.lng : undefined,
    unitCount: typeof r.unitCount === "number" ? r.unitCount : undefined,
    affordableUnits:
      typeof r.affordableUnits === "number" ? r.affordableUnits : undefined,
    projectCost: typeof r.projectCost === "number" ? r.projectCost : undefined,
    projectType: r.projectType as HousingProject["projectType"],
    yearProposed: typeof r.yearProposed === "number" ? r.yearProposed : undefined,
    yearCompleted:
      typeof r.yearCompleted === "number" ? r.yearCompleted : undefined,
    notes: typeof r.notes === "string" ? r.notes : undefined,
    source: typeof r.source === "string" ? r.source : undefined,
    primaryBeneficiary:
      typeof r.primaryBeneficiary === "string" ? r.primaryBeneficiary : undefined,
    storyBlurb: typeof r.storyBlurb === "string" ? r.storyBlurb : undefined,
    issues,
    relatedBillIds: Array.isArray(r.relatedBillIds)
      ? (r.relatedBillIds as unknown[])
          .filter((x): x is string => typeof x === "string")
      : undefined,
    relatedLocalActions,
    sources,
  };

  return { project, errors: [] };
}

/** Convenience for callers that want a pass/fail boolean. */
export function isHousingProject(raw: unknown): ValidationResult {
  const { project, errors } = validateHousingProject(raw);
  return { ok: project !== null, errors };
}

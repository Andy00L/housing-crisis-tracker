/**
 * Fallback router. Given a chain of sources (primary, fallback1, fallback2,
 * ...), consult the health registry and pick the first source whose status
 * is not "down".
 *
 * Used by pipeline scripts. Typical call:
 *
 *     const route = pickRoute(["legisinfo", "openparliament"]);
 *     if (route.source === "openparliament") {
 *       report.markSourceFallbackUsed("legisinfo");
 *     }
 *
 * When every source is down, returns `{ ok: false }`. The pipeline should
 * skip its step and log a note.
 */

import { getStatus } from "./health-registry.js";
import type { RunReportBuilder } from "./run-report.js";
import type { SourceName } from "./types.js";

export type RouteDecision =
  | { ok: true; source: SourceName; index: number; degraded: boolean }
  | { ok: false; attempted: SourceName[] };

export function pickRoute(chain: readonly SourceName[]): RouteDecision {
  if (chain.length === 0) {
    return { ok: false, attempted: [] };
  }
  const attempted: SourceName[] = [];
  for (let i = 0; i < chain.length; i++) {
    const src = chain[i];
    attempted.push(src);
    const status = getStatus(src);
    if (status === "healthy" || status === "degraded") {
      return { ok: true, source: src, index: i, degraded: status === "degraded" };
    }
  }
  return { ok: false, attempted };
}

/**
 * Log-and-pick helper. Same as pickRoute but also updates the pipeline's
 * run report with markSourceFallbackUsed when the primary was skipped.
 */
export function pickRouteWithReport(
  chain: readonly SourceName[],
  report: RunReportBuilder,
): RouteDecision {
  const decision = pickRoute(chain);
  if (decision.ok) {
    if (decision.index > 0) {
      // Every source we skipped was down.
      for (let i = 0; i < decision.index; i++) {
        report.markSourceFallbackUsed(chain[i]);
      }
    }
    if (decision.degraded) {
      report.markSourceDegraded(decision.source);
    }
  } else {
    report.addNote(
      `All sources down: ${decision.attempted.join(", ")}. Pipeline skipped.`,
    );
  }
  return decision;
}

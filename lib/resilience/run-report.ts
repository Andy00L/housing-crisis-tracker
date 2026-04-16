/**
 * Pipeline run report writer. Every pipeline script calls startRunReport()
 * at entry and finishRunReport() at exit. Produces:
 *
 *   data/raw/_run-reports/{pipeline}-{YYYY-MM-DDTHH-mm-ssZ}.json
 *
 * Auto-prunes reports older than PRUNE_AFTER_DAYS to keep the folder small.
 * Consumed by:
 *   - scripts/ci/summarize-run-report.ts (CI log summary + annotations)
 *   - app/api/health/route.ts (latest report per pipeline)
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  RunReport,
  RunReportFailure,
  RunReportSourceUsage,
  RunReportStatus,
  SourceName,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const REPORT_DIR = join(ROOT, "data/raw/_run-reports");
const PRUNE_AFTER_DAYS = 30;

export interface RunReportBuilder {
  readonly pipeline: string;
  noteSuccess(entity?: string): void;
  noteFailure(failure: RunReportFailure): void;
  incrementTotal(n?: number): void;
  /** Accumulate per-source usage. Safe to call many times; values are added. */
  recordUsage(source: SourceName, delta: RunReportSourceUsage): void;
  markSourceDegraded(source: SourceName): void;
  markSourceFallbackUsed(source: SourceName): void;
  addNote(note: string): void;
  /** Write the report to disk and return the final RunReport. */
  finish(status?: RunReportStatus): RunReport;
}

export function startRunReport(pipeline: string): RunReportBuilder {
  const startedAt = new Date();
  let total = 0;
  let successes = 0;
  const failures: RunReportFailure[] = [];
  const sourcesUsed: Partial<Record<SourceName, RunReportSourceUsage>> = {};
  const sourcesDegraded = new Set<SourceName>();
  const sourcesFallbackUsed = new Set<SourceName>();
  const notes: string[] = [];

  return {
    get pipeline() {
      return pipeline;
    },
    noteSuccess(_entity?: string) {
      successes += 1;
    },
    noteFailure(failure) {
      failures.push(failure);
    },
    incrementTotal(n = 1) {
      total += n;
    },
    recordUsage(source, delta) {
      const existing = sourcesUsed[source] ?? {};
      sourcesUsed[source] = {
        credits_consumed: (existing.credits_consumed ?? 0) + (delta.credits_consumed ?? 0),
        cache_hits: (existing.cache_hits ?? 0) + (delta.cache_hits ?? 0),
        cache_misses: (existing.cache_misses ?? 0) + (delta.cache_misses ?? 0),
        calls: (existing.calls ?? 0) + (delta.calls ?? 0),
        approx_cost_usd:
          Math.round(
            ((existing.approx_cost_usd ?? 0) + (delta.approx_cost_usd ?? 0)) * 10000,
          ) / 10000,
      };
    },
    markSourceDegraded(source) {
      sourcesDegraded.add(source);
    },
    markSourceFallbackUsed(source) {
      sourcesFallbackUsed.add(source);
    },
    addNote(note) {
      notes.push(note);
    },
    finish(overrideStatus?: RunReportStatus) {
      const finishedAt = new Date();
      const status: RunReportStatus = overrideStatus ?? deriveStatus({
        total,
        successes,
        failures: failures.length,
        degraded: sourcesDegraded.size,
      });
      const report: RunReport = {
        pipeline,
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        status,
        entities_total: total,
        entities_successful: successes,
        entities_failed: failures.length,
        failures,
        sources_used: sourcesUsed,
        sources_degraded: Array.from(sourcesDegraded),
        sources_fallback_used: Array.from(sourcesFallbackUsed),
        notes: notes.length > 0 ? notes : undefined,
      };
      writeReport(report);
      pruneOld();
      return report;
    },
  };
}

function deriveStatus(args: {
  total: number;
  successes: number;
  failures: number;
  degraded: number;
}): RunReportStatus {
  if (args.total === 0 && args.failures === 0) return "healthy";
  if (args.successes === 0 && args.failures > 0) return "failed";
  if (args.failures > 0) return "partial";
  if (args.degraded > 0) return "degraded";
  return "healthy";
}

function safeFileStamp(d: Date): string {
  // 2026-04-16T12-34-56Z  (Windows-safe: no colons)
  return d.toISOString().replace(/[:.]/g, "-").replace(/-Z$/, "Z");
}

function writeReport(report: RunReport): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = safeFileStamp(new Date(report.finished_at));
  const path = join(REPORT_DIR, `${report.pipeline}-${stamp}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
}

function pruneOld(): void {
  if (!existsSync(REPORT_DIR)) return;
  const cutoff = Date.now() - PRUNE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  for (const name of readdirSync(REPORT_DIR)) {
    if (!name.endsWith(".json")) continue;
    const p = join(REPORT_DIR, name);
    try {
      const s = statSync(p);
      if (s.mtimeMs < cutoff) unlinkSync(p);
    } catch {
      // Best-effort cleanup; ignore per-file failures.
    }
  }
}

/**
 * Read the latest report per pipeline. Used by /api/health to surface the
 * current freshness snapshot without re-running anything.
 */
export function latestReportsByPipeline(): Record<string, RunReport> {
  if (!existsSync(REPORT_DIR)) return {};
  const latest: Record<string, RunReport> = {};
  for (const name of readdirSync(REPORT_DIR)) {
    if (!name.endsWith(".json")) continue;
    const p = join(REPORT_DIR, name);
    try {
      const raw = readFileSync(p, "utf8");
      const r = JSON.parse(raw) as RunReport;
      const prev = latest[r.pipeline];
      if (!prev || new Date(r.finished_at) > new Date(prev.finished_at)) {
        latest[r.pipeline] = r;
      }
    } catch {
      // Skip corrupt entries; pruner will catch them on next age-out.
    }
  }
  return latest;
}

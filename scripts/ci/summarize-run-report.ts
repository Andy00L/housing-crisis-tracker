/**
 * Summarize the run reports emitted by the sync pipelines.
 *
 * Scans `data/raw/_run-reports/*.json`, filters to the current CI run
 * (via `GITHUB_RUN_ID` embedded in the filename when present, otherwise
 * the last 60 minutes), and prints a Markdown summary. In CI, the same
 * table is appended to `$GITHUB_STEP_SUMMARY`.
 *
 * Exit code 0 when every retained report has status in
 * {ok, partial, healthy}. Exit code 1 when any report is `error` or the
 * script hits an uncaught exception.
 *
 * Pure TypeScript. No Anthropic / Tavily / third-party SDK imports so it
 * can run on a bare CI image.
 */

import { readFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface SourceStats {
  credits_consumed?: number;
  cache_hits?: number;
  cache_misses?: number;
  calls?: number;
  approx_cost_usd?: number;
}

interface RunReport {
  pipeline: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  status: "ok" | "partial" | "healthy" | "degraded" | "error" | string;
  entities_total?: number;
  entities_successful?: number;
  entities_failed?: number;
  failures?: Array<{ entity?: string; reason?: string; retryable?: boolean }>;
  sources_used?: Record<string, SourceStats>;
  sources_degraded?: string[];
  sources_fallback_used?: string[];
  notes?: string[];
}

const ROOT = resolve(__dirname, "..", "..");
const REPORT_DIR = join(ROOT, "data", "raw", "_run-reports");
const WINDOW_MS = 60 * 60 * 1000; // 60 minutes

const GOOD_STATUSES = new Set(["ok", "partial", "healthy", "degraded"]);

function loadReports(): Array<{ file: string; data: RunReport }> {
  if (!existsSync(REPORT_DIR)) return [];
  const entries: Array<{ file: string; data: RunReport }> = [];
  for (const name of readdirSync(REPORT_DIR)) {
    if (!name.endsWith(".json")) continue;
    const path = join(REPORT_DIR, name);
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as RunReport;
      entries.push({ file: name, data: parsed });
    } catch (err) {
      console.error(
        `[summarize-run-report] could not parse ${name}: ${
          (err as Error).message
        }`,
      );
    }
  }
  return entries;
}

function filterToRun(
  entries: Array<{ file: string; data: RunReport }>,
): Array<{ file: string; data: RunReport }> {
  const runId = process.env.GITHUB_RUN_ID;
  if (runId) {
    const tagged = entries.filter((e) => e.file.includes(runId));
    if (tagged.length > 0) return tagged;
  }
  const cutoff = Date.now() - WINDOW_MS;
  return entries.filter((e) => {
    const ts = Date.parse(e.data.finished_at ?? e.data.started_at ?? "");
    return Number.isFinite(ts) && ts >= cutoff;
  });
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "n/a";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

function summarizeFailures(report: RunReport): string {
  const failures = report.failures ?? [];
  if (failures.length === 0) return "";
  return failures
    .slice(0, 3)
    .map((f) => {
      const entity = f.entity ?? "?";
      const reason = (f.reason ?? "unknown").slice(0, 60);
      return `\`${entity}: ${reason}\``;
    })
    .join(", ");
}

function tallyTavilyCredits(
  entries: Array<{ file: string; data: RunReport }>,
): number {
  let credits = 0;
  for (const e of entries) {
    const t = e.data.sources_used?.tavily?.credits_consumed ?? 0;
    credits += Number.isFinite(t) ? t : 0;
  }
  return credits;
}

function renderMarkdown(
  entries: Array<{ file: string; data: RunReport }>,
): string {
  if (entries.length === 0) {
    return `## Run report summary\n\nNo reports in the last 60 minutes.\n`;
  }

  const header = [
    "| Pipeline | Status | Duration | Success | Failed | Failures |",
    "|---|---|---|---|---|---|",
  ];
  const rows = entries
    .slice()
    .sort((a, b) =>
      (a.data.started_at ?? "").localeCompare(b.data.started_at ?? ""),
    )
    .map((e) => {
      const r = e.data;
      return `| \`${r.pipeline}\` | ${r.status} | ${formatDuration(
        r.duration_ms,
      )} | ${r.entities_successful ?? "-"} | ${r.entities_failed ?? 0} | ${
        summarizeFailures(r) || "none"
      } |`;
    });

  const credits = tallyTavilyCredits(entries);
  const footer = [
    "",
    `Total Tavily credits consumed: **${credits}**`,
    `Total reports: **${entries.length}**`,
  ];

  return [
    "## Run report summary",
    "",
    ...header,
    ...rows,
    ...footer,
    "",
  ].join("\n");
}

function overallOk(
  entries: Array<{ file: string; data: RunReport }>,
): boolean {
  return entries.every((e) => GOOD_STATUSES.has(e.data.status));
}

function main(): number {
  try {
    const all = loadReports();
    const picked = filterToRun(all);
    const md = renderMarkdown(picked);
    process.stdout.write(md);
    const out = process.env.GITHUB_STEP_SUMMARY;
    if (out) {
      try {
        appendFileSync(out, md);
      } catch (err) {
        console.error(
          `[summarize-run-report] could not write to GITHUB_STEP_SUMMARY (${out}): ${
            (err as Error).message
          }`,
        );
      }
    }
    return overallOk(picked) ? 0 : 1;
  } catch (err) {
    console.error(
      `[summarize-run-report] uncaught: ${(err as Error).message}`,
    );
    return 1;
  }
}

process.exit(main());

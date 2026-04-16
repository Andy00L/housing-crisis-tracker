"use client";

/**
 * Footer freshness chip. Pings /api/health and renders a small status pill:
 *
 *     ● {N}/{M} sources live · synced {relative time}
 *
 * Dot colour:
 *   green  overall = healthy
 *   amber  overall = degraded
 *   red    overall = down
 *
 * Clicking the chip opens a modal with per-source status and per-pipeline
 * last-run info. Human-readable labels only. No raw HTTP errors exposed.
 *
 * Mounted in app/layout.tsx. Re-polls every 5 minutes.
 */

import { useEffect, useState } from "react";

type Status = "healthy" | "degraded" | "down";

interface Pipeline {
  name: string;
  status: string;
  last_run: string;
  entities_total: number;
  entities_successful: number;
  entities_failed: number;
  sources_fallback_used: string[];
  notes?: string[];
}

interface SourceHealth {
  status: Status;
  last_success: string | null;
  last_failure: string | null;
  circuit_state: "closed" | "half-open" | "open";
  circuit_reopens_at?: string | null;
  rolling_failure_rate: number;
  note?: string;
}

interface HealthResponse {
  overall: Status;
  last_updated: string;
  pipelines: Pipeline[];
  sources: Record<string, SourceHealth | undefined>;
}

const POLL_INTERVAL_MS = 5 * 60 * 1000;

const STATUS_LABELS: Record<Status, string> = {
  healthy: "All sources live",
  degraded: "Some sources slow",
  down: "One or more sources down",
};

const DOT_COLOR: Record<Status, string> = {
  healthy: "bg-emerald-500",
  degraded: "bg-amber-500",
  down: "bg-rose-500",
};

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "never";
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 48) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function SOURCE_LABEL(name: string): string {
  const map: Record<string, string> = {
    legisinfo: "Parliament of Canada (LEGISinfo)",
    openparliament: "OpenParliament.ca",
    ourcommons: "House of Commons Open Data",
    "bc-laws": "BC Laws",
    canlii: "CanLII",
    statcan: "Statistics Canada",
    cmhc: "CMHC Housing Market Information",
    "bank-of-canada": "Bank of Canada",
    "canada-gazette": "Canada Gazette",
    tavily: "Tavily research",
    anthropic: "Claude API",
    rss: "RSS news feeds",
  };
  return map[name] ?? name;
}

export default function HealthFooter() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as HealthResponse;
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }
    void load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (error && !data) {
    // Fail silently in the UI: a broken /api/health should not crash pages.
    return null;
  }
  if (!data) return null;

  const sourceEntries = Object.entries(data.sources)
    .filter((e): e is [string, SourceHealth] => e[1] !== undefined);
  const live = sourceEntries.filter((e) => e[1].status !== "down").length;
  const total = sourceEntries.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-black/[.06] px-3 py-1.5 text-[11px] font-medium text-muted hover:text-ink hover:bg-black/[.02] transition-colors"
        aria-label="Open data source status"
      >
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${DOT_COLOR[data.overall]}`}
          aria-hidden
        />
        <span>
          {total > 0 ? `${live}/${total} sources live` : STATUS_LABELS[data.overall]}
        </span>
        <span aria-hidden>·</span>
        <span>synced {formatRelative(data.last_updated)}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Data source status"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-ink">
                  Data source status
                </h2>
                <p className="text-xs text-muted mt-1">
                  {STATUS_LABELS[data.overall]} · updated {formatRelative(data.last_updated)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-muted hover:text-ink"
              >
                <svg width="18" height="18" viewBox="0 0 14 14" fill="none">
                  <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <section className="mb-6">
              <h3 className="text-[13px] font-medium text-muted uppercase tracking-wide mb-2">
                Sources
              </h3>
              {sourceEntries.length === 0 ? (
                <p className="text-sm text-muted">No source activity yet.</p>
              ) : (
                <ul className="space-y-2">
                  {sourceEntries.map(([name, h]) => (
                    <li
                      key={name}
                      className="flex items-start gap-3 rounded-lg bg-black/[.02] px-3 py-2"
                    >
                      <span
                        className={`mt-1 inline-block w-1.5 h-1.5 rounded-full ${DOT_COLOR[h.status]}`}
                        aria-hidden
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-4">
                          <span className="text-sm font-medium text-ink truncate">
                            {SOURCE_LABEL(name)}
                          </span>
                          <span className="text-[11px] text-muted capitalize">
                            {h.status}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted mt-0.5">
                          Last success {formatRelative(h.last_success)}
                          {h.status !== "healthy" && h.note ? ` · ${h.note}` : ""}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="text-[13px] font-medium text-muted uppercase tracking-wide mb-2">
                Pipelines
              </h3>
              {data.pipelines.length === 0 ? (
                <p className="text-sm text-muted">No pipeline runs yet.</p>
              ) : (
                <ul className="space-y-2">
                  {data.pipelines.map((p) => (
                    <li key={p.name} className="rounded-lg bg-black/[.02] px-3 py-2">
                      <div className="flex items-baseline justify-between gap-4">
                        <span className="text-sm font-medium text-ink truncate">{p.name}</span>
                        <span className="text-[11px] text-muted capitalize">{p.status}</span>
                      </div>
                      <div className="text-[11px] text-muted mt-0.5">
                        {p.entities_successful}/{p.entities_total} ok
                        {p.entities_failed > 0 ? ` · ${p.entities_failed} failed` : ""}
                        {" · "}
                        ran {formatRelative(p.last_run)}
                      </div>
                      {p.sources_fallback_used.length > 0 && (
                        <div className="text-[11px] text-amber-700 mt-0.5">
                          Fallback used: {p.sources_fallback_used.map(SOURCE_LABEL).join(", ")}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <p className="text-[11px] text-muted mt-6">
              We track multiple public data sources and document every partial run.
              <a href="/about/data-sources" className="ml-1 underline underline-offset-2 hover:text-ink">
                Learn more
              </a>
            </p>
          </div>
        </div>
      )}
    </>
  );
}

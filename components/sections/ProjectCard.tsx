"use client";

import Link from "next/link";
import {
  HOUSING_ISSUE_LABELS,
  IMPACT_TAG_LABEL,
  type HousingIssue,
  type HousingProject,
  type ImpactTag,
} from "@/types";
import { statusColorForProject } from "@/lib/project-colors";

interface ProjectCardProps {
  project: HousingProject;
  /** When rendered in a modal, the close button gets wired to this.
   *  Inline renders leave it undefined and the close button is hidden. */
  onClose?: () => void;
}

const STATUS_LABEL: Record<HousingProject["status"], string> = {
  operational: "Operational",
  "under-construction": "Under construction",
  proposed: "Proposed",
};

function formatUnits(n: number | undefined): string {
  if (!n) return "—";
  return n.toLocaleString();
}

function formatCost(n: number | undefined, currency = "USD"): string {
  if (!n) return "—";
  const symbol = currency === "CAD" ? "CA$" : currency === "GBP" ? "£" : currency === "EUR" ? "€" : "$";
  if (n >= 1_000_000_000) return `${symbol}${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${symbol}${(n / 1_000_000).toFixed(0)}M`;
  return `${symbol}${n.toLocaleString()}`;
}

/**
 * J5-style enriched project card. Renders the full story: developer,
 * status, stats table, Issues chips, related bills, related local actions,
 * and source citations. All sections collapse gracefully when their
 * fields are empty so legacy Canada projects (which shipped without
 * enrichments) still render cleanly.
 */
export default function ProjectCard({ project, onClose }: ProjectCardProps) {
  const color = statusColorForProject(project.status);
  const isProposed = project.status === "proposed";
  const issues = (project.issues ?? []) as HousingIssue[];
  const concerns = (project.concerns ?? []) as ImpactTag[];
  const relatedBills = project.relatedBillIds ?? [];
  const localActions = project.relatedLocalActions ?? [];
  const sources = project.sources ?? [];
  const displayName = project.projectName ?? project.developer;

  return (
    <article className="rounded-2xl bg-white shadow-[0_6px_20px_rgba(0,0,0,0.04),0_1px_4px_rgba(0,0,0,0.03)] p-6 flex flex-col gap-5">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-muted tracking-tight uppercase">
            {project.primaryBeneficiary ?? project.developer}
          </div>
          <h2 className="mt-1 text-xl font-semibold text-ink tracking-tight leading-[1.2]">
            {displayName}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: isProposed ? "transparent" : color,
                  border: isProposed ? `1.25px solid ${color}` : "none",
                }}
              />
              {STATUS_LABEL[project.status]}
            </span>
            {project.unitCount ? (
              <span className="tabular-nums">· {formatUnits(project.unitCount)} units</span>
            ) : null}
            {project.affordableUnits ? (
              <span className="tabular-nums">· {formatUnits(project.affordableUnits)} affordable</span>
            ) : null}
            {project.location ? <span>· {project.location}</span> : null}
            {!project.location && project.state ? <span>· {project.state}</span> : null}
            {project.country ? <span>· {project.country}</span> : null}
          </div>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted hover:text-ink shrink-0 mt-1"
          >
            <svg width="16" height="16" viewBox="0 0 12 12" fill="none">
              <path
                d="M3 3L9 9M9 3L3 9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : null}
      </header>

      {/* Story blurb */}
      {project.storyBlurb ? (
        <div className="text-[14px] text-ink/80 leading-[1.55] max-w-prose whitespace-pre-wrap">
          {project.storyBlurb}
        </div>
      ) : project.notes ? (
        <div className="text-[14px] text-ink/80 leading-[1.55] max-w-prose">
          {project.notes}
        </div>
      ) : null}

      {/* Key facts table */}
      <dl className="grid grid-cols-2 gap-y-3 gap-x-6 text-[13px]">
        {project.primaryBeneficiary ? (
          <Row label="Primary user" value={project.primaryBeneficiary} />
        ) : null}
        <Row
          label="Affordable"
          value={
            project.affordableUnits && project.unitCount
              ? `${formatUnits(project.affordableUnits)} / ${formatUnits(project.unitCount)}`
              : project.affordableUnits
                ? formatUnits(project.affordableUnits)
                : "—"
          }
        />
        <Row label="Cost" value={formatCost(project.projectCost, inferCurrency(project))} />
        <Row label="Status" value={STATUS_LABEL[project.status]} />
        <Row
          label="Location"
          value={[project.location, project.state, project.country].filter(Boolean).join(", ") || "—"}
        />
        {project.projectType ? (
          <Row label="Type" value={project.projectType.replace(/^./, (c) => c.toUpperCase())} />
        ) : null}
      </dl>

      {/* Issues */}
      {issues.length > 0 ? (
        <section>
          <h3 className="text-[12px] font-medium text-muted tracking-tight uppercase mb-2">
            Issues ({issues.length})
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {issues.map((issue) => (
              <li
                key={issue}
                className="text-[11px] px-2.5 py-[3px] rounded-full border border-black/[.08] bg-black/[.02] text-ink/80 tracking-tight"
              >
                {HOUSING_ISSUE_LABELS[issue] ?? issue}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Legacy concerns (older Canada projects). Show only when issues
          are absent so we don't double-up on similar chips. */}
      {issues.length === 0 && concerns.length > 0 ? (
        <section>
          <h3 className="text-[12px] font-medium text-muted tracking-tight uppercase mb-2">
            Concerns
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {concerns.map((c) => (
              <li
                key={c}
                className="text-[11px] px-2.5 py-[3px] rounded-full border border-black/[.08] bg-black/[.02] text-ink/80 tracking-tight"
              >
                {IMPACT_TAG_LABEL[c] ?? c}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Related bills */}
      {relatedBills.length > 0 ? (
        <section>
          <h3 className="text-[12px] font-medium text-muted tracking-tight uppercase mb-2">
            Related bills ({relatedBills.length})
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {relatedBills.map((billId) => (
              <li key={billId}>
                <Link
                  href={`/legislation/${encodeURIComponent(billId)}`}
                  className="text-[11px] px-2.5 py-[3px] rounded-full bg-black/[.04] hover:bg-black/[.08] text-ink/85 tracking-tight transition-colors"
                >
                  {billId}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Related local actions */}
      {localActions.length > 0 ? (
        <section>
          <h3 className="text-[12px] font-medium text-muted tracking-tight uppercase mb-2">
            Related local actions ({localActions.length})
          </h3>
          <ul className="flex flex-col gap-2">
            {localActions.map((a, i) => (
              <li key={i} className="text-[12px] text-ink/80 leading-snug">
                <span className="font-medium text-ink">{a.title}</span>
                {" · "}
                <span className="text-muted">{a.jurisdiction}</span>
                {" · "}
                <span className="text-muted">{a.status}</span>
                {" · "}
                <span className="text-muted">{a.date}</span>
                {a.sourceUrl ? (
                  <>
                    {" · "}
                    <a
                      href={a.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ink hover:underline"
                    >
                      source
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Sources */}
      {sources.length > 0 ? (
        <section>
          <h3 className="text-[12px] font-medium text-muted tracking-tight uppercase mb-2">
            Sources ({sources.length})
          </h3>
          <ul className="flex flex-col gap-1.5">
            {sources.map((s, i) => (
              <li key={i} className="text-[12px] text-ink/80 leading-snug">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink hover:underline"
                >
                  {s.title || s.publisher || s.url}
                </a>
                {s.publisher ? <span className="text-muted"> · {s.publisher}</span> : null}
                {s.date ? <span className="text-muted"> · {s.date}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : project.source ? (
        <section>
          <h3 className="text-[12px] font-medium text-muted tracking-tight uppercase mb-2">Source</h3>
          <a
            href={project.source}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] text-ink hover:underline break-all"
          >
            {project.source}
          </a>
        </section>
      ) : null}
    </article>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <dt className="text-[11px] text-muted tracking-tight uppercase">{label}</dt>
      <dd className="text-[13px] text-ink tabular-nums truncate">{value}</dd>
    </div>
  );
}

function inferCurrency(project: HousingProject): string {
  if (project.country === "Canada") return "CAD";
  if (project.country === "United States") return "USD";
  if (project.country === "United Kingdom") return "GBP";
  return "USD";
}

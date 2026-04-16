"use client";

import {
  IMPACT_TAG_LABEL,
  CATEGORY_LABEL,
  STANCE_LABEL,
  type HousingProject,
  type Legislation,
} from "@/types";
import {
  findDonor,
  formatMoney,
  isDonorRelevant,
  type DonorProfile,
} from "@/lib/donor-data";
import { ALL_HOUSING_PROJECTS } from "@/lib/projects-map";

interface BillExpandedProps {
  bill: Legislation;
  /** Two-letter state code for donor lookup. "US" for federal, "VA" etc. for states. */
  stateCode?: string;
  /** Optional: when set, "Related projects" chips become clickable and
   *  call back with the project. Used inside the sidebar flow so clicking
   *  a project opens its detail panel. */
  onSelectProject?: (f: HousingProject) => void;
}

// Build-once lookup so we can resolve a project by ID on every render
// without rescanning ALL_HOUSING_PROJECTS each time.
const FACILITY_BY_ID = new Map<string, HousingProject>(
  ALL_HOUSING_PROJECTS.map((f) => [f.id, f]),
);

function cleanOperator(op: string | undefined): string {
  if (!op) return "";
  return op.replace(/\s*#\w+/g, "").trim();
}

/**
 * Inline details that appear when a bill card is expanded. Used by both
 * LegislationList (side panel) and LegislationTable (home page section).
 * Keeps layout tight so it fits inside a ~22rem side panel.
 */
export default function BillExpanded({
  bill,
  stateCode,
  onSelectProject,
}: BillExpandedProps) {
  const isFederal = stateCode === "US";
  const sponsors = bill.sponsors ?? [];
  const relatedProjects: HousingProject[] = (bill.relatedProjectIds ?? [])
    .map((id) => FACILITY_BY_ID.get(id))
    .filter((f): f is HousingProject => !!f);

  // Only look up donors for federal bills — state legislators aren't in
  // the FEC dataset so any "match" would be a false positive by last name.
  const sponsorProfiles = isFederal
    ? sponsors.map((name) => ({ name, profile: findDonor(name, stateCode) }))
    : sponsors.map((name) => ({ name, profile: null as DonorProfile | null }));

  const href = bill.legiscanUrl ?? bill.sourceUrl;

  return (
    <div className="pt-4 mt-4 border-t border-black/[.06] flex flex-col gap-4">
      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span>{CATEGORY_LABEL[bill.category]}</span>
        {bill.stance && (
          <>
            <span aria-hidden>·</span>
            <span>{STANCE_LABEL[bill.stance]}</span>
          </>
        )}
        {bill.partyOrigin && (
          <>
            <span aria-hidden>·</span>
            <span>
              {bill.partyOrigin === "B"
                ? "Bipartisan"
                : bill.partyOrigin === "D"
                  ? "Democrat"
                  : "Republican"}
            </span>
          </>
        )}
        <span aria-hidden>·</span>
        <span>Updated {bill.updatedDate}</span>
      </div>

      {/* Impact tags */}
      {bill.impactTags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {bill.impactTags.map((tag) => (
            <span
              key={tag}
              className="text-[11px] bg-black/[.04] text-muted px-2 py-0.5 rounded-full"
            >
              {IMPACT_TAG_LABEL[tag]}
            </span>
          ))}
        </div>
      )}

      {/* Related projects. Surfaces the action to project edge.
          Rendered as a labeled row of subtle chips to match the impact
          tag / sponsor visual language. When onSelectProject is
          supplied, chips are buttons that pin the project in the panel. */}
      {relatedProjects.length > 0 && (
        <div>
          <div className="text-[11px] font-medium text-muted tracking-tight mb-2">
            Related projects
          </div>
          <div className="flex flex-wrap gap-1.5">
            {relatedProjects.map((f) => {
              const label = cleanOperator(f.developer) || f.location;
              const city = f.location ?? "";
              const inner = (
                <>
                  <span className="font-medium text-ink">{label}</span>
                  {city && city !== label && (
                    <span className="text-muted ml-1">· {city}</span>
                  )}
                </>
              );
              return onSelectProject ? (
                <button
                  key={f.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectProject(f);
                  }}
                  className="text-[11px] bg-black/[.04] hover:bg-black/[.08] text-muted hover:text-ink px-2 py-0.5 rounded-full tracking-tight transition-colors"
                >
                  {inner}
                </button>
              ) : (
                <span
                  key={f.id}
                  className="text-[11px] bg-black/[.04] text-muted px-2 py-0.5 rounded-full tracking-tight"
                >
                  {inner}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Sponsors — same row layout for state and federal. Federal rows
          additionally surface the FEC donor card; state rows are clean
          name lines so the two views feel like the same component. */}
      {sponsors.length > 0 && (
        <div>
          <div className="text-[11px] font-medium text-muted tracking-tight mb-2">
            Sponsors
          </div>
          <div className="flex flex-col gap-2">
            {sponsorProfiles.map(({ name, profile }) => (
              <SponsorRow
                key={name}
                name={name}
                profile={profile}
                billCategory={bill.category}
                isFederal={isFederal}
              />
            ))}
          </div>
        </div>
      )}

      {bill.voteTally && <VoteTally bill={bill} />}

      {/* Full-text link */}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="self-start inline-flex items-center gap-1 text-xs font-medium text-ink hover:underline"
        >
          Read full bill →
        </a>
      )}
    </div>
  );
}

function formatVoteDate(d: string): string {
  // "2026-01-20" → "Jan 20, 2026"
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${day}, ${y}`;
}

function VoteTally({ bill }: { bill: Legislation }) {
  const t = bill.voteTally!;
  const total = t.yea + t.nay;
  const yeaPct = total > 0 ? (t.yea / total) * 100 : 0;
  return (
    <div className="rounded-xl bg-black/[.02] p-3 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[11px] font-medium text-muted tracking-tight">
          Floor vote · {formatVoteDate(t.voteDate)}
        </div>
        <div className="text-[11px] text-muted">
          {t.yea}–{t.nay} {t.passed ? "Passed" : "Failed"}
        </div>
      </div>
      <div
        className="h-2 w-full rounded-full overflow-hidden bg-black/[.06] flex"
        aria-label={`${t.yea} yea, ${t.nay} nay`}
      >
        <span
          className="h-full bg-stance-favorable"
          style={{ width: `${yeaPct}%` }}
        />
        <span
          className="h-full bg-stance-restrictive"
          style={{ width: `${100 - yeaPct}%` }}
        />
      </div>
      <a
        href={`/politicians?bill=${encodeURIComponent(bill.id)}`}
        onClick={(e) => e.stopPropagation()}
        className="self-start text-[11px] text-ink hover:underline"
      >
        Show all {t.yea + t.nay + t.abstain + t.notVoting} votes →
      </a>
    </div>
  );
}

function SponsorRow({
  name,
  profile,
  billCategory,
  isFederal,
}: {
  name: string;
  profile: DonorProfile | null;
  billCategory: Legislation["category"];
  isFederal: boolean;
}) {
  // Plain row — used for state legislators (no FEC data) AND for federal
  // sponsors we couldn't match in the donor cache.
  if (!profile) {
    return (
      <div className="text-xs text-ink leading-snug">
        <span className="font-medium">{name}</span>
        {isFederal && (
          <span className="text-muted ml-2 text-[11px]">
            no donor match
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-black/[.02] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xs font-medium text-ink">
          {profile.name}{" "}
          <span className="text-muted font-normal">
            ({profile.party}-{profile.state})
          </span>
        </div>
        <div className="text-[11px] text-muted">
          {formatMoney(profile.totalRaised)} raised
        </div>
      </div>
      {profile.topDonors.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {profile.topDonors.slice(0, 3).map((d, i) => {
            const relevant = isDonorRelevant(d.industry, billCategory);
            return (
              <div
                key={`${d.name}-${i}`}
                className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[11px] ${
                  relevant ? "bg-stance-concerning/15" : ""
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-1 h-1 rounded-full flex-shrink-0 ${
                      relevant ? "bg-stance-concerning" : "bg-black/20"
                    }`}
                  />
                  <span className="truncate text-muted">{d.name}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-muted">{d.industry}</span>
                  <span className="text-ink font-medium">
                    {formatMoney(d.amount)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

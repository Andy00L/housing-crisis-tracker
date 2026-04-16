"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";
import { ALL_POLITICIANS } from "@/lib/politicians-data";
import type { Legislator } from "@/types";
import FadeInOnView from "@/components/ui/FadeInOnView";

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0] ?? "")
    .join("")
    .toUpperCase();
}

type Scope = "all" | "CA" | "US" | "GB" | "EU";

const SCOPES: Array<{ key: Scope; label: string }> = [
  { key: "all", label: "All" },
  { key: "CA", label: "Canada" },
  { key: "US", label: "United States" },
  { key: "GB", label: "United Kingdom" },
  { key: "EU", label: "European Parliament" },
];

const PREVIEW = 9;

/** Accent-fold to lowercase ASCII so pipeline-produced names like
 *  "François-Philippe Champagne" match the hand-picked list reliably.
 *  Without the fold, the set entry "francois-philippe champagne" would
 *  never collide with the French-spelled name and the +100 pin would
 *  silently miss. NFD decomposes combining marks so the `\u0300-\u036f`
 *  range strips them. */
function normalizeForPriority(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Hand-picked Canadian housing decision-makers. Verified against the
 * officials pipeline output on 2026-04-16. Ordering is by score, not by
 * position in this list, so additions are free; duplicates break the
 * matching contract, so keep this deduplicated.
 *
 * Why this exists: without a pin, the homepage featured row fills up with
 * whichever legislators have the highest data density (US senators with
 * donor records, EU rapporteurs with big vote histories). The top six
 * Canadian housing voices need to land on top of a Canada-first site.
 */
const FEATURED_PRIORITY = new Set(
  [
    "Mark Carney", // PM
    "Gregor Robertson", // Minister of Housing and Infrastructure
    "François-Philippe Champagne", // Minister of Finance
    "Doug Ford", // Ontario Premier
    "François Legault", // Quebec Premier
    "David Eby", // BC Premier
    "Danielle Smith", // Alberta Premier
    "Olivia Chow", // Toronto Mayor
    "Ken Sim", // Vancouver Mayor
    "Soraya Martinez Ferrada", // Montreal Mayor (since Nov 2025)
  ].map(normalizeForPriority),
);

// Dev-only sanity check. Guards against a future refactor silently
// dropping the Housing Minister from the pin list. Never ships to prod
// since process.env.NODE_ENV is dead code under next build.
if (process.env.NODE_ENV === "development") {
  if (!FEATURED_PRIORITY.has(normalizeForPriority("Gregor Robertson"))) {
    console.warn(
      "[PoliticiansOverview] Gregor Robertson missing from FEATURED_PRIORITY. Current Housing Minister should be featured.",
    );
  }
}

function featuredScore(p: Legislator): number {
  let s = 0;

  // Hand-picked priority — always pin these names to the top.
  if (FEATURED_PRIORITY.has(normalizeForPriority(p.name))) s += 100;

  if (p.summary && p.summary.length > 80) s += 30;
  s += Math.min(p.keyPoints?.length ?? 0, 4) * 2;

  // Heads of state and chamber leaders read first to most readers.
  if (p.chamber === "executive") s += 30;
  else if (p.chamber === "senate") s += 15;
  else if (p.chamber === "ep") s += 8;
  else if (p.chamber === "commons") s += 6;

  const role = p.role?.toLowerCase() ?? "";
  if (/president|prime minister|general secretary|speaker/.test(role)) s += 25;
  if (/leader|chair|ranking member|rapporteur|shadow/.test(role)) s += 10;
  if (/housing|zoning|planning|development|commerce|judiciary|energy|armed services/.test(role)) {
    s += 4;
  }

  const curated = p.role?.includes("·") ?? false;
  if (curated) s += 6;
  if (p.stance && p.stance !== "none") s += 3;
  if (p.alignment) s += 5;
  s += Math.min(p.votes?.length ?? 0, 6) * 1;
  if (p.photoUrl) s += 1;
  return s;
}

export default function PoliticiansOverview() {
  const [scope, setScope] = useState<Scope>("all");

  const rows = useMemo(() => {
    const pool =
      scope === "all"
        ? ALL_POLITICIANS
        : ALL_POLITICIANS.filter((p) => p.country === scope);
    return [...pool]
      .sort((a, b) => {
        const diff = featuredScore(b) - featuredScore(a);
        if (diff) return diff;
        return a.name.localeCompare(b.name);
      })
      .slice(0, PREVIEW);
  }, [scope]);

  const totals = useMemo(() => {
    const byCountry = { CA: 0, US: 0, GB: 0, EU: 0 };
    for (const p of ALL_POLITICIANS) {
      if (p.country && p.country in byCountry)
        byCountry[p.country as keyof typeof byCountry]++;
    }
    return byCountry;
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-1.5">
          {SCOPES.map((s) => {
            const active = scope === s.key;
            const count =
              s.key === "all"
                ? ALL_POLITICIANS.length
                : totals[s.key as keyof typeof totals];
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setScope(s.key)}
                className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                  active
                    ? "bg-ink text-white"
                    : "bg-black/[.04] text-muted hover:bg-black/[.08] hover:text-ink"
                }`}
              >
                {s.label}
                <span className={`ml-1.5 ${active ? "text-white/60" : "text-muted/70"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <Link
          href="/politicians?country=CA"
          className="text-xs text-muted hover:text-ink transition-colors"
        >
          View all →
        </Link>
      </div>

      <PersonTileGrid rows={rows} />
    </div>
  );
}

function PersonTileGrid({ rows }: { rows: Legislator[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = activeId ? rows.find((p) => p.id === activeId) ?? null : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map((p, i) => (
          <FadeInOnView key={p.id} delay={Math.min(i * 40, 320)}>
            <PersonTile
              p={p}
              isActive={p.id === activeId}
              onToggle={() => setActiveId((id) => (id === p.id ? null : p.id))}
            />
          </FadeInOnView>
        ))}
      </div>
      <PersonDetail politician={active} onClose={() => setActiveId(null)} />
    </div>
  );
}

function PersonDetail({
  politician,
  onClose,
}: {
  politician: Legislator | null;
  onClose: () => void;
}) {
  return (
    <div
      className="grid transition-[grid-template-rows] duration-[420ms] ease-[cubic-bezier(0.32,0.72,0,1)]"
      style={{ gridTemplateRows: politician ? "1fr" : "0fr" }}
      aria-hidden={!politician}
    >
      <div
        className={`overflow-hidden transition-opacity duration-[280ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${
          politician ? "opacity-100 delay-100" : "opacity-0"
        }`}
      >
        {politician && (
          <div className="mt-2 rounded-2xl bg-white shadow-[0_6px_20px_rgba(0,0,0,0.04),0_1px_4px_rgba(0,0,0,0.03)] p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <Avatar p={politician} />
                <div className="min-w-0">
                  <div className="text-[15px] font-medium text-ink tracking-tight">
                    {politician.name}
                  </div>
                  <div className="text-xs text-muted mt-0.5 leading-snug">
                    {simplifyRole(politician.role)}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="text-muted hover:text-ink shrink-0 mt-1"
              >
                <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M3 3L9 9M9 3L3 9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            {politician.summary && (
              <p className="text-sm text-ink leading-[1.55] max-w-prose">
                {trimToSentences(politician.summary, 2)}
              </p>
            )}

            {(politician.keyPoints?.length ?? 0) > 0 && (
              <ul className="flex flex-col gap-2">
                {politician.keyPoints!.slice(0, 3).map((pt, i) => (
                  <li
                    key={i}
                    className="flex gap-2.5 text-[13px] text-ink/80 leading-snug"
                  >
                    <span
                      className="mt-[.55em] w-1 h-1 rounded-full bg-ink/30 shrink-0"
                      aria-hidden
                    />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            )}

            <Link
              href={`/politicians?id=${encodeURIComponent(politician.id)}`}
              className="self-start text-xs text-muted hover:text-ink"
            >
              View full profile →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function trimToSentences(text: string, max: number): string {
  const matches = text.match(/[^.!?]+[.!?]/g);
  if (!matches || matches.length <= max) return text.trim();
  return matches.slice(0, max).join("").trim();
}

function simplifyRole(role: string): string {
  // Strip the "(D-NY-14)" / "(I-VT)" parenthetical — the party badge
  // below already conveys it, and the parenthetical crowds the tile.
  return role.replace(/\s*\([^)]*\)/g, "").trim();
}

function PersonTile({
  p,
  isActive,
  onToggle,
}: {
  p: Legislator;
  isActive: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isActive}
      className={`group rounded-2xl p-4 flex items-start gap-3 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] text-left ${
        isActive
          ? "bg-white shadow-[0_6px_20px_rgba(0,0,0,0.04),0_1px_4px_rgba(0,0,0,0.03)]"
          : "bg-bg/60 hover:bg-white hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(0,0,0,0.04),0_1px_4px_rgba(0,0,0,0.03)]"
      }`}
    >
      <Avatar p={p} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink tracking-tight truncate">
          {p.name}
        </div>
        <div className="text-xs text-muted mt-0.5 leading-snug line-clamp-2">
          {simplifyRole(p.role)}
        </div>
      </div>
    </button>
  );
}

function Avatar({ p }: { p: Legislator }) {
  const [errored, setErrored] = useState(false);
  if (p.photoUrl && !errored) {
    return (
      <Image
        src={p.photoUrl}
        alt=""
        width={40}
        height={40}
        sizes="40px"
        loading="lazy"
        className="w-10 h-10 rounded-full object-cover flex-shrink-0 bg-black/[.04]"
        onError={() => setErrored(true)}
      />
    );
  }
  const initials = initialsFor(p.name);
  return (
    <div className="w-10 h-10 rounded-full bg-black/[.04] flex items-center justify-center text-[11px] font-medium text-muted flex-shrink-0">
      {initials}
    </div>
  );
}

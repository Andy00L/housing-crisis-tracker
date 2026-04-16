"use client";

import { useState } from "react";
import { STANCE_LABEL, type Legislation, type Legislator } from "@/types";

interface KeyFiguresProps {
  figures: Legislator[];
  /** Bill list from the parent entity — used to surface bills the figure
   *  has sponsored inside the expanded card. Optional; nothing renders
   *  when omitted. */
  legislation?: Legislation[];
}

// Loose name match: a sponsor string from a bill matches a figure if the
// figure's last name appears in the sponsor (case-insensitive). Bills
// often list sponsors as "Sen. Padilla" / "Rep. Schiff (D-CA)" rather
// than the figure's exact display name, so we anchor on the last name
// and require ≥3 chars to avoid false positives.
function sponsorMatches(figure: Legislator, sponsor: string): boolean {
  const parts = figure.name.trim().split(/\s+/);
  const last = parts[parts.length - 1] ?? "";
  if (last.length < 3) return false;
  return sponsor.toLowerCase().includes(last.toLowerCase());
}

function findSponsoredBills(
  figure: Legislator,
  legislation: Legislation[],
): Legislation[] {
  return legislation.filter((bill) =>
    bill.sponsors?.some((s) => sponsorMatches(figure, s)),
  );
}

export default function KeyFigures({ figures, legislation }: KeyFiguresProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {figures.map((figure) => {
        const isOpen = openId === figure.id;
        const sponsored = legislation ? findSponsoredBills(figure, legislation) : [];

        return (
          <button
            key={figure.id}
            type="button"
            onClick={() => setOpenId(isOpen ? null : figure.id)}
            aria-expanded={isOpen}
            aria-controls={`figure-card-${figure.id}`}
            className={`w-full text-left rounded-2xl p-4 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
              isOpen
                ? "bg-bg shadow-[0_6px_18px_rgba(0,0,0,0.05),0_1px_4px_rgba(0,0,0,0.03)]"
                : "bg-bg/60 hover:bg-bg hover:shadow-[0_8px_22px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.03)] hover:-translate-y-0.5"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-ink tracking-tight">
                  {figure.name}
                </div>
                <div className="text-xs text-muted mt-1 leading-snug">
                  {figure.role}
                  {figure.party && figure.party.trim() !== "" && figure.party.trim() !== "—" && (
                    <>
                      <span aria-hidden> · </span>
                      {figure.party}
                    </>
                  )}
                </div>
              </div>
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden
                className={`flex-shrink-0 mt-1.5 text-muted transition-transform duration-300 ${
                  isOpen ? "rotate-180" : ""
                }`}
              >
                <path
                  d="M3 4.5l3 3 3-3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            {/* Smooth expand — grid-template-rows 0fr → 1fr */}
            <div
              id={`figure-card-${figure.id}`}
              className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
              style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
            >
              <div className="overflow-hidden">
                {isOpen && (
                  <div className="pt-4 mt-4 border-t border-black/[.06] flex flex-col gap-3">
                    <p className="text-sm text-ink/85 leading-snug">
                      {`${STANCE_LABEL[figure.stance]} on housing policy.`}
                    </p>

                    {sponsored.length > 0 && (
                      <div>
                        <div className="text-[11px] font-medium text-muted tracking-tight mb-2">
                          Sponsored bills
                        </div>
                        <ul className="flex flex-col gap-1.5">
                          {sponsored.map((bill) => {
                            const inner = (
                              <>
                                <span className="font-medium text-ink shrink-0">
                                  {bill.billCode}
                                </span>
                                <span className="text-muted truncate">
                                  {bill.title}
                                </span>
                              </>
                            );
                            return (
                              <li
                                key={bill.id}
                                className="flex items-baseline gap-2 text-xs"
                              >
                                {bill.sourceUrl ? (
                                  <a
                                    href={bill.sourceUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex items-baseline gap-2 min-w-0 hover:text-ink"
                                  >
                                    {inner}
                                  </a>
                                ) : (
                                  <span className="flex items-baseline gap-2 min-w-0">
                                    {inner}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    {sponsored.length === 0 && (
                      <p className="text-xs text-muted">
                        No sponsored bills on file in the current scope.
                      </p>
                    )}

                    <a
                      href={`/politicians?id=${encodeURIComponent(figure.id)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="self-start inline-flex items-center gap-1 text-[11px] text-ink hover:underline"
                    >
                      View full profile →
                    </a>
                  </div>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

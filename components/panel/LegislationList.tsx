"use client";

import { useState } from "react";
import type { HousingProject, Legislation } from "@/types";
import BillTimeline from "@/components/ui/BillTimeline";
import StanceBadge from "@/components/ui/StanceBadge";
import BillExpanded from "./BillExpanded";

interface LegislationListProps {
  legislation: Legislation[];
  /** Two-letter state code ("US", "VA", ...) for donor lookup. */
  stateCode?: string;
  /** Forwarded to BillExpanded. Enables clickable "Related projects"
   *  chips that open the project detail panel. */
  onSelectProject?: (f: HousingProject) => void;
}

export default function LegislationList({
  legislation,
  stateCode,
  onSelectProject,
}: LegislationListProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {legislation.map((bill) => {
        const isOpen = openId === bill.id;
        return (
          <button
            key={bill.id}
            type="button"
            onClick={() => setOpenId(isOpen ? null : bill.id)}
            className={`w-full text-left rounded-2xl p-4 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
              isOpen
                ? "bg-bg shadow-[0_6px_18px_rgba(0,0,0,0.05),0_1px_4px_rgba(0,0,0,0.03)]"
                : "bg-bg/60 hover:bg-bg hover:shadow-[0_8px_22px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.03)] hover:-translate-y-0.5"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted">{bill.billCode}</span>
                  <StanceBadge stance={bill.stance ?? "review"} size="sm" />
                </div>
                <div className="text-sm font-medium mt-1 text-ink tracking-tight">
                  {bill.title}
                </div>
              </div>
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                className={`flex-shrink-0 mt-1.5 text-muted transition-transform duration-300 ${
                  isOpen ? "rotate-180" : ""
                }`}
                aria-hidden
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
            <p className="text-xs text-muted mt-1.5 leading-relaxed">
              {bill.summary}
            </p>
            <BillTimeline stage={bill.stage} />

            {/* Smooth expand — grid-template-rows 0fr → 1fr trick */}
            <div
              className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
              style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
            >
              <div className="overflow-hidden">
                {isOpen && (
                  <BillExpanded
                    bill={bill}
                    stateCode={stateCode}
                    onSelectProject={onSelectProject}
                  />
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

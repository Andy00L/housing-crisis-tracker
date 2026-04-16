"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { REGION_LABEL, REGION_ORDER, type Region } from "@/types";
import type { BreadcrumbItem } from "./Breadcrumb";

interface DepthStepperProps {
  region: Region;
  onRegionChange: (region: Region) => void;
  /**
   * Breadcrumb-style segments describing the current drill path. The first
   * item MUST be the region label (e.g., "North America") — it gets
   * replaced by the region picker trigger, so the drill segments shown
   * inline start from `segments[1]`.
   */
  segments: BreadcrumbItem[];
}

export default function DepthStepper({
  region,
  onRegionChange,
  segments,
}: DepthStepperProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    function onDocPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setPickerOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPickerOpen(false);
    }
    document.addEventListener("mousedown", onDocPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  const drillSegments = segments.slice(1);
  const atTop = drillSegments.length === 0;

  return (
    <div
      ref={rootRef}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center"
    >
      {pickerOpen && (
        <div
          role="listbox"
          className="mb-2 min-w-[13rem] rounded-2xl bg-white/95 backdrop-blur-2xl shadow-[0_12px_40px_rgba(0,0,0,0.14),0_2px_10px_rgba(0,0,0,0.06)] border border-black/[.05] p-1 animate-[fadein_180ms_ease]"
        >
          {REGION_ORDER.map((r) => {
            const active = r === region;
            return (
              <button
                key={r}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onRegionChange(r);
                  setPickerOpen(false);
                }}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm tracking-tight transition-colors flex items-center gap-2.5 ${
                  active
                    ? "bg-bg/80 text-ink font-medium"
                    : "text-muted hover:bg-bg/60 hover:text-ink"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    active ? "bg-ink" : "bg-black/20"
                  }`}
                />
                {REGION_LABEL[r]}
              </button>
            );
          })}
        </div>
      )}

      <nav
        aria-label="Drill path"
        className="inline-flex items-center px-1.5 py-1.5 rounded-full bg-white/85 backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.1),0_2px_8px_rgba(0,0,0,0.04)] border border-black/[.04] max-w-[min(90vw,44rem)]"
      >
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={pickerOpen}
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs tracking-tight transition-colors flex-shrink-0 ${
            atTop
              ? "text-ink font-medium"
              : "text-muted hover:text-ink hover:bg-black/[.04]"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full transition-colors ${
              atTop ? "bg-ink" : "bg-ink/60"
            }`}
          />
          <span className="whitespace-nowrap">{REGION_LABEL[region]}</span>
          <svg
            width="9"
            height="9"
            viewBox="0 0 9 9"
            fill="none"
            className={`opacity-60 transition-transform ${
              pickerOpen ? "rotate-180" : ""
            }`}
            aria-hidden
          >
            <path
              d="M2.25 3.5L4.5 5.75L6.75 3.5"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {drillSegments.length > 0 && (
          <div className="flex items-center min-w-0 overflow-hidden">
            {drillSegments.map((seg, idx) => {
              const isLast = idx === drillSegments.length - 1;
              const clickable = !!seg.onClick && !isLast;
              return (
                <Fragment key={`${seg.label}-${idx}`}>
                  <span
                    className="text-muted/50 text-xs select-none flex-shrink-0 px-0.5"
                    aria-hidden
                  >
                    ›
                  </span>
                  {clickable ? (
                    <button
                      type="button"
                      onClick={seg.onClick}
                      className="px-2.5 py-1 rounded-full text-xs tracking-tight text-muted hover:text-ink hover:bg-black/[.04] transition-colors truncate max-w-[10rem]"
                    >
                      {seg.label}
                    </button>
                  ) : (
                    <span
                      className={`px-2.5 py-1 text-xs tracking-tight truncate max-w-[12rem] ${
                        isLast ? "text-ink font-medium" : "text-muted"
                      }`}
                    >
                      {seg.label}
                    </span>
                  )}
                </Fragment>
              );
            })}
          </div>
        )}
      </nav>
    </div>
  );
}

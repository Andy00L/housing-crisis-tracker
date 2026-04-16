"use client";

import { useState } from "react";
import type { NewsItem } from "@/types";

interface NewsSectionProps {
  news: NewsItem[];
}

function NewsCard({ item }: { item: NewsItem }) {
  const [open, setOpen] = useState(false);

  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      className={`w-full text-left rounded-2xl p-4 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
        open
          ? "bg-bg shadow-[0_6px_18px_rgba(0,0,0,0.05),0_1px_4px_rgba(0,0,0,0.03)]"
          : "bg-bg/60 hover:bg-bg hover:shadow-[0_8px_22px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.03)] hover:-translate-y-0.5"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-ink tracking-tight leading-snug">
            {item.headline}
          </div>
          <div className="text-xs text-muted mt-1.5 flex items-center gap-1.5">
            <span>{item.source}</span>
            <span aria-hidden>·</span>
            <span>{item.date}</span>
            {item.summarySource === "headline-only" && (
              <>
                <span aria-hidden>·</span>
                <span className="italic">from headline</span>
              </>
            )}
          </div>
        </div>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          className={`flex-shrink-0 mt-1.5 text-muted transition-transform duration-300 ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M3 4.5 L6 7.5 L9 4.5" />
        </svg>
      </div>

      {/* Smooth expand — grid-template-rows 0fr → 1fr */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          {open && (
            <div className="pt-4 mt-4 border-t border-black/[.06]">
              {item.summary && (
                <p className="text-xs text-muted leading-relaxed mb-3">
                  {item.summary}
                </p>
              )}
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs font-medium text-ink hover:underline"
              >
                Read article →
              </a>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

export default function NewsSection({ news }: NewsSectionProps) {
  return (
    <div className="flex flex-col gap-3">
      {news.map((item) => (
        <NewsCard key={item.id} item={item} />
      ))}
    </div>
  );
}

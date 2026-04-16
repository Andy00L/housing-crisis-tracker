"use client";

import type { HousingMetrics } from "@/types";

interface MetricsPanelProps {
  metrics?: HousingMetrics;
}

function StatCard({ label, value, suffix }: { label: string; value?: number | string; suffix?: string }) {
  if (value === undefined || value === null) return null;
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 rounded-lg bg-surface border border-border/50">
      <span className="text-[11px] text-muted uppercase tracking-wide">{label}</span>
      <span className="text-sm font-semibold text-ink tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
        {suffix && <span className="text-muted font-normal"> {suffix}</span>}
      </span>
    </div>
  );
}

export default function MetricsPanel({ metrics }: MetricsPanelProps) {
  if (!metrics) {
    return (
      <div className="px-4 py-6 text-center text-sm text-muted">
        No housing metrics available for this entity.
      </div>
    );
  }

  const currency = metrics.currency === "CAD" ? "C$" : metrics.currency === "GBP" ? "\u00a3" : "$";

  return (
    <div className="px-4 py-3 space-y-3">
      <h3 className="text-xs font-medium text-muted uppercase tracking-wide">Housing Metrics</h3>
      <div className="grid grid-cols-2 gap-2">
        {metrics.medianHomePrice !== undefined && (
          <StatCard
            label="Median Home Price"
            value={`${currency}${metrics.medianHomePrice.toLocaleString()}`}
          />
        )}
        {metrics.nhpiIndex !== undefined && (
          <StatCard
            label="Price Index (NHPI)"
            value={metrics.nhpiIndex}
          />
        )}
        {metrics.nhpiChangeYoY !== undefined && (
          <StatCard
            label="Price Change YoY"
            value={`${metrics.nhpiChangeYoY > 0 ? "+" : ""}${metrics.nhpiChangeYoY}%`}
          />
        )}
        {metrics.avgRent !== undefined && (
          <StatCard
            label="Median Rent"
            value={`${currency}${metrics.avgRent.toLocaleString()}`}
            suffix="/mo"
          />
        )}
        {metrics.vacancyRate !== undefined && (
          <StatCard label="Vacancy Rate" value={`${metrics.vacancyRate}%`} />
        )}
        {metrics.startsQuarterly !== undefined && (
          <StatCard
            label="Housing Starts"
            value={metrics.startsQuarterly.toLocaleString()}
            suffix="/ qtr"
          />
        )}
        {metrics.mortgageRate !== undefined && (
          <StatCard label="Mortgage Rate" value={`${metrics.mortgageRate}%`} />
        )}
        {metrics.priceToIncomeRatio !== undefined && (
          <StatCard label="Price-to-Income" value={metrics.priceToIncomeRatio} suffix="x" />
        )}
      </div>
      {metrics.lastUpdated && (
        <p className="text-[10px] text-muted text-right">Updated {metrics.lastUpdated}</p>
      )}
    </div>
  );
}

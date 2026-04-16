"use client";

import NumberFlow from "@number-flow/react";

interface MetricsStripProps {
  nhpiChangeYoY?: number;
  vacancyRate?: number;
  startsQuarterly?: number;
  medianHomePrice?: number;
  mortgageRate?: number;
  currency?: string;
}

function StatBox({
  label,
  value,
  suffix,
  prefix,
  decimals = 1,
}: {
  label: string;
  value: number | undefined;
  suffix?: string;
  prefix?: string;
  decimals?: number;
}) {
  if (value === undefined || value === null) return null;
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-2">
      <span className="text-xs text-muted uppercase tracking-wide">{label}</span>
      <span className="text-lg font-semibold text-ink tabular-nums">
        {prefix}
        <NumberFlow value={parseFloat(value.toFixed(decimals))} />
        {suffix}
      </span>
    </div>
  );
}

export default function MetricsStrip({
  nhpiChangeYoY,
  vacancyRate,
  startsQuarterly,
  medianHomePrice,
  mortgageRate,
  currency = "USD",
}: MetricsStripProps) {
  const prefix = currency === "CAD" ? "C$" : currency === "GBP" ? "\u00a3" : "$";

  return (
    <div className="flex flex-wrap justify-center gap-2 sm:gap-6 py-3 px-4 rounded-xl bg-surface/50 border border-border/50">
      <StatBox label="Home Price Index" value={nhpiChangeYoY} suffix="% YoY" />
      <StatBox label="Vacancy Rate" value={vacancyRate} suffix="%" />
      <StatBox
        label="Housing Starts"
        value={startsQuarterly}
        suffix=" / qtr"
        decimals={0}
      />
      <StatBox
        label="Median Price"
        value={medianHomePrice}
        prefix={prefix}
        suffix=""
        decimals={0}
      />
      <StatBox label="Mortgage Rate" value={mortgageRate} suffix="%" />
    </div>
  );
}

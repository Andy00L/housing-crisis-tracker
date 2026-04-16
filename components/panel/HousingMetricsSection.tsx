"use client";

import type { HousingMetrics } from "@/types";

interface HousingMetricsSectionProps {
  metrics: HousingMetrics;
}

/**
 * Compact housing metrics panel. Reads from `entity.housingMetrics` which
 * is populated by scripts/build-placeholder.ts from the StatsCan / CMHC
 * sync pipelines (data/housing/canada/*.json).
 *
 * Renders whatever subset of the metric fields is present. Missing
 * fields are skipped silently, they typically mean the upstream source
 * either doesn't publish that indicator at this geography or the sync
 * hasn't landed yet.
 */

function formatIndex(n: number | undefined): string | null {
  if (n == null || Number.isNaN(n)) return null;
  return n.toFixed(1);
}

function formatPercent(n: number | undefined): string | null {
  if (n == null || Number.isNaN(n)) return null;
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function formatCurrency(
  n: number | undefined,
  currency: string | undefined,
): string | null {
  if (n == null || Number.isNaN(n)) return null;
  const code = currency ?? "CAD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${code} ${Math.round(n).toLocaleString()}`;
  }
}

function formatCount(n: number | undefined): string | null {
  if (n == null || Number.isNaN(n)) return null;
  return Math.round(n).toLocaleString();
}

function formatRate(n: number | undefined): string | null {
  if (n == null || Number.isNaN(n)) return null;
  return `${n.toFixed(2)}%`;
}

interface StatRow {
  label: string;
  value: string;
  trend?: string | null;
}

function collectRows(metrics: HousingMetrics): StatRow[] {
  const rows: StatRow[] = [];

  const nhpi = formatIndex(metrics.nhpiIndex);
  if (nhpi) {
    rows.push({
      label: "New housing price index",
      value: nhpi,
      trend: formatPercent(metrics.nhpiChangeYoY),
    });
  }

  const median = formatCurrency(metrics.medianHomePrice, metrics.currency);
  if (median) {
    rows.push({ label: "Median home price", value: median });
  }

  if (metrics.priceToIncomeRatio != null) {
    rows.push({
      label: "Price to income ratio",
      value: metrics.priceToIncomeRatio.toFixed(2),
    });
  }

  const vacancy = formatRate(metrics.vacancyRate);
  if (vacancy) {
    rows.push({ label: "Rental vacancy rate", value: vacancy });
  }

  const rent = formatCurrency(metrics.avgRent, metrics.currency);
  if (rent) {
    rows.push({
      label: "Average rent",
      value: rent,
      trend: formatPercent(metrics.avgRentChangeYoY),
    });
  }

  const starts = formatCount(metrics.startsQuarterly);
  if (starts) {
    rows.push({ label: "Quarterly housing starts", value: starts });
  }

  const completions = formatCount(metrics.completionsQuarterly);
  if (completions) {
    rows.push({ label: "Quarterly completions", value: completions });
  }

  const mortgage = formatRate(metrics.mortgageRate);
  if (mortgage) {
    rows.push({ label: "Mortgage rate (30y)", value: mortgage });
  }

  return rows;
}

export default function HousingMetricsSection({
  metrics,
}: HousingMetricsSectionProps) {
  const rows = collectRows(metrics);

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted">
        Housing metrics not available for this jurisdiction yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2.5">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-3 py-1.5"
          >
            <span className="text-[11px] text-muted tracking-tight">
              {row.label}
            </span>
            <span className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-ink tracking-tight tabular-nums">
                {row.value}
              </span>
              {row.trend && (
                <span
                  className={`text-[11px] font-medium tabular-nums ${
                    row.trend.startsWith("-")
                      ? "text-[var(--color-stance-favorable)]"
                      : "text-[var(--color-stance-restrictive)]"
                  }`}
                >
                  {row.trend}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      {metrics.lastUpdated && (
        <p className="text-[10px] text-muted/70 tracking-tight">
          Last updated {metrics.lastUpdated}
          {metrics.currency ? ` . currency ${metrics.currency}` : ""}
        </p>
      )}
    </div>
  );
}

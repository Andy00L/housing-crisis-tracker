import { ENTITIES } from "@/lib/placeholder-data";
import type { Entity, Stage } from "@/types";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MIN_BILLS = 10;

type Bucket = "introduced" | "committee" | "floor" | "enacted";

const BUCKET_ORDER: Bucket[] = ["introduced", "committee", "floor", "enacted"];

const BUCKET_LABEL: Record<Bucket, string> = {
  introduced: "Introduced",
  committee: "Committee",
  floor: "Floor",
  enacted: "Enacted",
};

const BUCKET_BAR: Record<Bucket, string> = {
  introduced: "bg-muted/20",
  committee: "bg-amber-400",
  floor: "bg-blue-500",
  enacted: "bg-emerald-500",
};

/** Inline hex for legend dots so they stay visible at small sizes. */
const BUCKET_DOT: Record<Bucket, string> = {
  introduced: "#86868B",
  committee: "#fbbf24",
  floor: "#3b82f6",
  enacted: "#10b981",
};

type RegionKey =
  | "canada-federal"
  | "ca-provinces"
  | "us-federal"
  | "us-states"
  | "europe"
  | "asia-pacific";

const REGION_LABELS: Record<RegionKey, string> = {
  "canada-federal": "Canada Federal",
  "ca-provinces": "Canada Provinces",
  "us-federal": "US Federal",
  "us-states": "US States",
  europe: "Europe",
  "asia-pacific": "Asia-Pacific",
};

/** National / regional populations for per-capita comparison.
 *  Sub-national aggregates (ca-provinces, us-states) are excluded
 *  since they share the same population as their federal entity. */
const POPULATIONS: Partial<Record<RegionKey, number>> = {
  "canada-federal": 41_000_000,
  "us-federal": 334_000_000,
  europe: 448_000_000,
  "asia-pacific": 4_300_000_000,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function stageToBucket(stage: Stage | undefined | null): Bucket | null {
  switch (stage) {
    case "Filed":
      return "introduced";
    case "Committee":
      return "committee";
    case "Floor":
      return "floor";
    case "Enacted":
      return "enacted";
    case "Dead":
    case "Carried Over":
      return null;
    default:
      return "introduced";
  }
}

function classifyEntity(e: Entity): RegionKey | null {
  if (e.id === "canada-federal") return "canada-federal";
  if (e.id === "us-federal") return "us-federal";
  if (e.geoId?.startsWith("CA-")) return "ca-provinces";
  if (e.region === "na" && e.level === "state") return "us-states";
  if (e.region === "eu") return "europe";
  if (e.region === "asia") return "asia-pacific";
  return null;
}

interface RegionStats {
  key: RegionKey;
  label: string;
  counts: Record<Bucket, number>;
  funnelTotal: number;
  allBills: number;
  enacted: number;
  enactmentRate: number;
}

function buildStats(): RegionStats[] {
  const map = new Map<
    RegionKey,
    { counts: Record<Bucket, number>; allBills: number }
  >();

  for (const entity of ENTITIES) {
    const key = classifyEntity(entity);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        counts: { introduced: 0, committee: 0, floor: 0, enacted: 0 },
        allBills: 0,
      });
    }
    const data = map.get(key)!;
    for (const bill of entity.legislation) {
      data.allBills++;
      const bucket = stageToBucket(bill.stage);
      if (bucket) data.counts[bucket]++;
    }
  }

  const stats: RegionStats[] = [];
  for (const [key, data] of map) {
    const funnelTotal =
      data.counts.introduced +
      data.counts.committee +
      data.counts.floor +
      data.counts.enacted;
    if (funnelTotal < MIN_BILLS) continue;
    stats.push({
      key,
      label: REGION_LABELS[key],
      counts: data.counts,
      funnelTotal,
      allBills: data.allBills,
      enacted: data.counts.enacted,
      enactmentRate: funnelTotal > 0 ? data.counts.enacted / funnelTotal : 0,
    });
  }

  return stats.sort((a, b) => b.enactmentRate - a.enactmentRate);
}

function formatPerMillion(n: number): string {
  if (n >= 1) return n.toFixed(1);
  if (n >= 0.01) return n.toFixed(2);
  return n.toFixed(3);
}

/* ------------------------------------------------------------------ */
/*  Static data (computed once at module load from ENTITIES)           */
/* ------------------------------------------------------------------ */

const STATS = buildStats();

const PER_CAPITA = STATS.filter((s) => POPULATIONS[s.key] !== undefined)
  .map((s) => ({
    label: s.label,
    billsPerMillion: s.allBills / (POPULATIONS[s.key]! / 1_000_000),
  }))
  .sort((a, b) => b.billsPerMillion - a.billsPerMillion);

const MAX_PER_MILLION =
  PER_CAPITA.length > 0 ? PER_CAPITA[0].billsPerMillion : 1;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function LegislativeFunnel() {
  return (
    <div>
      {/* Legend pills */}
      <div className="flex flex-wrap gap-2 mb-8">
        {BUCKET_ORDER.map((b) => (
          <span
            key={b}
            className="inline-flex items-center gap-1.5 rounded-full bg-black/[.04] px-2.5 py-1 text-[11px] text-muted"
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: BUCKET_DOT[b] }}
            />
            {BUCKET_LABEL[b]}
          </span>
        ))}
      </div>

      {/* Funnel bars, sorted by enactment rate */}
      <div className="flex flex-col gap-5">
        {STATS.map((region) => {
          const pct = Math.round(region.enactmentRate * 100);
          return (
            <div key={region.key}>
              <div className="flex items-baseline justify-between gap-4 mb-1.5">
                <span className="text-sm font-medium text-ink">
                  {region.label}
                </span>
                <span className="text-[13px] text-muted">
                  {region.enacted} of {region.funnelTotal} enacted ({pct}%)
                </span>
              </div>
              <div className="flex h-3 w-full rounded-full overflow-hidden bg-black/[.04]">
                {BUCKET_ORDER.map((bucket) => {
                  const count = region.counts[bucket];
                  if (count === 0) return null;
                  const widthPct = (count / region.funnelTotal) * 100;
                  return (
                    <span
                      key={bucket}
                      className={`h-full ${BUCKET_BAR[bucket]}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bills per capita comparison */}
      {PER_CAPITA.length > 0 && (
        <div className="mt-16">
          <h3 className="text-lg font-semibold text-ink tracking-tight mb-6">
            Bills per capita
          </h3>
          <div className="flex flex-col gap-4">
            {PER_CAPITA.map((row) => {
              const widthPct =
                (row.billsPerMillion / MAX_PER_MILLION) * 100;
              return (
                <div key={row.label}>
                  <div className="flex items-baseline justify-between gap-4 mb-1">
                    <span className="text-sm text-ink">{row.label}</span>
                    <span className="text-[13px] text-muted">
                      {formatPerMillion(row.billsPerMillion)} per million
                    </span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-black/[.04]">
                    <div
                      className="h-full rounded-full bg-ink/20"
                      style={{ width: `${Math.max(widthPct, 0.5)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted mt-4 leading-relaxed max-w-lg">
            Bill counts reflect tracked housing legislation only. Different
            legislative systems produce bills at different rates. This is not
            a measure of policy effectiveness.
          </p>
        </div>
      )}
    </div>
  );
}

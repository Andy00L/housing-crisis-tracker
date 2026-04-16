import {
  IMPACT_TAG_LABEL,
  type Dimension,
  type ImpactTag,
} from "@/types";
import { DIMENSION_COLOR, DIMENSION_TAGS } from "@/lib/dimensions";

interface LensSection {
  title: string;
  groups: { dimension: Exclude<Dimension, "overall">; label: string }[];
}

const SECTIONS: LensSection[] = [
  {
    title: "Zoning",
    groups: [
      { dimension: "supply", label: "Supply" },
      { dimension: "environmental", label: "Environmental" },
      { dimension: "community-impact", label: "Community impact" },
    ],
  },
  {
    title: "Affordability",
    groups: [
      { dimension: "affordability", label: "Affordability" },
      { dimension: "rental-market", label: "Rental market" },
      { dimension: "ownership", label: "Ownership" },
      { dimension: "social-housing", label: "Social housing" },
    ],
  },
];

function uniq(tags: ImpactTag[]): ImpactTag[] {
  const seen = new Set<ImpactTag>();
  const out: ImpactTag[] = [];
  for (const t of tags) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export default function NuanceLegend() {
  return (
    <div className="bg-card border border-black/[.06] rounded-3xl p-6">
      <h3 className="text-sm font-semibold text-ink tracking-tight mb-1">
        Impact tags
      </h3>
      <p className="text-xs text-muted mb-6">
        Tags grouped by lens and dimension. Use the toggle above to recolor
        the map by any of these.
      </p>
      <div className="flex flex-col gap-8">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <div className="text-sm font-semibold text-ink tracking-tight mb-4">
              {section.title}
            </div>
            <div className="flex flex-col gap-5">
              {section.groups.map(({ dimension, label }) => {
                const tags = uniq(DIMENSION_TAGS[dimension]);
                const dotColor = DIMENSION_COLOR[dimension];
                return (
                  <div key={dimension}>
                    <div className="text-[13px] font-medium text-muted tracking-tight mb-2">
                      {label}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[11px] bg-black/[.04] text-muted px-2 py-0.5 rounded-full inline-flex items-center gap-1.5"
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: dotColor }}
                          />
                          {IMPACT_TAG_LABEL[tag]}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

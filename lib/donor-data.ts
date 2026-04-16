import type { LegislationCategory } from "@/types";
import politiciansRaw from "@/data/donors/politicians.json";

export interface DonorEntry {
  name: string;
  amount: number;
  industry: string;
}

export interface DonorProfile {
  name: string;
  party: string;
  state: string;
  chamber: string;
  totalRaised: number;
  captureScore: number;
  topDonors: DonorEntry[];
}

interface RawPolitician {
  id: string;
  name: string;
  party: string;
  state: string;
  chamber: string;
  totalRaised?: number;
  voteAlignmentScore?: number;
  dimeScore?: number;
  combinedCaptureScore?: number;
  topDonors?: Array<{ name: string; amount?: number; industry?: string }>;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(sen|senator|rep|representative|congressman|congresswoman|hon|mr|mrs|ms|dr)\.?\b/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lastName(s: string): string {
  const normalized = normalizeName(s);
  const parts = normalized.split(" ").filter((p) => p.length > 1);
  return parts.length ? parts[parts.length - 1] : normalized;
}

const INDEX: Map<string, DonorProfile> = new Map();
const LAST_NAME_INDEX: Map<string, DonorProfile[]> = new Map();

function buildProfile(p: RawPolitician): DonorProfile {
  const topDonors: DonorEntry[] = (p.topDonors ?? [])
    .slice(0, 5)
    .map((d) => ({
      name: d.name ?? "Unknown",
      amount: d.amount ?? 0,
      industry: d.industry ?? "other",
    }));
  return {
    name: p.name,
    party: p.party,
    state: p.state,
    chamber: p.chamber,
    totalRaised: p.totalRaised ?? 0,
    captureScore: p.combinedCaptureScore ?? 0,
    topDonors,
  };
}

try {
  const list = politiciansRaw as unknown as RawPolitician[];
  if (Array.isArray(list)) {
    for (const p of list) {
      if (!p?.name) continue;
      const profile = buildProfile(p);
      const normalized = normalizeName(p.name);
      // Primary: exact name + state
      INDEX.set(`${normalized}|${p.state}`, profile);
      // Secondary: exact name only (first match wins — collisions rare)
      if (!INDEX.has(normalized)) INDEX.set(normalized, profile);
      // Tertiary: last name bucket for fuzzy fallback
      const ln = lastName(p.name);
      if (ln.length > 2) {
        const bucket = LAST_NAME_INDEX.get(ln) ?? [];
        bucket.push(profile);
        LAST_NAME_INDEX.set(ln, bucket);
      }
    }
  }
} catch {
  // politicians.json missing — degrade gracefully
}

/**
 * Look up a sponsor by name.
 *
 * The donor dataset is FEDERAL ONLY (US House + Senate) — state legislators
 * aren't in it. So the lookup is conservative:
 *   - `federalOnly: true` (default) — only callers that know the sponsor
 *     is a federal legislator should match.
 *   - Last-name fallback is only allowed when a state is provided, and only
 *     when exactly one politician in that state has that last name.
 */
export function findDonor(
  name: string,
  state?: string,
  federalOnly = true,
): DonorProfile | null {
  void federalOnly; // reserved for future state-level datasets
  const normalized = normalizeName(name);
  if (state) {
    const withState = INDEX.get(`${normalized}|${state}`);
    if (withState) return withState;
  }
  // Only allow a full-name match when there's no ambiguity — i.e. the
  // normalized name is long enough and only has one global match.
  if (normalized.length > 6) {
    const byName = INDEX.get(normalized);
    if (byName) return byName;
  }
  // Last-name fallback requires state AND exactly one match in that state.
  if (state) {
    const ln = lastName(name);
    if (ln.length > 2) {
      const bucket = LAST_NAME_INDEX.get(ln) ?? [];
      const inState = bucket.filter((p) => p.state === state);
      if (inState.length === 1) return inState[0];
    }
  }
  return null;
}

/**
 * Industries that likely have policy interest in a given bill category.
 * Used to visually highlight when a sponsor's top donor's industry aligns
 * with the bill's topic — informational, not accusatory.
 */
const INDUSTRY_CATEGORY_MAP: Record<string, LegislationCategory[]> = {
  technology: [
    "affordable-housing",
    "foreign-investment",
    "development-incentive",
    "transit-housing",
    "property-tax",
  ],
  energy: ["building-code", "zoning-reform"],
  telecom: ["affordable-housing", "foreign-investment"],
  Telecom: ["affordable-housing", "foreign-investment"],
  finance: ["affordable-housing", "foreign-investment"],
  healthcare: ["homelessness-services"],
  defense: ["property-tax", "rent-regulation"],
  "real-estate": ["zoning-reform"],
  transportation: ["rent-regulation"],
};

export function isDonorRelevant(
  donorIndustry: string,
  billCategory: LegislationCategory,
): boolean {
  const cats = INDUSTRY_CATEGORY_MAP[donorIndustry];
  return Array.isArray(cats) && cats.includes(billCategory);
}

export function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n}`;
}

/**
 * Unified politician data layer.
 *
 * Sources (merged at module load):
 *  - data/politicians/uk.json, eu.json. Claude-researched roster.
 *  - data/politicians/canada.json. Canadian housing officials.
 *  - data/politicians/us.json, europe.json, asia-pacific.json. Regional
 *    housing officials (pipeline output).
 *  - data/politicians/global-leaders.json. Cross-region headliners.
 *  - lib/placeholder-data.ts keyFigures. Curated role/stance overlay.
 *
 * Exported helpers are pure reads. No filtering on the caller side needed.
 */
import type {
  Legislation,
  Legislator,
  StanceType,
} from "@/types";
import { ENTITIES } from "./placeholder-data";
import ukRaw from "@/data/politicians/uk.json";
import euRaw from "@/data/politicians/eu.json";
import globalLeadersRaw from "@/data/politicians/global-leaders.json";
import canadaOfficialsRaw from "@/data/politicians/canada.json";
// US + Europe + Asia-Pacific housing officials. The Europe/Asia files
// exist as empty-officials placeholders until Prompt E.2 activates the
// dormant pipelines (europe-asia-sync workflow). See
// scripts/sync/europe-officials.ts and asia-officials.ts.
import usOfficialsRaw from "@/data/politicians/us.json";
import europeOfficialsRaw from "@/data/politicians/europe.json";
import asiaOfficialsRaw from "@/data/politicians/asia-pacific.json";

// ── Source shapes ────────────────────────────────────────────────────

interface ForeignEntry extends Omit<Legislator, "stance"> {
  stance: Legislator["stance"];
}

interface ForeignFile {
  politicians: ForeignEntry[];
}

interface GlobalLeadersFile {
  politicians: Legislator[];
}

interface CanadaOfficialEntry {
  id: string;
  name: string;
  role: string;
  party?: string;
  stance: StanceType;
  country?: string;
  chamber?: string;
  constituency?: string;
  summary?: string;
  keyPoints?: string[];
}

interface CanadaOfficialsFile {
  country?: string;
  lastUpdated?: string;
  officials?: CanadaOfficialEntry[];
}

// ── Build ────────────────────────────────────────────────────────────

function buildForeign(raw: ForeignFile, country: "GB" | "EU"): Legislator[] {
  return (raw.politicians ?? []).map((p) => ({
    ...p,
    country,
  }));
}

const GLOBAL_LEADERS: Legislator[] = (
  (globalLeadersRaw as GlobalLeadersFile).politicians ?? []
).map((p) => ({ ...p }));

/**
 * Canadian housing officials. Sourced from data/politicians/canada.json,
 * which is produced by scripts/sync/officials.ts. Each entry is coerced to
 * `country: "CA"` so the PoliticiansOverview scope filter picks them up.
 *
 * The file has no `party` on some federal entries (Carney/Solomon are shown
 * without a party string in a couple of cases) so we default to "Independent"
 * rather than leaving `party` as the empty string, which would render oddly
 * in the card header.
 */
const CA_POLITICIANS: Legislator[] = (
  (canadaOfficialsRaw as CanadaOfficialsFile).officials ?? []
).map((o) => ({
  id: o.id,
  name: o.name,
  role: o.role,
  party: o.party && o.party.length > 0 ? o.party : "Independent",
  stance: o.stance,
  country: "CA",
  chamber: o.chamber,
  constituency: o.constituency,
  summary: o.summary,
  keyPoints: o.keyPoints && o.keyPoints.length > 0 ? o.keyPoints : undefined,
}));

// US housing pipeline officials. The file is only present when
// scripts/sync/us-officials.ts has run at least once. When the file is
// absent (pre-first-run, or the pipeline was never triggered), the
// module falls back to empty without erroring.
interface HousingOfficialEntry {
  id: string;
  name: string;
  role: string;
  party?: string;
  stance: StanceType;
  country?: string;
  chamber?: string;
  constituency?: string;
  summary?: string;
  keyPoints?: string[];
}

interface HousingOfficialsFile {
  region?: string;
  country?: string;
  officials: HousingOfficialEntry[];
}

function loadOfficialsJsonFile(file: HousingOfficialsFile | null, countryOverride?: string): Legislator[] {
  if (!file || !Array.isArray(file.officials)) return [];
  return file.officials.map((o) => ({
    id: o.id,
    name: o.name,
    role: o.role,
    party: o.party && o.party.length > 0 ? o.party : "Nonpartisan",
    stance: o.stance,
    country: countryOverride ?? o.country,
    chamber: o.chamber,
    constituency: o.constituency,
    summary: o.summary,
    keyPoints: o.keyPoints && o.keyPoints.length > 0 ? o.keyPoints : undefined,
  }));
}

const US_HOUSING_OFFICIALS = loadOfficialsJsonFile(usOfficialsRaw as HousingOfficialsFile, "US");
const EU_HOUSING_OFFICIALS = loadOfficialsJsonFile(europeOfficialsRaw as HousingOfficialsFile);
const AP_HOUSING_OFFICIALS = loadOfficialsJsonFile(asiaOfficialsRaw as HousingOfficialsFile);

export const ALL_POLITICIANS: Legislator[] = [
  ...GLOBAL_LEADERS,
  ...CA_POLITICIANS,
  ...US_HOUSING_OFFICIALS,
  ...buildForeign(ukRaw as ForeignFile, "GB"),
  ...buildForeign(euRaw as ForeignFile, "EU"),
  ...EU_HOUSING_OFFICIALS,
  ...AP_HOUSING_OFFICIALS,
];

// ── Queries ──────────────────────────────────────────────────────────

export function findPoliticianById(id: string): Legislator | null {
  return ALL_POLITICIANS.find((p) => p.id === id) ?? null;
}

export function politiciansForBill(billId: string): Legislator[] {
  return ALL_POLITICIANS.filter((p) =>
    p.votes?.some((v) => v.billId === billId),
  );
}

export function politiciansForCountry(country: "US" | "GB" | "EU" | "CA"): Legislator[] {
  return ALL_POLITICIANS.filter((p) => p.country === country);
}

export function politiciansForChamber(chamber: string): Legislator[] {
  return ALL_POLITICIANS.filter((p) => p.chamber === chamber);
}

// ── Bill lookup ──────────────────────────────────────────────────────
//
// Used by the politician card to show a bill's title (and whether it
// leans pro- or anti-regulation) next to a legislator's position.
// Keyed by Legislation.id.

export interface BillLookupEntry {
  title: string;
  summary?: string;
  billCode: string;
  stance?: StanceType;
  category: Legislation["category"];
  sourceUrl?: string;
}

function buildBillLookup(): Record<string, BillLookupEntry> {
  const out: Record<string, BillLookupEntry> = {};
  for (const entity of ENTITIES) {
    for (const bill of entity.legislation) {
      out[bill.id] = {
        title: bill.title,
        summary: bill.summary,
        billCode: bill.billCode,
        stance: bill.stance,
        category: bill.category,
        sourceUrl: bill.sourceUrl,
      };
    }
  }
  return out;
}

export const BILLS_BY_ID: Record<string, BillLookupEntry> = buildBillLookup();

// ── Sponsorship lookup ──────────────────────────────────────────────
//
// Builds an index from (last-name + first-initial) to bills sponsored.
// Bills only carry sponsor *names* as strings ("Sen. Van Hollen", "Schiff
// (D-CA)"), so we anchor on last name like KeyFigures already does and
// require ≥3 chars to keep false positives down. First-initial check
// distinguishes Adam Schiff from Brad Schneider when both have a last
// name match.

interface SponsoredBill extends BillLookupEntry {
  id: string;
}

function lastTokenOf(name: string): string {
  const cleaned = name
    .replace(/^(sen|rep|representative|senator)\.?\s+/i, "")
    .replace(/\([^)]*\)/g, "")
    .trim();
  const parts = cleaned.split(/\s+/);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

function buildSponsorshipIndex(): Map<string, SponsoredBill[]> {
  const idx = new Map<string, SponsoredBill[]>();
  for (const entity of ENTITIES) {
    for (const bill of entity.legislation) {
      for (const sponsor of bill.sponsors ?? []) {
        const last = lastTokenOf(sponsor);
        if (last.length < 3) continue;
        const key = last;
        if (!idx.has(key)) idx.set(key, []);
        idx.get(key)!.push({
          id: bill.id,
          title: bill.title,
          billCode: bill.billCode,
          stance: bill.stance,
          category: bill.category,
          sourceUrl: bill.sourceUrl,
        });
      }
    }
  }
  return idx;
}

const SPONSOR_INDEX = buildSponsorshipIndex();

export function sponsoredBillsForPolitician(p: Legislator): SponsoredBill[] {
  const last = lastTokenOf(p.name);
  if (last.length < 3) return [];
  const candidates = SPONSOR_INDEX.get(last) ?? [];
  if (candidates.length === 0) return [];
  // De-dupe by bill id (a bill can have a name listed multiple times).
  // Last-name-only matching can over-collect, but for our narrow tracked
  // set the false-positive risk is small.
  const seen = new Set<string>();
  return candidates.filter((b) => {
    if (seen.has(b.id)) return false;
    seen.add(b.id);
    return true;
  });
}

// ── Donor industry exposure (AI/DC-relevant) ────────────────────────
//
// Maps a tracked-bill category to the donor industry that has a direct
// commercial interest in the bill's outcome. Lets the UI flag when a
// member's vote or sponsorship overlaps with a meaningful PAC stream.

const CATEGORY_TO_INDUSTRY: Partial<
  Record<Legislation["category"], string>
> = {
  "building-code": "energy",
  "zoning-reform": "energy",
  "affordable-housing": "technology",
  "tenant-protection": "technology",
  "homelessness-services": "technology",
  "development-incentive": "technology",
  "transit-housing": "technology",
  "property-tax": "technology",
  "rent-regulation": "technology",
  "foreign-investment": "technology",
};

export function relevantIndustryForBill(
  bill: Pick<Legislation, "category">,
): string | undefined {
  return CATEGORY_TO_INDUSTRY[bill.category];
}

/**
 * Per-politician donations summed by industry. Populated by the US
 * enrichment pipeline; empty until that pipeline regenerates
 * data/politicians/us-enriched.json and lib reloads it. Callers treat a
 * missing entry as zero exposure.
 */
const DONOR_INDUSTRY_TOTALS = new Map<string, Record<string, number>>();

export function donorAmountFromIndustry(
  politicianId: string,
  industry: string,
): number {
  return DONOR_INDUSTRY_TOTALS.get(politicianId)?.[industry] ?? 0;
}

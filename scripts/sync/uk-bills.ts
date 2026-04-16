/**
 * Fetch UK housing legislation from the Parliament Bills API.
 *
 * Output: data/legislation/uk/bills.json
 * Cache:  data/raw/uk-bills/
 * Auth:   None
 */

import "../env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ImpactTag, LegislationCategory, Stage, StanceType } from "@/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CACHE_DIR = join(ROOT, "data/raw/uk-bills");
const OUT_PATH = join(ROOT, "data/legislation/uk/bills.json");

mkdirSync(CACHE_DIR, { recursive: true });

const BASE = "https://bills-api.parliament.uk/api/v1/Bills";
const KEYWORDS = ["housing", "planning", "tenant", "rent", "affordable", "homelessness", "leasehold"];
const PAGE_SIZE = 20;

// ── Types ────────────────────────────────────────────────────────────
interface UkBill {
  billId: number;
  shortTitle: string;
  longTitle?: string;
  currentHouse: string;
  originatingHouse: string;
  lastUpdate: string;
  isAct: boolean;
  isDefeated: boolean;
  billWithdrawn: string | null;
  currentStage?: {
    description: string;
    house: string;
  };
  sponsors?: Array<{
    member: { name: string; party: string; memberPhoto?: string };
  }>;
}

interface SearchResponse {
  items: UkBill[];
  totalResults: number;
}

// ── Fetch + cache ────────────────────────────────────────────────────
async function searchBills(keyword: string): Promise<UkBill[]> {
  const slug = keyword.replace(/\s+/g, "_");
  const cachePath = join(CACHE_DIR, `search_${slug}.json`);

  if (existsSync(cachePath)) {
    console.log(`  [cache hit] ${slug}`);
    return JSON.parse(readFileSync(cachePath, "utf8"));
  }

  const all: UkBill[] = [];
  let skip = 0;

  while (true) {
    const url = `${BASE}?SearchTerm=${encodeURIComponent(keyword)}&SortOrder=DateUpdatedDescending&Skip=${skip}&Take=${PAGE_SIZE}`;
    console.log(`  [fetch] ${keyword} skip=${skip}`);
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  UK Bills API ${res.status} for "${keyword}"`);
      break;
    }
    const data = (await res.json()) as SearchResponse;
    all.push(...data.items);
    if (all.length >= data.totalResults || data.items.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }

  writeFileSync(cachePath, JSON.stringify(all, null, 2));
  return all;
}

// ── Stage mapping ────────────────────────────────────────────────────
function mapStage(bill: UkBill): Stage {
  if (bill.isAct) return "Enacted";
  if (bill.isDefeated || bill.billWithdrawn) return "Dead";
  const desc = (bill.currentStage?.description ?? "").toLowerCase();
  if (desc.includes("royal assent")) return "Enacted";
  if (desc.includes("3rd reading") || desc.includes("report stage")) return "Floor";
  if (desc.includes("2nd reading")) return "Floor";
  if (desc.includes("committee")) return "Committee";
  if (desc.includes("1st reading")) return "Filed";
  return "Filed";
}

// ── Classification ───────────────────────────────────────────────────
function classifyCategory(title: string): LegislationCategory {
  const t = title.toLowerCase();
  if (/planning|zoning|density|build/.test(t)) return "zoning-reform";
  if (/rent|leaseh|tenant|renter/.test(t)) return "tenant-protection";
  if (/affordab|social hous|co.?op/.test(t)) return "affordable-housing";
  if (/homeless|rough sleep|shelter/.test(t)) return "homelessness-services";
  if (/building (safety|standard|regulat)/.test(t)) return "building-code";
  if (/property tax|council tax|stamp duty/.test(t)) return "property-tax";
  if (/foreign|non.?dom/.test(t)) return "foreign-investment";
  if (/transit|transport|rail/.test(t)) return "transit-housing";
  if (/evict/.test(t)) return "rent-regulation";
  return "zoning-reform";
}

function classifyTags(title: string): ImpactTag[] {
  const tags: ImpactTag[] = [];
  const t = title.toLowerCase();
  if (/affordab|social/.test(t)) tags.push("affordability");
  if (/tenant|rent|lease/.test(t)) tags.push("rent-stabilization");
  if (/planning|density|build/.test(t)) tags.push("density");
  if (/homeless|shelter/.test(t)) tags.push("homelessness");
  if (/heritage|listed|conservation/.test(t)) tags.push("heritage-protection");
  if (/first.?time|help to buy/.test(t)) tags.push("first-time-buyer");
  if (/community/.test(t)) tags.push("community-opposition");
  return tags.length > 0 ? tags.slice(0, 5) : ["affordability"];
}

function deriveStance(title: string, stage: Stage): StanceType {
  const t = title.toLowerCase();
  if (/restrict|ban|moratorium|freeze/.test(t)) return stage === "Enacted" ? "restrictive" : "concerning";
  if (/reform|build|supply|accelerat/.test(t)) return "favorable";
  if (/review|study|commission|inquiry/.test(t)) return "review";
  return "review";
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log("[uk-bills] Fetching from UK Parliament Bills API...");

  const seen = new Map<number, UkBill>();
  for (const kw of KEYWORDS) {
    const bills = await searchBills(kw);
    for (const b of bills) {
      if (!seen.has(b.billId)) seen.set(b.billId, b);
    }
  }
  console.log(`  ${seen.size} unique bills across ${KEYWORDS.length} keywords`);

  const legislation = Array.from(seen.values()).map((b) => {
    const title = b.shortTitle;
    const stage = mapStage(b);
    const category = classifyCategory(title);
    const impactTags = classifyTags(title);
    const stance = deriveStance(title, stage);
    const sponsors = (b.sponsors ?? []).map((s) => s.member?.name).filter(Boolean);

    return {
      id: `uk-${b.billId}`,
      billCode: `UK-${b.billId}`,
      title,
      summary: b.longTitle ?? title,
      stage,
      stance,
      impactTags,
      category,
      updatedDate: b.lastUpdate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      sourceUrl: `https://bills.parliament.uk/bills/${b.billId}`,
      sponsors,
    };
  });

  // Sort by stage rank then date
  const STAGE_RANK: Record<string, number> = { Enacted: 5, Floor: 4, Committee: 3, Filed: 2, "Carried Over": 1, Dead: 0 };
  legislation.sort((a, b) => (STAGE_RANK[b.stage] ?? 0) - (STAGE_RANK[a.stage] ?? 0) || b.updatedDate.localeCompare(a.updatedDate));

  const output = {
    country: "United Kingdom",
    countryCode: "GB",
    region: "eu",
    lastUpdated: new Date().toISOString().slice(0, 10),
    legislation,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
  console.log(`[uk-bills] Wrote ${legislation.length} bills → ${OUT_PATH}`);
}

main().catch((err) => { console.error(err); process.exit(1); });

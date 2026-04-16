/**
 * Research Asia-Pacific housing ministers. Dormant by default.
 *
 * Exits immediately unless EXECUTE_ASIA=1. Reserved for Prompt E.2.
 *
 * Output: data/politicians/asia-pacific.json
 * Structure mirrors europe-officials.ts exactly.
 */

import "../env.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import type { Legislator, StanceType } from "@/types";
import { resilientFetch } from "@/lib/resilient-fetch";
import { startRunReport } from "@/lib/resilience/run-report";

if (process.env.EXECUTE_ASIA !== "1") {
  console.log("[asia-officials] Dormant. Set EXECUTE_ASIA=1 to run.");
  process.exit(0);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const OUT_PATH = join(ROOT, "data/politicians/asia-pacific.json");

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0";

interface CanonicalEntry {
  id: string;
  role: string;
  country: string;
  url: string;
  nameSelectors: string[];
  fallback: { name: string; party: string };
}

// Verified 2026-04-16. When Prompt E.2 turns this on, re-check the
// fallbacks against the canonical URLs below.
const CANONICALS: CanonicalEntry[] = [
  {
    id: "ap-jp-mlit-minister",
    role: "Minister of Land, Infrastructure, Transport and Tourism",
    country: "JP",
    url: "https://www.mlit.go.jp/en/",
    nameSelectors: ["h2", "h3"],
    fallback: { name: "Tetsuo Saito", party: "Komeito" },
  },
  {
    id: "ap-kr-molit-minister",
    role: "Minister of Land, Infrastructure and Transport",
    country: "KR",
    url: "https://www.molit.go.kr/english/USR/WPGE0201/m_35030/DTL.jsp",
    nameSelectors: ["h2", "h3"],
    fallback: { name: "Park Sang-woo", party: "Democratic Party" },
  },
  {
    id: "ap-cn-mohurd-minister",
    role: "Minister of Housing and Urban-Rural Development",
    country: "CN",
    url: "http://www.mohurd.gov.cn/",
    nameSelectors: ["h2", "h3"],
    fallback: { name: "Ni Hong", party: "Communist Party of China" },
  },
  {
    id: "ap-in-mohua-minister",
    role: "Minister of Housing and Urban Affairs",
    country: "IN",
    url: "https://mohua.gov.in/",
    nameSelectors: ["h2", "h3"],
    fallback: { name: "Manohar Lal Khattar", party: "BJP" },
  },
  {
    id: "ap-id-pupr-minister",
    role: "Minister of Public Works and Housing",
    country: "ID",
    url: "https://www.pu.go.id/",
    nameSelectors: ["h2", "h3"],
    fallback: { name: "Dody Hanggodo", party: "Indonesia Onward Coalition" },
  },
  {
    id: "ap-tw-cpami-minister",
    role: "Minister, Construction and Planning Agency",
    country: "TW",
    url: "https://www.cpami.gov.tw/",
    nameSelectors: ["h2", "h3"],
    fallback: { name: "Chen Chun-Jung", party: "DPP" },
  },
  {
    id: "ap-au-housing-minister",
    role: "Minister for Housing",
    country: "AU",
    url: "https://www.housing.gov.au/",
    nameSelectors: ["h2", "h3"],
    fallback: { name: "Clare O'Neil", party: "Labor" },
  },
];

function canonicalSource(url: string): import("@/lib/resilience/types").SourceName | null {
  try {
    const host = new URL(url).hostname;
    if (
      host.endsWith(".go.jp") || host.endsWith(".go.kr") ||
      host.endsWith(".gov.cn") || host.endsWith(".gov.in") ||
      host.endsWith(".go.id") || host.endsWith(".gov.tw") ||
      host.endsWith(".gov.au") || host.endsWith(".housing.gov.au") ||
      host.endsWith(".mlit.go.jp") || host.endsWith(".molit.go.kr") ||
      host.endsWith(".cpami.gov.tw") || host.endsWith(".pu.go.id") ||
      host.endsWith(".mohurd.gov.cn") || host.endsWith(".mohua.gov.in")
    ) {
      return "canada-ca"; // reuse generic gov bucket; see europe-officials.ts
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchCanonical(url: string): Promise<string | null> {
  const source = canonicalSource(url);
  if (!source) return null;
  const res = await resilientFetch<string>(source, url, {
    expectContentType: "text/html",
    init: {
      headers: {
        "user-agent": BROWSER_UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    },
  });
  if (!res.ok) {
    console.warn(`[asia-officials] ${url} unreachable: ${res.reason.kind}`);
    return null;
  }
  return typeof res.data === "string" ? res.data : null;
}

function parseName(html: string, entry: CanonicalEntry): string | null {
  const $ = cheerio.load(html);
  for (const sel of entry.nameSelectors) {
    const matches = $(sel);
    if (matches.length === 0) continue;
    for (const el of matches.toArray()) {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (!text || text.length < 3 || text.length > 80) continue;
      if (/[\p{L}]{2,}\s+[\p{L}]{2,}/u.test(text)) return text;
    }
  }
  return null;
}

async function main() {
  const report = startRunReport("asia-officials");
  const out: Legislator[] = [];
  const notes: string[] = [];

  for (const entry of CANONICALS) {
    report.incrementTotal(1);
    let name = entry.fallback.name;
    let source: "canonical" | "fallback" = "fallback";
    try {
      const html = await fetchCanonical(entry.url);
      if (html) {
        const parsed = parseName(html, entry);
        if (parsed && parsed.length <= 80) {
          name = parsed;
          source = "canonical";
        } else {
          notes.push(`${entry.id}: canonical parse missed; using fallback`);
        }
      } else {
        notes.push(`${entry.id}: canonical unreachable; using fallback`);
      }
    } catch (err) {
      notes.push(`${entry.id}: error: ${(err as Error).message}`);
    }

    const stance: StanceType = "review";
    out.push({
      id: entry.id,
      name,
      role: entry.role,
      party: entry.fallback.party,
      stance,
      country: entry.country,
      chamber: "executive",
      summary: `${entry.role} (${entry.country}). Collected by dormant Asia-Pacific pipeline; full enrichment pending Prompt E.2.`,
      keyPoints: [],
    });
    report.noteSuccess(entry.id);
    console.log(`  [ok] ${entry.id}: ${name} (${source})`);
  }

  for (const note of notes) report.addNote(note);

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        region: "asia-pacific",
        lastUpdated: new Date().toISOString().slice(0, 10),
        officials: out,
      },
      null,
      2,
    ),
    { encoding: "utf8" },
  );
  console.log(`[asia-officials] wrote ${out.length} officials → ${OUT_PATH}`);
  report.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

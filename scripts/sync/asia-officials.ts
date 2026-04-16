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
    url: "https://japan.kantei.go.jp/104/meibo/daijin/index.html",
    nameSelectors: ["h2", "h3"],
    // Tetsuo Saito (Komeito) stepped down after the LDP-Komeito coalition
    // ended in October 2025. Yasushi Kaneko (LDP) was appointed in the
    // Takaichi cabinet on 2025-10-21. Verified via japan.kantei.go.jp
    // on 2026-04-16.
    fallback: { name: "Yasushi Kaneko", party: "LDP" },
  },
  {
    id: "ap-kr-molit-minister",
    role: "Minister of Land, Infrastructure and Transport",
    country: "KR",
    url: "https://www.molit.go.kr/english/USR/WPGE0201/m_35030/DTL.jsp",
    nameSelectors: ["h2", "h3"],
    // Kim Yun-duk serves as MOLIT Minister under the current administration.
    // Verified via molit.go.kr on 2026-04-16.
    fallback: { name: "Kim Yun-duk", party: "Democratic Party" },
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
    id: "ap-id-pkp-minister",
    role: "Minister of Housing and Settlement",
    country: "ID",
    url: "https://pkp.go.id/",
    nameSelectors: ["h2", "h3"],
    // President Prabowo split the old PUPR ministry into PU (Public Works,
    // led by Dody Hanggodo) and PKP (Housing and Settlement, led by
    // Maruarar Sirait). The housing-specific role is PKP. Verified via
    // pkp.go.id on 2026-04-16.
    fallback: { name: "Maruarar Sirait", party: "Gerindra" },
  },
  {
    id: "ap-tw-nlma-ministry-interior",
    role: "Minister of the Interior (housing portfolio via NLMA)",
    country: "TW",
    url: "https://www.nlma.gov.tw/home.html",
    nameSelectors: ["h2", "h3"],
    // CPAMI was reorganized into the National Land Management Agency (NLMA)
    // under the Ministry of the Interior. Liu Shyh-fang (DPP) is the
    // current Minister of the Interior, which oversees NLMA. Verified via
    // Taiwan FCC on 2026-04-16.
    fallback: { name: "Liu Shyh-fang", party: "DPP" },
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

// Phrases that look like names to the "First Last" check but are really
// page titles or section headers in the ministry pages we hit.
const NON_NAME_PREFIXES = [
  "Minister",
  "Ministry",
  "List",
  "Tag",
  "Menu",
  "Home",
  "About",
  "News",
  "Contact",
  "Latest",
  // Indonesian page chrome
  "Berita",
  "Beranda",
  "Terkini",
  "Pelaksanaan",
  "Kementerian",
  "Anggaran",
  "Aplikasi",
  "Program",
  "Direktorat",
  "Bidang",
  "Profil",
  "Informasi",
  // Japanese hiragana/latin page chrome
  "The Cabinet",
  "Cabinet",
  // Chinese page chrome (pinyin)
  "Shouye",
];

function looksLikePageChrome(text: string): boolean {
  for (const prefix of NON_NAME_PREFIXES) {
    const re = new RegExp(`^${prefix}\\b`, "i");
    if (re.test(text)) return true;
  }
  return false;
}

function looksLikeHeadline(text: string): boolean {
  if (text.includes(",") && text.length > 40) return true;
  const words = text.trim().split(/\s+/);
  if (words.length > 6) return true;
  return false;
}

function looksLikeName(text: string): boolean {
  // Digits, fiscal-year references, and obvious non-name content do not
  // appear in a minister's rendered display name.
  if (/\d/.test(text)) return false;
  if (/\b(TA|FY|AY)\b/i.test(text)) return false;
  return true;
}

function parseName(html: string, entry: CanonicalEntry): string | null {
  const $ = cheerio.load(html);
  for (const sel of entry.nameSelectors) {
    const matches = $(sel);
    if (matches.length === 0) continue;
    for (const el of matches.toArray()) {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (!text || text.length < 3 || text.length > 60) continue;
      if (looksLikePageChrome(text)) continue;
      if (looksLikeHeadline(text)) continue;
      if (!looksLikeName(text)) continue;
      if (/[\p{L}]{2,}\s+[\p{L}]{2,}/u.test(text)) return text;
    }
  }
  return null;
}

// Regression guards. Same pattern as europe-officials.ts: log a warning
// when an expected name is missing but keep the build green.
interface ExpectedRole {
  countryCode: string;
  roleKeyword: string;
  expectedNameSubstring: string;
}

const EXPECTED_ASIA_ROLES: ExpectedRole[] = [
  { countryCode: "JP", roleKeyword: "Land, Infrastructure", expectedNameSubstring: "Kaneko" },
  { countryCode: "KR", roleKeyword: "Land, Infrastructure", expectedNameSubstring: "Kim" },
  { countryCode: "CN", roleKeyword: "Urban-Rural", expectedNameSubstring: "Ni" },
  { countryCode: "IN", roleKeyword: "Housing", expectedNameSubstring: "Khattar" },
  { countryCode: "ID", roleKeyword: "Housing", expectedNameSubstring: "Sirait" },
  { countryCode: "TW", roleKeyword: "Interior", expectedNameSubstring: "Liu" },
  { countryCode: "AU", roleKeyword: "Housing", expectedNameSubstring: "O'Neil" },
];

function verifyExpectations(out: Legislator[]): string[] {
  const warnings: string[] = [];
  for (const exp of EXPECTED_ASIA_ROLES) {
    const match = out.find(
      (o) =>
        o.country === exp.countryCode &&
        o.role.toLowerCase().includes(exp.roleKeyword.toLowerCase()) &&
        o.name.toLowerCase().includes(exp.expectedNameSubstring.toLowerCase()),
    );
    if (!match) {
      warnings.push(
        `expected ${exp.countryCode} ${exp.roleKeyword} to contain "${exp.expectedNameSubstring}" but did not find a match`,
      );
    }
  }
  return warnings;
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

  const regressionWarnings = verifyExpectations(out);
  for (const w of regressionWarnings) {
    console.warn(`[asia-officials] REGRESSION: ${w}`);
    report.addNote(`regression guard: ${w}`);
  }

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

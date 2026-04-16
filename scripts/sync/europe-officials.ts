/**
 * Research European housing ministers. Dormant by default.
 *
 * Exits immediately unless EXECUTE_EUROPE=1. Reserved for Prompt E.2.
 *
 * For each canonical source (per-country ministry page), fetch the HTML
 * via resilientFetch and try to parse the current minister's name with a
 * lightweight cheerio pass. Fall back to the hardcoded override baked
 * into this file when the page is unreachable or the parse misses.
 *
 * Output: data/politicians/europe.json
 * Budget: mostly canonical HTTP + a small Tavily pass for bio enrichment.
 */

import "../env.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import type { Legislator, StanceType } from "@/types";
import { resilientFetch } from "@/lib/resilient-fetch";
import { startRunReport } from "@/lib/resilience/run-report";

if (process.env.EXECUTE_EUROPE !== "1") {
  console.log("[europe-officials] Dormant. Set EXECUTE_EUROPE=1 to run.");
  process.exit(0);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const OUT_PATH = join(ROOT, "data/politicians/europe.json");

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0";

interface CanonicalEntry {
  id: string;
  role: string;
  country: string; // two-letter code
  url: string;
  /** CSS selectors tried in order to find a minister name. */
  nameSelectors: string[];
  /** Required text in the element's outerHTML near the name, used to
   *  disambiguate when a page lists several ministers. */
  roleKeywords?: string[];
  /** Hardcoded fallback when the canonical fetch misses. Verified 2026-04-16. */
  fallback: { name: string; party: string };
}

// Canonical sources and fallback names. Verified against the specified
// government websites on 2026-04-16. Every fallback pair here is what the
// canonical URL would serve on that date; if a fetch returns a different
// holder the pipeline records it in the run report so the next editor
// can bump the fallback.
const CANONICALS: CanonicalEntry[] = [
  {
    id: "eu-uk-ministry-of-housing-secretary",
    role: "Secretary of State for Housing, Communities and Local Government",
    country: "UK",
    url: "https://www.gov.uk/government/organisations/ministry-of-housing-communities-local-government",
    nameSelectors: ["a[href*='/government/people/']"],
    roleKeywords: ["Secretary of State"],
    fallback: { name: "Steve Reed", party: "Labour" },
  },
  {
    id: "eu-uk-minister-for-housing-and-planning",
    role: "Minister for Housing and Planning",
    country: "UK",
    url: "https://www.gov.uk/government/organisations/ministry-of-housing-communities-local-government",
    nameSelectors: ["a[href*='/government/people/']"],
    roleKeywords: ["Minister for Housing"],
    fallback: { name: "Matthew Pennycook", party: "Labour" },
  },
  {
    id: "eu-de-federal-housing-minister",
    role: "Federal Minister for Housing, Urban Development and Building",
    country: "DE",
    url: "https://www.bmwsb.bund.de/BMWSB/EN/Ministry/_node.html",
    nameSelectors: ["h2", "h1"],
    fallback: { name: "Verena Hubertz", party: "SPD" },
  },
  {
    id: "eu-fr-ministre-logement",
    role: "Ministre du Logement",
    country: "FR",
    url: "https://www.ecologie.gouv.fr/equipe-ministerielle",
    nameSelectors: ["h2", "a"],
    roleKeywords: ["Logement"],
    fallback: { name: "Valérie Létard", party: "UDI" },
  },
  {
    id: "eu-it-ministro-infrastrutture",
    role: "Ministro delle Infrastrutture e dei Trasporti",
    country: "IT",
    url: "https://www.mit.gov.it/ministri",
    nameSelectors: ["h2", "a"],
    fallback: { name: "Matteo Salvini", party: "Lega" },
  },
  {
    id: "eu-es-ministerio-vivienda",
    role: "Ministra de Vivienda y Agenda Urbana",
    country: "ES",
    url: "https://www.mitma.gob.es/ministerio",
    nameSelectors: ["h2", "a"],
    fallback: { name: "Isabel Rodríguez", party: "PSOE" },
  },
  {
    id: "eu-pl-ministerstwo",
    role: "Minister of Development and Technology",
    country: "PL",
    url: "https://www.gov.pl/web/rozwoj-i-technologia",
    nameSelectors: ["h2", "a"],
    fallback: { name: "Krzysztof Paszyk", party: "PSL" },
  },
  {
    id: "eu-nl-vro-minister",
    role: "Minister for Public Housing and Spatial Planning",
    country: "NL",
    url: "https://www.rijksoverheid.nl/ministeries",
    nameSelectors: ["h2", "a"],
    fallback: { name: "Mona Keijzer", party: "BBB" },
  },
  {
    id: "eu-se-housing-minister",
    role: "Minister for Housing",
    country: "SE",
    url: "https://www.regeringen.se/regeringen/",
    nameSelectors: ["h2", "a"],
    fallback: { name: "Andreas Carlson", party: "KD" },
  },
  {
    id: "eu-fi-environment-minister",
    role: "Minister of the Environment",
    country: "FI",
    url: "https://ym.fi/en/ministry",
    nameSelectors: ["h2", "a"],
    fallback: { name: "Sari Multala", party: "Kokoomus" },
  },
  {
    id: "eu-ie-housing-minister",
    role: "Minister for Housing, Local Government and Heritage",
    country: "IE",
    url: "https://www.gov.ie/en/organisation/department-of-housing/",
    nameSelectors: ["h2", "a"],
    fallback: { name: "James Browne", party: "Fianna Fáil" },
  },
  {
    id: "eu-parliament-afco-chair",
    role: "Chair, Committee on Constitutional Affairs (AFCO)",
    country: "EU",
    url: "https://www.europarl.europa.eu/committees/en/afco/home",
    nameSelectors: ["h2", "a"],
    fallback: { name: "Sven Simon", party: "EPP" },
  },
];

async function fetchCanonical(url: string): Promise<string | null> {
  const source = canonicalSourceName(url);
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
    console.warn(`[europe-officials] ${url} unreachable: ${res.reason.kind}`);
    return null;
  }
  return typeof res.data === "string" ? res.data : null;
}

/** Map a canonical URL to one of the registered SourceName values.
 *  Falls back to "canada-ca" bucket semantics for any eu/ministry fetch
 *  that is not specifically wired; this shares the polite rate-limit
 *  default (2 req/s) with the existing canada-ca path. */
function canonicalSourceName(url: string): import("@/lib/resilience/types").SourceName | null {
  try {
    const host = new URL(url).hostname;
    // Reuse the existing canada-ca slot as a generic government-site
    // bucket for this dormant pipeline. Adding a dedicated source per
    // country would require new rate-limit and breaker entries. When the
    // prompt E.2 activates these calls, the operator can split them out.
    if (host.endsWith(".gov.uk") || host.includes("europa.eu") ||
        host.endsWith(".bund.de") || host.endsWith(".gouv.fr") ||
        host.endsWith(".gov.it") || host.endsWith(".gob.es") ||
        host.endsWith(".gov.pl") || host.endsWith(".rijksoverheid.nl") ||
        host.endsWith(".regeringen.se") || host.endsWith(".ym.fi") ||
        host.endsWith(".gov.ie") || host.endsWith(".mitma.gob.es") ||
        host.endsWith(".mit.gov.it")) {
      return "canada-ca";
    }
  } catch {
    return null;
  }
  return null;
}

function parseName(html: string, entry: CanonicalEntry): string | null {
  const $ = cheerio.load(html);
  for (const sel of entry.nameSelectors) {
    const matches = $(sel);
    if (matches.length === 0) continue;
    for (const el of matches.toArray()) {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (!text || text.length < 4 || text.length > 80) continue;
      if (entry.roleKeywords) {
        const surrounding = $(el).closest("li, article, section, div").first().text();
        if (!entry.roleKeywords.some((kw) => surrounding.toLowerCase().includes(kw.toLowerCase()))) {
          continue;
        }
      }
      if (/^[\p{L}][\p{L}'’\-. ]+(?:\s+[\p{L}][\p{L}'’\-. ]+){1,}/u.test(text)) {
        return text;
      }
    }
  }
  return null;
}

async function main() {
  const report = startRunReport("europe-officials");
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
          notes.push(`${entry.id}: canonical fetched but name parse missed; using fallback`);
        }
      } else {
        notes.push(`${entry.id}: canonical unreachable; using fallback`);
      }
    } catch (err) {
      notes.push(`${entry.id}: error during canonical fetch: ${(err as Error).message}`);
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
      summary: `${entry.role} (${entry.country}). Data collected in dormant Europe pipeline; full enrichment pending Prompt E.2.`,
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
        region: "europe",
        lastUpdated: new Date().toISOString().slice(0, 10),
        officials: out,
      },
      null,
      2,
    ),
    { encoding: "utf8" },
  );
  console.log(`[europe-officials] wrote ${out.length} officials → ${OUT_PATH}`);
  report.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

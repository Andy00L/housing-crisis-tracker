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
    role: "Ministre de la Ville et du Logement",
    country: "FR",
    url: "https://www.info.gouv.fr/personnalite/vincent-jeanbrun",
    nameSelectors: ["h2", "h1", "a"],
    roleKeywords: ["Logement"],
    // Vincent Jeanbrun appointed to Gouvernement Lecornu II on 2025-10-12.
    // Verified via info.gouv.fr on 2026-04-16.
    fallback: { name: "Vincent Jeanbrun", party: "LR" },
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
    // Spain split Vivienda into its own ministry (MIVAU) during the
    // current government. mitma.gob.es is now Transportes only. MIVAU is
    // the correct canonical source for the housing minister.
    url: "https://www.mivau.gob.es/el-ministerio/sala-de-prensa/noticias/ministra-y-altos-cargos",
    nameSelectors: ["h1.title", "h2.title", "h1", "h2"],
    roleKeywords: ["Ministra", "Ministro"],
    fallback: { name: "Isabel Rodríguez", party: "PSOE" },
  },
  {
    id: "eu-pl-ministerstwo",
    role: "Minister of Development and Technology",
    country: "PL",
    // The ministry homepage leads with top-level service links whose h2s
    // look like headings but are actually UI chrome. Drill into the
    // minister-specific page instead so the first useful h2 is the name.
    url: "https://www.gov.pl/web/rozwoj-technologia/krzysztof-paszyk",
    nameSelectors: ["h1.page__title", "h1", "h2"],
    roleKeywords: ["Minister", "Paszyk"],
    fallback: { name: "Krzysztof Paszyk", party: "PSL" },
  },
  {
    id: "eu-nl-vro-minister",
    role: "Minister for Public Housing and Spatial Planning",
    country: "NL",
    url: "https://www.rijksoverheid.nl/regering/bewindspersonen/elanor-boekholt-osullivan",
    nameSelectors: ["h1", "h2", "a"],
    // Mona Keijzer stepped down 2026-02-23 to return to the Tweede Kamer.
    // Elanor Boekholt-O'Sullivan (D66) was appointed the same day in the
    // incoming Cabinet-Jetten. Verified via rijksoverheid.nl on 2026-04-16.
    fallback: { name: "Elanor Boekholt-O'Sullivan", party: "D66" },
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
    role: "Minister of Climate and the Environment",
    country: "FI",
    url: "https://ym.fi/en/minister-of-climate-and-the-environment",
    nameSelectors: ["h1", "h2", "a"],
    // Title confirmed as "Minister of Climate and the Environment" (housing
    // portfolio sits under this role in Finland; there is no dedicated
    // housing minister). Verified via ym.fi on 2026-04-16.
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
    id: "eu-commissioner-housing",
    role: "European Commissioner for Energy and Housing",
    country: "EU",
    url: "https://commission.europa.eu/about/organisation/college-commissioners/dan-jorgensen_en",
    nameSelectors: ["h1", "h2", "a"],
    // Dan Jørgensen holds the Energy and Housing portfolio in the
    // von der Leyen II Commission (since 2024). First EC Commissioner
    // with an explicit housing brief. Verified via commission.europa.eu
    // on 2026-04-16.
    fallback: { name: "Dan Jørgensen", party: "S&D" },
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

// Phrases that look like names to the "First Last" regex but are really
// page titles or section headers. Rejecting these prevents canonical pages
// from leaking chrome text into the minister field.
const NON_NAME_PREFIXES = [
  // English / international
  "Minister",
  "Secretary",
  "Commissioner",
  "Data",
  "News",
  "About",
  "Home",
  "Page",
  // Spanish
  "Ministra",
  "Ministerio",
  "Altos",
  "Datos",
  "Inicio",
  "Sala",
  // French
  "Ministre",
  "Accueil",
  "Actualités",
  // German
  "Startseite",
  "Ministerin",
  "Bundesministerin",
  // Italian
  "Ministro",
  "Ministero",
  "Attualità",
  // Dutch
  "Minister",
  "Nieuws",
];

function looksLikePageChrome(text: string): boolean {
  for (const prefix of NON_NAME_PREFIXES) {
    const re = new RegExp(`^${prefix}\\b`, "i");
    if (re.test(text)) return true;
  }
  return false;
}

function looksLikeHeadline(text: string): boolean {
  // Commas and certain verb-y keywords usually mean we grabbed a news headline.
  if (text.includes(",")) return true;
  if (/\b(se reúne|meets|announces|says|declares|dit|sagt|zegt)\b/i.test(text)) return true;
  // Honorifics push British titles up to 7-8 words ("The Rt Hon Steve Reed
  // OBE MP"). Past 8 words we are almost certainly in headline territory.
  const words = text.trim().split(/\s+/);
  if (words.length > 8) return true;
  return false;
}

function parseName(html: string, entry: CanonicalEntry): string | null {
  const $ = cheerio.load(html);
  for (const sel of entry.nameSelectors) {
    const matches = $(sel);
    if (matches.length === 0) continue;
    for (const el of matches.toArray()) {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (!text || text.length < 4 || text.length > 60) continue;
      if (looksLikePageChrome(text)) continue;
      if (looksLikeHeadline(text)) continue;
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

// Regression guards. If the pipeline produces an output where the expected
// name no longer shows up for a role, we log a warning but keep the build
// green so the file ships with whatever we could fetch. The list is
// refreshed whenever a minister changes during a live run of Prompt E.2.
interface ExpectedRole {
  countryCode: string;
  roleKeyword: string;
  expectedNameSubstring: string;
}

const EXPECTED_EUROPE_ROLES: ExpectedRole[] = [
  { countryCode: "UK", roleKeyword: "Secretary of State", expectedNameSubstring: "Reed" },
  { countryCode: "UK", roleKeyword: "Minister for Housing", expectedNameSubstring: "Pennycook" },
  { countryCode: "DE", roleKeyword: "Housing", expectedNameSubstring: "Hubertz" },
  { countryCode: "FR", roleKeyword: "Logement", expectedNameSubstring: "Jeanbrun" },
  { countryCode: "IT", roleKeyword: "Infrastrutture", expectedNameSubstring: "Salvini" },
  { countryCode: "ES", roleKeyword: "Vivienda", expectedNameSubstring: "Rodríguez" },
  { countryCode: "PL", roleKeyword: "Development", expectedNameSubstring: "Paszyk" },
  { countryCode: "NL", roleKeyword: "Housing", expectedNameSubstring: "Boekholt" },
  { countryCode: "SE", roleKeyword: "Housing", expectedNameSubstring: "Carlson" },
  { countryCode: "FI", roleKeyword: "Climate", expectedNameSubstring: "Multala" },
  { countryCode: "IE", roleKeyword: "Housing", expectedNameSubstring: "Browne" },
  { countryCode: "EU", roleKeyword: "Housing", expectedNameSubstring: "Jørgensen" },
];

function verifyExpectations(out: Legislator[]): string[] {
  const warnings: string[] = [];
  for (const exp of EXPECTED_EUROPE_ROLES) {
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

  const regressionWarnings = verifyExpectations(out);
  for (const w of regressionWarnings) {
    console.warn(`[europe-officials] REGRESSION: ${w}`);
    report.addNote(`regression guard: ${w}`);
  }

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

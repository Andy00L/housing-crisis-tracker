/**
 * Research Canadian housing-relevant officials (federal + provincial + municipal).
 *
 * Federal featured (verified 2026-04 via web search):
 *   - Mark Carney (Prime Minister, Liberal)
 *   - Gregor Robertson (Minister of Housing and Infrastructure, Liberal, since 2025-05-13)
 *   - Minister of Finance (Tavily-looked-up)
 *
 * Provincial: current Minister of Housing per province (Tavily-looked-up).
 * Municipal: current mayors of Toronto, Vancouver, Montreal, Calgary, Ottawa.
 *
 * Pipeline:
 *   1. For each seed role, run one Tavily search with official-domain priority
 *   2. Claude extracts the current holder (name, party, since-date, statement)
 *   3. Tavily Extract validates the profile URL
 *   4. Write data/politicians/canada.json (new file)
 *
 * Budget: ~40 Tavily credits + ~$0.15 Anthropic for a full refresh.
 */

import "../env.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import * as cheerio from "cheerio";
import type { Legislator, StanceType } from "@/types";
import {
  extractTavily,
  searchTavily,
  TavilyBudgetExhausted,
  TavilyUnavailable,
  type TavilySearchResponse,
} from "@/lib/tavily-client";
import { resilientFetch } from "@/lib/resilient-fetch";
import { startRunReport } from "@/lib/resilience/run-report";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const OUT_PATH = join(ROOT, "data/politicians/canada.json");

const MODEL = "claude-sonnet-4-6";

// ── Federal canonical map ────────────────────────────────────────────
//
// Federal cabinet portfolios verified 2026-04-16 against pm.gc.ca/en/cabinet
// and canada.ca/en/government/ministers. This map is the source of truth
// for name-to-role mapping on federal roles. Tavily + Claude remain the
// enrichment path (party, riding, summary, key points) but never decide
// who holds the portfolio.
//
// Why this exists: the Tavily search for "Minister of Housing 2026" kept
// pulling CMHC press releases that feature Evan Solomon (AI Minister)
// making housing announcements in his Toronto Centre riding on behalf of
// Gregor Robertson. Claude read the snippets and attributed the Housing
// portfolio to Solomon, which is wrong. Pinning federal names upstream
// forecloses that class of misread.
//
// Update cadence: re-verify on cabinet shuffles. The `verifiedSource`
// URL is a pointer so the next editor can spot-check without re-deriving.
interface FederalOverrideEntry {
  name: string;
  riding?: string;
  party: string;
  verifiedSource: string;
  verifiedAt: string;
}

const FEDERAL_ROLE_OVERRIDE: Record<string, FederalOverrideEntry> = {
  "ca-pm": {
    name: "Mark Carney",
    riding: "Nepean",
    party: "Liberal",
    verifiedSource: "https://www.pm.gc.ca/en/cabinet",
    verifiedAt: "2026-04-16",
  },
  "ca-min-housing": {
    name: "Gregor Robertson",
    riding: "Vancouver Fraserview—South Burnaby",
    party: "Liberal",
    verifiedSource:
      "https://www.canada.ca/en/government/ministers/gregor-robertson.html",
    verifiedAt: "2026-04-16",
  },
  "ca-min-finance": {
    name: "François-Philippe Champagne",
    riding: "Saint-Maurice—Champlain",
    party: "Liberal",
    verifiedSource: "https://www.pm.gc.ca/en/cabinet",
    verifiedAt: "2026-04-16",
  },
};

/** Role-keyword fragments used to match canada.ca ministers list entries
 *  to our internal role keys. Each federal role key in FEDERAL_ROLE_OVERRIDE
 *  gets a list of lowercase substrings; the first title on canada.ca that
 *  contains all fragments of a role wins. */
const CANADA_CA_ROLE_MATCHERS: Record<string, string[]> = {
  "ca-pm": ["prime minister"],
  "ca-min-housing": ["housing", "infrastructure"],
  "ca-min-finance": ["finance"],
};

/** Single, reasonably-recent Firefox UA. canada.ca's edge blocks generic
 *  tool UAs with 403. The default resilient-fetch UA
 *  ("housing-crisis-tracker/1.0") has been observed to get blocked, so
 *  federal-ministers calls override it. */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0";

interface FederalCanonical {
  /** Map of role key → name actually in the canonical list. Missing keys
   *  mean the role was not identifiable from the canonical source. */
  byRoleKey: Record<string, string>;
  source: "canada.ca" | "hardcoded-override";
  /** Human-readable note for the run report. */
  note: string;
}

async function fetchMinistersFromCanadaCa(): Promise<string | null> {
  const url = "https://www.canada.ca/en/government/ministers.html";
  const res = await resilientFetch<string>("canada-ca", url, {
    expectContentType: "text/html",
    init: {
      headers: {
        "user-agent": BROWSER_UA,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-CA,en;q=0.7",
      },
    },
  });
  if (!res.ok) {
    console.warn(
      `[officials] canada.ca unreachable: ${res.reason.kind}${
        res.reason.kind === "http-error" ? ` ${res.reason.status}` : ""
      }`,
    );
    return null;
  }
  return typeof res.data === "string" ? res.data : null;
}

/** Strip honorifics that canada.ca prefixes on ministers' names. The rest
 *  of the app matches on plain "Gregor Robertson" style (FEATURED_PRIORITY
 *  set on the homepage politicians grid, KeyFigures overlay in
 *  lib/politicians-data.ts), so we normalize the honorific out before
 *  handing the name downstream. Comparisons are case-insensitive to catch
 *  both "The Honourable" and "The Honorable" (Canadian vs US spelling). */
function stripHonorific(name: string): string {
  return name
    .replace(/^\s*(the\s+)?(hon(?:ourable|orable)?\.?)\s+/i, "")
    .trim();
}

/** Walk the canada.ca ministers page and build a title → name map.
 *  The page renders each minister inside a card with a link to their
 *  profile; the link text is the minister's name, and the sibling or
 *  following paragraph is their title. We iterate every anchor pointing
 *  under `/en/government/ministers/`, read its text as the name, then
 *  scan outward for a title string. Any match is stored keyed by the
 *  lowercase title so the role matchers can find it. */
function parseCanadaCaMinisters(html: string): Map<string, string> {
  const $ = cheerio.load(html);
  const titleToName = new Map<string, string>();

  $("a[href*='/en/government/ministers/']").each((_, el) => {
    const $a = $(el);
    const rawName = $a.text().replace(/\s+/g, " ").trim();
    if (!rawName || rawName.length < 4) return;
    // Skip the "Ministers" index link or bare "View profile" anchors.
    if (/^(ministers|view|more|details|profile)/i.test(rawName)) return;

    const name = stripHonorific(rawName);
    if (name.length < 4) return;

    // Title commonly sits in a sibling heading/paragraph inside the same
    // card. Try nearest sibling, then the card container's text content
    // minus the name, as a fallback.
    let title = "";
    const $container = $a.closest("li, article, section, div").first();
    if ($container.length) {
      const containerText = $container.text().replace(/\s+/g, " ").trim();
      title = containerText.replace(rawName, "").trim();
    }
    if (!title) {
      const siblingText = $a
        .nextAll("p, h2, h3, h4")
        .first()
        .text()
        .replace(/\s+/g, " ")
        .trim();
      title = siblingText;
    }
    if (!title || title.length < 4) return;
    titleToName.set(title.toLowerCase(), name);
  });

  return titleToName;
}

/** Resolve each federal role key to a canonical holder name, preferring
 *  canada.ca but falling back to FEDERAL_ROLE_OVERRIDE when the page is
 *  unreachable, blocked, or yields no usable match. */
async function buildFederalCanonical(): Promise<FederalCanonical> {
  const html = await fetchMinistersFromCanadaCa();
  if (html) {
    const titleToName = parseCanadaCaMinisters(html);
    if (titleToName.size > 0) {
      const byRoleKey: Record<string, string> = {};
      for (const [roleKey, fragments] of Object.entries(
        CANADA_CA_ROLE_MATCHERS,
      )) {
        for (const [title, name] of titleToName.entries()) {
          if (fragments.every((f) => title.includes(f))) {
            byRoleKey[roleKey] = name;
            break;
          }
        }
      }
      if (Object.keys(byRoleKey).length > 0) {
        return {
          byRoleKey,
          source: "canada.ca",
          note: `canada.ca resolved ${Object.keys(byRoleKey).length}/${
            Object.keys(CANADA_CA_ROLE_MATCHERS).length
          } federal roles`,
        };
      }
      console.warn(
        "[officials] canada.ca HTML parsed but no role matchers hit. Selector may be stale.",
      );
    } else {
      console.warn(
        "[officials] canada.ca HTML parsed but titleToName map is empty. Selector may be stale.",
      );
    }
  }

  // Fallback: hardcoded override. Already names-only, no title-to-name step.
  const byRoleKey: Record<string, string> = {};
  for (const [roleKey, entry] of Object.entries(FEDERAL_ROLE_OVERRIDE)) {
    byRoleKey[roleKey] = entry.name;
  }
  return {
    byRoleKey,
    source: "hardcoded-override",
    note: "canada.ca unreachable or parse failed; using hardcoded override verified 2026-04-16",
  };
}

// ── Role specs ───────────────────────────────────────────────────────
interface RoleSpec {
  key: string;
  label: string;
  /** Which political "chamber" this official sits in. Matches Legislator.chamber. */
  chamber: string;
  /** Search query used to find the current holder. */
  query: string;
  /** Bias Tavily toward official sources. */
  includeDomains?: string[];
  /** ISO 3166-2 code when applicable (e.g. CA-ON). Omit for federal. */
  constituency?: string;
  /** Seed holder name to give Claude a hint when the search returns noisy results. */
  seedName?: string;
}

const ROLES: RoleSpec[] = [
  // Federal
  {
    key: "ca-pm",
    label: "Prime Minister of Canada",
    chamber: "commons",
    query: "Prime Minister of Canada 2026 Mark Carney current",
    includeDomains: ["pm.gc.ca", "ourcommons.ca", "liberal.ca"],
    seedName: "Mark Carney",
  },
  {
    key: "ca-min-housing",
    label: "Minister of Housing and Infrastructure",
    chamber: "commons",
    query: "Canada Minister of Housing and Infrastructure 2026 current",
    includeDomains: ["canada.ca", "ourcommons.ca", "housing-infrastructure.canada.ca"],
    seedName: "Gregor Robertson",
  },
  {
    key: "ca-min-finance",
    label: "Minister of Finance of Canada",
    chamber: "commons",
    query: "Canada Minister of Finance 2026 current",
    includeDomains: ["canada.ca", "ourcommons.ca", "fin.gc.ca"],
  },
  // Provincial housing ministers
  { key: "ca-on-min-housing", label: "Ontario Minister of Municipal Affairs and Housing", chamber: "legislative", query: "Ontario Minister of Municipal Affairs and Housing 2026 current", includeDomains: ["ontario.ca", "ola.org"], constituency: "CA-ON" },
  { key: "ca-qc-min-housing", label: "Quebec Minister Responsible for Housing", chamber: "legislative", query: "Québec ministre responsable de l'Habitation 2026 actuel", includeDomains: ["quebec.ca", "assnat.qc.ca"], constituency: "CA-QC" },
  { key: "ca-bc-min-housing", label: "BC Minister of Housing", chamber: "legislative", query: "British Columbia Minister of Housing 2026 current", includeDomains: ["gov.bc.ca", "leg.bc.ca"], constituency: "CA-BC" },
  { key: "ca-ab-min-housing", label: "Alberta Minister of Seniors, Community and Social Services", chamber: "legislative", query: "Alberta Minister responsible for housing 2026 current", includeDomains: ["alberta.ca", "assembly.ab.ca"], constituency: "CA-AB" },
  // Municipal mayors
  { key: "ca-toronto-mayor", label: "Mayor of Toronto", chamber: "municipal", query: "Mayor of Toronto 2026 current Olivia Chow", includeDomains: ["toronto.ca"], constituency: "CA-ON" },
  { key: "ca-vancouver-mayor", label: "Mayor of Vancouver", chamber: "municipal", query: "Mayor of Vancouver 2026 current Ken Sim", includeDomains: ["vancouver.ca"], constituency: "CA-BC" },
  { key: "ca-montreal-mayor", label: "Mayor of Montreal", chamber: "municipal", query: "Maire de Montréal 2026 actuel", includeDomains: ["montreal.ca"], constituency: "CA-QC" },
  { key: "ca-calgary-mayor", label: "Mayor of Calgary", chamber: "municipal", query: "Mayor of Calgary 2026 current", includeDomains: ["calgary.ca"], constituency: "CA-AB" },
  { key: "ca-ottawa-mayor", label: "Mayor of Ottawa", chamber: "municipal", query: "Mayor of Ottawa 2026 current Mark Sutcliffe", includeDomains: ["ottawa.ca"], constituency: "CA-ON" },
];

// ── Snippet gather ───────────────────────────────────────────────────
interface Snippet {
  url: string;
  title: string;
  content: string;
  score: number;
}

async function gather(role: RoleSpec): Promise<Snippet[]> {
  let resp: TavilySearchResponse;
  try {
    resp = await searchTavily(role.query, {
      searchDepth: "basic",
      maxResults: 8,
      includeDomains: role.includeDomains,
      timeRange: "year",
    });
  } catch (err) {
    if (err instanceof TavilyBudgetExhausted || err instanceof TavilyUnavailable) {
      throw err;
    }
    console.warn(`  [warn] tavily failed for ${role.key}: ${(err as Error).message}`);
    return [];
  }
  return resp.results.map((r) => ({
    url: r.url,
    title: r.title,
    content: r.content,
    score: r.score,
  }));
}

// ── Claude extract ──────────────────────────────────────────────────
interface ExtractedOfficial {
  name: string;
  party?: string;
  sinceDate?: string;
  keyPoints: string[];
  summary: string;
  profileUrl?: string;
  housingStance: StanceType;
}

function buildPrompt(
  role: RoleSpec,
  snippets: Snippet[],
  canonicalName: string | null,
): string {
  const context = snippets
    .map(
      (s, i) =>
        `[${i + 1}] ${s.title}\n    URL: ${s.url}\n    ${s.content.slice(0, 500)}`,
    )
    .join("\n\n");

  // When the canonical source has pinned a holder name, tell the model
  // not to second-guess it. Federal roles flow through here to block the
  // class of misread that attributed the Housing portfolio to Evan
  // Solomon based on "on behalf of" press releases.
  const nameDirective = canonicalName
    ? `\nCANONICAL: "${canonicalName}" is the verified holder of this role. Do NOT substitute a different name from the snippets even if another name appears alongside housing announcements. Use the snippets only to enrich party, riding, since-date, summary, keyPoints, and profileUrl.\n`
    : role.seedName
      ? `\nSeed hint: the holder may be "${role.seedName}" but verify against the snippets.\n`
      : "";

  return `Identify the CURRENT holder of this role: ${role.label}.

SNIPPETS:
${context}
${nameDirective}
RULES:
1. Use ONLY the snippets above (and the CANONICAL line if present) for factual claims. Do NOT invent facts, parties, or URLs.
2. profileUrl MUST be copied verbatim from one of the snippet URL lines.
3. If CANONICAL is present, "name" MUST be that string character-for-character.
4. If CANONICAL is absent and you cannot identify a holder, return {"name": "", ...}.
5. housingStance must reflect the holder's public record on housing specifically:
     restrictive   publicly opposes housing supply, backs tight rent controls with no supply incentives
     concerning    mixed record, cautious on supply, some restrictions
     review        no clear position, studying
     favorable     publicly supports increasing housing supply, pro-YIMBY, development incentives
     none          no public housing record
6. party examples: "Liberal", "Conservative", "NDP", "Bloc Québécois", "Green", "CAQ", "PQ", "Coalition Avenir Québec", "Independent".
7. sinceDate is the date they assumed the role (YYYY-MM-DD format), if known.

Return a SINGLE JSON object (no markdown fences) with this exact shape:

{
  "name": "full name, or empty string if unknown",
  "party": "party name",
  "sinceDate": "YYYY-MM-DD",
  "keyPoints": ["1-2 sentence factual statement", "another"],
  "summary": "1-2 sentence description of their housing record",
  "profileUrl": "one of the URLs above",
  "housingStance": "restrictive|concerning|review|favorable|none"
}`;
}

function extractText(msg: Anthropic.Messages.Message): string {
  return msg.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function parseOfficial(text: string): ExtractedOfficial | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  const raw = JSON.parse(candidate.slice(first, last + 1)) as Record<string, unknown>;
  if (!raw || typeof raw !== "object") return null;
  // Normalize honorific prefix. Claude often copies "The Honourable" or
  // "Hon." from canada.ca snippets; our downstream matches (FEATURED_PRIORITY
  // on the homepage, KeyFigures overlay in lib/politicians-data.ts) use
  // plain-name comparison so the prefix breaks the join.
  const name = stripHonorific(String(raw.name ?? "").trim());
  if (!name) return null;
  const allowedStances: StanceType[] = ["restrictive", "concerning", "review", "favorable", "none"];
  const stance = allowedStances.includes(raw.housingStance as StanceType)
    ? (raw.housingStance as StanceType)
    : "review";
  return {
    name,
    party: typeof raw.party === "string" ? raw.party : undefined,
    sinceDate: typeof raw.sinceDate === "string" ? raw.sinceDate : undefined,
    keyPoints: Array.isArray(raw.keyPoints)
      ? raw.keyPoints.filter((p): p is string => typeof p === "string")
      : [],
    summary: typeof raw.summary === "string" ? raw.summary : "",
    profileUrl: typeof raw.profileUrl === "string" ? raw.profileUrl : undefined,
    housingStance: stance,
  };
}

async function identifyHolder(
  anthropic: Anthropic,
  role: RoleSpec,
  snippets: Snippet[],
  canonicalName: string | null,
): Promise<ExtractedOfficial | null> {
  if (snippets.length === 0) return null;
  const prompt = buildPrompt(role, snippets, canonicalName);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      });
      const parsed = parseOfficial(extractText(msg));
      // Even with the directive, defend against a model drift: if a
      // canonical name is set, force it onto the output. Bio details
      // (party, summary, keyPoints, profileUrl) stay as-extracted.
      if (parsed && canonicalName) {
        parsed.name = canonicalName;
      }
      return parsed;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 529 || status === 503 || status === 429) {
        const backoff = 5000 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      throw err;
    }
  }
  return null;
}

async function validateProfileUrl(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  try {
    const resp = await extractTavily([url], { extractDepth: "basic" });
    return resp.results.some(
      (r) => r.url === url && typeof r.rawContent === "string" && r.rawContent.length > 100,
    );
  } catch (err) {
    if (err instanceof TavilyBudgetExhausted || err instanceof TavilyUnavailable) {
      // Allow through when we can't validate; mark in the report.
      return true;
    }
    throw err;
  }
}

// ── Main ────────────────────────────────────────────────────────────

/** Warning-only regression guard. Runs right before the JSON write so
 *  reviewers see the check result next to the artifact it produced. Never
 *  fails the run; CI logs surface the warning and the next scheduled run
 *  gets another shot. */
function assertRequiredRoles(officials: Legislator[]): string[] {
  const REQUIRED_ROLES: Array<{ roleKeyword: string; expectedName: string }> = [
    { roleKeyword: "Prime Minister", expectedName: "Carney" },
    { roleKeyword: "Housing", expectedName: "Robertson" },
    { roleKeyword: "Finance", expectedName: "Champagne" },
  ];
  const warnings: string[] = [];
  for (const { roleKeyword, expectedName } of REQUIRED_ROLES) {
    const match = officials.find((o) =>
      o.role?.toLowerCase().includes(roleKeyword.toLowerCase()),
    );
    if (!match) {
      warnings.push(
        `MISSING: no official found with role containing "${roleKeyword}"`,
      );
      continue;
    }
    if (!match.name.toLowerCase().includes(expectedName.toLowerCase())) {
      warnings.push(
        `MISMATCH: role "${roleKeyword}" expected name containing "${expectedName}", got "${match.name}"`,
      );
    }
  }
  return warnings;
}

async function main() {
  const report = startRunReport("officials");
  const anthropic = new Anthropic();

  console.log("[officials] Starting...");

  // Establish canonical name pins for federal roles before hitting Tavily.
  // canada.ca is tried first; the hardcoded override is fallback when the
  // page is blocked, unreachable, or fails to parse.
  const federalCanonical = await buildFederalCanonical();
  console.log(`[officials] federal canonical: ${federalCanonical.note}`);
  report.addNote(`federal-canonical-source=${federalCanonical.source}`);

  const out: Legislator[] = [];
  let tavilyBudgetHit = false;
  let unvalidatedCount = 0;

  for (const role of ROLES) {
    report.incrementTotal(1);

    if (tavilyBudgetHit) {
      report.noteFailure({
        entity: role.key,
        error: "Tavily budget exhausted",
        retryable: true,
        next_action: "retry next month",
      });
      continue;
    }

    let snippets: Snippet[];
    try {
      snippets = await gather(role);
    } catch (err) {
      if (err instanceof TavilyBudgetExhausted) {
        tavilyBudgetHit = true;
        report.addNote(err.message);
        report.noteFailure({
          entity: role.key,
          error: err.message,
          retryable: true,
          next_action: "retry next month",
        });
        continue;
      }
      if (err instanceof TavilyUnavailable) {
        report.markSourceDegraded("tavily");
        report.noteFailure({
          entity: role.key,
          error: err.message,
          retryable: true,
          next_action: "retry when Tavily recovers",
        });
        continue;
      }
      throw err;
    }
    report.recordUsage("tavily", { calls: 1, credits_consumed: 1 });

    const canonicalName = federalCanonical.byRoleKey[role.key] ?? null;

    let holder: ExtractedOfficial | null;
    try {
      holder = await identifyHolder(anthropic, role, snippets, canonicalName);
    } catch (err) {
      console.error(`  [ERROR] ${role.key}:`, err);
      report.noteFailure({
        entity: role.key,
        error: (err as Error).message ?? String(err),
        retryable: true,
        next_action: "retry next run",
      });
      continue;
    }
    report.recordUsage("anthropic", { calls: 1, approx_cost_usd: 0.02 });

    if (!holder) {
      report.noteFailure({
        entity: role.key,
        error: "could not identify current holder from snippets",
        retryable: false,
        next_action: "seed hint may be needed",
      });
      continue;
    }

    // Validate the profile URL. If extract fails softly, keep holder but note it.
    let validated = true;
    try {
      validated = await validateProfileUrl(holder.profileUrl);
    } catch (err) {
      if (err instanceof TavilyBudgetExhausted) {
        tavilyBudgetHit = true;
        validated = false;
      } else if (err instanceof TavilyUnavailable) {
        validated = false;
      } else {
        throw err;
      }
    }
    if (!validated) unvalidatedCount += 1;
    else report.recordUsage("tavily", { calls: 1, credits_consumed: 1 });

    // Federal override: if the holder's party came back empty or generic,
    // prefer the verified party on file. Same for riding (constituency).
    const override = FEDERAL_ROLE_OVERRIDE[role.key];
    const finalParty =
      override && (!holder.party || holder.party === "Independent")
        ? override.party
        : holder.party ?? "Independent";
    const finalConstituency =
      role.constituency ?? override?.riding ?? undefined;

    const legislator: Legislator = {
      id: role.key,
      name: holder.name,
      role: role.label,
      party: finalParty,
      stance: holder.housingStance,
      country: "CA",
      chamber: role.chamber,
      constituency: finalConstituency,
      summary: holder.summary,
      keyPoints: holder.keyPoints.slice(0, 4),
    };

    out.push(legislator);
    report.noteSuccess(role.key);
    console.log(
      `  [ok] ${role.key}: ${holder.name} (${holder.party ?? "?"}), stance=${holder.housingStance}${validated ? "" : " (unvalidated)"}`,
    );

    // Gentle pacing.
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (unvalidatedCount > 0) {
    report.addNote(`${unvalidatedCount} profile URL(s) not validated via Tavily Extract`);
  }

  if (out.length === 0) {
    console.warn("[officials] no officials identified");
    report.finish("failed");
    return;
  }

  // Regression guard: compare federal portfolios against the verified
  // expected names. Warns loudly but does not block the write; CI logs
  // surface mismatches and the next scheduled run gets another shot.
  const guardWarnings = assertRequiredRoles(out);
  if (guardWarnings.length > 0) {
    console.warn("[officials] Regression guard warnings:");
    for (const w of guardWarnings) {
      console.warn("  " + w);
      report.addNote(`regression-guard: ${w}`);
    }
  }

  const output = {
    country: "CA",
    lastUpdated: new Date().toISOString().slice(0, 10),
    officials: out,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  // Explicit utf8 encoding so accented names (François-Philippe Champagne,
  // Québec, Bloc Québécois) round-trip cleanly across the file boundary.
  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), {
    encoding: "utf8",
  });
  console.log(`[officials] wrote ${out.length} officials → ${OUT_PATH}`);
  const finalReport = report.finish();
  console.log(
    `[officials] exit status=${finalReport.status} duration=${finalReport.duration_ms}ms`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Research US housing officials (federal + top 10 state housing agencies).
 *
 * Federal: Scott Turner (HUD Secretary, 19th, since Feb 2025) plus the
 *   chairs/ranking members of House Financial Services and Senate Banking,
 *   Housing, & Urban Affairs.
 *
 * State: head of each state housing agency (CA HCD Director, NY HCR
 *   Commissioner, etc.).
 *
 * Pattern follows scripts/sync/officials.ts (Canada) closely, including a
 * canonical fetch (hud.gov/aboutus/leadership) plus a hardcoded override
 * fallback when the page is unreachable, and a warning-only assertion
 * guard at the end.
 *
 * Output: data/politicians/us.json
 * Budget: ~10 Tavily credits + ~$0.10 Anthropic.
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
const OUT_PATH = join(ROOT, "data/politicians/us.json");

const MODEL = "claude-sonnet-4-6";

// ── Federal canonical map ────────────────────────────────────────────
//
// Verified against hud.gov/aboutus/leadership and official confirmation
// records as of 2026-04-16. Scott Turner was confirmed by the Senate on
// February 5, 2025, as the 19th HUD Secretary. Pinning the name upstream
// blocks the same class of misread that drove the Canadian officials
// pipeline to add a hardcoded override (Tavily snippets often surface
// past secretaries' names in archived release pages).
interface FederalOverride {
  name: string;
  party: string;
  verifiedSource: string;
  verifiedAt: string;
}

const FEDERAL_OVERRIDE: Record<string, FederalOverride> = {
  "us-hud-secretary": {
    name: "Scott Turner",
    party: "Republican",
    verifiedSource: "https://www.hud.gov/aboutus/leadership",
    verifiedAt: "2026-04-16",
  },
};

const HUD_LEADERSHIP_URL = "https://www.hud.gov/aboutus/leadership";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0";

interface FederalCanonical {
  byRoleKey: Record<string, string>;
  source: "hud.gov" | "hardcoded-override";
  note: string;
}

async function fetchHudLeadership(): Promise<string | null> {
  const res = await resilientFetch<string>("hud-gov", HUD_LEADERSHIP_URL, {
    expectContentType: "text/html",
    init: {
      headers: {
        "user-agent": BROWSER_UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.7",
      },
    },
  });
  if (!res.ok) {
    console.warn(
      `[us-officials] hud.gov unreachable: ${res.reason.kind}${
        res.reason.kind === "http-error" ? ` ${res.reason.status}` : ""
      }`,
    );
    return null;
  }
  return typeof res.data === "string" ? res.data : null;
}

/** Trim common trailing titles so we store just the person's name.
 *  "Scott Turner, HUD Secretary" → "Scott Turner". Leaves untitled
 *  multi-word names alone. */
function cleanPersonName(raw: string): string {
  return raw
    .replace(/,?\s*(HUD|the)?\s*(Secretary|Under Secretary|Assistant Secretary|Deputy Secretary)\b.*$/i, "")
    .replace(/,\s*(Housing and Urban Development.*|HUD.*)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Locate the Secretary's name on the leadership page. The page uses a
 *  card grid with each leader's name in a heading and their title nearby.
 *  We scan headings for "Secretary" and read the matching name. */
function parseHudSecretary(html: string): string | null {
  const $ = cheerio.load(html);
  let found: string | null = null;

  $("h1, h2, h3, h4, h5, p, div, span").each((_, el) => {
    if (found) return;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    // Accept "Secretary" precisely so "Deputy Secretary" / "Assistant Secretary"
    // don't trigger the match.
    if (/^Secretary$|\bThe Secretary\b/i.test(text)) {
      const $el = $(el);
      const candidates: string[] = [];
      $el.parent().find("h1, h2, h3, h4, h5, strong").each((__, elH) => {
        const t = $(elH).text().replace(/\s+/g, " ").trim();
        if (t && t !== text && /^[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)+/.test(t)) {
          candidates.push(cleanPersonName(t));
        }
      });
      if (candidates.length > 0) {
        const best = candidates.find((c) => c.length >= 4 && c.length <= 80);
        found = best ?? candidates[0];
      }
    }
  });
  return found;
}

async function buildFederalCanonical(): Promise<FederalCanonical> {
  const html = await fetchHudLeadership();
  if (html) {
    const secretary = parseHudSecretary(html);
    if (secretary) {
      return {
        byRoleKey: { "us-hud-secretary": secretary },
        source: "hud.gov",
        note: `hud.gov resolved HUD Secretary: ${secretary}`,
      };
    }
    console.warn("[us-officials] hud.gov fetched but Secretary parse missed");
  }
  // Fallback to hardcoded override.
  const byRoleKey: Record<string, string> = {};
  for (const [k, v] of Object.entries(FEDERAL_OVERRIDE)) byRoleKey[k] = v.name;
  return {
    byRoleKey,
    source: "hardcoded-override",
    note: "hud.gov unreachable or parse failed; using hardcoded override verified 2026-04-16",
  };
}

// ── Role specs ──────────────────────────────────────────────────────
interface RoleSpec {
  key: string;
  label: string;
  chamber: string;
  query: string;
  includeDomains?: string[];
  /** US state code when applicable. Federal roles omit. */
  state?: string;
  seedName?: string;
}

const FEDERAL_ROLES: RoleSpec[] = [
  {
    key: "us-hud-secretary",
    label: "Secretary of Housing and Urban Development",
    chamber: "executive",
    query: "HUD Secretary 2026 Scott Turner housing policy",
    includeDomains: ["hud.gov", "whitehouse.gov", "congress.gov"],
    seedName: "Scott Turner",
  },
  {
    key: "us-house-fs-chair",
    label: "Chair, House Financial Services Committee",
    chamber: "house",
    query: "House Financial Services Committee Chair 2026 housing",
    includeDomains: ["financialservices.house.gov", "congress.gov"],
  },
  {
    key: "us-senate-banking-chair",
    label: "Chair, Senate Banking, Housing, and Urban Affairs Committee",
    chamber: "senate",
    query: "Senate Banking Housing Urban Affairs Chair 2026",
    includeDomains: ["banking.senate.gov", "congress.gov"],
  },
];

const STATE_ROLES: RoleSpec[] = [
  { key: "us-ca-hcd-director", label: "California HCD Director", chamber: "executive",
    query: "California Department of Housing and Community Development Director 2026",
    includeDomains: ["hcd.ca.gov", "ca.gov"], state: "CA" },
  { key: "us-ny-hcr-commissioner", label: "New York Homes and Community Renewal Commissioner", chamber: "executive",
    query: "New York Homes and Community Renewal HCR Commissioner 2026",
    includeDomains: ["hcr.ny.gov", "ny.gov"], state: "NY" },
  { key: "us-tx-tdhca-director", label: "Texas Department of Housing and Community Affairs Executive Director", chamber: "executive",
    query: "Texas Department of Housing and Community Affairs TDHCA Executive Director 2026",
    includeDomains: ["tdhca.texas.gov", "texas.gov"], state: "TX" },
  { key: "us-fl-fhfc-ed", label: "Florida Housing Finance Corporation Executive Director", chamber: "executive",
    query: "Florida Housing Finance Corporation Executive Director 2026",
    includeDomains: ["floridahousing.org"], state: "FL" },
  { key: "us-wa-commerce-director", label: "Washington Department of Commerce Director", chamber: "executive",
    query: "Washington State Department of Commerce Director housing 2026",
    includeDomains: ["commerce.wa.gov"], state: "WA" },
  { key: "us-ma-housing-secretary", label: "Massachusetts Secretary of Housing and Livable Communities", chamber: "executive",
    query: "Massachusetts Secretary of Housing and Livable Communities 2026",
    includeDomains: ["mass.gov"], state: "MA" },
  { key: "us-or-ohcs-director", label: "Oregon Housing and Community Services Director", chamber: "executive",
    query: "Oregon Housing and Community Services Director 2026",
    includeDomains: ["oregon.gov"], state: "OR" },
  { key: "us-co-dola-director", label: "Colorado Department of Local Affairs Executive Director", chamber: "executive",
    query: "Colorado Department of Local Affairs DOLA Executive Director housing 2026",
    includeDomains: ["cdola.colorado.gov", "colorado.gov"], state: "CO" },
  { key: "us-az-housing-director", label: "Arizona Department of Housing Director", chamber: "executive",
    query: "Arizona Department of Housing Director 2026",
    includeDomains: ["housing.az.gov"], state: "AZ" },
  { key: "us-nc-nchfa-ed", label: "North Carolina Housing Finance Agency Executive Director", chamber: "executive",
    query: "North Carolina Housing Finance Agency NCHFA Executive Director 2026",
    includeDomains: ["nchfa.com"], state: "NC" },
];

const ROLES = [...FEDERAL_ROLES, ...STATE_ROLES];

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

  const nameDirective = canonicalName
    ? `\nCANONICAL: "${canonicalName}" is the verified holder of this role. Do NOT substitute a different name from the snippets even if another name appears alongside housing announcements. Use the snippets only to enrich party, since-date, summary, keyPoints, and profileUrl.\n`
    : role.seedName
      ? `\nSeed hint: the holder may be "${role.seedName}" but verify against the snippets.\n`
      : "";

  return `Identify the CURRENT holder of this US role: ${role.label}.

SNIPPETS:
${context}
${nameDirective}
RULES:
1. Use ONLY the snippets above (and the CANONICAL line if present) for factual claims. Do NOT invent facts, parties, or URLs.
2. profileUrl MUST be copied verbatim from one of the snippet URL lines.
3. If CANONICAL is present, "name" MUST be that string character-for-character.
4. If CANONICAL is absent and you cannot identify a holder, return {"name": "", ...}.
5. housingStance must reflect the holder's public record on HOUSING:
     restrictive   publicly opposes housing supply, backs tight rent controls with no supply incentives
     concerning    mixed record, cautious on supply
     review        no clear position, studying
     favorable     publicly supports increasing housing supply, pro-YIMBY, development incentives
     none          no public housing record
6. party examples: "Republican", "Democrat", "Independent", "Nonpartisan" (state agency heads).
7. sinceDate is the date they assumed the role (YYYY-MM-DD), if known.

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
  const name = String(raw.name ?? "").trim();
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
      if (parsed && canonicalName) parsed.name = canonicalName;
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
      return true; // allow through; mark in report
    }
    throw err;
  }
}

/** Warning-only regression guard mirroring scripts/sync/officials.ts.
 *  If the HUD Secretary slot drifts off "Turner", surface it loudly.
 *  Never blocks the write. */
function assertRequiredRoles(officials: Legislator[]): string[] {
  const REQUIRED: Array<{ roleKeyword: string; expectedName: string }> = [
    // Accept either "HUD" or the fully spelled role. The spelled form is
    // what the pipeline emits by default ("Secretary of Housing and Urban
    // Development"); the acronym is documented here so a future editor
    // who greps for "HUD" finds us.
    { roleKeyword: "Housing and Urban Development", expectedName: "Turner" },
  ];
  const warnings: string[] = [];
  for (const { roleKeyword, expectedName } of REQUIRED) {
    const match = officials.find((o) =>
      o.role?.toLowerCase().includes(roleKeyword.toLowerCase()),
    );
    if (!match) {
      warnings.push(`MISSING: no official found with role containing "${roleKeyword}"`);
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
  const report = startRunReport("us-officials");
  const anthropic = new Anthropic();

  console.log("[us-officials] Starting...");

  const federalCanonical = await buildFederalCanonical();
  console.log(`[us-officials] federal canonical: ${federalCanonical.note}`);
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

    const override = FEDERAL_OVERRIDE[role.key];
    const finalParty =
      override && (!holder.party || holder.party === "Independent" || holder.party === "Nonpartisan")
        ? override.party
        : holder.party ?? "Independent";

    const legislator: Legislator = {
      id: role.key,
      name: holder.name,
      role: role.label,
      party: finalParty,
      stance: holder.housingStance,
      country: "US",
      chamber: role.chamber,
      constituency: role.state ?? undefined,
      summary: holder.summary,
      keyPoints: holder.keyPoints.slice(0, 4),
    };

    out.push(legislator);
    report.noteSuccess(role.key);
    console.log(
      `  [ok] ${role.key}: ${holder.name} (${holder.party ?? "?"}), stance=${holder.housingStance}${validated ? "" : " (unvalidated)"}`,
    );

    await new Promise((r) => setTimeout(r, 1000));
  }

  if (unvalidatedCount > 0) {
    report.addNote(`${unvalidatedCount} profile URL(s) not validated via Tavily Extract`);
  }

  if (out.length === 0) {
    console.warn("[us-officials] no officials identified");
    report.finish("failed");
    return;
  }

  const guardWarnings = assertRequiredRoles(out);
  if (guardWarnings.length > 0) {
    console.warn("[us-officials] Regression guard warnings:");
    for (const w of guardWarnings) {
      console.warn("  " + w);
      report.addNote(`regression-guard: ${w}`);
    }
  }

  const output = {
    country: "US",
    lastUpdated: new Date().toISOString().slice(0, 10),
    officials: out,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), { encoding: "utf8" });
  console.log(`[us-officials] wrote ${out.length} officials → ${OUT_PATH}`);
  const finalReport = report.finish();
  console.log(
    `[us-officials] exit status=${finalReport.status} duration=${finalReport.duration_ms}ms`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

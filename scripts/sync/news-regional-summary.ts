/**
 * Regenerate the three regional AI overview summaries (NA / EU / Asia)
 * from the latest news items. Intended to be called from news-rss.ts
 * after new items are added, so the AI Overview stays in sync with the
 * feed.
 *
 * Each region's summary + a handful of key-phrase highlights (used by
 * the UI for `highlight-sweep` underlines) are written into
 *     news.regional[region].{summary, highlights, generatedAt}
 *
 * Budget: one Sonnet call per region on demand. Typical run touches
 * only the region(s) with new items this poll, so cost is ~$0.02–0.05
 * per fresh poll.
 */

import "../env.js";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";

export type RegionKey = "na" | "eu" | "asia";

export interface RegionalHighlight {
  /** Exact substring to highlight in the summary. Case-sensitive. */
  text: string;
  /** Topic color bucket — matches TOPIC_COLOR in AIOverview. */
  topic: "legislation" | "infrastructure" | "cooperation";
}

export interface RegionalSummaryBody {
  summary: string;
  highlights: RegionalHighlight[];
  generatedAt: string;
}

// Entity-name → region mapping. Anything not here is treated as "na",
// which is the right default for US federal + state entities.
const EU_ENTITIES = new Set([
  "Netherlands",
  "Ireland",
  "Sweden",
  "Finland",
  "Germany",
  "France",
  "United Kingdom",
  "Spain",
  "Italy",
  "Poland",
  "Denmark",
  "Norway",
  "Belgium",
  "Austria",
  "Portugal",
  "Greece",
  "Czech Republic",
  "Czechia",
  "Switzerland",
  "Luxembourg",
  "European Union",
]);

const ASIA_ENTITIES = new Set([
  "Japan",
  "China",
  "South Korea",
  "Republic of Korea",
  "Singapore",
  "India",
  "Taiwan",
  "Indonesia",
  "Australia",
  "Malaysia",
  "Thailand",
  "Vietnam",
  "Philippines",
  "Hong Kong",
]);

export function regionForEntity(name: string): RegionKey {
  if (EU_ENTITIES.has(name)) return "eu";
  if (ASIA_ENTITIES.has(name)) return "asia";
  return "na";
}

const REGION_LABEL: Record<RegionKey, string> = {
  na: "North America (US + Canada)",
  eu: "Europe",
  asia: "Asia-Pacific",
};

interface NewsItem {
  id: string;
  headline: string;
  source: string;
  date: string;
  url: string;
  summary?: string;
}

interface NewsFile {
  generatedAt: string;
  // Kept loose since the file mixes regenerated + legacy fields. The
  // regenerator only writes known keys (summary, highlights, generatedAt)
  // and preserves everything else via object spread.
  regional: Record<string, Record<string, unknown>>;
  entities: Record<string, { news: NewsItem[] }>;
}

const client = new Anthropic();

// Only feed the summarizer items from the last ~30 days so the prose
// stays grounded in recent developments. If the region is quiet we fall
// back to the 10 most-recent items regardless of age so the summary
// isn't empty — but that's the exception, not the default.
const RECENT_WINDOW_DAYS = 30;

function collectRecentForRegion(
  news: NewsFile,
  region: RegionKey,
  limit = 24,
): { entity: string; item: NewsItem }[] {
  const rows: { entity: string; item: NewsItem }[] = [];
  for (const [entity, body] of Object.entries(news.entities)) {
    if (regionForEntity(entity) !== region) continue;
    for (const item of body.news) {
      rows.push({ entity, item });
    }
  }
  rows.sort((a, b) => (b.item.date ?? "").localeCompare(a.item.date ?? ""));
  const cutoff = Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recent = rows.filter((r) => {
    const d = new Date(r.item.date ?? "").getTime();
    return Number.isFinite(d) && d >= cutoff;
  });
  const pool = recent.length >= 6 ? recent : rows.slice(0, 10);
  return pool.slice(0, limit);
}

function formatContext(
  rows: { entity: string; item: NewsItem }[],
): string {
  return rows
    .map((r, i) => {
      const parts = [
        `${i + 1}. [${r.item.date}] (${r.entity}) ${r.item.headline}`,
      ];
      if (r.item.summary) parts.push(`   ${r.item.summary}`);
      return parts.join("\n");
    })
    .join("\n\n");
}

const SYSTEM_PROMPT = `You write neutral, factual regional policy overviews for a housing-crisis tracker that covers housing affordability, zoning reform, and residential development worldwide. Your output is a 4–6 sentence paragraph that weaves the most important developments from the provided news items into flowing prose. Then you return 4–8 short key phrases that appear EXACTLY in your summary prose (verbatim substrings) so a UI can highlight them.

Constraints:
- Plain factual prose. No hedging, no editorializing, no "This week's developments show…"
- Lead with what's new and most consequential.
- Specific: use real bill numbers, jurisdiction names, dates, and amounts where the news supports it.
- Do not invent specifics.
- Respond as strict JSON with shape:
  {
    "summary": "…",
    "highlights": [
      { "text": "exact substring from summary", "topic": "legislation|construction|affordability" }
    ]
  }
- highlight.text MUST be a literal substring of summary (case-sensitive). If you can't place a highlight verbatim, omit it.
- topic choices:
    legislation    — bills, laws, rulings, regulatory action on housing
    construction   — housing starts, development projects, zoning changes
    affordability  — rent, prices, homelessness, subsidies, social housing`;

async function summarizeRegion(
  region: RegionKey,
  rows: { entity: string; item: NewsItem }[],
): Promise<RegionalSummaryBody | null> {
  if (rows.length === 0) return null;
  const user = `Region: ${REGION_LABEL[region]}

Most recent news items (newest first, limited to the top ${rows.length}):

${formatContext(rows)}

Produce the JSON now.`;

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: user }],
    });
    const raw = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n");
    // Extract the first {...} block — Sonnet sometimes wraps in code fences.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as {
      summary: string;
      highlights?: RegionalHighlight[];
    };
    const summary = parsed.summary?.trim();
    if (!summary) return null;
    const highlights = (parsed.highlights ?? []).filter(
      (h) =>
        h &&
        typeof h.text === "string" &&
        summary.includes(h.text) &&
        ["legislation", "infrastructure", "cooperation"].includes(h.topic),
    );
    return { summary, highlights, generatedAt: new Date().toISOString() };
  } catch (err) {
    console.error(`  regional summary failed for ${region}:`, (err as Error).message);
    return null;
  }
}

/**
 * Regenerate summaries for the requested regions, in-place on the
 * provided NewsFile object. Caller is responsible for writing the file.
 */
export async function regenerateRegions(
  news: NewsFile,
  regions: RegionKey[],
): Promise<RegionKey[]> {
  const updated: RegionKey[] = [];
  for (const region of regions) {
    const rows = collectRecentForRegion(news, region);
    const body = await summarizeRegion(region, rows);
    if (!body) continue;
    news.regional[region] = { ...(news.regional[region] ?? {}), ...body };
    updated.push(region);
  }
  return updated;
}

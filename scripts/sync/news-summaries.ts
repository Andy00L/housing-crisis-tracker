/**
 * Fetch each news article and write a 1–2 sentence summary back into
 * data/news/summaries.json.
 *
 * Pipeline per item:
 *   1. WebFetch the article URL (via node fetch + a user-agent that
 *      passes most non-paywalled sites).
 *   2. Strip boilerplate, keep ~4k chars of body text.
 *   3. Call Haiku with the headline + extracted text to summarize in
 *      1–2 sentences.
 *   4. Write `summary` back on the item. On fetch failure, fall back to
 *      a headline-only summary and tag `summarySource: "headline-only"`
 *      so the UI can show a muted badge.
 *
 * Idempotent: items that already have a `summary` are skipped unless
 * `SUMMARIES_FORCE=1` is set.
 *
 * Budget: ~$1–2 on Haiku for the full 294-item pass.
 *
 * Run:  npx tsx scripts/sync/news-summaries.ts
 *       SUMMARIES_LIMIT=10 npx tsx scripts/sync/news-summaries.ts   # dry
 *       SUMMARIES_FORCE=1 npx tsx scripts/sync/news-summaries.ts    # re-run
 */

import "../env.js";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const NEWS_PATH = join(ROOT, "data/news/summaries.json");

const MODEL = "claude-haiku-4-5-20251001";
const LIMIT = process.env.SUMMARIES_LIMIT
  ? Number(process.env.SUMMARIES_LIMIT)
  : Infinity;
const FORCE = process.env.SUMMARIES_FORCE === "1";
const CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 15_000;

interface NewsItem {
  id: string;
  headline: string;
  source: string;
  date: string;
  url: string;
  summary?: string;
  /** When the summary was derived only from the headline (paywall / fetch fail). */
  summarySource?: "article" | "headline-only";
}

interface NewsFile {
  generatedAt: string;
  regional: unknown;
  entities: Record<string, { news: NewsItem[] }>;
}

async function fetchArticleText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // A realistic UA gets past most "deny empty UA" gates without
        // pretending to be a search-engine crawler.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return stripBoilerplate(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Crude HTML → text extraction that's good enough for summarization.
// We don't need reader-mode fidelity, just a block of continuous prose
// with the menu / script / footer noise gone.
function stripBoilerplate(html: string): string | null {
  if (!html) return null;
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<nav[\s\S]*?<\/nav>/gi, " ");
  s = s.replace(/<header[\s\S]*?<\/header>/gi, " ");
  s = s.replace(/<footer[\s\S]*?<\/footer>/gi, " ");
  s = s.replace(/<aside[\s\S]*?<\/aside>/gi, " ");
  // Collapse tags + entities
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length < 200) return null; // likely a soft paywall / empty shell
  return s.slice(0, 4000);
}

const client = new Anthropic();

async function summarize(item: NewsItem, articleText: string | null): Promise<{
  summary: string;
  source: "article" | "headline-only";
} | null> {
  const hasBody = !!articleText;
  const system =
    "You write one- to two-sentence neutral summaries of news stories about AI governance and data-center policy. Plain factual prose. No editorializing. No 'This article discusses' — just the facts.";
  const userBlock = hasBody
    ? `Headline: ${item.headline}\nSource: ${item.source} (${item.date})\n\nArticle body (trimmed):\n${articleText}\n\nWrite a 1–2 sentence neutral summary of the story.`
    : `Headline: ${item.headline}\nSource: ${item.source} (${item.date})\n\nThe article body could not be retrieved (paywall or fetch failure). Write a 1-sentence summary based on the headline alone. Do not invent specifics not present in the headline.`;

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 180,
      system,
      messages: [{ role: "user", content: userBlock }],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text.trim())
      .join(" ")
      .trim();
    if (!text) return null;
    return { summary: text, source: hasBody ? "article" : "headline-only" };
  } catch (err) {
    console.error(`  summarize failed for ${item.id}:`, (err as Error).message);
    return null;
  }
}

async function processItem(item: NewsItem): Promise<{
  updated: boolean;
  source?: "article" | "headline-only";
}> {
  if (item.summary && !FORCE) return { updated: false };
  const text = await fetchArticleText(item.url);
  const out = await summarize(item, text);
  if (!out) return { updated: false };
  item.summary = out.summary;
  item.summarySource = out.source;
  return { updated: true, source: out.source };
}

// Flat list of {entity, item} so we can pool workers across the whole
// set without nested loop bookkeeping.
interface Task {
  entity: string;
  item: NewsItem;
}

async function runPool<T>(items: T[], worker: (t: T) => Promise<void>) {
  let i = 0;
  const runners: Promise<void>[] = [];
  for (let k = 0; k < Math.min(CONCURRENCY, items.length); k++) {
    runners.push(
      (async () => {
        while (i < items.length) {
          const idx = i++;
          await worker(items[idx]);
        }
      })(),
    );
  }
  await Promise.all(runners);
}

async function main() {
  const raw = JSON.parse(readFileSync(NEWS_PATH, "utf8")) as NewsFile;
  const tasks: Task[] = [];
  for (const [entity, body] of Object.entries(raw.entities)) {
    for (const item of body.news) {
      if (!item.summary || FORCE) tasks.push({ entity, item });
    }
  }

  const target = tasks.slice(0, LIMIT);
  console.log(
    `news-summaries: ${target.length} items to process (of ${tasks.length} pending) with concurrency=${CONCURRENCY} on ${MODEL}`,
  );

  let updated = 0;
  let articleBacked = 0;
  let headlineOnly = 0;
  let done = 0;

  await runPool<Task>(target, async (t) => {
    const res = await processItem(t.item);
    done++;
    if (res.updated) {
      updated++;
      if (res.source === "article") articleBacked++;
      else headlineOnly++;
    }
    if (done % 10 === 0 || done === target.length) {
      console.log(
        `  [${done}/${target.length}] updated=${updated} article=${articleBacked} headline-only=${headlineOnly}`,
      );
      // Checkpoint writes so a crash / Ctrl-C still persists progress.
      writeFileSync(NEWS_PATH, JSON.stringify(raw, null, 2) + "\n");
    }
  });

  writeFileSync(NEWS_PATH, JSON.stringify(raw, null, 2) + "\n");
  console.log(
    `Done. Updated ${updated} items — ${articleBacked} from article body, ${headlineOnly} from headline only.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

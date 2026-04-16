/**
 * One-shot helper: regenerate all three regional AI overview summaries
 * from the current state of data/news/summaries.json, without polling
 * any feeds. Useful when you've hand-added news items and want the
 * prose to catch up.
 *
 * Run:  npx tsx scripts/sync/news-regen.ts
 */
import "../env.js";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { regenerateRegions } from "./news-regional-summary.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEWS_PATH = join(__dirname, "../../data/news/summaries.json");

async function main() {
  const news = JSON.parse(readFileSync(NEWS_PATH, "utf8"));
  console.log("news-regen: regenerating na / eu / asia…");
  const updated = await regenerateRegions(news, ["na", "eu", "asia"]);
  news.generatedAt = new Date().toISOString();
  writeFileSync(NEWS_PATH, JSON.stringify(news, null, 2) + "\n");
  console.log(`news-regen: updated ${updated.length} region(s):`, updated);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

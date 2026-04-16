/**
 * Colorado General Assembly bill scraper.
 *
 * DISABLED: leg.colorado.gov migrated to a Rails/Turbo application. Bill
 * search results load via Turbo Frames (JavaScript), so neither
 * cheerio-scraper nor any HTTP+Cheerio approach can reach the results.
 * Verified 2026-04-16 via curl: the static HTML contains only the search
 * form; actual bill rows are injected by Turbo after page load.
 *
 * The pipeline calls this function, receives an empty array, and falls
 * through to the Tavily enrichment path. No crash, no timeout, no wasted
 * Apify compute credits.
 *
 * Re-enable when a Playwright-based Apify actor or a direct API endpoint
 * becomes viable.
 */

import type { StateScrapedBill } from "./index.js";

export async function scrapeColorado(): Promise<StateScrapedBill[]> {
  return [];
}

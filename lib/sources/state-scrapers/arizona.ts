/**
 * Arizona Legislature bill scraper.
 *
 * DISABLED: azleg.gov renders bill listings client-side via WordPress/AJAX.
 * The /bills/ page returns only a static shell with "Introduced Bills" as
 * the title. The actual bill data is fetched by JavaScript after page load.
 * Verified 2026-04-16 via curl: zero bill rows appear in the raw HTML.
 *
 * The pipeline calls this function, receives an empty array, and falls
 * through to the Tavily enrichment path. No crash, no timeout, no wasted
 * Apify compute credits.
 *
 * Re-enable when a Playwright-based Apify actor or a direct API endpoint
 * becomes viable.
 */

import type { StateScrapedBill } from "./index.js";

export async function scrapeArizona(): Promise<StateScrapedBill[]> {
  return [];
}

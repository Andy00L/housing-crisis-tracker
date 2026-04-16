/**
 * Apify-backed state legislature scrapers. Used as a supplementary layer
 * for states where the Tavily/Claude pipeline returns too few bills and
 * there is no LegiScan coverage yet.
 *
 * Adding a new state:
 *   1. Create a scraper module (e.g. ./nevada.ts) that exports one function
 *      returning Promise<StateScrapedBill[]>.
 *   2. Register it in SCRAPERS below.
 *   3. If the state's selectors are brittle, keep the function tolerant:
 *      return an empty array on selector mismatch rather than throwing.
 */

import { scrapeArizona } from "./arizona.js";
import { scrapeColorado } from "./colorado.js";

export interface StateScrapedBill {
  /** Official bill identifier, e.g. "HB 24-1313". */
  billNumber: string;
  title: string;
  sponsor?: string;
  status?: string;
  url: string;
  introducedDate?: string;
}

type StateScraper = () => Promise<StateScrapedBill[]>;

/**
 * Two-letter state code -> scraper. New entries must be added here; the
 * federal pipeline looks states up by code before falling through to Tavily.
 */
const SCRAPERS: Record<string, StateScraper> = {
  CO: scrapeColorado,
  AZ: scrapeArizona,
};

/**
 * Try to scrape the state's legislature. Returns null when the state has no
 * registered scraper. Returns [] when the scraper ran but the selectors did
 * not match. Throws only on authentication or budget failures (so the caller
 * can decide whether to abandon the rest of the states).
 */
export async function scrapeStateIfAvailable(
  stateCode: string,
): Promise<StateScrapedBill[] | null> {
  const scraper = SCRAPERS[stateCode.toUpperCase()];
  if (!scraper) return null;
  try {
    return await scraper();
  } catch (err) {
    // Log and degrade. The caller keeps the existing (Tavily) bills rather
    // than fail the whole pipeline on one state's selectors breaking.
    console.warn(`[state-scraper] ${stateCode} failed: ${(err as Error).message}`);
    return null;
  }
}

export function hasScraper(stateCode: string): boolean {
  return stateCode.toUpperCase() in SCRAPERS;
}

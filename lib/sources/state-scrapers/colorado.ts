/**
 * Colorado General Assembly bill scraper.
 *
 * Target page: https://leg.colorado.gov/bill-search?combine=housing
 *   Drupal-based search page. Without a session filter it returns active
 *   bills for the current session, which is what we want for the weekly sync.
 *
 * Fallback tolerance: if the page structure changes, the pageFunction
 * returns an empty array and logs a diagnostic. The caller treats an empty
 * array the same as "no scraper": existing Tavily bills are kept and a note
 * is added to the run report.
 */

import { runActor } from "../apify.js";
import type { StateScrapedBill } from "./index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApifyPageCtx = any;

// The selector list is intentionally generous so minor Drupal theme changes
// do not break the scraper outright. The first non-empty match wins inside
// the pageFunction.
const COLORADO_PAGE_FUNCTION = `async function pageFunction(context) {
  const { $, request, log } = context;

  const rows = $('.view-content .views-row, article.bill-result, .bill-row');
  if (rows.length === 0) {
    log.warning('Colorado selectors did not match on ' + request.url);
    return [];
  }

  const bills = [];
  rows.each((_, el) => {
    const $el = $(el);
    const billNumber = $el.find('.bill-number, .views-field-field-bill-number, .bill-id').first().text().trim();
    const title = $el.find('.bill-title, .views-field-title a, h2 a, h3 a').first().text().trim();
    const hrefRaw = $el.find('a.bill-link, .views-field-title a, h2 a, h3 a').first().attr('href') || '';
    const status = $el.find('.bill-status, .views-field-field-bill-status').first().text().trim() || undefined;
    const sponsor = $el.find('.bill-sponsor, .views-field-field-bill-sponsor').first().text().trim() || undefined;
    const url = hrefRaw.startsWith('http') ? hrefRaw : ('https://leg.colorado.gov' + hrefRaw);

    if (billNumber && title) {
      bills.push({ billNumber, title, sponsor, status, url });
    }
  });
  return bills;
}`;

export async function scrapeColorado(): Promise<StateScrapedBill[]> {
  const result = await runActor<StateScrapedBill & Record<string, unknown>>({
    actorId: "apify/web-scraper",
    input: {
      startUrls: [
        { url: "https://leg.colorado.gov/bill-search?combine=housing" },
        // A second search with "zoning" widens coverage. Dedup happens in the
        // caller by billNumber, so running both is safe.
        { url: "https://leg.colorado.gov/bill-search?combine=zoning" },
      ],
      pageFunction: COLORADO_PAGE_FUNCTION,
      maxRequestsPerCrawl: 4,
      maxConcurrency: 1,
      proxyConfiguration: { useApifyProxy: true },
      // Drupal pages rarely need a full browser; faster CheerioCrawler-style
      // load works fine and uses less compute.
      useChrome: false,
    },
    timeoutSecs: 180,
    memoryMbytes: 512,
  });

  return result.results.map((r) => ({
    billNumber: String((r as ApifyPageCtx).billNumber ?? "").trim(),
    title: String((r as ApifyPageCtx).title ?? "").trim(),
    sponsor: (r as ApifyPageCtx).sponsor ? String((r as ApifyPageCtx).sponsor) : undefined,
    status: (r as ApifyPageCtx).status ? String((r as ApifyPageCtx).status) : undefined,
    url: String((r as ApifyPageCtx).url ?? ""),
  })).filter((b) => b.billNumber && b.title && b.url);
}

/**
 * Arizona Legislature bill scraper.
 *
 * Target site: https://www.azleg.gov/ (Arizona State Legislature). The main
 * bill-search interface at apps.azleg.gov is JS-heavy, but the legislative
 * overview pages include an HTML list of bills by subject that we can scrape
 * without executing JavaScript.
 *
 * Primary URL: https://www.azleg.gov/legtext/57leg/1R/SumIndex/Housing.pdf
 *   No good: that's a PDF, not useful here.
 *
 * Alternative: https://www.azleg.gov/bills (bill dashboard with recent bills,
 * including a subject filter link for "Housing"). If the subject filter is
 * not available, we fall back to scraping the main bill list and filtering
 * the output client-side for housing keywords.
 */

import { runActor } from "../apify.js";
import type { StateScrapedBill } from "./index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApifyPageCtx = any;

const ARIZONA_PAGE_FUNCTION = `async function pageFunction(context) {
  const { $, request, log } = context;

  // The Arizona bill overview page lists bills with .bill-row or a table.
  // The legislative data page (/legislative-information) surfaces recent bills.
  // Multiple selector families are tried to survive theme changes.
  const rowSelectors = [
    '.bill-row',
    'table.bill-list tbody tr',
    'table.bill-table tbody tr',
    'article.bill',
    '.views-row',
  ];

  let rows = $();
  for (const sel of rowSelectors) {
    const found = $(sel);
    if (found.length > 0) { rows = found; break; }
  }
  if (rows.length === 0) {
    log.warning('Arizona selectors did not match on ' + request.url);
    return [];
  }

  const bills = [];
  const keywords = /housing|zoning|affordab|rent|tenant|homeless|landlord|construction/i;

  rows.each((_, el) => {
    const $el = $(el);
    const billNumber = $el.find('.bill-number, td:first-child, .field-bill-number, a.bill-id').first().text().trim();
    const title = $el.find('.bill-title, td:nth-child(2), .field-bill-title, h3 a, h2 a').first().text().trim();
    const hrefRaw = $el.find('a.bill-link, a[href*="BillStatus"], a[href*="bill"]').first().attr('href') || '';
    const status = $el.find('.bill-status, .field-bill-status').first().text().trim() || undefined;
    const sponsor = $el.find('.bill-sponsor, .field-bill-sponsor').first().text().trim() || undefined;
    const url = hrefRaw.startsWith('http') ? hrefRaw : ('https://www.azleg.gov' + hrefRaw);

    // Filter by housing keywords in title since this page may list all bills.
    if (billNumber && title && keywords.test(title)) {
      bills.push({ billNumber, title, sponsor, status, url });
    }
  });
  return bills;
}`;

export async function scrapeArizona(): Promise<StateScrapedBill[]> {
  const result = await runActor<StateScrapedBill & Record<string, unknown>>({
    actorId: "apify/web-scraper",
    input: {
      startUrls: [
        { url: "https://www.azleg.gov/bills/" },
        { url: "https://www.azleg.gov/legislative-information/" },
      ],
      pageFunction: ARIZONA_PAGE_FUNCTION,
      maxRequestsPerCrawl: 4,
      maxConcurrency: 1,
      proxyConfiguration: { useApifyProxy: true },
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

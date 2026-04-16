# US legislation data sources

The US pipeline pulls from three tiers so we get the best signal available
per state while keeping cost predictable and a clear story about where
each bill came from.

## Tier 1. Official government APIs (primary)

**Congress.gov API v3.** Federal bills. Free, 5000 requests per hour.
Activated by setting `CONGRESS_GOV_API_KEY` in `.env.local` (or the
GitHub Actions secret of the same name). Register at
https://api.congress.gov/sign-up/.

What it gets us:
- Canonical congress.gov URLs built from the bill identifier. No
  dependence on a scraper or search snippet being right.
- Structured sponsor data with bioguideId, party, state, district.
- Numeric policy-area classification that lets us drop tangential
  mentions (military base housing, tax bills that touch housing only
  in passing).

**LegiScan.** US state bills. 30000 requests per month free. Activates
automatically the moment `LEGISCAN_API_KEY` is set. Before the key
arrives, state data comes from Tier 2 and Tier 3. When the key is
added, the merge pipeline upgrades each existing bill's `sourceUrl` to
the canonical state_link and its `stage` to the numeric LegiScan status.

## Tier 2. Apify-backed scraping (state supplement)

For states where Tavily returns fewer than 4 bills, we fall back to a
state-specific Apify scraper. Currently supported: Colorado, Arizona.
Each scraper is a small Apify actor running on the free tier ($5 of
compute credit per month, which is plenty for the weekly sync).

What the scraper does:
1. Loads the state legislature's bill-search page (e.g.
   leg.colorado.gov/bill-search?combine=housing).
2. Applies a generous set of CSS selectors so minor theme updates do
   not break ingestion.
3. Returns an array of {billNumber, title, sponsor, status, url} rows.

If the selectors do not match the page (site redesign, JS-only
content), the scraper returns an empty array and the pipeline keeps
whatever Tavily already found. The run report logs the skip so we can
fix selectors without losing data.

Adding a new state scraper is three steps:
1. Create `lib/sources/state-scrapers/{state}.ts` that exports a
   function returning `StateScrapedBill[]`.
2. Register it in `lib/sources/state-scrapers/index.ts` under the
   two-letter state code.
3. Run the pipeline locally and inspect the output before committing.

## Tier 3. Tavily + Claude extraction (fallback)

Used for every state before the LegiScan key is configured, and for
any state without a dedicated Apify scraper. Tavily searches the
state's official domains, Claude extracts structured bill data from
search snippets, and every extracted URL is validated with Tavily
Extract so hallucinated links never reach the data files.

State-specific supplementary queries (defined in
`STATE_SPECIFIC_QUERIES` in us-states-housing-research.ts) run in
addition to the two generic queries. For Colorado we look up the
Proposition 123 fund, HB25/SB25 bill series, and CHFA news. For
Washington we call out HB 1110 directly. Those queries materially
improve coverage without burning the monthly Tavily budget.

## Data merge strategy

When multiple sources return the same bill (dedupe by `billCode`):

1. Tier precedence for metadata. Congress.gov or LegiScan wins on
   `sourceUrl`, `stage`, and `updatedDate`. Tier 3 (Tavily) wins only
   when higher tiers have no record of the bill.
2. Classification is preserved. `stance`, `impactTags`, and `category`
   come from the Claude pass regardless of which source surfaced the
   bill. This is important because LegiScan status codes do not carry
   political stance information.
3. Dedup by billNumber (normalized to uppercase, whitespace removed)
   within a given state or jurisdiction.

## What happens when the LegiScan key arrives

Dead simple:
1. Add `LEGISCAN_API_KEY` to `.env.local` for local runs.
2. Add the same secret to GitHub Actions.

No code changes. The legislation-sync workflow's conditional step
`if: ${{ secrets.LEGISCAN_API_KEY != '' }}` picks it up on the next
Wednesday run. State bill counts typically go up by 2-3x because
LegiScan catches bills that never make it into Tavily's top results.

## What to watch for

- Congress.gov rate limit (5000/hour) is plenty for our weekly run.
  If we start enriching with historical bills we should add caching
  in `lib/sources/congress-gov.ts` itself.
- Apify compute budget is $5/month free. `lib/sources/apify.ts` tracks
  consumption in `data/raw/apify/_usage.json` with a soft warning at
  4.0 CU and a hard cap at 4.5 CU. Crossing the cap throws
  `ApifyBudgetExhausted` and the scraper call is skipped cleanly.
- LegiScan's `getSearch` returns an OBJECT (keyed by numeric strings
  plus a "summary" key), not an array. The client flattens it for us.
  If LegiScan ever ships a v2 that returns a proper array, delete the
  flattening logic in `searchEntriesFromResult`.

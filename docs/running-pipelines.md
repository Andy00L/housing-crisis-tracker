# Running Pipelines

All sync scripts live in `scripts/sync/`. They fetch data from upstream APIs, classify bills, and write JSON to `data/`. Each script is idempotent. A second run in the same hour mostly hits Tavily cache and returns fast.

[Back to README](../README.md)

## Prerequisites

You need a `.env.local` file with API keys. See [Configuration](../README.md#configuration) in the README for the full variable list. No keys are required for local development since the app ships with pre-built data in `lib/placeholder-data.ts`.

## Canada (primary)

```bash
npx tsx scripts/sync/canada-legislation.ts         # Federal bills from LEGISinfo
npx tsx scripts/sync/bc-legislation.ts             # BC provincial bills
npx tsx scripts/sync/province-housing-research.ts  # All other provinces via Tavily
npx tsx scripts/sync/housing-projects.ts           # Housing projects (Build Canada Homes)
npx tsx scripts/sync/cmhc-projects.ts              # StatsCan housing starts data
npx tsx scripts/sync/cmhc-nhs-projects.ts          # NHS individual projects from HICC
npx tsx scripts/sync/canada-municipal-housing.ts   # Census division municipal data
npx tsx scripts/sync/officials.ts                  # Canadian housing officials
npx tsx scripts/sync/statcan-housing.ts            # StatsCan housing metrics
npx tsx scripts/sync/cmhc-housing.ts               # CMHC HMI portal metrics
npx tsx scripts/sync/news-rss.ts                   # RSS news feeds
```

## United States

```bash
npx tsx scripts/sync/us-federal-housing.ts         # Congress.gov API
npx tsx scripts/sync/us-states-housing-research.ts # 10 state legislatures
npx tsx scripts/sync/us-legiscan-housing.ts        # LegiScan supplement (needs LEGISCAN_API_KEY)
npx tsx scripts/sync/us-housing-projects.ts        # HUD + state agencies
npx tsx scripts/sync/us-officials.ts               # Federal housing officials
npx tsx scripts/sync/fred-housing.ts               # FRED economic metrics
npx tsx scripts/sync/census-housing.ts             # Census Bureau housing data
npx tsx scripts/sync/zillow-housing.ts             # Zillow home values
```

## Europe and Asia-Pacific

These pipelines exit immediately unless their guard variable is set.

```bash
EXECUTE_EUROPE=1 npx tsx scripts/sync/europe-housing.ts
EXECUTE_EUROPE=1 npx tsx scripts/sync/europe-officials.ts
EXECUTE_ASIA=1 npx tsx scripts/sync/asia-pacific-housing.ts
EXECUTE_ASIA=1 npx tsx scripts/sync/asia-officials.ts
npx tsx scripts/sync/uk-bills.ts                   # No guard needed
```

## International Metrics

```bash
npx tsx scripts/sync/eurostat-housing.ts
npx tsx scripts/sync/oecd-housing.ts
npx tsx scripts/sync/worldbank-housing.ts
npx tsx scripts/sync/abs-housing.ts
npx tsx scripts/sync/uk-landregistry.ts
npx tsx scripts/sync/hk-rvd.ts
npx tsx scripts/sync/sg-hdb.ts
```

## Project Enrichment

Adds factual blurbs to projects with generic CMHC descriptions. Uses Tavily search + Claude Haiku.

```bash
npm run enrich:projects                            # Default: top 100 by unit count
ENRICH_MAX=20 npx tsx scripts/sync/enrich-project-descriptions.ts  # Limit to 20
npx tsx scripts/sync/enrich-project-descriptions.ts --dry-run      # Preview only
```

## Bill Classification

Classification runs automatically during legislation sync. To reclassify with Claude:

```bash
npx tsx scripts/sync/legislation-classify.ts       # Heuristic regex pass
npx tsx scripts/sync/legislation-reclassify.ts     # Claude Sonnet reclassification
RECLASSIFY_MAX=50 npx tsx scripts/sync/legislation-reclassify.ts  # Limit API calls
```

## After Any Sync

Rebuild the placeholder data file that feeds the UI:

```bash
npm run data:rebuild
```

This reads all JSON files in `data/` and writes `lib/placeholder-data.ts`.

## Pipeline Behavior

Pipelines are designed for partial failure. If 10 of 13 provinces succeed and 3 fail, the successful data is saved and the failures are logged in the run report with `retryable: true`. The next run retries failed entities first.

Exit code 0 means the pipeline completed (even with partial failures). Exit code 1 means a genuine error: missing config, uncaught exception, or unreadable state.

Tavily results are cached aggressively. A second run within the same hour returns cached data without spending credits.

[Back to README](../README.md)

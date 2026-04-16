# Housing Tracker . Canada-first, multi-region

A live map of housing policy. Canada is the primary dataset with federal
bills, provincial legislation, major projects, and officials. The United
States is a full secondary region covering federal housing law plus the
10 housing-critical states. Europe and Asia-Pacific scaffolding is in
place but dormant: scripts exist and data files are empty until the
`europe-asia-sync` workflow is dispatched manually.

```
Next.js 16.2.3 . React 19.2.4 . TypeScript 5 . Tailwind CSS v4
```

## Quick start

```bash
git clone https://github.com/Andy00L/housing-crisis-tracker.git && cd housing-crisis-tracker
npm install
cp .env.example .env.local     # fill in your keys (see Configuration)
npm run dev                    # http://localhost:3000
```

No keys are required for local development. The app ships with
pre-built data in `lib/placeholder-data.ts`. Keys are only needed to
run the sync scripts that refresh data from upstream APIs.

## What it tracks

- **Canada (primary).** Federal Parliament + all 13 provinces and
  territories. Bills, housing projects, officials. Fed by LEGISinfo,
  BC Laws, and Tavily research against the 12 other provincial
  legislatures.
- **United States (secondary).** Federal housing legislation plus the
  top 10 housing-critical states: California, New York, Texas, Florida,
  Washington, Massachusetts, Oregon, Colorado, Arizona, North Carolina.
  Data comes from Tavily searches against congress.gov, hud.gov, and
  each state legislature's domain. The other 40 states render as grey
  on the map by design. We're honest about coverage rather than
  faking it.
- **Europe (light coverage, dormant).** UK, Germany, France, Italy,
  Spain, Poland, Netherlands, Sweden, Finland, Ireland, and the
  European Parliament. Scripts exist. Data files are empty until the
  `europe-asia-sync` workflow is dispatched. Max 3 bills + 3 projects
  per entity by design.
- **Asia-Pacific (light coverage, dormant).** Japan, South Korea,
  China, India, Indonesia, Taiwan, Australia. Same dormant pattern.

Counts (April 2026):

| Layer | Count | Source |
|---|---|---|
| Canadian housing bills (federal) | ~152 | LEGISinfo |
| Canadian provincial bills | ~168 / 13 jurisdictions | BC Laws + Tavily |
| Canadian housing projects | 13 | Build Canada Homes, CMHC |
| Canadian officials | 12 | canada.ca + Tavily |
| US federal housing bills | 2 | Tavily research (congress.gov, hud.gov) |
| US state housing bills | ~60 / 10 states | Tavily research per state legislature |
| US housing projects | ~25 | Tavily research (HUD, state agencies) |
| US housing officials | 9 | hud.gov + Tavily |
| UK housing bills (secondary) | ~267 | UK Parliament Bills API |
| Europe housing entities | 11 (dormant, empty) | scripts/sync/europe-housing.ts |
| Asia-Pacific entities | 7 (dormant, empty) | scripts/sync/asia-pacific-housing.ts |

Counts come from `jq`/`node` over JSON files in `data/`, not from memory.

## Architecture

```mermaid
graph TD
    subgraph Primary_Pipelines["Primary Pipelines"]
        LEGI[LEGISinfo JSON] --> LEGSYNC[canada-legislation.ts]
        OP[OpenParliament fallback] --> LEGSYNC
        BCLAWS[BC Laws API] --> BCSYNC[bc-legislation.ts]
        CANLII[CanLII via Tavily fallback] --> BCSYNC
        TAV1[Tavily research] --> PROVSYNC[province-housing-research.ts]
        BCH[Build Canada Homes via Tavily] --> PROJSYNC[housing-projects.ts]
        CANADACA[canada.ca cabinet] --> OFFSYNC[officials.ts]
        TAV2[Tavily enrichment] --> OFFSYNC
        RSS[Canadian housing RSS feeds] --> NEWS[news-rss.ts]
        STATCAN[StatsCan WDS] --> METR[metrics-sync.ts]
        CMHC[CMHC HMI portal] --> METR
    end

    LEGSYNC --> FEDJSON[data/legislation/federal-ca.json]
    BCSYNC --> BCJSON[data/legislation/provinces/BC.json]
    PROVSYNC --> PROVJSON[data/legislation/provinces/*.json]
    PROJSYNC --> PROJJSON[data/projects/canada.json]
    OFFSYNC --> POLSJSON[data/politicians/canada.json]
    NEWS --> NEWSJSON[data/news/summaries.json]
    METR --> METRJSON[data/housing/canada/*.json]

    subgraph Resilience["Resilience Layer"]
        RF[resilient-fetch.ts]
        FR[fallback-router.ts]
        RR[run-report.ts]
        HR[health-registry.ts]
    end

    LEGSYNC --> RF
    BCSYNC --> RF
    PROVSYNC --> RF
    PROJSYNC --> RF
    OFFSYNC --> RF
    RF --> RR
    RF --> HR
    RR --> RUNLOG[data/raw/_run-reports/]
    HR --> HEALTHJSON[data/raw/_health.json]

    subgraph Build["Build"]
        BLD[build-placeholder.ts] --> PLH[lib/placeholder-data.ts]
    end

    FEDJSON --> BLD
    BCJSON --> BLD
    PROVJSON --> BLD
    PROJJSON --> BLD
    POLSJSON --> BLD
    NEWSJSON --> BLD
    METRJSON --> BLD

    subgraph UI["Next.js 15 App"]
        HEALTH[/api/health]
        FOOTER[HealthFooter]
        DS[/about/data-sources]
    end

    HEALTHJSON --> HEALTH
    HEALTH --> FOOTER
    FOOTER --> DS

    subgraph Cron["GitHub Actions"]
        W1[news-rss.yml 3x daily]
        W2[legislation-sync.yml weekly Wed . CA + US federal + US states]
        W3[metrics-sync.yml weekly Mon]
        W4[projects-sync.yml weekly Tue . CA + US]
        W5[officials-sync.yml monthly 1st Sun . CA + US]
        W6[europe-asia-sync.yml manual dispatch only]
    end

    subgraph US_Pipelines["US Pipelines"]
        CGOV[Congress.gov API primary] --> USFEDSYNC[us-federal-housing.ts]
        TAVILYF[Tavily enrichment cap] --> USFEDSYNC
        USST[state legislature domains via Tavily] --> USSTSYNC[us-states-housing-research.ts]
        APIFY[Apify state scrapers] --> USSTSYNC
        LEGISCAN[LegiScan dormant supplement] --> USLSSYNC[us-legiscan-housing.ts]
        USPROJ[HUD + state agencies via Tavily] --> USPROJSYNC[us-housing-projects.ts]
        HUDGOV[hud.gov leadership] --> USOFFSYNC[us-officials.ts]
    end

    USFEDSYNC --> USFEDJSON[data/legislation/federal-us-housing.json]
    USSTSYNC --> USSTJSON[data/legislation/us-states-housing/*.json]
    USLSSYNC --> USSTJSON
    USPROJSYNC --> USPROJJSON[data/projects/us.json]
    USOFFSYNC --> USOFFJSON[data/politicians/us.json]

    USFEDJSON --> BLD
    USSTJSON --> BLD
    USPROJJSON --> BLD
    USOFFJSON --> BLD

    subgraph Dormant["Dormant (Prompt E.2)"]
        EUSYNC[europe-housing.ts . 11 countries]
        EUOFF[europe-officials.ts]
        APSYNC[asia-pacific-housing.ts . 7 countries]
        APOFF[asia-officials.ts]
    end
    EUSYNC -.-> W6
    EUOFF -.-> W6
    APSYNC -.-> W6
    APOFF -.-> W6
```

All five workflows finish with a `summarize-run-report` step that
writes a Markdown table to `$GITHUB_STEP_SUMMARY` so you can see the
pipeline status at a glance without digging through logs.

## Configuration

| Variable | Required | Used by |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Classification, blurbs, news, officials, regional overview |
| `TAVILY_API_KEY` | yes | Provincial research, housing projects, officials, URL validation |
| `FRED_API_KEY` | no | US FRED metrics. Weekly metrics-sync only. |
| `CONGRESS_GOV_API_KEY` | no | Primary source for US federal bills. Free, 5000 req/hour. Register at api.congress.gov. |
| `APIFY_API_TOKEN` | no | State legislature scrapers (Colorado, Arizona). Free tier $5/month of compute. |
| `LEGISCAN_API_KEY` | no | US state bills. Dormant until set. When present, upgrades existing state data on next sync. |
| `KV_REST_API_URL` | no | Visitor counter (Vercel KV) |
| `KV_REST_API_TOKEN` | no | Visitor counter (Vercel KV) |

See `.env.example` for the full list with inline notes.

## Running locally

```bash
npm install
cp .env.example .env.local
# edit .env.local with your keys
npm run dev
```

The dev server hot-reloads. Type checks run on every file save. Watch
the console for the bioguide-mismatch warnings. They come from the US
politicians dataset and are benign.

## Running pipelines manually

```bash
npx tsx scripts/sync/canada-legislation.ts
npx tsx scripts/sync/bc-legislation.ts
npx tsx scripts/sync/province-housing-research.ts
npx tsx scripts/sync/housing-projects.ts
npx tsx scripts/sync/officials.ts
npx tsx scripts/sync/statcan-housing.ts
npx tsx scripts/sync/cmhc-housing.ts
npx tsx scripts/sync/news-rss.ts
npm run data:rebuild
```

The pipelines are idempotent. A second run in the same hour mostly
hits Tavily cache and returns fast.

## npm scripts

```bash
npm run dev             # Start dev server
npm run build           # Production build (prebuild copies news JSON)
npm run start           # Serve production build
npm run lint            # ESLint
npm run data:rebuild    # Regenerate lib/placeholder-data.ts
npm run news:poll       # Manual RSS poll
npm run news:regen      # Full news summary rebuild
npm run geo:canada      # Fetch Canadian census geography
npm run sync:provinces  # Provincial housing research
```

## Tradeoffs and limitations

- Smaller territories (YT, NT, NU, PE) have very few housing bills.
  That reflects reality, not a data gap. The legislative volume in
  Nunavut is genuinely small.
- Housing project coordinates fall back to province centroids when a
  specific city isn't in our lookup table. Dots for those projects
  cluster at the centroid rather than the actual location. The
  fallback chain and resolved precision are exposed by
  `resolveProjectCoordinates` in `lib/projects-map.ts`.
- US coverage is intentionally focused. Top 10 states are tracked in
  depth; the other 40 render grey on the map. When a state legislature
  has a sparse housing-bill slate for a given session (e.g. Texas
  during recess), the pipeline may pull fewer than 5 bills and mark the
  URLs as unvalidated if Tavily Extract briefly fails.
- Europe and Asia-Pacific entities have minimal bill/project data (max
  3 of each) per country by design. Full coverage for those regions
  requires dispatching the `europe-asia-sync` workflow with
  `execute_europe=1` and/or `execute_asia=1`. Until then, their map
  tiles render grey and their entity panels show the "coverage pending"
  notice.
- Tavily is on the dev tier (1000 credits per month). Running the full
  provincial research pipeline plus projects plus officials consumes
  roughly 100 to 150 credits. Heavy manual re-runs will exhaust the
  budget. Pipelines cache aggressively.
- CMHC uses an undocumented export endpoint. The metrics-sync workflow
  has `continue-on-error: true` on the CMHC step, so a broken CMHC day
  doesn't fail the overall run. Last good values stay in place.
- Data is for informational purposes only. Not legal or financial
  advice.

## Contributing

Fork, branch, PR. Checks before opening the PR:

```bash
npx tsc --noEmit
npm run lint
npm run build
```

The `/docs` folder has the architectural decisions (Canada pivot,
repurpose plan). Read those before making sweeping changes.

## License

See `LICENSE` in the repo root. The Open Government Licence . Canada
applies to the Canadian legislation and market data where it is
republished from official sources.

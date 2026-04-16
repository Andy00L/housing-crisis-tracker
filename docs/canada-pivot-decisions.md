# Canada-First Pivot. Architectural Decisions

Recorded 2026-04-16. Source of truth for scope, naming, and dependency order for the Canada-first pivot.

## 1.1 Region priority

Default state on first paint:

| Axis | Value |
|---|---|
| `region` | `"na"` |
| `naView` | `"provinces"` |
| `selectedGeoId` | `null` (Canada overview via `getOverviewEntity`) |
| Globe rotation | lat 56N, lng -96W |
| Region selector order | Canada, United States, Europe, Asia |

Each tab in the region selector maps to a default `{region, naView}` pair:

| Tab | region | naView | default entity |
|---|---|---|---|
| Canada (active) | `"na"` | `"provinces"` | `canada-federal` |
| United States | `"na"` | `"states"` | `us-federal` |
| Europe | `"eu"` | `"countries"` | first EU entity with `isOverview` |
| Asia | `"asia"` | `"countries"` | first Asia entity with `isOverview` |

## 1.2 Default entity on load

Side panel loads `canada-federal` on first paint.

### Note on entity ID convention (important)

The original spec referenced `ca-federal` as the entity ID. The actual codebase uses `canada-federal` (see `scripts/build-placeholder.ts:333`). `LegislationTable.tsx:107` already matches on `entity.id === "canada-federal"`. The filter identifiers in the UI (`"ca-federal"`, `"ca-provinces"`) are kept because they drive the scope filter chips and match what users see as labels.

Decision: preserve the existing convention.

- Entity IDs: `canada-federal`, `us-federal`, `alberta`, `british-columbia`, `quebec`, etc. (from `slugify(name)`)
- Filter IDs (UI-facing): `ca-federal`, `ca-provinces`, `us-federal`, `us-states`, etc.
- geoId: numeric ISO 3166-1 for countries (`124` Canada, `840` USA) and `CA-{abbr}` for provinces (`CA-ON`, `CA-BC`)

## 1.3 Tavily architecture

```
lib/tavily-client.ts      Singleton client, retry, budget-aware
lib/tavily-cache.ts       Hash-keyed file cache at data/raw/tavily/
lib/tavily-budget.ts      Monthly credit tracking
lib/tavily-types.ts       Shared TS types
```

### Cache

- Key: sha256 of `{query, search_depth, include_domains, exclude_domains, max_results, days, topic}`
- Path: `data/raw/tavily/{hash}.json`
- Envelope: `{cached_at, expires_at, request, response}`
- TTL: 24h for `topic: "news"`, 7 days for research queries

### Budget

- Plan: Tavily free dev tier, 1000 credits/month
- Costs: basic search = 1 credit, advanced search = 2 credits, extract = 1 credit
- State file: `data/raw/tavily/_usage.json` with per-month tally
- Soft cap: 900 credits (warn, reduce future query depth)
- Hard cap: 950 credits (throw `TavilyBudgetExhausted`, scripts fall back to cache-only)

### Security

- Server-side only. Never import from a Client Component.
- API key via `process.env.TAVILY_API_KEY`.
- Never log the key. Never include it in error messages or responses returned to the browser.
- `.env.local` is in `.gitignore` (verified).

## 1.4 Pipeline dependency order

Each step is a separate npm script, idempotent (skip-if-fresh cache).

```
1.  LEGISinfo bills (federal)                primary, no Tavily
2.  BC Laws bills                            primary, no Tavily
3.  Provincial research (12 provinces)       Tavily-backed
4.  Housing projects                         Tavily-backed
5.  Officials (fed + prov + municipal)       Tavily-backed
6.  News RSS (already Canada-first)          RSS, summarize with Haiku
7.  Regional overview prose (Canada)         Claude synthesis
8.  Bill classification + stance aggregation Claude (reuses existing classifier)
9.  Entity blurbs                            Claude
10. Build placeholder                        local compile
```

## 1.5 Resilience architecture

Every external HTTP call goes through one wrapper. No raw `fetch()` in pipeline or sync scripts.

```
lib/resilient-fetch.ts              public entry: resilientFetch<T>(...)
lib/resilience/types.ts             shared types (FailureReason, SourceName, SourceHealth)
lib/resilience/rate-limit.ts        per-host token bucket
lib/resilience/circuit-breaker.ts   opossum wrapper, one breaker per source
lib/resilience/health-registry.ts   writes data/raw/_health.json
lib/resilience/run-report.ts        writes data/raw/_run-reports/{pipeline}-{timestamp}.json
lib/resilience/fallback-router.ts   consults _health.json, picks primary vs fallback
```

### Per-source budgets

| Source | Rate limit | Circuit thresholds | Timeout |
|---|---|---|---|
| LEGISinfo | 4 req/s | 50% fail over 5 reqs | 30s |
| OpenParliament | 2 req/s | 50% fail over 5 reqs | 30s |
| BC Laws | 2 req/s | 50% fail over 5 reqs | 30s |
| StatsCan WDS | 4 req/s | 50% fail over 5 reqs | 30s |
| CMHC | 2 req/s | 50% fail over 5 reqs | 45s |
| Tavily | 3 req/s | 50% fail over 5 reqs | 30s |
| Anthropic | 2 req/s | 50% fail over 5 reqs | 60s |
| RSS feed (any) | 4 req/s | 50% fail over 10 reqs | 15s |

Reset timeout for all: 1 hour (3600000 ms).

### Retry policy

- 3 attempts, exponential backoff 1s, 2s, 4s
- Retry on 5xx, 429, and network errors
- Never retry on 4xx other than 429 (404 stays 404)
- Honor `Retry-After` header when present

## 1.6 Fallback matrix

Consulted by `fallback-router.ts`. When primary is `"down"`, route to fallback automatically.

| Primary | Fallback | Quality | Notes |
|---|---|---|---|
| LEGISinfo | OpenParliament.ca API | high | Same dataset, different host. Client-side keyword filter (OpenParliament has no server text search). |
| OpenParliament (tier 2) | ourcommons.ca XML/RSS | medium | Official Parliament open data. |
| BC Laws | CanLII via Tavily Extract on `canlii.org/en/bc/laws/` | medium | Budget ~20 Tavily credits per fallback run. |
| StatsCan WDS | CMHC HMI Portal scrape | medium | Symmetric (see below). |
| CMHC | StatsCan WDS equivalent table | high | Symmetric. Mark metric `dataSource: "fallback"`. |
| Tavily | Skip research pipelines, keep last known cache | zero new data | Log in run report, retry next schedule. |
| Anthropic | Queue jobs, bills stay `awaiting-classification` | zero new data | Auto-resume when API returns. |
| LegiScan (US) | Serve existing data from `lib/placeholder-data.ts`, banner "Last synced: {date}" | zero new US bills | |
| Any single RSS feed | Skip that feed, continue others | partial coverage | One broken feed never kills the news poll. |

## 1.7 Partial failure tolerance

No pipeline uses all-or-nothing. If 10 of 13 provinces succeed:

- Save the 10
- Log the 3 failures to the run report with `retryable: true`
- Exit with process code 0 (CI does not fail; run report flags partial status)
- Next scheduled run re-tries the 3 failed entities first

Exit code 1 only fires on genuine errors: uncaught exceptions, missing config, unreadable state file.

## 1.8 Out of scope for this pivot

These stay in their current state unless a future task asks otherwise:

- EU, UK, Asia-Pacific data pipelines
- US county-level data (lib/municipal-data.ts)
- Donor / politician finance data (lib/donor-data.ts, lib/politicians-data.ts) apart from demoting US politicians to a secondary scope
- Energy / power-plant visualization (lib/energy-data.ts, lib/energy-colors.ts) flagged for removal in Phase 8

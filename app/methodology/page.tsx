import Link from "next/link";
import type { Metadata } from "next";
import NuanceLegend from "@/components/sections/NuanceLegend";

export const metadata: Metadata = {
  title: "Methodology · Housing Crisis Tracker",
};

export default function MethodologyPage() {
  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-8 py-24">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink transition-colors mb-16"
        >
          ← Back
        </Link>

        <div className="text-[13px] font-medium text-muted tracking-tight mb-3">
          Methodology
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold text-ink tracking-tight leading-[1.05] mb-10">
          How I build the data
        </h1>

        <div className="text-base text-ink/80 leading-relaxed space-y-5">
          <p>
            If you read something wrong,{" "}
            <a
              href="mailto:andy.luemba@protonmail.com"
              className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
            >
              please let me know
            </a>
            .
          </p>

          <h2 className="text-xl font-semibold text-ink tracking-tight pt-4">
            Where the legislation comes from
          </h2>
          <p>
            Every bill comes from an official source, verified against
            government records.
          </p>
          <p>
            <strong className="text-ink font-semibold">Canada Federal:</strong>{" "}
            <a
              href="https://www.parl.ca/legisinfo"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
            >
              LEGISinfo
            </a>{" "}
            JSON endpoint (parl.ca). No auth required. If LEGISinfo is
            unavailable, the pipeline falls back to the{" "}
            <a
              href="https://openparliament.ca"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
            >
              OpenParliament.ca
            </a>{" "}
            API, which serves the same dataset from a different host.
          </p>
          <p>
            <strong className="text-ink font-semibold">
              Canada Provincial (British Columbia):
            </strong>{" "}
            BC Laws full-text search API. Fallback: CanLII via Tavily
            Extract.
          </p>
          <p>
            <strong className="text-ink font-semibold">
              Canada Provincial (12 other provinces and territories):
            </strong>{" "}
            Tavily research on each province&rsquo;s official legislature
            domain (e.g. ola.org for Ontario, assnat.qc.ca for Quebec).
            Claude Sonnet extracts structured bill data from the search
            snippets. Every extracted sourceUrl is validated with Tavily
            Extract. Bills that fail validation are dropped. This is a
            hallucination guard: if Claude invents a URL, the validator
            catches it.
          </p>
          <p>
            <strong className="text-ink font-semibold">US Federal:</strong>{" "}
            <a
              href="https://api.congress.gov"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
            >
              Congress.gov API v3
            </a>{" "}
            (free, 5,000 requests per hour). Canonical congress.gov URLs
            are built deterministically from bill identifiers. The pipeline
            fails fast if the API key is missing rather than silently
            dropping to a lower tier.
          </p>
          <p>
            <strong className="text-ink font-semibold">
              US States (10 tracked: CA, NY, TX, FL, WA, MA, OR, CO, AZ,
              NC):
            </strong>{" "}
            Tavily research on official state legislature domains with
            Claude extraction and URL validation. State-specific
            supplementary queries (e.g. Washington HB 1110, Colorado
            Proposition 123) improve per-state coverage. Apify scrapers
            supplement coverage for Colorado and Arizona. LegiScan
            activates automatically when an API key is configured.
          </p>
          <p>
            <strong className="text-ink font-semibold">UK:</strong>{" "}
            <a
              href="https://bills.parliament.uk"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
            >
              UK Parliament Bills API
            </a>
            . 267 bills tracked. No auth required.
          </p>
          <p>
            <strong className="text-ink font-semibold">
              Europe (11 entities):
            </strong>{" "}
            Tavily research with native-language queries (German, French)
            on official parliament domains. UK, Germany, France, Italy,
            Spain, Poland, Netherlands, Sweden, Finland, Ireland, and the
            European Parliament. Light coverage: 3 to 5 bills per entity.
            Dormant by default. Refreshed via manual dispatch only.
          </p>
          <p>
            <strong className="text-ink font-semibold">
              Asia-Pacific (7 entities):
            </strong>{" "}
            Same approach. Japan, South Korea, China, India, Indonesia,
            Taiwan, Australia. Native-language queries for Indonesia
            (Bahasa) and Taiwan (Mandarin). Dormant by default. Refreshed
            via manual dispatch.
          </p>

          <h2 className="text-xl font-semibold text-ink tracking-tight pt-4">
            How bills get classified
          </h2>
          <p>
            Classification runs in two stages.
          </p>
          <p>
            <strong className="text-ink font-semibold">
              Stage 1. Heuristic (every sync):
            </strong>{" "}
            20 regex-based impact tag rules and 10 category rules run
            automatically during every legislation sync. Impact tags
            describe what a bill touches: affordability, density,
            displacement, lot-splitting, inclusionary-zoning,
            transit-oriented, public-land, rent-stabilization,
            homelessness, social-housing, indigenous-housing,
            foreign-buyer, first-time-buyer, vacancy-tax,
            short-term-rental, mortgage-regulation, community-opposition,
            heritage-protection, environmental-review, nimby. Categories
            describe the policy area: zoning-reform, rent-regulation,
            affordable-housing, development-incentive, building-code,
            foreign-investment, homelessness-services, tenant-protection,
            transit-housing, property-tax. Tags don&rsquo;t say whether a
            bill is good or bad.
          </p>
          <p>
            <strong className="text-ink font-semibold">
              Stage 2. Claude reclassification (optional):
            </strong>{" "}
            Claude Sonnet reclassifies stance, category, and impact tags.
            The result is cached incrementally at
            data/raw/claude/classifications.json, keyed by bill ID. Bills
            already in the cache are skipped on reruns. This stage is
            triggered manually, not automated. Cost is roughly $0.006 per
            bill, or about $3.60 for a full run of 608 bills.
          </p>
          <p>
            I spot-check the output but I don&rsquo;t hand-review every
            bill.
          </p>

          <h2 className="text-xl font-semibold text-ink tracking-tight pt-4">
            How stance gets picked
          </h2>
          <p>
            Each bill gets one of four stances:
          </p>
          <p>
            <strong className="text-ink font-semibold">Favorable</strong>{" "}
            means the bill increases housing supply (upzoning, density
            bonuses, ADU legalization, fast-track permitting), funds
            affordable housing (subsidies, social housing, Section 8
            expansion), or protects tenants (rent stabilization, eviction
            protections).
          </p>
          <p>
            <strong className="text-ink font-semibold">Restrictive</strong>{" "}
            means the bill reduces density (downzoning, moratoriums, height
            limits), removes tenant protections, cuts housing funding, or
            enacts exclusionary policies.
          </p>
          <p>
            <strong className="text-ink font-semibold">Concerning</strong>{" "}
            means the bill has both supply-positive and supply-negative
            provisions, or addresses housing tangentially (a foreign buyer
            ban, an immigration bill with housing provisions).
          </p>
          <p>
            <strong className="text-ink font-semibold">Review</strong>{" "}
            means the text is unavailable, the bill is purely procedural,
            or there are contradictory signals the classifier cannot
            resolve.
          </p>
          <p>
            Enacted bills carry more weight than bills in committee or
            filed. A single enacted restrictive bill (a real moratorium
            that became law) can lock a jurisdiction as restrictive. Filed
            moratoriums count as concerning, not restrictive, because they
            haven&rsquo;t become law yet.
          </p>
          <p>
            Current Canadian breakdown (415 bills): 76% review, 13%
            favorable, 8% concerning, 3% restrictive.
          </p>
          <p>
            Some of these calls will be wrong, or will age badly as bills
            move. If you work in one of these jurisdictions and think the
            read is off,{" "}
            <Link
              href="/contact"
              className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
            >
              please reach out
            </Link>
            .
          </p>

          <h2 className="text-xl font-semibold text-ink tracking-tight pt-4">
            Housing metrics
          </h2>
          <p>
            Housing metrics are aggregated from statistical agencies. A
            missing metric means data is unavailable, not zero.
          </p>
          <p>
            <strong className="text-ink font-semibold">Canada:</strong>{" "}
            Statistics Canada WDS API provides the New Housing Price Index
            (NHPI), housing starts and completions, and the CPI shelter
            component. CMHC&rsquo;s HMI Portal provides rental market
            indicators (vacancy rates, average rents) via an undocumented
            export endpoint.
          </p>
          <p>
            <strong className="text-ink font-semibold">
              United States:
            </strong>{" "}
            FRED provides Case-Shiller Home Price Index and FHFA HPI.
            Zillow provides ZHVI (home values by state) and ZORI (observed
            rents by metro). The US Census Bureau provides American
            Community Survey data (median home value, median rent, total
            housing units by state).
          </p>
          <p>
            <strong className="text-ink font-semibold">
              International:
            </strong>{" "}
            Eurostat provides the EU House Price Index. OECD and World Bank
            provide housing indicators. UK Land Registry provides
            price-paid data. The Australian Bureau of Statistics provides
            residential property price indexes. Hong Kong Rating and
            Valuation Department (RVD) and Singapore HDB provide local
            market data.
          </p>

          <h2 className="text-xl font-semibold text-ink tracking-tight pt-4">
            Housing projects
          </h2>
          <p>
            <strong className="text-ink font-semibold">Canada:</strong>{" "}
            The bulk of the 2,065 tracked projects come from the NHS
            individual project dataset (HICC CSV export from CMHC). Tavily
            research surfaces additional Build Canada Homes
            announcements, CMHC co-funded developments, and provincial
            housing projects across 8 provinces. Project enrichment
            adds factual blurbs to the top projects by unit count via
            Tavily search and Claude Haiku summarization.
          </p>
          <p>
            <strong className="text-ink font-semibold">
              United States:
            </strong>{" "}
            HUD funded projects and state housing agency projects
            discovered via Tavily research. 25 projects tracked.
          </p>
          <p>
            <strong className="text-ink font-semibold">
              Europe and Asia-Pacific:
            </strong>{" "}
            Major developments discovered via Tavily research during
            manual dispatch runs. Light coverage.
          </p>

          <h2 className="text-xl font-semibold text-ink tracking-tight pt-4">
            News
          </h2>
          <p>
            Housing news is collected from 18 RSS feeds. Canadian sources
            include the Globe &amp; Mail Real Estate, Financial Post, BNN
            Bloomberg, CBC Canada, Bank of Canada, and Canada Gazette
            (Parts I and II). International sources include The Guardian
            Housing, BBC Your Money, EUobserver, and SBS Australia. Google
            News housing queries cover Canadian, US, Quebec
            (French-language), and global housing topics. Each article is
            summarized by Claude Haiku to produce concise, readable
            blurbs. Articles are tagged by province or state based on
            content. Feeds are polled 3 times daily via GitHub Actions.
          </p>

          <h2 className="text-xl font-semibold text-ink tracking-tight pt-4">
            Resilience
          </h2>
          <p>
            Every external API call goes through a resilience layer.
          </p>
          <p>
            <strong className="text-ink font-semibold">
              Circuit breaker (opossum):
            </strong>{" "}
            Per-source instances. A circuit opens when more than 50% of
            the last 5+ calls in a 10-second window have failed. Once
            open, requests are rejected immediately for 1 hour before a
            half-open retry. Timeouts vary by source: 15 seconds for RSS,
            30 seconds for most APIs, 45 to 60 seconds for CMHC and
            Anthropic, 600 seconds for Apify actor polling.
          </p>
          <p>
            <strong className="text-ink font-semibold">Retry:</strong>{" "}
            3 attempts with exponential backoff (1 second, 2 seconds, 4
            seconds, plus jitter). Only retries on 5xx, 429, and network
            errors. Never retries 4xx.
          </p>
          <p>
            <strong className="text-ink font-semibold">
              Fallback routing:
            </strong>{" "}
            When a primary source is down, the router picks the next
            healthy source automatically. Key fallback pairs: LEGISinfo
            falls back to OpenParliament.ca. BC Laws falls back to CanLII
            via Tavily. StatsCan and CMHC fall back to each other
            (symmetric). When Tavily is exhausted, the pipeline uses
            cached data and retries on the next schedule.
          </p>
          <p>
            <strong className="text-ink font-semibold">
              Health registry:
            </strong>{" "}
            Tracks per-source success and failure rates in a rolling
            window of the last 20 calls. Powers the health footer in the
            UI.
          </p>
          <p>
            <strong className="text-ink font-semibold">Run reports:</strong>{" "}
            Every pipeline writes a JSON report documenting successes,
            failures, credits consumed, and duration. Reports older than
            30 days are auto-pruned.
          </p>
        </div>

        <div className="mt-16 pt-10 border-t border-black/[.06] space-y-8">
          <div>
            <div className="text-[13px] font-medium text-muted tracking-tight mb-1">
              Sources
            </div>
            <p className="text-[13px] text-muted leading-relaxed max-w-prose">
              Every dataset is drawn from a public source. Primary links
              for individual bills and news items stay in the detail
              panels. This is the rollup.
            </p>
          </div>

          <SourceGroup title="Legislation">
            <SourceItem
              name="LEGISinfo"
              href="https://www.parl.ca/legisinfo"
              note="Canadian federal housing bills, sponsors, progress events"
            />
            <SourceItem
              name="OpenParliament.ca"
              href="https://openparliament.ca"
              note="Canadian federal fallback (same dataset, different host)"
            />
            <SourceItem
              name="BC Laws"
              href="https://www.bclaws.gov.bc.ca"
              note="British Columbia provincial legislation via XML search API"
            />
            <SourceItem
              name="Congress.gov API v3"
              href="https://api.congress.gov"
              note="US federal housing bills, sponsors, policyArea. Free, 5,000 req/hour"
            />
            <SourceItem
              name="LegiScan"
              href="https://legiscan.com"
              note="US state bills supplement (dormant until API key configured)"
            />
            <SourceItem
              name="UK Parliament Bills API"
              href="https://bills.parliament.uk"
              note="UK housing and planning bills. 267 tracked"
            />
            <SourceItem
              name="Tavily"
              href="https://tavily.com"
              note="Provincial, state, European, and Asia-Pacific bill research. URL validation via Tavily Extract"
            />
            <SourceItem
              name="Apify"
              href="https://apify.com"
              note="State legislature scrapers for Colorado and Arizona"
            />
            <SourceItem
              name="Anthropic Claude Sonnet"
              href="https://www.anthropic.com"
              note="Structured bill extraction from search snippets, stance reclassification"
            />
          </SourceGroup>

          <SourceGroup title="Housing metrics">
            <SourceItem
              name="Statistics Canada (StatsCan)"
              href="https://www.statcan.gc.ca"
              note="NHPI, housing starts and completions, CPI shelter component"
            />
            <SourceItem
              name="CMHC HMI Portal"
              href="https://www.cmhc-schl.gc.ca"
              note="Rental market indicators. Undocumented export endpoint"
            />
            <SourceItem
              name="FRED (Federal Reserve Economic Data)"
              href="https://fred.stlouisfed.org"
              note="Case-Shiller Home Price Index, FHFA HPI"
            />
            <SourceItem
              name="Zillow"
              href="https://www.zillow.com/research/data/"
              note="ZHVI (home values by state), ZORI (observed rents by metro)"
            />
            <SourceItem
              name="U.S. Census Bureau"
              href="https://www.census.gov"
              note="American Community Survey housing data"
            />
            <SourceItem
              name="Eurostat"
              href="https://ec.europa.eu/eurostat"
              note="EU House Price Index"
            />
            <SourceItem
              name="UK Land Registry"
              href="https://www.gov.uk/government/organisations/land-registry"
              note="Price-paid data for England and Wales"
            />
            <SourceItem
              name="OECD"
              href="https://www.oecd.org"
              note="Housing indicators across member countries"
            />
            <SourceItem
              name="World Bank"
              href="https://data.worldbank.org"
              note="Housing indicators"
            />
            <SourceItem
              name="Australian Bureau of Statistics (ABS)"
              href="https://www.abs.gov.au"
              note="Residential property price indexes"
            />
            <SourceItem
              name="HK Rating and Valuation Department"
              note="Hong Kong property market data"
            />
            <SourceItem
              name="Singapore HDB"
              note="Singapore public housing data"
            />
          </SourceGroup>

          <SourceGroup title="Housing projects">
            <SourceItem
              name="CMHC NHS dataset (HICC CSV export)"
              href="https://www.cmhc-schl.gc.ca"
              note="2,065 National Housing Strategy projects across Canada"
            />
            <SourceItem
              name="Tavily research"
              note="Build Canada Homes, CMHC co-funded, provincial, US HUD, and international project discovery"
            />
            <SourceItem
              name="Claude Haiku"
              href="https://www.anthropic.com"
              note="Project description enrichment for top projects by unit count"
            />
          </SourceGroup>

          <SourceGroup title="Housing policy officials">
            <SourceItem
              name="canada.ca"
              href="https://www.canada.ca"
              note="Federal cabinet minister lookup (canonical government source)"
            />
            <SourceItem
              name="hud.gov"
              href="https://www.hud.gov"
              note="US federal housing officials"
            />
            <SourceItem
              name="Tavily + Claude"
              note="Provincial and international official lookups, verified against government directories"
            />
          </SourceGroup>

          <SourceGroup title="Maps and geocoding">
            <SourceItem
              name="world-atlas (topojson)"
              href="https://github.com/topojson/world-atlas"
              note="Country boundaries for international maps"
            />
            <SourceItem
              name="us-atlas (topojson)"
              href="https://github.com/topojson/us-atlas"
              note="US state and county boundaries"
            />
            <SourceItem
              name="Statistics Canada Census Boundary Files"
              note="Province and census division boundaries for Canadian maps"
            />
            <SourceItem
              name="react-simple-maps"
              href="https://www.react-simple-maps.io"
              note="SVG choropleth map rendering"
            />
            <SourceItem
              name="MapLibre GL"
              href="https://maplibre.org"
              note="Vector tile maps for census division drill-down views"
            />
          </SourceGroup>

          <SourceGroup title="News">
            <SourceItem
              name="18 RSS feeds"
              note="Globe and Mail Real Estate, Financial Post, BNN Bloomberg, CBC Canada, Bank of Canada, Google News housing queries, The Guardian Housing, BBC Your Money, EUobserver, SBS Australia, Canada Gazette (Parts I and II)"
            />
            <SourceItem
              name="Claude Haiku"
              href="https://www.anthropic.com"
              note="Article summarization"
            />
          </SourceGroup>

          <SourceGroup title="Classification and summarization">
            <SourceItem
              name="Heuristic keyword matching"
              note="20 impact tag rules and 10 category rules. Runs on every sync"
            />
            <SourceItem
              name="Anthropic Claude Sonnet"
              href="https://www.anthropic.com"
              note="Bill reclassification, structured extraction from search snippets. Cached incrementally"
            />
            <SourceItem
              name="Anthropic Claude Haiku"
              href="https://www.anthropic.com"
              note="News summarization, project description enrichment"
            />
          </SourceGroup>
        </div>

        <div className="mt-16 mb-3 text-[13px] font-medium text-muted tracking-tight">
          Housing categories by dimension
        </div>
        <h2 className="text-2xl md:text-3xl font-semibold text-ink tracking-tight leading-[1.1] mb-6">
          The full tag taxonomy
        </h2>
        <p className="text-base text-ink/80 leading-relaxed mb-8">
          Impact tags are grouped into two lenses. The Zoning lens covers
          supply, environmental, and community impact dimensions. The
          Affordability lens covers affordability, rental market, ownership,
          and social housing dimensions. The map&rsquo;s{" "}
          &ldquo;Color map by&rdquo; toggle uses these groupings to recolor
          jurisdictions by tag density.
        </p>
        <NuanceLegend />
      </div>
    </main>
  );
}

function SourceGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-[11px] font-medium text-muted tracking-tight mb-2">
        {title}
      </h3>
      <ul className="text-sm text-ink/80 leading-relaxed space-y-1.5">
        {children}
      </ul>
    </div>
  );
}

function SourceItem({
  name,
  href,
  note,
}: {
  name: string;
  href?: string;
  note?: string;
}) {
  return (
    <li>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
        >
          {name}
        </a>
      ) : (
        <span className="text-ink">{name}</span>
      )}
      {note && <span className="text-muted">{`. ${note}`}</span>}
    </li>
  );
}

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
            Every bill comes from an official source. Canadian federal and
            provincial bills come through{" "}
            <a
              href="https://www.parl.ca/legisinfo"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
            >
              LEGISinfo
            </a>
            . US state bills come through{" "}
            <a
              href="https://legiscan.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
            >
              LegiScan
            </a>
            . UK bills come from the UK Parliament Bills API. Other
            jurisdictions use their own government sources. Bills are
            filtered to housing-related topics: zoning, rent control,
            affordability, tenant protections, public housing, and
            inclusionary zoning.
          </p>

          <h2 className="text-xl font-semibold text-ink tracking-tight pt-4">
            How bills get classified
          </h2>
          <p>
            Each bill gets a set of{" "}
            <strong className="text-ink font-semibold">housing category tags</strong>
            . Examples include zoning-reform, rent-regulation,
            affordable-housing, inclusionary-zoning, tenant-protection,
            public-housing, short-term-rental, and housing-supply.
            Tags describe what a bill is about. They don&rsquo;t say
            whether it&rsquo;s good or bad.
          </p>
          <p>
            Classification uses heuristic keyword matching against a fixed
            taxonomy of housing categories. Bills are scanned for
            domain-specific terms and phrases that map to each category.
            I spot-check the output but I don&rsquo;t hand-review every
            bill.
          </p>

          <h2 className="text-xl font-semibold text-ink tracking-tight pt-4">
            How stance gets picked
          </h2>
          <p>
            A jurisdiction&rsquo;s{" "}
            <strong className="text-ink font-semibold">stance</strong> can
            be restrictive, concerning, review, favorable, or none.
            Stance is derived from heuristic keyword matching on the
            direction and weight of each jurisdiction&rsquo;s active
            housing bills. Enacted bills count more than voted, voted
            more than committee, committee more than filed.
          </p>
          <p>
            When a jurisdiction has contradictory bills in flight, it
            gets labeled &ldquo;review&rdquo; instead of one side. When
            there&rsquo;s no housing policy activity at all, it&rsquo;s
            &ldquo;none,&rdquo; not favorable-by-default.
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
            Real-time housing metrics are aggregated from multiple
            statistical agencies. Canadian data comes from StatsCan&rsquo;s
            New Housing Price Index (NHPI). US data draws from FRED
            Case-Shiller and HPI indices, Zillow&rsquo;s ZHVI (home
            values) and ZORI (observed rents), and the US Census American
            Community Survey (ACS). UK data comes from the UK Land
            Registry price-paid dataset. European data comes from
            Eurostat&rsquo;s House Price Index (HPI). Australian data
            comes from the Australian Bureau of Statistics (ABS). A
            missing metric means data is unavailable, not zero.
          </p>

          <h2 className="text-xl font-semibold text-ink tracking-tight pt-4">
            News
          </h2>
          <p>
            Housing news is collected via RSS feeds from housing-focused
            sources and policy outlets. Each article is summarized by
            Claude Haiku to produce concise, readable blurbs. Sources
            include housing policy blogs, national and regional news
            outlets, and government press releases.
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
              panels; this is the rollup.
            </p>
          </div>

          <SourceGroup title="Legislation">
            <SourceItem
              name="LEGISinfo"
              href="https://www.parl.ca/legisinfo"
              note="Canadian federal and provincial housing bills, sponsors, progress events"
            />
            <SourceItem
              name="LegiScan"
              href="https://legiscan.com"
              note="US state and federal housing bill text, sponsors, progress events"
            />
            <SourceItem
              name="UK Parliament Bills API"
              href="https://bills.parliament.uk"
              note="UK housing and planning bills"
            />
            <SourceItem
              name="unitedstates/congress-legislators"
              href="https://github.com/unitedstates/congress-legislators"
              note="current member roster and identifiers"
            />
            <SourceItem
              name="State and provincial legislature portals"
              note="per-bill source links across 50+ jurisdictions"
            />
          </SourceGroup>

          <SourceGroup title="Housing metrics">
            <SourceItem
              name="Statistics Canada (StatsCan)"
              href="https://www.statcan.gc.ca"
              note="New Housing Price Index (NHPI), housing starts, completions"
            />
            <SourceItem
              name="FRED (Federal Reserve Economic Data)"
              href="https://fred.stlouisfed.org"
              note="Case-Shiller Home Price Index, FHFA HPI"
            />
            <SourceItem
              name="Zillow"
              href="https://www.zillow.com/research/data/"
              note="ZHVI (home values), ZORI (observed rents)"
            />
            <SourceItem
              name="U.S. Census Bureau"
              href="https://www.census.gov"
              note="American Community Survey (ACS) housing data"
            />
            <SourceItem
              name="UK Land Registry"
              href="https://www.gov.uk/government/organisations/land-registry"
              note="price-paid data for England and Wales"
            />
            <SourceItem
              name="Eurostat"
              href="https://ec.europa.eu/eurostat"
              note="House Price Index (HPI) across EU member states"
            />
            <SourceItem
              name="Australian Bureau of Statistics (ABS)"
              href="https://www.abs.gov.au"
              note="residential property price indexes"
            />
          </SourceGroup>

          <SourceGroup title="Housing policy officials">
            <SourceItem
              name="unitedstates/images"
              href="https://github.com/unitedstates/images"
              note="official congressional portraits (public domain)"
            />
            <SourceItem
              name="Government directories"
              note="housing minister and committee member profiles across tracked jurisdictions"
            />
          </SourceGroup>

          <SourceGroup title="Maps & geocoding">
            <SourceItem
              name="Natural Earth"
              href="https://www.naturalearthdata.com"
              note="country borders and water features (public domain)"
            />
          </SourceGroup>

          <SourceGroup title="Maps & geocoding">
            <SourceItem
              name="us-atlas / world-atlas (Mike Bostock)"
              href="https://github.com/topojson/us-atlas"
              note="topojson geography bundles"
            />
            <SourceItem
              name="react-simple-maps"
              href="https://www.react-simple-maps.io"
              note="map rendering primitives"
            />
            <SourceItem
              name="Nominatim (OpenStreetMap)"
              href="https://nominatim.openstreetmap.org"
              note="facility geocoding (ODbL)"
            />
            <SourceItem
              name="CARTO basemaps"
              href="https://carto.com/basemaps"
              note="tile layer for the facility detail view"
            />
          </SourceGroup>

          <SourceGroup title="News">
            <SourceItem
              name="RSS & public article feeds"
              note="housing-focused sources including Shelterforce, CityLab, The Guardian Housing, Reuters, state and local housing policy outlets"
            />
          </SourceGroup>

          <SourceGroup title="Classification & summarization">
            <SourceItem
              name="Anthropic — Claude Haiku"
              href="https://www.anthropic.com"
              note="news article summarization and housing category tagging"
            />
            <SourceItem
              name="Heuristic keyword matching"
              note="bill stance classification and housing category assignment (zoning-reform, rent-regulation, affordable-housing, inclusionary-zoning, tenant-protection, etc.)"
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
          Tags are grouped into housing policy dimensions: Zoning &amp; Land
          Use, Rent &amp; Tenant Protections, Affordability &amp; Supply, and
          Public Housing &amp; Investment. The map&rsquo;s{" "}
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
      {note && <span className="text-muted"> — {note}</span>}
    </li>
  );
}

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Data sources and freshness . Housing Crisis Tracker",
};

/**
 * HealthFooter ("Learn more" link) points here. The goal is to tell a
 * visitor, in plain prose, where the numbers on the tracker come from
 * and how recent they are. Numbers in the schedule table come from the
 * cron expressions in `.github/workflows/*.yml`, not from memory.
 */

export default function DataSourcesPage() {
  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-8 py-24">
        <Link
          href="/about"
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink transition-colors mb-16"
        >
          ← Back
        </Link>

        <div className="text-[13px] font-medium text-muted tracking-tight mb-3">
          About
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold text-ink tracking-tight leading-[1.05] mb-10">
          Data sources and freshness
        </h1>

        <div className="text-base text-ink/80 leading-relaxed space-y-5">
          <p>
            This page documents where the numbers on the tracker come from
            and how often they refresh. Every figure is pulled from a public
            source, most of them open-data APIs run by government agencies.
            When a primary source is down, the pipeline routes to a
            documented fallback rather than showing stale data without a
            warning.
          </p>

          <h2 className="text-2xl font-semibold text-ink tracking-tight pt-6">
            Where the data comes from
          </h2>

          <p>
            Federal legislation comes from LEGISinfo, the Parliament of
            Canada feed, polled as JSON. When LEGISinfo is unreachable the
            pipeline falls back to the OpenParliament API which indexes the
            same corpus on an independent host. Results from either source
            feed the same bill table.
          </p>

          <p>
            British Columbia provincial bills are pulled from the BC Laws
            full-text search API. If BC Laws is down, the fallback router
            queries CanLII via Tavily Extract on{" "}
            <code>canlii.org/en/bc/laws/</code>. The CanLII path costs a
            small number of Tavily credits per run and is reserved for
            degraded windows.
          </p>

          <p>
            The other twelve provinces and territories don't expose a
            machine-readable legislation feed, so coverage uses Tavily
            research against official provincial government domains.
            Responses are summarized by Claude, validated against the
            source URL, and written to the per-province JSON file.
          </p>

          <p>
            Canadian housing projects are ingested from Build Canada Homes
            announcements, CMHC newsroom releases, and provincial housing
            ministry releases via Tavily. The pipeline filters to
            announcements with a named developer, project location, and
            unit count so the table stays free of generic press releases.
          </p>

          <p>
            Officials come from the canada.ca cabinet list (canonical) plus
            a Tavily enrichment pass for biographical detail and active
            portfolio. The federal file is regenerated monthly and manually
            spot-checked. Provincial housing ministers are sourced the same
            way with a per-province query.
          </p>

          <p>
            News headlines are polled three times a day from a curated list
            of Canadian housing feeds. Items are summarized with Claude
            Haiku for headline-plus-one-sentence context and appended to a
            rolling 14-day window.
          </p>

          <p>
            Market metrics are pulled from Statistics Canada (NHPI, housing
            starts, CPI shelter) and the CMHC HMI portal (rental vacancy,
            average rent). The CMHC endpoint is undocumented, so if it
            breaks the pipeline logs a degraded run and leaves the last
            good values in place.
          </p>

          <p>
            US bills are kept as a secondary dataset. When a LegiScan API
            key is available the tracker refreshes them on the same weekly
            cadence as Canadian bills. When the key is absent, the UI
            falls back to the static data baked into
            <code> lib/placeholder-data.ts</code> with a banner showing
            the last sync date.
          </p>

          <h2 className="text-2xl font-semibold text-ink tracking-tight pt-6">
            Refresh schedule
          </h2>

          <p>
            Schedules below are read directly from the cron expressions in
            <code> .github/workflows/</code>. Times are in UTC.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/[.08]">
                  <th className="text-left py-2 pr-4 font-medium text-ink">
                    Pipeline
                  </th>
                  <th className="text-left py-2 pr-4 font-medium text-ink">
                    Schedule
                  </th>
                  <th className="text-left py-2 font-medium text-ink">
                    What it writes
                  </th>
                </tr>
              </thead>
              <tbody className="text-ink/80">
                <tr className="border-b border-black/[.06]">
                  <td className="py-2 pr-4 font-mono text-xs">news-rss</td>
                  <td className="py-2 pr-4">3x daily at 09, 15, 23 UTC</td>
                  <td className="py-2">data/news/summaries.json</td>
                </tr>
                <tr className="border-b border-black/[.06]">
                  <td className="py-2 pr-4 font-mono text-xs">metrics-sync</td>
                  <td className="py-2 pr-4">Weekly, Monday 06:00 UTC</td>
                  <td className="py-2">data/housing/</td>
                </tr>
                <tr className="border-b border-black/[.06]">
                  <td className="py-2 pr-4 font-mono text-xs">legislation-sync</td>
                  <td className="py-2 pr-4">Weekly, Wednesday 07:00 UTC</td>
                  <td className="py-2">data/legislation/</td>
                </tr>
                <tr className="border-b border-black/[.06]">
                  <td className="py-2 pr-4 font-mono text-xs">projects-sync</td>
                  <td className="py-2 pr-4">Weekly, Tuesday 08:00 UTC</td>
                  <td className="py-2">data/projects/canada.json</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono text-xs">officials-sync</td>
                  <td className="py-2 pr-4">
                    Monthly, first Sunday 09:00 UTC
                  </td>
                  <td className="py-2">data/politicians/canada.json</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2 className="text-2xl font-semibold text-ink tracking-tight pt-6">
            Health indicators
          </h2>

          <p>
            The chip at the bottom of every page is a live read on data
            freshness. It reflects the most recent run reports in{" "}
            <code>data/raw/_run-reports/</code>.
          </p>

          <ul className="list-disc pl-6 space-y-2">
            <li>
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-2" />
              Green. Every source is healthy and recent failure rate is
              under 10 percent.
            </li>
            <li>
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-2" />
              Amber. One or more sources are degraded, between 10 and 50
              percent of calls failed, or a fallback is currently in use.
            </li>
            <li>
              <span className="inline-block w-2 h-2 rounded-full bg-rose-500 mr-2" />
              Red. One or more sources are down, the circuit breaker has
              tripped, or more than half of recent calls failed.
            </li>
          </ul>

          <p>
            When a source is down the pipeline automatically routes to the
            documented fallback (see the table above for the common
            pairings). Numbers may be slightly less fresh while the
            primary recovers, but the dataset keeps updating.
          </p>

          <h2 className="text-2xl font-semibold text-ink tracking-tight pt-6">
            Open data notes
          </h2>

          <p>
            Legislation and market metrics are republished under the Open
            Government Licence . Canada, where applicable. CMHC and
            Statistics Canada both publish under this licence. The tracker
            is for informational purposes only. It is not legal, financial,
            or investment advice.
          </p>

          <h2 className="text-2xl font-semibold text-ink tracking-tight pt-6">
            Reporting issues
          </h2>

          <p>
            If a number looks wrong, a link is broken, or a fallback seems
            stuck, open an issue at{" "}
            <a
              href="https://github.com/Andy00L/housing-crisis-tracker/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
            >
              github.com/Andy00L/housing-crisis-tracker/issues
            </a>
            . Include the chip color, the time you saw the problem, and
            the entity or metric in question. The run reports make it easy
            to match the report to what you saw.
          </p>
        </div>
      </div>
    </main>
  );
}

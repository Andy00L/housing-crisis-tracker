import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About · Housing Crisis Tracker",
};

export default function AboutPage() {
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
          About
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold text-ink tracking-tight leading-[1.05] mb-10">
          What this is
        </h1>

        <div className="text-base text-ink/80 leading-relaxed space-y-5">
          <p>
            I built Housing Crisis Tracker because I kept wanting a
            straightforward answer to one question: how bad is the
            housing crisis in this country or province, and what is the
            government doing about it? To actually answer it I had to
            check legislature portals, parse affordability data from
            half a dozen statistical agencies, and read scattered news.
            Nobody was collecting it in one place, so I did.
          </p>
          <p>
            Housing policy is also the part of this crisis that gets the
            least attention. Most of the conversation is about interest
            rates and home prices. But zoning reform, rent control, public
            housing funding, and affordability mandates are being decided
            right now in state capitols, city councils, and national
            parliaments. I wanted a map.
          </p>
          <p>
            The site visualizes the global housing crisis on an interactive
            globe. Every country, US state, and bloc has a stance and a set
            of impact tags based on the housing bills currently moving
            through it. Click a region to see its legislation, who&rsquo;s
            sponsoring what, recent housing news, and key affordability
            metrics.
          </p>
          <p>
            It tracks housing legislation across 50+ jurisdictions,
            covering zoning reform, rent regulation, affordable housing
            programs, inclusionary zoning, tenant protections, and public
            housing investment. Real-time housing metrics are aggregated
            from StatsCan, FRED, Zillow, the US Census, the UK Land
            Registry, Eurostat, and ABS.
          </p>
          <p>
            Housing news is monitored via RSS feeds from policy-focused
            sources and summarized with AI-generated summaries so you can
            stay current without reading dozens of outlets. The site also
            profiles key housing policy officials and tracks their
            legislative activity.
          </p>
          <p>
            One of the things that pushed me to build this is how often
            the public debate around housing runs on intuition rather than
            detail. A lot of lawmakers writing these bills are doing their
            best, but the housing market moves faster than most committee
            staff can keep up with, and the headlines they read
            aren&rsquo;t always accurate about vacancy rates, construction
            starts, or what these policies actually do. That gap produces
            legislation that sometimes misses the real issue in either
            direction, whether it&rsquo;s a blanket rent freeze that
            discourages new construction, or a zoning deregulation that
            ignores displacement risk.
          </p>
          <p>
            Housing Crisis Tracker isn&rsquo;t trying to take a side on
            whether any particular bill is good. It&rsquo;s trying to show
            you what&rsquo;s actually being proposed, what stage
            it&rsquo;s at, and what it would do if it passed, so the
            people affected can make up their own minds with the real
            information in front of them.
          </p>

          <div className="pt-5 mt-5 border-t border-black/[.06]">
            <p className="text-muted">
              This is still early. I&rsquo;m open to feedback and edits.
              The repo is public at{" "}
              <a
                href="https://github.com/Andy00L/housing-crisis-tracker"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                github.com/Andy00L/housing-crisis-tracker
              </a>
              , so you can open an issue or send a PR. You can also{" "}
              <Link
                href="/contact"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                email me
              </Link>
              .
            </p>
          </div>
        </div>

        <div className="mt-16 pt-10 border-t border-black/[.06]">
          <div className="text-[13px] font-medium text-muted tracking-tight mb-4">
            Credits
          </div>
          <ul className="text-sm text-ink/80 leading-relaxed space-y-2">
            <li>
              Inspired by{" "}
              <a
                href="https://housingtracker.net"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                housingtracker.net
              </a>
            </li>
            <li>
              Icons by{" "}
              <a
                href="https://streamlinehq.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                Streamline
              </a>
            </li>
            <li>Built by Andy Nguema Luemba</li>
            <li className="pt-2 text-muted">
              Full data sources are listed on the{" "}
              <Link
                href="/methodology"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                methodology
              </Link>{" "}
              page.
            </li>
          </ul>
        </div>
      </div>
    </main>
  );
}


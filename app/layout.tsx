import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import HealthFooter from "@/components/ui/HealthFooter";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Housing Crisis Tracker. Bills, Projects, and Policy",
  description:
    "A live map of Canadian housing policy. Federal bills, provincial legislation, major projects, and officials. Plus US, UK, and EU housing context.",
  authors: [
    { name: "Andy Nguema Luemba", url: "https://github.com/Andy00L" },
  ],
  openGraph: {
    title: "Housing Crisis Tracker",
    description:
      "Federal bills, provincial legislation, major projects, and officials, tracked across Canada's 13 provinces and territories.",
    locale: "en_CA",
    alternateLocale: "fr_CA",
    siteName: "Housing Crisis Tracker",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    creator: "@Andy00L",
    site: "@Andy00L",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans bg-white text-ink antialiased">
        {/* Plain <script> tag — Next 16 + React 19 warn when a
            `next/script` inline-body is rendered inside React because
            inline scripts inside React components aren't executed on
            the client. dangerouslySetInnerHTML is the supported path
            for small boot snippets. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if ('scrollRestoration' in history) history.scrollRestoration = 'manual';`,
          }}
        />
        {children}
        {/* Small fixed chip in the bottom-right corner. Polls /api/health
            every 5 minutes. Hidden if the endpoint is unreachable. */}
        <div className="fixed bottom-4 right-4 z-40 pointer-events-auto">
          <HealthFooter />
        </div>
        <Analytics />
      </body>
    </html>
  );
}

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Strip console.* in production builds (keeps console.error / warn for
  // genuine problems). Removes the lone bioguide-mismatch warn that ships
  // from lib/politicians-data.ts.
  compiler: {
    removeConsole: { exclude: ["error", "warn"] },
  },

  // Tree-shake heavy deps that ship CJS namespace imports by default.
  // Saves measurable bytes on every page that touches the map or the
  // animation primitives.
  experimental: {
    optimizePackageImports: [
      "framer-motion",
      "d3-geo",
      "react-simple-maps",
      "@number-flow/react",
      "topojson-client",
    ],
  },

  // Permanent redirects for legacy paths. `/datacenters` was the old
  // name for the projects index and detail routes, kept for external
  // bookmarks that still point there.
  async redirects() {
    return [
      {
        source: "/datacenters",
        destination: "/projects",
        permanent: true,
      },
      {
        source: "/datacenters/:id",
        destination: "/projects/:id",
        permanent: true,
      },
    ];
  },

  // Allow next/image to optimize politician portraits and any other
  // remote portraits referenced via `photoUrl`. Any host added here is
  // explicitly trusted. Keep the list tight.
  images: {
    remotePatterns: [
      // unitedstates.github.io serves the Congressional bioguide portraits
      // used for every US politician's photoUrl in data/politicians/*.json.
      { protocol: "https", hostname: "unitedstates.github.io" },
      { protocol: "https", hostname: "bioguide.congress.gov" },
      { protocol: "https", hostname: "www.congress.gov" },
      { protocol: "https", hostname: "upload.wikimedia.org" },
      { protocol: "https", hostname: "**.europarl.europa.eu" },
      { protocol: "https", hostname: "members-api.parliament.uk" },
    ],
  },
};

export default nextConfig;

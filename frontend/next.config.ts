import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Resumes are up to 5 MB
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  // Company logos on the Jobs feed, as the scraper found them on each job board's
  // page. Must match scraper/workit_scraper/logos.py's PATTERN hosts exactly:
  // next/image throws on any other host, failing the whole page. Object form,
  // because a `*` in `new URL(...)` is not a hostname wildcard.
  images: {
    // Some Ashby boards serve their logo as SVG behind a `.png` URL (Snowflake,
    // Cerebras), which the optimizer otherwise refuses -- the card falls back
    // to initials. Next's documented safeguards: scripts in an SVG cannot run,
    // and opening one directly downloads it rather than rendering a page.
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    remotePatterns: [
      // Favicons for companies whose board has no logo but names their website.
      { protocol: "https", hostname: "www.google.com", pathname: "/s2/favicons" },
      {
        protocol: "https",
        hostname: "*.cdn.greenhouse.io",
        pathname: "/external_greenhouse_job_boards/logos/**",
      },
      { protocol: "https", hostname: "app.ashbyhq.com", pathname: "/api/images/**" },
      { protocol: "https", hostname: "lever-client-logos.s3.amazonaws.com" },
      { protocol: "https", hostname: "lever-client-logos.s3.us-west-2.amazonaws.com" },
    ],
  },
};

export default nextConfig;

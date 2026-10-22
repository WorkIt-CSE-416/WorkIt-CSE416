import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Resumes and profile photos are both capped at 5 MB (resumes.py,
  // services/avatar.py, src/lib/avatar-rules.ts); this must stay above that
  // plus multipart overhead, or Next rejects the upload before the action runs.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  // Company logos on the Jobs feed, as the scraper found them on each job board's
  // page. The hosts below must match scraper/workit_scraper/logos.py's PATTERN
  // hosts exactly. Object form, because a `*` in `new URL(...)` is not a
  // hostname wildcard.
  images: {
    // No optimizer on Cloudflare (KAN-294): the browser loads each logo from
    // its own host. OpenNext's Cloudflare Images binding bills per unique
    // transformation past 5,000 a month, which a feed of thousands of logos at
    // several widths would outrun, and logos are small already. While this is
    // true, next/image skips its loader, so it neither checks remotePatterns
    // nor applies the SVG settings below; both stay so turning the optimizer
    // back on is one line. Vercel keeps its optimizer until the KAN-296
    // cutover: VERCEL is set in every Vercel build and never in OpenNext's,
    // so there next/image still checks remotePatterns and resizes logos.
    unoptimized: !process.env.VERCEL,
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
      { protocol: "https", hostname: "lever-client-logos.s3-us-west-2.amazonaws.com" },
      {
        protocol: "https",
        hostname: "workablehr.s3.amazonaws.com",
        pathname: "/uploads/account/logo/**",
      },
      // BambooHR serves logos from images7 and friends, pandabox and the company's
      // own subdomain, as application/octet-stream; the optimizer sniffs the bytes.
      { protocol: "https", hostname: "*.bamboohr.com" },
    ],
  },
};

export default nextConfig;

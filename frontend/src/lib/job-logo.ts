/**
 * Where a company's logo comes from (KAN-442). A plain module, not
 * `company-logo.tsx`'s: a server module builds a job's sources too, and it
 * cannot call a function a `"use client"` file exports.
 */

/** Brandfetch's CDN: a company's square icon by its website. */
export const BRANDFETCH = "https://cdn.brandfetch.io/";

/** Where a logo may come from, best first. A single URL is a list of one. */
export type LogoSrc = string | readonly (string | null | undefined)[] | null | undefined;

/**
 * A job's logo sources, best first: Brandfetch's icon by the employer's own
 * website, then what the scraper found (the logo uploaded to the job board,
 * or the website's favicon). In a test of 100 of our companies, Brandfetch
 * drew 98, each at 180px or more; a favicon is often 16 to 32px.
 */
export function jobLogo(job: {
  logo_url: string | null;
  company_domain?: string | null;
}): (string | null)[] {
  return [brandfetchLogo(job.company_domain), job.logo_url];
}

/** `fallback/404` answers 404 for a company Brandfetch has no logo of, so the
 *  tile moves on to the next source; its default is a made-up lettermark.
 *  Null without the client ID (a clone with no env file). */
function brandfetchLogo(domain: string | null | undefined): string | null {
  const client = process.env.NEXT_PUBLIC_BRANDFETCH_CLIENT_ID;
  if (!domain || !client) return null;
  return `${BRANDFETCH}${encodeURIComponent(domain)}/fallback/404/icon?c=${encodeURIComponent(client)}`;
}

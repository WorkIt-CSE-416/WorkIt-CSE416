import "server-only";

import { headers } from "next/headers";

/**
 * This request's origin ("https://workitjobs.ai"), for a redirect URL that
 * Supabase Auth sends the browser back to: OAuth sign-in and linking, and
 * an email change's confirm link. Every such URL must be on Supabase's
 * Redirect URLs list (frontend/CLAUDE.md, Deployment).
 */
export async function requestOrigin(): Promise<string> {
  const headersList = await headers();
  // Vercel's proxy sets x-forwarded-host itself. On Cloudflare it is whatever
  // the browser sent, while Host is the name Cloudflare routed on, so only
  // Vercel reads the forwarded one.
  const host =
    (process.env.VERCEL ? headersList.get("x-forwarded-host") : null) ?? headersList.get("host");
  // Plain http only on a local machine; a deployed host is https even when a
  // proxy in front of it leaves x-forwarded-proto off.
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|[\w.-]+\.localhost)(:\d+)?$/.test(host ?? "");
  const protocol = headersList.get("x-forwarded-proto") ?? (isLocal ? "http" : "https");
  return `${protocol}://${host}`;
}

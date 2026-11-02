// Same values as frontend/.env.local's NEXT_PUBLIC_* and the root
// SUPABASE_URL — the anon key is meant to be public (frontend/CLAUDE.md),
// which is why it's checked in here the same way it's checked into the
// frontend bundle, rather than loaded from an untracked env file. There's
// no bundler in this prototype to inject env vars at build time, so a
// plain checked-in module is the honest equivalent.
//
// Dev vs. prod: src/background/api.js treats an unreachable DEV_API_URL
// as "not running locally" and falls back to a deployed API rather than
// erroring. Every origin here must also be listed in manifest.json's
// host_permissions, or the background worker's fetch() calls hit the
// page's normal CORS rules instead of bypassing them, and chrome.cookies
// can't read the session there. Web origins also go in
// externally_connectable.matches.
//
// The Store build (store/build.mjs, KAN-463) sets both to null, so the
// published extension never asks a dev server for anything: every user of
// these skips a null one. It also sets TEST_HOOKS false.
export const DEV_API_URL = "http://localhost:8000";
export const DEV_WEB_URL = "http://localhost:3000";
/** Whether the background puts the tests' hooks on its global (background.js): never in the Store build. */
export const TEST_HOOKS = true;

// The deployed webapp origins, each paired with its own API. Cloudflare
// first, then Vercel, which stays live until the KAN-296 cutover. Both
// share one Supabase project, so a session from either works on either
// API; the pairing just keeps a student on the host family they signed
// in on. src/background/webapp-session.js reads the sb-* cookie from each
// web origin in this order; the popup sends sign-ins to the first.
export const PROD_SITES = [
  { web: "https://workitjobs.ai", api: "https://api.workitjobs.ai" },
  { web: "https://workit-web-gamma.vercel.app", api: "https://workit-api.vercel.app" },
];

export const SUPABASE_URL = "https://zhdrvdrojipkluhzgsea.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoZHJ2ZHJvamlwa2x1aHpnc2VhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyOTU4NDksImV4cCI6MjEwMzg3MTg0OX0.fdYqIGXIXqNQXMsc9cF5_6ZHcx496SGSzheDCncAqnU";

// auth-js derives its cookie storage key from the Supabase URL itself
// (@supabase/supabase-js's SupabaseClient.ts: `sb-${hostname.split('.')[0]}
// -auth-token`) — not a WorkIt choice, so this has to track SUPABASE_URL by
// hand rather than being computed, since this file has no URL parser
// available at the top level in every context it's loaded into.
export const SUPABASE_SESSION_COOKIE_KEY = "sb-zhdrvdrojipkluhzgsea-auth-token";

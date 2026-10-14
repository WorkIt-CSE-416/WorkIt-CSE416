// Same values as frontend/.env.local's NEXT_PUBLIC_* and the root
// SUPABASE_URL — the anon key is meant to be public (frontend/CLAUDE.md),
// which is why it's checked in here the same way it's checked into the
// frontend bundle, rather than loaded from an untracked env file. There's
// no bundler in this prototype to inject env vars at build time, so a
// plain checked-in module is the honest equivalent.
//
// Dev vs. prod backend: tried in order by src/background/api.js, which
// treats an unreachable DEV_API_URL as "not running locally" and falls
// back to PROD_API_URL rather than erroring. Both must also be listed in
// manifest.json's host_permissions, or the background worker's fetch()
// calls hit the page's normal CORS rules instead of bypassing them.
export const DEV_API_URL = "http://localhost:8000";
export const PROD_API_URL = "https://workit-api.vercel.app";

// The webapp's own origins — where src/background/webapp-session.js reads
// the sb-* session cookie from, and where the popup sends the user to sign
// in. Must match manifest.json's host_permissions (chrome.cookies needs a
// matching host permission per origin) and externally_connectable.matches.
export const DEV_WEB_URL = "http://localhost:3000";
export const PROD_WEB_URL = "https://workit-web-gamma.vercel.app";

export const SUPABASE_URL = "https://zhdrvdrojipkluhzgsea.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoZHJ2ZHJvamlwa2x1aHpnc2VhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyOTU4NDksImV4cCI6MjEwMzg3MTg0OX0.fdYqIGXIXqNQXMsc9cF5_6ZHcx496SGSzheDCncAqnU";

// auth-js derives its cookie storage key from the Supabase URL itself
// (@supabase/supabase-js's SupabaseClient.ts: `sb-${hostname.split('.')[0]}
// -auth-token`) — not a WorkIt choice, so this has to track SUPABASE_URL by
// hand rather than being computed, since this file has no URL parser
// available at the top level in every context it's loaded into.
export const SUPABASE_SESSION_COOKIE_KEY = "sb-zhdrvdrojipkluhzgsea-auth-token";

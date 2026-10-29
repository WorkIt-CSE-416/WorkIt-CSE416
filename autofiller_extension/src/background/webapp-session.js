// Reads the signed-in session straight out of the WorkIt webapp's own
// cookies, instead of the extension keeping an independent one. This is
// what makes "sign in once, on workit.com" work for every method the
// webapp supports (password, Google, LinkedIn) without the extension
// needing to know which one was used.
//
// httpOnly does NOT block this. It stops `document.cookie` (page
// JavaScript) specifically, as an XSS defense — it says nothing about the
// `cookies` permission, which is a privileged, browser-level extension API
// a step above the page sandbox httpOnly protects against. That's exactly
// why the `cookies` permission shows its own "read sensitive site data"
// warning on the Chrome Web Store: this is a real, broader trust boundary
// than the rest of this extension asks for, not a loophole.
//
// The cookie's exact shape (name, chunking, encoding) was read out of the
// installed @supabase/ssr and @supabase/supabase-js source in
// node_modules, not guessed or taken from general docs — see
// autofiller_extension/CLAUDE.md's Auth section for exactly which files
// and lines. Still genuinely unverified against a live browser — see
// CLAUDE.md's Open Items for what happens if this project ever upgrades
// those packages and the format moves.

import { SUPABASE_SESSION_COOKIE_KEY, DEV_WEB_URL, PROD_SITES } from "../shared/config.js";

const BASE64_PREFIX = "base64-";
// @supabase/ssr's utils/chunker.ts: chunks beyond the first are named
// `<key>.0`, `<key>.1`, ... — capped here the same way its own
// getWithHints() caps its optimistic lookup, since nothing sane ever
// chunks a session this many ways.
const MAX_CHUNKS = 10;

/**
 * @param {string} value base64url, optionally without padding (cookie values
 *   never carry `=`, which `encodeURIComponent` would otherwise escape)
 * @returns {string}
 */
function base64UrlDecode(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * The access token's `sub` claim (the signed-in account's id), or null for a
 * token that won't decode. Read unverified: it only picks which cached
 * profile is this account's, and the API still verifies the token.
 * @param {string} token
 * @returns {string | null}
 */
function tokenSubject(token) {
  try {
    return JSON.parse(base64UrlDecode(token.split(".")[1])).sub ?? null;
  } catch {
    return null;
  }
}

/**
 * Looks up one cookie by its exact name. Deliberately `chrome.cookies.get`,
 * not `getAll` — confirmed by hand against a live Chrome instance that
 * `getAll` comes back empty for this cookie under every filter shape tried
 * (url, domain, bare name, no filter at all) despite the permission being
 * granted (`chrome.permissions.contains` true) and the cookie visibly
 * present in DevTools, while `get` with the same url finds it every time.
 * That's either a Chrome bug or an undocumented restriction on bulk
 * enumeration — since every cookie name this file needs is already known
 * (the fixed key plus its numbered chunks), there was never a real reason
 * to enumerate in the first place, so this works around it rather than
 * depending on `getAll` ever getting fixed.
 * @param {string} url
 * @param {string} name
 * @returns {Promise<string | null>}
 */
async function getCookie(origin, name) {
  // A bare origin with no path at all (`getAll`'s failure mode, live-tested)
  // is avoided here on purpose — `get` was only confirmed working against a
  // real path (`/dashboard`), not against the path-less origin string
  // config.js stores, so this always hands it a real path to match against.
  const url = `${origin}/`;
  try {
    const cookie = await chrome.cookies.get({ url, name });
    return cookie?.value ?? null;
  } catch (error) {
    console.warn(`webapp-session: chrome.cookies.get failed for "${name}" at ${url}`, error);
    return null;
  }
}

/**
 * Reassembles the chunked cookie value (@supabase/ssr/src/utils/chunker.ts's
 * createChunks/combineChunks, reimplemented read-side here since that's an
 * internal module, not something this extension can import).
 * @param {string} url
 * @returns {Promise<string | null>}
 */
async function reassembleSessionCookie(url) {
  const whole = await getCookie(url, SUPABASE_SESSION_COOKIE_KEY);
  if (whole) return whole;

  let combined = "";
  let sawAnyChunk = false;
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const chunk = await getCookie(url, `${SUPABASE_SESSION_COOKIE_KEY}.${i}`);
    if (chunk === null) break;
    sawAnyChunk = true;
    combined += chunk;
  }

  if (!sawAnyChunk) {
    console.warn(`webapp-session: no "${SUPABASE_SESSION_COOKIE_KEY}" cookie (or chunks) at ${url}`);
  }
  return combined || null;
}

/**
 * @param {string} raw
 * @returns {Omit<import("../shared/types.js").Session, "web_origin"> | null}
 */
function decodeSession(raw) {
  const encoded = raw.startsWith(BASE64_PREFIX) ? raw.slice(BASE64_PREFIX.length) : raw;

  let session;
  try {
    session = JSON.parse(base64UrlDecode(decodeURIComponent(encoded)));
  } catch (error) {
    // a half-written chunk set, or the cookie format changed — see CLAUDE.md's Open Items
    console.warn("webapp-session: could not decode the session cookie", error);
    return null;
  }

  if (!session?.access_token || !session?.refresh_token) {
    console.warn("webapp-session: decoded cookie has no access_token/refresh_token", session);
    return null;
  }

  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    user_id: tokenSubject(session.access_token),
  };
}

/**
 * Tries the local dev webapp first, then each deployed one in PROD_SITES
 * order. The session carries the origin it came from, so api.js can call
 * the API paired with it.
 * @returns {Promise<import("../shared/types.js").Session | null>}
 */
export async function readWebappSession() {
  for (const origin of [DEV_WEB_URL, ...PROD_SITES.map((site) => site.web)]) {
    const raw = await reassembleSessionCookie(origin);
    if (!raw) continue;

    const session = decodeSession(raw);
    if (session) return { ...session, web_origin: origin };
  }
  return null;
}

// The extension has no sign-in of its own — it reads whatever session is
// already sitting in the WorkIt webapp's cookies (src/background/
// webapp-session.js). That's a deliberate choice, not a leftover: signing
// in happens once, on workit.com, through whichever method the account
// actually uses (password, Google, LinkedIn), and this extension inherits
// it rather than asking for credentials again or needing its own Google
// OAuth dance. See autofiller_extension/CLAUDE.md's Auth section for the
// earlier, since-replaced approach (an independent sign-in) and why this
// one won out.

import { SUPABASE_SESSION_COOKIE_KEY } from "../shared/config.js";
import { keepFor } from "./account-data.js";
import { readSessionCookie, readWebappSession } from "./webapp-session.js";

// Refresh this long before the access token expires, so a call never goes out with one about to lapse.
const REFRESH_MARGIN_S = 2 * 60;
// A refresh that left the token as it was (the webapp unreachable, say) isn't asked again for this long.
const RETRY_AFTER_MS = 30 * 1000;
/** The last refresh asked for, by the access token it replaced: callers holding that token share it. */
let refreshing = null;
// A cookie the webapp rewrites (a refresh) is gone or half-written for a moment: no session is taken for a
// sign-out until the cookie has been so this long, and as long since the extension's own refresh settled.
const SETTLE_MS = 2000;
/** The sign-out check under way (confirmSignedOut), if any. */
let signOutCheck = null;

/**
 * The one function everything else calls. Returns null when the webapp
 * itself has no valid session — callers decide what that means (the popup
 * shows "sign in at WorkIt"; the panel shows Sign in to WorkIt).
 *
 * An access token within REFRESH_MARGIN_S of expiry is refreshed first,
 * through the webapp (refreshSession), so a long batch outlives the hour.
 * @returns {Promise<import("../shared/types.js").Session | null>}
 */
export async function getSession() {
  const { session, unreadable } = await readSessionCookie();
  const current = session && session.expires_at - Date.now() / 1000 < REFRESH_MARGIN_S ? await refreshSession(session) : session;
  // Another account's sign-in clears the last account's data at once (account-data.js); a sign-out only once
  // it holds (confirmSignedOut), never for a cookie that won't decode.
  if (current) await keepFor(current).catch((error) => console.warn("[account] not cleared:", error.message));
  else if (!unreadable) confirmSignedOut();
  return current;
}

/**
 * Clears the last account's data (keepFor(null)) once the session cookie is
 * still gone SETTLE_MS on, with no refresh of the extension's own under way
 * or just settled: a refresh rewrites the cookie, and for that moment it
 * reads as signed out (KAN-469). A cookie that won't decode clears nothing.
 */
function confirmSignedOut() {
  signOutCheck ??= (async () => {
    const wait = () => new Promise((done) => setTimeout(done, SETTLE_MS));
    await wait();
    while (refreshing && !(refreshing.settled && Date.now() - refreshing.settled >= SETTLE_MS)) await wait();
    const { session, unreadable } = await readSessionCookie();
    if (!session && !unreadable) await keepFor(null);
  })()
    .catch((error) => console.warn("[account] not cleared:", error.message))
    .finally(() => (signOutCheck = null));
}

/**
 * Asks the webapp to refresh `stale`'s session (GET <web_origin>/api/
 * session/refresh, with its cookie), then reads the cookie again. The
 * extension never trades the refresh token itself: Supabase rotates it on
 * each use, and if this extension and the webapp's src/proxy.ts both
 * refreshed, one would present an already-rotated token and could sign the
 * student out of the webapp. Only the webapp writes the cookie, so there is
 * no race. Callers holding the same token share one request.
 *
 * Returns the session the cookie now holds: a new one, null when the
 * webapp signed the student out (no valid refresh token: the route clears
 * the cookie), or `stale` again when the webapp couldn't be reached.
 * Called by getSession near expiry, and by api.js after a 401 with `force`:
 * the route rotates a token only near its expiry, and a refused one may be
 * far from it, so `force=1` asks it to rotate regardless (KAN-465).
 * @param {import("../shared/types.js").Session} stale
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<import("../shared/types.js").Session | null>}
 */
export async function refreshSession(stale, { force = false } = {}) {
  // A forced refresh shares only a forced one: one that wasn't may have left the token as it was.
  const fresh = refreshing?.from === stale.access_token && Date.now() - refreshing.at < RETRY_AFTER_MS && (refreshing.force || !force);
  if (!fresh) {
    const asked = { from: stale.access_token, at: Date.now(), force, settled: 0, done: askWebapp(stale.web_origin, force) };
    asked.done.finally(() => (asked.settled = Date.now()));
    refreshing = asked;
  }
  return refreshing.done;
}

/**
 * @param {string} origin
 * @param {boolean} force
 */
async function askWebapp(origin, force) {
  try {
    await fetch(`${origin}/api/session/refresh${force ? "?force=1" : ""}`, { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    console.warn("auth: the webapp's session refresh failed", error);
  }
  return readWebappSession();
}

/**
 * Watches the webapp's session cookie (and its chunks): a sign-out clears the
 * account's data then, not at the next call that reads the session. Called
 * by background.js, so importing this file (tests do, outside Chrome)
 * registers nothing.
 */
export function watchSessionCookie() {
  chrome.cookies.onChanged.addListener(({ cookie }) => {
    if (cookie.name.startsWith(SUPABASE_SESSION_COOKIE_KEY)) getSession().catch(() => {});
  });
}

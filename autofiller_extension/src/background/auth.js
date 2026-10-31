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
import { readWebappSession } from "./webapp-session.js";

// Refresh this long before the access token expires, so a call never goes out with one about to lapse.
const REFRESH_MARGIN_S = 2 * 60;
// A refresh that left the token as it was (the webapp unreachable, say) isn't asked again for this long.
const RETRY_AFTER_MS = 30 * 1000;
/** The last refresh asked for, by the access token it replaced: callers holding that token share it. */
let refreshing = null;

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
  const session = await readWebappSession();
  const current = session && session.expires_at - Date.now() / 1000 < REFRESH_MARGIN_S ? await refreshSession(session) : session;
  // A sign-out or another account's sign-in clears the last account's data (account-data.js).
  await keepFor(current).catch((error) => console.warn("[account] not cleared:", error.message));
  return current;
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
 * Called by getSession near expiry, and by api.js after a 401.
 * @param {import("../shared/types.js").Session} stale
 * @returns {Promise<import("../shared/types.js").Session | null>}
 */
export async function refreshSession(stale) {
  const fresh = refreshing?.from === stale.access_token && Date.now() - refreshing.at < RETRY_AFTER_MS;
  if (!fresh) {
    const asked = { from: stale.access_token, at: Date.now(), done: askWebapp(stale.web_origin) };
    refreshing = asked;
  }
  return refreshing.done;
}

/** @param {string} origin */
async function askWebapp(origin) {
  try {
    await fetch(`${origin}/api/session/refresh`, { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    console.warn("auth: the webapp's session refresh failed", error);
  }
  return readWebappSession();
}

// The webapp's session cookie (or one of its chunks) changed: a sign-out clears the account's data now,
// not at the next call that reads the session.
chrome.cookies.onChanged.addListener(({ cookie }) => {
  if (cookie.name.startsWith(SUPABASE_SESSION_COOKIE_KEY)) getSession().catch(() => {});
});

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

/**
 * The one function everything else calls. Returns null when the webapp
 * itself has no valid session — callers decide what that means (the popup
 * shows "sign in at WorkIt"; the content script shows the same, deferring
 * to the popup).
 *
 * Deliberately does NOT attempt its own token refresh when the webapp's
 * access token has expired. The webapp's refresh_token rotates on each use
 * (standard Supabase behavior) — if this extension refreshed independently
 * and wrote a new token back, and the webapp's own src/proxy.ts refreshed
 * around the same time with what it still thinks is the current
 * refresh_token, one of the two would fail with an already-rotated token,
 * which could sign the user out of the actual webapp over something this
 * extension did in the background. Safer to ask the user to revisit a
 * WorkIt tab (which refreshes it) than to risk that.
 * @returns {Promise<import("../shared/types.js").Session | null>}
 */
export async function getSession() {
  const session = await readWebappSession();
  // A sign-out or another account's sign-in clears the last account's data (account-data.js).
  await keepFor(session).catch((error) => console.warn("[account] not cleared:", error.message));
  return session;
}

// The webapp's session cookie (or one of its chunks) changed: a sign-out clears the account's data now,
// not at the next call that reads the session.
chrome.cookies.onChanged.addListener(({ cookie }) => {
  if (cookie.name.startsWith(SUPABASE_SESSION_COOKIE_KEY)) getSession().catch(() => {});
});

// The panel's other states (KAN-401; content/panel-states.js draws them):
// signed out's Sign in to WorkIt, and the toolbar popup on a site WorkIt
// can't fill.

import { DEV_WEB_URL, PROD_SITES } from "../shared/config.js";

/**
 * The webapp to sign in at, with no session to name it: the local one when
 * it answers (development), else WorkIt's site (popup.js's own rule).
 */
export async function webappOrigin() {
  try {
    const response = await fetch(DEV_WEB_URL, { signal: AbortSignal.timeout(1000) });
    if (response.ok || response.type === "opaque") return DEV_WEB_URL;
  } catch {
    // no local webapp: WorkIt's site
  }
  return PROD_SITES[0].web;
}

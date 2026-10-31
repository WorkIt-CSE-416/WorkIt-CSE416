// The panel's settings view (KAN-402; content/panel-settings.js draws it):
// the student's Claude connection and whether a batch tab's panel opens by
// itself. The Workday Sign-Up password stays on the extension's own options
// page (workday/signup-open), never in the panel, which lives in the
// employer's page.

import { getSession } from "./auth.js";
import { connectorAdded, disconnectConnector, me } from "./api.js";
import { fillNumbersOn } from "./fill-events.js";

// Whether a batch tab's panel opens by itself once its fill is done (true unless the student turned it off).
const AUTO_OPEN_KEY = "panel_auto_open";

/** Whether a batch tab's panel opens by itself. */
export async function autoOpen() {
  return (await chrome.storage.local.get(AUTO_OPEN_KEY))[AUTO_OPEN_KEY] !== false;
}

/** Keeps the student's auto-open choice. */
export async function setAutoOpen(on) {
  await chrome.storage.local.set({ [AUTO_OPEN_KEY]: Boolean(on) });
  return { autoOpen: Boolean(on) };
}

/**
 * What the settings view shows: signed in or not, the Claude connection
 * (`claude`: true, false, or null when it couldn't be read), auto-open and
 * whether fill numbers are sent (KAN-476).
 */
export async function readSettings() {
  const [session, open, fillNumbers] = await Promise.all([getSession(), autoOpen(), fillNumbersOn()]);
  if (!session) return { signedIn: false, claude: null, autoOpen: open, fillNumbers };
  let claude = null;
  try {
    claude = await connectorAdded((await me()).id);
  } catch (error) {
    console.warn("[settings] Claude connection not read:", error.message);
  }
  return { signedIn: true, claude, autoOpen: open, fillNumbers };
}

/** Add to Claude: the webapp's link, which goes on to Claude's Add Custom Connector dialog. */
export async function addClaude(openerTabId) {
  const session = await getSession();
  if (!session) return { opened: false };
  await chrome.tabs.create({ url: `${session.web_origin}/connect/claude/add`, openerTabId });
  return { opened: true };
}

/** Disconnect: revokes the Claude's sign-in to WorkIt at once, as the webapp's Settings does. */
export async function disconnectClaude() {
  await disconnectConnector((await me()).id);
  return { claude: false };
}

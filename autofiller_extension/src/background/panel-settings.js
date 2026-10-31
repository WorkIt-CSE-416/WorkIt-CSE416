// The panel's settings view (KAN-402; content/panel-settings.js draws it):
// the student's Claude connection and whether a batch tab's panel opens by
// itself. The Workday Sign-Up password stays on the extension's own options
// page (workday/signup-open), never in the panel, which lives in the
// employer's page.

import { getSession } from "./auth.js";
import { connectorAdded, disconnectConnector, me } from "./api.js";
import { AUTOFILL_OFF_KEY } from "../shared/autofill-categories.js";

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
 * (`claude`: true, false, or null when it couldn't be read) and auto-open.
 */
export async function readSettings() {
  const [session, open] = await Promise.all([getSession(), autoOpen()]);
  if (!session) return { signedIn: false, claude: null, autoOpen: open };
  let claude = null;
  try {
    claude = await connectorAdded((await me()).id);
  } catch (error) {
    console.warn("[settings] Claude connection not read:", error.message);
  }
  return { signedIn: true, claude, autoOpen: open };
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

// The edge tab hidden on every site (KAN-480): the panel's and the edge tab's Hide everywhere set it; Options'
// "Show the WorkIt tab on job pages" clears it. Alt+W and the toolbar still open the panel.
export const HIDDEN_EVERYWHERE_KEY = "panel_hidden_everywhere";

/** Whether the student hid the edge tab everywhere. */
export async function hiddenEverywhere() {
  return (await chrome.storage.local.get(HIDDEN_EVERYWHERE_KEY))[HIDDEN_EVERYWHERE_KEY] === true;
}

/** Hides the edge tab everywhere. */
export async function hideEverywhere() {
  await chrome.storage.local.set({ [HIDDEN_EVERYWHERE_KEY]: true });
  return { hiddenEverywhere: true };
}

/** The Fields to autofill categories the student switched off in Options (KAN-480), by id. */
export async function autofillOff() {
  const off = (await chrome.storage.local.get(AUTOFILL_OFF_KEY))[AUTOFILL_OFF_KEY];
  return Array.isArray(off) ? off : [];
}

// Install, update and uninstall (KAN-471, KAN-495). Before this the
// extension did nothing on any of them: a new student saw no page after
// Add to Chrome, an update had no way to change what older versions
// stored, and a student who removed it told WorkIt nothing.
//
// - Install opens the webapp's extension setup page (/extension-setup,
//   KAN-495), which explains how to use the extension. A signed-out
//   student can still read it: the page needs no session.
// - Every install and update brings stored data up to date (stored-data.js).
// - Removing the extension opens the webapp's one-question survey
//   (/uninstalled), with the version removed and nothing else: no account,
//   no profile id, so the answer stays anonymous.

import { webappOrigin } from "./panel-states.js";
import { migrateStorage } from "./stored-data.js";

export const SETUP_PATH = "/extension-setup";
export const UNINSTALL_PATH = "/uninstalled";

/**
 * Points Chrome's uninstall page at the survey on the webapp this browser
 * uses (panel-states.js's webappOrigin). Chrome keeps it across restarts;
 * it is set again on each install, update and start, so it follows a move
 * between the local and the deployed webapp.
 */
export async function setUninstallPage() {
  const url = new URL(UNINSTALL_PATH, await webappOrigin());
  url.searchParams.set("v", chrome.runtime.getManifest().version);
  await chrome.runtime.setUninstallURL(url.href);
}

/** chrome.runtime.onInstalled: migrate, then on a first install the setup page, then the uninstall page. */
export async function installed(details) {
  await migrateStorage(chrome.storage.local);
  if (details.reason === "install") await chrome.tabs.create({ url: new URL(SETUP_PATH, await webappOrigin()).href });
  await setUninstallPage();
}

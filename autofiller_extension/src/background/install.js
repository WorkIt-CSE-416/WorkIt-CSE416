// Install, update and uninstall (KAN-471). Before this the extension did
// nothing on any of them: a new student saw no page after Add to Chrome, an
// update had no way to change what older versions stored, and a student who
// removed it told WorkIt nothing.
//
// - Install opens onboarding's extension step (the webapp's
//   /onboarding/applicant?step=extension, KAN-378), which then leads to the
//   practice batch. A signed-out student signs in first and comes back to it.
// - Every install and update brings stored data up to date (stored-data.js).
// - Removing the extension opens the webapp's one-question survey
//   (/uninstalled), with the version removed and nothing else: no account,
//   no profile id, so the answer stays anonymous.

import { webappOrigin } from "./panel-states.js";
import { migrateStorage } from "./stored-data.js";

export const ONBOARDING_PATH = "/onboarding/applicant?step=extension";
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

/** chrome.runtime.onInstalled: migrate, then on a first install the onboarding step, then the uninstall page. */
export async function installed(details) {
  await migrateStorage(chrome.storage.local);
  if (details.reason === "install") await chrome.tabs.create({ url: new URL(ONBOARDING_PATH, await webappOrigin()).href });
  await setUninstallPage();
}

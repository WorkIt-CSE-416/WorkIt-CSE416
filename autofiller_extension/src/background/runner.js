// The auto-apply runner's first step (auto-apply/architecture.md, "The
// run"): take the next queued application from the API and open its
// apply_url in the run's own tab. Nothing is filled yet — the fill, the
// student's Submitted/Skip and recording the outcome come next.
//
// The URL always comes from the API, never from the message that asked
// for it: a page on an externally_connectable origin that could hand this
// worker any URL could make it open any site.

import { ApiError, me, nextApplication } from "./api.js";

// The run's tab and the job posting open in it, kept in
// chrome.storage.session rather than a variable: Chrome stops this worker
// after ~30 seconds idle, which clears module state, while session storage
// lasts until the browser closes.
const RUN_TAB_KEY = "workit_run_tab";
const LOAD_TIMEOUT_MS = 30_000;

/**
 * Opens the next queued application's apply_url. When the run's tab
 * already shows that application, it is left as it is: reloading it would
 * throw away whatever the student typed. Nothing finishes an application
 * yet, so the next one stays the same until the student closes the tab
 * or takes it out of the queue.
 * @param {chrome.runtime.MessageSender} sender the WorkIt tab that asked;
 *   a new run tab opens beside it
 * @returns {Promise<{ opened: true, jobId: string, url: string } | { opened: false, reason: "queue_empty" | "signed_out" }>}
 */
export async function openNextApplication(sender) {
  let account;
  try {
    account = await me();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { opened: false, reason: "signed_out" };
    throw error;
  }

  const application = await nextApplication(account.id);
  const saved = await runTab();
  if (!application) {
    if (saved) await saveRunTab({ ...saved, jobId: null });
    return { opened: false, reason: "queue_empty" };
  }

  const jobId = application.job.id;
  const url = application.job.apply_url;
  if (saved?.jobId !== jobId) await openApplicationTab(saved, jobId, url, sender.tab);
  return { opened: true, jobId, url };
}

/**
 * Which job posting the run's tab shows, or null when there is none
 * (never opened, or the student closed it).
 * @returns {Promise<{ jobId: string | null }>}
 */
export async function runStatus() {
  const saved = await runTab();
  return { jobId: saved?.jobId ?? null };
}

/**
 * Switches to the run's tab, for the webapp's "Working in Browser". Its
 * window is read from the tab, since the student may have dragged it out
 * into another. False when the student has closed it.
 * @returns {Promise<{ shown: boolean }>}
 */
export async function showRunTab() {
  const saved = await runTab();
  if (!saved) return { shown: false };
  const tab = await chrome.tabs.update(saved.tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return { shown: true };
}

/**
 * The saved run tab, only while it still exists.
 * @returns {Promise<{ tabId: number, jobId: string | null } | null>}
 */
async function runTab() {
  const { [RUN_TAB_KEY]: saved } = await chrome.storage.session.get(RUN_TAB_KEY);
  if (!saved) return null;
  const tab = await chrome.tabs.get(saved.tabId).catch(() => null);
  return tab ? saved : null;
}

function saveRunTab(saved) {
  return chrome.storage.session.set({ [RUN_TAB_KEY]: saved });
}

/**
 * One background tab for the whole run, reused for each application, so
 * ten applications never open ten tabs. It opens beside the WorkIt tab
 * that asked, in the student's own window, with `active: false`: a new
 * window jumped in front of a full-screen window on macOS (it gets its
 * own Space, and macOS switches to it), and `focused: false` can't stop
 * that. A background tab is hidden, so Chrome slows its timers and stops
 * its redraws (architecture.md, "Hidden tabs run slowly"), and it is kept
 * from being discarded, which would lose a half-filled form. Resolves once
 * the page has loaded.
 * @param {{ tabId: number } | null} saved runTab()'s answer
 * @param {string} jobId
 * @param {string} url
 * @param {chrome.tabs.Tab | undefined} opener the WorkIt tab that asked
 */
async function openApplicationTab(saved, jobId, url, opener) {
  if (saved) {
    await saveRunTab({ ...saved, jobId });
    // Listen before navigating, so a fast load can't finish unseen.
    const loaded = waitForLoad(saved.tabId);
    await chrome.tabs.update(saved.tabId, { url });
    return loaded;
  }

  // The student closed the run's tab (or this is the first open).
  const created = await chrome.tabs.create({
    url,
    active: false,
    windowId: opener?.windowId,
    index: opener ? opener.index + 1 : undefined,
  });
  await chrome.tabs.update(created.id, { autoDiscardable: false });
  await saveRunTab({ tabId: created.id, jobId });
  return waitForLoad(created.id);
}

/**
 * Resolves on the tab's `complete` status. Rejects when the tab closes or
 * the page takes longer than LOAD_TIMEOUT_MS. `status` needs no `tabs`
 * permission (only url, title and favicon do). On Greenhouse and Ashby the
 * form is drawn by JavaScript after this fires; the fill step has to wait
 * for its fields itself.
 * @param {number} tabId
 */
function waitForLoad(tabId) {
  return new Promise((resolve, reject) => {
    const done = (settle, value) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      settle(value);
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === "complete") done(resolve);
    };
    const onRemoved = (id) => {
      if (id === tabId) done(reject, new Error("The application's tab was closed"));
    };
    const timer = setTimeout(() => done(reject, new Error("The application page did not load")), LOAD_TIMEOUT_MS);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

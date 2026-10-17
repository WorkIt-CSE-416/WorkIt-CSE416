// The auto-apply runner's first step (auto-apply/architecture.md, "The
// run"): take the next queued application from the API and open its
// apply_url in the run's own window. Nothing is filled yet — the fill, the
// student's Submitted/Skip and recording the outcome come next.
//
// The URL always comes from the API, never from the message that asked
// for it: a page on an externally_connectable origin that could hand this
// worker any URL could make it open any site.

import { ApiError, me, nextApplication } from "./api.js";

// The run's window and tab, kept in chrome.storage.session rather than a
// variable: Chrome stops this worker after ~30 seconds idle, which clears
// module state, while session storage lasts until the browser closes.
const RUN_WINDOW_KEY = "workit_run_window";
const LOAD_TIMEOUT_MS = 30_000;

/**
 * Opens the next queued application's apply_url.
 * @returns {Promise<{ opened: true, jobId: string, url: string } | { opened: false, reason: "queue_empty" | "signed_out" }>}
 */
export async function openNextApplication() {
  let account;
  try {
    account = await me();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { opened: false, reason: "signed_out" };
    throw error;
  }

  const application = await nextApplication(account.id);
  if (!application) return { opened: false, reason: "queue_empty" };

  const url = application.job.apply_url;
  await openApplicationWindow(url);
  return { opened: true, jobId: application.job.id, url };
}

/**
 * One window for the whole run, one tab in it, reused for each
 * application, so ten applications never open ten windows. Opened with
 * `focused: false`, behind the student's own window — never minimized: a
 * minimized window's tab is hidden, and Chrome slows timers and stops
 * redraws there, which some dropdowns wait on (architecture.md, "Hidden
 * tabs run slowly"). Resolves once the page has loaded.
 * @param {string} url
 */
async function openApplicationWindow(url) {
  const { [RUN_WINDOW_KEY]: saved } = await chrome.storage.session.get(RUN_WINDOW_KEY);
  const tab = saved ? await chrome.tabs.get(saved.tabId).catch(() => null) : null;

  if (tab) {
    // Listen before navigating, so a fast load can't finish unseen.
    const loaded = waitForLoad(tab.id);
    await chrome.tabs.update(tab.id, { url });
    return loaded;
  }

  // The student closed the run's window (or this is the first open).
  const win = await chrome.windows.create({ url, focused: false, type: "normal", width: 1100, height: 900 });
  const [created] = win.tabs;
  await chrome.storage.session.set({ [RUN_WINDOW_KEY]: { windowId: win.id, tabId: created.id } });
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

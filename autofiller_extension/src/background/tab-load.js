// Waiting on a tab batch apply opened (batch.js's startFill): for its page
// to load, then for its form to show. Both watch events, never
// requestAnimationFrame, which a hidden tab does not run.

const LOAD_TIMEOUT_MS = 30_000;

/**
 * Whether a form field shows in the tab within `timeoutMs` (waitForForm,
 * run in the page).
 * @param {number} tabId
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
export async function formShows(tabId, timeoutMs) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: waitForForm, args: [timeoutMs] });
  return result;
}

/**
 * Runs in the application's page. Resolves true once a form field exists,
 * false after `timeoutMs`. It watches the DOM, never requestAnimationFrame,
 * which a hidden tab does not run.
 * @param {number} timeoutMs
 */
function waitForForm(timeoutMs) {
  // Ashby's form has no <form> element: its fields sit in [data-field-path] boxes.
  const FIELD = "#first_name, form input:not([type=hidden]), form select, form textarea, [data-field-path] input, [data-field-path] textarea";
  return new Promise((resolve) => {
    if (document.querySelector(FIELD)) return resolve(true);
    const observer = new MutationObserver(() => {
      if (document.querySelector(FIELD)) done(true);
    });
    const timer = setTimeout(() => done(false), timeoutMs);
    function done(found) {
      observer.disconnect();
      clearTimeout(timer);
      resolve(found);
    }
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

/**
 * Resolves on the tab's `complete` status (already reached, or later).
 * Rejects when the tab closes or the page takes longer than LOAD_TIMEOUT_MS.
 * `status` needs no `tabs` permission.
 * @param {number} tabId
 */
export function waitForLoad(tabId) {
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
    // A fast page may have loaded before the listener was added.
    chrome.tabs.get(tabId).then((tab) => tab.status === "complete" && done(resolve), () => {});
  });
}

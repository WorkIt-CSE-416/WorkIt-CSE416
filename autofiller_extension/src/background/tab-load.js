// Waiting on a tab batch apply opened (batch.js's startFill): for its page
// to load, then for its form to show. Both watch events, never
// requestAnimationFrame, which a hidden tab does not run.

import { ENGINE_FILES } from "../shared/content-scripts.js";

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

const HUMAN_CHECK_WAIT_MS = 5 * 60_000;

/**
 * Whether the tab shows a human check (a captcha: Cloudflare's Turnstile,
 * hCaptcha, reCAPTCHA) where its form should be: the check's frame, or its
 * words. Only asked once no form showed, so a form's footer naming
 * Cloudflare never counts.
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
export async function humanCheckShows(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: isHumanCheck });
  return result;
}

/** Runs in the page: a check's frame, or Apply's words for one (bot_signals SAYS_CAPTCHA). */
function isHumanCheck() {
  const FRAME = 'iframe[src*="challenges.cloudflare.com"], iframe[src*="hcaptcha.com"], iframe[src*="google.com/recaptcha"], iframe[src*="recaptcha.net"]';
  const SAYS = /captcha|not a robot|turnstile|cloudflare|verify (that )?you are (a )?human/i;
  return Boolean(document.querySelector(FRAME)) || SAYS.test(`${document.title} ${document.body?.innerText ?? ""}`);
}

/**
 * Waits, for up to HUMAN_CHECK_WAIT_MS, for the form behind a human check
 * the student is passing. Passing one often loads a new page, which ends a
 * look in the old one: the wait then goes on in the new page. Resolves
 * whether the form showed; rejects when the tab closes.
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
export async function formAfterHumanCheck(tabId) {
  const end = Date.now() + HUMAN_CHECK_WAIT_MS;
  while (Date.now() < end) {
    try {
      // Short looks: each one keeps the service worker awake.
      if (await formShows(tabId, Math.min(20_000, end - Date.now()))) return true;
    } catch {
      await chrome.tabs.get(tabId);
      await waitForLoad(tabId).catch(() => {});
      // A page that takes no script (an error page) throws at once: don't look again straight away.
      await new Promise((done) => setTimeout(done, 1_000));
    }
  }
  return false;
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

/**
 * Workable restores an unsent draft of its form from local storage as the
 * form opens (an earlier fill's, or the student's own visit), and the
 * engine fills only an empty form ("the form already has entries"): the
 * engine forgets the draft (`forgetDrafts`), and the tab reloads, so the
 * form opens empty. Resolves once the reloaded page has loaded.
 * @param {number} tabId
 */
export async function forgetWorkableDraft(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ENGINE_FILES });
  await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: () => {
    // Workable may save the form again before the page goes (its draft of what it restored): forgotten then too.
    const forget = () => globalThis.FillEngine.forgetDrafts("workable");
    forget();
    addEventListener("pagehide", forget);
  } });
  const loaded = new Promise((resolve) => {
    const onUpdated = (id, info) => {
      if (id !== tabId || info.status !== "complete") return;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
  await chrome.tabs.reload(tabId);
  await loaded;
}

// Tabs whose Workable draft the student's own Autofill just forgot: their next fill fills as the form shows.
const freshened = new Set();

/**
 * The student's own Autofill (outside a batch, whose tabs forget the draft as
 * they open) on a Workable form that shows entries in one of its repeating
 * sections: a draft Workable restored (an earlier visit or fill), whose
 * entries the engine refuses to add to ("the form already has entries") and
 * would otherwise be sent with the application. Forgets the draft and
 * reloads the tab, as Apply does before every Workable fill; the caller then
 * fills it again. Only a page's first Plan looks, and only once per Autofill: the fill after
 * the reload goes ahead even if Workable restored the draft again.
 * @param {number} tabId
 * @param {{ site?: string, questions?: { name: string, label: string }[] }} prepared the fill's Plan
 * @returns {Promise<boolean>} whether the tab was reloaded
 */
export async function forgetShownWorkableDraft(tabId, prepared) {
  if (prepared?.site !== "workable") return false;
  const again = freshened.delete(tabId);
  const sections = (prepared.questions ?? []).filter((q) => q.label.endsWith("(entries)")).map((q) => q.name);
  // Only a page's first Plan looks: later ones (a fill's own entries showing) never reload it.
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (names, timeoutMs) => {
      if (window.__workitDraftLooked) return false;
      window.__workitDraftLooked = true;
      // The restored entries show once Workable's app has mounted, which shows the form's Submit.
      const end = Date.now() + timeoutMs;
      while (!document.querySelector("button[data-ui=apply-button]") && Date.now() < end) await new Promise((wait) => setTimeout(wait, 200));
      return names.some((name) => document.querySelector(`[data-ui="${CSS.escape(name)}"] li`));
    },
    args: [sections, LOAD_TIMEOUT_MS],
  });
  if (!result || again) return false;
  freshened.add(tabId);
  await forgetWorkableDraft(tabId);
  return true;
}

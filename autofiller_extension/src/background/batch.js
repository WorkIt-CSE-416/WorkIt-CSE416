// Batch apply (KAN-370; auto-apply/architecture.md, "Batch apply"): the
// queued applications open in the student's own window, each in its own
// background tab, at most WINDOW filling at once; as one finishes, the next
// queued one opens. A finished tab goes into one of two tab groups, "Ready"
// (every field it needs shows an answer) or "Needs you", and moves between
// them as the content script reports a change (content-script.js,
// "batch/state"). The extension never submits: the student reviews each tab
// and presses the employer's own Submit. Once the job system says that
// submit sent the application (the Fill engine's signal: its answer to the
// submit, its notice, or its confirmation page; KAN-374), the application
// is marked applied, with the resume the fill attached kept as its sent
// resume, and the tab leaves its group (markSubmitted).
//
// The queue, its order and each application's stage stay the API's: the
// next one is GET .../applications/next, skipping the jobs this batch has
// opened, and a tab's state is PUT .../applications/{job}/fill (needs_you
// moves the application to needs_you, ready back to queued). What only the
// browser knows (which tab shows which job, which tabs are still filling,
// the two groups) is kept in chrome.storage.session, since Chrome stops this
// worker after ~30 seconds idle; every change is driven by an event (a
// message, a closed tab), so a restarted worker carries on from storage.
//
// THE TABS FILL HIDDEN. KAN-305's runner showed its one tab for the fill,
// after the pre-engine filler left most dropdowns empty in a hidden tab. The
// Fill engine does not: five saved Greenhouse forms, and five live ones,
// filled hidden and at once gave the same fields as each filled in turn while
// shown (checked 2026-10-25, Chromium 1248). So no tab is ever made active,
// and the student stays on the page they were on.

import { ApiError, finishApplication, getAutofillProfile, me, nextApplication, recordFill, recordSentResume } from "./api.js";
import { formUrl } from "./engine.js";
import { injectFill } from "../shared/content-scripts.js";

/** At most this many tabs fill at once. */
export const WINDOW = 5;
// The two groups, coloured from Chrome's fixed palette as near WorkIt's own
// status colours as it goes: positive green, warning orange.
const GROUPS = {
  ready: { title: "Ready", color: "green" },
  needs_you: { title: "Needs you", color: "orange" },
};
const BATCH_KEY = "workit_batch";
const LOAD_TIMEOUT_MS = 30_000;
const FORM_TIMEOUT_MS = 10_000;

/**
 * @typedef {"filling" | "ready" | "needs_you" | "applied"} TabState
 * @typedef {{
 *   windowId: number,
 *   tabs: Record<string, { jobId: string, url: string, state: TabState }>,
 *   opened: string[],
 *   groups: { ready?: number, needs_you?: number },
 * }} Batch
 */

// One change to the batch at a time: two tabs finishing together would
// otherwise each read the same state and open the same next job.
let queue = Promise.resolve();
function serially(change) {
  const run = queue.then(change, change);
  queue = run.catch(() => {});
  return run;
}

/** @returns {Promise<Batch | null>} */
async function load() {
  return (await chrome.storage.session.get(BATCH_KEY))[BATCH_KEY] ?? null;
}

function save(batch) {
  return chrome.storage.session.set({ [BATCH_KEY]: batch });
}

/**
 * Start Auto Apply and a job card's Auto Apply (`run/open`): starts the
 * batch in the window of the WorkIt tab that asked, or tops up the one
 * running, and answers once the tabs have opened, not filled. The job
 * links always come from the API, never the message.
 * @param {chrome.runtime.MessageSender} sender
 * @returns {Promise<
 *   | { opened: true, jobId: string, jobIds: string[], url: string, fill: "started" | "kept" }
 *   | { opened: false, reason: "queue_empty" | "signed_out" }
 * >}
 */
export async function startBatch(sender) {
  let account;
  try {
    account = await me();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { opened: false, reason: "signed_out" };
    throw error;
  }
  return serially(async () => {
    let batch = await liveBatch();
    if (!batch) batch = { windowId: sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT, tabs: {}, opened: [], groups: {} };
    const before = Object.keys(batch.tabs).length;
    await topUp(batch, account.id);
    const open = Object.values(batch.tabs);
    if (!open.length) return { opened: false, reason: "queue_empty" };
    return {
      opened: true,
      jobId: open[0].jobId,
      jobIds: open.map((t) => t.jobId),
      url: open[0].url,
      fill: open.length > before ? "started" : "kept",
    };
  });
}

/** The saved batch, without the tabs the student has closed since (the worker may have slept through it). */
async function liveBatch() {
  const batch = await load();
  if (!batch) return null;
  for (const id of Object.keys(batch.tabs)) {
    if (!(await chrome.tabs.get(Number(id)).catch(() => null))) delete batch.tabs[id];
  }
  return batch;
}

/**
 * Opens the next queued applications until WINDOW tabs are filling or the
 * queue is empty. Each tab opens hidden beside the others, kept from being
 * discarded, and its fill starts once it loads (not awaited here).
 * @param {Batch} batch
 * @param {string} applicantId
 */
async function topUp(batch, applicantId) {
  const filling = () => Object.values(batch.tabs).filter((t) => t.state === "filling").length;
  while (filling() < WINDOW) {
    const application = await nextApplication(applicantId, batch.opened);
    if (!application) break;
    const jobId = application.job.id;
    // The form, not the job's page, where the two differ (a Lever posting's form is at .../apply).
    const url = formUrl(application.job.apply_url);
    const tab = await chrome.tabs.create({ url, active: false, windowId: batch.windowId });
    // Memory Saver must never throw away a form the student hasn't reviewed.
    await chrome.tabs.update(tab.id, { autoDiscardable: false });
    batch.windowId = tab.windowId;
    batch.tabs[tab.id] = { jobId, url, state: "filling" };
    batch.opened.push(jobId);
    await save(batch);
    startFill(tab.id);
  }
  await save(batch);
}

/**
 * Waits for the tab's page and its form, then injects the fill. A page that
 * never loads, shows no form, or is on a site the extension may not touch
 * (a job system with no Filler) fills nothing and needs the student.
 * @param {number} tabId
 */
async function startFill(tabId) {
  try {
    await waitForLoad(tabId);
    const [{ result: found }] = await chrome.scripting.executeScript({ target: { tabId }, func: waitForForm, args: [FORM_TIMEOUT_MS] });
    if (!found) throw new Error("no_form");
    await injectFill(tabId, { batch: true });
  } catch (error) {
    console.warn("[batch] nothing was filled:", error.message);
    await setTabState(tabId, "needs_you");
  }
}

/**
 * A batch tab's new state, from its content script or from startFill: the
 * tab moves to its group and the application's stage follows (needs_you, or
 * queued while ready). A tab that was filling frees its place, and the next
 * queued application opens. Tabs outside the batch are ignored.
 * @param {number} tabId
 * @param {"ready" | "needs_you"} state
 */
export function setTabState(tabId, state) {
  return serially(async () => {
    const batch = await load();
    const tab = batch?.tabs[tabId];
    // A sent application's form may still change (the page clears it); its tab stays out of the groups.
    if (!tab || tab.state === state || tab.state === "applied") return { batch: Boolean(tab) };
    const wasFilling = tab.state === "filling";
    tab.state = state;
    await save(batch);
    await moveToGroup(batch, tabId, state);
    let account = null;
    try {
      account = await me();
      await recordFill(account.id, tab.jobId, state);
    } catch (error) {
      console.warn("[batch] the application's stage wasn't saved:", error.message);
    }
    if (wasFilling && account) await topUp(batch, account.id);
    return { batch: true };
  });
}

/**
 * The student's submit sent a batch tab's application (the Fill engine said
 * so; background.js): it is marked applied, with the resume the fill
 * attached (the profile's) kept as its sent resume, and the tab leaves its
 * group, which holds only what still waits for the student. Once only:
 * the page's answer and its confirmation page may both say so. A resume that
 * isn't recorded doesn't stop the mark; a mark the API refuses throws, for
 * the tab to show. Tabs outside the batch are ignored.
 * @param {number} tabId
 */
export function markSubmitted(tabId) {
  return serially(async () => {
    const batch = await load();
    const tab = batch?.tabs[tabId];
    if (!tab || tab.state === "applied") return { batch: Boolean(tab) };
    const account = await me();
    const resume = (await getAutofillProfile().catch(() => null))?.resume;
    const sent = resume?.uploaded_resume_id ? { uploaded_resume_id: resume.uploaded_resume_id } : resume?.built_resume_id ? { built_resume_id: resume.built_resume_id } : null;
    if (sent) await recordSentResume(account.id, tab.jobId, sent).catch((error) => console.warn("[batch] the sent resume wasn't recorded:", error.message));
    await finishApplication(account.id, tab.jobId, "submitted");
    const wasFilling = tab.state === "filling";
    tab.state = "applied";
    await save(batch);
    await chrome.tabs.ungroup(tabId).catch(() => {});
    if (wasFilling) await topUp(batch, account.id);
    return { batch: true };
  });
}

/** Puts the tab in its state's group, making the group again if the student closed or emptied it. */
async function moveToGroup(batch, tabId, state) {
  const saved = batch.groups[state];
  const exists = saved !== undefined && (await chrome.tabGroups.get(saved).catch(() => null));
  try {
    if (exists) {
      await chrome.tabs.group({ tabIds: [tabId], groupId: saved });
      return;
    }
    const groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: batch.windowId } });
    await chrome.tabGroups.update(groupId, GROUPS[state]);
    batch.groups[state] = groupId;
    await save(batch);
  } catch (error) {
    // The student dragged the tab to another window, or closed it meanwhile.
    console.warn("[batch] the tab wasn't grouped:", error.message);
  }
}

/** A closed batch tab leaves the batch; a filling one frees its place for the next. */
export function forgetTab(tabId) {
  return serially(async () => {
    const batch = await load();
    const tab = batch?.tabs[tabId];
    if (!tab) return;
    delete batch.tabs[tabId];
    await save(batch);
    if (tab.state !== "filling") return;
    try {
      await topUp(batch, (await me()).id);
    } catch (error) {
      console.warn("[batch] the next application didn't open:", error.message);
    }
  });
}

/** Whether a tab is one of the batch's, for a fill injected again (Workday's next page). */
export async function inBatch(tabId) {
  return Boolean((await load())?.tabs[tabId]);
}

/**
 * Which job postings the batch's tabs show (`jobIds`, in the order they
 * opened; `jobId` the first), for the webapp's "Working in Browser".
 * @returns {Promise<{ jobId: string | null, jobIds: string[] }>}
 */
export async function batchStatus() {
  const batch = await liveBatch();
  const jobIds = Object.values(batch?.tabs ?? {}).map((t) => t.jobId);
  return { jobId: jobIds[0] ?? null, jobIds };
}

/**
 * Switches to the tab of `jobId` (else the batch's first) and its window.
 * False when there is no such tab.
 * @param {{ jobId?: string }} message
 * @returns {Promise<{ shown: boolean }>}
 */
export async function showBatchTab(message) {
  const batch = await liveBatch();
  const entries = Object.entries(batch?.tabs ?? {});
  const [id] = entries.find(([, t]) => t.jobId === message?.jobId) ?? entries[0] ?? [];
  if (id === undefined) return { shown: false };
  const tab = await chrome.tabs.update(Number(id), { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return { shown: true };
}

/**
 * Runs in the application's page. Resolves true once a form field exists,
 * false after `timeoutMs`. It watches the DOM, never requestAnimationFrame,
 * which a hidden tab does not run.
 * @param {number} timeoutMs
 */
function waitForForm(timeoutMs) {
  const FIELD = "#first_name, form input:not([type=hidden]), form select, form textarea";
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
    // A fast page may have loaded before the listener was added.
    chrome.tabs.get(tabId).then((tab) => tab.status === "complete" && done(resolve), () => {});
  });
}

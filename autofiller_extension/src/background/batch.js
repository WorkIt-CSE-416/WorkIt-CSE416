// Batch apply (KAN-370; auto-apply/architecture.md, "Batch apply"): the
// queued applications open in the student's own window, each in its own
// background tab, at most WINDOW filling at once; as one finishes, the next
// queued one opens. A finished tab goes into one of two tab groups, "Ready"
// (every field it needs shows an answer) or "Needs you", and moves between
// them as the content script reports a change (content-script.js,
// "batch/state"). The extension never submits: the student reviews each tab
// and presses the employer's own Submit.
//
// The queue, its order and each application's stage stay the API's: the
// next one is GET .../applications/next, skipping the jobs this batch has
// opened, and a tab's state is PUT .../applications/{job}/fill (needs_you
// moves the application to needs_you, ready back to queued). What only the
// browser knows (which tab shows which job, which tabs are still filling,
// the two groups) is kept in chrome.storage.local, since Chrome stops this
// worker after ~30 seconds idle; every change is driven by an event (a
// message, a closed tab), so a restarted worker carries on from storage.
//
// A BATCH OUTLIVES CHROME (KAN-373). Local storage survives a restart, so
// when Chrome opens again (or Start Auto Apply is pressed after the batch's
// window was closed) the batch resumes: a tab Chrome restored is taken back
// by its link, as it is, never filled again; a job that was still filling is
// filled in its restored tab or opened again; a finished one whose tab is
// gone leaves the batch (its stage is the API's). Then the queue goes on.
//
// THE TABS FILL HIDDEN. KAN-305's runner showed its one tab for the fill,
// after the pre-engine filler left most dropdowns empty in a hidden tab. The
// Fill engine does not: five saved Greenhouse forms, and five live ones,
// filled hidden and at once gave the same fields as each filled in turn while
// shown (checked 2026-10-25, Chromium 1248). So no tab is ever made active,
// and the student stays on the page they were on.

import { ApiError, finishApplication, me, nextApplication, recordFill } from "./api.js";
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
 * @typedef {"filling" | "ready" | "needs_you"} TabState
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
  return (await chrome.storage.local.get(BATCH_KEY))[BATCH_KEY] ?? null;
}

function save(batch) {
  return chrome.storage.local.set({ [BATCH_KEY]: batch });
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
    const windowId = sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
    let batch = await load();
    if (batch) await resume(batch, windowId);
    // A batch with no tab left has ended: the next one starts afresh.
    if (!batch || !Object.keys(batch.tabs).length) batch = { windowId, tabs: {}, opened: [], groups: {} };
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

/**
 * Chrome started: a batch that had tabs when it closed resumes (resume), in
 * the window its restored tabs are in, else the last one the student used.
 */
export function resumeBatch() {
  return serially(async () => {
    const batch = await load();
    if (!batch || !Object.keys(batch.tabs).length) return;
    const window = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null);
    await resume(batch, window?.id);
    let account;
    try {
      account = await me();
    } catch (error) {
      console.warn("[batch] the batch didn't resume:", error.message);
      return;
    }
    await topUp(batch, account.id);
  });
}

/**
 * Brings the saved batch up to the tabs that exist now. A tab id that is gone
 * (the student closed the window, or Chrome restarted) is looked for by its
 * link among the open tabs, which is where Chrome restores it: found, the job
 * keeps its state and group in that tab, and its fill starts again only if it
 * never finished. Not found, a job still filling opens again; a finished one
 * leaves the batch. `windowId` is where reopened and new tabs go when the
 * batch's own window is gone.
 * @param {Batch} batch
 * @param {number | undefined} windowId
 */
async function resume(batch, windowId) {
  const open = await chrome.tabs.query({});
  const live = new Set(open.map((t) => t.id));
  const taken = new Set(Object.keys(batch.tabs).map(Number).filter((id) => live.has(id)));
  const reopen = [];
  for (const [id, tab] of Object.entries(batch.tabs)) {
    if (live.has(Number(id))) continue;
    delete batch.tabs[id];
    const back = open.find((t) => !taken.has(t.id) && (t.url || t.pendingUrl) === tab.url);
    if (!back) {
      if (tab.state === "filling") reopen.push(tab);
      continue;
    }
    taken.add(back.id);
    batch.tabs[back.id] = tab;
    batch.windowId = back.windowId;
    // A restored tab is discardable again.
    await chrome.tabs.update(back.id, { autoDiscardable: false });
    if (tab.state === "filling") startFill(back.id);
    else await moveToGroup(batch, back.id, tab.state);
  }
  if (!(await chrome.windows.get(batch.windowId).catch(() => null)) && windowId !== undefined) batch.windowId = windowId;
  await save(batch);
  for (const tab of reopen) await openTab(batch, tab.jobId, tab.url);
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
  // The student closed the batch's window: it waits for resume(), never a window they didn't pick.
  if (!(await chrome.windows.get(batch.windowId).catch(() => null))) return;
  const filling = () => Object.values(batch.tabs).filter((t) => t.state === "filling").length;
  while (filling() < WINDOW) {
    const application = await nextApplication(applicantId, batch.opened);
    if (!application) break;
    const jobId = application.job.id;
    // The form, not the job's page, where the two differ (a Lever posting's form is at .../apply).
    batch.opened.push(jobId);
    await openTab(batch, jobId, formUrl(application.job.apply_url));
  }
  await save(batch);
}

/**
 * Opens one job's form in a new hidden tab of the batch's window, kept from
 * being discarded, and starts its fill once it loads (not awaited here).
 * @param {Batch} batch
 * @param {string} jobId
 * @param {string} url
 */
async function openTab(batch, jobId, url) {
  const tab = await chrome.tabs.create({ url, active: false, windowId: batch.windowId });
  // Memory Saver must never throw away a form the student hasn't reviewed.
  await chrome.tabs.update(tab.id, { autoDiscardable: false });
  batch.windowId = tab.windowId;
  batch.tabs[tab.id] = { jobId, url, state: "filling" };
  await save(batch);
  startFill(tab.id);
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
    if (!tab || tab.state === state) return { batch: Boolean(tab) };
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

/**
 * A closed batch tab leaves the batch; a filling one frees its place for the
 * next. Tabs closed with their window stay, for resume() to find again (the
 * student may reopen the window, or Chrome restore it).
 * @param {number} tabId
 * @param {{ isWindowClosing?: boolean }} [removeInfo]
 */
export function forgetTab(tabId, removeInfo = {}) {
  if (removeInfo.isWindowClosing) return Promise.resolve();
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

/**
 * The student pressed Skip in a batch tab (content-script.js): the
 * application is skipped (POST .../finish), its tab closes and leaves the
 * batch, and the batch goes on with the next queued one. A failed finish
 * leaves the tab as it was, so the student can press Skip again.
 * @param {number} tabId
 */
export function skipTab(tabId) {
  return serially(async () => {
    const batch = await load();
    const tab = batch?.tabs[tabId];
    if (!tab) return { batch: false };
    const account = await me();
    await finishApplication(account.id, tab.jobId, "skipped");
    delete batch.tabs[tabId];
    await save(batch);
    await chrome.tabs.remove(tabId).catch(() => {});
    await topUp(batch, account.id);
    return { batch: true };
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

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
//
// A PRACTICE BATCH (KAN-378) is onboarding's: the same tabs and groups on
// WorkIt's own practice forms (engine.js, `practiceJob`), whose links the
// webapp sends (each checked to be a practice form on the sender's own
// site). It has no queue or stages in the API: its jobs and which ones the
// student submitted are kept in the batch itself (`practice`), and a tab
// that reaches the job's /thanks page is submitted (background.js).
// Starting a real batch ends a practice one.

import {
  answerBank, ApiError, askQuestions, finishApplication, getAutofillProfile, me, nextApplication, queuedApplications, recordFill, recordSentResume,
} from "./api.js";
import { formUrl, practiceJob, questionsToWrite } from "./engine.js";
import { jobBoard } from "./job-boards.js";
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
 *   practice?: { jobs: { jobId: string, url: string }[], submitted: string[] },
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
    if (!batch || batch.practice) batch = { windowId: sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT, tabs: {}, opened: [], groups: {} };
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

// The queued jobs whose questions writeEarly has read (or found it can't), for this browser session.
const EARLY_KEY = "workit_written_early";

/**
 * Write early (KAN-379; design decision 6): once jobs are queued (the
 * webapp's `run/open`), reads each queued application's questions from its
 * form's link, with no tab, oldest first, and sends the ones its form needs
 * written to the API (PUT .../questions, as its tab would), so the student's
 * Claude can write them before its tab opens. Planned with the student's
 * saved answers, as the tab plans them: a question answered before is not
 * sent (its answer bank, GET .../answer-bank), so an application whose
 * questions are all answered never reaches their Claude. Jobs the batch has opened are their tabs' own; a job board's
 * link is passed over; a form that shows its questions only once open
 * (Workday, Eightfold) waits for its tab. Each job is read once per session.
 * @param {{ fetchText: Function, today: string }} options
 */
export async function writeEarly({ fetchText, today }) {
  const account = await me();
  const [applications, profile] = await Promise.all([queuedApplications(account.id), getAutofillProfile()]);
  const done = new Set((await chrome.storage.session.get(EARLY_KEY))[EARLY_KEY] ?? []);
  const opened = new Set((await load())?.opened ?? []);
  // The list is newest first; the student's Claude takes the oldest first.
  for (const application of [...applications].reverse()) {
    const jobId = application.job.id;
    if (done.has(jobId) || opened.has(jobId) || application.open === false) continue;
    const link = application.job.form_url ?? application.job.apply_url;
    if (!jobBoard(link)) {
      const bank = await answerBank(account.id, jobId).catch(() => ({}));
      const questions = await questionsToWrite({ url: formUrl(link), profile, bank, today, fetchText }).catch(() => null);
      if (questions?.length) {
        await askQuestions(account.id, jobId, questions).catch((error) => console.warn("[batch] questions not sent early:", error.message));
      }
    }
    done.add(jobId);
    await chrome.storage.session.set({ [EARLY_KEY]: [...done] });
  }
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
    const application = batch.practice ? nextPractice(batch) : await nextApplication(applicantId, batch.opened);
    if (!application) break;
    const jobId = application.job.id;
    // The employer's form the API names (a job board's posting is taken only through it, KAN-376).
    const link = application.job.form_url ?? application.job.apply_url;
    if (jobBoard(link)) {
      // Never a job board's page, whatever the API says: this batch passes it over.
      console.warn(`[batch] not opened: ${jobBoard(link)} is a job board, and batch apply opens only an employer's own form`);
      batch.opened.push(jobId);
      continue;
    }
    // The form, not the job's page, where the two differ (a Lever posting's form is at .../apply).
    const url = formUrl(link);
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
    if (batch.practice) {
      if (wasFilling) await topUp(batch, null);
      return { batch: true };
    }
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
    // A practice form is no application (its submit is submitPractice's).
    if (!tab || batch.practice || tab.state === "applied") return { batch: Boolean(tab) };
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
      await topUp(batch, batch.practice ? null : (await me()).id);
    } catch (error) {
      console.warn("[batch] the next application didn't open:", error.message);
    }
  });
}

/**
 * The job a batch tab shows, for its written answers (KAN-377), or null for
 * a tab outside the batch, or a practice one: a practice job has no
 * application at WorkIt, so its essays stay the student's.
 */
export async function jobInTab(tabId) {
  const batch = await load();
  return batch?.practice ? null : batch?.tabs[tabId]?.jobId ?? null;
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

// Where "Next Thing That Needs You" last went: { tabId, key, index }, index
// being the key's place among its tab's flagged rows then.
const CURSOR_KEY = "workit_batch_next";

/**
 * "Next Thing That Needs You" (the overlay's button in a batch tab, KAN-375):
 * goes to the first thing that needs the student after the last one it went
 * to, walking the batch's tabs in the order they opened and each tab's
 * flagged fields in page order (each tab's content script names them,
 * "batch/flags"). It switches to that tab and has it show the field
 * ("batch/focus"). A tab with no content script to answer (nothing was
 * filled there) is one thing, the page itself. Past the last one it answers
 * `done`, and the next press starts again from the first. Fields the student
 * fixed meanwhile are no longer flagged, so they are passed over.
 * @returns {Promise<{ done: true } | { done: false, tabId: number, key: string | null }>}
 */
export async function nextNeedsYou() {
  const batch = await liveBatch();
  const order = Object.entries(batch?.tabs ?? {})
    .sort(([, a], [, b]) => batch.opened.indexOf(a.jobId) - batch.opened.indexOf(b.jobId))
    .map(([id, tab]) => ({ tabId: Number(id), state: tab.state }));
  const things = [];
  for (const [place, { tabId, state }] of order.entries()) {
    const answer = await chrome.tabs.sendMessage(tabId, { type: "batch/flags" }).catch(() => null);
    if (answer) answer.keys.forEach((key, index) => things.push({ place, tabId, key, index }));
    else if (state === "needs_you") things.push({ place, tabId, key: null, index: 0 });
  }
  const cursor = (await chrome.storage.session.get(CURSOR_KEY))[CURSOR_KEY];
  const from = cursor ? order.findIndex((t) => t.tabId === cursor.tabId) : -1;
  const stillThere = cursor && things.some((t) => t.tabId === cursor.tabId && t.key === cursor.key);
  const next = !cursor || from < 0 ? things[0] : things.find((t) =>
    t.place > from || (t.place === from && (stillThere ? t.index > things.find((c) => c.tabId === cursor.tabId && c.key === cursor.key).index : t.index >= cursor.index)));
  if (!next) {
    await chrome.storage.session.remove(CURSOR_KEY);
    return { done: true };
  }
  await chrome.storage.session.set({ [CURSOR_KEY]: { tabId: next.tabId, key: next.key, index: next.index } });
  const tab = await chrome.tabs.update(next.tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  if (next.key !== null) await chrome.tabs.sendMessage(next.tabId, { type: "batch/focus", key: next.key }).catch(() => {});
  return { done: false, tabId: next.tabId, key: next.key };
}

/**
 * Onboarding's practice batch (`practice/open`): opens the practice forms
 * `message.urls` names, as a batch's tabs, in the window of the WorkIt tab
 * that asked. Only practice forms on that tab's own site are taken. A
 * practice batch with tabs open is kept as it is; a real batch with tabs
 * open is never mixed with one.
 * @param {chrome.runtime.MessageSender} sender
 * @param {{ urls?: unknown }} message
 * @returns {Promise<
 *   | { opened: true, jobIds: string[], fill: "started" | "kept" }
 *   | { opened: false, reason: "signed_out" | "batch_running" }
 * >}
 */
export async function startPractice(sender, message) {
  const origin = sender.origin ?? new URL(sender.url).origin;
  const urls = Array.isArray(message?.urls) ? message.urls : [];
  const jobs = urls
    .filter((url) => typeof url === "string" && practiceJob(url)?.page === "apply" && new URL(url).origin === origin)
    .map((url) => ({ jobId: practiceJob(url).job, url }));
  if (!jobs.length) throw new Error("No practice form to open");
  // The fill reads the student's profile: a signed-out student would get empty forms.
  try {
    await me();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { opened: false, reason: "signed_out" };
    throw error;
  }
  return serially(async () => {
    const live = await liveBatch();
    const open = (batch) => Object.values(batch.tabs).map((t) => t.jobId);
    if (live && open(live).length) {
      return live.practice ? { opened: true, jobIds: open(live), fill: "kept" } : { opened: false, reason: "batch_running" };
    }
    const batch = { windowId: sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT, tabs: {}, opened: [], groups: {}, practice: { jobs, submitted: [] } };
    await topUp(batch, null);
    return { opened: true, jobIds: open(batch), fill: "started" };
  });
}

/** The practice batch's next job not yet opened, as GET .../applications/next answers one. */
function nextPractice(batch) {
  const job = batch.practice.jobs.find((j) => !batch.opened.includes(j.jobId));
  return job ? { job: { id: job.jobId, apply_url: job.url } } : null;
}

/**
 * The student pressed a practice form's Submit (its tab reached /thanks):
 * the job is submitted, and its tab leaves the batch and its group, as a
 * submitted application's does. Tabs outside a practice batch are ignored.
 * @param {number} tabId
 */
export function submitPractice(tabId) {
  return serially(async () => {
    const batch = await load();
    const tab = batch?.tabs[tabId];
    if (!batch?.practice || !tab) return;
    delete batch.tabs[tabId];
    if (!batch.practice.submitted.includes(tab.jobId)) batch.practice.submitted.push(tab.jobId);
    await save(batch);
    await chrome.tabs.ungroup(tabId).catch(() => {});
    if (tab.state === "filling") await topUp(batch, null);
  });
}

/**
 * Where each practice job is, for onboarding's practice step: "waiting"
 * (not opened yet), "filling", "ready", "needs_you", "submitted", or
 * "closed" (its tab was closed before Submit). Empty with no practice batch.
 * @returns {Promise<{ jobs: { jobId: string, state: string }[] }>}
 */
export async function practiceStatus() {
  const batch = await liveBatch();
  if (!batch?.practice) return { jobs: [] };
  const shown = new Map(Object.values(batch.tabs).map((t) => [t.jobId, t.state]));
  const stateOf = (jobId) =>
    batch.practice.submitted.includes(jobId) ? "submitted" : (shown.get(jobId) ?? (batch.opened.includes(jobId) ? "closed" : "waiting"));
  return { jobs: batch.practice.jobs.map(({ jobId }) => ({ jobId, state: stateOf(jobId) })) };
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

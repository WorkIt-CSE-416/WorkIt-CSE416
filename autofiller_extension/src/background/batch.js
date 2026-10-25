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
// WORKDAY TAKES ONE SLOT (KAN-373). A Workday application runs over many
// pages, each waiting on the student (sign-in, then Save and Continue), so
// at most one is in the batch at a time. A queued Workday job met while one
// is open waits in `held` (left out of the queue reads) and opens as soon as
// that one leaves the batch (closed, skipped, or no longer in a fill state,
// e.g. submitted); the other job systems keep filling beside it.
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

import { ApiError, finishApplication, getAutofillProfile, me, nextApplication, recordFill, recordSentResume } from "./api.js";
import { formUrl, jobOf, practiceJob } from "./engine.js";
import { jobBoard } from "./job-boards.js";
import { injectFill } from "../shared/content-scripts.js";
import { liveBatch, load, save, serially } from "./batch-store.js";

/** @typedef {import("./batch-store.js").Batch} Batch @typedef {import("./batch-store.js").TabState} TabState */

/** At most this many tabs fill at once. */
export const WINDOW = 5;
// The two groups, coloured from Chrome's fixed palette as near WorkIt's own
// status colours as it goes: positive green, warning orange.
const GROUPS = {
  ready: { title: "Ready", color: "green" },
  needs_you: { title: "Needs you", color: "orange" },
};
const LOAD_TIMEOUT_MS = 30_000;
const FORM_TIMEOUT_MS = 10_000;

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
    if (batch && !batch.practice) await resume(batch, windowId);
    // A batch with no tab left has ended, and a practice one ends here: the next one starts afresh.
    if (!batch || batch.practice || !Object.keys(batch.tabs).length) batch = { windowId, tabs: {}, opened: [], groups: {} };
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
  batch.held ??= [];
  while (filling() < WINDOW) {
    if (!batch.practice && batch.held.length && !workdayOpen(batch)) {
      const { jobId, url } = batch.held.shift();
      batch.opened.push(jobId);
      await openTab(batch, jobId, url);
      continue;
    }
    const application = batch.practice
      ? nextPractice(batch)
      : await nextApplication(applicantId, [...batch.opened, ...batch.held.map((h) => h.jobId)]);
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
    if (isWorkday(url) && workdayOpen(batch)) {
      batch.held.push({ jobId, url });
      continue;
    }
    batch.opened.push(jobId);
    await openTab(batch, jobId, url);
  }
  await save(batch);
}

const isWorkday = (url) => jobOf(url)?.site === "workday";
const FILL_STATES = ["filling", "ready", "needs_you", "failed"];

/** Whether a Workday application holds the batch's one Workday slot. */
function workdayOpen(batch) {
  return Object.values(batch.tabs).some((t) => isWorkday(t.url) && FILL_STATES.includes(t.state));
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
 * Waits for the tab's page and its form, then injects the fill. A site the
 * extension may not touch (a job system with no Filler) fills nothing and
 * needs the student; a job system's page that never loads, shows no form or
 * takes no fill has failed.
 * @param {number} tabId
 */
async function startFill(tabId) {
  try {
    await waitForLoad(tabId);
    // A Workday posting shows no form until the student presses Apply and signs in: its fill waits for them.
    const workday = isWorkday((await chrome.tabs.get(tabId)).url ?? "");
    const [{ result: found }] = await chrome.scripting.executeScript({ target: { tabId }, func: waitForForm, args: [workday ? 0 : FORM_TIMEOUT_MS] });
    if (!found && !workday) throw new Error("no_form");
    await injectFill(tabId, { batch: true });
  } catch (error) {
    console.warn("[batch] nothing was filled:", error.message);
    const url = (await chrome.tabs.get(tabId).catch(() => null))?.url ?? "";
    await setTabState(tabId, jobOf(url) ? "failed" : "needs_you");
  }
}

/**
 * A batch tab's new state, from its content script or from startFill: the
 * tab moves to its group (a failed one to Needs you) and the application's
 * stage follows (needs_you, failed included, or queued while ready). A tab
 * that was filling frees its place, and the next queued application opens.
 * Tabs outside the batch are ignored.
 * @param {number} tabId
 * @param {"ready" | "needs_you" | "failed"} state
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
    const group = state === "failed" ? "needs_you" : state;
    await moveToGroup(batch, tabId, group);
    if (batch.practice) {
      if (wasFilling) await topUp(batch, null);
      return { batch: true };
    }
    let account = null;
    try {
      account = await me();
      await recordFill(account.id, tab.jobId, group);
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
    // A submitted Workday application frees the Workday slot too.
    if (wasFilling || isWorkday(tab.url)) await topUp(batch, account.id);
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
    // A Workday tab frees the Workday slot.
    if (tab.state !== "filling" && !isWorkday(tab.url)) return;
    try {
      await topUp(batch, batch.practice ? null : (await me()).id);
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
    // A practice job has no application at WorkIt: its tab just closes.
    const account = batch.practice ? null : await me();
    if (account) await finishApplication(account.id, tab.jobId, "skipped");
    delete batch.tabs[tabId];
    await save(batch);
    await chrome.tabs.remove(tabId).catch(() => {});
    await topUp(batch, account?.id ?? null);
    return { batch: true };
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

/**
 * A batch tab's written questions are waiting for the student's Claude
 * (`writing: true`, once sent), or are all answered (`writing: false`;
 * `byClaude`: some of them by Claude). Answers whether this was the batch's
 * last tab waiting, in a batch Claude wrote for: the moment to ask for
 * writing samples (KAN-387). Tabs outside the batch answer false.
 * @param {number} tabId
 * @param {{ writing: boolean, byClaude?: boolean }} change
 */
export function setWriting(tabId, { writing, byClaude = false }) {
  return serially(async () => {
    const batch = await liveBatch();
    if (!batch?.tabs[tabId]) return false;
    const others = (batch.writing ?? []).filter((id) => id !== String(tabId) && batch.tabs[id]);
    batch.writing = writing ? [...others, String(tabId)] : others;
    batch.wroteWithClaude ||= byClaude;
    await save(batch);
    return !writing && !others.length && batch.wroteWithClaude;
  });
}

/** The batch's open tabs, for news every tab acts on (the student's saved self-identification, KAN-387). */
export async function batchTabIds() {
  return Object.keys((await load())?.tabs ?? {}).map(Number);
}

/** Whether a tab is one of the batch's, for a fill injected again (Workday's next page). */
export async function inBatch(tabId) {
  return Boolean((await load())?.tabs[tabId]);
}

/**
 * Which job postings the batch's tabs show (`jobIds`, in the order they
 * opened; `jobId` the first), for the webapp's "Working in Browser", and
 * each one's tab state (`jobs`).
 * @returns {Promise<{ jobId: string | null, jobIds: string[], jobs: { jobId: string, state: TabState }[] }>}
 */
export async function batchStatus() {
  const batch = await liveBatch();
  const jobs = Object.values(batch?.tabs ?? {}).map((t) => ({ jobId: t.jobId, state: t.state }));
  const jobIds = jobs.map((j) => j.jobId);
  return { jobId: jobIds[0] ?? null, jobIds, jobs };
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
    else if (state === "needs_you" || state === "failed") things.push({ place, tabId, key: null, index: 0 });
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

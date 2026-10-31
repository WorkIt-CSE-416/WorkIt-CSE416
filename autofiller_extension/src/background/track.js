// Track on WorkIt (KAN-424): a job form the student opened themselves (not
// a batch tab) whose job WorkIt lists. Track saves the job to their
// Applications (it keeps any stage it already has) and keeps the tab as
// tracked; the student's submit there then marks it applied, by the same
// proof a batch tab's submit needs (submit-proof.js: the job system's own
// answer to the submit request, or the page's hint where none is recorded).
// The extension never submits.
//
// The tracked tabs live in chrome.storage.session ({ [tabId]: { jobId, id,
// applied } }): the tab and its job's identity (the Fill engine's jobOf, as
// the job card matches a page to a posting). A tab that moves on to another
// job's page stops being tracked, so its next submit can't mark the wrong
// job; a thanks or confirmation page names no job and keeps it.
//
// A tab the student asked their Claude to write for (KAN-470, openForWriting)
// is tracked too, with `writing`: its job has an application, which keeps the
// questions for the student's Claude and the Written Answers page.
import { ApiError, listedJobByLink, markJobApplied, me, queueJob, recordFill, saveJob } from "./api.js";
import { inBatch } from "./batch.js";
import { identity } from "./panel-top.js";

const KEY = "tracked_tabs";
// A student's stage once they applied: the tab offers nothing more.
const APPLIED = ["applied", "interviewing", "offer", "rejected"];

async function all() {
  return (await chrome.storage.session.get(KEY))[KEY] ?? {};
}

async function put(tabs) {
  await chrome.storage.session.set({ [KEY]: tabs });
}

/** Whether tab `tabId` is tracked (not yet marked applied). */
export async function isTracked(tabId) {
  const tab = (await all())[tabId];
  return Boolean(tab && !tab.applied);
}

/**
 * What the panel offers on this tab: "batch" (a batch tab: batch apply
 * tracks it), "tracked", "applied" (WorkIt already has it applied),
 * "trackable" (WorkIt lists the job; Track on WorkIt) or "unlisted"
 * (nothing to track). A signed-out student or an API that can't answer is
 * "unlisted": the panel shows nothing rather than a button that fails.
 * @param {{ tabId: number, url: string }} where
 */
export async function trackState({ tabId, url }) {
  if (await inBatch(tabId)) return { state: "batch" };
  const tab = (await all())[tabId];
  if (tab) return { state: tab.applied ? "applied" : "tracked" };
  if (!identity(url)) return { state: "unlisted" };
  try {
    const found = await listedJobByLink(url);
    return { state: APPLIED.includes(found.stage) ? "applied" : "trackable" };
  } catch {
    return { state: "unlisted" };
  }
}

/** The student's Track on WorkIt: saves the job and keeps the tab as tracked. Throws when WorkIt doesn't list it. */
export async function track({ tabId, url }) {
  const found = await listedJobByLink(url);
  await saveJob(found.job_id);
  const tabs = await all();
  // A tab opened for writing (openForWriting) stays one.
  const writing = tabs[tabId]?.jobId === found.job_id && tabs[tabId].writing;
  tabs[tabId] = { jobId: found.job_id, id: identity(url), applied: APPLIED.includes(found.stage), ...(writing ? { writing } : {}) };
  await put(tabs);
  return { state: tabs[tabId].applied ? "applied" : "tracked" };
}

/**
 * A tracked tab's submit, proven (submit-proof.js): marks its job applied,
 * once. `{ tracked: false }` for any other tab.
 * @param {number} tabId
 */
export async function markTracked(tabId) {
  const tabs = await all();
  const tab = tabs[tabId];
  if (!tab) return { tracked: false };
  if (!tab.applied) {
    await markJobApplied(tab.jobId);
    tabs[tabId] = { ...tab, applied: true };
    await put(tabs);
  }
  return { tracked: true };
}

const UNLISTED = "WorkIt doesn't list this job, so your Claude can't write for it here. Write this answer yourself.";

/**
 * The student asked their Claude to write a form's questions on a tab they
 * opened themselves (KAN-470). Their Claude (through the connector) and the
 * Written Answers page keep the questions on an application, as a batch
 * tab's, so the job is queued (a saved one too), then moved to needs_you at
 * once so the batch never opens it, and the tab is tracked: the student's
 * submit there marks it applied. Answers the job's id. Throws, with words
 * for the student, when WorkIt doesn't list the job or its application is
 * past the form (applied, skipped).
 * @param {{ tabId: number, url: string }} where
 * @returns {Promise<string>}
 */
export async function openForWriting({ tabId, url }) {
  const known = (await all())[tabId];
  if (known?.writing && !known.applied) return known.jobId;
  let found;
  try {
    found = await listedJobByLink(url);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) throw new Error(UNLISTED);
    throw error;
  }
  const { id } = await me();
  const { stage } = await queueJob(id, found.job_id);
  if (stage !== "queued" && stage !== "needs_you") {
    throw new Error(`Your application for this job is ${stage.replace("_", " ")}, so WorkIt can't keep answers for it. Write this answer yourself.`);
  }
  if (stage === "queued") await recordFill(id, found.job_id, "needs_you");
  const tabs = await all();
  tabs[tabId] = { jobId: found.job_id, id: identity(url), applied: false, writing: true };
  await put(tabs);
  return found.job_id;
}

/** The job of a tab opened for writing (openForWriting) and not yet marked applied, or null. */
export async function writingJob(tabId) {
  const tab = (await all())[tabId];
  return tab?.writing && !tab.applied ? tab.jobId : null;
}

/** A tracked tab whose page is now another job's stops being tracked; a page that names no job keeps it. */
export async function followTrackedTab(tabId, url) {
  const tabs = await all();
  const tab = tabs[tabId];
  const id = identity(url);
  if (!tab || !id || id === tab.id) return;
  delete tabs[tabId];
  await put(tabs);
}

/** Forgets a closed tab. */
export async function forgetTracked(tabId) {
  const tabs = await all();
  if (!(tabId in tabs)) return;
  delete tabs[tabId];
  await put(tabs);
}

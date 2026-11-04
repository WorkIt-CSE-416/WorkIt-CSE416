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
//
// A tab the extension filled and nobody tracked yet (KAN-589, noteFilled) is
// kept too, with `filled`, the form's `url` and no `jobId`: its proven submit
// finds the job (the listed job by its link, else an added job by link, as
// Apply's record_applied does) and marks it applied. Track on WorkIt still
// shows on it for a listed job.
import { addJobByLink, ApiError, listedJobByLink, markJobApplied, me, queueJob, recordFill, saveJob } from "./api.js";
import { inBatch } from "./batch.js";
import { jobNamesOf } from "./engine.js";
import { fetchText } from "./plan-reads.js";
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
  if (tab?.applied) return { state: "applied" };
  if (tab?.jobId) return { state: "tracked" };
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
    const found = tab.jobId ? { job_id: tab.jobId } : await jobOfFilled(tab.url);
    if (!APPLIED.includes(found.stage)) await markJobApplied(found.job_id);
    tabs[tabId] = { ...tab, jobId: found.job_id, applied: true };
    await put(tabs);
  }
  return { tracked: true };
}

/**
 * A form the extension filled on a tab nobody tracks (KAN-589): kept, so its
 * submit, proven, puts the job on the student's Applications Tracker as
 * applied (markTracked). Writes nothing at WorkIt. A tab already kept stays
 * as it is.
 * @param {{ tabId: number, url: string }} where
 */
export async function noteFilled({ tabId, url }) {
  const tabs = await all();
  if (tabs[tabId]) return;
  tabs[tabId] = { url, id: identity(url), applied: false, filled: true };
  await put(tabs);
}

/**
 * The job of a filled tab's form at `url` (KAN-589): the listed job by its
 * link, else the job added by link (POST /jobs/added-by-link with
 * `track_only`, ADR 0008), its company and title as the Fill engine reads
 * them from the job system. Answers its id and the student's stage.
 * @param {string} url
 */
async function jobOfFilled(url) {
  try {
    return await listedJobByLink(url);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
  const names = await jobNamesOf(url, fetchText).catch(() => null);
  const company = names?.company?.trim();
  const title = names?.title?.trim();
  if (!company || !title) throw new Error("WorkIt doesn't list this job, and the page names no company or title.");
  return addJobByLink({ url, company, title, track_only: true });
}

const UNLISTED = "WorkIt doesn't list this job, and couldn't read its company and title from the page. Write this answer yourself.";
const PAST_FORM = (stage) => `Your application for this job is ${stage.replace("_", " ")}, so WorkIt can't keep answers for it. Write this answer yourself.`;

/**
 * A job WorkIt doesn't list (KAN-515): added from the page, its company and
 * title as the Fill engine reads them from the job system, with the student's
 * application at needs_you (POST /jobs/added-by-link). The added job is the
 * student's alone: no Jobs feed shows it. Answers its id and stage; throws,
 * with words for the student, when the page names no company or title, or
 * with WorkIt's own when it refuses the form (a job system turned off, past
 * a day's adds).
 * @param {string} url
 */
async function addFromPage(url) {
  // The job system's API, as a Plan reads it (Ashby's is a POST).
  const names = await jobNamesOf(url, fetchText).catch(() => null);
  const company = names?.company?.trim();
  const title = names?.title?.trim();
  if (!company || !title) throw new Error(UNLISTED);
  return addJobByLink({ url, company, title });
}

/**
 * The student asked their Claude to write a form's questions on a tab they
 * opened themselves (KAN-470). Their Claude (through the connector) and the
 * Written Answers page keep the questions on an application, as a batch
 * tab's, so the job is queued (a saved one too), then moved to needs_you at
 * once so the batch never opens it, and the tab is tracked: the student's
 * submit there marks it applied. A job WorkIt doesn't list is added from the
 * page with its application at needs_you (addFromPage, KAN-515). Answers the
 * job's id. Throws, with words for the student, when the job can't be added
 * or its application is past the form (applied, skipped).
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
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
  if (found) {
    const { id } = await me();
    const { stage } = await queueJob(id, found.job_id);
    if (stage !== "queued" && stage !== "needs_you") throw new Error(PAST_FORM(stage));
    if (stage === "queued") await recordFill(id, found.job_id, "needs_you");
  } else {
    found = await addFromPage(url);
    if (found.stage !== "needs_you") throw new Error(PAST_FORM(found.stage));
  }
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

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
import { listedJobByLink, markJobApplied, saveJob } from "./api.js";
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
  tabs[tabId] = { jobId: found.job_id, id: identity(url), applied: APPLIED.includes(found.stage) };
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

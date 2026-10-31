// The toolbar popup off job pages (KAN-424): what the student is doing, so
// the popup can offer the one next step. During a batch, its tabs' states
// and Go to Next Job; with no batch, the queue and Start Auto Apply; with an
// empty queue, Find Jobs (popup.js draws each). Start is the webapp's own
// `run/open` (batch.js startBatch), pressed from the extension instead.
import { me, queuedApplications } from "./api.js";
import { batchStatus, showBatchTab } from "./batch.js";

/**
 * `{ batch: { total, ready, needs, filling }, queued }`: the batch's open
 * tabs by state, and how many queued applications it hasn't opened. A
 * queue that can't be read counts as unknown (null), never as empty.
 */
export async function popupHome() {
  const status = await batchStatus();
  const count = (...states) => status.jobs.filter((job) => states.includes(job.state)).length;
  const batch = { total: status.jobs.length, ready: count("ready"), needs: count("needs_you", "failed"), filling: count("filling") };
  let queued = null;
  try {
    const account = await me();
    const opened = new Set(status.jobIds);
    queued = (await queuedApplications(account.id)).filter((application) => application.open !== false && !opened.has(application.job.id)).length;
  } catch {
    // Unknown: the popup says nothing about the queue rather than "empty".
  }
  return { batch, queued };
}

/** Go to Next Job: the batch's first tab that needs the student, else its first ready one. */
export async function showNextJob() {
  const status = await batchStatus();
  const next = status.jobs.find((job) => job.state === "needs_you" || job.state === "failed") ?? status.jobs.find((job) => job.state === "ready");
  if (!next) return { shown: false };
  return showBatchTab({ jobId: next.jobId });
}

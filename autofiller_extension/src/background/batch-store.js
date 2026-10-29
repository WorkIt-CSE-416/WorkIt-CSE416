// Where batch apply (batch.js) keeps what only the browser knows: which tab
// shows which job, which are still filling, the two groups. It is kept in
// chrome.storage.local, since Chrome stops the worker after ~30 seconds idle
// and a batch outlives Chrome (KAN-373). Every change goes through
// `serially`, one at a time, so two tabs finishing together never read the
// same state.

const BATCH_KEY = "workit_batch";

/**
 * `failed`: the fill itself went wrong (an error, not a question for the
 * student); it sits in the Needs you group, and its application takes the
 * stage a failed fill maps to (needs_you), but the batch keeps it apart.
 * @typedef {"filling" | "ready" | "needs_you" | "failed" | "applied"} TabState
 * @typedef {{
 *   windowId: number,
 *   tabs: Record<string, { jobId: string, url: string, jobType?: string | null, state: TabState }>,
 *   opened: string[],
 *   held?: { jobId: string, url: string, jobType?: string | null }[],
 *   groups: { ready?: number, needs_you?: number },
 *   practice?: { jobs: { jobId: string, url: string }[], submitted: string[] },
 *   writing?: string[], wroteWithClaude?: boolean,
 *   picked?: string[], pickedOnly?: boolean,
 * }} Batch
 * `writing`: the tabs (ids) still waiting for the student's Claude to write;
 * `wroteWithClaude`: an answer it wrote has filled in (KAN-387, the samples ask).
 * `picked`: the jobs the student picked in Up Next, opened first;
 * `pickedOnly`: the batch started from picks, so it opens nothing else (batch.js).
 */

// One change to the batch at a time: two tabs finishing together would
// otherwise each read the same state and open the same next job.
let queue = Promise.resolve();
export function serially(change) {
  const run = queue.then(change, change);
  queue = run.catch(() => {});
  return run;
}

/** @returns {Promise<Batch | null>} */
export async function load() {
  return (await chrome.storage.local.get(BATCH_KEY))[BATCH_KEY] ?? null;
}

export function save(batch) {
  return chrome.storage.local.set({ [BATCH_KEY]: batch });
}

/** The saved batch, without the tabs the student has closed since (the worker may have slept through it). */
export async function liveBatch() {
  const batch = await load();
  if (!batch) return null;
  for (const id of Object.keys(batch.tabs)) {
    if (!(await chrome.tabs.get(Number(id)).catch(() => null))) delete batch.tabs[id];
  }
  return batch;
}

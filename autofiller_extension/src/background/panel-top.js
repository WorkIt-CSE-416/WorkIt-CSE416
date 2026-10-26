// The panel's top (KAN-395; content/panel-top.js draws it): the job card's
// job and the batch line's counts, for the tab that asks.
//
// THE JOB is WorkIt's own posting when WorkIt has an application for it: a
// batch tab's by its job id, any other tab's by its link (the Fill engine's
// jobOf on the page and on the posting's links name the same job). Its
// listing gives the title, company, logo, place and pay, its `match` the
// Match score (the Jobs page's own scoring, GET .../applications?scored=true)
// and its stage whether the student applied. Otherwise, or signed out, the
// Fill engine's read of the posting gives the title and company alone.
//
// THE BATCH LINE counts the batch's open tabs and the ready ones, and says
// whether another tab needs the student (Next tab goes to it).

import { me, scoredApplications } from "./api.js";
import { load } from "./batch-store.js";
import { jobOf, jobNamesOf } from "./engine.js";

// One read of the scored applications serves every tab of a batch opening at once.
const FRESH_MS = 30_000;
let scored = null;

function applications() {
  if (!scored || Date.now() - scored.at > FRESH_MS) {
    const list = me().then(({ id }) => scoredApplications(id));
    scored = { at: Date.now(), list };
    list.catch(() => {
      scored = null;
    });
  }
  return scored.list;
}

/** The job's identity the Fill engine reads off a link, for matching a page to a posting. */
function identity(url) {
  const job = url ? jobOf(url) : null;
  if (!job) return null;
  const { form: _form, onForm: _onForm, ...id } = job;
  return JSON.stringify(Object.entries(id).sort());
}

const sameJob = (pageId, listing) => [listing.form_url, listing.apply_url].some((url) => url && identity(url) === pageId);

/**
 * The job card's job for this tab, or null when nothing names it.
 * @param {{ tabId: number, url: string }} where
 * @returns {Promise<null | { title: string, company: string, logo: string | null, location: string | null,
 *   pay: { min: number | null, max: number | null, currency: string | null, period: string | null } | null,
 *   match: number | null, appliedAt: string | null }>}
 */
export async function jobForTab({ tabId, url }) {
  const jobId = (await load())?.tabs[tabId]?.jobId ?? null;
  const pageId = identity(url);
  const list = await applications().catch(() => []);
  const found = (Array.isArray(list) ? list : []).find((a) => (jobId ? a.job.id === jobId : pageId && sameJob(pageId, a.job)));
  if (found) {
    const job = found.job;
    const min = job.salary_min ?? job.salary ?? null;
    const max = job.salary_max ?? null;
    return {
      title: job.title ?? "",
      company: job.company ?? job.company_name ?? "",
      logo: job.logo_url ?? null,
      location: job.location_label ?? job.location ?? null,
      pay: min !== null || max !== null ? { min, max, currency: job.salary_currency ?? null, period: job.salary_period ?? null } : null,
      match: typeof found.match === "number" ? found.match : null,
      appliedAt: found.stage === "applied" ? (found.applied_at ?? null) : null,
    };
  }
  if (!pageId) return null;
  const names = await jobNamesOf(url).catch(() => null);
  if (!names?.title && !names?.company) return null;
  return { title: names.title, company: names.company, logo: null, location: null, pay: null, match: null, appliedAt: null };
}

const NEEDS_YOU = ["needs_you", "failed"];

/** The tab's batch line: the batch's open tabs, the ready ones, and the next other tab that needs the student. */
async function line(tabId) {
  const batch = await load();
  if (!batch?.tabs[tabId]) return null;
  const ids = Object.keys(batch.tabs).map(Number).sort((a, b) => a - b);
  const ready = ids.filter((id) => batch.tabs[id].state === "ready").length;
  // After this tab, then round from the first.
  const after = [...ids.filter((id) => id > tabId), ...ids.filter((id) => id < tabId)];
  const next = after.find((id) => NEEDS_YOU.includes(batch.tabs[id].state)) ?? null;
  return { ready, total: ids.length, next };
}

/** The batch line's counts for the tab (null outside a batch). */
export async function batchLine(tabId) {
  const found = await line(tabId);
  return found && { ready: found.ready, total: found.total, next: found.next !== null };
}

/** Next tab: the batch's next other tab that needs the student, shown and its window focused. */
export async function showNextTab(tabId) {
  const found = await line(tabId);
  if (found?.next == null) return { shown: false };
  const tab = await chrome.tabs.update(found.next, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return { shown: true };
}

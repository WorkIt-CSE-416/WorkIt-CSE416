// The panel's Résumé tab (KAN-399; content/resume-tab.js draws it): which
// résumé a tab's form gets, the others the student may switch to, a built
// résumé's Keyword match against the job, and WorkIt's Tailor for the job.
//
// THE ATTACHED RÉSUMÉ is the profile's (My Profile's default), unless the
// student switched this tab to another: that choice is kept per tab in
// chrome.storage.session (`resume_by_tab`, the file itself), and every Plan
// in the tab attaches it (withTabResume), so a reload or Workday's next
// step keeps it, and markSubmitted records it as the sent resume.
//
// A SWITCH on a tab with an open application (queued or needs_you) is also
// saved as the application's sent resume (PUT .../applications/{job}/resume,
// the Auto Apply page's own choice, KAN-359), so WorkIt knows what went out.
//
// THE OTHERS: every uploaded résumé, and the built ones that are a base
// résumé or tailored for this job (a résumé tailored for another job is
// left out).

import { ApiError, builtResumeFile, builtResumes, getAutofillProfile, keywordMatch, me, recordSentResume, uploadedResumeFile, uploadedResumes } from "./api.js";
import { getSession } from "./auth.js";
import { applicationForTab } from "./panel-top.js";

const KEY = "resume_by_tab";
const OPEN = ["queued", "needs_you"];

async function kept() {
  return (await chrome.storage.session.get(KEY))[KEY] ?? {};
}

/** The résumé the student switched this tab to, as the file the engine attaches, or null. */
export async function tabResume(tabId) {
  return (await kept())[tabId] ?? null;
}

/** The profile with this tab's switched résumé in place of the default one. */
export async function withTabResume(profile, tabId) {
  const file = tabId === undefined ? null : await tabResume(tabId);
  return file ? { ...profile, resume: file } : profile;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  kept()
    .then((all) => {
      if (!(tabId in all)) return;
      delete all[tabId];
      return chrome.storage.session.set({ [KEY]: all });
    })
    .catch(() => {});
});

const keyOf = (file) => (file?.uploaded_resume_id ? `uploaded:${file.uploaded_resume_id}` : file?.built_resume_id ? `built:${file.built_resume_id}` : null);

/** Every résumé this tab's job may take, by key, with its name and kind. */
async function options(applicantId, jobId) {
  const [uploads, built] = await Promise.all([uploadedResumes(applicantId), builtResumes(applicantId)]);
  return [
    ...uploads.map((row) => ({ key: `uploaded:${row.id}`, name: row.original_filename || "Resume", kind: "uploaded", row })),
    ...built
      .filter((row) => !row.job_posting_id || row.job_posting_id === jobId)
      .map((row) => ({ key: `built:${row.id}`, name: row.name || "Resume", kind: row.job_posting_id ? "tailored" : "built", row })),
  ];
}

const shown = ({ key, name, kind }) => ({ key, name, kind });

/**
 * The tab's Résumé tab: `attached` (its file name and kind), `others` to
 * switch to, `jobId` when WorkIt has an application for the job, and
 * whether a switch is saved on it (`saves`).
 */
export async function resumeTab({ tabId, url }) {
  const account = await me();
  const application = await applicationForTab({ tabId, url });
  const jobId = application?.job?.id ?? null;
  const file = (await tabResume(tabId)) ?? (await getAutofillProfile().catch(() => null))?.resume ?? null;
  const all = await options(account.id, jobId);
  const key = keyOf(file);
  const mine = all.find((o) => o.key === key);
  return {
    attached: file ? { key, name: file.filename, kind: mine?.kind ?? null } : null,
    others: all.filter((o) => o.key !== key).map(shown),
    jobId,
    saves: Boolean(application && OPEN.includes(application.stage)),
  };
}

/** The attached résumé's file (name, type, base64), for Preview. */
export async function attachedFile(tabId) {
  return (await tabResume(tabId)) ?? (await getAutofillProfile()).resume ?? null;
}

/**
 * Switches the tab to the résumé `key`: kept for the tab, saved as the
 * application's sent resume when it has an open one. Returns the file for
 * the form, or a plain reason it couldn't.
 */
export async function chooseResume({ tabId, url, key }) {
  const account = await me();
  const application = await applicationForTab({ tabId, url });
  const jobId = application?.job?.id ?? null;
  const option = (await options(account.id, jobId)).find((o) => o.key === key);
  if (!option) return { error: "That résumé isn't in WorkIt any more." };
  const file = option.kind === "uploaded" ? await uploadedResumeFile(account.id, option.row) : await builtResumeFile(account.id, option.row);
  if (application && OPEN.includes(application.stage)) {
    const sent = file.uploaded_resume_id ? { uploaded_resume_id: file.uploaded_resume_id } : { built_resume_id: file.built_resume_id };
    try {
      await recordSentResume(account.id, jobId, sent);
    } catch (error) {
      return { error: error instanceof ApiError && error.status < 500 ? error.message : "WorkIt couldn't save your choice. Try again." };
    }
  }
  const all = await kept();
  all[tabId] = file;
  await chrome.storage.session.set({ [KEY]: all });
  return { file: { filename: file.filename, mimeType: file.mimeType, base64: file.base64 } };
}

// The jobs whose keywords WorkIt already read here (chrome.storage.local): the backend caches a posting's
// keywords on its first read, which spends one of the day's Tailor uses, so a later read spends nothing.
const KEYWORDS_READ = "keywords_read_jobs";

/**
 * A built résumé's Keyword match against the tab's job: `matched` and
 * `missing` keywords, or a plain reason. A job read here before is read at
 * once; any other answers `unread` unless `spend` (the student pressed Check
 * keyword match, since the read may spend a Tailor use).
 */
export async function keywordsFor({ tabId, url, key, spend = false }) {
  const [kind, id] = (key ?? "").split(":");
  if (kind !== "built") return { none: true };
  const account = await me();
  const jobId = (await applicationForTab({ tabId, url }))?.job?.id;
  if (!jobId) return { none: true };
  const read = (await chrome.storage.local.get(KEYWORDS_READ))[KEYWORDS_READ] ?? [];
  if (!spend && !read.includes(jobId)) return { unread: true };
  try {
    const match = await keywordMatch(account.id, id, jobId);
    if (!read.includes(jobId)) await chrome.storage.local.set({ [KEYWORDS_READ]: [...read, jobId].slice(-500) });
    const words = (list) => (list ?? []).map((k) => k.keyword);
    return { matched: words(match.matched), missing: words(match.missing) };
  } catch (error) {
    return { error: error instanceof ApiError && error.status < 500 ? error.message : "WorkIt couldn't read this job's keywords. Try again." };
  }
}

/** Opens WorkIt's Tailor for the tab's job, on the site the student signed in on. */
export async function openTailor({ tabId, url }) {
  const session = await getSession();
  const jobId = (await applicationForTab({ tabId, url }))?.job?.id;
  if (!session || !jobId) return { error: "WorkIt doesn't have this job yet." };
  await chrome.tabs.create({ url: `${session.web_origin}/jobs/${encodeURIComponent(jobId)}/tailor`, openerTabId: tabId });
  return {};
}

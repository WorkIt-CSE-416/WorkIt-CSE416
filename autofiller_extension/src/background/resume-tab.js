// The résumé a tab's form gets (KAN-399; content/resume-card.js draws it on
// the Resume/CV row's card, KAN-424): the attached one, the others the
// student may switch to, an upload from the panel, and the job's page on
// WorkIt for the job card. Keyword match and Tailor live on that page now.
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

import { ApiError, builtResumeFile, builtResumes, getAutofillProfile, me, recordSentResume, uploadResume, uploadedResumeFile, uploadedResumes } from "./api.js";
import { TAB_RESUMES_KEY } from "./account-data.js";
import { getSession } from "./auth.js";
import { applicationForTab } from "./panel-top.js";

const KEY = TAB_RESUMES_KEY;
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
  if (!option) return { error: "That resume isn't in WorkIt any more." };
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

/**
 * Upload Resume: the file the student picked in the panel goes to their
 * Resumes (as the Resumes page's upload does) and this tab switches to it.
 * A file they already uploaded isn't saved twice: the tab uses that one.
 */
export async function uploadAndChoose({ tabId, url, file }) {
  const account = await me();
  let id;
  let already = false;
  try {
    id = (await uploadResume(account.id, file)).id;
  } catch (error) {
    if (!(error instanceof ApiError) || !error.resumeId) {
      return { error: error instanceof ApiError && error.status < 500 ? error.message : "WorkIt couldn't upload the resume. Try again." };
    }
    id = error.resumeId;
    already = true;
  }
  const chosen = await chooseResume({ tabId, url, key: `uploaded:${id}` });
  return already && !chosen.error ? { ...chosen, already } : chosen;
}

/** Opens the tab's job on WorkIt (its job page), on the site the student signed in on. */
export async function openJob({ tabId, url }) {
  const session = await getSession();
  const jobId = (await applicationForTab({ tabId, url }))?.job?.id;
  if (!session || !jobId) return { error: "WorkIt doesn't have this job yet." };
  await chrome.tabs.create({ url: `${session.web_origin}/jobs/${encodeURIComponent(jobId)}`, openerTabId: tabId });
  return {};
}

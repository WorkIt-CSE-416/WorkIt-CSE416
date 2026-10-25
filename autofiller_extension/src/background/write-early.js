// Write early (KAN-379; design decision 6), beside batch apply (batch.js):
// the queued applications' written questions go to the API before their
// tabs open, so the student's Claude can write them meanwhile.

import { answerBank, askQuestions, getAutofillProfile, me, queuedApplications } from "./api.js";
import { load } from "./batch-store.js";
import { formUrl, questionsToWrite } from "./engine.js";
import { jobBoard } from "./job-boards.js";

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
      const questions = await questionsToWrite({ url: formUrl(link), profile, bank, today, fetchText, jobType: application.job.job_type }).catch(() => null);
      if (questions?.length) {
        await askQuestions(account.id, jobId, questions).catch((error) => console.warn("[batch] questions not sent early:", error.message));
      }
    }
    done.add(jobId);
    await chrome.storage.session.set({ [EARLY_KEY]: [...done] });
  }
}

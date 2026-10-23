// The fill, run in the application's page (the isolated world) once the
// popup's "Autofill This Page" or the auto-apply runner injects it
// (shared/content-scripts.js's injectFill, which loads the Fill engine into
// the page first). It never submits.
//
// The engine does the work: the background reads the job's Question set and
// plans every answer from the WorkIt profile ("fill/plan"), then fills one
// planned answer at a time ("fill/field"), so the overlay shows each field's
// own result. Questions that need a written answer wait for the student's one
// Generate click, then go to the essay-answer route. On a job system the
// engine doesn't cover, nothing is filled and the overlay says so.
(async function () {
  "use strict";

  const { status, overlay } = window.WIA;
  // The essay-answer route's limits (backend/app/schemas/essay_answer.py).
  const QUESTION_MAX = 500;
  const NAME_MAX = 200;
  const MIN_LENGTH = 50;

  overlay.mount();
  status.reset();

  const prepared = await chrome.runtime.sendMessage({ type: "fill/plan" });
  if (!prepared.ok) {
    status.register("_error", prepared.error || "Could not plan this application", true);
    status.setStatus("_error", "failed", prepared.status === 401 ? "Sign in from the extension popup first." : prepared.error);
    return;
  }
  if (!prepared.covered) {
    status.register("_uncovered", "WorkIt can't fill this job system yet", false);
    status.setStatus("_uncovered", "skipped", "Nothing on this page was filled. WorkIt fills Greenhouse applications for now.");
    return;
  }

  const { site, questions, answers, order, rows, posting } = prepared;
  const byName = new Map(questions.map((q) => [q.name, q]));

  for (const name of order) status.register(name, byName.get(name)?.label ?? name, byName.get(name)?.required ?? false);
  for (const q of rows.written) {
    status.register(q.name, q.label, q.required);
    status.setStatus(q.name, "needs_generation");
  }
  for (const q of rows.yours) {
    status.register(q.name, q.label, q.required);
    status.setStatus(q.name, q.required ? "failed" : "skipped", "WorkIt has no answer for this. Answer it yourself.");
  }
  rows.notes.forEach((note, i) => {
    status.register(`_note${i}`, "Left for you", false);
    status.setStatus(`_note${i}`, "skipped", note);
  });

  /** Fills one answer through the engine and shows how it went. */
  async function fill(name, value) {
    const answer = await chrome.runtime.sendMessage({ type: "fill/field", site, questions, name, value });
    const result = answer.ok ? answer.result : { status: "failed", reason: answer.error };
    status.setStatus(name, result.status, result.reason);
  }

  for (const name of order) await fill(name, answers[name]);

  if (rows.written.length === 0) return;

  overlay.promptForEssays({
    count: rows.written.length,
    onDismiss() {
      for (const { name } of rows.written) status.setStatus(name, "skipped", "You chose to answer this yourself");
    },
    async onGenerate() {
      // One at a time: each is its own counted AI use, and the overlay shows each row as it lands.
      for (const q of rows.written) {
        const box = document.getElementById(q.name);
        const maxLength = box && box.maxLength >= MIN_LENGTH ? box.maxLength : null;
        const result = await chrome.runtime.sendMessage({
          type: "essay/generate",
          applicantId: prepared.applicantId,
          question: q.label.slice(0, QUESTION_MAX),
          companyName: posting.company.slice(0, NAME_MAX) || null,
          jobTitle: posting.title.slice(0, NAME_MAX) || null,
          maxLength,
        });
        if (!result.ok) {
          status.setStatus(q.name, "failed", result.error);
          continue;
        }
        await fill(q.name, result.answer);
      }
    },
  });
})();

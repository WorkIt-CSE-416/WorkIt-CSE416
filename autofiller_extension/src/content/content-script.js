// The fill, run in the application's page (the isolated world) once the
// popup's "Autofill This Page" or the auto-apply runner injects it
// (shared/content-scripts.js's injectFill, which loads the Fill engine into
// the page first). It never submits, and never moves a form in steps on.
//
// The engine does the work: the background reads the job's Question set and
// plans every answer from the WorkIt profile ("fill/plan"), then the engine
// fills the page in its own order ("fill/page") and says how each field
// went, so the overlay shows each field's own result: a field showing
// something other than its planned answer is failed. A fill that brings on new
// questions (Eightfold's follow-ups, Workday's new panels) is planned again
// with them and goes on. Questions that need a written answer wait for the
// student's one Generate click, then go to the essay-answer route.
//
// Workday asks a step at a time: each step is filled as it shows, the
// student checks it and presses Save and Continue, and the next step is
// filled when it shows. On a job system the engine doesn't cover, nothing
// is filled and the overlay says so.
(async function () {
  "use strict";

  // One fill per page: a second injection (a second click, or the background
  // starting a Workday step's fill again) leaves the running one alone.
  if (window.WIA.running) return;
  window.WIA.running = true;

  const { status, overlay } = window.WIA;
  // The essay-answer route's limits (backend/app/schemas/essay_answer.py).
  const QUESTION_MAX = 500;
  const NAME_MAX = 200;
  const MIN_LENGTH = 50;
  // Workday's name of the step shown, and how long to let an answer bring up a follow-up before reading the step again.
  const WORKDAY_STEP = "[data-automation-id=progressBarActiveStep]";
  const FOLLOW_UP_WAIT = 300;

  overlay.mount();
  status.reset();
  // Where the fill is, for whoever drives the page (the extension's test):
  // "filling", "filled", "step" (a Workday step filled, waiting for Save and Continue), "last" or "stopped".
  window.WIA.phase = "filling";

  const send = (message) => chrome.runtime.sendMessage(message);
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

  /** A row that is the overlay's message, not a field. */
  function note(key, label, reason, failed = false) {
    status.register(key, label, failed);
    status.setStatus(key, failed ? "failed" : "skipped", reason);
  }

  /**
   * Plans and fills the form shown (on Workday, the step shown), planning
   * again whenever a fill brings on new questions, and on Workday once more
   * after the last answer, for a follow-up it brought up. Returns the last
   * Plan, or null if nothing could be filled.
   */
  async function fillShown() {
    const shown = new Set();
    const done = new Set();
    const written = new Map();
    let extra = [];
    let state;
    let prepared;
    for (;;) {
      prepared = await send({ type: "fill/plan", extra, state });
      if (!prepared.ok) {
        note("_error", prepared.error || "Could not plan this application", prepared.status === 401 ? "Sign in from the extension popup first." : prepared.error, true);
        return null;
      }
      if (!prepared.covered) {
        note("_uncovered", "WorkIt can't fill this job system yet", "Nothing on this page was filled. WorkIt fills Greenhouse, Lever, Ashby, Rippling, Workable, Eightfold and Workday applications.");
        return null;
      }
      if (prepared.openForm) {
        note("_form", "This page shows the job, not its application", `Open the application form (${prepared.openForm}), then click Autofill again.`);
        return null;
      }
      if (prepared.step?.wentWrong) {
        note("_error", "Workday showed an error page", "Reload the page. WorkIt fills the step when it shows.", true);
        return null;
      }
      state = prepared.state;
      const { questions, answers, rows } = prepared;
      const byName = new Map(questions.map((q) => [q.name, q]));
      const isNew = (name) => !shown.has(name) && shown.add(name);

      for (const name of Object.keys(answers)) if (isNew(name)) status.register(name, byName.get(name)?.label ?? name, byName.get(name)?.required ?? false);
      for (const q of rows.written) {
        written.set(q.name, q);
        if (!isNew(q.name)) continue;
        status.register(q.name, q.label, q.required);
        status.setStatus(q.name, "needs_generation");
      }
      for (const q of rows.yours) {
        if (!isNew(q.name)) continue;
        status.register(q.name, q.label, q.required);
        status.setStatus(q.name, q.required ? "failed" : "skipped", "WorkIt has no answer for this. Answer it yourself.");
      }
      rows.notes.forEach((text) => isNew(`_note:${text}`) && note(`_note:${text}`, "Left for you", text));

      let more = null;
      let filledAny = false;
      const left = Object.fromEntries(Object.entries(answers).filter(([name]) => !done.has(name)));
      if (Object.keys(left).length) {
        const answer = await send({
          type: "fill/page", site: prepared.site, questions, answers: left, accepted: prepared.plan.accepted, state, sections: prepared.step?.sections,
        });
        if (!answer.ok) {
          for (const name of Object.keys(left)) {
            status.setStatus(name, "failed", answer.error);
            done.add(name);
          }
        } else {
          state = answer.state ?? state;
          for (const [name, result] of Object.entries(answer.results)) {
            done.add(name);
            filledAny = true;
            status.setStatus(name, result.status, result.reason, result.shows);
          }
          more = answer.more ?? null;
        }
      }
      if (more) {
        extra = [...extra, ...more.filter((q) => !extra.some((e) => e.name === q.name))];
        continue;
      }
      if (prepared.site === "workday" && filledAny) {
        await sleep(FOLLOW_UP_WAIT);
        continue;
      }
      return { ...prepared, written: [...written.values()], state };
    }
  }

  /** Fills one answer that needed writing, through the engine, and shows how it went. */
  async function fillWritten(prepared, name, value) {
    const answer = await send({ type: "fill/page", site: prepared.site, questions: prepared.questions, answers: { [name]: value }, state: prepared.state });
    const result = answer.ok ? answer.results[name] ?? { status: "failed", reason: "The form changed before this was filled" } : { status: "failed", reason: answer.error };
    status.setStatus(name, result.status, result.reason, result.shows);
  }

  /** The Generate prompt for the questions that need a written answer, if any. */
  function offerEssays(prepared) {
    const written = prepared.written;
    if (written.length === 0) return;
    overlay.promptForEssays({
      count: written.length,
      onDismiss() {
        for (const { name } of written) status.setStatus(name, "skipped", "You chose to answer this yourself");
      },
      async onGenerate() {
        // One at a time: each is its own counted AI use, and the overlay shows each row as it lands.
        for (const q of written) {
          const box = document.getElementById(q.name);
          const maxLength = box && box.maxLength >= MIN_LENGTH ? box.maxLength : null;
          const result = await send({
            type: "essay/generate",
            applicantId: prepared.applicantId,
            question: q.label.slice(0, QUESTION_MAX),
            companyName: prepared.posting.company.slice(0, NAME_MAX) || null,
            jobTitle: prepared.posting.title.slice(0, NAME_MAX) || null,
            maxLength,
          });
          if (!result.ok) {
            status.setStatus(q.name, "failed", result.error);
            continue;
          }
          await fillWritten(prepared, q.name, result.answer);
        }
      },
    });
  }

  /** Workday's step shown ("" before the application starts, or while it redraws). */
  function workdayStep() {
    const lines = (document.querySelector(WORKDAY_STEP)?.innerText ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.length ? lines[lines.length - 1].replace(/^(current )?step \d+ of \d+\s*/i, "") : "";
  }

  /** Resolves with Workday's step once it shows and isn't `from`. Watches the page; never times out. */
  function stepAfter(from) {
    return new Promise((resolve) => {
      const check = () => {
        const step = workdayStep();
        if (!step || step === from) return false;
        observer.disconnect();
        resolve(step);
        return true;
      };
      const observer = new MutationObserver(check);
      if (!check()) observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    });
  }

  const isWorkday = /(^|\.)(myworkdayjobs|myworkdaysite)\.com$/.test(location.hostname);
  if (!isWorkday) {
    const prepared = await fillShown();
    window.WIA.phase = prepared ? "filled" : "stopped";
    window.WIA.running = false;
    if (prepared) offerEssays(prepared);
    return;
  }

  // Workday: each step as it shows, until the step whose button sends.
  if (!workdayStep()) note("_step", "Waiting for the application", "Sign in and start the application. WorkIt fills each step as it shows.");
  let step = await stepAfter("");
  for (;;) {
    status.reset();
    window.WIA.phase = "filling";
    const prepared = await fillShown();
    if (!prepared) {
      window.WIA.phase = "stopped";
      window.WIA.running = false;
      return;
    }
    const last = prepared.step.review || prepared.step.sends;
    note("_step", `Workday: ${step}`, last
      ? "This is the last step. Check the whole application, then submit it yourself."
      : "Check this step, then press Save and Continue. WorkIt fills the next step when it shows.");
    offerEssays(prepared);
    window.WIA.phase = last ? "last" : "step";
    if (last) return;
    step = await stepAfter(step);
  }
})();

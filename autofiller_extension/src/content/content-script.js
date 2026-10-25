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
//
// In one of batch apply's tabs (KAN-370; `window.WIA.batch`, set by
// injectFill), the fill writes no essays itself: it sends the questions that
// need writing to WorkIt, and fills each answer the student's own Claude
// saves through the connector as it arrives (KAN-377). It tells the
// background whether the tab is ready or needs the student ("batch/state"),
// once the fill ends and again whenever that changes (an answer filled too):
// the engine reads back the fields the student edits, so emptying a required
// field, or answering the last one, moves the tab between the Ready and
// Needs you groups (background/batch.js).
//
// A batch tab also watches for the student's own submit (KAN-374): the
// engine, in the page, reads the job system's answer to it ("batch/watch").
// A submit that sent the application is told to the background, which marks
// it applied ("batch/submitted"); one the job system refused shows here as a
// failed row, with its words, and the tab needs the student again.
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
  const MAX_LENGTH = 5000; // a box that takes more (Workable's cover letter: 200000) asks for this much
  // Workday's name of the step shown, and how long to let an answer bring up a follow-up before reading the step again.
  const WORKDAY_STEP = "[data-automation-id=progressBarActiveStep]";
  const FOLLOW_UP_WAIT = 300;
  // How long the student's typing pauses before the fields they changed are read back.
  const EDIT_PAUSE = 400;
  const batch = Boolean(window.WIA.batch);
  const WRITE_IT = "Write this answer yourself.";
  const WAIT_FOR_CLAUDE = "Waiting for your Claude: run \"Write my WorkIt answers\" in Claude, or write it yourself.";
  // How often a batch tab asks whether the student's Claude saved an answer (KAN-377).
  const ANSWER_POLL = 10_000;
  // The connector's limits on a question (backend/app/schemas/applications.py).
  const LABEL_MAX = 2000;
  const FIELD_NAME_MAX = 200;

  status.reset();
  // Where the fill is, for whoever drives the page (the extension's test):
  // "filling", "filled", "step" (a Workday step filled, waiting for Save and Continue), "last" or "stopped".
  window.WIA.phase = "filling";

  const send = (message) => chrome.runtime.sendMessage(message);
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  // The Fill engine's event for the student's submit (its SUBMIT_EVENT); its detail is the result as JSON.
  const SUBMIT_EVENT = "fillengine:submit";

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

      const sources = prepared.plan.sources ?? {};
      for (const name of Object.keys(answers)) {
        if (isNew(name)) status.register(name, byName.get(name)?.label ?? name, byName.get(name)?.required ?? false, sources[name] ?? "guessed");
      }
      for (const q of rows.written) {
        written.set(q.name, q);
        if (batch) {
          if (!isNew(q.name)) continue;
          status.register(q.name, q.label, q.required);
          status.setStatus(q.name, "needs_generation", WAIT_FOR_CLAUDE);
          continue;
        }
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

  /** Fills one answer that needed writing, through the engine, and shows how it went. `source`: who wrote it. */
  async function fillWritten(prepared, name, value, source = "ai") {
    const answer = await send({ type: "fill/page", site: prepared.site, questions: prepared.questions, answers: { [name]: value }, state: prepared.state });
    const result = answer.ok ? answer.results[name] ?? { status: "failed", reason: "The form changed before this was filled" } : { status: "failed", reason: answer.error };
    status.setStatus(name, result.status, result.reason, result.shows, source);
  }

  /** The current status of one row, or undefined. */
  const rowStatus = (key) => status.summary().fields.find((r) => r.key === key)?.status;

  /**
   * A batch tab's questions that need writing (KAN-377): sent to WorkIt for
   * the student's own Claude, which saves its answers through the connector.
   * The tab then asks for the saved answers every ANSWER_POLL ms and fills
   * each new one through the engine, until none is left; the tab's group
   * follows (report()). A question the student answered first keeps their
   * answer.
   */
  async function awaitClaude(prepared) {
    const waiting = new Set(prepared.written.map((q) => q.name));
    const questions = prepared.written.map((q) => {
      const box = document.getElementById(q.name);
      return {
        name: q.name.slice(0, FIELD_NAME_MAX),
        label: q.label.slice(0, LABEL_MAX),
        required: Boolean(q.required),
        max_length: box && box.maxLength > 0 ? box.maxLength : null,
      };
    });
    let reply = await send({ type: "batch/questions", questions }).catch((error) => ({ ok: false, error: error.message }));
    if (!reply.ok) {
      for (const q of prepared.written) status.setStatus(q.name, q.required ? "failed" : "skipped", WRITE_IT);
      return;
    }
    for (;;) {
      for (const { name, answer } of reply.ok ? reply.questions : []) {
        if (!answer || !waiting.has(name)) continue;
        waiting.delete(name);
        if (rowStatus(name) !== "filled") await fillWritten(prepared, name, answer, "claude");
      }
      for (const name of waiting) if (rowStatus(name) === "filled") waiting.delete(name);
      if (!waiting.size) return;
      await sleep(ANSWER_POLL);
      reply = await send({ type: "batch/answers" }).catch((error) => ({ ok: false, error: error.message }));
    }
  }

  /** The Generate prompt for the questions that need a written answer, if any. */
  function offerEssays(prepared) {
    const written = prepared.written;
    if (written.length === 0) return;
    if (batch) {
      awaitClaude(prepared);
      return;
    }
    overlay.promptForEssays({
      count: written.length,
      onDismiss() {
        for (const { name } of written) status.setStatus(name, "skipped", "You chose to answer this yourself");
      },
      async onGenerate() {
        // One at a time: each is its own counted AI use, and the overlay shows each row as it lands.
        for (const q of written) {
          const box = document.getElementById(q.name);
          const maxLength = box && box.maxLength >= MIN_LENGTH ? Math.min(box.maxLength, MAX_LENGTH) : null;
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

  /** Whether a row needs the student: a note the Plan left them, a failed field, or a required one unanswered. */
  const needsYou = (r) => r.key.startsWith("_") || r.status === "failed" || (r.required && r.status !== "filled");

  /**
   * Whether this batch tab is "ready" (every field it needs shows an answer)
   * or "needs_you": the fill stopped (no Filler for this job system, an
   * error), a Workday step waits for the student, a field failed, a required
   * one is unanswered, or the Plan left something to the student (a note).
   */
  function tabState() {
    const phase = window.WIA.phase;
    if (phase !== "filled") return "needs_you";
    return status.summary().fields.some(needsYou) ? "needs_you" : "ready";
  }

  /**
   * The form's field for a question, by the job system's own field id: an
   * element's id (Greenhouse, Lever's cards), its name (Lever), or the
   * attribute Ashby, Workable or Rippling mark a field's box with. Null for
   * a row that is not a field, or a field the page doesn't show.
   */
  function fieldOf(key) {
    if (key.startsWith("_")) return null;
    const name = CSS.escape(key);
    return (
      document.getElementById(key) ??
      document.querySelector(`[name="${name}"], [data-field-path="${name}"], [data-ui="${name}"], [data-testid="${name}"]`)
    );
  }

  /** The keys of the rows that need the student, in the order their fields stand on the page (notes last). */
  function flagged() {
    const rows = status.summary().fields.filter(needsYou).map((r) => ({ key: r.key, field: fieldOf(r.key) }));
    const placed = rows.filter((r) => r.field).sort((a, b) => (a.field.compareDocumentPosition(b.field) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    return [...placed, ...rows.filter((r) => !r.field)].map((r) => r.key);
  }

  /** Brings a flagged row's field into view and focuses it, and marks its row on the panel. */
  function show(key) {
    const field = fieldOf(key);
    if (field) {
      field.scrollIntoView({ block: "center" });
      const control = field.matches("input, select, textarea, button, [tabindex]") ? field : field.querySelector("input, select, textarea, button, [tabindex]");
      control?.focus({ preventScroll: true });
    }
    overlay.setCurrent(key);
  }

  /**
   * Batch apply's "Next Thing That Needs You" (background/batch.js walks the
   * batch's tabs): this tab answers which of its rows need the student
   * ("batch/flags") and shows one when it is next ("batch/focus"). Added
   * once per page, though the fill may be injected again.
   */
  function answerTheWalk() {
    if (window.WIA.walking) return;
    window.WIA.walking = true;
    chrome.runtime.onMessage.addListener((message, _sender, reply) => {
      if (message?.type === "batch/flags") reply({ keys: window.WIA.phase === "filling" ? [] : flagged() });
      else if (message?.type === "batch/focus") {
        show(message.key);
        reply({ shown: true });
      }
    });
    overlay.offerNext(async () => {
      const answer = await send({ type: "batch/next" }).catch(() => null);
      if (!answer?.ok) return "WorkIt couldn't look through the batch. Try again.";
      return answer.done ? "Nothing else needs you." : null;
    });
  }

  let reported = null;
  /** Tells the background this batch tab's state, when it changed. */
  function report() {
    if (!batch || window.WIA.phase === "filling") return;
    const state = tabState();
    if (state === reported) return;
    reported = state;
    send({ type: "batch/state", state }).catch(() => {});
  }
  status.subscribe(report);

  /** Watches the page for the student's submit, from before the fill: the student may submit any time. */
  function watchSubmit() {
    document.addEventListener(SUBMIT_EVENT, async (event) => {
      const result = JSON.parse(event.detail);
      if (!result.submitted) {
        note("_submit", "Your application wasn't sent", result.reason, true);
        return;
      }
      const answer = await send({ type: "batch/submitted" }).catch((error) => ({ ok: false, error: error.message }));
      if (answer?.ok) note("_submit", "Application sent", "WorkIt marked it Applied.");
      else note("_submit", "Application sent, but WorkIt didn't mark it Applied", `Mark it Applied on WorkIt's Applications page. (${answer?.error ?? "No answer"})`, true);
    });
    send({ type: "batch/watch" }).catch(() => {});
  }
  if (batch) watchSubmit();

  const REQUIRED_EMPTY = "The form needs this before it sends. Answer it yourself.";

  /**
   * Fails every field the form requires now that shows nothing, so a tab is
   * never Ready while the job system would refuse its submit: a required
   * field no row covers yet, and one the form requires only once another is
   * answered (Greenhouse's phone country, once Phone shows a number). The
   * engine reads the page; a row it names is made required.
   */
  async function flagEmptyRequired(prepared) {
    const answer = await send({ type: "fill/required", site: prepared.site, questions: prepared.questions, state: prepared.state }).catch(() => null);
    if (!answer?.ok) return;
    const rows = new Map(status.summary().fields.map((r) => [r.key, r]));
    const labels = new Map(prepared.questions.map((q) => [q.name, q.label]));
    for (const name of answer.empty) {
      const row = rows.get(name);
      if (row?.required && row.status === "failed") continue;
      status.register(name, row?.label ?? labels.get(name) ?? name, true, row?.source);
      status.setStatus(name, "failed", REQUIRED_EMPTY);
    }
  }

  const isEmpty = (shown) => shown === undefined || shown === null || shown === "" || (Array.isArray(shown) && shown.length === 0);

  /**
   * After the fill, reads back (through the engine) the fields the tab's
   * state rests on whenever the student edits the form: every required
   * field and every failed one. One that now shows an answer is filled (by
   * the student); a required one now empty has failed, as has one the form
   * now requires (flagEmptyRequired). report() then moves
   * the tab between the groups.
   */
  function watchEdits(prepared) {
    const byName = new Map(prepared.questions.map((q) => [q.name, q]));
    let timer;
    const check = async () => {
      const rows = status.summary().fields.filter((r) => byName.has(r.key) && (r.required || r.status === "failed"));
      if (!rows.length) return flagEmptyRequired(prepared);
      const answer = await send({ type: "fill/read", site: prepared.site, questions: prepared.questions, names: rows.map((r) => r.key), state: prepared.state });
      if (!answer.ok) return;
      for (const row of rows) {
        const shown = answer.shows[row.key];
        if (!isEmpty(shown)) {
          if (row.status !== "filled" || JSON.stringify(shown) !== JSON.stringify(row.shows)) status.setStatus(row.key, "filled", row.status === "filled" ? row.reason : "You answered this", shown, "student");
        } else if (row.required && row.status === "filled") status.setStatus(row.key, "failed", "This is empty now. Answer it yourself.");
      }
      await flagEmptyRequired(prepared);
    };
    const edited = () => {
      clearTimeout(timer);
      timer = setTimeout(check, EDIT_PAUSE);
    };
    document.addEventListener("input", edited, true);
    document.addEventListener("change", edited, true);
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
    // THE PANEL GOES ON THE PAGE ONCE THE FILL IS DONE, not before. Greenhouse's
    // React app takes over the whole document as it starts up (hydration);
    // a node it didn't render, the panel's, made it draw the form again,
    // which dropped what was already typed: with five batch tabs starting at
    // once, the first box filled read back empty in 1 to 10 forms of 50. With
    // the panel mounted after the fill: 0 in 50 (KAN-370). The engine waits
    // for the form's start-up before it types, so by now it is over.
    const prepared = await fillShown();
    if (prepared) await flagEmptyRequired(prepared);
    overlay.mount();
    window.WIA.phase = prepared ? "filled" : "stopped";
    window.WIA.running = false;
    report();
    if (prepared) offerEssays(prepared);
    if (prepared && batch) watchEdits(prepared);
    if (batch) answerTheWalk();
    return;
  }

  // Workday: each step as it shows, until the step whose button sends. Its
  // pages aren't hydrated, and the panel tells the student to sign in first.
  overlay.mount();
  if (batch) answerTheWalk();
  if (!workdayStep()) {
    note("_step", "Waiting for the application", "Sign in and start the application. WorkIt fills each step as it shows.");
    window.WIA.phase = "step";
    report();
  }
  let step = await stepAfter("");
  for (;;) {
    status.reset();
    window.WIA.phase = "filling";
    const prepared = await fillShown();
    if (!prepared) {
      window.WIA.phase = "stopped";
      window.WIA.running = false;
      report();
      return;
    }
    const last = prepared.step.review || prepared.step.sends;
    note("_step", `Workday: ${step}`, last
      ? "This is the last step. Check the whole application, then submit it yourself."
      : "Check this step, then press Save and Continue. WorkIt fills the next step when it shows.");
    offerEssays(prepared);
    window.WIA.phase = last ? "last" : "step";
    report();
    if (last) return;
    step = await stepAfter(step);
  }
})();

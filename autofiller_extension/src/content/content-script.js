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
// Before that, Workday asks the student to sign in to the company's site
// (KAN-373): on its Create Account or Sign In form the fill types the
// student's email and the password the extension keeps for that company
// (background/workday-logins.js), and the student presses the button and
// opens Workday's email themselves. The steps fill once they show.
//
// In one of batch apply's tabs (KAN-370; `window.WIA.batch`, set by
// injectFill), the fill writes no essays itself: it sends the questions that
// need writing to WorkIt, and fills each answer the student's own Claude
// saves through the connector as it arrives (KAN-377). It tells the
// background whether the tab is ready or needs the student ("batch/state"),
// once the fill ends and again whenever that changes (an answer filled too):
// the engine reads back the fields the student edits, so emptying a required
// field, or answering the last one, moves the tab between the Ready and
// Needs you groups (background/batch.js). The student's own words in a
// written answer (an edit to the one filled, or theirs before their
// Claude's) are saved for this application and every later form that asks
// the same question (KAN-379, "batch/own-answer"); the Plan already fills a
// question answered before from those saved answers.
//
// A batch tab also watches for the student's own submit (KAN-374): the
// engine, in the page, reads the job system's answer to it ("batch/watch").
// A submit that sent the application is told to the background, which marks
// it applied ("batch/submitted"); one the job system refused shows here as a
// failed row, with its words, and the tab needs the student again. Its
// panel has Skip (KAN-373): the job is skipped, and its tab closes.
//
// This file is the fill's order of events. Its parts load before it
// (shared/content-scripts.js): workday.js reads Workday's pages and fills
// its sign-in, written-answers.js the questions that need writing, and
// batch-tab.js a batch tab's side (its state, the walk, the submit watch).
(async function () {
  "use strict";

  // One fill per page: a second injection (a second click, or the background
  // starting a Workday step's fill again) leaves the running one alone.
  if (window.WIA.running) return;
  window.WIA.running = true;

  const { status, overlay } = window.WIA;
  // How long to let an answer bring up a follow-up on Workday before reading the step again.
  const FOLLOW_UP_WAIT = 300;
  // How long the student's typing pauses before the fields they changed are read back.
  const EDIT_PAUSE = 400;
  const batch = Boolean(window.WIA.batch);
  // The questions that need a written answer: their rows, their writing, the student's edits of them.
  const writing = window.WIA.writtenAnswers({ batch });
  status.reset();
  // Where the fill is, for whoever drives the page (the extension's test):
  // "filling", "filled", "step" (a Workday step filled, waiting for Save and Continue), "last" or "stopped".
  window.WIA.phase = "filling";

  const send = (message) => chrome.runtime.sendMessage(message);
  // The panel's options: a batch tab's panel has Skip.
  const panel = batch ? { onSkip: () => send({ type: "batch/skip" }).catch(() => {}) } : undefined;
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

      const sources = prepared.plan.sources ?? {};
      for (const name of Object.keys(answers)) {
        if (isNew(name)) status.register(name, byName.get(name)?.label ?? name, byName.get(name)?.required ?? false, sources[name] ?? "guessed");
      }
      for (const q of rows.written) written.set(q.name, q);
      await writing.showRows(rows.written, isNew);
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

  /** The current status of one row, or undefined. */
  const rowStatus = (key) => status.summary().fields.find((r) => r.key === key)?.status;

  // The self-identification questions this page asks and the student hasn't
  // answered yet (KAN-387; the Plan's `selfId`), with the fill they belong to.
  let selfIdWaiting = null;

  /**
   * The first form that asks the self-identification asks the student
   * (once, and in one tab: the background decides). Nothing is guessed
   * meanwhile: those fields stay as the Plan left them. Once the student
   * saves, this page fills them, and so does every other batch tab
   * ("selfid/saved"); every later form fills them from the profile.
   */
  async function offerSelfId(prepared) {
    selfIdWaiting = prepared.selfId ? prepared : null;
    if (!selfIdWaiting) return;
    const answer = await send({ type: "selfid/ask" }).catch(() => null);
    if (!answer?.ok || !answer.ask) return;
    overlay.askSelfId({
      questions: answer.questions,
      async onSave(answers) {
        const saved = await send({ type: "selfid/save", answers }).catch((error) => ({ ok: false, error: error.message }));
        if (!saved.ok) return saved.error || "WorkIt couldn't save these. Try again.";
        fillSelfId(); // the card closes now; the fields fill as the engine gets to them
        return null;
      },
    });
  }

  /** Fills this page's self-identification questions from the profile, now that the student answered them. */
  async function fillSelfId() {
    const prepared = selfIdWaiting;
    if (!prepared) return;
    selfIdWaiting = null;
    const fresh = await send({ type: "fill/plan", state: prepared.state });
    if (!fresh.ok) return;
    const answers = Object.fromEntries(prepared.selfId.names.filter((name) => name in fresh.answers).map((name) => [name, fresh.answers[name]]));
    if (!Object.keys(answers).length) return;
    const byName = new Map(fresh.questions.map((q) => [q.name, q]));
    for (const name of Object.keys(answers)) {
      if (rowStatus(name) === "filled") continue;
      status.register(name, byName.get(name)?.label ?? name, byName.get(name)?.required ?? false, fresh.plan.sources?.[name] ?? "profile");
    }
    const filled = await send({ type: "fill/page", site: fresh.site, questions: fresh.questions, answers, accepted: fresh.plan.accepted, state: fresh.state });
    for (const [name, result] of Object.entries(filled.ok ? filled.results : {})) status.setStatus(name, result.status, result.reason, result.shows);
  }

  // In a batch tab, the student saved the self-identification in another tab (background.js tells only
  // the batch's): fill it here too. Added once per page; it calls the latest fill's, since the fill may be
  // injected again.
  window.WIA.fillSelfId = fillSelfId;
  if (batch && !window.WIA.selfIdHeard) {
    window.WIA.selfIdHeard = true;
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "selfid/saved") window.WIA.fillSelfId();
    });
  }

  // This tab's side of batch apply: its state for the background, Next Thing That Needs You, the student's submit.
  const { report, answerTheWalk, watchSubmit } = window.WIA.batchTab({ batch, note });
  if (batch) watchSubmit();

  const REQUIRED_EMPTY = "The form needs this before it sends. Answer it yourself.";

  /**
   * Fails every field the form requires now that shows nothing, so a tab is
   * never Ready while the job system would refuse its submit: a required
   * field no row covers yet, and one the form requires only once another is
   * answered (Greenhouse's phone country, once Phone shows a number), and
   * one the Question set lacks altogether (a required field only Ashby's or
   * Eightfold's page shows), which joins `prepared.questions`, so the edits
   * are read back for it too. The engine reads the page; a row it names is
   * made required.
   */
  async function flagEmptyRequired(prepared) {
    const answer = await send({ type: "fill/required", site: prepared.site, questions: prepared.questions, state: prepared.state }).catch(() => null);
    if (!answer?.ok) return;
    prepared.questions.push(...(answer.unasked ?? []));
    const rows = new Map(status.summary().fields.map((r) => [r.key, r]));
    const labels = new Map(prepared.questions.map((q) => [q.name, q.label]));
    for (const name of answer.empty) {
      const row = rows.get(name);
      if (row?.required && row.status !== "filled") continue; // already needs the student, with its own reason (a question waiting for Claude)
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
   *
   * The written answers are read back too (the questions that needed
   * writing, and those a saved answer filled): the student's own words in
   * one are saved (keepOwn), for this application and every later form
   * that asks it (KAN-379). WorkIt's own fill of one is never taken for theirs.
   *
   * On Workday, each step's fill watches that step, and the watch stops
   * (the returned function) once the step is left: Workday draws the next
   * step in the same page, and its fields are another step's. A Workday tab
   * is never Ready, so the form's required fields aren't looked for there.
   */
  function watchEdits(prepared) {
    const workday = prepared.site === "workday";
    let stopped = false;
    const required = () => (workday ? undefined : flagEmptyRequired(prepared));
    const byName = new Map(prepared.questions.map((q) => [q.name, q]));
    const inWords = (q) => q.kind === "text" || q.kind === "textarea";
    const written = new Set([...prepared.written.map((q) => q.name), ...(prepared.plan.banked ?? []).filter(inWords).map((q) => q.name)]);
    writing.adopt(written);
    let timer;
    const check = async () => {
      if (writing.busy() || stopped) return;
      const rows = status.summary().fields.filter((r) => byName.has(r.key) && (r.required || r.status === "failed" || written.has(r.key)));
      if (!rows.length) return required();
      const answer = await send({ type: "fill/read", site: prepared.site, questions: prepared.questions, names: rows.map((r) => r.key), state: prepared.state });
      if (!answer.ok || writing.busy() || stopped) return;
      for (const row of rows) {
        const shown = answer.shows[row.key];
        if (!isEmpty(shown)) {
          if (row.status !== "filled" || JSON.stringify(shown) !== JSON.stringify(row.shows)) {
            if (written.has(row.key) && typeof shown === "string") writing.edited(row, shown, byName.get(row.key));
            else status.setStatus(row.key, "filled", row.status === "filled" ? row.reason : "You answered this", shown, "student");
          }
        } else if (row.required && row.status === "filled") status.setStatus(row.key, "failed", "This is empty now. Answer it yourself.");
      }
      await required();
    };
    const edited = () => {
      clearTimeout(timer);
      timer = setTimeout(check, EDIT_PAUSE);
    };
    document.addEventListener("input", edited, true);
    document.addEventListener("change", edited, true);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("input", edited, true);
      document.removeEventListener("change", edited, true);
    };
  }

  const workday = window.WIA.workday;
  if (!workday.isWorkday) {
    // THE PANEL GOES ON THE PAGE ONCE THE FILL IS DONE, not before. Greenhouse's
    // React app takes over the whole document as it starts up (hydration);
    // a node it didn't render, the panel's, made it draw the form again,
    // which dropped what was already typed: with five batch tabs starting at
    // once, the first box filled read back empty in 1 to 10 forms of 50. With
    // the panel mounted after the fill: 0 in 50 (KAN-370). The engine waits
    // for the form's start-up before it types, so by now it is over.
    const prepared = await fillShown();
    if (prepared) await flagEmptyRequired(prepared);
    overlay.mount(panel);
    window.WIA.phase = prepared ? "filled" : "stopped";
    window.WIA.running = false;
    report();
    if (prepared) writing.offer(prepared);
    if (prepared) offerSelfId(prepared);
    if (prepared && batch) watchEdits(prepared);
    if (batch) answerTheWalk();
    return;
  }

  // Workday: each step as it shows, until the step whose button sends. Its
  // pages aren't hydrated, and the panel tells the student to sign in first.
  overlay.mount(panel);
  if (batch) answerTheWalk();
  if (!workday.step()) {
    note("_step", "Waiting for the application", "Sign in and start the application. WorkIt fills each step as it shows.");
    window.WIA.phase = "step";
    report();
    workday.watchSignIn((reason) => {
      status.reset();
      note("_step", "Sign in to continue", reason);
      window.WIA.phase = "step";
      report();
    });
  }
  let step = await workday.stepAfter("");
  for (;;) {
    await workday.quiet();
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
    writing.offer(prepared);
    offerSelfId(prepared);
    const stopEdits = batch ? watchEdits(prepared) : null;
    window.WIA.phase = last ? "last" : "step";
    report();
    if (last) return;
    step = await workday.stepAfter(step);
    stopEdits?.();
  }
})();

// The fill, run in the application's page (the isolated world) once the
// popup's "Autofill This Page" or the auto-apply runner injects it
// (shared/content-scripts.js's injectFill, which loads the Fill engine into
// the page first). It never submits. It moves a form on only on Workday,
// with Save and Continue, once a step needs nothing from the student (Fill
// to Review, workday-walk.js).
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
// student checks it and presses Save and Continue (or, in a batch tab or
// after Fill to Review, workday-walk.js presses it on a step with nothing
// left for the student), and the next step is filled when it shows. On a job system the engine doesn't cover, nothing
// is filled and the overlay says so.
//
// Before that, Workday asks the student to sign in to the company's site
// (KAN-373): on its Create Account or Sign In form the fill types the
// student's email and the password the extension keeps for that company
// (background/workday-logins.js). Once the student allows it (asked once in
// the panel), it also ticks the terms box and presses the button itself
// (KAN-369, workday.js); else the student presses it. The student opens
// Workday's email themselves. The steps fill once they show.
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
// A batch tab, and a tab the student tracks on WorkIt (KAN-424), also
// watches for the student's own submit (KAN-374): the engine, in the page,
// reads the job system's answer to it ("batch/watch").
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

  // One fill per page: injectFill (shared/content-scripts.js) set
  // `window.WIA.running` before injecting this, and injects nothing while it
  // is set, so a second click, or a second injector, leaves this fill alone.

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

  const send = window.WIA.ui.ask;
  // The panel's options: a batch tab's panel has Skip, and "I submitted this" for a submit WorkIt missed.
  const panel = batch ? { onSkip: () => send({ type: "batch/skip" }).catch(() => {}), onSubmitted: () => markSentByHand() } : undefined;
  /** The student says they sent this application: it is marked applied, as a detected submit is. */
  async function markSentByHand() {
    const answer = await send({ type: "batch/i-submitted" }).catch((error) => ({ ok: false, error: error.message }));
    if (answer?.ok && answer.applied) {
      note("_submit", "Application sent", "WorkIt marked it Applied.", false, true);
      window.WIA.panelStates?.sent(); // Sent, Next job, I didn't submit this (KAN-401)
    } else note("_submit", "WorkIt couldn't mark it Applied", `Try again, or mark it Applied on WorkIt's Auto Apply page. (${answer?.error ?? "No answer"})`, true);
  }
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  /** A row that is the overlay's message, not a field. `done`: news that asks nothing of the student. */
  function note(key, label, reason, failed = false, done = false) {
    status.register(key, label, failed, undefined, done ? "done" : "todo");
    status.setStatus(key, failed ? "failed" : "skipped", reason);
  }

  /**
   * Plans and fills the form shown (on Workday, the step shown), planning
   * again whenever a fill brings on new questions, and on Workday once more
   * after the last answer, for a follow-up it brought up. Returns the last
   * Plan, or null if nothing could be filled. On Workday, a step whose
   * Plan fails gives `{ unplanned: reason }` instead: that step is the
   * student's, and the next step is still filled (decision 1570).
   * `emptyOnly`: a Workday step filled before keeps what it shows (the
   * student's saved answers).
   */
  async function fillShown(emptyOnly = false) {
    const shown = new Set();
    const done = new Set();
    const written = new Map();
    let extra = [];
    let state;
    let prepared;
    // A Workday step left while it fills (the student went back, or on): the next step is the loop's, not this fill's.
    const stepped = window.WIA.steps; // Workday, Oracle (steps.js)
    const begun = stepped ? stepped.stepId() : "";
    // Live progress in the panel (KAN-398): Scanning, N fields found, Filling · N of M, Stop and Skip.
    const progress = window.WIA.progress;
    progress.begin({ stay: Boolean(stepped) });
    try {
    for (;;) {
      if (prepared && begun && stepped.stepId() !== begun) return { ...prepared, written: [...written.values()], state };
      prepared = await send({ type: "fill/plan", extra, state });
      if (!prepared.ok && stepped) {
        return { unplanned: prepared.status === 401 ? "Sign in from the extension popup first. " : "" };
      }
      // On a covered job system's own page too: the engine finds no form there (TikTok's NoForm), or it is the posting's.
      if ((!prepared.ok || !prepared.covered || prepared.openForm) && window.WIA.closedPosting()) {
        note("_closed", "This job is closed", "It is no longer accepting applications, so there is nothing to fill. Pick another job.");
        // A batch tab's job leaves the batch marked closed, its tab closes, and the next job opens (batch.js).
        if (batch) send({ type: "batch/closed" }).catch(() => {});
        return null;
      }
      if (!prepared.ok) {
        note("_error", prepared.error || "Could not plan this application", prepared.status === 401 ? "Sign in from the extension popup first." : prepared.error, true);
        return null;
      }
      // A company's careers page with Greenhouse's form in an iframe (a hosted job its board shows there):
      // the fill reaches only this page, so the student is pointed at the form's own link.
      const embedded = prepared.covered ? null : document.querySelector('iframe[src*="greenhouse.io/embed/job_app"]');
      if (embedded) {
        note("_form", "This page shows the job, not its application", `Open the application form (${embedded.src}), then click Autofill again.`);
        return null;
      }
      if (!prepared.covered) {
        note("_uncovered", "WorkIt can't fill this job system yet", "Nothing on this page was filled. WorkIt fills Greenhouse, Lever, Ashby, Rippling, Workable, Eightfold, SmartRecruiters, Workday, Oracle, SuccessFactors, iCIMS, Waymo and TikTok applications.");
        return null;
      }
      // TikTok's and ByteDance's form is behind the site's own sign-in, which is the student's: WorkIt
      // never types an email or password there. Nothing is filled; the form fills once it shows (the
      // background fills a tab that left the sign-in for its form) or the student presses Autofill.
      if (prepared.signIn) {
        const [line, ...rest] = prepared.signIn.split(/(?<=\.)\s+/);
        note("_signin", line.replace(/\.$/, ""), `${rest.join(" ")} WorkIt fills the application once its form shows.`.trim());
        return null;
      }
      // A SuccessFactors career-site posting is its own "form" link: its Apply goes on to the sign-in, then the application.
      if (prepared.openForm && prepared.site === "successfactors" && prepared.openForm.split("?")[0] === location.href.split("?")[0]) {
        note("_form", "This page shows the job, not its application", "Press Apply on this page and sign in to SuccessFactors. WorkIt fills the application there.");
        return null;
      }
      if (prepared.openForm) {
        note("_form", "This page shows the job, not its application", `Open the application form (${prepared.openForm}), then click Autofill again.`);
        return null;
      }
      // Workday's error page: the step shows on the next load (seen live), so reload once by
      // ourselves; the mark (this tab's, by page) keeps it from looping, and the note waits for the error to be back.
      const reloaded = "workit-workday-reloaded";
      if (prepared.step?.wentWrong && sessionStorage.getItem(reloaded) !== location.href) {
        sessionStorage.setItem(reloaded, location.href);
        location.reload();
        return new Promise(() => {}); // the page is going; nothing to report from it
      }
      if (prepared.step) sessionStorage.removeItem(reloaded);
      // A gate is the student's (Oracle's email, SuccessFactors' and iCIMS's sign-in): nothing on it is filled.
      if (prepared.step?.gate) return { unplanned: window.WIA.steps?.gateFirst ?? `${window.WIA.steps?.waiting?.title ?? "Enter your email on Oracle's page first"}. ` };
      if (prepared.step?.wentWrong) {
        note("_error", "Workday showed an error page", "Reload the page. WorkIt fills the step when it shows.", true);
        return null;
      }
      state = prepared.state;
      const { questions, answers, rows } = prepared;
      if (!extra.length) progress.found(questions.length);
      const byName = new Map(questions.map((q) => [q.name, q]));
      window.WIA.report?.track(questions, { answers, sources: prepared.plan.sources }); // a fix report's fields (report.js), values kept on this page
      const isNew = (name) => !shown.has(name) && shown.add(name);

      const sources = prepared.plan.sources ?? {};
      for (const name of Object.keys(answers)) {
        // An entry's company or school titles its checklist block before the field fills (groups.js).
        window.WIA.groups?.planned(name, byName.get(name)?.label ?? name, answers[name]);
        if (isNew(name)) status.register(name, byName.get(name)?.label ?? name, byName.get(name)?.required ?? false, sources[name] ?? "guessed");
      }
      // Outside a batch tab only the essay route writes (Generate): a choice or a one-line draft is the student's there.
      const toWrite = batch ? rows.written : rows.written.filter((q) => q.generate);
      const yours = batch ? rows.yours : [...rows.yours, ...rows.written.filter((q) => !q.generate)];
      for (const q of toWrite) written.set(q.name, q);
      await writing.showRows(toWrite, isNew);
      for (const q of yours) {
        if (!isNew(q.name)) continue;
        status.register(q.name, q.label, q.required);
        status.setStatus(q.name, q.required ? "failed" : "skipped", "WorkIt has no answer for this. Answer it yourself.");
        window.WIA.report?.failed(q.name, "NoAnswer");
      }
      rows.notes.forEach((text) => isNew(`_note:${text}`) && note(`_note:${text}`, "Left for you", text));

      let more = null;
      let filledAny = false;
      const left = Object.fromEntries(Object.entries(answers).filter(([name]) => !done.has(name)));
      if (emptyOnly && Object.keys(left).length) {
        const read = await send({ type: "fill/read", site: prepared.site, questions, names: Object.keys(left), state });
        for (const [name, shown] of Object.entries(read.ok ? read.shows : {})) {
          if (isEmpty(shown)) continue;
          delete left[name];
          done.add(name);
          status.setStatus(name, "filled", "Saved on Workday before. WorkIt left it as it is.", shown);
        }
      }
      if (Object.keys(left).length && progress.stopped()) return stoppedAt(prepared, left, written, state);
      if (Object.keys(left).length) {
        const events = progress.filling(Object.keys(left).length);
        window.WIA.report?.follow(events);
        const answer = await send({
          type: "fill/page", site: prepared.site, questions, answers: left, accepted: prepared.plan.accepted, state, sections: prepared.step?.sections, events,
        });
        if (!answer.ok) {
          window.WIA.report?.log("error", { message: answer.error });
          for (const name of Object.keys(left)) {
            status.setStatus(name, "failed", answer.error);
            window.WIA.report?.failed(name, "Error");
            done.add(name);
          }
        } else {
          state = answer.state ?? state;
          for (const [name, result] of Object.entries(answer.results)) {
            done.add(name);
            filledAny = true;
            // A field the student skipped while it was stuck (Skip, progress.js) is theirs now, not an engine error.
            if (result.status === "left") status.setStatus(name, "failed", "You skipped this. Answer it yourself.");
            else status.setStatus(name, result.status, result.reason, result.shows);
            window.WIA.report?.result(name, result);
          }
          more = answer.more ?? null;
          if (answer.stopped) return stoppedAt(prepared, Object.fromEntries(Object.entries(left).filter(([name]) => !answer.results[name])), written, state);
        }
      }
      if (more) {
        extra = [...extra, ...more.filter((q) => !extra.some((e) => e.name === q.name))];
        continue;
      }
      if (stepped && filledAny) {
        await sleep(FOLLOW_UP_WAIT);
        continue;
      }
      return { ...prepared, written: [...written.values()], state };
    }
    } finally {
      progress.end();
    }
  }

  /**
   * The student pressed Stop autofill: the fields not reached are left
   * empty for them and the panel says the fill stopped. The Plan is kept, so
   * the rows and cards show as after any fill; `stopped` ends a Workday walk.
   */
  function stoppedAt(prepared, left, written, state) {
    // Still "pending" (not reached), not "skipped" (which says the form doesn't ask it): a required one on the page needs the student.
    for (const name of Object.keys(left)) status.setStatus(name, "pending", "Not filled: you stopped the fill.");
    note("_stopped", "You stopped the fill", "WorkIt left the rest of this page for you.");
    return { ...prepared, written: [...written.values()], state, stopped: true };
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
  // Every fill asks: a batch tab and a tab tracked on WorkIt (KAN-424) are watched; any other keeps its key with the
  // background until Track on WorkIt starts the watch (background.js batch/watch).
  watchSubmit();
  // Holds the student's Submit while something on the page is still open, and says what (submit-warning.js).
  if (batch) window.WIA.submitWarning();

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
   * state rests on whenever the student edits the form (types, changes or
   * clicks anything): every required
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
    const workday = Boolean(window.WIA.steps); // a stepped system's tab (Workday, Oracle)
    let stopped = false;
    const required = () => (workday ? undefined : flagEmptyRequired(prepared));
    const byName = new Map(prepared.questions.map((q) => [q.name, q]));
    const inWords = (q) => q.kind === "text" || q.kind === "textarea";
    const written = new Set([...prepared.written.map((q) => q.name), ...(prepared.plan.banked ?? []).filter(inWords).map((q) => q.name)]);
    writing.adopt(written);
    let timer;
    const check = async () => {
      if (writing.busy() || stopped) return;
      const rows = status.summary().fields.filter((r) => byName.has(r.key) && (r.required || r.status === "failed" || written.has(r.key) || window.WIA.guessCard?.watched(r.key)));
      if (!rows.length) return required();
      const answer = await send({ type: "fill/read", site: prepared.site, questions: prepared.questions, names: rows.map((r) => r.key), state: prepared.state });
      if (!answer.ok || writing.busy() || stopped) return;
      for (const row of rows) {
        const shown = answer.shows[row.key];
        if (!isEmpty(shown)) {
          // A failed field still showing what it showed as it failed (card-failed.js read it) is not the student's answer.
          if (JSON.stringify(shown) !== JSON.stringify(row.shows) || (row.status !== "filled" && row.shows === undefined)) {
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
    // A click too: a dropdown answered with the mouse alone (Greenhouse's react-select) fires no input or change.
    const EDITS = ["input", "change", "click"];
    for (const type of EDITS) document.addEventListener(type, edited, true);
    return () => {
      stopped = true;
      clearTimeout(timer);
      for (const type of EDITS) document.removeEventListener(type, edited, true);
    };
  }

  /** The failed-field cards' view of a Plan (card-failed.js): read a field back, or fill its planned answer again, alone. */
  const fixesOf = (prepared) => ({
    site: prepared.site,
    answers: prepared.answers,
    questions: prepared.questions,
    async read(names) {
      const answer = await send({ type: "fill/read", site: prepared.site, questions: prepared.questions, names, state: prepared.state });
      return answer.ok ? answer.shows : {};
    },
    async put(name) {
      const answer = await send({
        type: "fill/page", site: prepared.site, questions: prepared.questions, answers: { [name]: prepared.answers[name] }, accepted: prepared.plan.accepted, state: prepared.state,
      });
      return (answer.ok ? answer.results[name] : null) ?? { status: "failed", reason: answer.error ?? "WorkIt couldn't fill it." };
    },
  });

  // A stepped system (steps.js): Workday, Oracle.
  const workday = window.WIA.steps;
  if (!workday) {
    // THE PANEL GOES ON THE PAGE ONCE THE FILL IS DONE, not before. Greenhouse's
    // React app takes over the whole document as it starts up (hydration);
    // a node it didn't render, the panel's, made it draw the form again,
    // which dropped what was already typed: with five batch tabs starting at
    // once, the first box filled read back empty in 1 to 10 forms of 50. With
    // the panel mounted after the fill: 0 in 50 (KAN-370). The engine waits
    // for the form's start-up before it types, so by now it is over.
    let prepared = await fillShown();
    // SmartRecruiters: its first page, then its screening questions (smartrecruiters.js presses Next, never Submit).
    if (prepared?.site === "smartrecruiters" && (await window.WIA.smartRecruitersNext?.(prepared))) prepared = (await fillShown()) ?? prepared;
    if (prepared) await flagEmptyRequired(prepared);
    if (prepared) window.WIA.failedCard.use(fixesOf(prepared));
    if (prepared) window.WIA.resumeTab?.use(fixesOf(prepared));
    overlay.mount(panel);
    if (prepared) window.WIA.answersTab?.use(prepared);
    window.WIA.phase = prepared ? "filled" : "stopped";
    overlay.refresh(); // the checklist settles: red, then amber, first (groups.js)
    window.WIA.running = false;
    report();
    if (prepared) writing.offer(prepared);
    if (prepared) offerSelfId(prepared);
    // Outside a batch too (KAN-396): the primary button turns Ready to submit once the student answered what was open.
    if (prepared) watchEdits(prepared);
    answerTheWalk();
    return;
  }

  // A stepped system: each step as it shows, until the step whose button sends. Its
  // pages aren't hydrated, and the panel tells the student to sign in (Workday), or to
  // enter their email at Oracle's gate, first.
  // A step that came as a new page shows its line at once, not an empty panel, while it waits to fill (KAN-401).
  if (workday.step()) note("_step", `${workday.name}: ${workday.step()}`, "Filling this step…", false, true);
  overlay.mount(panel);
  answerTheWalk();
  // Oracle's closed job says so on its page, where no application starts (closed-posting.js).
  if (!workday.step() && workday !== window.WIA.workday && window.WIA.closedPosting?.()) {
    note("_closed", "This job is closed", "It is no longer accepting applications, so there is nothing to fill. Pick another job.");
    window.WIA.phase = "stopped";
    window.WIA.running = false;
    report();
    return;
  }
  if (!workday.step()) {
    note("_step", workday.waiting.title, workday.waiting.reason);
    window.WIA.phase = "step";
    report();
    // Oracle's email gate: the student's, with a line in the panel; nothing on it is typed or pressed.
    if (workday.watchGate) {
      workday.watchGate((reason) => {
        status.reset();
        note("_step", workday.waiting.title, reason);
        window.WIA.phase = "step";
        report();
      });
    }
  }
  if (!workday.step() && workday === window.WIA.workday) {
    // The student's Start batch is the press of Apply (KAN-369): a batch tab starts the application itself.
    if (batch) {
      workday.watchStart((reason) => {
        status.reset();
        note("_step", "Starting the application", reason);
        report();
      });
    }
    workday.watchSignIn((reason) => {
      status.reset();
      note("_step", "Sign in to continue", reason);
      window.WIA.phase = "step";
      report();
    }, (onAllow) => overlay.askWorkdayAccounts({ onAllow }));
  }
  let step = await workday.stepAfter("");
  for (;;) {
    await workday.quiet();
    const shownId = workday.stepId(); // told from a next step of the same name by its number
    window.WIA.phase = "filling";
    status.reset();
    // Never an empty panel between steps (KAN-401): the step's line at once, its rows as it fills.
    note("_step", `${workday.name}: ${step}`, "Filling this step…", false, true);
    const prepared = await fillShown(workday.filledBefore());
    // A step WorkIt couldn't plan is the student's: the walk never presses on it, and the next step shows filled.
    if (prepared?.unplanned !== undefined) {
      status.reset();
      note("_step", "WorkIt couldn't fill this step", `${prepared.unplanned}Answer it yourself, then press ${workday.nextLabel}. WorkIt fills the next step when it shows.`, true);
      window.WIA.phase = "step";
      window.WIA.primary?.refresh();
      report();
      step = await workday.stepAfter(step);
      continue;
    }
    if (!prepared) {
      window.WIA.phase = "stopped";
      window.WIA.running = false;
      report();
      return;
    }
    const last = prepared.step.review || prepared.step.sends;
    // Fill to Review (workday-walk.js): a step with nothing for the student is saved with its own button.
    const toReview = window.WIA.toReview;
    // News, not a thing that needs the student: the bottom button carries the step's next press (decision 1700).
    note("_step", `${workday.name}: ${step}`, last
      ? (toReview.on() ? toReview.REVIEW_NOTE : "This is the last step. Check the whole application, then submit it yourself.")
      : `Check this step, then press ${workday.nextLabel}. WorkIt fills the next step when it shows.`, false, true);
    window.WIA.failedCard.use(fixesOf(prepared));
    window.WIA.answersTab?.use(prepared);
    window.WIA.resumeTab?.use(fixesOf(prepared));
    writing.offer(prepared);
    offerSelfId(prepared);
    const stopEdits = watchEdits(prepared);
    window.WIA.phase = last ? "last" : "step";
    overlay.refresh(); // the checklist settles: red, then amber, first (groups.js)
    window.WIA.primary?.refresh();
    report();
    if (last || prepared.stopped) return;
    const goOn = async () => {
      await flagEmptyRequired(prepared);
      const why = await toReview.leave(shownId, { fields: status.summary().fields, selfIdWaits: Boolean(selfIdWaiting) });
      if (!why || (workday.step() && workday.stepId() !== shownId)) return; // another step shows (none, as on Workday's error page, isn't one)
      note("_step", toReview.STOPPED, why);
      report();
    };
    if (toReview.on()) await goOn();
    else toReview.offer(goOn);
    step = await workday.stepAfter(step);
    stopEdits?.();
  }
})();

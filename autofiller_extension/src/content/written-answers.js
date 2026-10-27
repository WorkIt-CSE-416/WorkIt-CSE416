// The questions a form needs written (KAN-377, KAN-379, KAN-387), for the
// fill (content-script.js): their rows on the panel, their writing (the
// essay route's Generate, or in a batch tab the student's own Claude
// through the connector, or the student's paste on Written Answers), and
// the student's edits of them, whose own words are saved for later forms.
// Loaded before content-script.js (shared/content-scripts.js), as
// window.WIA.writtenAnswers, which makes one per fill.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  // The essay-answer route's limits (backend/app/schemas/essay_answer.py).
  const QUESTION_MAX = 500;
  const NAME_MAX = 200;
  const MIN_LENGTH = 50;
  const MAX_LENGTH = 5000; // a box that takes more (Workable's cover letter: 200000) asks for this much
  const WRITE_IT = "Write this answer yourself.";
  const TRIGGER = window.WIA.overlay.CLAUDE_TRIGGER;
  // Each row waiting for the student's Claude also has the overlay's Write with Claude.
  const WAIT_FOR_CLAUDE = `Waiting for your Claude: run "${TRIGGER}" in Claude, or write it yourself.`;
  // The same, ending in a link to the webapp's Written Answers page (KAN-385), where a student without Claude pastes answers.
  const WAIT_OR_PASTE = `Waiting for your Claude: run "${TRIGGER}" in Claude, write it yourself, or paste it in`;
  const NOT_NEEDED = "Not needed: your answer to the question before it doesn't call for it.";
  // How the API opens a fact the student's Claude asks for (KAN-369, backend written.py's ASK).
  const ASK = "Essay fact: ";
  // How often a batch tab asks whether the student's Claude saved an answer (KAN-377).
  const ANSWER_POLL = 10_000;
  // Sooner while the answers are new (KAN-369): the student's Claude often saves one within a minute of the
  // questions (write early sent most before the tab opened), so the tab asks every ANSWER_POLL_SOON ms for SOON_FOR ms.
  const ANSWER_POLL_SOON = 2_000;
  const SOON_FOR = 60_000;
  /** How long to wait before asking again, for a wait that began at `since`. */
  const answerPoll = (since) => (Date.now() - since < SOON_FOR ? ANSWER_POLL_SOON : ANSWER_POLL);
  // How many polls a tab waits for the pre-submit review's verdict (KAN-369): 30 minutes, then it stops asking.
  const REVIEW_POLLS = 180;
  // The connector's limits on a question and an answer (backend/app/schemas/applications.py).
  const LABEL_MAX = 2000;
  const FIELD_NAME_MAX = 200;
  const ANSWER_MAX = 10_000;
  const DESCRIPTION_MAX = 1000; // a question's help text (backend schemas/applications.py, DESCRIPTION_MAX)
  // How long the student's typing in a written answer pauses before their words are saved (KAN-379).
  const OWN_PAUSE = 2_000;

  /**
   * The written answers of one fill. `batch`: the fill is one of batch
   * apply's tabs, where the student's Claude writes them.
   * @param {{ batch: boolean }} options
   */
  function writtenAnswers({ batch }) {
    const { status, overlay } = window.WIA;
    const send = window.WIA.ui.ask;
    const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
    // The Written Answers link ({ text, href }), asked of the background once; null when it couldn't say.
    let answersPage;
    // How many fills of a written answer are under way: their typing is WorkIt's, not the student's.
    let fillingWritten = 0;

    /**
     * Puts the questions that need writing on the panel, each one `isNew`
     * says the panel lacks: in a batch tab waiting for the student's
     * Claude (with the Written Answers link, KAN-385), else for Generate.
     */
    async function showRows(questions, isNew) {
      if (batch && questions.length && answersPage === undefined) {
        const page = await send({ type: "batch/answers-page" }).catch(() => null);
        answersPage = page?.ok ? { text: "Written Answers", href: page.url } : null;
      }
      for (const q of questions) {
        if (batch) {
          if (!isNew(q.name)) continue;
          status.register(q.name, q.label, q.required);
          if (answersPage) status.setStatus(q.name, "needs_generation", WAIT_OR_PASTE, undefined, undefined, answersPage, true);
          else status.setStatus(q.name, "needs_generation", WAIT_FOR_CLAUDE, undefined, undefined, undefined, true);
          continue;
        }
        if (!isNew(q.name)) continue;
        status.register(q.name, q.label, q.required);
        status.setStatus(q.name, "needs_generation");
      }
    }

    /** Fills one answer that needed writing, through the engine, and shows how it went. `source`: who wrote it. */
    async function fillWritten(prepared, name, value, source = "ai") {
      fillingWritten += 1;
      const answer = await send({ type: "fill/page", site: prepared.site, questions: prepared.questions, answers: { [name]: value }, state: prepared.state })
        .finally(() => (fillingWritten -= 1));
      const result = answer.ok ? answer.results[name] ?? { status: "failed", reason: "The form changed before this was filled" } : { status: "failed", reason: answer.error };
      // See cover letter (letter-preview.js), before the row draws: an upload's text is the PDF's, which the form can't show.
      const upload = prepared.questions.find((q) => q.name === name)?.kind === "file";
      if (result.status === "filled") window.WIA.letterPreview?.filled(name, value, upload ? String(result.shows) : undefined);
      status.setStatus(name, result.status, result.reason, result.shows, source);
      if (result.status === "filled" && typeof result.shows === "string") workitFilled.set(name, { text: result.shows, source });
    }

    /**
     * The written answers WorkIt filled that aren't the student's own words
     * (their Claude's, the essay route's, a saved one of their Claude's), by
     * field: what was filled, and who wrote it. A student's edit of one stays
     * that writer's (KAN-379): only words they wrote into a field WorkIt
     * didn't fill, or that replace what it filled, count as their own.
     */
    const workitFilled = new Map();

    /** Words in a row WorkIt's checks count as copied (backend checks.py's copy run): sharing one keeps an edit WorkIt's. */
    const RUN = 5;
    /** Whether `edited` replaces `filled` wholesale: no run of RUN words (or all of a shorter `filled`) left in it. */
    function replaces(filled, edited) {
      const words = (text) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
      const before = words(filled);
      const after = words(edited).join(" ");
      const n = Math.min(RUN, before.length);
      if (!n) return true;
      for (let i = 0; i + n <= before.length; i += 1) if (` ${after} `.includes(` ${before.slice(i, i + n).join(" ")} `)) return false;
      return true;
    }

    // The fact each waiting row's question shows (KAN-369), by field: what the student's Claude asked, or "" for none.
    const asked = new Map();

    /**
     * A waiting row whose answer needs a fact only the student can give
     * (KAN-369, an Essay fact: their Claude asked rather than invent it)
     * says what it asked, with the Written Answers link where they answer
     * it; once they have, the row waits for their Claude again.
     */
    function showAsk(name, ask) {
      if ((asked.get(name) ?? "") === (ask ?? "") || rowStatus(name) !== "needs_generation") return;
      asked.set(name, ask ?? "");
      if (!ask) {
        if (answersPage) status.setStatus(name, "needs_generation", WAIT_OR_PASTE, undefined, undefined, answersPage, true);
        else status.setStatus(name, "needs_generation", WAIT_FOR_CLAUDE, undefined, undefined, undefined, true);
        return;
      }
      const question = ask.startsWith(ASK) ? ask.slice(ASK.length) : ask;
      const reason = `Your Claude needs a fact from you first: ${question}`;
      if (answersPage) status.setStatus(name, "needs_generation", `${reason} Answer it on`, undefined, undefined, answersPage, true);
      else status.setStatus(name, "needs_generation", `${reason} Answer it on WorkIt's Written Answers page, or write this answer yourself.`, undefined, undefined, undefined, true);
    }

    /** The current status of one row, or undefined. */
    const rowStatus = (key) => status.summary().fields.find((r) => r.key === key)?.status;

    /**
     * A batch tab's questions that need writing (KAN-377): sent to WorkIt for
     * the student's own Claude, which saves its answers through the connector.
     * The tab then asks for the saved answers every ANSWER_POLL ms (sooner in the first minute) and fills
     * each new one through the engine, until none is left; the tab's group
     * follows (report()). A question the student answered first keeps their
     * answer. It then asks on until the student's Claude's pre-submit review
     * has read every answer (KAN-369, awaitReview).
     */
    async function awaitClaude(prepared) {
      claudeFill = prepared;
      const waiting = new Set(prepared.written.map((q) => q.name));
      // max_length: the field's own limit, as the Fill engine read it from the form; WorkIt refuses a longer answer.
      const questions = prepared.written.map((q) => ({
        name: q.name.slice(0, FIELD_NAME_MAX),
        label: q.label.slice(0, LABEL_MAX),
        required: Boolean(q.required),
        max_length: q.max_length ?? null,
        // The help text under the label ("3-4 sentences", "250 words max"), as the engine read it: the writer's length rules read it.
        ...(q.description?.trim() ? { description: q.description.trim().slice(0, DESCRIPTION_MAX) } : {}),
        // A one-off choice (KAN-369): Claude picks among its options.
        ...(q.kind ? { kind: q.kind, options: q.options } : {}),
      }));
      let reply = await send({ type: "batch/questions", questions }).catch((error) => ({ ok: false, error: error.message }));
      if (!reply.ok) {
        for (const q of prepared.written) status.setStatus(q.name, q.required ? "failed" : "skipped", WRITE_IT);
        return;
      }
      offerClaude();
      window.WIA.waitingCard?.onSave((name, answer) => paste(prepared, name, answer));
      let byClaude = false;
      let answered = false;
      const since = Date.now();
      for (;;) {
        const rows = reply.ok ? reply.questions : [];
        for (const { name, answer, ask } of rows) {
          if (!answer && waiting.has(name)) showAsk(name, ask);
          if (!answer || !waiting.has(name)) continue;
          waiting.delete(name);
          if (rowStatus(name) !== "filled") {
            await fillWritten(prepared, name, answer, "claude");
            byClaude = true;
            // Just arrived: Next Thing walks to it until the student has seen it once (batch-tab.js).
            if (rowStatus(name) === "filled") (window.WIA.unseenAnswers ??= new Set()).add(name);
          }
        }
        for (const name of waiting) if (rowStatus(name) === "filled") waiting.delete(name);
        if (waiting.size) await settleFollowUps(prepared, waiting);
        if (!waiting.size && !answered) {
          answered = true;
          offerSamples(byClaude);
        }
        if (answered) {
          awaitReview(reply);
          return;
        }
        await sleep(answerPoll(since));
        reply = await send({ type: "batch/answers" }).catch((error) => ({ ok: false, error: error.message }));
      }
    }

    /**
     * An answer the student pasted in a waiting row's card (card-waiting.js):
     * saved through the Written Answers route (the same checks as their
     * Claude's, by="student", not their own words), then filled at once.
     * The tab's next poll finds the row filled and leaves it.
     */
    async function paste(prepared, name, answer) {
      const reply = await send({ type: "batch/paste", name: name.slice(0, FIELD_NAME_MAX), answer: answer.slice(0, ANSWER_MAX) })
        .catch((error) => ({ ok: false, error: error.message }));
      if (!reply?.ok) return { saved: false, reasons: [], error: `WorkIt didn't save it: ${reply?.error ?? "no answer"}` };
      if (!reply.saved) return { saved: false, reasons: reply.reasons ?? [], error: reply.error };
      if (rowStatus(name) !== "filled") await fillWritten(prepared, name, answer, "pasted");
      return { saved: true };
    }

    // The answers whose review verdict this tab has seen: an edit of one waits for its new verdict.
    const reviewedNames = new Set();
    // Whether a review poll is under way, how many polls it has left, and whether an edit came after its last answers.
    let reviewing = false;
    let pollsLeft = 0;
    let stale = false;

    /**
     * Asks every ANSWER_POLL ms (from `reply`, the answers just read, if any)
     * until the student's Claude's pre-submit review has read every answer
     * (KAN-369), and puts each flag it gives on the row of the answer it
     * read, while the field still shows that answer. Not for a student with
     * no connector added, whose answers no Claude reviews, and at most
     * REVIEW_POLLS polls. Called again after the student's edit of a
     * reviewed answer, it waits for that edit's verdict.
     */
    async function awaitReview(reply = null) {
      pollsLeft = REVIEW_POLLS;
      stale = reply === null;
      if (reviewing) return;
      reviewing = true;
      try {
        for (;;) {
          const rows = reply?.ok ? reply.questions : [];
          for (const { name, answer, reviewed, flag, flag_quote: quote, flag_hard: hard } of rows) {
            if (!reviewed) continue;
            reviewedNames.add(name);
            const row = status.summary().fields.find((r) => r.key === name);
            if (row?.status === "filled" && row.shows === answer) status.flag(name, flag ?? undefined, { quote, hard });
          }
          if (reply?.ok && !stale && rows.every((q) => !q.answer || q.reviewed)) return;
          if (pollsLeft <= 0) return;
          if (pollsLeft === REVIEW_POLLS) {
            const added = await send({ type: "connector/added" }).catch(() => null);
            if (!added?.ok || !added.added) return;
          }
          pollsLeft -= 1;
          if (reply) await sleep(ANSWER_POLL);
          stale = false;
          reply = await send({ type: "batch/answers" }).catch((error) => ({ ok: false, error: error.message }));
        }
      } finally {
        reviewing = false;
      }
    }

    /**
     * The follow-ups still `waiting` that the answers now on the form don't
     * call for (decision 223): a parent the Plan left to the student's Claude
     * ("Are you currently working with Amplify?") is answered after the Plan,
     * by their Claude or by them, so only then can "If a contingent worker,
     * which agency...?" be ruled out. Each one ruled out stops waiting, left
     * blank, or N/A where the form asks for it.
     */
    async function settleFollowUps(prepared, waiting) {
      const answers = { ...prepared.answers };
      for (const row of status.summary().fields) if (row.status === "filled" && row.shows !== undefined) answers[row.key] = row.shows;
      const reply = await send({ type: "fill/moot", questions: prepared.questions, answers, names: [...waiting] }).catch(() => null);
      for (const [name, { answer }] of Object.entries(reply?.ok ? reply.moot : {})) {
        if (!waiting.delete(name)) continue;
        if (answer !== null) await fillWritten(prepared, name, answer, "guessed");
        else status.setStatus(name, "skipped", NOT_NEEDED);
      }
    }

    /**
     * The add-Claude step (KAN-387): on the batch's first question for the
     * student's Claude, once (the background decides, and skips a student who
     * already added the connector), the install link and what to do next.
     */
    async function offerClaude() {
      const answer = await send({ type: "moment/claude" }).catch(() => null);
      if (answer?.ok && answer.show) overlay.offerClaude({ url: answer.url });
    }

    /**
     * This tab's written questions are all answered (KAN-387): the background
     * says whether this was the batch's last, in a batch the student's Claude
     * wrote for, and this tab is the one to ask for writing samples (once).
     */
    async function offerSamples(byClaude) {
      const answer = await send({ type: "batch/written", byClaude }).catch(() => null);
      if (answer?.ok && answer.show) overlay.askSamples({ url: answer.url });
    }

    /** The Generate prompt for the questions that need a written answer, if any. */
    function offer(prepared) {
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
            const maxLength = q.max_length >= MIN_LENGTH ? Math.min(q.max_length, MAX_LENGTH) : null;
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

    const ownTimers = new Map();
    /**
     * Saves the student's words for a written question once their typing
     * pauses (KAN-379): the background keeps them as this application's
     * answer, so their Claude isn't asked for it, and for later forms. `own`:
     * their own words; false for their edit of an answer WorkIt filled, which
     * WorkIt checks as their Claude's (a refusal shows on the row, and the
     * edit isn't kept). Batch tabs only: only they have an application at WorkIt.
     */
    function keepOwn(question, answer, own) {
      if (!batch || !answer.trim() || answer.length > ANSWER_MAX) return;
      // Taken back with the captured notice's Undo (captured-notice.js): not saved again on this page.
      if (own && window.WIA.capturedNotice?.undone(question.name)) return;
      clearTimeout(ownTimers.get(question.name));
      ownTimers.set(question.name, setTimeout(async () => {
        ownTimers.delete(question.name);
        const saved = await send({ type: "batch/own-answer", name: question.name.slice(0, FIELD_NAME_MAX), label: question.label.slice(0, LABEL_MAX), answer, own })
          .catch((error) => ({ ok: false, error: error.message }));
        if (saved?.ok && reviewedNames.has(question.name)) awaitReview();
        if (saved?.ok && own) window.WIA.capturedNotice?.saved(question.name);
        if (!saved?.ok && !own) status.setStatus(question.name, "failed", `WorkIt didn't keep your edit: ${saved?.error ?? "no answer"}`, answer, workitFilled.get(question.name)?.source);
      }, OWN_PAUSE));
    }

    /**
     * The written answers among `names` that the Plan filled and that aren't
     * the student's own (a saved answer): an edit of one stays that answer's.
     */
    function adopt(names) {
      let adopted = false;
      for (const row of status.summary().fields)
        if (names.has(row.key) && row.status === "filled" && row.source && row.source !== "student" && typeof row.shows === "string") {
          workitFilled.set(row.key, { text: row.shows, source: row.source });
          window.WIA.letterPreview?.filled(row.key, row.shows);
          adopted = true;
        }
      // Their rows get See cover letter (letter-preview.js).
      if (adopted && window.WIA.letterPreview) overlay?.refresh?.();
    }

    /**
     * A written answer's field now shows `shown` (the student's edit, read
     * back): its row says who wrote it, and the student's words are kept
     * (keepOwn). `question`: the field's question.
     */
    function edited(row, shown, question) {
      // The field still shows the answer sent back to the student's Claude: not an edit.
      if (rewriting.get(row.key) === shown) return;
      const filled = workitFilled.get(row.key);
      if (filled && replaces(filled.text, shown)) workitFilled.delete(row.key); // rewritten: the student's now
      const edit = filled && workitFilled.has(row.key);
      const whose = { claude: "your Claude's", pasted: "your pasted" }[filled?.source] ?? "WorkIt's";
      if (edit) status.setStatus(row.key, "filled", `You edited ${whose} answer`, shown, filled.source);
      else status.setStatus(row.key, "filled", row.status === "filled" ? row.reason : "You answered this", shown, "student");
      // A flag holds while its sentence is still in the field (the flag card's Edit myself).
      if (row.flag && row.flagQuote && shown.includes(row.flagQuote)) status.flag(row.key, row.flag, { quote: row.flagQuote, hard: row.flagHard });
      keepOwn(question, shown, !edit);
    }

    // The answers sent back to the student's Claude (the flag card's Rewrite with Claude), by field: the text the field still shows.
    const rewriting = new Map();
    // The batch tab's fill, once its questions went to the student's Claude (awaitClaude).
    let claudeFill = null;

    /**
     * The flag card's Rewrite with Claude (card-flag.js), once WorkIt has
     * cleared the answer for the student's Claude: the row waits for it
     * (Write with Claude) and keeps its flag, so the tab still needs the
     * student, and the tab asks every ANSWER_POLL ms (sooner in the first minute) for the new answer and
     * fills it. It stops if the student writes the answer first.
     */
    async function rewrite(name) {
      const row = status.summary().fields.find((r) => r.key === name);
      if (!row?.flag || !claudeFill || rewriting.has(name)) return;
      rewriting.set(name, row.shows);
      status.setStatus(name, "needs_generation", WAIT_FOR_CLAUDE, row.shows, undefined, undefined, true);
      status.flag(name, row.flag, { quote: row.flagQuote, hard: row.flagHard, rewriting: true });
      try {
        const since = Date.now();
        while (rowStatus(name) === "needs_generation") {
          await sleep(answerPoll(since));
          const reply = await send({ type: "batch/answers" }).catch((error) => ({ ok: false, error: error.message }));
          const answer = reply.ok ? reply.questions.find((q) => q.name === name)?.answer : null;
          if (!answer || rowStatus(name) !== "needs_generation") continue;
          rewriting.delete(name);
          await fillWritten(claudeFill, name, answer, "claude");
          awaitReview();
        }
      } finally {
        rewriting.delete(name);
      }
    }

    const api = {
      showRows,
      offer,
      adopt,
      edited,
      rewrite,
      // Whether WorkIt is filling a written answer now: the typing is its own, not the student's.
      busy: () => fillingWritten > 0,
    };
    // The flag card reaches this fill's rewrite (card-flag.js).
    if (batch) window.WIA.writing = api;
    return api;
  }

  window.WIA.writtenAnswers = writtenAnswers;
})();

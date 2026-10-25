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
  const WAIT_FOR_CLAUDE = "Waiting for your Claude: run \"Write my WorkIt answers\" in Claude, or write it yourself.";
  // The same, ending in a link to the webapp's Written Answers page (KAN-385), where a student without Claude pastes answers.
  const WAIT_OR_PASTE = "Waiting for your Claude: run \"Write my WorkIt answers\" in Claude, write it yourself, or paste it in";
  // How often a batch tab asks whether the student's Claude saved an answer (KAN-377).
  const ANSWER_POLL = 10_000;
  // How many polls a tab waits for the pre-submit review's verdict (KAN-369): 30 minutes, then it stops asking.
  const REVIEW_POLLS = 180;
  // The connector's limits on a question and an answer (backend/app/schemas/applications.py).
  const LABEL_MAX = 2000;
  const FIELD_NAME_MAX = 200;
  const ANSWER_MAX = 10_000;
  // How long the student's typing in a written answer pauses before their words are saved (KAN-379).
  const OWN_PAUSE = 2_000;

  /**
   * The written answers of one fill. `batch`: the fill is one of batch
   * apply's tabs, where the student's Claude writes them.
   * @param {{ batch: boolean }} options
   */
  function writtenAnswers({ batch }) {
    const { status, overlay } = window.WIA;
    const send = (message) => chrome.runtime.sendMessage(message);
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
          if (answersPage) status.setStatus(q.name, "needs_generation", WAIT_OR_PASTE, undefined, undefined, answersPage);
          else status.setStatus(q.name, "needs_generation", WAIT_FOR_CLAUDE);
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

    /** The current status of one row, or undefined. */
    const rowStatus = (key) => status.summary().fields.find((r) => r.key === key)?.status;

    /**
     * A batch tab's questions that need writing (KAN-377): sent to WorkIt for
     * the student's own Claude, which saves its answers through the connector.
     * The tab then asks for the saved answers every ANSWER_POLL ms and fills
     * each new one through the engine, until none is left; the tab's group
     * follows (report()). A question the student answered first keeps their
     * answer. It then asks on until the student's Claude's pre-submit review
     * has read every answer (KAN-369, awaitReview).
     */
    async function awaitClaude(prepared) {
      const waiting = new Set(prepared.written.map((q) => q.name));
      // max_length: the field's own limit, as the Fill engine read it from the form; WorkIt refuses a longer answer.
      const questions = prepared.written.map((q) => ({
        name: q.name.slice(0, FIELD_NAME_MAX),
        label: q.label.slice(0, LABEL_MAX),
        required: Boolean(q.required),
        max_length: q.max_length ?? null,
        // A one-off choice (KAN-369): Claude picks among its options.
        ...(q.kind ? { kind: q.kind, options: q.options } : {}),
      }));
      let reply = await send({ type: "batch/questions", questions }).catch((error) => ({ ok: false, error: error.message }));
      if (!reply.ok) {
        for (const q of prepared.written) status.setStatus(q.name, q.required ? "failed" : "skipped", WRITE_IT);
        return;
      }
      offerClaude();
      let byClaude = false;
      let answered = false;
      for (;;) {
        const rows = reply.ok ? reply.questions : [];
        for (const { name, answer } of rows) {
          if (!answer || !waiting.has(name)) continue;
          waiting.delete(name);
          if (rowStatus(name) !== "filled") {
            await fillWritten(prepared, name, answer, "claude");
            byClaude = true;
          }
        }
        for (const name of waiting) if (rowStatus(name) === "filled") waiting.delete(name);
        if (!waiting.size && !answered) {
          answered = true;
          offerSamples(byClaude);
        }
        if (answered) {
          awaitReview(reply);
          return;
        }
        await sleep(ANSWER_POLL);
        reply = await send({ type: "batch/answers" }).catch((error) => ({ ok: false, error: error.message }));
      }
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
          for (const { name, answer, reviewed, flag } of rows) {
            if (!reviewed) continue;
            reviewedNames.add(name);
            const row = status.summary().fields.find((r) => r.key === name);
            if (row?.status === "filled" && row.shows === answer) status.flag(name, flag ?? undefined);
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
      clearTimeout(ownTimers.get(question.name));
      ownTimers.set(question.name, setTimeout(async () => {
        ownTimers.delete(question.name);
        const saved = await send({ type: "batch/own-answer", name: question.name.slice(0, FIELD_NAME_MAX), label: question.label.slice(0, LABEL_MAX), answer, own })
          .catch((error) => ({ ok: false, error: error.message }));
        if (saved?.ok && reviewedNames.has(question.name)) awaitReview();
        if (!saved?.ok && !own) status.setStatus(question.name, "failed", `WorkIt didn't keep your edit: ${saved?.error ?? "no answer"}`, answer, workitFilled.get(question.name)?.source);
      }, OWN_PAUSE));
    }

    /**
     * The written answers among `names` that the Plan filled and that aren't
     * the student's own (a saved answer): an edit of one stays that answer's.
     */
    function adopt(names) {
      for (const row of status.summary().fields)
        if (names.has(row.key) && row.status === "filled" && row.source && row.source !== "student" && typeof row.shows === "string")
          workitFilled.set(row.key, { text: row.shows, source: row.source });
    }

    /**
     * A written answer's field now shows `shown` (the student's edit, read
     * back): its row says who wrote it, and the student's words are kept
     * (keepOwn). `question`: the field's question.
     */
    function edited(row, shown, question) {
      const filled = workitFilled.get(row.key);
      if (filled && replaces(filled.text, shown)) workitFilled.delete(row.key); // rewritten: the student's now
      const edit = filled && workitFilled.has(row.key);
      if (edit) status.setStatus(row.key, "filled", `You edited ${filled.source === "claude" ? "your Claude's" : "WorkIt's"} answer`, shown, filled.source);
      else status.setStatus(row.key, "filled", row.status === "filled" ? row.reason : "You answered this", shown, "student");
      keepOwn(question, shown, !edit);
    }

    return {
      showRows,
      offer,
      adopt,
      edited,
      // Whether WorkIt is filling a written answer now: the typing is its own, not the student's.
      busy: () => fillingWritten > 0,
    };
  }

  window.WIA.writtenAnswers = writtenAnswers;
})();

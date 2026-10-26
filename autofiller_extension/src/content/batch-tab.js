// A batch tab's side of batch apply (KAN-370, KAN-374, KAN-375), for the
// fill (content-script.js): it tells the background whether the tab is
// ready or needs the student ("batch/state") whenever that changes, answers
// Next Thing That Needs You's walk ("batch/flags", "batch/focus"), and
// watches for the student's own submit ("batch/watch"). Loaded before
// content-script.js (shared/content-scripts.js), as window.WIA.batchTab,
// which makes one per fill.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  /**
   * One fill's batch side. `batch`: the fill is one of batch apply's tabs
   * (else report() does nothing). `note(key, label, reason, failed, done)`:
   * puts a message row on the panel.
   * @param {{ batch: boolean, note: Function }} options
   */
  function batchTab({ batch, note }) {
    const { status, overlay } = window.WIA;
    const send = (message) => chrome.runtime.sendMessage(message);

    // The Fill engine's event for the student's submit (its SUBMIT_EVENT, then this tab's key); its
    // detail is the result as JSON. The key is made here, in the isolated world the page can't read, so
    // a page script can't send an event this tab believes (it doesn't know the name).
    const SUBMIT_KEY = crypto.randomUUID();
    const SUBMIT_EVENT = `fillengine:submit:${SUBMIT_KEY}`;

    /**
     * Whether a row needs the student: a note that asks something of them
     * (the Plan's, a Workday step, a failed fill or submit), a failed field,
     * a required one still waiting for an answer (its fill, or a written
     * answer), or an answer the review flagged. A required one "skipped" is
     * not: the form doesn't show it, or the answer before it doesn't call
     * for it (a required field the page shows empty has failed,
     * flagEmptyRequired). A row is a note by its `note`, never by its key:
     * Ashby's own fields are keyed "_systemfield_...".
     */
    const waiting = (r) => r.status === "pending" || r.status === "needs_generation";
    const needsYou = (r) => (r.note ? r.note === "todo" : r.status === "failed" || (r.required && waiting(r)) || Boolean(r.flag));

    // The guesses Next Thing That Needs You has shown the student, by key: once shown, a guess is theirs to
    // have checked. Kept on the page, as the walk is (answerTheWalk).
    const shownGuesses = (window.WIA.shownGuesses ??= new Set());
    /** A filled answer WorkIt guessed (the panel's "Guessed") that the walk hasn't shown the student yet. */
    const unchecked = (r) => !r.note && r.status === "filled" && r.source === "guessed" && !shownGuesses.has(r.key);
    // The answers from the student's Claude that just arrived (written-answers.js), until the walk has shown them.
    const unseenAnswers = (window.WIA.unseenAnswers ??= new Set());
    const unseen = (r) => !r.note && r.status === "filled" && unseenAnswers.has(r.key);
    /** A row waiting for the student's Claude: nothing for them to fix yet, so the walk visits it last. */
    const onClaude = (r) => r.status === "needs_generation" && Boolean(r.claude);

    /**
     * Whether this batch tab is "ready" (every field it needs shows an answer),
     * "failed" (the fill itself went wrong: an error note) or "needs_you": the
     * fill stopped (no Filler for this job system), a Workday step waits for
     * the student, a field failed, a required one is unanswered, or the Plan
     * left something to the student (a note).
     */
    function tabState() {
      const phase = window.WIA.phase;
      // The fill itself went wrong (the Plan failed, Workday's error page): failed, not a question for the student.
      if (status.summary().fields.some((r) => r.key === "_error" && r.status === "failed")) return "failed";
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
      if (status.summary().fields.find((r) => r.key === key)?.note) return null;
      const name = CSS.escape(key);
      return (
        document.getElementById(key) ??
        document.querySelector(`[name="${name}"], [data-field-path="${name}"], [data-ui="${name}"], [data-testid="${name}"]`)
      );
    }

    /**
     * The walk's view of this tab: `order`, every row's key in the order its
     * field stands on the page (notes and fields the page doesn't show last),
     * and `keys`, those of them that need the student, and the guesses the
     * walk hasn't shown them (a guess doesn't keep the tab from Ready:
     * the walk shows it once, for the student to check), and the answers
     * from their Claude that just arrived, also once; `late`, those of `keys`
     * waiting for their Claude, which the walk visits after everything else
     * in the batch. The walk places a row
     * it went to by `order`, so it goes on after it once the row is answered.
     */
    function flagged() {
      const fields = status.summary().fields;
      const rows = fields.map((r) => ({ key: r.key, field: fieldOf(r.key) }));
      const placed = rows.filter((r) => r.field).sort((a, b) => (a.field.compareDocumentPosition(b.field) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      const order = [...placed, ...rows.filter((r) => !r.field)].map((r) => r.key);
      const needing = new Set(fields.filter((r) => needsYou(r) || unchecked(r) || unseen(r)).map((r) => r.key));
      const late = new Set(fields.filter(onClaude).map((r) => r.key));
      const keys = order.filter((key) => needing.has(key));
      return { order, keys, late: keys.filter((key) => late.has(key)) };
    }

    /** Brings a flagged row's field into view and focuses it, and marks its row on the panel. A guess is then seen. */
    function show(key) {
      const row = status.summary().fields.find((r) => r.key === key);
      if (row && unchecked(row)) shownGuesses.add(key);
      unseenAnswers.delete(key);
      const field = fieldOf(key);
      if (field) {
        field.scrollIntoView({ block: "center" });
        const control = field.matches("input, select, textarea, button, [tabindex]") ? field : field.querySelector("input, select, textarea, button, [tabindex]");
        control?.focus({ preventScroll: true });
        // A flagged answer's sentence is selected in its field (card-flag.js).
        window.WIA.flagCard?.select(control, row);
      }
      overlay.setCurrent(key);
    }

    /**
     * Batch apply's "Next Thing That Needs You" (background/batch.js walks the
     * batch's tabs): this tab answers which of its rows need the student
     * ("batch/flags") and shows one when it is next ("batch/focus"). The
     * listener is added once per page and answers from the latest fill's
     * rows (`window.WIA.walk`): injected again (the fill after a human
     * check, a second Autofill), the page has a new status and panel.
     */
    function answerTheWalk() {
      window.WIA.walk = { flagged, show };
      overlay.offerNext(async () => {
        const answer = await send({ type: "batch/next" }).catch(() => null);
        if (!answer?.ok) return "WorkIt couldn't look through the batch. Try again.";
        return answer.done ? "Nothing else needs you." : null;
      });
      if (window.WIA.walking) return;
      window.WIA.walking = true;
      chrome.runtime.onMessage.addListener((message, _sender, reply) => {
        if (message?.type === "batch/flags") reply(window.WIA.phase === "filling" ? { order: [], keys: [], late: [] } : window.WIA.walk.flagged());
        else if (message?.type === "batch/focus") {
          window.WIA.walk.show(message.key);
          reply({ shown: true });
        }
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

    /** Watches the page for the student's submit, from before the fill: the student may submit any time. */
    function watchSubmit() {
      document.addEventListener(SUBMIT_EVENT, async (event) => {
        const result = JSON.parse(event.detail);
        if (!result.submitted) {
          note("_submit", "Your application wasn't sent", result.reason, true);
          return;
        }
        const answer = await send({ type: "batch/submitted" }).catch((error) => ({ ok: false, error: error.message }));
        if (answer?.ok && answer.applied) note("_submit", "Application sent", "WorkIt marked it Applied.", false, true);
        // The page said so, but WorkIt didn't see the job system take its submit request.
        else if (answer?.ok) note("_submit", "Did your application go out?", "WorkIt couldn't confirm it with the job system. If it was sent, mark it Applied on WorkIt's Applications page.", true);
        else note("_submit", "Application sent, but WorkIt didn't mark it Applied", `Mark it Applied on WorkIt's Applications page. (${answer?.error ?? "No answer"})`, true);
      });
      send({ type: "batch/watch", key: SUBMIT_KEY }).catch(() => {});
    }

    status.subscribe(report);
    return { report, answerTheWalk, watchSubmit };
  }

  window.WIA.batchTab = batchTab;
})();

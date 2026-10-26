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
    const send = window.WIA.ui.ask;

    // The Fill engine's event for the student's submit (its SUBMIT_EVENT, then this tab's key); its
    // detail is the result as JSON. The key is made here, in the isolated world the page can't read, so
    // a page script can't send an event this tab believes (it doesn't know the name).
    const SUBMIT_KEY = crypto.randomUUID();
    const SUBMIT_EVENT = `fillengine:submit:${SUBMIT_KEY}`;

    // Whether a row needs the student (red), is a filled answer for them to check (amber: a guess, or an
    // answer from their Claude the walk hasn't shown), or waits for their Claude: lib-status.js's one rule
    // (KAN-369 Q7), the same the panel's list and counts use.
    const { needsYou, toCheck, waitingOnClaude } = status;
    // The answers from the student's Claude that just arrived (written-answers.js), until the walk has shown them.
    const unseenAnswers = (window.WIA.unseenAnswers ??= new Set());

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
      return status.summary().fields.some((r) => needsYou(r) || waitingOnClaude(r)) ? "needs_you" : "ready";
    }

    /**
     * The form's field for a question, by the job system's own field id: an
     * element's id (Greenhouse, Lever's cards), its name (Lever), or the
     * attribute Ashby, Workable or Rippling mark a field's box with; on
     * Workday, whose keys are "<step> / <label>", the step shown's field by
     * its label (workday.js's fieldOf). Null for a row that is not a field,
     * or a field the page doesn't show.
     */
    function fieldOf(key) {
      if (status.summary().fields.find((r) => r.key === key)?.note) return null;
      if (window.WIA.steps) return window.WIA.steps.fieldOf(key);
      const name = CSS.escape(key);
      return (
        document.getElementById(key) ??
        document.querySelector(`[name="${name}"], [data-field-path="${name}"], [data-ui="${name}"], [data-testid="${name}"]`)
      );
    }

    /**
     * The walk's view of this tab: `order`, every row's key in the order its
     * field stands on the page (notes and fields the page doesn't show last),
     * and `keys`, the rows the walk goes to, in its order: first those that
     * need the student (red), then the answers for them to check (amber: the
     * guesses they haven't confirmed, which don't keep the tab from Ready,
     * and the answers from their Claude that just arrived, once), then those
     * waiting for their Claude, each in page order. `check` and `late` name
     * the amber ones and those waiting for Claude; the batch's walk visits
     * every tab's red ones before any amber, and those waiting last. The walk
     * places a row it went to by `order` and its tier, so it goes on after it
     * once the row is answered.
     */
    function flagged() {
      const fields = status.summary().fields;
      const rows = fields.map((r) => ({ key: r.key, field: fieldOf(r.key) }));
      const placed = rows.filter((r) => r.field).sort((a, b) => (a.field.compareDocumentPosition(b.field) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      const order = [...placed, ...rows.filter((r) => !r.field)].map((r) => r.key);
      const byKey = new Map(fields.map((r) => [r.key, r]));
      const tier = (test) => order.filter((key) => test(byKey.get(key)));
      const red = tier(needsYou);
      const check = tier((r) => !needsYou(r) && toCheck(r));
      const late = tier((r) => !needsYou(r) && waitingOnClaude(r));
      return { order, keys: [...red, ...check, ...late], check, late };
    }

    /** A row's tier in the walk: 0 needs the student, 1 to check, 2 waiting for their Claude. */
    const tierOf = (view, key) => (view.late.includes(key) ? 2 : view.check.includes(key) ? 1 : 0);

    /** Brings a row's field into view and focuses it, and marks its row on the panel; false when the page doesn't show it. */
    function show(key) {
      const row = status.summary().fields.find((r) => r.key === key);
      unseenAnswers.delete(key);
      const field = fieldOf(key);
      if (field) {
        field.scrollIntoView({ block: "center" });
        // A ring for a few seconds, and a dot on the field while it still needs the student (marks.js).
        window.WIA.marks?.ring(field);
        if (row && needsYou(row)) window.WIA.marks?.dot(key, field, () => status.summary().fields.some((r) => r.key === key && needsYou(r)));
        const control = field.matches("input, select, textarea, button, [tabindex]") ? field : field.querySelector("input, select, textarea, button, [tabindex]");
        control?.focus({ preventScroll: true });
        // A flagged answer's sentence is selected in its field (card-flag.js).
        window.WIA.flagCard?.select(control, row);
      }
      overlay.setCurrent(key);
      return Boolean(field);
    }

    /**
     * Next Thing (the panel's primary button, primary.js). In a batch tab,
     * batch apply's walk (background/next-needs-you.js walks the batch's
     * tabs): this tab answers which of its rows need the student
     * ("batch/flags") and shows one when it is next ("batch/focus"). The
     * listener is added once per page and answers from the latest fill's
     * rows (`window.WIA.walk`): injected again (the fill after a human
     * check, a second Autofill), the page has a new status and panel.
     * Outside a batch (KAN-396), this page's own rows in page order, after
     * the one it last went to, then "Nothing else needs you." and again
     * from the first.
     */
    function answerTheWalk() {
      window.WIA.walk = { flagged, show };
      let last = null;
      overlay.offerNext(async () => {
        if (!batch) {
          // After the row it last went to: by that row's tier then, then its place on the page.
          const view = flagged();
          const next = view.keys.find((key) => !last || tierOf(view, key) > last.tier || (tierOf(view, key) === last.tier && view.order.indexOf(key) > view.order.indexOf(last.key)));
          last = next === undefined ? null : { key: next, tier: tierOf(view, next) };
          if (last === null) return "Nothing else needs you.";
          show(last.key);
          return null;
        }
        const answer = await send({ type: "batch/next" }).catch(() => null);
        if (!answer?.ok) return "WorkIt couldn't look through the batch. Try again.";
        return answer.done ? "Nothing else needs you." : null;
      });
      if (!batch || window.WIA.walking) return;
      window.WIA.walking = true;
      chrome.runtime.onMessage.addListener((message, _sender, reply) => {
        if (message?.type === "batch/flags") reply(window.WIA.phase === "filling" ? { order: [], keys: [], check: [], late: [] } : window.WIA.walk.flagged());
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
        if (answer?.ok && answer.applied) {
          note("_submit", "Application sent", "WorkIt marked it Applied.", false, true);
          window.WIA.panelStates?.sent(); // Sent, Next job, I didn't submit this (KAN-401)
        }
        // The page said so, but WorkIt didn't see the job system take its submit request.
        else if (answer?.ok) note("_submit", "Did your application go out?", "WorkIt couldn't confirm it with the job system. If it was sent, press I submitted this.", true);
        else note("_submit", "Application sent, but WorkIt didn't mark it Applied", `Mark it Applied on WorkIt's Applications page. (${answer?.error ?? "No answer"})`, true);
      });
      send({ type: "batch/watch", key: SUBMIT_KEY }).catch(() => {});
    }

    status.subscribe(report);
    window.WIA.showField = show; // a panel row the student presses goes to its field (overlay.js)
    window.WIA.fieldOf = fieldOf; // the failed-field card reads the site's error by the field (card-failed.js)
    return { report, answerTheWalk, watchSubmit };
  }

  window.WIA.batchTab = batchTab;
})();

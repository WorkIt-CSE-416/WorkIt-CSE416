// The field-by-field tracker the overlay renders from — and where the
// other two JobRight bugs the research caught get fixed, by construction
// rather than by patching a rollup calculation after the fact:
//
// 1. "86%, 6/7 required fields filled" while two sub-fields under one
//    counted-once "Education" item had actually failed. This tracker never
//    creates a parent entry for a repeated group (an education or
//    experience entry) in the first place — every sub-field (institution,
//    start date, ...) is its own independent FieldResult. The summary
//    counts ONLY these leaves, so there's no higher-level node whose
//    number can disagree with its own children's.
// 2. Minor(s) marked failed/red despite the form never marking it
//    required. `required` here always comes from the field itself
//    (the Question set the job system's own API gives, read by the Fill
//    engine) — an unfilled optional field renders as "skipped", a neutral
//    state, never "failed".
//
// A fourth status, "needs_generation", is the written questions' own: one
// waiting for the student's Claude or their paste on Written Answers, or, on
// a form they opened themselves, for them to ask for that in the overlay's
// prompt (written-answers.js, overlay.js's promptForEssays).
window.WIA = window.WIA || {};

(function () {
  "use strict";

  /** @type {Map<string, import("../shared/types.js").FieldResult>} */
  const results = new Map();
  const listeners = new Set();

  function notify() {
    const snapshot = summary();
    listeners.forEach((fn) => fn(snapshot));
  }

  /**
   * @param {string} key
   * @param {() => void} fn  Unsubscribe
   */
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /**
   * @param {string} key
   * @param {string} label
   * @param {boolean} required
   * @param {import("../shared/types.js").Source} [source]  where its planned answer comes from
   * @param {"todo" | "done"} [note]  the row is the panel's message, not a field (content-script.js's note):
   *   "todo" for something the student must do, "done" for news that asks nothing of them
   */
  function register(key, label, required, source, note) {
    results.set(key, { key, label, required, status: "pending", ...(source ? { source } : {}), ...(note ? { note } : {}) });
    notify();
  }

  /**
   * @param {string} key
   * @param {import("../shared/types.js").FieldStatus} status
   * @param {string} [reason]
   * @param {string | string[]} [shows]  what a filled field shows now, as the engine read it back
   * @param {import("../shared/types.js").Source} [source]  a new source for what it shows (the student's edit, a written answer)
   * @param {{ text: string, href: string }} [link]  a link that ends the reason's sentence (a webapp page)
   * @param {boolean} [claude]  it waits for the student's Claude: the overlay offers Write with Claude
   */
  function setStatus(key, status, reason, shows, source, link, claude) {
    const existing = results.get(key);
    if (!existing) return;
    // A new status is a new state of the field: a review's flag on what it showed before no longer holds.
    results.set(key, { ...existing, status, reason, shows, link, claude, flag: undefined, flagQuote: undefined, flagHard: false, rewriting: false, ...(source ? { source } : {}) });
    notify();
  }

  /**
   * Marks a filled row with what the student's Claude's pre-submit review
   * found wrong in its answer (KAN-369), or clears it (no `reason`). The
   * row keeps its status and value; the flag lasts until its next setStatus
   * (the student's edit). `details`: the sentence it means (`quote`),
   * whether it names the wrong company (`hard`), and whether the answer is
   * with the student's Claude to rewrite (`rewriting`; card-flag.js).
   * @param {string} key
   * @param {string} [reason]
   * @param {{ quote?: string | null, hard?: boolean, rewriting?: boolean }} [details]
   */
  function flag(key, reason, details = {}) {
    const existing = results.get(key);
    if (!existing) return;
    const next = { flag: reason, flagQuote: (reason && details.quote) || undefined, flagHard: Boolean(reason && details.hard), rewriting: Boolean(reason && details.rewriting) };
    if (Object.entries(next).every(([k, v]) => existing[k] === v || (!existing[k] && !v))) return;
    results.set(key, { ...existing, ...next });
    notify();
  }

  function reset() {
    results.clear();
    notify();
  }

  /**
   * The one number the popup/overlay headline is built from. Only
   * "required" fields count toward the fraction — optional ones are
   * tracked (the overlay still lists them) but don't drag the honest
   * percentage down for something the form never asked for.
   */
  function summary() {
    const all = Array.from(results.values());
    const required = all.filter((r) => r.required);
    const filled = required.filter((r) => r.status === "filled");
    const failed = all.filter((r) => r.status === "failed");
    // A required one of these still counts toward requiredTotal above (and
    // stays un-filled in the percent) until an answer is written or the
    // student dismisses the prompt — same honesty rule as every
    // other required-but-unresolved field, just with a third way to
    // resolve it besides WorkIt already having the data.
    const essay = all.filter((r) => r.status === "needs_generation");

    return {
      total: all.length,
      requiredTotal: required.length,
      requiredFilled: filled.length,
      failedCount: failed.length,
      essayCount: essay.length,
      // No required fields at all → treat as complete rather than 0/0.
      percent: required.length === 0 ? 100 : Math.round((filled.length / required.length) * 100),
      fields: all,
    };
  }

  // The page's words, read at most every 250 ms (shown() asks for each row on every render).
  let words = { at: -Infinity, text: "" };
  const squash = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();
  function pageWords() {
    if (performance.now() - words.at > 250) words = { at: performance.now(), text: squash(document.body?.textContent ?? "") };
    return words.text;
  }

  /**
   * Whether the page shows a row's field now (KAN-369 Q7). Not shown: a field
   * the form hides (display: none on it and its box, as a conditional
   * question not asked yet), and one with no element whose question isn't
   * on the page either (a question the form hasn't drawn; on Workday,
   * another step's). A field WorkIt can't find by its key but whose question
   * the page still shows (a file field whose input the site swapped out)
   * counts as shown. Before batch-tab.js gives the page's fieldOf, every row does.
   */
  function shown(row) {
    const fieldOf = window.WIA.fieldOf;
    if (!fieldOf) return true;
    let el = null;
    try {
      el = fieldOf(row.key);
    } catch {
      return true;
    }
    if (!el) return !window.WIA.steps && pageWords().includes(squash(row.label ?? row.key));
    const visible = (node) => node?.checkVisibility?.() ?? Boolean(node?.offsetParent);
    return visible(el) || visible(el.parentElement);
  }

  /**
   * The one rule for "needs you" (KAN-369 Q7): the Autofill tab's Needs you
   * rows, every count line, Next Thing's count, the batch tab's state and the
   * red dots on the page all use it. A note that asks something of the
   * student ("todo"), or a field the page shows now that failed, that the
   * review flagged, or that is required and still empty after the fill (a
   * question for a written answer they haven't asked their Claude for
   * counts; one waiting on their Claude does not, see waitingOnClaude). A
   * required field "skipped" (the form doesn't ask it) and a guess are not.
   * @param {import("../shared/types.js").FieldResult} row
   */
  function needsYou(row) {
    if (row.note) return row.note === "todo";
    if (!(row.status === "failed" || row.flag || row.required)) return false;
    if (!shown(row)) return false;
    if (row.status === "failed" || row.flag) return true;
    if (row.status === "needs_generation") return !row.claude;
    return row.status === "pending" && window.WIA.phase !== "filling";
  }

  /** A filled answer for the student to check (amber, not needs-you): a guess, or an answer from their Claude the walk hasn't shown. */
  const toCheck = (row) => !row.note && row.status === "filled" && (row.source === "guessed" || Boolean(window.WIA.unseenAnswers?.has(row.key)));

  /** A required question waiting for the student's Claude: nothing for them to fix yet, but not ready either. */
  const waitingOnClaude = (row) => !row.note && row.required && row.status === "needs_generation" && Boolean(row.claude);

  /** How many rows need the student now (needsYou): the number every count line shows. */
  const needsYouCount = () => Array.from(results.values()).filter(needsYou).length;

  window.WIA.status = { register, setStatus, flag, reset, summary, subscribe, needsYou, toCheck, waitingOnClaude, needsYouCount };
})();

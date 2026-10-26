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
// A fourth status, "needs_generation", is the essay-question feature's own:
// an open-ended question WorkIt can offer to draft (never fill) until the
// student opts in via the overlay's batch prompt — see content-script.js and
// overlay.js's promptForEssays.
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
    // stays un-filled in the percent) until the student generates an
    // answer or dismisses the batch prompt — same honesty rule as every
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

  window.WIA.status = { register, setStatus, flag, reset, summary, subscribe };
})();

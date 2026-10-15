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
//    (field-map.js reads the DOM's own required/aria-required/asterisk
//    signal) — an unfilled optional field renders as "skipped", a neutral
//    state, never "failed".
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
   */
  function register(key, label, required) {
    results.set(key, { key, label, required, status: "pending" });
    notify();
  }

  /**
   * @param {string} key
   * @param {import("../shared/types.js").FieldStatus} status
   * @param {string} [reason]
   */
  function setStatus(key, status, reason) {
    const existing = results.get(key);
    if (!existing) return;
    results.set(key, { ...existing, status, reason });
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

    return {
      total: all.length,
      requiredTotal: required.length,
      requiredFilled: filled.length,
      failedCount: failed.length,
      // No required fields at all → treat as complete rather than 0/0.
      percent: required.length === 0 ? 100 : Math.round((filled.length / required.length) * 100),
      fields: all,
    };
  }

  window.WIA.status = { register, setStatus, reset, summary, subscribe };
})();

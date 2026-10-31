// Fill numbers (KAN-476): once a fill ends (content-script.js; on Workday and
// Oracle, each step's), its counts go to the background, which sends them
// (background/fill-events.js) unless the student turned them off. Counts and
// error names only, read off the checklist (lib-status.js): how many fields,
// how many filled, guessed, needing the student and failed, and each failed
// field's error name (report.js's, else NoAnswer). Never a value or a label.
// `start()` marks when the fill began; `sent(site, step)` sends once per start.
// A stepped system's event names its step (from 1) and whether it is the last,
// so fill-health counts the fill once; a step WorkIt couldn't plan sends one
// with its `error`.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  if (window.WIA.fillEvent) return;
  let began = null;

  function counts(site, error) {
    const { status, report } = window.WIA;
    const rows = status.summary().fields;
    const fields = rows.filter((r) => !r.note);
    const errors = {};
    const add = (name) => void (errors[name] = (errors[name] ?? 0) + 1);
    for (const row of fields) if (row.status === "failed") add(report?.errorOf?.(row.key) ?? "NoAnswer");
    // A fill that stopped on an error (its Plan failed, the engine threw) shows it as a failed note.
    if (rows.some((r) => r.key === "_error" && r.status === "failed")) add("Error");
    if (error) add(error);
    return {
      site,
      fields: fields.length,
      filled: fields.filter((r) => r.status === "filled").length,
      guessed: fields.filter((r) => r.status === "filled" && r.source === "guessed").length,
      needs_you: fields.filter(status.needsYou).length,
      failed: fields.filter((r) => r.status === "failed").length,
      errors,
      duration_ms: Math.round(performance.now() - began),
    };
  }

  window.WIA.fillEvent = {
    start() {
      began = performance.now();
    },
    /**
     * Sends this fill's numbers, once: a second call before the next start() sends nothing.
     * @param {string | null} [site]
     * @param {{ step?: number, final_step?: boolean, error?: string }} [stepped] a stepped system's step
     */
    sent(site, { error, ...step } = {}) {
      if (began === null) return;
      const event = { ...counts(site ?? null, error), ...step };
      began = null;
      window.WIA.ui.ask({ type: "fill/event", counts: event }).catch(() => {});
    },
  };
})();

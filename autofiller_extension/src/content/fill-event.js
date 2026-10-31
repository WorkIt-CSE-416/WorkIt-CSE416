// Fill numbers (KAN-476): once a fill ends (content-script.js; on Workday and
// Oracle, each step's), its counts go to the background, which sends them
// (background/fill-events.js) unless the student turned them off. Counts and
// error names only, read off the checklist (lib-status.js): how many fields,
// how many filled, guessed, needing the student and failed, and each failed
// field's error name (report.js's, else NoAnswer). Never a value or a label.
// `start()` marks when the fill began; `sent(site)` sends once per start.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  if (window.WIA.fillEvent) return;
  let began = null;

  function counts(site) {
    const { status, report } = window.WIA;
    const rows = status.summary().fields;
    const fields = rows.filter((r) => !r.note);
    const errors = {};
    const add = (name) => void (errors[name] = (errors[name] ?? 0) + 1);
    for (const row of fields) if (row.status === "failed") add(report?.errorOf?.(row.key) ?? "NoAnswer");
    // A fill that stopped on an error (its Plan failed, the engine threw) shows it as a failed note.
    if (rows.some((r) => r.key === "_error" && r.status === "failed")) add("Error");
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
    /** Sends this fill's numbers, once: a second call before the next start() sends nothing. */
    sent(site) {
      if (began === null) return;
      const event = counts(site ?? null);
      began = null;
      window.WIA.ui.ask({ type: "fill/event", counts: event }).catch(() => {});
    },
  };
})();

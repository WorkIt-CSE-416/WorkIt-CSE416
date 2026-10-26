// A batch tab stopped at a human check (Cloudflare's Turnstile, a CAPTCHA)
// where the form should be (background/batch.js's startFill): its rows say
// so for Next Thing That Needs You, which counts it as one thing that needs
// the student. No panel shows: the page is the check alone, so nothing of
// WorkIt's ever covers its widget (the tab's Needs you group and the
// toolbar's badge say what is waiting). Loaded after lib-status, tokens, overlay and
// batch-tab (shared/content-scripts.js's injectHumanCheck). The fill, once
// the form shows, puts up its own panel.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  const { status } = window.WIA;
  /** The panel's message row (content-script.js's note): something the student must do. */
  function note(key, label, reason, failed = false, done = false) {
    status.register(key, label, failed, undefined, done ? "done" : "todo");
    status.setStatus(key, failed ? "failed" : "skipped", reason);
  }
  window.WIA.phase = "stopped";
  status.reset();
  note("_human_check", "Prove you're human on this page", "WorkIt fills the form once it shows.");
  window.WIA.batchTab({ batch: true, note }).answerTheWalk();
})();

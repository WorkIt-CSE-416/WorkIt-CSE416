// A batch tab stopped at a human check (Cloudflare's Turnstile, a CAPTCHA)
// where the form should be (background/batch.js's startFill): its panel says
// so, with Skip and Next Thing That Needs You, which counts it as one thing
// that needs the student. Loaded after lib-status, tokens, overlay and
// batch-tab (shared/content-scripts.js's injectHumanCheck). The fill, once
// the form shows, takes the panel down first and puts up its own.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  const { status, overlay } = window.WIA;
  const send = (message) => chrome.runtime.sendMessage(message);
  /** The panel's message row (content-script.js's note): something the student must do. */
  function note(key, label, reason, failed = false, done = false) {
    status.register(key, label, failed, undefined, done ? "done" : "todo");
    status.setStatus(key, failed ? "failed" : "skipped", reason);
  }
  window.WIA.phase = "stopped";
  status.reset();
  overlay.mount({ onSkip: () => send({ type: "batch/skip" }).catch(() => {}) });
  note("_human_check", "Prove you're human on this page", "WorkIt fills the form once it shows.");
  window.WIA.batchTab({ batch: true, note }).answerTheWalk();
})();

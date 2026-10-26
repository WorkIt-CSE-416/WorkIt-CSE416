// The panel's other states (KAN-401), in the shell's primary slot:
//
// - Signed out: the job card (panel-top.js reads the names without an
//   account) and Sign in to WorkIt only; the tabs give way. Signed in again
//   (the student comes back to the tab), Autofill This Page.
// - Sent: after a submit WorkIt marked applied in a batch tab, "Sent · Marked
//   applied on WorkIt", Next job → while another tab needs the student, and
//   I didn't submit this, which sets the application back.
//
// `start()` is what the launcher and the toolbar call in place of
// panel.fillButton before a fill. Loaded after panel.js wherever it is
// (manifest, SHELL_FILES, CONTENT_SCRIPT_FILES); the first copy stays.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  if (window.WIA.panelStates) return;
  const send = (message) => Promise.resolve(chrome.runtime.sendMessage(message)).catch(() => null);

  const STYLES = `
    .panel[data-signed-out] .tabs, .panel[data-signed-out] [data-tabs] { display: none !important; }
    .state-line { font-size: var(--text-body); font-weight: 600; color: var(--color-ink); }
    .state-line[data-sent] { color: var(--color-positive-ink); }
    .state-said { font-size: var(--text-note); color: var(--color-ink-muted); }
    .state-said[data-error] { color: var(--color-danger); }
    .state-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .state-actions button {
      all: unset; cursor: pointer; padding: 4px 10px; font-size: var(--text-note); font-weight: 600; border-radius: var(--radius-control);
      border: 1px solid var(--color-border-subtle); background: var(--color-panel); color: var(--color-ink);
    }
    .state-actions button:hover { background: var(--color-hover); }
    .state-actions button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
    [data-slot="primary"] > [data-kept-hidden] { display: none !important; }
  `;

  let styled = false;
  const panel = () => window.WIA.panel;
  function style() {
    if (styled || !panel()?.root) return;
    styled = true;
    panel().addCss(STYLES);
  }
  const frame = () => panel().root.querySelector(".panel");

  let signedOut = false;

  /** The button before a fill: Autofill This Page (or Fill this step) signed in, else Sign in to WorkIt. */
  async function start() {
    style();
    const answer = await send({ type: "auth/status" });
    if (answer?.ok && !answer.signedIn) return showSignedOut();
    signedOut = false;
    frame()?.removeAttribute("data-signed-out");
    panel().fillButton(panel().startLabel());
  }

  function showSignedOut() {
    signedOut = true;
    frame()?.setAttribute("data-signed-out", "");
    const parts = panel().setPrimary({
      label: "Sign in to WorkIt",
      onPress: async () => {
        const answer = await send({ type: "panel/sign-in" });
        if (answer?.ok) return;
        parts.said.dataset.error = "";
        parts.said.textContent = "WorkIt couldn't open its sign-in page. Try again.";
        parts.said.hidden = false;
      },
    });
  }

  // Signed in in another tab, then back here: the fill's button again.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && signedOut && !window.WIA.overlay?.state?.()) void start();
  });

  window.WIA.panelStates = { start };
})();

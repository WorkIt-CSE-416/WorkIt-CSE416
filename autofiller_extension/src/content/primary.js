// The panel's one button after a fill (KAN-396, KAN-369 Q5), in the shell's
// "primary" slot, fixed at the panel's bottom (panel.js). Its words follow
// the student's next action:
// - "Next: 3 need you" while anything is red (lib-status.js's one rule):
//   Next Thing, the walk (batch-tab.js's flagged: red first, then amber): in
//   a batch tab the cross-tab walk (background next-needs-you.js), elsewhere
//   this page's own rows in page order. Alt+N (the `next-thing` command,
//   background.js) runs the walk in every state, amber rows too.
// - Review and submit once nothing is red: it scrolls to the employer's
//   Submit (the submit warning's rule: a control whose words start with
//   "Submit") and rings it (marks.js). It never presses it.
// - On a Workday step that isn't the last, with nothing red: Go to Save and
//   Continue, which rings Workday's own button; Fill to Review
//   (workday-walk.js) is what presses it, and only when the student asks.
// The panel's one count line is the Autofill tab's (overlay.js). Fill Again
// is the ⋯ menu's (panel.menuItem); it asks once, over this button, before
// it fills again. Before a fill
// the slot is panel.fillButton's (launcher.js): Autofill This Page, or Fill
// this step on a Workday step outside a batch (panel.startLabel).
// Loaded by every fill after the card files (shared/content-scripts.js), as
// window.WIA.primary; overlay.mount calls mount, overlay.offerNext gives it
// the walk.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  // Injected again (Fill Again, the fill after a human check): the last fill's button goes.
  window.WIA.primary?.unmount?.();

  const SUBMIT_WORDS = /^\s*submit\b/i;
  const CONTROL = 'button, input[type="submit"], input[type="button"], [role="button"]';
  const WORKDAY_NEXT = "[data-automation-id=pageFooterNextButton], [data-automation-id=bottom-navigation-next-button]";
  const { send } = window.WIA.ui;

  const STYLES = `
    .primary-confirm button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
    .primary-confirm {
      display: flex; flex-direction: column; gap: 6px; padding: 10px; font-size: var(--text-note);
      background: var(--color-panel); border: 1px solid var(--color-border); border-radius: var(--radius-card);
    }
    .primary-confirm[hidden] { display: none; }
    .primary-confirm span { display: flex; gap: 6px; }
    .primary-confirm button {
      all: unset; cursor: pointer; padding: 4px 10px; font-weight: 600; border-radius: var(--radius-control);
      border: 1px solid var(--color-border-subtle); background: var(--color-panel); color: var(--color-ink);
    }
    .primary-confirm button[data-yes] { background: var(--color-brand); color: var(--color-on-brand); border-color: var(--color-brand); }
  `;

  let parts = null;
  let style = null;
  let unsubscribe = null;
  let onNext = null;
  // What the button does now: "next", "submit", "continue" or "filling".
  let action = null;

  const visible = (el) => el.checkVisibility?.() ?? Boolean(el.offsetParent);

  /** How many rows need the student (lib-status.js's one rule, KAN-369 Q7): the button's "Next: N need you" and the count line's. */
  const needsYou = () => window.WIA.status.needsYouCount();

  /** The employer's Submit, as the submit warning finds it; never WorkIt's own panel. */
  function submitButton() {
    return [...document.querySelectorAll(CONTROL)].find((control) => {
      if (control.closest("#workit-autofiller-overlay-host") || !visible(control)) return false;
      const words = control.matches("input") ? control.value : control.innerText || control.getAttribute("aria-label") || "";
      return SUBMIT_WORDS.test(words);
    }) ?? null;
  }

  /** A stepped system's step (Workday's, Oracle's) with a step after it (the fill's phase "step"): its button goes on, it doesn't send. */
  const midWorkday = () => Boolean(window.WIA.steps) && window.WIA.phase === "step";

  function say(text, error = false) {
    parts.said.textContent = text ?? "";
    parts.said.hidden = !text;
    if (error) parts.said.dataset.error = "";
    else delete parts.said.dataset.error;
  }

  /**
   * Scrolls to the employer's button and rings it. Never presses it. A
   * button under the open panel (a form whose Submit sits at the right)
   * gets the panel collapsed to its edge tab, for this page only, so the
   * student can press it.
   */
  function ringControl(control) {
    control.scrollIntoView({ block: "center" });
    const shell = window.WIA.panel;
    const panel = shell?.root?.querySelector(".panel");
    if (shell?.isOpen() && control.getBoundingClientRect().right > panel.getBoundingClientRect().left) shell.collapse({ keep: false });
    window.WIA.marks?.ring(control);
    control.focus?.({ preventScroll: true });
  }

  async function press() {
    if (action === "next") return next();
    if (action === "continue") {
      const button = [...document.querySelectorAll(WORKDAY_NEXT)].find(visible);
      if (button) return ringControl(button);
      return say("WorkIt can't find Save and Continue on this step.", true);
    }
    if (action === "submit") {
      const control = submitButton();
      if (!control) return say("WorkIt can't find this page's Submit button. Look for it on the page.", true);
      say("Check your answers, then press Submit yourself.");
      ringControl(control);
    }
  }

  /** Next Thing: the walk (overlay.offerNext's), and what it answers under the button. Alt+N's too. */
  async function next() {
    if (!onNext) return;
    say(null);
    const text = await onNext();
    say(text);
    render();
  }

  function render() {
    if (!parts) return;
    const red = needsYou();
    const filling = window.WIA.phase === "filling";
    action = filling ? "filling" : red > 0 ? "next" : midWorkday() ? "continue" : "submit";
    const { button } = parts;
    button.disabled = filling;
    button.textContent = action === "next" ? `Next: ${red} need you` : { filling: "Filling…", continue: "Go to Save and Continue", submit: "Review and submit" }[action];
  }

  /** Fill Again, after the student says yes to its one question: the fill again, in this frame (panel/fill). */
  async function fillAgain() {
    parts.confirm.hidden = true;
    parts.button.disabled = true;
    parts.button.textContent = "Filling…";
    const answer = await send({ type: "panel/fill", batch: Boolean(window.WIA.batch) });
    if (answer?.ok) return;
    parts.button.disabled = false;
    render();
    say("WorkIt couldn't start filling this page. Reload it and try again.", true);
  }

  /** Puts the button in the panel's primary slot, for the fill that just mounted its rows (overlay.mount). */
  function mount() {
    const shell = window.WIA.panel;
    if (parts || !shell?.root) return;
    style = shell.addCss(STYLES);
    const made = shell.setPrimary({ label: "", onPress: () => void press() });
    made.said.dataset.said = "";
    const confirm = Object.assign(document.createElement("div"), { className: "primary-confirm", hidden: true });
    confirm.dataset.confirm = "";
    confirm.innerHTML = `<div>This replaces what you changed on this page.</div><span><button type="button" data-yes>Fill Again</button><button type="button" data-no>Cancel</button></span>`;
    shell.menuItem("again", {
      label: "Fill Again",
      order: 30,
      onPress: window.WIA.ui.trusted(() => {
        confirm.hidden = false;
        confirm.querySelector("[data-no]").focus();
      }),
    });
    confirm.querySelector("[data-yes]").addEventListener("click", window.WIA.ui.trusted(() => void fillAgain()));
    confirm.querySelector("[data-no]").addEventListener("click", () => (confirm.hidden = true));
    // The question sits over the button it would change.
    made.button.before(confirm);
    parts = { ...made, confirm };
    unsubscribe = window.WIA.status.subscribe(render);
    render();
  }

  function unmount() {
    unsubscribe?.();
    unsubscribe = null;
    style?.remove();
    style = null;
    window.WIA.panel?.menuItem?.("again", null);
    parts = null;
    onNext = null;
  }

  /** The walk Next Thing runs (batch-tab.js's answerTheWalk): resolves with a sentence for the student, or null. */
  function offerNext(walk) {
    onNext = walk;
    render();
  }

  window.WIA.primary = { mount, unmount, offerNext, refresh: render, next };

  // Alt+N (background.js's next-thing command), in whichever frame has the button. Added once per page.
  if (!window.WIA.primaryListening) {
    window.WIA.primaryListening = true;
    chrome.runtime.onMessage.addListener((message, _sender, reply) => {
      if (message?.type !== "panel/next" || !window.WIA.primary?.offered?.()) return;
      void window.WIA.primary.next();
      reply({ pressed: true });
    });
  }
  window.WIA.primary.offered = () => Boolean(parts && onNext);
})();

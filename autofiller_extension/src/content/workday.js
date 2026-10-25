// Workday's pages, for the fill (content-script.js): which step shows, when
// a step's page has settled, and its sign-in (KAN-373), which this fills
// with the login the extension keeps for the company
// (background/workday-logins.js). It never presses anything. Loaded before
// content-script.js (shared/content-scripts.js), as window.WIA.workday.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  // Workday's name of the step shown.
  const WORKDAY_STEP = "[data-automation-id=progressBarActiveStep]";
  // Workday's sign-in: its form, the name its step bar gives it, and when to look at a typed box again.
  const SIGN_IN_FORM = "[data-automation-id=signInFormo]";
  const SIGN_IN_STEP = /sign in|create account/i;
  const SIGN_IN_SETTLE = 300;
  // How long a Workday step's page must stop changing before it is read, and the longest wait for that.
  const STEP_QUIET = 1000;
  const STEP_QUIET_MAX = 10_000;

  /**
   * Workday's step shown ("" before the application starts, while it
   * redraws, or on its sign-in, which Workday counts as the first step).
   */
  function workdayStep() {
    const lines = (document.querySelector(WORKDAY_STEP)?.innerText ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    const step = lines.length ? lines[lines.length - 1].replace(/^(current )?step \d+ of \d+\s*/i, "") : "";
    return SIGN_IN_STEP.test(step) ? "" : step;
  }

  /**
   * Types `value` into the sign-in form's box `id` (an automation id), as
   * typing would (Workday's React reads the input event), unless the box
   * holds something already: the student's typing, or this fill's.
   */
  function typeInto(id, value) {
    const box = document.querySelector(`${SIGN_IN_FORM} [data-automation-id=${id}]`);
    if (!box || box.value) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /**
   * Resolves once the page has stopped changing for STEP_QUIET ms (at most
   * STEP_QUIET_MAX). Workday names a step in its bar before it draws the
   * step's fields: on CACI's live My Information, right after signing in,
   * a fill that started at once read only Country (KAN-373).
   */
  function quiet() {
    return new Promise((resolve) => {
      let timer;
      const done = () => {
        observer.disconnect();
        clearTimeout(timer);
        clearTimeout(limit);
        resolve();
      };
      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(done, STEP_QUIET);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      timer = setTimeout(done, STEP_QUIET);
      const limit = setTimeout(done, STEP_QUIET_MAX);
    });
  }

  /** Resolves with Workday's step once it shows and isn't `from`. Watches the page; never times out. */
  function stepAfter(from) {
    return new Promise((resolve) => {
      const check = () => {
        const step = workdayStep();
        if (!step || step === from) return false;
        observer.disconnect();
        resolve(step);
        return true;
      };
      const observer = new MutationObserver(check);
      if (!check()) observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    });
  }

  /**
   * Fills Workday's sign-in whenever it shows, until the application's
   * first step does. `onView(reason)`: the sign-in's view changed (Create
   * Account or Sign In), with what is left for the student.
   */
  function watchSignIn(onView) {
    /**
     * Fills Workday's Create Account or Sign In form with the login the
     * extension keeps for this company, and tells the student what is left:
     * press the button (and, for a new account, open Workday's email). Never
     * presses anything. Called on every change to the page and a few times
     * after each fill, since Workday draws the form again as it switches
     * views (Xcel Energy's, live: the boxes typed just before came back
     * empty) and may empty a box without changing the page; only empty boxes
     * are typed, so the student's typing is never replaced.
     */
    let login = null;
    let loginView = null;
    let noted = null;
    let busy = false;
    let again = false;
    async function fillSignIn() {
      if (busy) return void (again = true);
      busy = true;
      try {
        do {
          again = false;
          const form = document.querySelector(SIGN_IN_FORM);
          if (!form || workdayStep()) return;
          const create = Boolean(form.querySelector("[data-automation-id=verifyPassword]"));
          const view = create ? "create" : "signin";
          if (loginView !== view) {
            login = await chrome.runtime.sendMessage({ type: "workday/login", create });
            loginView = view;
            [SIGN_IN_SETTLE, 1000, 2500].forEach((ms) => setTimeout(fillSignIn, ms));
          }
          if (login.ok) {
            typeInto("email", login.email);
            if (login.password) typeInto("password", login.password);
            if (login.password && create) typeInto("verifyPassword", login.password);
          }
          if (noted === view) continue;
          noted = view;
          onView(!login.ok
            ? "Sign in yourself. WorkIt fills each step once you're signed in."
            : create && login.made
              ? "WorkIt filled your email and a new password for this company's Workday, kept only in this browser. Press Create Account, then open the link Workday emails you. WorkIt fills each step once you're signed in."
              : create
                ? "WorkIt filled the login it saved for this company's Workday. If you made the account already, press Sign In instead. WorkIt fills each step once you're signed in."
                : login.password
                  ? "WorkIt filled your sign-in for this company's Workday. Press Sign In. WorkIt fills each step once you're signed in."
                  : "WorkIt has no password saved for this company's Workday. New here? Press Create Account, and WorkIt fills a new one. Else sign in yourself. WorkIt fills each step once you're signed in.");
        } while (again);
      } finally {
        busy = false;
      }
    }

    const observer = new MutationObserver(() => {
      if (workdayStep()) return observer.disconnect();
      fillSignIn();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    fillSignIn();
  }

  window.WIA.workday = {
    // Whether this page is Workday's.
    isWorkday: /(^|\.)(myworkdayjobs|myworkdaysite)\.com$/.test(location.hostname),
    step: workdayStep,
    watchSignIn,
    quiet,
    stepAfter,
  };
})();

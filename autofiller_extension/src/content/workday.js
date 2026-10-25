// Workday's pages, for the fill (content-script.js): which step shows, when
// a step's page has settled, and its sign-in (KAN-373), which this fills
// with the login the extension keeps for the company
// (background/workday-logins.js). Once the student allows it (asked once, in
// the panel), it also ticks the terms box and presses Create Account or Sign
// In, as Jobright and Simplify do (KAN-369): each button at most once a page,
// and a Sign In Workday refused never again (`refused`, saved with the
// login), so the account doesn't lock. It presses nothing else. Loaded
// before content-script.js (shared/content-scripts.js), as window.WIA.workday.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  // Workday's name of the step shown.
  const WORKDAY_STEP = "[data-automation-id=progressBarActiveStep]";
  // Workday's sign-in: its form, the name its step bar gives it, and when to look at a typed box again.
  const SIGN_IN_FORM = "[data-automation-id=signInFormo]";
  const SIGN_IN_STEP = /sign in|create account/i;
  const SIGN_IN_SETTLE = 300;
  // Workday's sign-in parts the extension presses or reads, once allowed.
  const TERMS_BOX = "[data-automation-id=createAccountCheckbox]";
  const SUBMIT = {
    create: '[data-automation-id=click_filter][aria-label="Create Account"], [data-automation-id=createAccountSubmitButton]',
    signin: '[data-automation-id=click_filter][aria-label="Sign In"], [data-automation-id=signInSubmitButton]',
  };
  const SWITCH = { create: "[data-automation-id=signInLink]", signin: "[data-automation-id=createAccountLink]" };
  const WITH_EMAIL = "[data-automation-id=SignInWithEmailButton]";
  const ALERT = "[data-automation-id=errorMessage], [data-automation-id=alertMessage]";
  const VERIFY = /verif/i;
  const SIGNED_IN = "WorkIt fills each step once you're signed in.";
  const WONT_TRY = "WorkIt won't try again, so your account doesn't lock. Sign in yourself, or press Forgot Password.";
  // How long a ticked box gets to show it is ticked before Create Account is pressed.
  const TICK_SHOWS = 100;
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

  /** Presses `button` as a pointer would: Workday's React may wait for the pointer's events, not only the click. */
  function press(button) {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      const Event = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      button.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, button: 0 }));
    }
    button.click();
  }

  /**
   * The words of Workday's messages the student can see on the sign-in
   * (errorMessage, alertMessage). A hidden one is not Workday's answer:
   * Workday keeps some on the form with text in them.
   */
  function alerts() {
    return [...document.querySelectorAll(ALERT)].filter((a) => a.checkVisibility())
      .map((a) => a.innerText.trim()).filter(Boolean).join(" ");
  }

  /** Whether the terms box shows ticked, as a checkbox or as Workday's own (aria-checked). */
  function ticks(box) {
    return box.checked || box.getAttribute("aria-checked") === "true";
  }

  /** The words of the terms box's label, as the student reads them on the page. */
  function termsWords(box) {
    const label = box.closest("label") ?? (box.id && document.querySelector(`label[for="${CSS.escape(box.id)}"]`))
      ?? box.closest("[data-automation-id^=formField]");
    return (label?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  }

  /** What to tell the student about the message Workday showed after a press. */
  function refusal(view, words) {
    if (VERIFY.test(words)) {
      return "Workday sent you an email to confirm your account. Open the email from this company's Workday and click its link, then come back to this tab and press Sign In. " + SIGNED_IN;
    }
    return view === "create"
      ? `Workday didn't make the account: "${words}" If you have an account here already, press Sign In and sign in yourself. ${SIGNED_IN}`
      : `Workday didn't take the sign-in WorkIt saved for this company: "${words}" ${WONT_TRY} ${SIGNED_IN}`;
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
   * Account or Sign In), with what is left for the student. `ask(onAllow)`:
   * shows the once-only ask to make and sign in to accounts for the student.
   */
  function watchSignIn(onView, ask) {
    /**
     * Fills Workday's Create Account or Sign In form with the login the
     * extension keeps for this company (never a password Workday refused),
     * and tells the student what is left: press the button (and, for a new
     * account, open Workday's email). Once the student allows it, it presses
     * the buttons itself (forMe). Called on every change to the page and a
     * few times after each fill, since Workday draws the form again as it switches
     * views (Xcel Energy's, live: the boxes typed just before came back
     * empty) and may empty a box without changing the page; only empty boxes
     * are typed, so the student's typing is never replaced.
     */
    let login = null;
    let loginView = null;
    let noted = null;
    let busy = false;
    let again = false;
    let asked = false;
    // What the extension did on this page, once allowed: each at most once.
    const pressed = new Set();
    const switched = new Set();
    let withEmail = false;
    let alerted = "";
    // The messages that showed when each view's button was pressed: Workday's answer is a different one.
    const before = {};
    let ticked = "";
    let untickable = false;
    async function fillSignIn() {
      if (busy) return void (again = true);
      busy = true;
      try {
        do {
          again = false;
          const form = document.querySelector(SIGN_IN_FORM);
          if (workdayStep()) return;
          if (!form) {
            // A sign-in with Google or Apple first: its "Sign in with email" shows the form.
            const button = document.querySelector(WITH_EMAIL);
            if (button && !withEmail && login?.forMe) {
              withEmail = true;
              press(button);
            }
            return;
          }
          const create = Boolean(form.querySelector("[data-automation-id=verifyPassword]"));
          const view = create ? "create" : "signin";
          if (loginView !== view) {
            login = await chrome.runtime.sendMessage({ type: "workday/login", create });
            loginView = view;
            [SIGN_IN_SETTLE, 1000, 2500].forEach((ms) => setTimeout(fillSignIn, ms));
          }
          if (login.ok) {
            typeInto("email", login.email);
            if (login.password && !login.refused) typeInto("password", login.password);
            if (login.password && !login.refused && create) typeInto("verifyPassword", login.password);
          }
          if (login.ok && !login.forMe && !asked) {
            asked = true;
            ask(async () => {
              await chrome.runtime.sendMessage({ type: "workday/allow" });
              login.forMe = true;
              noted = null;
              fillSignIn();
            });
          }
          if (login.ok && login.forMe && await forMe(form, view)) continue;
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

    /**
     * Once allowed: switches to the view that fits the saved login, presses
     * Create Account (a password made on this page only, so a refused one
     * was never an account; only once the terms box shows ticked) or Sign In
     * (never with a login Workday refused) once the boxes hold the login and
     * the page has settled, and reads Workday's answer if it stays on the page:
   * a message the student can see that wasn't there at the press (one left
   * from the student's own try, or a hidden one, isn't an answer: read as
   * one, it dropped the password of an account just made).
     * Answers true when it told the student something (the usual note is
     * then skipped).
     */
    async function forMe(form, view) {
      const create = view === "create";
      const alert = alerts();
      if (pressed.has(view)) {
        if (!alert || alert === alerted || alert === before[view]) return Boolean(alerted);
        alerted = alert;
        if (create && !VERIFY.test(alert)) await chrome.runtime.sendMessage({ type: "workday/forget" });
        if (!create && !VERIFY.test(alert)) {
          await chrome.runtime.sendMessage({ type: "workday/refused" });
          login.refused = true;
        }
        onView((create && ticked ? `WorkIt ticked "${ticked}" for you. ` : "") + refusal(view, alert));
        return true;
      }
      // Nothing saved here: make the account. A login that signed in before: sign in with it.
      const other = create ? login.signedIn : !login.password;
      if (other && !switched.has(view)) {
        const link = document.querySelector(SWITCH[view]);
        if (link) {
          switched.add(view);
          press(link);
          return true;
        }
      }
      if (login.refused) {
        if (noted !== "refused") onView(`Workday didn't take the sign-in WorkIt saved for this company. ${WONT_TRY} ${SIGNED_IN}`);
        noted = "refused";
        return true;
      }
      if (create && untickable) return true;
      if (!login.password || (create && !login.made)) return false;
      await quiet();
      const now = document.querySelector(SIGN_IN_FORM);
      const holds = (id) => now?.querySelector(`[data-automation-id=${id}]`)?.value === (id === "email" ? login.email : login.password);
      if (now !== form || !holds("email") || !holds("password") || (create && !holds("verifyPassword"))) {
        again = true;
        return true;
      }
      const button = document.querySelector(SUBMIT[view]);
      if (!button) return false;
      const box = create ? form.querySelector(TERMS_BOX) : null;
      const terms = box ? termsWords(box) : "";
      if (box && !ticks(box)) {
        press(box);
        await new Promise((resolve) => setTimeout(resolve, TICK_SHOWS));
        if (!ticks(box)) {
          // Not ticked: Create Account isn't pressed, and the password stays saved for the student's own press.
          untickable = true;
          onView(`WorkIt filled your email and a new password for this company's Workday, kept only in this browser, but couldn't tick ${terms ? `"${terms}"` : "the terms box"}. Tick it yourself, then press Create Account. ${SIGNED_IN}`);
          return true;
        }
      }
      pressed.add(view);
      before[view] = alerts();
      press(button);
      ticked = terms;
      onView(create
        ? `WorkIt made your account on this company's Workday${terms ? ` and ticked "${terms}" for you` : ""}. ${SIGNED_IN}`
        : `WorkIt is signing you in to this company's Workday. ${SIGNED_IN}`);
      noted = view;
      [1000, 2500, 5000].forEach((ms) => setTimeout(fillSignIn, ms));
      return true;
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

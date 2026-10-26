// Workday's pages, for the fill (content-script.js): which step shows, when
// a step's page has settled, and its sign-in (KAN-373), which this fills
// with the login the extension keeps for the company
// (background/workday-logins.js). Once the student allows it (asked once, in
// the panel), it also ticks the terms box and presses Create Account or Sign
// In, as Jobright and Simplify do (KAN-369): each button pressed again only
// when Workday dropped the press (it sent nothing), at most 3 times, never
// after the form went out, and a Sign In Workday refused never again
// (`refused`, saved with the login), so the account doesn't lock. In a batch
// tab it also starts the application from the job's page, as both do once
// their own button is pressed (the student's Start batch is that press):
// Apply, then Apply Manually, or Continue Application, each at most once a
// page (watchStart). It presses nothing else. Loaded
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
  // Workday's page text, not only its alerts, may say a new account waits for verification (as Apply reads it).
  const VERIFY_PAGE = /verification (email|link)|verify your (account|email)/i;
  const SIGNED_IN = "WorkIt fills each step once you're signed in.";
  const WONT_TRY = "WorkIt won't try again, so your account doesn't lock. Sign in yourself, or press Forgot Password.";
  // How long a press gets to send the form before Workday is taken to have dropped it, and the most presses.
  const SEND_WAIT = 10_000;
  const SEND_PRESSES = 3;
  // Workday's job page: Apply, or Continue Application for an application
  // started before (as Apply's _start finds them), and Apply Manually in the
  // popup Apply opens. Autofill with Resume and Use My Last Application are
  // never pressed: WorkIt fills from the student's profile.
  const START = "[data-automation-id=adventureButton], [data-automation-id=continueButton]";
  const START_WORDS = /^(apply|continue application)$/i;
  const MANUALLY = "[data-automation-id=applyManually]";
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

  // A step's fields and repeating sections, as the Fill engine reads them (its workday.ts).
  const FIELD = '[data-automation-id^="formField-"]';
  const GROUP = "[role=group][aria-labelledby]";
  const DATE_PARTS = { dateSectionMonth: "MM", dateSectionDay: "DD", dateSectionYear: "YYYY" };
  const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
  const textOf = (el) => (el ? oneLine(el.innerText.replace(/\*/g, "")) : "");
  const shows = (el) => Boolean(el) && el.offsetParent !== null;
  const titleOf = (group) => textOf(document.getElementById((group.getAttribute("aria-labelledby") ?? "").split(/\s+/)[0]));
  const numbered = (title) => /\s\d+$/.test(title);

  /** The numbered panel ("Work Experience 2") a field stands in, or "". */
  function panelOf(box) {
    for (let group = box.closest(GROUP); group; group = group.parentElement?.closest(GROUP) ?? null) {
      if (numbered(titleOf(group))) return titleOf(group);
    }
    return "";
  }

  /** A field box's label, as the engine names its Question (a date's ends with its format, "From (MM/YYYY)"). */
  function labelOf(box) {
    const checks = [...box.querySelectorAll("input[type=checkbox]")];
    const forInput = (input) => textOf(box.querySelector(`label[for="${CSS.escape(input.id)}"]`));
    const group = box.closest(GROUP);
    const legend = box.querySelector("legend");
    const file = Boolean(box.querySelector("input[type=file]"));
    const dates = [...box.querySelectorAll("[data-automation-id^=dateSection][data-automation-id$=-input]")];
    const label = legend ? textOf(legend)
      : checks.length === 1 && group && /statement above/i.test(forInput(checks[0])) ? `${titleOf(group)}: ${forInput(checks[0])}`
      : checks.length === 1 ? forInput(checks[0]) || textOf(box.querySelector("label"))
      : file && group && /^upload\b/i.test(textOf(box.querySelector("label"))) ? titleOf(group)
      : textOf(box.querySelector("label"));
    const format = !file && dates.length ? dates.map((d) => DATE_PARTS[d.dataset.automationId.replace(/-input$/, "")]).join("/") : "";
    return label && label + (format ? ` (${format})` : "");
  }

  /**
   * The field on the step shown for a panel row's key, "<step> / <label>",
   * found as the Fill engine names a step's questions: its repeating
   * sections by title, then each `formField-*` box by its label (a panel's
   * prefixed, "Work Experience 1 / Job Title"; a repeated one numbered,
   * "Phone (2)"). Null for a key from another step, or a field not shown.
   */
  function fieldOf(key) {
    const step = workdayStep();
    if (!step || !key.startsWith(`${step} / `)) return null;
    const name = key.slice(step.length + 3);
    for (const group of document.querySelectorAll(GROUP)) {
      if (shows(group) && titleOf(group) === name && !numbered(name)) return group;
    }
    const seen = {};
    for (const box of document.querySelectorAll(FIELD)) {
      if (!shows(box) || box.parentElement?.closest(FIELD)) continue;
      const own = labelOf(box);
      if (!own) continue;
      const label = [panelOf(box), own].filter(Boolean).join(" / ");
      seen[label] = (seen[label] ?? 0) + 1;
      if (name === label + (seen[label] > 1 ? ` (${seen[label]})` : "")) return box;
    }
    return null;
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

  /**
   * Whether this tab sent Workday a Create Account or Sign In since `since`
   * (the worker sees it, background/workday-logins.js). Only a clear "no"
   * counts as not sent, so a lost answer never leads to a second press.
   */
  async function sentSince(since) {
    return (await chrome.runtime.sendMessage({ type: "workday/sent", since }).catch(() => null))?.sent !== false;
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

  /**
   * The number of Workday's step shown, from its bar ("current step 4 of 8"),
   * or "" if the bar gives none. Two steps may have one name (a tenant's
   * second questionnaire is "Application Questions" again): their numbers differ.
   */
  function stepNumber() {
    return /\bstep (\d+) of \d+/i.exec(document.querySelector(WORKDAY_STEP)?.innerText ?? "")?.[1] ?? "";
  }

  // This tab's steps filled before, kept across its page loads: "<application path> <step>#<number>".
  const FILLED_STEPS = "workit-workday-filled";

  /**
   * Whether this tab filled the step shown before (the student went back to
   * it, or the page loaded again), and marks it filled. A step filled before
   * gets only its empty fields filled: what shows is what the student saved.
   */
  function filledBefore() {
    const key = `${location.pathname.replace(/\/apply(\/.*)?$/, "")} ${window.WIA.workday.stepId()}`;
    let filled = [];
    try {
      filled = JSON.parse(sessionStorage.getItem(FILLED_STEPS) ?? "[]");
    } catch {}
    if (filled.includes(key)) return true;
    try {
      sessionStorage.setItem(FILLED_STEPS, JSON.stringify([...filled, key]));
    } catch {}
    return false;
  }

  // The number of the step stepAfter last resolved with.
  let resolvedNumber = "";

  /**
   * Resolves with Workday's step once it shows and isn't `from` (the step
   * stepAfter last resolved with): another name, or the same name at another
   * number. Watches the page; never times out.
   */
  function stepAfter(from) {
    const fromNumber = from ? resolvedNumber : "";
    return new Promise((resolve) => {
      const check = () => {
        const step = workdayStep();
        const number = stepNumber();
        if (!step || (step === from && number === fromNumber)) return false;
        observer.disconnect();
        resolvedNumber = number;
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
    // What the extension did on this page, once allowed: each at most once, but a press Workday dropped is made again (pressAgain).
    const pressed = new Set();
    const switched = new Set();
    let withEmail = false;
    let alerted = "";
    // The messages that showed when each view's button was pressed: Workday's answer is a different one.
    const before = {};
    // Whether the page already spoke of verification at the Create Account press.
    let verifyBefore = false;
    // Each view's presses: how many, and when the first was (a send since then means never again).
    const sends = {};
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
            : create && login.made && login.signup
              ? "WorkIt filled your Workday sign-up email and password, kept only in this browser. Press Create Account, then open the link Workday emails you. WorkIt fills each step once you're signed in."
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
        const shown = alert && alert !== before[view] ? alert
          : create && !verifyBefore && document.body.innerText.match(VERIFY_PAGE)?.[0] || "";
        if (!shown || shown === alerted) return Boolean(alerted);
        alerted = shown;
        // The account was made, pending the email's link: the next page signs in with it.
        if (create && VERIFY.test(shown)) {
          await chrome.runtime.sendMessage({ type: "workday/created" });
          login.created = true;
        }
        if (create && !VERIFY.test(shown)) await chrome.runtime.sendMessage({ type: "workday/forget" });
        if (!create && !VERIFY.test(shown)) {
          await chrome.runtime.sendMessage({ type: "workday/refused" });
          login.refused = true;
        }
        onView((create && ticked ? `WorkIt ticked "${ticked}" for you. ` : "") + refusal(view, shown));
        return true;
      }
      // Nothing saved here (or only the sign-up's login): make the account. A login that signed in before, or made the account: sign in with it.
      const other = create ? login.signedIn || login.created : !login.password || login.fresh;
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
          onView(`WorkIt filled your email and ${login.signup ? "your Workday sign-up password" : "a new password for this company's Workday"}, kept only in this browser, but couldn't tick ${terms ? `"${terms}"` : "the terms box"}. Tick it yourself, then press Create Account. ${SIGNED_IN}`);
          return true;
        }
      }
      // Pressed again (Workday dropped the press): not if the form went out meanwhile.
      if (sends[view] && await sentSince(sends[view].since)) {
        pressed.add(view);
        return true;
      }
      sends[view] ??= { count: 0, since: Date.now() };
      sends[view].count += 1;
      pressed.add(view);
      before[view] ??= alerts();
      if (create && sends[view].count === 1) verifyBefore = VERIFY_PAGE.test(document.body.innerText);
      press(button);
      setTimeout(() => pressAgain(view), SEND_WAIT);
      ticked = terms;
      onView(create
        ? `WorkIt made your account on this company's Workday${terms ? ` and ticked "${terms}" for you` : ""}. ${SIGNED_IN}`
        : `WorkIt is signing you in to this company's Workday. ${SIGNED_IN}`);
      noted = view;
      [1000, 2500, 5000].forEach((ms) => setTimeout(fillSignIn, ms));
      return true;
    }

    /**
     * SEND_WAIT after a press: if the same view still shows with no answer
     * and the tab sent Workday nothing, Workday dropped the press (Axiom's
     * Create Account, live), so it is made again, up to SEND_PRESSES in all.
     * Once the form went out it is never pressed again, however slow the
     * answer: a second Create Account would find the account made.
     */
    async function pressAgain(view) {
      const form = document.querySelector(SIGN_IN_FORM);
      const shows = form && !workdayStep() && Boolean(form.querySelector("[data-automation-id=verifyPassword]")) === (view === "create");
      if (!shows || alerts() !== before[view]) return;
      if (await sentSince(sends[view].since)) return;
      if (sends[view].count >= SEND_PRESSES) {
        return onView(`Workday didn't take WorkIt's press of ${view === "create" ? "Create Account" : "Sign In"}. Press it yourself. ${SIGNED_IN}`);
      }
      pressed.delete(view);
      fillSignIn();
    }

    const observer = new MutationObserver(() => {
      if (workdayStep()) return observer.disconnect();
      fillSignIn();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    fillSignIn();
  }

  /**
   * In a batch tab, starts the application from Workday's job page: presses
   * Apply (or Continue Application), then Apply Manually when its popup
   * shows, each at most once a page (its path, since Workday changes pages
   * in place), as Jobright and Simplify do once their own button is pressed.
   * Stops once the application's first step shows. `onPress(reason)`: what
   * to tell the student.
   */
  function watchStart(onPress) {
    const pressed = new Set();
    const once = (what, button, reason) => {
      const key = `${what} ${location.pathname}`;
      if (pressed.has(key)) return;
      pressed.add(key);
      press(button);
      onPress(reason);
    };
    const look = () => {
      if (document.querySelector(SIGN_IN_FORM)) return;
      const manually = [...document.querySelectorAll(MANUALLY)].find((b) => b.checkVisibility());
      if (manually) return once("manually", manually, `WorkIt pressed Apply Manually for you, so it fills from your WorkIt profile. ${SIGNED_IN}`);
      const start = [...document.querySelectorAll(START)].find((b) => b.checkVisibility() && START_WORDS.test(b.innerText.trim()));
      if (start) once("start", start, `WorkIt pressed ${start.innerText.trim()} for you. ${SIGNED_IN}`);
    };
    const observer = new MutationObserver(() => {
      if (workdayStep()) return observer.disconnect();
      look();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    look();
  }

  window.WIA.workday = {
    // Whether this page is Workday's.
    isWorkday: /(^|\.)(myworkdayjobs|myworkdaysite)\.com$/.test(location.hostname),
    step: workdayStep,
    // The field on the step shown for a panel row's key (batch-tab.js's fieldOf).
    fieldOf,
    watchSignIn,
    watchStart,
    quiet,
    stepAfter,
    filledBefore,
    // The step shown, told from a step of the same name: "<step>#<number>".
    stepId: () => `${workdayStep()}#${stepNumber()}`,
  };
})();

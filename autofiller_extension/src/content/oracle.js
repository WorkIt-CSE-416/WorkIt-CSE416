// Oracle Recruiting Cloud's pages, for the fill (content-script.js): which
// section shows, when it has settled, and its email gate. The gate (Email
// Address, the terms box, and for a returning candidate a one-time code) is
// the student's: WorkIt never types into it or presses its Next. The panel
// tells them to enter their email and continue; the sections fill once they
// show. Oracle draws each section in the same page (/apply/section/<n>), its
// navigation train naming it. The same face as workday.js gives (see
// steps.js); loaded after workday.js, as window.WIA.oracle.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  const GATE = "section.email-verification, .email-verification, .pin-code, [class*=pin-code]";
  const GATE_PATH = /\/apply\/(email|email-verification|confirm-email)\/?$/;
  const TRAIN_CURRENT = '.apply-flow-navigation-train [aria-current="step"], .apply-flow-navigation-train [aria-current="page"], .apply-flow-navigation-train [aria-current="true"], .apply-flow-navigation-train [class*="--current"], .apply-flow-navigation-train [class*="--active"]';
  const ROW = ".input-row";
  const FOOTER = ".apply-flow-pagination";
  // How long a section must stop changing before it is read, and the longest wait for that.
  const STEP_QUIET = 600;
  const STEP_QUIET_MAX = 10_000;
  const FILLED_STEPS = "workit-oracle-filled";
  const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
  const shows = (el) => Boolean(el) && el.offsetParent !== null;

  const isOn = /(^|\.)(oraclecloud|oraclegovcloud)\.com$/.test(location.hostname) && /\/hcmUI\/CandidateExperience\//.test(location.pathname);

  /** Whether Oracle's email gate (or its code) shows: the student's. */
  function onGate() {
    return [...document.querySelectorAll(GATE)].some(shows) || (GATE_PATH.test(location.pathname) && !document.querySelector(FOOTER));
  }

  /** The section number in the page's path, or "". */
  const sectionNumber = () => /\/apply\/section\/(\d+)/.exec(location.pathname)?.[1] ?? "";

  /** The section shown, as the engine names it (its oracle.ts): the train's current step, else "Step <n>". "" on the gate or the job's page. */
  function oracleStep() {
    if (onGate()) return "";
    const named = oneLine(document.querySelector(TRAIN_CURRENT)?.innerText).replace(/^(current )?step \d+( of \d+)?[:.]?\s*/i, "").replace(/\s*\b(current|completed)\b\s*$/i, "");
    if (named) return named;
    if (sectionNumber()) return `Step ${sectionNumber()}`;
    return [...document.querySelectorAll(ROW)].some(shows) && document.querySelector(FOOTER) ? "Application" : "";
  }

  /** Resolves with the section once it shows and isn't `from`. Watches the page; never times out. */
  function stepAfter(from) {
    const fromId = from ? lastId : "";
    return new Promise((resolve) => {
      const check = () => {
        const step = oracleStep();
        if (!step || (step === from && stepId() === fromId)) return false;
        observer.disconnect();
        lastId = stepId();
        resolve(step);
        return true;
      };
      const observer = new MutationObserver(check);
      if (!check()) observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-current", "class"] });
    });
  }
  let lastId = "";
  const stepId = () => `${oracleStep()}#${sectionNumber()}`;

  /** Resolves once the section has stopped changing (STEP_QUIET), at most STEP_QUIET_MAX. */
  function quiet() {
    return new Promise((resolve) => {
      let timer;
      const done = () => { observer.disconnect(); clearTimeout(timer); clearTimeout(limit); resolve(); };
      const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, STEP_QUIET); });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      timer = setTimeout(done, STEP_QUIET);
      const limit = setTimeout(done, STEP_QUIET_MAX);
    });
  }

  /** Whether this tab filled the section shown before (the student went back to it), and marks it filled. */
  function filledBefore() {
    const key = `${location.pathname.replace(/\/apply(\/.*)?$/, "")} ${stepId()}`;
    let filled = [];
    try { filled = JSON.parse(sessionStorage.getItem(FILLED_STEPS) ?? "[]"); } catch {}
    if (filled.includes(key)) return true;
    try { sessionStorage.setItem(FILLED_STEPS, JSON.stringify([...filled, key])); } catch {}
    return false;
  }

  /**
   * Tells the student, while the gate shows, that it is theirs: `onView(reason)` each
   * time it shows. Nothing on it is typed or pressed. Stops once a section shows.
   */
  function watchGate(onView) {
    let shown = false;
    const look = () => {
      if (oracleStep()) { observer.disconnect(); return; }
      if (onGate() && !shown) {
        shown = true;
        onView(GATE_REASON);
      }
      if (!onGate()) shown = false;
    };
    const observer = new MutationObserver(look);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    look();
  }
  /** A row's label, as the engine reads it (its oracle.ts labelOf). */
  function labelOf(row) {
    const text = (el) => oneLine(el?.innerText ?? el?.textContent).replace(/\s*\*$/, "");
    const own = row.querySelector(".input-row__label .input-row__label-text, .input-row__label .input-row__linebreak, label.input-row__label, .cx-select__label, .input-field__label");
    if (text(own)) return text(own);
    if (row.querySelectorAll("input[type=checkbox]").length === 1) return text(row.querySelector(".apply-flow-input-checkbox__label")) || text(row.querySelector("label"));
    return text(row.querySelector("legend, label"));
  }

  /** The field on the section shown for a panel row's key, "<step> / <label>" (a repeated one numbered, "Phone (2)"); null for another step's. */
  function fieldOf(key) {
    const step = oracleStep();
    if (!step || !key.startsWith(`${step} / `)) return null;
    const name = key.slice(step.length + 3);
    const seen = {};
    for (const row of document.querySelectorAll(ROW)) {
      if (!shows(row) || row.classList.contains("input-row--invisible") || row.parentElement?.closest(ROW) || row.closest(GATE) || row.querySelector("label[aria-hidden=true]")) continue;
      const label = labelOf(row);
      if (!label) continue;
      seen[label] = (seen[label] ?? 0) + 1;
      if (name === label + (seen[label] > 1 ? ` (${seen[label]})` : "")) return row;
    }
    return null;
  }

  const GATE_REASON = "Enter your email on Oracle's page, tick its terms box and press Next (and enter the code Oracle emails you, if it asks). WorkIt never types into this page. It fills each step once it shows.";

  window.WIA.oracle = {
    isOn,
    name: "Oracle",
    step: oracleStep,
    stepId,
    fieldOf,
    stepAfter,
    quiet,
    filledBefore,
    watchGate,
    // The words the panel uses before the steps, and for the step's own button.
    waiting: { title: "Enter your email to start", reason: "Start the application on Oracle's page and enter your email there. WorkIt never types into it, and fills each step once it shows." },
    nextLabel: "Next",
    reviewName: "Summary",
    // Fill to Review's view of the page (workday-walk.js).
    walk: {
      next: ".apply-flow-pagination button:not(.apply-flow-pagination__submit-button)",
      review: ".apply-flow-pagination__submit-button",
      goesOn: /^(next|continue|save and continue)$/i,
      banner: ".input-row--invalid .input-row__validation, .input-row--invalid [role=alert], .notification--error",
      wentWrong: () => false,
    },
  };
})();

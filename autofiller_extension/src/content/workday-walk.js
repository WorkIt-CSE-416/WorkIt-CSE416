// Fill to Review (KAN-369): on Workday, once a step is filled and nothing on
// it needs the student, the fill presses Workday's own Save and Continue, so
// the next step shows and is filled, and so on until Review, where it stops:
// the student checks every answer on Workday's Review page and presses Submit
// themselves. As Apply walks Workday (resume-2027 apply/src/apply/workday.py).
//
// It walks in every batch tab, and outside a batch once the student presses
// the panel's Fill to Review (remembered for the tab, sessionStorage, so the
// steps Workday loads as new pages walk on). The rules:
// - A step stops the walk when a row needs the student (a failed field, one
//   unanswered, a written answer still coming, a guessed answer, the Plan's
//   note), a required field shows nothing, or the self-identification card
//   waits. The panel says why; the student answers and presses Save and
//   Continue, and the next step walks again.
// - Save and Continue is pressed on a step once (by its name, its number in
//   Workday's bar and the page's path, kept for the tab), and only when it
//   reads Save and Continue, Continue or Next: never a button that reads as
//   sending (Submit, Apply, Finish...), never on Review. A press Workday
//   drops (nothing at all comes of it in TAKEN_WAIT: the button never
//   disables, no error, the step unchanged) is made again on the same
//   button, PRESSES in all, as Apply's _next does (Applied Materials, live).
// - After the press, an error Workday shows that stays (ERROR_WAIT) stops the
//   walk with its words, and nothing is pressed again; so does a step that
//   never changes (LEAVE_WAIT).
// Loaded after workday.js and overlay.js (shared/content-scripts.js), as
// window.WIA.toReview.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  const NEXT = "[data-automation-id=pageFooterNextButton], [data-automation-id=bottom-navigation-next-button]";
  const REVIEW_PAGE = "[data-automation-id=applyFlowReviewPage], [data-automation-id=reviewJobApplicationPage]";
  const GOES_ON = /^(save and continue|continue|next)$/i;
  const SENDS = /\b(submit|send|apply|finish|complete|confirm)\b/i;
  const BANNER = "[data-automation-id=errorHeading], [data-automation-id=errorBanner], [data-automation-id=errorMessage]";
  // This tab's choice (Fill to Review pressed) and the steps pressed in it, kept across Workday's page loads.
  const OPTED = "workit-fill-to-review";
  const PRESSED = "workit-fill-to-review-pressed";
  // How long the button may stay disabled before the press, the step may take to change after it,
  // and an error shown after it may take to give way to the next step (Adobe's, live: Apply's ERROR_WAIT).
  const ENABLED_WAIT = 10_000;
  const LEAVE_WAIT = 30_000;
  const ERROR_WAIT = 5_000;
  // How long a press gets to show Workday took it (the button disables while it saves), and the most presses (Apply's).
  const TAKEN_WAIT = 3_000;
  const PRESSES = 3;
  const REVIEW_NOTE = "Check everything on Workday's Review page, then press Submit.";
  const STOPPED = "WorkIt stopped on this step";

  const { overlay } = window.WIA;
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const store = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

  /** Whether this tab walks to Review: a batch tab always, any other once the student asked. */
  const on = () => Boolean(window.WIA.batch) || store(() => sessionStorage.getItem(OPTED) === "1", false);
  const pressed = () => new Set(store(() => JSON.parse(sessionStorage.getItem(PRESSED) ?? "[]"), []));

  /** Waits until `check()` answers something truthy (and returns it), or `ms` pass (null). */
  async function until(check, ms) {
    const end = Date.now() + ms;
    for (;;) {
      const found = check();
      if (found) return found;
      if (Date.now() > end) return null;
      await sleep(200);
    }
  }

  /** Why a row keeps the walk on its step, or null. The step's own note is the walk's. */
  function holds(r) {
    if (r.key === "_step") return null;
    if (r.note) return r.note === "todo" ? `${r.label}: ${r.reason ?? "it needs you"}` : null;
    if (r.status === "failed") return `${r.label} needs you`;
    if (r.status === "pending" || r.status === "needs_generation") return `${r.label} is still waiting for an answer`;
    if (r.flag) return `${r.label} was flagged`;
    if (r.status === "filled" && r.source === "guessed") return `check WorkIt's guess for ${r.label}`;
    return null;
  }

  /** What stops the walk on the step shown (the panel's rows), or null. */
  function blocker(fields, selfIdWaits) {
    const reasons = fields.map(holds).filter(Boolean);
    if (selfIdWaits) reasons.push("the self-identification questions wait for your answer");
    if (!reasons.length) return null;
    const more = reasons.length > 3 ? ` (and ${reasons.length - 3} more)` : "";
    return `${reasons.slice(0, 3).join("; ")}${more}. Fix it, then press Save and Continue yourself. WorkIt fills the next step when it shows.`;
  }

  function press(button) {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      const Event = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      button.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, button: 0 }));
    }
    button.click();
  }

  const banner = () => [...document.querySelectorAll(BANNER)].find((b) => b.checkVisibility() && b.innerText.trim());
  const shown = () => [...document.querySelectorAll(NEXT)].find((b) => b.checkVisibility());

  /**
   * Whether Workday took a press of `button` from now on: it disabled the
   * button (as it does while it saves; a press of a disabled button is no
   * press) or took it off the page (another step drew).
   */
  function watchTaken(button) {
    let took = false;
    const off = () => button.disabled || button.getAttribute("aria-disabled") === "true";
    const watch = new MutationObserver(() => { if (off()) took = true; });
    watch.observe(button, { attributes: true, attributeFilter: ["disabled", "aria-disabled"] });
    return () => {
      if (took || off() || !button.isConnected) { watch.disconnect(); return true; }
      return false;
    };
  }

  /**
   * Leaves the filled step `step` with Workday's Save and Continue, unless
   * something on it needs the student. Resolves with what to tell the
   * student when it stops on the step (null once the step was left, or the
   * page went on without it).
   * @param {string} step  the step's id, as workday.js's stepId reads it when its fill began ("<name>#<number>")
   * @param {{ fields: object[], selfIdWaits?: boolean }} shown  the panel's rows, and whether the self-identification card waits
   */
  async function leave(step, { fields, selfIdWaits = false }) {
    const { workday } = window.WIA;
    const stepNow = workday.stepId;
    if (stepNow() !== step) return null;
    const why = blocker(fields, selfIdWaits);
    if (why) return why;
    if (document.querySelector(REVIEW_PAGE)) return null;
    const button = shown();
    if (!button) return "WorkIt found no Save and Continue button on this step. Check it, then go on yourself.";
    const words = (button.innerText || button.getAttribute("aria-label") || "").trim();
    if (!GOES_ON.test(words) || SENDS.test(`${words} ${button.getAttribute("aria-label") ?? ""}`)) {
      return `This step's button reads "${words}", which WorkIt never presses. Check the step, then go on yourself.`;
    }
    const key = `${step} ${location.pathname}`;
    const done = pressed();
    if (done.has(key)) return "WorkIt pressed Save and Continue on this step once already. Check it, then press Save and Continue yourself.";
    if (!(await until(() => !button.disabled && button.isConnected, ENABLED_WAIT))) {
      return "Workday kept Save and Continue disabled. Check the step, then press it yourself.";
    }
    if (stepNow() !== step) return null;
    done.add(key);
    store(() => sessionStorage.setItem(PRESSED, JSON.stringify([...done])));
    // Another step: one with a name, told from this one by its name or its number (a second "Application Questions").
    const left = () => Boolean(workday.step()) && stepNow() !== step;
    let after = null;
    for (let presses = 1; ; presses++) {
      const taken = watchTaken(button);
      press(button);
      after = await until(() => (left() ? "left" : banner() ? "error" : taken() ? "taken" : null), TAKEN_WAIT);
      if (after || presses === PRESSES) break;
      // Dropped: pressed again only while the same button shows, enabled, on the same step.
      if (stepNow() !== step || !button.isConnected || !button.checkVisibility() || button.disabled) break;
    }
    if (after !== "left" && after !== "error") {
      after = await until(() => (left() ? "left" : banner() ? "error" : null), LEAVE_WAIT);
    }
    if (after === "left") return null;
    if (after === "error" && (await until(left, ERROR_WAIT))) return null;
    if (after === "error") {
      return `Workday didn't take this step: "${banner()?.innerText.replace(/\s+/g, " ").trim().slice(0, 300) ?? ""}" Fix it, then press Save and Continue yourself. WorkIt won't press it again here.`;
    }
    return "Workday didn't go on after WorkIt pressed Save and Continue. Check the step, then press it yourself.";
  }

  // Outside a batch: the step's walk, kept for the panel's Fill to Review until the student presses it.
  let offered = null;

  /** Offers Fill to Review for the step shown: `go` walks it once pressed (null: nothing to offer). */
  function offer(go) {
    offered = go;
    overlay.refresh();
  }

  function panel() {
    if (!offered || on()) return null;
    const el = window.WIA.rowCard.make({
      lines: ["Fill every step up to Workday's Review page. WorkIt presses Save and Continue on each step that needs nothing from you, never Submit."],
      buttons: [{
        label: "Fill to Review",
        onClick: () => {
          store(() => sessionStorage.setItem(OPTED, "1"));
          const go = offered;
          offered = null;
          overlay.refresh();
          go?.();
        },
      }],
    });
    el.classList.add("to-review");
    return el;
  }

  if (window.WIA.workday?.isWorkday) overlay.addPart({ css: ".to-review { margin: 8px 12px; }", panel });

  window.WIA.toReview = { on, leave, offer, REVIEW_NOTE, STOPPED };
})();

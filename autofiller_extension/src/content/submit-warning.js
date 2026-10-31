// Batch apply's submit warning (KAN-369): when the student presses the
// employer's Submit in a batch tab that still has something open (a failed
// field, a required one still waiting, an answer the pre-submit review
// flagged), the press is held and the panel says what: "2 things still need
// you", with Show me (Next Thing That Needs You, from the first) and Submit
// anyway. WorkIt never submits: Submit anyway sends nothing, it lets the
// student's next press of Submit through untouched. A tab with nothing open
// is never held. Loaded before content-script.js (shared/content-scripts.js),
// as window.WIA.submitWarning, which the fill calls in a batch tab.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  // The employer's Submit: a button, or a submit input, whose words start with "Submit" (Greenhouse's and
  // Workable's "Submit application", Ashby's "Submit Application", Lever's, Rippling's, Eightfold's and
  // Workday's review step's "Submit"). Next, Save and Continue and a job page's Apply never send.
  const SUBMIT_WORDS = /^\s*submit\b/i;
  const CONTROL = 'button, input[type="submit"], input[type="button"], [role="button"]';
  const MAX_LISTED = 5;

  /** What the student still has open on this page, as the warning lists it: a field, never a note. */
  function openItems() {
    const fields = window.WIA.status?.summary().fields ?? [];
    return fields
      .filter((r) => !r.note && (window.WIA.status.needsYou(r) || window.WIA.status.waitingOnClaude(r)))
      .map((r) => ({ key: r.key, label: r.label, why: why(r) }));
  }

  const empty = (shown) => shown === undefined || shown === null || shown === "" || (Array.isArray(shown) && shown.length === 0);
  /** A few words on why a row is open. */
  function why(r) {
    if (r.flag) return r.flag;
    if (r.status === "failed") return empty(r.shows) ? "empty on page" : "check what it shows";
    return "no answer yet";
  }

  /** The employer's Submit the event came from, or null. Events from WorkIt's own panel reach the page as its host. */
  function submitOf(event) {
    const control = event.target instanceof Element ? event.target.closest(CONTROL) : null;
    if (!control || control.id === "workit-autofiller-overlay-host") return null;
    const words = control.matches("input") ? control.value : control.innerText || control.getAttribute("aria-label") || "";
    return SUBMIT_WORDS.test(words) ? control : null;
  }

  let allowed = false;
  let card = null;
  const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function close() {
    card?.remove();
    card = null;
  }

  /** The panel's card for a held Submit. */
  function warn(items) {
    close();
    const count = items.length === 1 ? "1 thing still needs you" : `${items.length} things still need you`;
    const listed = items.slice(0, MAX_LISTED).map((i) => `<li>${escape(i.label)} <span>(${escape(i.why)})</span></li>`);
    if (items.length > MAX_LISTED) listed.push(`<li>and ${items.length - MAX_LISTED} more</li>`);
    card = window.WIA.overlay.momentCard(
      "submit-warning",
      `<h2>${count}</h2>
       <ul>${listed.join("")}</ul>
       <div class="actions">
         <button type="button" data-primary data-show>Show me</button>
         <button type="button" data-secondary data-anyway>Submit anyway</button>
       </div>`,
    );
    if (!card) return;
    card.setAttribute("role", "alertdialog");
    card.setAttribute("aria-label", count);
    card.querySelector("[data-show]").addEventListener("click", window.WIA.ui.trusted(() => {
      close();
      const key = items[0].key;
      chrome.runtime
        .sendMessage({ type: "batch/walk-from", key })
        .then((answer) => answer?.shown || window.WIA.walk?.show(key))
        .catch(() => window.WIA.walk?.show(key));
    }));
    // Only the student's own press lets Submit through: the page can't press Submit anyway for them.
    card.querySelector("[data-anyway]").addEventListener("click", window.WIA.ui.trusted(() => {
      allowed = true;
      card.removeAttribute("role");
      card.innerHTML = "<p>Press Submit again to send it. WorkIt won't stop it.</p>";
    }));
  }

  /** Holds the student's Submit while something is open (the press does nothing), and says what. */
  function hold(event) {
    if (allowed) return close();
    const items = openItems();
    if (!items.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    warn(items);
  }

  function onClick(event) {
    if (submitOf(event)) hold(event);
  }

  /** A form sent with no button (Enter in a form that has none): held too. A press on a button arrives as its click first. */
  function onSubmit(event) {
    if (!event.submitter) hold(event);
  }

  /** Watches this page's Submit, once per page: re-injected, the fill's newest rows are read (window.WIA.status). */
  function submitWarning() {
    if (window.WIA.submitWatched) return;
    window.WIA.submitWatched = true;
    // On window, in the capture phase: before the page's own handlers (React's sit on its root), so a held
    // press never reaches them. Not ui.trusted, unlike every panel button: this is the employer's Submit, not
    // the panel's, and a click the page makes on it is held too.
    window.addEventListener("click", onClick, true);
    window.addEventListener("submit", onSubmit, true);
  }

  window.WIA.submitWarning = submitWarning;
})();

// Live progress while a form fills (KAN-398), in the shell's "primary" slot
// over its button: "Scanning this page", then "N fields found", then
// "Autofilling · 37%" over a bar, with Cancel. The fields themselves are the
// Autofill tab's checklist (KAN-369 Q1, overlay.js's live list, groups.js):
// every field the Plan touches, listed at once, each spinning until the Fill
// engine is done with it. Cancel stops the fill before its next field; a
// field still filling after 5 s shows Skip on its row (isStuck), which
// leaves it for the student. A Workday step adds "Stay on this page until
// WorkIt finishes this step." It all goes once the fill is done (`end`).
//
// The engine runs in the page's world and this file in the extension's, so
// they talk through the engine's events on `document` (fillengine:field /
// stop / skip, under the key `events` gives fill/page). A page with no shell
// yet (a batch tab fills before its panel goes on the page, overlay.js's
// hydration note) shows nothing, but Stop and Skip have nothing to press there.
// Loaded before content-script.js (shared/content-scripts.js), as window.WIA.progress.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  // How long a field fills before its row offers Skip.
  const STUCK_AFTER = 5000;
  const STAY = "Stay on this page until WorkIt finishes this step.";

  const STYLES = `
    [data-slot="primary"][data-progressing] > :not([data-progress]) { display: none; }
    .progress { display: flex; flex-direction: column; gap: 8px; }
    .progress-said { font-size: var(--text-label); font-weight: 600; color: var(--color-ink); }
    .progress-bar { height: 6px; border-radius: 9999px; background: var(--color-well); overflow: hidden; }
    .progress-bar[hidden] { display: none; }
    .progress-bar > span { display: block; height: 100%; width: 0; background: var(--color-brand); transition: width 150ms; }
    .progress-stay { margin: 0; font-size: var(--text-note); color: var(--color-warning-strong); }
    .progress-stay[hidden] { display: none; }
    .progress-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .progress button {
      all: unset; cursor: pointer; padding: 3px 8px; font-size: var(--text-note); font-weight: 500; color: var(--color-ink);
      border: 1px solid var(--color-border-subtle); border-radius: var(--radius-control); background: var(--color-panel);
    }
    .progress button:hover { background: var(--color-hover); }
    .progress button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
    .progress .progress-stop { all: unset; cursor: pointer; font-size: var(--text-note); font-weight: 500; color: var(--color-brand-ink); text-decoration: underline; }
    .progress .progress-stop:disabled { cursor: default; color: var(--color-ink-meta); text-decoration: none; }
  `;

  let parts = null;
  let key = null;
  let total = 0;
  let count = 0;
  let stopped = false;
  const timers = new Map();
  // The fields filling for longer than STUCK_AFTER: their rows offer Skip.
  const stuck = new Set();

  const say = (text) => parts && (parts.said.textContent = text);

  /** Starts the progress for one fill (on Workday, one step's): "Scanning this page". */
  function begin({ stay = false } = {}) {
    end();
    stopped = false;
    total = 0;
    count = 0;
    key = `workit-${crypto.randomUUID()}`;
    document.addEventListener(`fillengine:field:${key}`, onField);
    const place = window.WIA.panel?.slot("primary");
    if (!place) return;
    window.WIA.overlay?.live?.();
    window.WIA.panel.addCss(STYLES);
    const el = Object.assign(document.createElement("div"), { className: "progress" });
    el.dataset.progress = "";
    el.innerHTML = `
      <div class="progress-top">
        <div class="progress-said" data-progress-said role="status"></div>
        <button type="button" class="progress-stop" title="Stop autofill">Cancel</button>
      </div>
      <div class="progress-bar" role="progressbar" aria-label="Fields filled" hidden><span></span></div>
      <p class="progress-stay" data-progress-stay hidden></p>`;
    parts = {
      el,
      said: el.querySelector(".progress-said"),
      bar: el.querySelector(".progress-bar"),
      stay: el.querySelector(".progress-stay"),
      stop: el.querySelector(".progress-stop"),
    };
    parts.stay.textContent = STAY;
    parts.stay.hidden = !stay;
    parts.stop.addEventListener("click", window.WIA.ui.trusted(stop));
    place.dataset.progressing = "";
    place.append(el);
    say("Scanning this page");
  }

  /** The form's questions are read: "N fields found". */
  function found(n) {
    say(n === 1 ? "1 field found" : `${n} fields found`);
  }

  /**
   * A fill of `n` more fields starts (a fill that brings on questions fills
   * again): the key its fill/page passes the engine as `events`, so its
   * fields' events reach here.
   */
  function filling(n) {
    total += n;
    showCount();
    return key;
  }

  function showCount() {
    if (!parts) return;
    say(`Autofilling · ${total ? Math.round((count / total) * 100) : 0}%`);
    parts.bar.hidden = false;
    parts.bar.setAttribute("aria-valuemax", String(total));
    parts.bar.setAttribute("aria-valuenow", String(count));
    parts.bar.firstElementChild.style.width = `${total ? Math.round((count / total) * 100) : 0}%`;
  }

  /** One of the engine's field events: a field it starts (Skip after STUCK_AFTER), or one it is done with (the count). */
  function onField(event) {
    let at;
    try {
      at = JSON.parse(event.detail);
    } catch {
      return;
    }
    clearTimeout(timers.get(at.name));
    timers.delete(at.name);
    if (stuck.delete(at.name)) window.WIA.overlay?.refresh?.();
    if (at.phase === "start") {
      timers.set(at.name, setTimeout(() => {
        timers.delete(at.name);
        stuck.add(at.name);
        window.WIA.overlay?.refresh?.();
      }, STUCK_AFTER));
      return;
    }
    count = Math.min(total, count + 1);
    showCount();
    // A filled field's checklist row turns green at once; the fill's answer (content-script.js) then
    // sets every row as WorkIt reads it back, a failed one with WorkIt's own reason.
    if (at.result?.status === "filled") window.WIA.status.setStatus(at.name, "filled", undefined, at.result.shows);
  }

  /** Whether the field `name` has been filling longer than STUCK_AFTER (its row offers Skip). */
  const isStuck = (name) => stuck.has(name);

  /** Skip on a stuck field's row: the engine leaves it for the student and the fill goes on. */
  function skip(name) {
    if (key) document.dispatchEvent(new CustomEvent(`fillengine:skip:${key}`, { detail: name }));
  }

  /** Stop autofill: the engine stops before its next field; the fill says so (content-script.js). */
  function stop() {
    stopped = true;
    if (parts) {
      parts.stop.disabled = true;
      parts.stop.textContent = "Stopping…";
    }
    if (key) document.dispatchEvent(new CustomEvent(`fillengine:stop:${key}`));
  }

  /** The fill (or step) is done: the progress goes and the slot shows its button again. */
  function end() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    stuck.clear();
    if (key) document.removeEventListener(`fillengine:field:${key}`, onField);
    if (parts) {
      delete parts.el.parentElement?.dataset.progressing;
      parts.el.remove();
    }
    parts = null;
  }

  window.WIA.progress = { begin, found, filling, end, isStuck, skip, stopped: () => stopped, STUCK_AFTER };
})();

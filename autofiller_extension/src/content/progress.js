// Live progress while a form fills (KAN-398), in the shell's "primary" slot
// over its button: "Scanning this page", then "N fields found", then
// "Filling · 12 of 30 fields" over a bar, with a row for each field as the
// Fill engine reaches it. Stop autofill stops the fill before its next field;
// a field still filling after 5 s shows Skip on its row, which leaves it for
// the student. A Workday step adds "Stay on this page until WorkIt finishes
// this step." It all goes once the fill is done (`end`).
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
    .progress-rows { list-style: none; margin: 0; padding: 0; max-height: 168px; overflow-y: auto; }
    .progress-rows li { display: flex; align-items: center; gap: 6px; padding: 3px 0; font-size: var(--text-note); color: var(--color-ink-muted); }
    .progress-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .progress-state { color: var(--color-ink-meta); }
    .progress-rows li[data-state="filled"] .progress-state { color: var(--color-positive-ink); }
    .progress-rows li[data-state="needs-you"] .progress-state { color: var(--color-danger); }
    .progress button {
      all: unset; cursor: pointer; padding: 3px 8px; font-size: var(--text-note); font-weight: 500; color: var(--color-ink);
      border: 1px solid var(--color-border-subtle); border-radius: var(--radius-control); background: var(--color-panel);
    }
    .progress button:hover { background: var(--color-hover); }
    .progress button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
    .progress .progress-stop { align-self: flex-start; }
  `;

  let parts = null;
  let key = null;
  let total = 0;
  let count = 0;
  let stopped = false;
  const timers = new Map();

  const say = (text) => parts && (parts.said.textContent = text);

  /** Starts the progress for one fill (on Workday, one step's): "Scanning this page". */
  function begin({ stay = false } = {}) {
    end();
    stopped = false;
    total = 0;
    count = 0;
    key = `workit-${Math.random().toString(36).slice(2)}`;
    document.addEventListener(`fillengine:field:${key}`, onField);
    const place = window.WIA.panel?.slot("primary");
    if (!place) return;
    window.WIA.panel.addCss(STYLES);
    const el = Object.assign(document.createElement("div"), { className: "progress" });
    el.dataset.progress = "";
    el.innerHTML = `
      <div class="progress-said" data-progress-said role="status"></div>
      <div class="progress-bar" role="progressbar" aria-label="Fields filled" hidden><span></span></div>
      <p class="progress-stay" data-progress-stay hidden></p>
      <button type="button" class="progress-stop">Stop autofill</button>
      <ul class="progress-rows"></ul>`;
    parts = {
      el,
      said: el.querySelector(".progress-said"),
      bar: el.querySelector(".progress-bar"),
      stay: el.querySelector(".progress-stay"),
      stop: el.querySelector(".progress-stop"),
      rows: el.querySelector(".progress-rows"),
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
   * fields' events reach here. `labels`: each field's label by name.
   */
  function filling(n, labels) {
    total += n;
    parts && (parts.labels = { ...(parts.labels ?? {}), ...labels });
    showCount();
    return key;
  }

  function showCount() {
    if (!parts) return;
    say(`Filling · ${count} of ${total} fields`);
    parts.bar.hidden = false;
    parts.bar.setAttribute("aria-valuemax", String(total));
    parts.bar.setAttribute("aria-valuenow", String(count));
    parts.bar.firstElementChild.style.width = `${total ? Math.round((count / total) * 100) : 0}%`;
  }

  /** One of the engine's field events: a row for a field it starts, its state once it is done. */
  function onField(event) {
    let at;
    try {
      at = JSON.parse(event.detail);
    } catch {
      return;
    }
    clearTimeout(timers.get(at.name));
    timers.delete(at.name);
    if (at.phase === "start") {
      if (!parts) return;
      const row = Object.assign(document.createElement("li"), { innerHTML: `<span class="progress-label"></span><span class="progress-state">Filling…</span>` });
      row.dataset.row = at.name;
      row.dataset.state = "filling";
      row.querySelector(".progress-label").textContent = parts.labels?.[at.name] ?? at.name;
      parts.rows.querySelector(`[data-row="${CSS.escape(at.name)}"]`)?.remove();
      parts.rows.append(row);
      row.scrollIntoView?.({ block: "nearest" });
      timers.set(at.name, setTimeout(() => offerSkip(row, at.name), STUCK_AFTER));
      return;
    }
    count = Math.min(total, count + 1);
    showCount();
    const row = parts?.rows.querySelector(`[data-row="${CSS.escape(at.name)}"]`);
    if (!row) return;
    delete row.dataset.stuck;
    row.querySelector("button")?.remove();
    const ok = at.result?.status === "filled";
    row.dataset.state = ok ? "filled" : "needs-you";
    row.querySelector(".progress-state").textContent = ok ? "Filled" : at.result?.status === "skipped" ? "Not on the form" : "Needs you";
  }

  /** A field still filling after STUCK_AFTER: Skip leaves it for the student and the fill goes on. */
  function offerSkip(row, name) {
    timers.delete(name);
    if (!row.isConnected || row.dataset.state !== "filling") return;
    row.dataset.stuck = "";
    const skip = Object.assign(document.createElement("button"), { type: "button", textContent: "Skip" });
    skip.addEventListener("click", window.WIA.ui.trusted(() => {
      skip.disabled = true;
      document.dispatchEvent(new CustomEvent(`fillengine:skip:${key}`, { detail: name }));
    }));
    row.append(skip);
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
    if (key) document.removeEventListener(`fillengine:field:${key}`, onField);
    if (parts) {
      delete parts.el.parentElement?.dataset.progressing;
      parts.el.remove();
    }
    parts = null;
  }

  window.WIA.progress = { begin, found, filling, end, stopped: () => stopped, STUCK_AFTER };
})();

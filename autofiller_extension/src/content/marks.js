// The marks Next Thing That Needs You leaves on the page (KAN-369): a ring
// around the field it lands on, for a few seconds, and a small dot on that
// field while it still needs the student (failed, waiting, flagged), gone once
// it is resolved. They sit in their own shadow host above the page, in
// WorkIt's tokens, and never take a click. batch-tab.js's show() calls them,
// as window.WIA.marks. Loaded after lib-status.js and tokens.js.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  const RING_MS = 3000;
  const RING_GAP = 6;

  let host = null;
  let root = null;
  let ring = null; // { el, field }
  /** @type {Map<string, { el: HTMLElement, field: Element, needs: () => boolean }>} */
  const dots = new Map();
  let frame = 0;

  function mount() {
    if (host) {
      if (!host.isConnected) document.documentElement.appendChild(host);
      return;
    }
    document.getElementById("workit-marks-host")?.remove(); // an earlier fill's, on this page
    host = document.createElement("div");
    host.id = "workit-marks-host";
    // Closed, as the panel's: the employer's page can't reach the marks through host.shadowRoot.
    root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      ${window.WIA.tokens}
      :host { all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
      .ring {
        position: fixed; box-sizing: border-box; border: 2px solid var(--color-brand); border-radius: var(--radius-card);
        box-shadow: 0 0 0 4px var(--color-brand-tint);
      }
      .dot {
        position: fixed; width: 10px; height: 10px; box-sizing: border-box; border-radius: 50%;
        background: var(--color-warning-strong); border: 2px solid var(--color-panel);
      }
    `;
    root.appendChild(style);
    document.documentElement.appendChild(host);
  }

  /** Keeps each mark on its field while any is shown (the page scrolls, or redraws around it). */
  function track() {
    frame = 0;
    if (!ring && !dots.size) return;
    if (host && !host.isConnected) document.documentElement.appendChild(host);
    if (ring) {
      const box = ring.field.getBoundingClientRect();
      Object.assign(ring.el.style, {
        top: `${box.top - RING_GAP}px`, left: `${box.left - RING_GAP}px`,
        width: `${box.width + 2 * RING_GAP}px`, height: `${box.height + 2 * RING_GAP}px`,
      });
    }
    for (const { el, field } of dots.values()) {
      const box = field.getBoundingClientRect();
      el.hidden = !field.isConnected;
      Object.assign(el.style, { top: `${box.top - 5}px`, left: `${box.right - 5}px` });
    }
    frame = requestAnimationFrame(track);
  }

  const start = () => frame || (frame = requestAnimationFrame(track));

  /** Rings `field` for a few seconds; a new ring takes the old one's place. */
  function ringField(field) {
    mount();
    ring?.el.remove();
    const el = Object.assign(document.createElement("div"), { className: "ring" });
    root.appendChild(el);
    const shown = (ring = { el, field });
    setTimeout(() => {
      el.remove();
      if (ring === shown) ring = null;
    }, RING_MS);
    track();
    start();
  }

  /** Puts a dot on `field` (the row `key`'s) until `needs()` says it no longer needs the student. */
  function dot(key, field, needs) {
    if (!needs()) return;
    mount();
    dots.get(key)?.el.remove();
    const el = Object.assign(document.createElement("div"), { className: "dot" });
    el.dataset.key = key;
    root.appendChild(el);
    dots.set(key, { el, field, needs });
    track();
    start();
  }

  window.WIA.status.subscribe(() => {
    for (const [key, mark] of dots) {
      if (mark.needs()) continue;
      mark.el.remove();
      dots.delete(key);
    }
  });

  window.WIA.marks = { ring: ringField, dot };
})();

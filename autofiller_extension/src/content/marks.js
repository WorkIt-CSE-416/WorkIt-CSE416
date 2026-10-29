// The mark Next Thing That Needs You leaves on the page (KAN-369): a ring
// around the field it lands on, for a few seconds. It sits in its own shadow
// host above the page, in WorkIt's tokens, and never takes a click.
// batch-tab.js's show() and primary.js call it, as window.WIA.marks. Loaded
// after tokens.js. The orange dot that stayed on a field while it needed the
// student is gone (KAN-424): its amber didn't match the panel's red box and
// read as a stray blot on the employer's form; the panel lists what is left.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  const RING_MS = 3000;
  const RING_GAP = 6;

  let host = null;
  let root = null;
  let ring = null; // { el, field }
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
    `;
    root.appendChild(style);
    document.documentElement.appendChild(host);
  }

  /** Keeps the ring on its field while it is shown (the page scrolls, or redraws around it). */
  function track() {
    frame = 0;
    if (!ring) return;
    if (host && !host.isConnected) document.documentElement.appendChild(host);
    if (ring) {
      const box = ring.field.getBoundingClientRect();
      Object.assign(ring.el.style, {
        top: `${box.top - RING_GAP}px`, left: `${box.left - RING_GAP}px`,
        width: `${box.width + 2 * RING_GAP}px`, height: `${box.height + 2 * RING_GAP}px`,
      });
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

  window.WIA.marks = { ring: ringField };
})();

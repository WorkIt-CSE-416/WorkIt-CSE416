// The on-page status panel — a shadow DOM host so its styles can't leak
// into (or be overridden by) whatever ATS page it's sitting on top of.
// Renders the same four-state-plus-honest-rollup tracker lib-status.js
// computes; this file only draws it.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  const STATUS_COLOR = {
    pending: "#9ca3af",
    filled: "#17b076",
    failed: "#dc2626",
    skipped: "#9ca3af",
    needs_generation: "#2563eb",
  };

  let host = null;
  let root = null;
  let unsubscribe = null;

  function styles() {
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .panel {
        position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;
        width: 300px; max-height: 70vh; display: flex; flex-direction: column;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: #ffffff; color: #1a1a1a; border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.18); overflow: hidden;
      }
      .header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px; background: #6d28d9; color: #fff; font-weight: 600;
      }
      .header button {
        all: unset; cursor: pointer; font-size: 14px; padding: 2px 6px; border-radius: 4px;
      }
      .header button:hover { background: rgba(255,255,255,0.15); }
      .summary { padding: 8px 12px; font-size: 12px; color: #4b5563; border-bottom: 1px solid #eee; }
      .essay-banner {
        padding: 10px 12px; background: #eff6ff; border-bottom: 1px solid #dbeafe;
        font-size: 12px; color: #1e3a8a;
      }
      .essay-banner p { margin: 0 0 8px; }
      .essay-banner .row { padding: 0; gap: 8px; }
      .essay-banner button {
        all: unset; cursor: pointer; font-size: 12px; font-weight: 600;
        padding: 5px 10px; border-radius: 6px;
      }
      .essay-banner button[data-generate] { background: #2563eb; color: #fff; }
      .essay-banner button[data-dismiss] { background: #e5e7eb; color: #374151; }
      .list { overflow-y: auto; padding: 4px 0; }
      .row {
        display: flex; align-items: flex-start; gap: 8px; padding: 6px 12px;
      }
      .dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; flex: none; }
      .label { font-weight: 500; }
      .reason { color: #dc2626; font-size: 11.5px; margin-top: 2px; }
      .empty { padding: 16px 12px; color: #6b7280; }
    `;
    return style;
  }

  function row(field) {
    const el = document.createElement("div");
    el.className = "row";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = STATUS_COLOR[field.status] ?? "#9ca3af";
    const text = document.createElement("div");
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = field.label + (field.required ? "" : " (optional)");
    text.appendChild(label);
    if (field.status === "failed" && field.reason) {
      const reason = document.createElement("div");
      reason.className = "reason";
      reason.textContent = field.reason;
      text.appendChild(reason);
    }
    el.append(dot, text);
    return el;
  }

  function render(summary) {
    if (!root) return;
    root.querySelector(".list").replaceChildren(
      ...(summary.fields.length
        ? summary.fields.map(row)
        : [Object.assign(document.createElement("div"), { className: "empty", textContent: "No fields detected yet." })]),
    );
    root.querySelector(".summary").textContent =
      summary.requiredTotal === 0
        ? "No required fields detected"
        : `${summary.requiredFilled}/${summary.requiredTotal} required fields filled` +
          (summary.failedCount > 0 ? ` · ${summary.failedCount} need attention` : "");
  }

  /**
   * The one opt-in gate for every detected essay question on the page at
   * once (never a per-question prompt — one decision for the whole batch).
   * Nothing is generated until the student clicks Generate; `onDismiss`
   * fires just as explicitly on Not Now, so a declined batch still resolves
   * to a definite state rather than sitting at "needs_generation" forever.
   * The banner removes itself once a choice is made — calling this again
   * (a second "Autofill This Page" run) rebuilds it fresh.
   * @param {{ count: number, onGenerate: () => void, onDismiss: () => void }} options
   */
  function promptForEssays({ count, onGenerate, onDismiss }) {
    if (!root || count <= 0) return;
    const banner = root.querySelector(".essay-banner");
    banner.hidden = false;
    banner.innerHTML = `
      <p>${count} essay question${count === 1 ? "" : "s"} found — generate answer${count === 1 ? "" : "s"} with AI from your experience bank?</p>
      <div class="row">
        <button type="button" data-generate>Generate</button>
        <button type="button" data-dismiss>Not Now</button>
      </div>
    `;
    const hide = () => {
      banner.hidden = true;
      banner.innerHTML = "";
    };
    banner.querySelector("[data-generate]").addEventListener("click", () => {
      hide();
      onGenerate();
    });
    banner.querySelector("[data-dismiss]").addEventListener("click", () => {
      hide();
      onDismiss();
    });
  }

  function mount() {
    if (host) return;
    host = document.createElement("div");
    host.id = "workit-autofiller-overlay-host";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.appendChild(styles());

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `
      <div class="header">
        <span>WorkIt Autofiller</span>
        <button type="button" aria-label="Close" data-close>✕</button>
      </div>
      <div class="summary"></div>
      <div class="essay-banner" hidden></div>
      <div class="list"></div>
    `;
    panel.querySelector("[data-close]").addEventListener("click", unmount);
    shadow.appendChild(panel);
    root = shadow;

    document.documentElement.appendChild(host);
    unsubscribe = window.WIA.status.subscribe(render);
    render(window.WIA.status.summary());
  }

  function unmount() {
    unsubscribe?.();
    unsubscribe = null;
    host?.remove();
    host = null;
    root = null;
  }

  window.WIA.overlay = { mount, unmount, promptForEssays };
})();

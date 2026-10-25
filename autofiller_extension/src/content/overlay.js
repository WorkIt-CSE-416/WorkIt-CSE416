// The on-page status panel — a shadow DOM host so its styles can't leak
// into (or be overridden by) whatever ATS page it's sitting on top of.
// Renders the same four-state-plus-honest-rollup tracker lib-status.js
// computes; this file only draws it.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  // Each status's dot, in WorkIt's status colours (the tokens below): positive green
  // filled, danger red failed, advanced blue waiting to be written, grey otherwise.
  const STATUS_COLOR = {
    pending: "var(--color-ink-subtle)",
    filled: "var(--color-positive)",
    failed: "var(--color-danger)",
    skipped: "var(--color-ink-subtle)",
    needs_generation: "var(--color-advanced)",
  };

  // Where a filled value came from (lib-status.js's `source`), as its badge reads.
  const SOURCE_LABEL = {
    profile: "Profile",
    student: "You",
    saved: "Saved Answer",
    guessed: "Guessed",
    claude: "Claude",
    ai: "AI",
  };
  // Phosphor's Sparkle (fill), the mark WorkIt puts on everything AI wrote (frontend/src/components/icons.tsx).
  const SPARKLE =
    '<svg viewBox="0 0 256 256" aria-hidden="true"><path fill="currentColor" d="M208,144a15.78,15.78,0,0,1-10.42,14.94L146,178l-19,51.62a15.92,15.92,0,0,1-29.88,0L78,178l-51.62-19a15.92,15.92,0,0,1,0-29.88L78,110l19-51.62a15.92,15.92,0,0,1,29.88,0L146,110l51.62,19A15.78,15.78,0,0,1,208,144ZM152,48h16V64a8,8,0,0,0,16,0V48h16a8,8,0,0,0,0-16H184V16a8,8,0,0,0-16,0V32H152a8,8,0,0,0,0,16Zm88,32h-8V72a8,8,0,0,0-16,0v8h-8a8,8,0,0,0,0,16h8v8a8,8,0,0,0,16,0V96h8a8,8,0,0,0,0-16Z"/></svg>';

  let host = null;
  let root = null;
  // The row "Next Thing That Needs You" last went to.
  let current = null;
  let unsubscribe = null;
  let keeper = null;

  function styles() {
    const style = document.createElement("style");
    style.textContent = `
      /* WorkIt's design tokens, copied from frontend/src/app/globals.css (the extension has no
         build step to import them): change a value there and here together. */
      :host {
        all: initial;
        --color-brand: #6d3fd8; --color-brand-hover: #5b30c0; --color-brand-tint: #efeaff; --color-brand-ink: #5b30c0;
        --color-on-brand: #ffffff;
        --color-ink: #121a28; --color-ink-muted: #3b3e46; --color-ink-meta: #596980; --color-ink-subtle: #94969d;
        --color-panel: #ffffff; --color-well: #f7f7f7; --color-border: #e3e9f0; --color-border-subtle: #e8ebf5;
        --color-border-control: #8a8f9a;
        --color-positive: #17b076; --color-positive-ink: #107a52; --color-positive-tint: #e3f7f0;
        --color-warning: #8a5a00; --color-warning-tint: #fdf0d9; --color-warning-strong: #d97706;
        --color-danger: #c02a3d; --color-danger-tint: #fce9eb;
        --color-advanced: #2f5fd6; --color-advanced-tint: #e3ebff;
        --radius-control: 8px; --radius-card: 10px;
        --shadow-lift: 0 2px 4px rgb(18 26 40 / 0.04), 0 10px 24px rgb(18 26 40 / 0.08);
      }
      .panel {
        position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;
        width: 300px; max-height: 70vh; display: flex; flex-direction: column;
        /* Plus Jakarta Sans where the student has it; the extension ships no font files. */
        font: 450 13px/1.4 "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        background: var(--color-panel); color: var(--color-ink); border-radius: var(--radius-card);
        border: 1px solid var(--color-border); box-shadow: var(--shadow-lift); overflow: hidden;
      }
      .header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px; background: var(--color-brand); color: var(--color-on-brand); font-weight: 600;
      }
      .header button {
        all: unset; cursor: pointer; font-size: 14px; padding: 2px 6px; border-radius: var(--radius-control);
      }
      .header button:hover { background: var(--color-brand-hover); }
      .header .actions { display: flex; gap: 4px; }
      .header button[data-skip] { font-size: 12px; font-weight: 600; border: 1px solid currentColor; padding: 2px 8px; }
      .summary { padding: 8px 12px; font-size: 12px; color: var(--color-ink-meta); border-bottom: 1px solid var(--color-border); }
      .next { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--color-border); }
      .next[hidden] { display: none; }
      .next button {
        all: unset; cursor: pointer; font-size: 12px; font-weight: 500; padding: 6px 10px;
        border-radius: var(--radius-control); background: var(--color-brand); color: var(--color-on-brand);
      }
      .next button:hover { background: var(--color-brand-hover); }
      .next button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
      .next .said { font-size: 12px; color: var(--color-ink-meta); }
      .essay-banner {
        padding: 10px 12px; background: var(--color-advanced-tint); border-bottom: 1px solid var(--color-border);
        font-size: 12px; color: var(--color-ink);
      }
      .essay-banner p { margin: 0 0 8px; }
      .essay-banner .row { padding: 0; gap: 8px; }
      .essay-banner button {
        all: unset; cursor: pointer; font-size: 12px; font-weight: 600;
        padding: 5px 10px; border-radius: var(--radius-control);
      }
      .essay-banner button[data-generate] { background: var(--color-advanced); color: var(--color-on-brand); }
      .essay-banner button[data-dismiss] { background: var(--color-panel); color: var(--color-ink); }
      /* A moment's card (KAN-387): something onboarding left for the form that first needs it. */
      .moment { padding: 10px 12px; background: var(--color-brand-tint); border-bottom: 1px solid var(--color-border); }
      .moment[hidden] { display: none; }
      .moment h2 { margin: 0 0 4px; font-size: 13px; font-weight: 600; color: var(--color-ink); }
      .moment p { margin: 0 0 8px; font-size: 12px; color: var(--color-ink-muted); }
      .moment label { display: block; margin: 0 0 8px; font-size: 12px; font-weight: 500; color: var(--color-ink); }
      .moment select {
        display: block; width: 100%; margin-top: 3px; padding: 5px 6px; font: inherit; font-size: 12px;
        color: var(--color-ink); background: var(--color-panel);
        border: 1px solid var(--color-border-control); border-radius: var(--radius-control);
      }
      .moment .actions { display: flex; gap: 8px; margin-top: 4px; }
      .moment button, .moment a {
        all: unset; cursor: pointer; font-size: 12px; font-weight: 500; padding: 6px 10px; border-radius: var(--radius-control);
      }
      .moment [data-primary] { background: var(--color-brand); color: var(--color-on-brand); display: inline-flex; align-items: center; gap: 4px; }
      .moment [data-primary]:hover { background: var(--color-brand-hover); }
      .moment [data-primary] svg { width: 12px; height: 12px; }
      .moment [data-secondary] { background: var(--color-panel); color: var(--color-ink); border: 1px solid var(--color-border); }
      .moment button:focus-visible, .moment a:focus-visible, .moment select:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
      .moment .error { color: var(--color-danger); }
      .list { overflow-y: auto; padding: 4px 0; }
      .row {
        display: flex; align-items: flex-start; gap: 8px; padding: 6px 12px;
      }
      /* A guess (lib-status.js's source "guessed"): the student checks it before they submit. */
      .row[data-guessed] { background: var(--color-warning-tint); }
      .row[data-current] { box-shadow: inset 3px 0 0 var(--color-brand); background: var(--color-brand-tint); }
      .dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; flex: none; }
      .text { flex: 1; min-width: 0; }
      .label { font-weight: 500; }
      .source {
        display: inline-flex; align-items: center; gap: 3px; margin-top: 2px;
        font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 999px;
        background: var(--color-well); color: var(--color-ink-meta);
      }
      .source svg { width: 11px; height: 11px; }
      .source[data-source="guessed"] { background: var(--color-panel); color: var(--color-warning); border: 1px solid var(--color-warning-strong); }
      .source[data-source="student"] { background: var(--color-positive-tint); color: var(--color-positive-ink); }
      .source[data-source="claude"], .source[data-source="ai"] { background: var(--color-brand-tint); color: var(--color-brand-ink); }
      .reason { color: var(--color-danger); font-size: 12px; margin-top: 2px; }
      .reason.note { color: var(--color-ink-meta); }
      .empty { padding: 16px 12px; color: var(--color-ink-meta); }
    `;
    return style;
  }

  function row(field) {
    const el = document.createElement("div");
    el.className = "row";
    el.dataset.key = field.key;
    if (field.key === current) el.dataset.current = "";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = STATUS_COLOR[field.status] ?? STATUS_COLOR.pending;
    const text = document.createElement("div");
    text.className = "text";
    const label = document.createElement("div");
    label.className = "label";
    // A row keyed "_..." is the overlay's own message (content-script.js's note), not a field.
    label.textContent = field.label + (field.required || field.key.startsWith("_") ? "" : " (optional)");
    text.appendChild(label);
    // Where a filled value came from; a guess is highlighted for the student to check.
    if (field.status === "filled" && SOURCE_LABEL[field.source]) {
      const source = document.createElement("span");
      source.className = "source";
      source.dataset.source = field.source;
      source.innerHTML = field.source === "claude" || field.source === "ai" ? SPARKLE : "";
      source.append(SOURCE_LABEL[field.source]);
      text.appendChild(source);
      if (field.source === "guessed") el.dataset.guessed = "";
    }
    // needs_generation's reason says who writes it (a batch tab: the student's Claude, KAN-377).
    if ((field.status === "failed" || field.status === "skipped" || field.status === "needs_generation") && field.reason) {
      const reason = document.createElement("div");
      reason.className = field.status === "failed" ? "reason" : "reason note";
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

  /** A new moment card at the top of the panel's list (KAN-387); removed by its own buttons. */
  function momentCard(className, html) {
    if (!root) return null;
    const card = document.createElement("section");
    card.className = `moment ${className}`;
    card.innerHTML = html;
    root.querySelector(".moments").appendChild(card);
    return card;
  }

  const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  /**
   * The self-identification, asked on the first form that asks it
   * (KAN-387): one list per question, "Leave Blank" first. Save sends the
   * answers picked to `onSave`, which answers an error to show, or null once
   * saved; Not Now closes the card and saves nothing.
   * @param {{ questions: { key: string, label: string, question: string, options: { value: string, label: string }[] }[],
   *   onSave: (answers: Record<string, string>) => Promise<string | null> }} options
   */
  function askSelfId({ questions, onSave }) {
    const card = momentCard("self-id", `
      <h2>Equal-Opportunity Questions</h2>
      <p>This form asks voluntary self-identification questions. Answer them once and WorkIt fills them on every form from now on. You can change them in My Profile.</p>
      ${questions.map((q) => `
        <label>${escape(q.label)}
          <select name="${escape(q.key)}" title="${escape(q.question)}">
            <option value="">Leave Blank</option>
            ${q.options.map((o) => `<option value="${escape(o.value)}">${escape(o.label)}</option>`).join("")}
          </select>
        </label>`).join("")}
      <p class="error" hidden></p>
      <div class="actions">
        <button type="button" data-primary data-save>Save and Fill</button>
        <button type="button" data-secondary data-dismiss>Not Now</button>
      </div>
    `);
    if (!card) return;
    const error = card.querySelector(".error");
    card.querySelector("[data-dismiss]").addEventListener("click", () => card.remove());
    card.querySelector("[data-save]").addEventListener("click", async () => {
      const answers = Object.fromEntries([...card.querySelectorAll("select")].filter((s) => s.value).map((s) => [s.name, s.value]));
      error.hidden = true;
      const failed = await onSave(answers);
      if (!failed) return card.remove();
      error.textContent = failed;
      error.hidden = false;
    });
  }

  /**
   * The add-Claude step (KAN-387), on a batch's first question for the
   * student's Claude: Add to Claude opens `url` (the webapp's
   * /connect/claude/add, which goes on to Claude's Add Custom Connector
   * dialog) in a new tab; then the student asks their Claude to write.
   * @param {{ url: string }} options
   */
  function offerClaude({ url }) {
    const card = momentCard("add-claude", `
      <h2>Let Your Claude Write These</h2>
      <p>This form has a question to write. Add WorkIt to your Claude once, then ask it to "Write my WorkIt answers": each answer fills in here, for you to check.</p>
      <div class="actions">
        <a data-primary data-add target="_blank" rel="noreferrer">${SPARKLE}Add to Claude</a>
        <button type="button" data-secondary data-dismiss>Not Now</button>
      </div>
    `);
    if (!card) return;
    const add = card.querySelector("[data-add]");
    add.href = url;
    add.addEventListener("click", () => card.remove());
    card.querySelector("[data-dismiss]").addEventListener("click", () => card.remove());
  }

  /**
   * The writing samples ask (KAN-387), once the first batch's written answers
   * landed: Add Samples opens `url` (My Profile's Writing Samples) in a new
   * tab; Skip closes it. Either way it is not asked again.
   * @param {{ url: string }} options
   */
  function askSamples({ url }) {
    const card = momentCard("samples", `
      <h2>Make Your Answers Sound Like You</h2>
      <p>Your Claude wrote this batch's answers. Add two or three things you wrote yourself, such as a class essay or a cover letter, and it writes the next ones in your style. Optional.</p>
      <div class="actions">
        <a data-primary data-add target="_blank" rel="noreferrer">Add Samples</a>
        <button type="button" data-secondary data-dismiss>Skip</button>
      </div>
    `);
    if (!card) return;
    const add = card.querySelector("[data-add]");
    add.href = url;
    add.addEventListener("click", () => card.remove());
    card.querySelector("[data-dismiss]").addEventListener("click", () => card.remove());
  }

  /**
   * Batch apply's "Next Thing That Needs You" (content-script.js): shows the
   * button, which calls `onNext` and shows what it answers (a sentence for
   * the student, or nothing when it went to a field).
   * @param {() => Promise<string | null>} onNext
   */
  function offerNext(onNext) {
    if (!root) return;
    const bar = root.querySelector(".next");
    const said = bar.querySelector("[data-said]");
    bar.hidden = false;
    bar.querySelector("[data-next]").onclick = async () => {
      said.hidden = true;
      const text = await onNext();
      said.textContent = text ?? "";
      said.hidden = !text;
    };
  }

  /** Marks the row "Next Thing That Needs You" went to (null: none), and brings it into view. */
  function setCurrent(key) {
    current = key;
    if (!root) return;
    render(window.WIA.status.summary());
    root.querySelector("[data-current]")?.scrollIntoView({ block: "nearest" });
  }

  /**
   * Puts the panel on the page. `onSkip`: a batch tab's Skip (the job leaves
   * the batch, and its tab closes), shown as a button in the header.
   * @param {{ onSkip?: () => void }} [options]
   */
  function mount({ onSkip } = {}) {
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
        <span class="actions">
          ${onSkip ? '<button type="button" data-skip title="Leave this job out of the batch">Skip</button>' : ""}
          <button type="button" aria-label="Close" data-close>✕</button>
        </span>
      </div>
      <div class="summary"></div>
      <div class="next" hidden>
        <button type="button" data-next>Next Thing That Needs You</button>
        <span class="said" data-said hidden></span>
      </div>
      <div class="essay-banner" hidden></div>
      <div class="moments"></div>
      <div class="list"></div>
    `;
    panel.querySelector("[data-close]").addEventListener("click", unmount);
    panel.querySelector("[data-skip]")?.addEventListener("click", onSkip);
    shadow.appendChild(panel);
    root = shadow;

    document.documentElement.appendChild(host);
    keepAttached();
    unsubscribe = window.WIA.status.subscribe(render);
    render(window.WIA.status.summary());
  }

  /**
   * Puts the panel back whenever the page removes it. Greenhouse is a React
   * app that takes over the whole document when it starts up (hydration),
   * and that drops nodes it didn't render, ours included, sometimes by
   * replacing <html> itself. The auto-apply runner shows its tab and fills
   * at once, which lands the fill right as the page starts up: the fields
   * filled, but the panel was gone. So this watches the whole document,
   * not one element, and appends the same host to whichever <html> exists.
   */
  function keepAttached() {
    keeper = new MutationObserver(() => {
      if (host && !host.isConnected) document.documentElement.appendChild(host);
    });
    keeper.observe(document, { childList: true, subtree: true });
  }

  function unmount() {
    keeper?.disconnect();
    keeper = null;
    unsubscribe?.();
    unsubscribe = null;
    host?.remove();
    host = null;
    root = null;
  }

  window.WIA.overlay = { mount, unmount, promptForEssays, offerNext, setCurrent, askSelfId, offerClaude, askSamples };
})();

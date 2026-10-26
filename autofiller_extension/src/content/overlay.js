// The panel's Autofill tab: the fill's rows and cards, in the shell's
// shadow root (panel.js), so the page's styles can't reach them. Renders
// the same four-state-plus-honest-rollup tracker lib-status.js computes;
// this file only draws it.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  // Injected again (Fill Again, the fill after a human check): the last fill's rows go; the shell stays.
  window.WIA.overlay?.unmount?.();

  // Where a filled value came from (lib-status.js's `source`), as its badge reads.
  const SOURCE_LABEL = {
    profile: "Profile",
    student: "You",
    saved: "Saved Answer",
    guessed: "Guessed",
    claude: "Claude",
    ai: "AI",
    pasted: "Pasted",
  };
  // Phosphor's Sparkle (fill), the mark WorkIt puts on everything AI wrote (frontend/src/components/icons.tsx).
  const SPARKLE =
    '<svg viewBox="0 0 256 256" aria-hidden="true"><path fill="currentColor" d="M208,144a15.78,15.78,0,0,1-10.42,14.94L146,178l-19,51.62a15.92,15.92,0,0,1-29.88,0L78,178l-51.62-19a15.92,15.92,0,0,1,0-29.88L78,110l19-51.62a15.92,15.92,0,0,1,29.88,0L146,110l51.62,19A15.78,15.78,0,0,1,208,144ZM152,48h16V64a8,8,0,0,0,16,0V48h16a8,8,0,0,0,0-16H184V16a8,8,0,0,0-16,0V32H152a8,8,0,0,0,0,16Zm88,32h-8V72a8,8,0,0,0-16,0v8h-8a8,8,0,0,0,0,16h8v8a8,8,0,0,0,16,0V96h8a8,8,0,0,0,0-16Z"/></svg>';

  // What the student sends their Claude to start writing: the connector prompt's title
  // (backend/app/connector/prompt.py TITLE). Write with Claude copies it and opens a new
  // claude.ai chat with it in the box, not sent; nothing of the student's goes in the link.
  const CLAUDE_TRIGGER = "Write my WorkIt answers";
  const CLAUDE_START_URL = `https://claude.ai/new?q=${encodeURIComponent(CLAUDE_TRIGGER)}`;

  // The shell's shadow root (panel.js) while a fill's rows are in it, and the styles added to it.
  let root = null;
  let style = null;
  // The row "Next Thing That Needs You" last went to.
  let current = null;
  // The row the student last pressed: open, with its full question and source (KAN-369 Q4).
  let opened = null;
  // True while the list shows during a fill, before mount (live).
  let early = false;
  let unsubscribe = null;
  // Parts other files add above the panel's list (addPart): their styles, and the part.
  const parts = [];

  function styles() {
    const style = document.createElement("style");
    style.textContent = `
      .summary { padding: 8px 12px; font-size: var(--text-note); color: var(--color-ink-meta); border-bottom: 1px solid var(--color-border); }
      .essay-banner {
        padding: 10px 12px; background: var(--color-advanced-tint); border-bottom: 1px solid var(--color-border);
        font-size: var(--text-note); color: var(--color-ink);
      }
      .essay-banner p { margin: 0 0 8px; }
      .essay-banner .row { padding: 0; gap: 8px; }
      .essay-banner button {
        all: unset; cursor: pointer; font-size: var(--text-note); font-weight: 500;
        display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; border-radius: var(--radius-control);
      }
      .essay-banner button[data-generate] { background: var(--color-advanced); color: var(--color-on-brand); }
      .essay-banner button[data-dismiss] { background: var(--color-panel); color: var(--color-ink); border: 1px solid var(--color-border-subtle); }
      .essay-banner button[data-generate] svg { width: 12px; height: 12px; }
      .essay-banner button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
      /* A moment's card (KAN-387): something onboarding left for the form that first needs it. */
      .moment { padding: 10px 12px; background: var(--color-brand-tint); border-bottom: 1px solid var(--color-border); }
      .moment[hidden] { display: none; }
      .moment h2 { margin: 0 0 4px; font-size: var(--text-label); font-weight: 600; color: var(--color-ink); }
      .moment p { margin: 0 0 8px; font-size: var(--text-note); color: var(--color-ink-muted); }
      .moment label { display: block; margin: 0 0 8px; font-size: var(--text-note); font-weight: 500; color: var(--color-ink); }
      .moment select {
        display: block; width: 100%; margin-top: 3px; padding: 5px 6px; font: inherit; font-size: var(--text-note);
        color: var(--color-ink); background: var(--color-panel);
        border: 1px solid var(--color-border-control); border-radius: var(--radius-control);
      }
      .moment .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
      .moment button, .moment a {
        all: unset; cursor: pointer; font-size: var(--text-note); font-weight: 500; padding: 6px 10px; border-radius: var(--radius-control);
      }
      .moment [data-primary] { background: var(--color-brand); color: var(--color-on-brand); display: inline-flex; align-items: center; gap: 4px; }
      .moment [data-primary]:hover { background: var(--color-brand-hover); }
      .moment [data-primary] svg { width: 12px; height: 12px; }
      .moment [data-secondary] { background: var(--color-panel); color: var(--color-ink); border: 1px solid var(--color-border-subtle); }
      .moment [data-secondary]:hover { background: var(--color-hover); }
      .moment button:focus-visible, .moment a:focus-visible, .moment select:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
      .moment .error { color: var(--color-danger); }
      .moment ul { margin: 0 0 8px; padding-left: 16px; font-size: var(--text-note); color: var(--color-ink-muted); }
      .moment li span { color: var(--color-ink-meta); }
      .list { padding: 4px 0; }
      .row {
        display: flex; align-items: flex-start; gap: 8px; padding: 6px 12px;
      }
      /* A guess (lib-status.js's source "guessed"): the student checks it before they submit. */
      .row[data-guessed] { background: var(--color-warning-tint); }
      .row[data-current] { box-shadow: inset 3px 0 0 var(--color-brand); background: var(--color-brand-tint); }
      /* A row with a field: pressing it goes to the field (window.WIA.showField). */
      .row[data-jump] { cursor: pointer; }
      .row[data-jump]:hover .label { text-decoration: underline; }
      .label:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; border-radius: var(--radius-control); }
      .dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; flex: none; }
      .text { flex: 1; min-width: 0; }
      .label { font-weight: 500; }
      /* A long question shows two lines until its row is opened (pressed, or Next Thing's). */
      .row:not([data-open]) .label { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
      .row:not([data-open]) .source { display: none; }
      .row .skip {
        all: unset; cursor: pointer; margin-top: 4px; display: inline-block; padding: 3px 8px; font-size: var(--text-note); font-weight: 500; color: var(--color-ink);
        border: 1px solid var(--color-border-subtle); border-radius: var(--radius-control); background: var(--color-panel);
      }
      .row .skip:hover { background: var(--color-hover); }
      .row .skip:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
      .source {
        display: inline-flex; align-items: center; gap: 3px; margin-top: 2px;
        font-size: var(--text-meta); font-weight: 600; padding: 1px 6px; border-radius: 9999px;
        background: var(--color-well); color: var(--color-ink-meta);
      }
      .source svg { width: 11px; height: 11px; }
      .source[data-source="guessed"] { background: var(--color-panel); color: var(--color-warning); border: 1px solid var(--color-warning-strong); }
      .source[data-source="student"] { background: var(--color-positive-tint); color: var(--color-positive-ink); }
      .source[data-source="claude"], .source[data-source="ai"] { background: var(--color-brand-tint); color: var(--color-brand-ink); }
      .reason { color: var(--color-danger); font-size: var(--text-note); margin-top: 2px; }
      .reason.note { color: var(--color-ink-meta); }
      /* An answer the student's Claude's pre-submit review flagged (KAN-369): theirs to read before they submit. */
      .row[data-flagged] { background: var(--color-warning-tint); }
      .reason.flag { color: var(--color-warning); }
      .reason a { color: var(--color-brand-ink); font-weight: 500; text-decoration: underline; }
      .reason a:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
      .start { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 4px; }
      .start a {
        all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;
        font-size: var(--text-note); font-weight: 500; padding: 4px 8px; border-radius: var(--radius-control);
        background: var(--color-panel); color: var(--color-ink); border: 1px solid var(--color-border-subtle);
      }
      .start a:hover { background: var(--color-hover); }
      .start a:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
      .start svg { width: 12px; height: 12px; color: var(--color-brand); }
      .start .hint { font-size: var(--text-meta); color: var(--color-ink-meta); }
      .empty { padding: 16px 12px; color: var(--color-ink-meta); }
      ${window.WIA.rowCard?.css ?? ""}
      ${window.WIA.groups?.css ?? ""}
      ${parts.map((part) => part.css ?? "").join("\n")}
    `;
    return style;
  }

  function row(field) {
    const el = document.createElement("div");
    el.className = "row";
    el.dataset.key = field.key;
    if (field.key === current) el.dataset.current = "";
    if (field.key === current || field.key === opened) el.dataset.open = "";
    // Its mark (groups.js markOf): spinner, check, ?, ! or gray.
    const mark = window.WIA.groups?.markOf(field);
    if (mark) el.dataset.mark = mark;
    const dot = document.createElement("span");
    dot.className = "dot";
    const text = document.createElement("div");
    text.className = "text";
    const label = document.createElement("div");
    label.className = "label";
    // A note row is the overlay's own message (content-script.js's note), not a field.
    label.textContent = field.label + (field.required || field.note ? "" : " (optional)");
    text.appendChild(label);
    // A field's row (a note is not one) takes the student to the field: by mouse, or Enter on its label.
    if (!field.note) {
      el.dataset.jump = "";
      label.tabIndex = 0;
      label.title = "Go to this field";
    }
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
    // A row's card (row-card.js) says what is wrong in its place: a failed field's says what the page shows.
    const card = window.WIA.rowCard?.for(field) ?? null;
    // needs_generation's reason says who writes it (a batch tab: the student's Claude, KAN-377).
    if (!card && (field.status === "failed" || field.status === "skipped" || field.status === "needs_generation" || field.status === "pending") && field.reason) {
      const reason = document.createElement("div");
      reason.className = field.status === "failed" ? "reason" : "reason note";
      reason.textContent = field.reason;
      if (field.link) {
        const link = Object.assign(document.createElement("a"), { href: field.link.href, textContent: field.link.text, target: "_blank", rel: "noreferrer" });
        reason.append(" ", link, ".");
      }
      text.appendChild(reason);
    }
    if (card) text.appendChild(card);
    // The waiting card (card-waiting.js) carries Write with Claude, with a paste box and Write it myself.
    if (field.status === "needs_generation" && field.claude) text.appendChild(window.WIA.waitingCard?.card(field, startClaude) ?? startClaude());
    // The flag card (card-flag.js): the reason, the flagged sentence, Keep / Rewrite with Claude / Edit myself.
    if (field.flag && window.WIA.flagCard) {
      el.dataset.flagged = "";
      text.appendChild(window.WIA.flagCard.render(field));
    } else if (field.flag) {
      el.dataset.flagged = "";
      const reason = document.createElement("div");
      reason.className = "reason flag";
      reason.textContent = `Your Claude's check: ${field.flag} Read it before you submit, and edit it if it's wrong.`;
      text.appendChild(reason);
    }
    // See cover letter (letter-preview.js): the written answer as the form has it.
    const letter = window.WIA.letterPreview?.render(field);
    if (letter) text.appendChild(letter);
    // A field still filling after a while (progress.js): Skip leaves it for the student and the fill goes on.
    if (window.WIA.progress?.isStuck?.(field.key)) {
      el.dataset.stuck = "";
      const skip = Object.assign(document.createElement("button"), { type: "button", className: "skip", textContent: "Skip" });
      skip.addEventListener("click", window.WIA.ui.trusted(() => {
        skip.disabled = true;
        window.WIA.progress.skip(field.key);
      }));
      text.appendChild(skip);
    }
    el.append(dot, text);
    return el;
  }

  /**
   * Write with Claude (a row waiting for the student's Claude): opens a new
   * claude.ai chat with the trigger in its box, and copies the trigger too,
   * since claude.ai's prefill (`?q=`) is undocumented: if it stops working,
   * the student pastes.
   */
  function startClaude() {
    const start = document.createElement("div");
    start.className = "start";
    const open = Object.assign(document.createElement("a"), { href: CLAUDE_START_URL, target: "_blank", rel: "noreferrer" });
    open.innerHTML = SPARKLE;
    open.append("Write with Claude");
    open.addEventListener("click", () => copy(CLAUDE_TRIGGER));
    const hint = Object.assign(document.createElement("span"), { className: "hint", textContent: "Press Enter in Claude (or paste)" });
    start.append(open, hint);
    return start;
  }

  /** Copies `text`; a page whose clipboard is refused (no permission) gets the older copy command. */
  function copy(text) {
    navigator.clipboard.writeText(text).catch(() => {
      const box = Object.assign(document.createElement("textarea"), { value: text });
      root.appendChild(box);
      box.select();
      document.execCommand("copy");
      box.remove();
    });
  }

  /**
   * A press on a row (not on a button, link or box in its card) goes to its
   * field: scrolled to, focused and ringed (batch-tab.js's show, the same
   * as Next Thing That Needs You's). A field the page doesn't show gets a
   * line saying so; on Workday, one from another step names the step.
   */
  function jump(event) {
    if (event.type === "keydown" && (event.key !== "Enter" || !event.target.matches(".label"))) return;
    if (event.target.closest("button, a, input, textarea, select, label, [contenteditable], .row-card")) return;
    const el = event.target.closest(".row[data-jump]");
    if (!el || !window.WIA.showField) return;
    const key = el.dataset.key;
    opened = key;
    render(window.WIA.status.summary());
    if (window.WIA.showField(key)) return;
    const step = key.split(" / ")[0];
    const elsewhere = window.WIA.workday?.isWorkday && key.includes(" / ") && step !== window.WIA.workday.step?.();
    const said = Object.assign(document.createElement("div"), {
      className: "reason note",
      textContent: elsewhere ? `This is on Workday's ${step} step.` : "WorkIt can't find this field on the page.",
    });
    root.querySelector(`.row[data-key="${CSS.escape(key)}"] .text`)?.appendChild(said);
    setTimeout(() => said.remove(), 4000);
  }

  function render(summary) {
    if (!root) return;
    // A kept card's box (card-waiting.js) is moved, not rebuilt: it keeps the student's focus.
    const focused = root.activeElement;
    root.querySelector(".list").replaceChildren(
      ...(summary.fields.length
        ? (window.WIA.groups?.render(summary.fields, row) ?? summary.fields.map(row))
        : [Object.assign(document.createElement("div"), { className: "empty", textContent: "No fields detected yet." })]),
    );
    root.querySelector(".parts").replaceChildren(...parts.map((part) => part.panel?.(summary)).filter(Boolean));
    root.querySelector(".summary").textContent =
      summary.requiredTotal === 0
        ? "No required fields detected"
        : `${summary.requiredFilled}/${summary.requiredTotal} required fields filled` +
          (window.WIA.status.needsYouCount() > 0 ? ` · ${window.WIA.status.needsYouCount()} need you` : ""); // the one rule (lib-status.js)
    // Rows waiting for the student's Claude, apart: nothing for the student to fix yet (the walk visits them last).
    const onClaude = summary.fields.filter((r) => r.status === "needs_generation" && r.claude).length;
    if (onClaude) root.querySelector(".summary").textContent += ` · ${onClaude} waiting on Claude`;
    if (focused?.isConnected && root.activeElement !== focused) focused.focus({ preventScroll: true });
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
        <button type="button" data-generate>${SPARKLE}Generate</button>
        <button type="button" data-dismiss>Not Now</button>
      </div>
    `;
    const hide = () => {
      banner.hidden = true;
      banner.innerHTML = "";
    };
    banner.querySelector("[data-generate]").addEventListener("click", window.WIA.ui.trusted(() => {
      hide();
      onGenerate();
    }));
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
    card.querySelector("[data-save]").addEventListener("click", window.WIA.ui.trusted(async () => {
      const answers = Object.fromEntries([...card.querySelectorAll("select")].filter((s) => s.value).map((s) => [s.name, s.value]));
      error.hidden = true;
      const failed = await onSave(answers);
      if (!failed) return card.remove();
      error.textContent = failed;
      error.hidden = false;
    }));
  }

  /**
   * The add-Claude step (KAN-387), on a batch's first question for the
   * student's Claude: Add to Claude opens `url` (the webapp's
   * /connect/claude/add, which goes on to Claude's Add Custom Connector
   * dialog) in a new tab; then the student asks their Claude to write,
   * and allows each of WorkIt's tools for good ("Always allow"), else Claude
   * asks before every save.
   * @param {{ url: string }} options
   */
  function offerClaude({ url }) {
    const card = momentCard("add-claude", `
      <h2>Let Your Claude Write These</h2>
      <p>This form has a question to write. Add WorkIt to your Claude once, then ask it to "${CLAUDE_TRIGGER}": each answer fills in here, for you to check.</p>
      <p>When Claude first asks to use each of WorkIt's tools, choose "Always allow", so it doesn't stop to ask at every answer.</p>
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
   * The Workday accounts ask (KAN-369), on the first company's Workday
   * Create Account or Sign In until the student answers: Sign Me In calls
   * `onAllow` (the extension then presses Create Account or Sign In at every
   * company, workday.js); Not Now closes it for this page.
   * @param {{ onAllow: () => void }} options
   */
  function askWorkdayAccounts({ onAllow }) {
    const card = momentCard("workday-accounts", `
      <h2>Let WorkIt Sign You In to Workday</h2>
      <p>Each company's Workday asks you to make an account. WorkIt can make it and sign you in, here and at every company from now on. It fills your email and a new password made for that company alone, or the one password you set in Workday Sign-Up, kept only in this browser. It ticks the box that you agree to the company's terms and privacy notice, and presses Create Account or Sign In. Each time, the panel names the box it ticked.</p>
      <div class="actions">
        <button type="button" data-primary data-allow>Sign Me In</button>
        <button type="button" data-secondary data-dismiss>Not Now</button>
        <button type="button" data-secondary data-signup>Set One Password</button>
      </div>
    `);
    if (!card) return;
    card.querySelector("[data-dismiss]").addEventListener("click", () => card.remove());
    // The extension's Workday Sign-Up page (src/options/), in a tab of its own; the card stays for the answer.
    card.querySelector("[data-signup]").addEventListener("click", () => chrome.runtime.sendMessage({ type: "workday/signup-open" }));
    card.querySelector("[data-allow]").addEventListener("click", () => {
      card.remove();
      onAllow();
    });
  }

  /**
   * Next Thing (content-script.js's walk): the panel's primary button
   * (primary.js) calls `onNext` and shows what it answers (a sentence for
   * the student, or nothing when it went to a field).
   * @param {() => Promise<string | null>} onNext
   */
  function offerNext(onNext) {
    if (!root) return;
    window.WIA.primary?.offerNext(onNext);
  }

  /** Marks the row "Next Thing That Needs You" went to (null: none), and brings it into view. */
  function setCurrent(key) {
    current = key;
    if (!root) return;
    render(window.WIA.status.summary());
    root.querySelector("[data-current]")?.scrollIntoView({ block: "nearest" });
  }

  /**
   * Puts the fill's rows and cards in the panel's Autofill tab (panel.js,
   * the shell). `onSkip`: a batch tab's Skip (the job leaves the batch, and
   * its tab closes), shown in the header. `onSubmitted`: a batch tab's "I
   * submitted this", for a submit WorkIt didn't see; it answers only the
   * student's own click (`isTrusted`), never one a page script makes on
   * this open shadow root. A batch tab's panel opens by itself now that its
   * fill is done (unless the student collapsed it on this site); elsewhere
   * the student pressed Autofill This Page, so it is open already.
   * @param {{ onSkip?: () => void, onSubmitted?: () => void }} [options]
   */
  function mount({ onSkip, onSubmitted } = {}) {
    if (root && !early) return;
    const shell = window.WIA.panel;
    void shell.ensure();
    if (!early) draw();
    early = false;

    const actions = shell.slot("header-actions");
    actions.innerHTML = `
      ${onSubmitted ? '<button type="button" data-submitted title="You sent this application: mark it Applied">I submitted this</button>' : ""}
      ${onSkip ? '<button type="button" data-skip title="Leave this job out of the batch">Skip</button>' : ""}
    `;
    actions.querySelector("[data-skip]")?.addEventListener("click", window.WIA.ui.trusted(onSkip));
    actions.querySelector("[data-submitted]")?.addEventListener("click", (event) => event.isTrusted && onSubmitted());

    // The primary slot's button (primary.js, KAN-396): Next Thing, Ready to submit, and Fill Again under it.
    if (window.WIA.primary) window.WIA.primary.mount();
    else shell.fillButton("Fill Again", { secondary: true });

    if (window.WIA.batch) void shell.autoOpen();
    else shell.open();
  }

  /** The Autofill tab's list, drawn in the shell and kept up to date with the rows. */
  function draw() {
    const shell = window.WIA.panel;
    root = shell.root;
    style = shell.addCss(styles().textContent);
    const tab = shell.slot("tab:autofill");
    tab.innerHTML = `
      <div class="card fields">
        <div class="summary"></div>
        <div class="essay-banner" hidden></div>
        <div class="moments"></div>
        <div class="parts"></div>
        <div class="list"></div>
      </div>
    `;
    tab.querySelector(".list").addEventListener("click", jump);
    tab.querySelector(".list").addEventListener("keydown", jump);
    unsubscribe = window.WIA.status.subscribe(render);
    render(window.WIA.status.summary());
  }

  /**
   * The checklist while a fill runs (KAN-369 Q1, progress.js's begin): every
   * row as soon as the Plan registers it, each spinning until it is filled.
   * Only on a page whose shell is up already (the student pressed Autofill
   * This Page): a batch tab gets no panel before its fill is done (hydration,
   * content-script.js). mount() then adds the rest.
   */
  function live() {
    if (root || !window.WIA.panel?.root) return;
    draw();
    early = true;
  }

  /** Empties what the last fill put in the panel (a fill again draws it anew); the shell stays. */
  function unmount() {
    unsubscribe?.();
    unsubscribe = null;
    style?.remove();
    style = null;
    if (root) {
      window.WIA.panel.slot("tab:autofill")?.replaceChildren();
      window.WIA.panel.slot("header-actions")?.replaceChildren();
    }
    root = null;
    early = false;
  }

  /** Shows the panel again after a collapse, as it was (no fill); false when this page has none. */
  function open() {
    if (!root) return false;
    return window.WIA.panel.open();
  }

  /**
   * What the background asks a page: null when no fill drew rows here, else
   * whether the panel shows, whether the page is a batch tab, and the fill's
   * phase ("filling" while it runs).
   */
  function state() {
    if (!root) return null;
    return { shown: window.WIA.panel.isOpen(), batch: Boolean(window.WIA.batch), phase: window.WIA.phase ?? null };
  }

  /**
   * Adds a part above the panel's list, from its own file (card-guess.js):
   * `css` for the panel's styles (tokens only), `panel(summary)` its node or
   * null, asked again at every render. A row's card is row-card.js's.
   * Added before the panel mounts.
   * @param {{ css?: string, panel?: (summary: object) => Node | null }} part
   */
  function addPart(part) {
    parts.push(part);
  }

  /** Draws the rows again, for a row card whose own state changed (row-card.js). */
  const refresh = () => render(window.WIA.status.summary());

  window.WIA.overlay = { live, mount, unmount, open, state, promptForEssays, offerNext, setCurrent, refresh, addPart, askSelfId, offerClaude, askSamples, askWorkdayAccounts, momentCard, startClaude, CLAUDE_TRIGGER };
})();

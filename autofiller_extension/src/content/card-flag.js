// The flag card (KAN-369): under a batch tab's panel row whose answer the
// student's Claude's pre-submit check flagged (written-answers.js
// awaitReview). It shows Claude's reason and the sentence it means, and
// offers Keep (asks once, then WorkIt records the student's choice and the
// check won't flag that text again), Rewrite with Claude (the answer goes
// back to the student's Claude, which writes it again with the reason), or
// Edit myself (the field is focused with the sentence selected; the flag
// clears once that sentence changes). A wrong-company flag (`flagHard`) is
// marked in the danger colour and needs the student like any flag, so its
// tab is never Ready while it holds. The student still presses Submit.
// Loaded after overlay.js (shared/content-scripts.js): overlay.js's row
// draws it, as window.WIA.flagCard.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  const STYLES = `
    .flag-card { margin-top: 6px; padding: 8px; border-radius: var(--radius-control); border: 1px solid var(--color-warning-strong); background: var(--color-panel); }
    .flag-card[data-hard] { border-color: var(--color-danger); }
    .flag-card[data-hard] .reason.flag { color: var(--color-danger); }
    .flag-card .quote { display: block; width: 100%; margin-top: 6px; padding: 4px 8px; text-align: left; font: inherit; font-size: var(--text-note); color: var(--color-ink); background: var(--color-warning-tint); border: 0; border-left: 3px solid var(--color-warning-strong); border-radius: 0; cursor: pointer; }
    .flag-card[data-hard] .quote { background: var(--color-danger-tint); border-left-color: var(--color-danger); }
    .flag-card .ask { margin-top: 6px; font-size: var(--text-note); color: var(--color-ink); }
    .flag-card .error { margin-top: 6px; font-size: var(--text-note); color: var(--color-danger); }
    .flag-card .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .flag-card .actions button { font: inherit; font-size: var(--text-note); font-weight: 600; padding: 4px 10px; border-radius: var(--radius-control); border: 1px solid var(--color-border-subtle); background: var(--color-panel); color: var(--color-ink); cursor: pointer; }
    .flag-card .actions button[data-main] { background: var(--color-brand); border-color: var(--color-brand); color: var(--color-on-brand); }
    .flag-card .actions button:hover { background: var(--color-hover); }
    .flag-card .actions button[data-main]:hover { background: var(--color-brand-hover); }
    .flag-card .actions button:focus-visible, .flag-card .quote:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
    .flag-card .actions button:disabled { opacity: 0.6; cursor: default; }
  `;

  // The rows whose Keep is waiting for its one confirmation, and each row's last error: they outlive a redraw.
  const confirming = new Set();
  const errors = new Map();

  const send = (message) => chrome.runtime.sendMessage(message);

  /** Redraws one row's card in place, from the row's current state. */
  function redraw(card, key) {
    const field = window.WIA.status.summary().fields.find((r) => r.key === key);
    if (field?.flag) card.replaceWith(render(field));
    else card.remove();
  }

  function button(text, onClick, main = false) {
    const el = Object.assign(document.createElement("button"), { type: "button", textContent: text });
    if (main) el.dataset.main = "";
    el.addEventListener("click", onClick);
    return el;
  }

  /** Keep or Rewrite with Claude, through the background (POST .../review/keep|rewrite); an error stays on the card. */
  async function answer(card, field, action) {
    for (const b of card.querySelectorAll("button")) b.disabled = true;
    const reply = await send({ type: "batch/flag", action, name: field.key }).catch((error) => ({ ok: false, error: error.message }));
    confirming.delete(field.key);
    if (!reply?.ok) {
      errors.set(field.key, `WorkIt couldn't save that: ${reply?.error ?? "no answer"}`);
      return redraw(card, field.key);
    }
    errors.delete(field.key);
    if (action === "keep") window.WIA.status.flag(field.key, undefined);
    else window.WIA.writing?.rewrite(field.key);
  }

  /**
   * The card for a flagged row (`field`, a status row with `flag`):
   * reason, quoted sentence, and its three actions; while the answer is
   * with the student's Claude (`rewriting`), only says so.
   */
  function render(field) {
    const card = document.createElement("div");
    card.className = "flag-card";
    if (field.flagHard) card.dataset.hard = "";
    const reason = document.createElement("div");
    reason.className = "reason flag";
    reason.textContent = `Your Claude's check: ${field.flag} Read it before you submit, and edit it if it's wrong.`;
    card.append(reason);
    if (field.flagQuote) {
      const quote = button(`“${field.flagQuote}”`, () => window.WIA.walk?.show(field.key));
      quote.className = "quote";
      quote.title = "Show it in the form";
      card.append(quote);
    }
    if (field.rewriting) {
      card.append(Object.assign(document.createElement("div"), {
        className: "ask", textContent: "Sent back to your Claude. WorkIt fills in its new answer here.",
      }));
      return card;
    }
    if (errors.has(field.key)) card.append(Object.assign(document.createElement("div"), { className: "error", textContent: errors.get(field.key) }));
    const actions = document.createElement("div");
    actions.className = "actions";
    if (confirming.has(field.key)) {
      card.append(Object.assign(document.createElement("div"), {
        className: "ask",
        textContent: field.flagHard ? "It names another company. Keep it anyway? Your Claude won't flag it again." : "Keep it as it is? Your Claude won't flag it again.",
      }));
      actions.append(
        button("Yes, keep it", () => answer(card, field, "keep"), true),
        button("Cancel", () => {
          confirming.delete(field.key);
          redraw(card, field.key);
        }),
      );
    } else {
      actions.append(button("Keep", () => {
        confirming.add(field.key);
        redraw(card, field.key);
      }));
      // The student's own words are theirs to change: no Claude rewrites them.
      if (field.source !== "student") actions.append(button("Rewrite with Claude", () => answer(card, field, "rewrite"), true));
      actions.append(button("Edit myself", () => window.WIA.walk?.show(field.key)));
    }
    card.append(actions);
    return card;
  }

  /** Selects a flagged row's sentence in its field, when the field is a text box that shows it. */
  function select(control, field) {
    if (!field?.flag || !field.flagQuote || !(control instanceof HTMLTextAreaElement || control instanceof HTMLInputElement)) return;
    const at = control.value.indexOf(field.flagQuote);
    if (at >= 0) control.setSelectionRange(at, at + field.flagQuote.length);
  }

  window.WIA.flagCard = { STYLES, render, select };
})();

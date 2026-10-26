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
// A row card (row-card.js). Loaded after overlay.js
// (shared/content-scripts.js): overlay.js's row draws it, as
// window.WIA.flagCard.
window.WIA = window.WIA || {};

(function () {
  "use strict";

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
    const card = { className: "flag-card", tone: field.flagHard ? "danger" : "warning", data: field.flagHard ? { hard: "" } : {} };
    card.lines = [{ text: `Your Claude's check: ${field.flag} Read it before you submit, and edit it if it's wrong.`, kind: "warning" }];
    if (field.flagQuote) card.highlight = { text: `“${field.flagQuote}”`, title: "Show it in the form", onClick: () => window.WIA.walk?.show(field.key) };
    // What it asks or what went wrong, under the sentence.
    const { line } = window.WIA.rowCard;
    card.slot = [];
    if (field.rewriting) {
      card.slot.push(line({ text: "Sent back to your Claude. WorkIt fills in its new answer here.", kind: "ask" }));
      return window.WIA.rowCard.make(card);
    }
    if (errors.has(field.key)) card.slot.push(line({ text: errors.get(field.key), kind: "error" }));
    let el;
    if (confirming.has(field.key)) {
      card.slot.push(line({ text: field.flagHard ? "It names another company. Keep it anyway? Your Claude won't flag it again." : "Keep it as it is? Your Claude won't flag it again.", kind: "ask" }));
      card.buttons = [
        { label: "Yes, keep it", primary: true, onClick: () => answer(el, field, "keep") },
        {
          label: "Cancel",
          onClick: () => {
            confirming.delete(field.key);
            redraw(el, field.key);
          },
        },
      ];
    } else {
      card.buttons = [
        {
          label: "Keep",
          onClick: () => {
            confirming.add(field.key);
            redraw(el, field.key);
          },
        },
      ];
      // The student's own words are theirs to change: no Claude rewrites them.
      if (field.source !== "student") card.buttons.push({ label: "Rewrite with Claude", primary: true, onClick: () => answer(el, field, "rewrite") });
      card.buttons.push({ label: "Edit myself", onClick: () => window.WIA.walk?.show(field.key) });
    }
    el = window.WIA.rowCard.make(card);
    return el;
  }

  /** Selects a flagged row's sentence in its field, when the field is a text box that shows it. */
  function select(control, field) {
    if (!field?.flag || !field.flagQuote || !(control instanceof HTMLTextAreaElement || control instanceof HTMLInputElement)) return;
    const at = control.value.indexOf(field.flagQuote);
    if (at >= 0) control.setSelectionRange(at, at + field.flagQuote.length);
  }

  window.WIA.flagCard = { render, select };
})();

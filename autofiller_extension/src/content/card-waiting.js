// The waiting card (KAN-369): under a batch tab's row that waits for the
// student's Claude, everything they can do about it without leaving the
// form: how long it has waited, Write with Claude (overlay.js's), a box to
// paste an answer from anywhere, saved through the Written Answers page's
// route with the same checks as their Claude's (a refusal's reasons show in
// the card), and Write it myself, which takes them to the field (what they
// type there is their own answer, written-answers.js). Loaded after
// overlay.js (shared/content-scripts.js), as window.WIA.waitingCard; the
// overlay asks it for each waiting row's card, and the fill's written
// answers give it the save (onSave).
window.WIA = window.WIA || {};

(function () {
  "use strict";

  // How often the cards' "Waiting N min" moves on.
  const TICK = 30_000;
  const NOTHING = "Paste an answer first.";

  const css = `
    .waiting { margin-top: 6px; padding: 8px; border-radius: var(--radius-control); background: var(--color-advanced-tint); }
    .waiting .waited { font-size: var(--text-meta); font-weight: 600; color: var(--color-ink-meta); margin: 0 0 4px; }
    .waiting .start { margin-top: 0; }
    .waiting textarea {
      display: block; box-sizing: border-box; width: 100%; min-height: 56px; margin: 6px 0 4px; padding: 5px 6px; resize: vertical;
      font: inherit; font-size: var(--text-note); color: var(--color-ink); background: var(--color-panel);
      border: 1px solid var(--color-border-control); border-radius: var(--radius-control);
    }
    .waiting textarea:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }
    .waiting .actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .waiting button {
      all: unset; cursor: pointer; font-size: var(--text-note); font-weight: 500; padding: 4px 8px; border-radius: var(--radius-control);
    }
    .waiting button[data-save] { background: var(--color-brand); color: var(--color-on-brand); }
    .waiting button[data-save]:hover { background: var(--color-brand-hover); }
    .waiting button[data-save][aria-disabled="true"] { opacity: 0.6; cursor: default; }
    .waiting button[data-myself] { background: var(--color-panel); color: var(--color-ink); border: 1px solid var(--color-border-subtle); }
    .waiting button[data-myself]:hover { background: var(--color-hover); }
    .waiting button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
    .waiting [data-refused] { margin: 4px 0 0; font-size: var(--text-note); color: var(--color-danger); }
  `;

  // Each waiting row's card, by key, kept across the panel's renders so a draft and its focus survive them.
  const cards = new Map();
  // Saves a pasted answer: (key, text) => { saved: true } | { saved: false, reasons, error }. Set by the fill.
  let save = null;

  /** "Waiting under a minute", "Waiting 4 min", "Waiting 2 h". */
  function waitedFor(since) {
    const minutes = Math.floor((Date.now() - since) / 60_000);
    if (minutes < 1) return "Waiting under a minute";
    if (minutes < 60) return `Waiting ${minutes} min`;
    return `Waiting ${Math.floor(minutes / 60)} h`;
  }

  /**
   * The card under `field`'s row (one waiting for the student's Claude).
   * `startClaude`: makes the overlay's Write with Claude.
   */
  function card(field, startClaude) {
    const kept = cards.get(field.key);
    if (kept) {
      kept.tick();
      return kept.el;
    }
    const since = Date.now();
    const el = document.createElement("div");
    el.className = "waiting";
    const waited = Object.assign(document.createElement("p"), { className: "waited" });
    waited.dataset.waited = "";
    const box = Object.assign(document.createElement("textarea"), { placeholder: "Paste an answer from anywhere, or write one here." });
    box.setAttribute("aria-label", "Paste an answer");
    const saveButton = Object.assign(document.createElement("button"), { type: "button", textContent: "Save answer" });
    saveButton.dataset.save = "";
    const myself = Object.assign(document.createElement("button"), { type: "button", textContent: "Write it myself" });
    myself.dataset.myself = "";
    const actions = Object.assign(document.createElement("div"), { className: "actions" });
    actions.append(saveButton, myself);
    const refusals = document.createElement("div");
    el.append(waited, startClaude(), box, actions, refusals);

    const tick = () => (waited.textContent = waitedFor(since));
    tick();
    /** Shows why WorkIt didn't save the answer (none: clears it). */
    function refuse(reasons) {
      refusals.replaceChildren(
        ...reasons.map((reason) => {
          const p = Object.assign(document.createElement("p"), { textContent: reason });
          p.dataset.refused = "";
          return p;
        }),
      );
    }

    let saving = false;
    saveButton.addEventListener("click", async () => {
      if (saving) return;
      const text = box.value.trim();
      if (!text) return refuse([NOTHING]);
      saving = true;
      saveButton.setAttribute("aria-disabled", "true");
      saveButton.textContent = "Saving...";
      const result = save ? await save(field.key, text) : { saved: false, reasons: [], error: "WorkIt can't save an answer on this page." };
      saving = false;
      saveButton.removeAttribute("aria-disabled");
      saveButton.textContent = "Save answer";
      if (result.saved) {
        box.value = "";
        refuse([]);
        cards.delete(field.key);
      } else refuse(result.reasons?.length ? result.reasons : [result.error ?? "WorkIt didn't save it. Try again."]);
    });
    // The student's own typing in the form's field is their own answer (written-answers.js's edited).
    myself.addEventListener("click", () => window.WIA.walk?.show(field.key));

    cards.set(field.key, { el, tick });
    return el;
  }

  setInterval(() => cards.forEach((c) => c.tick()), TICK);

  window.WIA.waitingCard = {
    card,
    css,
    /** The fill's save for a pasted answer (written-answers.js), replacing any earlier fill's. */
    onSave(fn) {
      save = fn;
    },
  };
})();

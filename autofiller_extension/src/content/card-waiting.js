// The waiting card (KAN-369): under a batch tab's row that waits for the
// student's Claude, everything they can do about it without leaving the
// form: how long it has waited, Write with Claude (overlay.js's), a box to
// paste an answer from anywhere, saved through the Written Answers page's
// route with the same checks as their Claude's (a refusal's reasons show in
// the card), and Write it myself, which takes them to the field (what they
// type there is their own answer, written-answers.js). Loaded after
// overlay.js (shared/content-scripts.js), as window.WIA.waitingCard; the
// overlay asks it for each waiting row's card, and the fill's written
// answers give it the save (onSave). A row card (row-card.js).
window.WIA = window.WIA || {};

(function () {
  "use strict";

  // How often the cards' "Waiting N min" moves on.
  const TICK = 30_000;
  const NOTHING = "Paste an answer first.";

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
    const { line, make } = window.WIA.rowCard;
    const waited = line({ text: "", kind: "meta", data: { waited: "" } });
    const box = Object.assign(document.createElement("textarea"), { placeholder: "Paste an answer from anywhere, or write one here." });
    box.setAttribute("aria-label", "Paste an answer");
    const refusals = document.createElement("div");
    const el = make({
      className: "waiting",
      lines: [],
      slot: [waited, startClaude(), box],
      after: [refusals],
      buttons: [
        { label: "Save answer", primary: true, data: { save: "" }, onClick: () => saveAnswer() },
        // The student's own typing in the form's field is their own answer (written-answers.js's edited).
        { label: "Write it myself", onClick: () => window.WIA.walk?.show(field.key) },
      ],
    });
    const saveButton = el.querySelector("[data-save]");

    const tick = () => (waited.textContent = waitedFor(since));
    tick();
    /** Shows why WorkIt didn't save the answer (none: clears it). */
    function refuse(reasons) {
      refusals.replaceChildren(
        ...reasons.map((reason) => {
          const p = Object.assign(document.createElement("p"), { textContent: reason });
          p.className = "card-error";
          p.dataset.refused = "";
          return p;
        }),
      );
    }

    let saving = false;
    async function saveAnswer() {
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
    }

    cards.set(field.key, { el, tick });
    return el;
  }

  setInterval(() => cards.forEach((c) => c.tick()), TICK);

  window.WIA.waitingCard = {
    card,
    /** The fill's save for a pasted answer (written-answers.js), replacing any earlier fill's. */
    onSave(fn) {
      save = fn;
    },
  };
})();

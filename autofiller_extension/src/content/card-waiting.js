// The waiting card (KAN-369): under the opened row of a batch tab's
// "Waiting on Your Claude" box, a box to paste an answer from anywhere,
// saved through the Written Answers page's route with the same checks as
// their Claude's (a refusal's reasons show in the card). Pressing the row
// already took them to the field, where what they type is their own answer
// (written-answers.js); Write with Claude is the box's head, once
// (groups.js). Until KAN-424 every waiting row carried its own card, with
// a "Waiting N min" line, Write with Claude and Write it myself: five
// waiting rows were five paste boxes. Loaded after overlay.js
// (shared/content-scripts.js), as window.WIA.waitingCard; the overlay asks
// it for the opened waiting row's card, and the fill's written answers give
// it the save (onSave). A row card (row-card.js).
window.WIA = window.WIA || {};

(function () {
  "use strict";

  const NOTHING = "Paste an answer first.";

  // Each waiting row's card, by key, kept across the panel's renders so a draft and its focus survive them.
  const cards = new Map();
  // Saves a pasted answer: (key, text) => { saved: true } | { saved: false, reasons, error }. Set by the fill.
  let save = null;

  /** The card under `field`'s row (one waiting for the student's Claude). */
  function card(field) {
    const kept = cards.get(field.key);
    if (kept) return kept;
    const { make } = window.WIA.rowCard;
    const box = Object.assign(document.createElement("textarea"), { placeholder: "Paste an answer from anywhere, or write one here." });
    box.setAttribute("aria-label", "Paste an answer");
    const refusals = document.createElement("div");
    const el = make({
      className: "waiting",
      lines: [],
      slot: [box],
      after: [refusals],
      buttons: [{ label: "Save answer", primary: true, data: { save: "" }, onClick: () => saveAnswer() }],
    });
    const saveButton = el.querySelector("[data-save]");
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

    cards.set(field.key, el);
    return el;
  }

  window.WIA.waitingCard = {
    card,
    /** The fill's save for a pasted answer (written-answers.js), replacing any earlier fill's. */
    onSave(fn) {
      save = fn;
    },
  };
})();

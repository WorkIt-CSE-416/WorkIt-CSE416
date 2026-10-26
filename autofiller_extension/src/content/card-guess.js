// The Guessed card (KAN-369): a panel row WorkIt guessed (lib-status.js's
// source "guessed": a policy's answer, or one with no fact of the
// student's) gets Looks right. It makes the answer the student's (the row
// reads "You", and Next Thing That Needs You stops going to it) and, in a
// batch tab, saves it as their own answer to the question's wording
// ("batch/own-answer", PUT .../answers with own: true): the next form that
// asks it fills it as theirs, one about this company only on its forms
// (the backend's answer_bank). A guess the student changes on the form is
// theirs too; the row offers Save for next time, one click. When two or more
// consent boxes are guessed, the panel offers Looks right ×N for them at
// once; never for self-identification, legal or work-authorization
// questions, which the student confirms one at a time. The row's card is
// row-card.js's. Loaded after overlay.js (shared/content-scripts.js), as
// window.WIA.guessCard.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  const { status, overlay } = window.WIA;
  // The API's limits on a saved answer's field name and wording (written-answers.js's).
  const FIELD_NAME_MAX = 200;
  const LABEL_MAX = 2000;

  // A box asking the student to agree to, or acknowledge, something of the employer's.
  const CONSENT = /\b(?:i agree|agree to|consent|acknowledg|i understand|i have read|privacy (?:policy|notice|statement)|terms (?:and|&) conditions|personal (?:data|information))/i;
  // Never confirmed in a batch, even when worded as consent: self-identification, the law, the right to work.
  const ONE_AT_A_TIME = new RegExp(
    [
      "gender", "\\bsex\\b", "pronoun", "race", "ethnic", "hispanic", "latin", "veteran", "disabilit", "sexual orientation", "transgender", "self[- ]?identif",
      "authori[sz]", "sponsor", "visa", "citizen", "work permit", "right to work", "eligib", "immigration", "export", "itar", "clearance",
      "legal", "\\blaw", "arbitrat", "criminal", "convict", "background check", "drug", "certif", "attest", "signature", "\\bsign\\b",
      "true and (?:complete|accurate|correct)", "non-?compete", "waive",
    ].join("|"),
    "i",
  );

  // By key: confirmed with Looks right; changed by the student and offered to save; saved.
  const confirmed = new Map();
  const saved = new Map();
  const wasGuessed = new Set();
  // Only a batch tab's answers are saved: they need the tab's application (injectFill sets window.WIA.batch).
  const batch = () => Boolean(window.WIA.batch);

  status.subscribe((summary) => {
    for (const r of summary.fields) if (isGuess(r)) wasGuessed.add(r.key);
  });

  /** A filled answer WorkIt guessed that the student hasn't confirmed or changed. */
  function isGuess(r) {
    return !r.note && r.status === "filled" && r.source === "guessed";
  }

  /** A guess that is a consent box the panel may confirm with others at once. */
  function isConsent(r) {
    return isGuess(r) && CONSENT.test(r.label) && !ONE_AT_A_TIME.test(r.label);
  }

  /** The text a row's field shows, as a saved answer (a multi-select's picks joined as the engine reads them). */
  const shown = (r) => (Array.isArray(r.shows) ? r.shows.join("; ") : typeof r.shows === "string" ? r.shows : "").trim();

  /** Saves a row's answer as the student's own, in a batch tab. Answers whether it was saved. */
  async function save(r) {
    const answer = shown(r);
    if (!batch() || !answer) return false;
    const reply = await chrome.runtime
      .sendMessage({ type: "batch/own-answer", name: r.key.slice(0, FIELD_NAME_MAX), label: r.label.slice(0, LABEL_MAX), answer, own: true })
      .catch(() => null);
    return Boolean(reply?.ok);
  }

  /** Looks right: the guess is the student's answer now, and saved for next time. */
  async function confirm(r) {
    confirmed.set(r.key, "saving");
    status.setStatus(r.key, "filled", r.reason, r.shows, "student", r.link, r.claude);
    confirmed.set(r.key, (await save(r)) ? "saved" : "kept");
    overlay.refresh();
  }

  /** Save for next time, on a guess the student changed. */
  async function saveChange(r) {
    saved.set(r.key, "saving");
    overlay.refresh();
    saved.set(r.key, (await save(r)) ? "saved" : "failed");
    overlay.refresh();
  }

  /** A row card (row-card.js): its one sentence, and a button when there is something to press. */
  const card = (line, label, onClick) => ({ lines: [line], buttons: label ? [{ label, primary: true, onClick }] : [] });

  /** The card under a row: Looks right on a guess, what came of it, or the offer to save a change. */
  function row(r) {
    if (r.status !== "filled") return null; // a field emptied or failed since has another card
    const done = confirmed.get(r.key);
    if (done === "saved") return card("Looks right. We'll use this next time.");
    if (done === "kept") return card(batch() ? "Looks right. WorkIt couldn't save it for next time." : "Looks right.");
    if (done) return null;
    if (isGuess(r)) return card("WorkIt guessed this. Check it on the form.", "Looks right", () => confirm(r));
    if (!batch() || !wasGuessed.has(r.key) || r.source !== "student" || !shown(r)) return null;
    const kept = saved.get(r.key);
    if (kept === "saved") return card("Saved. We'll use this next time.");
    if (kept === "saving") return null;
    return card(kept === "failed" ? "WorkIt couldn't save it. Try again." : "You changed WorkIt's guess.", "Save for next time", () => saveChange(r));
  }

  /** The part above the list: Looks right ×N for the consent boxes guessed, when there are two or more. */
  function panel(summary) {
    const boxes = summary.fields.filter(isConsent);
    if (boxes.length < 2) return null;
    const el = window.WIA.rowCard.make(card(`WorkIt ticked ${boxes.length} consent boxes for you.`, `Looks right ×${boxes.length}`, () => boxes.forEach(confirm)));
    el.classList.add("guess-batch");
    return el;
  }

  window.WIA.rowCard.add(row);
  overlay.addPart({
    css: ".guess-batch { margin: 8px 12px; background: var(--color-warning-tint); }",
    panel,
  });

  window.WIA.guessCard = {
    /** Whether the student's edits of a row are read back: it was a guess (an optional one too). */
    watched: (key) => wasGuessed.has(key),
  };
})();

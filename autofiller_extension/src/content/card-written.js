// A written answer's row (KAN-424): the Answers tab's job, now in the
// Autofill list. The fill's written questions (`use`) are the rows the
// Written Answers box holds (groups.js); each filled one shows its answer's
// first lines under the question, and one their Claude wrote has Rewrite, a
// round icon that opens a small card: Shorter, More specific, More formal,
// or the student's own words, then Rewrite sends it back to their Claude
// (written-answers.js `redo`, POST .../review/redo with the steer). The
// answer it had is kept, and Undo rewrite puts it back, while the row waits
// for the new one and after it lands. Loaded after overlay.js
// (shared/content-scripts.js), whose row draws these parts, as
// window.WIA.writtenRow; injected again by every fill.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  const previous = window.WIA.writtenRow;
  const COVER_LETTER = /cover[\s_-]*letter/i;
  // Phosphor's ArrowsClockwise (regular): Rewrite.
  const REWRITE_ICON =
    '<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M224,48V96a8,8,0,0,1-8,8H168a8,8,0,0,1,0-16h28.69L182.06,73.37a79.56,79.56,0,0,0-56.13-23.43h-.45A79.52,79.52,0,0,0,69.59,72.71,8,8,0,0,1,58.41,61.27a96,96,0,0,1,135,.79L208,76.69V48a8,8,0,0,1,16,0ZM186.41,183.29a80,80,0,0,1-112.47-.66L59.31,168H88a8,8,0,0,0,0-16H40a8,8,0,0,0-8,8v48a8,8,0,0,0,16,0V179.31l14.63,14.63A95.43,95.43,0,0,0,130,222.06h.53a95.36,95.36,0,0,0,67.07-27.33,8,8,0,0,0-11.18-11.44Z"/></svg>';
  // The steers a press sends at once; the box takes the student's own.
  const STEERS = [
    ["Shorter", "Make it shorter."],
    ["More specific", "Make it more specific, with a concrete example from my experience."],
    ["More formal", "Make it more formal."],
  ];

  const css = `
    .row[data-written] .source { display: inline-flex; }
    .written-preview {
      margin: 4px 0 0; font-size: var(--text-note); line-height: var(--text-note--line-height); color: var(--color-ink-muted);
      white-space: pre-wrap; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden;
    }
    .written-actions { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
    .written-actions button {
      all: unset; cursor: pointer; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
      font-size: var(--text-note); font-weight: 500; color: var(--color-ink-muted); border-radius: var(--radius-control);
    }
    .written-actions button:hover { color: var(--color-ink); background: var(--color-hover); }
    .written-actions button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }
    .written-actions [data-rewrite] { width: 28px; height: 28px; border-radius: 9999px; }
    .written-actions [data-rewrite][aria-expanded="true"] { color: var(--color-brand-ink); background: var(--color-brand-tint); }
    .written-actions [data-rewrite] svg { width: 16px; height: 16px; fill: currentColor; }
    .written-actions [data-undo] { padding: 4px 6px; text-decoration: underline; }
    .written-error { margin: 4px 0 0; font-size: var(--text-note); color: var(--color-danger); }
    .row-card.steer .steers { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 6px; }
    .row-card.steer .steers button { font-weight: 500; border-radius: 9999px; }
    .row-card.steer input {
      display: block; box-sizing: border-box; width: 100%; margin: 0 0 2px; padding: 5px 8px; font: inherit; font-size: var(--text-note);
      color: var(--color-ink); background: var(--color-panel); border: 1px solid var(--color-border-control); border-radius: var(--radius-control);
    }
    .row-card.steer input:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }
  `;

  // The fill's written questions, by name.
  let names = previous?.names ?? new Set();
  // The rows whose Rewrite card is open, what each one's box holds, and each row's last error: they outlive a redraw.
  const steering = new Set();
  const drafts = new Map();
  const errors = new Map();
  let style = null;

  const refresh = () => window.WIA.overlay?.refresh?.();

  /**
   * The fill's written questions (content-script.js, once a page or a
   * Workday step is filled): the ones it wrote or waits to write, the ones
   * left for the student to write, the ones a saved answer filled in words,
   * and any cover letter field.
   */
  function use(prepared) {
    const inWords = (q) => q.kind === "text" || q.kind === "textarea";
    const questions = prepared.questions ?? [];
    names = new Set([
      ...(prepared.written ?? []).map((q) => q.name),
      ...(prepared.rows?.written ?? []).map((q) => q.name),
      ...(prepared.plan?.banked ?? []).filter(inWords).map((q) => q.name),
      ...questions.filter((q) => COVER_LETTER.test(q.label ?? "") || COVER_LETTER.test(q.name ?? "")).map((q) => q.name),
    ]);
    if (!style?.isConnected) style = window.WIA.panel?.addCss(css);
  }

  /** Sends the answer back with `steer` ("" for none); an error stays under the row. */
  async function rewrite(field, steer) {
    steering.delete(field.key);
    drafts.delete(field.key);
    errors.delete(field.key);
    const error = await window.WIA.writing?.redo(field.key, steer);
    if (error) errors.set(field.key, error);
    refresh();
  }

  async function undo(field) {
    errors.delete(field.key);
    const error = await window.WIA.writing?.undo(field.key);
    if (error) errors.set(field.key, error);
    refresh();
  }

  /** The Rewrite card: the quick steers, the student's own words, then Rewrite or Cancel. */
  function steerCard(field) {
    const steers = Object.assign(document.createElement("div"), { className: "steers" });
    for (const [label, steer] of STEERS) {
      const chip = Object.assign(document.createElement("button"), { type: "button", textContent: label });
      chip.addEventListener("click", window.WIA.ui.trusted(() => rewrite(field, steer)));
      steers.append(chip);
    }
    const box = Object.assign(document.createElement("input"), { type: "text", maxLength: 300, placeholder: "Or say what to change", value: drafts.get(field.key) ?? "" });
    box.setAttribute("aria-label", "What to change");
    box.addEventListener("input", () => drafts.set(field.key, box.value));
    box.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.isTrusted) rewrite(field, box.value.trim());
      if (event.key === "Escape") {
        steering.delete(field.key);
        refresh();
      }
    });
    return window.WIA.rowCard.make({
      className: "steer",
      lines: [{ text: "How should your Claude change it?", kind: "ask" }],
      slot: [steers, box],
      buttons: [
        { label: "Rewrite", primary: true, data: { send: "" }, onClick: () => rewrite(field, box.value.trim()) },
        {
          label: "Cancel",
          onClick: () => {
            steering.delete(field.key);
            refresh();
          },
        },
      ],
    });
  }

  /** What a written question's row adds under its question (overlay.js row), or none for any other row. */
  function parts(field, el) {
    if (!names.has(field.key)) return [];
    el.dataset.written = "";
    const writing = window.WIA.writing;
    const out = [];
    if (field.status === "filled" && typeof field.shows === "string" && field.shows.trim()) {
      out.push(Object.assign(document.createElement("p"), { className: "written-preview", textContent: field.shows.trim() }));
    }
    const actions = Object.assign(document.createElement("div"), { className: "written-actions" });
    if (writing?.canRewrite(field.key)) {
      const icon = Object.assign(document.createElement("button"), { type: "button", title: "Rewrite with your Claude" });
      icon.dataset.rewrite = "";
      icon.setAttribute("aria-label", "Rewrite");
      icon.setAttribute("aria-expanded", String(steering.has(field.key)));
      icon.innerHTML = REWRITE_ICON;
      icon.addEventListener("click", window.WIA.ui.trusted(() => {
        if (steering.has(field.key)) steering.delete(field.key);
        else steering.add(field.key);
        refresh();
      }));
      actions.append(icon);
    } else steering.delete(field.key);
    if (writing?.canUndo(field.key)) {
      const back = Object.assign(document.createElement("button"), { type: "button", textContent: "Undo rewrite", title: "Put the earlier answer back" });
      back.dataset.undo = "";
      back.addEventListener("click", window.WIA.ui.trusted(() => undo(field)));
      actions.append(back);
    }
    if (actions.childElementCount) out.push(actions);
    if (errors.has(field.key)) out.push(Object.assign(document.createElement("p"), { className: "written-error", textContent: errors.get(field.key) }));
    if (steering.has(field.key)) out.push(steerCard(field));
    return out;
  }

  window.WIA.writtenRow = {
    use,
    parts,
    /** Whether `key` is one of the fill's written questions: its row goes in the Written Answers box (groups.js). */
    has: (key) => names.has(key),
    get names() {
      return names;
    },
  };
})();

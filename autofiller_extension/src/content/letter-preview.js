// See cover letter (KAN-369): under a batch tab's panel row for a written
// answer WorkIt filled (a cover letter or an essay the student's Claude
// wrote), a "See cover letter" ("See answer") button opens the letter as the
// form has it, so the student can read it before they press Submit: a text
// box's own text, as the engine read it back (the student's edit shows), or
// for an upload the text WorkIt made the PDF of, with the file's name. It
// offers Copy, Edit myself (the box is focused; for a PDF it says how to
// replace the file) and, while the row is flagged, Rewrite with Claude (the
// flag card's route). It never holds or changes Submit. A row card
// (row-card.js); loaded after overlay.js (shared/content-scripts.js), whose
// row draws it, as window.WIA.letterPreview.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  const css = `
    .letter-preview .letter-text {
      max-height: 220px; overflow-y: auto; margin: 4px 0; padding: 6px 8px; white-space: pre-wrap; overflow-wrap: anywhere;
      font-size: var(--text-note); line-height: var(--text-note--line-height); color: var(--color-ink);
      background: var(--color-well); border-radius: var(--radius-control);
    }
    .letter-toggle {
      all: unset; cursor: pointer; display: inline-block; margin-top: 4px; font-size: var(--text-note); font-weight: 500; color: var(--color-brand-ink);
    }
    .letter-toggle:hover { text-decoration: underline; }
    .letter-toggle:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
  `;

  // The uploads WorkIt filled with a written answer, by field: the text it made the PDF of and the file's name.
  const uploads = new Map();
  // The written answers WorkIt filled (any kind), by field: only their rows have the button.
  const written = new Set();
  // Rows whose preview is open, the one just copied, the ones whose Edit myself said how to replace a file, and each row's last error: they outlive a redraw.
  const open = new Set();
  const told = new Set();
  const errors = new Map();
  let copied = null; // "<field>\n<text>": a changed letter is copied again

  /** WorkIt filled `name` with a written answer, `text`; `file`: the PDF's name, when the field took an upload. */
  function filled(name, text, file) {
    written.add(name);
    if (file) uploads.set(name, { text, file });
    else uploads.delete(name);
  }

  // The Answers tab (answers-tab.js) shows the same preview: both redraw.
  const redraw = () => {
    window.WIA.overlay?.refresh();
    window.WIA.answersTab?.refresh();
  };

  /** Copies `text`; a page whose clipboard is refused gets the older copy command. */
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const box = Object.assign(document.createElement("textarea"), { value: text });
      document.body.append(box);
      box.select();
      document.execCommand("copy");
      box.remove();
    }
  }

  /**
   * What the form has for a row now: `{ text, file }`, `file` for an upload
   * still showing WorkIt's PDF; `{ other }` when the upload shows another
   * file (the student's own); null when it shows nothing.
   */
  function onForm(field) {
    const upload = uploads.get(field.key);
    if (upload) return field.shows === upload.file ? upload : field.shows ? { other: String(field.shows) } : null;
    return typeof field.shows === "string" && field.shows.trim() ? { text: field.shows } : null;
  }

  /** Rewrite with Claude, as the flag card sends it (POST .../review/rewrite), then the row waits for the new answer. */
  async function rewrite(field) {
    const reply = await chrome.runtime.sendMessage({ type: "batch/flag", action: "rewrite", name: field.key }).catch((error) => ({ ok: false, error: error.message }));
    if (!reply?.ok) {
      errors.set(field.key, `WorkIt couldn't send it back: ${reply?.error ?? "no answer"}`);
      return redraw();
    }
    errors.delete(field.key);
    open.delete(field.key);
    window.WIA.writing?.rewrite(field.key);
  }

  /** The open preview's card. */
  function card(field, what, letter) {
    const { line } = window.WIA.rowCard;
    const lines = [];
    if (what.other) lines.push({ text: `The form now shows ${what.other}, not the ${letter} WorkIt attached.`, kind: "meta" });
    else if (what.file) lines.push({ text: `Attached as ${what.file}`, kind: "meta" });
    const slot = [];
    if (what.text) slot.push(Object.assign(document.createElement("div"), { className: "letter-text", textContent: what.text, tabIndex: 0 }));
    if (told.has(field.key)) slot.push(line({ text: `To change it, remove WorkIt's file on the form and attach your own. WorkIt leaves your file as it is.`, kind: "ask" }));
    if (errors.has(field.key)) slot.push(line({ text: errors.get(field.key), kind: "error" }));
    const buttons = [];
    if (what.text) {
      buttons.push({
        label: copied === `${field.key}\n${what.text}` ? "Copied" : "Copy",
        onClick: async () => {
          await copy(what.text);
          copied = `${field.key}\n${what.text}`;
          redraw();
        },
      });
      buttons.push({
        label: "Edit myself",
        onClick: () => {
          if (what.file) {
            told.add(field.key);
            redraw();
          }
          window.WIA.walk?.show(field.key);
        },
      });
    }
    // Only a flagged answer goes back to the student's Claude (review.py's rewrite), and never the student's own words.
    if (field.flag && field.source !== "student" && !field.rewriting) buttons.push({ label: "Rewrite with Claude", primary: true, onClick: () => rewrite(field) });
    return window.WIA.rowCard.make({ className: "letter-preview", lines, slot, buttons });
  }

  /**
   * The row's See cover letter button, and its preview while open; null for
   * a row that isn't a written answer WorkIt filled, or shows nothing now.
   * `any`: any filled row (the Answers tab's, whose rows are all written
   * questions, the student's own answers too).
   */
  function render(field, { any = false } = {}) {
    if ((!any && !written.has(field.key)) || field.status !== "filled") return null;
    const what = onForm(field);
    if (!what) return null;
    const letter = /cover/i.test(field.label) ? "cover letter" : "answer";
    const wrap = document.createElement("div");
    const toggle = Object.assign(document.createElement("button"), {
      type: "button",
      className: "letter-toggle",
      textContent: `${open.has(field.key) ? "Hide" : "See"} ${letter}`,
    });
    toggle.setAttribute("aria-expanded", String(open.has(field.key)));
    toggle.addEventListener("click", () => {
      if (open.has(field.key)) open.delete(field.key);
      else open.add(field.key);
      told.delete(field.key);
      redraw();
    });
    wrap.append(toggle);
    if (open.has(field.key)) wrap.append(card(field, what, letter));
    return wrap;
  }

  window.WIA.overlay?.addPart({ css });
  window.WIA.letterPreview = { filled, render };
})();

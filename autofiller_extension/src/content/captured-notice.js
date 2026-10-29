// The captured answers notice (KAN-369): the student's own words typed into
// a batch tab's written question are saved as they type (written-answers.js's
// keepOwn, KAN-379), with no question first. The panel then says so, in one
// part above its list: "Saved N new answers for later forms." with Review,
// which opens the webapp's Written Answers page (where each is marked New),
// and Undo, which takes every one of them back ("batch/own-answer-undo",
// DELETE .../answers?name=; the field keeps the student's words, and the
// question stays for their Claude). Once undone, a question's words are not
// saved again for the rest of the page's life: the student said no. Only the
// student's own words count, never their edit of an answer WorkIt filled.
// Profile facts (structured fields) are never saved without a click
// (card-guess.js's Save for next time). Loaded after overlay.js
// (shared/content-scripts.js), as window.WIA.capturedNotice.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  const { overlay } = window.WIA;
  // The API's limit on a saved answer's field name (written-answers.js's).
  const FIELD_NAME_MAX = 200;

  // The questions whose words were saved on this page, and those the student took back.
  const saved = new Set();
  const undone = new Set();
  // "", "undoing", "stuck" (a delete failed), or "undone".
  let state = "";

  /** Undo: deletes every answer the notice counts. A failed one stays counted, and the notice says so. */
  async function undo() {
    state = "undoing";
    overlay.refresh();
    const names = [...saved];
    const done = await Promise.all(
      names.map((name) => chrome.runtime.sendMessage({ type: "batch/own-answer-undo", name: name.slice(0, FIELD_NAME_MAX) }).then((r) => Boolean(r?.ok), () => false)),
    );
    names.forEach((name, n) => {
      if (!done[n]) return;
      saved.delete(name);
      undone.add(name);
    });
    state = saved.size ? "stuck" : "undone";
    overlay.refresh();
  }

  /** Review: the webapp's Written Answers page, in a new tab. */
  async function review() {
    const page = await chrome.runtime.sendMessage({ type: "batch/answers-page" }).catch(() => null);
    if (page?.ok) window.open(page.url, "_blank", "noopener");
  }

  /** The part above the panel's list, while anything was saved or taken back. */
  function panel() {
    if (state === "undone") {
      const el = window.WIA.rowCard.make({ lines: ["Not saved. Later forms won't fill it."] });
      el.classList.add("captured");
      return el;
    }
    if (!saved.size) return null;
    const n = saved.size;
    const lines = [`Saved ${n} new answer${n === 1 ? "" : "s"} for later forms.`];
    if (state === "stuck") lines.push({ text: "WorkIt couldn't undo it. Try again.", kind: "error" });
    const el = window.WIA.rowCard.make({
      lines,
      busy: state === "undoing",
      buttons: [
        { label: "Review", onClick: review },
        { label: "Undo", onClick: undo },
      ],
    });
    el.classList.add("captured");
    return el;
  }

  overlay.addPart({ css: ".captured { margin: 8px 12px; }", panel });

  window.WIA.capturedNotice = {
    /** The student's own words for question `name` were saved. */
    saved(name) {
      if (undone.has(name)) return;
      saved.add(name);
      state = "";
      overlay.refresh();
    },
    /** Whether the student took back question `name`'s words on this page: they are not saved again. */
    undone: (name) => undone.has(name),
  };
})();

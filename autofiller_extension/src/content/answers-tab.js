// The panel's Answers tab (KAN-400): this application's written questions,
// each with where its answer came from (Yours, Written by your Claude,
// Waiting for your Claude, Pasted, ...) and See answer, the preview of what
// the form holds (letter-preview.js). Write with Claude (overlay.js's) sits at
// the top only while an answer waits for the student's Claude. A form with no
// cover letter field says so, so the student isn't looking for a letter that
// won't be sent. The rows are lib-status.js's: this file only draws the
// written ones again, from the fill's questions (content-script.js `use`).
// Loaded after letter-preview.js (shared/content-scripts.js), as
// window.WIA.answersTab; injected again by every fill.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  // Injected again (Fill Again, a Workday step): the last fill's subscription goes.
  window.WIA.answersTab?.stop?.();

  const css = `
    .answers { padding: 4px 0; }
    .answers .start { padding: 8px 12px; margin: 0; border-bottom: 1px solid var(--color-border); }
    .answers .answers-empty { margin: 0; padding: 12px; font-size: var(--text-note); color: var(--color-ink-meta); }
    .answer { padding: 8px 12px; border-bottom: 1px solid var(--color-border); }
    .answer:last-child { border-bottom: 0; }
    .answer-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .answer-label {
      all: unset; flex: 1; min-width: 0; font-size: var(--text-note); font-weight: 500; color: var(--color-ink); overflow-wrap: anywhere;
    }
    button.answer-label { cursor: pointer; }
    button.answer-label:hover { text-decoration: underline; }
    button.answer-label:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; border-radius: var(--radius-control); }
    .answer-status {
      flex: none; font-size: var(--text-meta); font-weight: 600; padding: 1px 6px; border-radius: 9999px;
      background: var(--color-well); color: var(--color-ink-meta);
    }
    .answer-status[data-kind="waiting"] { background: var(--color-advanced-tint); color: var(--color-advanced); }
    .answer-status[data-kind="yours"] { background: var(--color-positive-tint); color: var(--color-positive-ink); }
    .answer-status[data-kind="needs"] { background: var(--color-danger-tint); color: var(--color-danger); }
    .answer-status[data-kind="none"] { background: transparent; padding: 0; font-weight: 500; }
  `;

  // Where a written answer came from, as the tab says it (lib-status.js's `source`).
  const BY_SOURCE = {
    student: ["Yours", "yours"],
    claude: ["Written by your Claude", "written"],
    pasted: ["Pasted", "written"],
    ai: ["Written with AI", "written"],
    saved: ["Saved Answer", "written"],
    guessed: ["Guessed", "written"],
  };
  const COVER_LETTER = /cover[\s_-]*letter/i;

  // The fill's written questions, by name, and whether the form has a cover letter field at all.
  let names = new Set();
  let coverLetter = true;
  let workday = false;
  let unsubscribe = null;
  let style = null;

  /** What the tab says of a written question's row: [text, kind]. */
  function statusOf(field) {
    if (field.status === "needs_generation") return field.claude ? ["Waiting for your Claude", "waiting"] : ["Not written yet", "needs"];
    if (field.status === "filled") return BY_SOURCE[field.source] ?? ["Filled", "written"];
    if (field.status === "failed") return ["Needs you", "needs"];
    if (field.status === "skipped") return ["Left empty", "none"];
    return ["Filling", "none"];
  }

  /** One question's row: its label (a press goes to its field), its status, and See answer. */
  function row(field) {
    const el = Object.assign(document.createElement("div"), { className: "answer" });
    el.dataset.answerKey = field.key; // not data-key: that names the Autofill tab's row, which rows, cards and Next Thing look up
    const head = Object.assign(document.createElement("div"), { className: "answer-head" });
    const label = Object.assign(document.createElement("button"), { type: "button", className: "answer-label", textContent: field.label });
    label.addEventListener("click", () => window.WIA.showField?.(field.key));
    const [text, kind] = statusOf(field);
    const badge = Object.assign(document.createElement("span"), { className: "answer-status", textContent: text });
    badge.dataset.kind = kind;
    head.append(label, badge);
    el.append(head);
    // See answer: what the form holds now (the engine's read-back), for any filled written answer.
    const preview = window.WIA.letterPreview?.render(field, { any: true });
    if (preview) el.append(preview);
    return el;
  }

  /** The "No cover letter field" row. */
  function noCoverLetter() {
    const el = Object.assign(document.createElement("div"), { className: "answer" });
    const head = Object.assign(document.createElement("div"), { className: "answer-head" });
    const badge = Object.assign(document.createElement("span"), {
      className: "answer-status",
      textContent: workday ? "No cover letter field on this step" : "No cover letter field",
    });
    badge.dataset.kind = "none";
    head.append(Object.assign(document.createElement("span"), { className: "answer-label", textContent: "Cover letter" }), badge);
    el.append(head);
    return el;
  }

  function render() {
    const tab = window.WIA.panel?.slot("tab:answers");
    if (!tab || !window.WIA.status) return;
    const fields = window.WIA.status.summary().fields.filter((f) => names.has(f.key));
    const card = Object.assign(document.createElement("div"), { className: "card answers" });
    // Write with Claude, only while an answer waits for the student's Claude.
    if (fields.some((f) => f.status === "needs_generation" && f.claude)) {
      const start = window.WIA.overlay?.startClaude?.();
      if (start) card.append(start);
    }
    if (!fields.length) card.append(Object.assign(document.createElement("p"), { className: "answers-empty", textContent: "This form has no written questions." }));
    card.append(...fields.map(row));
    if (!coverLetter) card.append(noCoverLetter());
    tab.replaceChildren(card);
  }

  /**
   * The fill's written questions (content-script.js, once a page or a
   * Workday step is filled): the ones it wrote or waits to write, the ones
   * left for the student to write, the ones a saved answer filled in words,
   * and any cover letter field. The tab follows their rows from then on.
   */
  function use(prepared) {
    const inWords = (q) => q.kind === "text" || q.kind === "textarea";
    const questions = prepared.questions ?? [];
    const cover = questions.filter((q) => COVER_LETTER.test(q.label ?? "") || COVER_LETTER.test(q.name ?? ""));
    names = new Set([
      ...(prepared.written ?? []).map((q) => q.name),
      ...(prepared.rows?.written ?? []).map((q) => q.name),
      ...(prepared.plan?.banked ?? []).filter(inWords).map((q) => q.name),
      ...cover.map((q) => q.name),
    ]);
    coverLetter = cover.length > 0;
    workday = Boolean(window.WIA.steps);
    // A form with nothing written and no cover letter field has no Answers tab (KAN-424): its strip shows Autofill and
    // Resume. On Workday each step decides again, as each fills.
    window.WIA.panel?.showTab?.("answers", names.size > 0);
    if (!style?.isConnected) style = window.WIA.panel?.addCss(css);
    unsubscribe?.();
    unsubscribe = window.WIA.status.subscribe(render);
    render();
  }

  function stop() {
    unsubscribe?.();
    unsubscribe = null;
  }

  window.WIA.answersTab = { use, refresh: render, stop };
})();

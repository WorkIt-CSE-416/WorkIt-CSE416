// The row card (KAN-369): a small card under one of the panel's rows that
// says what is wrong with it and offers up to three buttons, the shape every
// review state shares (a failed field, a guess, a flag, a row waiting for
// the student's Claude). The panel
// (overlay.js) asks `window.WIA.rowCard.for(field)` for each row; a feature
// adds its own with `add(fn)`, where `fn(field)` answers a card's parts or
// null. Loaded after tokens.js and before overlay.js
// (shared/content-scripts.js), whose shadow root takes `css`.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  const css = `
    .row-card {
      margin-top: 6px; padding: 8px 10px; border-radius: var(--radius-control);
      background: var(--color-panel); border: 1px solid var(--color-border-subtle);
      font-size: var(--text-note); line-height: var(--text-note--line-height); color: var(--color-ink);
    }
    .row-card .card-title { margin: 0 0 2px; font-weight: 600; }
    .row-card p { margin: 0 0 4px; color: var(--color-ink-muted); }
    .row-card q { display: block; margin: 0 0 4px; color: var(--color-danger); font-style: normal; }
    .row-card .card-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .row-card button {
      all: unset; cursor: pointer; font-size: var(--text-note); font-weight: 500; padding: 4px 8px; border-radius: var(--radius-control);
      background: var(--color-panel); color: var(--color-ink); border: 1px solid var(--color-border-subtle);
    }
    .row-card button[data-primary] { background: var(--color-brand); color: var(--color-on-brand); border-color: var(--color-brand); }
    .row-card button:hover { background: var(--color-hover); }
    .row-card button[data-primary]:hover { background: var(--color-brand-hover); }
    .row-card button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
    .row-card button[disabled], .row-card button[aria-disabled="true"] { cursor: default; opacity: 0.6; }
    .row-card[data-tone="warning"] { border-color: var(--color-warning-strong); }
    .row-card[data-tone="danger"] { border-color: var(--color-danger); }
    .row-card .card-meta { font-size: var(--text-meta); font-weight: 600; color: var(--color-ink-meta); }
    .row-card .card-warning { color: var(--color-warning); }
    .row-card[data-tone="danger"] .card-warning, .row-card .card-error { color: var(--color-danger); }
    .row-card .card-ask { color: var(--color-ink); }
    .row-card button.card-highlight {
      display: block; box-sizing: border-box; width: 100%; margin: 2px 0 4px; padding: 4px 8px; font-weight: 400; color: var(--color-ink);
      background: var(--color-warning-tint); border: 0; border-left: 3px solid var(--color-warning-strong); border-radius: 0;
    }
    .row-card[data-tone="danger"] button.card-highlight { background: var(--color-danger-tint); border-left-color: var(--color-danger); }
    .row-card textarea {
      display: block; box-sizing: border-box; width: 100%; min-height: 56px; margin: 6px 0 4px; padding: 5px 6px; resize: vertical;
      font: inherit; font-size: var(--text-note); color: var(--color-ink); background: var(--color-panel);
      border: 1px solid var(--color-border-control); border-radius: var(--radius-control);
    }
    .row-card textarea:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }
  `;

  /** @type {((field: object) => Card | null)[]} */
  const parts = [];

  /**
   * A sentence is its text, or { text, kind, data }: kind "meta" (small and
   * bold), "warning", "error" or "ask" (in ink); data goes on its dataset.
   * `tone` ("warning", "danger") colours the card's edge and its highlight;
   * `highlight` is the answer's own sentence, a button (it shows it in the
   * form); `slot` is elements the card holds under its sentences (a paste
   * box), `after` under its buttons; `className` and `data` go on the card,
   * as `data` on a button.
   * @typedef {string | { text: string, kind?: "meta" | "warning" | "error" | "ask", data?: Record<string, string> }} Line
   * @typedef {{ title?: string, lines: Line[], quote?: string, busy?: boolean,
   *   tone?: "warning" | "danger", highlight?: { text: string, title?: string, onClick: () => void },
   *   slot?: Node[], after?: Node[], className?: string, data?: Record<string, string>,
   *   buttons?: { label: string, primary?: boolean, data?: Record<string, string>, onClick: () => void }[] }} Card
   */

  /** A sentence's element. */
  function line(part) {
    const { text, kind, data } = typeof part === "string" ? { text: part } : part;
    const el = Object.assign(document.createElement("p"), { textContent: text });
    if (kind) el.className = `card-${kind}`;
    Object.assign(el.dataset, data);
    return el;
  }

  /**
   * The card's element: a title, its sentences, the site's own words quoted,
   * the answer's highlighted sentence, its slot, then its buttons (at most 3).
   */
  function make({ title, lines, quote, busy, tone, highlight, slot = [], after = [], className, data, buttons = [] }) {
    const card = document.createElement("div");
    card.className = className ? `row-card ${className}` : "row-card";
    if (tone) card.dataset.tone = tone;
    Object.assign(card.dataset, data);
    if (title) card.append(Object.assign(document.createElement("div"), { className: "card-title", textContent: title }));
    for (const part of lines) card.append(line(part));
    if (quote) card.append(Object.assign(document.createElement("q"), { textContent: quote }));
    if (highlight) {
      const el = Object.assign(document.createElement("button"), { type: "button", className: "card-highlight", textContent: highlight.text, title: highlight.title ?? "", disabled: Boolean(busy) });
      el.addEventListener("click", window.WIA.ui.trusted(highlight.onClick));
      card.append(el);
    }
    card.append(...slot);
    if (buttons.length) {
      const actions = Object.assign(document.createElement("div"), { className: "card-actions" });
      for (const { label, primary, data: own, onClick } of buttons.slice(0, 3)) {
        const button = Object.assign(document.createElement("button"), { type: "button", textContent: label, disabled: Boolean(busy) });
        if (primary) button.dataset.primary = "";
        Object.assign(button.dataset, own);
        button.addEventListener("click", window.WIA.ui.trusted(onClick));
        actions.append(button);
      }
      card.append(actions);
    }
    card.append(...after);
    return card;
  }

  /** The first card a feature gives this row, as an element, or null. */
  function forRow(field) {
    for (const part of parts) {
      const card = part(field);
      if (card) return make(card);
    }
    return null;
  }

  window.WIA.rowCard = { css, make, line, add: (fn) => parts.push(fn), for: forRow };
})();

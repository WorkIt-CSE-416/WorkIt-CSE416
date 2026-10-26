// The row card (KAN-369): a small card under one of the panel's rows that
// says what is wrong with it and offers up to three buttons, the shape every
// review state shares (a failed field, a guess, a flag). The panel
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
    .row-card button[disabled] { cursor: default; opacity: 0.6; }
  `;

  /** @type {((field: object) => Card | null)[]} */
  const parts = [];

  /**
   * @typedef {{ title?: string, lines: string[], quote?: string, busy?: boolean,
   *   buttons?: { label: string, primary?: boolean, onClick: () => void }[] }} Card
   */

  /** The card's element: a title, its sentences, the site's own words quoted, then its buttons (at most 3). */
  function make({ title, lines, quote, busy, buttons = [] }) {
    const card = document.createElement("div");
    card.className = "row-card";
    if (title) card.append(Object.assign(document.createElement("div"), { className: "card-title", textContent: title }));
    for (const line of lines) card.append(Object.assign(document.createElement("p"), { textContent: line }));
    if (quote) card.append(Object.assign(document.createElement("q"), { textContent: quote }));
    if (buttons.length) {
      const actions = Object.assign(document.createElement("div"), { className: "card-actions" });
      for (const { label, primary, onClick } of buttons.slice(0, 3)) {
        const button = Object.assign(document.createElement("button"), { type: "button", textContent: label, disabled: Boolean(busy) });
        if (primary) button.dataset.primary = "";
        button.addEventListener("click", onClick);
        actions.append(button);
      }
      card.append(actions);
    }
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

  window.WIA.rowCard = { css, make, add: (fn) => parts.push(fn), for: forRow };
})();

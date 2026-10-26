// The Autofill tab's groups (KAN-397): the panel's rows by what they ask
// of the student, not in form order. Needs you (a failed field, a required
// one with no answer, a flag from the student's Claude's check, a human
// check or another "todo" note), Check these (guesses), Waiting for your
// Claude, then Filled, collapsed to "12 filled" until pressed. Each group
// shows its count; an empty group is left out. A row keeps everything
// overlay.js draws in it (its cards, its click to the field), and a filled
// row with something still to say (a card such as Saved for next time with
// Undo, a note, See cover letter) or the row Next Thing last went to stays
// in sight while its group is collapsed. Loaded before overlay.js
// (shared/content-scripts.js), as window.WIA.groups.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  if (window.WIA.groups) return;

  // In the order they show. `collapsed`: drawn as "N filled" until the student opens it.
  const GROUPS = [
    { id: "needs-you", name: "Needs you" },
    { id: "check", name: "Check these" },
    { id: "waiting", name: "Waiting for your Claude" },
    { id: "filling", name: "Filling" },
    { id: "filled", collapsed: (n) => `${n} filled` },
    { id: "optional", collapsed: (n) => `${n} optional left empty` },
  ];

  // The collapsed groups the student opened, for the page's life (every render draws the list anew).
  const opened = new Set();

  /** A row's group, or null for news that asks nothing of the student (a "done" note), shown above the groups. */
  function groupOf(field) {
    if (field.note) return field.note === "done" ? null : "needs-you";
    if (field.flag || field.status === "failed") return "needs-you";
    if (field.status === "needs_generation") return field.claude ? "waiting" : "needs-you";
    if (field.status === "filled") return field.source === "guessed" ? "check" : "filled";
    if (field.status === "pending") return "filling";
    return field.required ? "needs-you" : "optional";
  }

  /** A row with more than its label and source badge: a card, a reason, a preview. */
  const hasMore = (el) => el.dataset.current !== undefined || Boolean(el.querySelector(".text > :not(.label):not(.source)"));

  /**
   * The list's nodes: `fields` (lib-status.js's rows) drawn with `row`
   * (overlay.js's), in their groups.
   */
  function render(fields, row) {
    const news = [];
    const byGroup = new Map(GROUPS.map((g) => [g.id, []]));
    for (const field of fields) {
      const id = groupOf(field);
      (id ? byGroup.get(id) : news).push(row(field));
    }
    const nodes = [...news];
    for (const group of GROUPS) {
      const rows = byGroup.get(group.id);
      if (!rows.length) continue;
      const el = Object.assign(document.createElement("section"), { className: "group" });
      el.dataset.group = group.id;
      let head;
      if (group.collapsed) {
        const open = opened.has(group.id);
        head = Object.assign(document.createElement("button"), { type: "button", textContent: group.collapsed(rows.length) });
        head.setAttribute("aria-expanded", String(open));
        head.addEventListener("click", () => {
          if (opened.has(group.id)) opened.delete(group.id);
          else opened.add(group.id);
          window.WIA.overlay?.refresh?.();
        });
        if (!open) for (const r of rows) r.hidden = !hasMore(r);
      } else {
        head = document.createElement("h3");
        const count = Object.assign(document.createElement("span"), { className: "count", textContent: String(rows.length) });
        head.append(`${group.name} `, count);
      }
      head.classList.add("group-head");
      el.append(head, ...rows);
      nodes.push(el);
    }
    return nodes;
  }

  const css = `
    .group + .group { border-top: 1px solid var(--color-border); }
    .group-head {
      display: flex; align-items: center; gap: 6px; margin: 0; padding: 8px 12px 4px;
      font-size: var(--text-meta); font-weight: 600; color: var(--color-ink-meta);
    }
    .group-head .count {
      font-size: var(--text-meta); padding: 0 6px; border-radius: 9999px;
      background: var(--color-well); color: var(--color-ink-meta);
    }
    .group[data-group="needs-you"] .group-head .count { background: var(--color-danger-tint); color: var(--color-danger); }
    .group[data-group="check"] .group-head .count { background: var(--color-warning-tint); color: var(--color-warning); }
    button.group-head { all: unset; box-sizing: border-box; width: 100%; cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 8px 12px; font-size: var(--text-note); font-weight: 500; color: var(--color-ink-muted); }
    button.group-head:hover { background: var(--color-hover); }
    button.group-head:focus-visible { outline: 2px solid var(--color-brand); outline-offset: -2px; }
    button.group-head::after {
      content: ""; margin-left: auto; width: 6px; height: 6px;
      border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg);
    }
    button.group-head[aria-expanded="true"]::after { transform: rotate(-135deg); }
    .group .row[hidden] { display: none; }
  `;

  window.WIA.groups = { render, css, groupOf };
})();

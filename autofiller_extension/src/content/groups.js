// The Autofill tab's checklist (KAN-369 Q1-Q3): every field the fill
// touches, listed from the moment the fill starts (overlay.js's live list),
// in two sections, Required then Optional. Each row has a mark (markOf):
// a spinner while it waits to be filled, then a green check (filled), an
// amber ? (a guess or an answer to check, lib-status.js's toCheck), a red !
// (lib-status.js's one rule, status.needsYou), blue (waiting on the
// student's Claude) or gray (left empty). Rows follow the page's order (its
// fields' places, window.WIA.fieldOf); after the fill, red and then amber
// rows rise to the top of their section. A repeated section (Work
// Experience, Education: any "<Section> <n> / <part>" fields, entryOf) is
// one row with a block under it per entry, titled by the entry's company or
// school (what the form shows, else what the Plan fills it with: the
// profile entry's), listing its fields with small dots. Notes (content-script.js's) stand above the sections.
// Required questions the form isn't asking now (hidden, not drawn yet)
// close the Required section, collapsed. A row keeps everything overlay.js
// draws in it (its cards, its click to the field). Loaded before overlay.js
// (shared/content-scripts.js), as window.WIA.groups.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  if (window.WIA.groups) return;

  // "Work Experience 2 / Company": a field of one entry (Workday's panels; Greenhouse's Employment block, which the engine labels the same way).
  const ENTRY = /^(.+?) (\d+) \/ (.+)$/;
  // "Work Experience (entries)": Workday's question for how many entries a section has, the section's own row.
  const SECTION = /^(.+) \(entries\)$/;
  // Greenhouse's Education block names its parts "<part>--<n>" (fill-engine greenhouse.ts EDUCATION) and labels them bare ("School").
  const SCHOOL_PART = /^(?:school|degree|discipline|start-month|start-year|end-month|end-year)--(\d+)$/;
  // The part of an entry that names it: its block's title.
  const NAMES_IT = /company|employer|organi[sz]ation|school|university|institution/i;

  // The collapsed line of required questions the form isn't asking now, opened by the student for the page's life.
  let notAskedOpen = false;
  // What the Plan fills each entry's naming field with (its profile entry's company or school), by row key.
  const plannedNames = new Map();

  /**
   * The fill tells what the Plan fills a field with (content-script.js); only
   * an entry's naming field (Company, School) is kept, as its block's title
   * until the form shows it. Nothing else of the Plan is kept.
   */
  function planned(key, label, answer) {
    const entry = entryOf({ key, label });
    if (!entry || entry.head || !NAMES_IT.test(entry.part)) return;
    const name = Array.isArray(answer) ? answer[0] : answer;
    if (typeof name === "string" && name.trim()) plannedNames.set(key, name.trim());
  }

  /**
   * `items` in the page's order: each by the place of its first field the
   * page shows (`keysOf(item)`); those it doesn't show after, as they came.
   */
  function inPageOrder(items, keysOf) {
    const fieldOf = window.WIA.fieldOf;
    if (!fieldOf) return items;
    const at = (item) => {
      for (const key of keysOf(item)) {
        let el = null;
        try {
          el = fieldOf(key);
        } catch {}
        if (el) return el;
      }
      return null;
    };
    const placed = [];
    const rest = [];
    for (const item of items) {
      const el = at(item);
      (el ? placed : rest).push({ item, el });
    }
    placed.sort((a, b) => (a.el === b.el ? 0 : a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    return [...placed, ...rest].map((p) => p.item);
  }

  /**
   * A row's mark: "needs-you" (red), "check" (amber), "waiting" (on the
   * student's Claude), "filling" (spinner), "filled" (green), "not-asked" (a
   * required question the form isn't asking now) or "empty" (gray). A note's
   * is "needs-you" when it asks something of the student, else "note".
   */
  function markOf(field) {
    const { status } = window.WIA;
    if (field.note) return status.needsYou(field) ? "needs-you" : "note";
    if (status.needsYou(field)) return "needs-you";
    if (status.toCheck(field)) return "check";
    if (field.status === "needs_generation" && field.claude) return "waiting";
    if (field.status === "pending" && window.WIA.phase === "filling") return "filling";
    if (field.status === "filled") return "filled";
    return field.required ? "not-asked" : "empty";
  }

  /** Which entry of a repeated section a field is in: `{ section, n, part }`, `{ section, head: true }` for the section's own row, or null. */
  function entryOf(field) {
    if (field.note) return null;
    const head = SECTION.exec(field.label ?? "");
    if (head) return { section: head[1], head: true };
    const entry = ENTRY.exec(field.label ?? "");
    if (entry) return { section: entry[1], n: Number(entry[2]), part: entry[3] };
    const school = SCHOOL_PART.exec(field.key);
    if (school) return { section: "Education", n: Number(school[1]) + 1, part: field.label };
    return null;
  }

  // Red first, then amber, then the rest (after the fill only).
  const TIER = { "needs-you": 0, check: 1 };
  const tierOf = (marks) => Math.min(...marks.map((m) => TIER[m] ?? 2));
  // The worst of an entry block's marks shows on its section's row.
  const WORST = ["needs-you", "check", "waiting", "filling", "not-asked", "empty", "filled"];
  const worst = (marks) => WORST.find((m) => marks.includes(m)) ?? "empty";

  /** What the entry's block is titled: its company or school as the form shows it, else as the Plan fills it, else "Work Experience 1". */
  function titleOf(section, n, fields) {
    const naming = fields.find((f) => NAMES_IT.test(entryOf(f).part) && f.shows && f.shows.length);
    const shown = naming && (Array.isArray(naming.shows) ? naming.shows[0] : naming.shows);
    const plan = fields.map((f) => plannedNames.get(f.key)).find(Boolean);
    return shown || plan || `${section} ${n}`;
  }

  /** A repeated section's node: its own row (or one made for it), then a block per entry. */
  function section(name, head, fields, row) {
    const marks = [...(head ? [markOf(head)] : []), ...fields.map(markOf)];
    const el = Object.assign(document.createElement("div"), { className: "entries" });
    el.dataset.entries = name;
    const top = head
      ? row(head)
      : Object.assign(document.createElement("div"), { className: "row", innerHTML: '<span class="dot"></span><div class="text"><div class="label"></div></div>' });
    top.classList.add("entries-head");
    top.dataset.mark = worst(marks);
    top.querySelector(".label").textContent = name;
    el.append(top);
    const byEntry = new Map();
    for (const f of fields) {
      const { n } = entryOf(f);
      if (!byEntry.has(n)) byEntry.set(n, []);
      byEntry.get(n).push(f);
    }
    for (const [n, members] of [...byEntry].sort(([a], [b]) => a - b)) {
      const block = Object.assign(document.createElement("div"), { className: "entry" });
      block.append(Object.assign(document.createElement("div"), { className: "entry-title", textContent: titleOf(name, n, members) }));
      for (const f of inPageOrder(members, (m) => [m.key])) {
        const r = row(f);
        r.classList.add("sub");
        r.dataset.mark = markOf(f);
        r.querySelector(".label").textContent = entryOf(f).part + (f.required ? "" : " (optional)");
        block.append(r);
      }
      el.append(block);
    }
    return { node: el, marks, required: [head, ...fields].some((f) => f?.required) };
  }

  /**
   * The list's nodes: `fields` (lib-status.js's rows) drawn with `row`
   * (overlay.js's): notes, then Required, then Optional.
   */
  function render(fields, row) {
    const notes = [];
    // Each item: a field, or a repeated section (placed where its first field is); put in the page's order below.
    let items = [];
    const sections = new Map();
    for (const field of fields) {
      if (field.note) {
        const r = row(field);
        r.dataset.mark = markOf(field);
        notes.push(r);
        continue;
      }
      const entry = entryOf(field);
      if (!entry) {
        items.push({ field });
        continue;
      }
      if (!sections.has(entry.section)) {
        const item = { section: entry.section, head: null, fields: [] };
        sections.set(entry.section, item);
        items.push(item);
      }
      const item = sections.get(entry.section);
      if (entry.head) item.head = field;
      else item.fields.push(field);
    }
    items = inPageOrder(items, (item) => (item.field ? [item.field.key] : [...(item.head ? [item.head.key] : []), ...item.fields.map((f) => f.key)]));
    const required = [];
    const optional = [];
    const notAsked = [];
    for (const item of items) {
      const field = item.field ?? (item.fields.length ? null : item.head);
      if (field) {
        // A field's row (a section's own row with no entry fields yet is one too).
        const mark = markOf(field);
        const node = row(field);
        node.dataset.mark = mark;
        if (mark === "not-asked") notAsked.push(node);
        else (field.required ? required : optional).push({ node, tier: tierOf([mark]) });
      } else {
        const { node, marks, required: isRequired } = section(item.section, item.head, item.fields, row);
        (isRequired ? required : optional).push({ node, tier: tierOf(marks) });
      }
    }
    const settled = window.WIA.phase !== "filling";
    const nodes = [...notes];
    for (const [name, list, rest] of [["Required", required, notAsked], ["Optional", optional, []]]) {
      if (!list.length && !rest.length) continue;
      // Sorted stably: the page's order within each tier.
      const ordered = settled ? [...list].sort((a, b) => a.tier - b.tier) : list;
      const el = Object.assign(document.createElement("section"), { className: "section" });
      el.dataset.section = name.toLowerCase();
      el.append(Object.assign(document.createElement("h3"), { className: "section-head", textContent: name }), ...ordered.map((i) => i.node));
      if (rest.length) el.append(notAskedGroup(rest));
      nodes.push(el);
    }
    return nodes;
  }

  /** "N the form isn't asking now", collapsed: the student can open it, but nothing in it is theirs to do yet. */
  function notAskedGroup(rows) {
    const el = Object.assign(document.createElement("div"), { className: "group" });
    el.dataset.group = "not-asked";
    const head = Object.assign(document.createElement("button"), { type: "button", className: "group-head", textContent: `${rows.length} the form isn't asking now` });
    head.setAttribute("aria-expanded", String(notAskedOpen));
    head.addEventListener("click", () => {
      notAskedOpen = !notAskedOpen;
      window.WIA.overlay?.refresh?.();
    });
    for (const r of rows) r.hidden = !notAskedOpen;
    el.append(head, ...rows);
    return el;
  }

  const css = `
    .section + .section { border-top: 1px solid var(--color-border); }
    .section-head { margin: 0; padding: 8px 12px 4px; font-size: var(--text-meta); font-weight: 600; color: var(--color-ink-meta); }
    /* The marks (markOf): a 14 px badge on a row, a small dot on an entry's field. */
    .row .dot {
      width: 14px; height: 14px; margin-top: 2px; box-sizing: border-box; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 700; line-height: 1; color: var(--color-on-brand); background: var(--color-ink-subtle);
    }
    .row[data-mark="filled"] .dot { background: var(--color-positive); }
    .row[data-mark="filled"] .dot::before { content: "✓"; }
    .row[data-mark="check"] .dot { background: var(--color-warning); }
    .row[data-mark="check"] .dot::before { content: "?"; }
    .row[data-mark="needs-you"] .dot { background: var(--color-danger); }
    .row[data-mark="needs-you"] .dot::before { content: "!"; }
    .row[data-mark="waiting"] .dot { background: var(--color-advanced); }
    .row[data-mark="empty"] .dot, .row[data-mark="not-asked"] .dot, .row[data-mark="note"] .dot { background: var(--color-panel); border: 1.5px solid var(--color-ink-subtle); }
    .row[data-mark="filling"] .dot {
      background: none; border: 2px solid var(--color-border); border-top-color: var(--color-ink-subtle);
      animation: workit-spin 800ms linear infinite;
    }
    @keyframes workit-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .row[data-mark="filling"] .dot { animation: none; } }
    .entries .entry { margin: 0 12px 4px 34px; padding: 2px 0 4px 10px; border-left: 2px solid var(--color-border); }
    .entry-title { padding: 4px 0 2px; font-size: var(--text-note); font-weight: 600; color: var(--color-ink); }
    .row.sub { padding: 2px 0; font-size: var(--text-note); }
    .row.sub .label { font-weight: 400; color: var(--color-ink-muted); }
    .row.sub .dot { width: 7px; height: 7px; margin-top: 6px; border-width: 1px; }
    .row.sub .dot::before { content: none !important; }
    .group { border-top: 1px solid var(--color-border); }
    button.group-head { all: unset; box-sizing: border-box; width: 100%; cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 8px 12px; font-size: var(--text-note); font-weight: 500; color: var(--color-ink-muted); }
    button.group-head:hover { background: var(--color-hover); }
    button.group-head:focus-visible { outline: 2px solid var(--color-brand); outline-offset: -2px; }
    button.group-head::after {
      content: ""; margin-left: auto; width: 6px; height: 6px;
      border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg);
    }
    button.group-head[aria-expanded="true"]::after { transform: rotate(-135deg); }
    .row[hidden] { display: none; }
    .group[data-group="not-asked"] .row .reason { color: var(--color-ink-meta); }
  `;

  window.WIA.groups = { render, css, markOf, entryOf, planned };
})();

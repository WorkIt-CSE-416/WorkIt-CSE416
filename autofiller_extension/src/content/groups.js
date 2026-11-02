// The Autofill tab's checklist (KAN-369 Q1-Q3, KAN-424): every field the
// fill touches, listed from the moment the fill starts (overlay.js's live
// list). While it fills, two sections, Required then Optional, in the
// page's order (its fields' places, window.WIA.fieldOf), so each mark turns
// as its field fills. Once the fill is done the list reads by what the
// student must do (settledNodes): a red box of what needs their answer, an
// amber box of guesses to check, what waits on their Claude, then filled
// fields, optional ones left empty and questions the form isn't asking now,
// each folded into one line. Each row has a mark (markOf), the webapp's
// Phosphor glyph: a spinner while it waits to be filled, then a green check
// (filled), an amber question mark (a guess or an answer to check,
// lib-status.js's toCheck), a red warning (lib-status.js's one rule,
// status.needsYou), a blue clock (waiting on the student's Claude) or a gray
// circle (left empty). A repeated section (Work Experience, Education: any
// "<Section> <n> / <part>" fields, entryOf) is one row with a block under
// it per entry, titled by the entry's company or school (what the form
// shows, else what the Plan fills it with: the profile entry's), listing
// its fields with the same marks, smaller. Notes (content-script.js's)
// stand above everything. A row keeps everything overlay.js draws in it
// (its cards, its click to the field). Loaded before overlay.js
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

  // The collapsed groups (filled, optional left empty, the form isn't asking now), each opened by the student for the page's life.
  const opened = new Set();
  // The boxes (red, amber, blue) the student folded: open by default, since they hold what is theirs to do.
  const folded = new Set();
  // A red row's reason when WorkIt simply had no answer (content-script.js): its box's title says it once instead.
  const NO_ANSWER = "WorkIt has no answer for this. Answer it yourself.";
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
    if (field.status === "needs_writing" && field.claude) return "waiting";
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
    if (settled) return [...notes, ...settledNodes(fields, [...required, ...optional], notAsked)];
    const nodes = [...notes];
    for (const [name, list, rest] of [["Required", required, notAsked], ["Optional", optional, []]]) {
      if (!list.length && !rest.length) continue;
      const el = Object.assign(document.createElement("section"), { className: "section" });
      el.dataset.section = name.toLowerCase();
      el.append(Object.assign(document.createElement("h3"), { className: "section-head", textContent: name }), ...list.map((i) => i.node));
      if (rest.length) el.append(group("not-asked", `${rest.length} Not Asked Right Now`, rest));
      nodes.push(el);
    }
    return nodes;
  }

  /**
   * Once the fill is done (KAN-424), the list reads by what the student must
   * do, most urgent first: a red box of what needs their answer, an amber
   * box of guesses to check, what waits on their Claude, the written answers
   * filled (to read before Submit), then everything
   * settled folded into one line each: filled, optional left empty, and the
   * questions the form isn't asking now. Each box and line counts with
   * lib-status.js's rules, so they agree with the button.
   */
  function settledNodes(fields, items, notAsked) {
    const { status } = window.WIA;
    const marks = (i) => (i.node.dataset.entries ? [i.node.querySelector(".entries-head").dataset.mark] : [i.node.dataset.mark]);
    const by = (mark) => items.filter((i) => marks(i).includes(mark)).map((i) => i.node);
    const fieldsOnly = fields.filter((f) => !f.note);
    const nodes = [];
    const needs = by("needs-you");
    if (needs.length) {
      for (const reason of needs.flatMap((n) => [...n.querySelectorAll(".reason")])) {
        if (reason.textContent !== NO_ANSWER) continue;
        // The row still says it, for whatever reads the list (a test answering what WorkIt left).
        reason.closest(".row").dataset.noAnswer = "";
        reason.remove();
      }
      const n = status.needsYouCount();
      nodes.push(box("needs-you", `${n} ${n === 1 ? "Needs" : "Need"} Your Answer`, needs));
    }
    // A written question's filled answer goes in the Written Answers box below, even one just in that the student
    // hasn't seen (lib-status.js toCheck): it keeps its ? mark there, and the amber box holds only guesses.
    const isWritten = (node) => Boolean(window.WIA.writtenRow?.has(node.dataset.key));
    const check = by("check").filter((node) => !isWritten(node));
    if (check.length) {
      const n = fieldsOnly.filter((f) => !status.needsYou(f) && status.toCheck(f) && !window.WIA.writtenRow?.has(f.key)).length;
      nodes.push(box("check", `${n} ${n === 1 ? "Guess" : "Guesses"} to Check`, check));
    }
    const waiting = by("waiting");
    if (waiting.length) {
      const n = fieldsOnly.filter((f) => markOf(f) === "waiting").length;
      const head = box("waiting", `${n} Waiting on Your Claude`, waiting);
      const note = waitingNote(fields);
      note.hidden = folded.has("waiting");
      head.querySelector(".box-head").after(note);
      nodes.push(head);
    }
    // Anything else still open (a row filling again) stays in plain view, and so does a filled row the student is
    // working with (the one they pressed, or a guess Looks right made theirs, whose card keeps its Undo in sight),
    // or one with See cover letter outside the written questions.
    // The written answers now filled (card-written.js, KAN-424): a box of their own, open, each with its answer's
    // first lines, since a recruiter reads them and the student should before Submit. It took the Answers tab's place.
    const written = items.filter((i) => isWritten(i.node) && ["filled", "check"].includes(i.node.dataset.mark)).map((i) => i.node);
    if (written.length) nodes.push(box("written", `${written.length} Written ${written.length === 1 ? "Answer" : "Answers"}`, written));
    nodes.push(...by("filling"));
    const inUse = (node) => node.matches("[data-current], [data-open]") || Boolean(node.querySelector(".row-card, .letter-toggle"));
    const plain = by("filled").filter((node) => !isWritten(node));
    nodes.push(...plain.filter(inUse));
    const filled = plain.filter((node) => !inUse(node));
    const count = filled.reduce((n, node) => n + (node.matches(".row[data-key]") ? 1 : node.querySelectorAll('.row.sub[data-key][data-mark="filled"]').length), 0);
    if (filled.length) nodes.push(group("filled", `${count} Filled`, filled));
    const empty = by("empty");
    if (empty.length) nodes.push(group("empty", `${empty.length} Optional Left Empty`, empty));
    if (notAsked.length) nodes.push(group("not-asked", `${notAsked.length} Not Asked Right Now`, notAsked));
    return nodes;
  }

  /**
   * What the waiting box's rows used to say each (KAN-424): Write with
   * Claude (overlay.js's, which copies the trigger too), and where to paste
   * answers instead, the Written Answers page when the tab has its link.
   */
  function waitingNote(fields) {
    const note = Object.assign(document.createElement("div"), { className: "box-note" });
    const start = window.WIA.overlay?.startClaude?.();
    if (start) note.append(start);
    const link = fields.find((f) => f.status === "needs_writing" && f.link)?.link;
    const rest = Object.assign(document.createElement("p"), { textContent: "Or press a question to paste or type its answer" });
    if (link) rest.append(", or use ", Object.assign(document.createElement("a"), { href: link.href, textContent: link.text, target: "_blank", rel: "noreferrer" }));
    rest.append(".");
    note.append(rest);
    return note;
  }

  /**
   * A titled box of rows that ask something of the student: red, amber or
   * blue by its kind. Its title folds it, as the Filled line does, for the
   * page's life; folded, it keeps the row the student is on in view.
   */
  function box(kind, title, rows) {
    const el = Object.assign(document.createElement("section"), { className: "box" });
    el.dataset.box = kind;
    const shut = folded.has(kind);
    const toggle = Object.assign(document.createElement("button"), { type: "button", className: "box-toggle", textContent: title });
    toggle.setAttribute("aria-expanded", String(!shut));
    toggle.addEventListener("click", window.WIA.ui.trusted(() => {
      if (folded.has(kind)) folded.delete(kind);
      else folded.add(kind);
      window.WIA.overlay?.refresh?.();
    }));
    const head = Object.assign(document.createElement("h3"), { className: "box-head" });
    head.append(toggle);
    for (const r of rows) r.hidden = shut && !r.matches("[data-current], [data-open]");
    el.append(head, ...rows);
    return el;
  }

  /** A line that folds its rows away ("14 filled"): the student can open it, but nothing in it is theirs to do now. */
  function group(name, label, rows) {
    const el = Object.assign(document.createElement("div"), { className: "group" });
    el.dataset.group = name;
    const head = Object.assign(document.createElement("button"), { type: "button", className: "group-head", textContent: label });
    head.dataset.mark = name === "filled" ? "filled" : "empty";
    head.setAttribute("aria-expanded", String(opened.has(name)));
    head.addEventListener("click", window.WIA.ui.trusted(() => {
      if (opened.has(name)) opened.delete(name);
      else opened.add(name);
      window.WIA.overlay?.refresh?.();
    }));
    for (const r of rows) r.hidden = !opened.has(name);
    el.append(head, ...rows);
    return el;
  }

  // Phosphor's paths (@phosphor-icons/react's defs, as the webapp draws them):
  // fill weight for the three states a field ends in, regular for the rest.
  const CHECK_CIRCLE = "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm45.66,85.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z";
  const WARNING_CIRCLE = "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm-8,56a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm8,104a12,12,0,1,1,12-12A12,12,0,0,1,128,184Z";
  const QUESTION = "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,168a12,12,0,1,1,12-12A12,12,0,0,1,128,192Zm8-48.72V144a8,8,0,0,1-16,0v-8a8,8,0,0,1,8-8c13.23,0,24-9,24-20s-10.77-20-24-20-24,9-24,20v4a8,8,0,0,1-16,0v-4c0-19.85,17.94-36,40-36s40,16.15,40,36C168,125.38,154.24,139.93,136,143.28Z";
  const CLOCK_COUNTDOWN = "M232,136.66A104.12,104.12,0,1,1,119.34,24,8,8,0,0,1,120.66,40,88.12,88.12,0,1,0,216,135.34,8,8,0,0,1,232,136.66ZM120,72v56a8,8,0,0,0,8,8h56a8,8,0,0,0,0-16H136V72a8,8,0,0,0-16,0Zm40-24a12,12,0,1,0-12-12A12,12,0,0,0,160,48Zm36,24a12,12,0,1,0-12-12A12,12,0,0,0,196,72Zm24,36a12,12,0,1,0-12-12A12,12,0,0,0,220,108Z";
  const CIRCLE = "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Z";
  const CIRCLE_NOTCH = "M232,128a104,104,0,0,1-208,0c0-41,23.81-78.36,60.66-95.27a8,8,0,0,1,6.68,14.54C60.15,61.59,40,93.27,40,128a88,88,0,0,0,176,0c0-34.73-20.15-66.41-51.34-80.73a8,8,0,0,1,6.68-14.54C208.19,49.64,232,87,232,128Z";
  /** A glyph as a CSS mask image: black, since a mask reads only its alpha. */
  const glyph = (d) =>
    `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'><path d='${d}' fill='black' stroke='black' stroke-width='5' stroke-linejoin='round'/></svg>`)}")`;

  const css = `
    .section + .section { border-top: 1px solid var(--color-border); }
    .section-head { margin: 0; padding: 8px 12px 4px; font-size: var(--text-meta); font-weight: 600; color: var(--color-ink-meta); }
    /* The marks (markOf): the webapp's Phosphor glyphs (frontend/docs/design.md,
     * "Brand and icons"), a 16 px one on a row and a 12 px one on an entry's
     * field. Each is a mask over the mark's colour, so the colours stay tokens;
     * fill weight carries a state, regular the rest, and every glyph has the
     * webapp's 5-unit outline (globals.css) so it reads as heavy as its icons. */
    .row .dot {
      width: 16px; height: 16px; margin-top: 1px; border-radius: 0; flex: none;
      background: var(--color-ink-subtle);
      -webkit-mask: var(--glyph) center / contain no-repeat; mask: var(--glyph) center / contain no-repeat;
      --glyph: ${glyph(CIRCLE)};
    }
    .row[data-mark="filled"] .dot { background: var(--color-positive); --glyph: ${glyph(CHECK_CIRCLE)}; }
    .row[data-mark="check"] .dot { background: var(--color-warning); --glyph: ${glyph(QUESTION)}; }
    .row[data-mark="needs-you"] .dot { background: var(--color-danger); --glyph: ${glyph(WARNING_CIRCLE)}; }
    .row[data-mark="waiting"] .dot { background: var(--color-advanced); --glyph: ${glyph(CLOCK_COUNTDOWN)}; }
    .row[data-mark="filling"] .dot { --glyph: ${glyph(CIRCLE_NOTCH)}; animation: workit-spin 800ms linear infinite; }
    @keyframes workit-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .row[data-mark="filling"] .dot { animation: none; } }
    .entries .entry { margin: 0 12px 4px 34px; padding: 2px 0 4px 10px; border-left: 2px solid var(--color-border); }
    .entry-title { padding: 4px 0 2px; font-size: var(--text-note); font-weight: 600; color: var(--color-ink); }
    .row.sub { padding: 2px 0; font-size: var(--text-note); }
    .row.sub .label { font-weight: 400; color: var(--color-ink-muted); }
    .row.sub .dot { width: 12px; height: 12px; margin-top: 3px; }
    /* What needs the student, in a box per kind (settledNodes): red, amber, blue. */
    .box { margin: 8px 0 0; border: 1px solid var(--color-border); border-radius: var(--radius-card); overflow: hidden; }
    .box-head { margin: 0; font-size: var(--text-note); font-weight: 600; }
    button.box-toggle { all: unset; box-sizing: border-box; width: 100%; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 8px 12px; }
    button.box-toggle:focus-visible { outline: 2px solid var(--color-brand); outline-offset: -2px; }
    button.box-toggle::after {
      content: ""; margin-left: auto; width: 6px; height: 6px;
      border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(-135deg);
    }
    button.box-toggle[aria-expanded="false"]::after { transform: rotate(45deg); }
    .box > [hidden] { display: none; }
    .box[data-box="needs-you"] { border-color: var(--color-danger); }
    .box[data-box="needs-you"] .box-head { background: var(--color-danger-tint); color: var(--color-danger); }
    .box[data-box="check"] { border-color: var(--color-warning); }
    .box[data-box="check"] .box-head { background: var(--color-warning-tint); color: var(--color-warning-strong); }
    .box[data-box="check"] .row[data-guessed] { background: none; }
    .box[data-box="waiting"] .box-head { color: var(--color-advanced); }
    .box[data-box="written"] .box-head { color: var(--color-ink); }
    .box-note { padding: 0 12px 8px; font-size: var(--text-note); color: var(--color-ink-meta); }
    .box-note .start { margin: 0 0 4px; }
    .box-note p { margin: 0; }
    .box-note p a { color: var(--color-brand-ink); text-decoration: underline; }
    .box > .row + .row, .box > .row + .entries, .box > .entries + .row { border-top: 1px solid var(--color-border); }
    .group { margin: 8px 0 0; border: 1px solid var(--color-border); border-radius: var(--radius-card); }
    .group:last-child { margin-bottom: 8px; }
    button.group-head { all: unset; box-sizing: border-box; width: 100%; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: var(--text-note); font-weight: 500; color: var(--color-ink-muted); }
    button.group-head::before {
      content: ""; width: 16px; height: 16px; flex: none; background: var(--color-ink-subtle);
      -webkit-mask: var(--glyph) center / contain no-repeat; mask: var(--glyph) center / contain no-repeat; --glyph: ${glyph(CIRCLE)};
    }
    button.group-head[data-mark="filled"]::before { background: var(--color-positive); --glyph: ${glyph(CHECK_CIRCLE)}; }
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

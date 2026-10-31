// Report a problem (KAN-403) and fix reports (KAN-369), in the shell's
// "report" slot (panel.js): a preview card listing exactly what WorkIt would
// send, and Send, which sends it (background report.js, POST /fill-reports).
// A report is written for the developers' coding agent (docs/fill-reports.md)
// and holds no personal value:
//
// - the page: job system, the posting's public link, the engine's and the
//   extension's versions, the browser, the engine's recognition of the page
//   (the background names these);
// - every field of the fill: its name, label, kind, options, required, the
//   selector WorkIt found it by and whether it shows, the Plan's source and
//   the planned answer's shape (shared/report-parts.js shapeOf: "text:12",
//   never the text), the fill's status and reason (its values out), how it
//   read back, the error's name, and whether the student edited it after
//   WorkIt filled it or marked it wrong;
// - the fill's timeline: plan, each field's start and end, errors with stacks;
// - the form's HTML with every value, selection and personal text out
//   (snapshot below), for a developer to save as an engine fixture;
// - the student's note, if they write one.
//
// Values come out here first (the planned answers and what the page showed,
// which only this page holds), then once more in the background (the
// profile's). Nothing is sent but on Send, and each report needs its own
// press: after a send the card says so and offers no second Send.
//
// window.WIA.reportCard.open({ trigger, field }) opens it (the header's ⚑,
// the ⋯ menu, the settings view, the unsupported-site state, and a row's
// Report this, which pre-marks its field). window.WIA.report is what the
// fill tells it (content-script.js): track(questions, plan), result,
// failed, follow (the engine's field events), log; and rowAction(field), the
// checklist row's Report this / Wrong? button (overlay.js). Loaded after
// panel.js by the static launcher and by every fill; the first copy keeps
// the state.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  if (window.WIA.reportCard) return;
  const { send, el, button, trusted } = window.WIA.ui;
  const { ERRORS, NOTE_MAX, HTML_MAX, shapeOf, redactor, quoted, finalize } = window.WIA.reportParts;
  const SHAPE_MAX = 120;
  const TIMELINE_MAX = 400;
  const TEXT_KINDS = new Set(["text", "textarea", "unknown"]);

  const questions = new Map();
  const planned = new Map();
  const sources = new Map();
  const errors = new Map();
  const edited = new Set();
  const timeline = [];
  let started = null;
  let watching = false;

  const isEmpty = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
  const strings = (v) => (isEmpty(v) ? [] : (Array.isArray(v) ? v : [v]).filter((s) => typeof s === "string"));

  /** One step of the fill's timeline, `t` ms after the first. Its texts are taken out at collect. */
  function log(kind, { field, status, message, stack } = {}) {
    const now = performance.now();
    started ??= now;
    timeline.push({ t: Math.round(now - started), kind, ...(field ? { field } : {}), ...(status ? { status } : {}), ...(message ? { message: String(message) } : {}), ...(stack ? { stack: String(stack) } : {}) });
    if (timeline.length > TIMELINE_MAX * 2) timeline.splice(0, timeline.length - TIMELINE_MAX);
  }

  /** The fill's questions, and the Plan's answers and sources (kept on this page only, to take them out of what is sent). */
  function track(list, plan = {}) {
    for (const q of list ?? []) if (q?.name) questions.set(q.name, q);
    for (const [name, value] of Object.entries(plan.answers ?? {})) planned.set(name, value);
    for (const [name, source] of Object.entries(plan.sources ?? {})) sources.set(name, source);
    log("plan", { message: `${list?.length ?? 0} questions, ${Object.keys(plan.answers ?? {}).length} planned` });
    watchEdits();
  }

  /** A field failed with this error name (ERRORS), or by a fill result ({ status, reason, error }). */
  function failed(name, error) {
    const named = typeof error === "string" ? error : error?.error ?? (/^meant /.test(error?.reason ?? "") ? "Readback" : "FillError");
    errors.set(name, ERRORS.includes(named) ? named : "Error");
  }

  const stacks = new Set();
  /** A field's fill result: its error if it failed, and an engine error's stack once in the timeline. */
  function result(name, outcome) {
    if (outcome?.status === "failed") failed(name, outcome);
    if (outcome?.stack && !stacks.has(outcome.stack)) {
      stacks.add(outcome.stack);
      log("error", { field: name, message: outcome.reason, stack: outcome.stack });
    }
  }

  /** Follows one fill's field events (the key fill/page passed the engine as `events`) into the timeline. */
  function follow(key) {
    if (!key) return;
    log("fill");
    document.addEventListener(`fillengine:field:${key}`, (event) => {
      let at;
      try {
        at = JSON.parse(event.detail);
      } catch {
        return;
      }
      log("field", { field: at.name, status: at.phase === "start" ? "start" : at.result?.status, message: at.result?.reason });
    });
  }

  /** The student's edit of a field WorkIt filled: a row WorkIt filled turns the student's (content-script.js's watchEdits). */
  function watchEdits() {
    const status = window.WIA.status;
    if (watching || !status) return;
    watching = true;
    const last = new Map();
    status.subscribe(({ fields }) => {
      for (const row of fields) {
        const before = last.get(row.key);
        const theirs = row.source === "student" || /^You edited/.test(row.reason ?? "");
        if (before?.status === "filled" && !before.theirs && row.status === "filled" && theirs && !edited.has(row.key)) {
          edited.add(row.key);
          log("edit", { field: row.key });
        }
        last.set(row.key, { status: row.status, theirs });
      }
    });
  }

  /**
   * A label's shape: lower case, quoted names and digits taken out, only
   * letters and spaces kept. "Why Arc's “Boat” team? (2 lines)*" reads
   * "why arc s team # lines". The employer's wording, never a value.
   */
  function labelShape(label) {
    return String(label ?? "")
      .normalize("NFKD")
      .toLowerCase()
      .replace(/["“”«»][^"“”«»]*["“”«»]/g, " ")
      .replace(/\S+@\S+|https?:\/\/\S+/g, " ")
      .replace(/\d+/g, "#")
      .replace(/[^\p{L}# ]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, SHAPE_MAX);
  }

  /** The values to take out of everything sent: each text answer planned and each text the page showed. */
  function personalWords(rows) {
    const words = [];
    const choices = new Set();
    for (const [name, value] of planned) {
      const kind = questions.get(name)?.kind ?? "unknown";
      if (TEXT_KINDS.has(kind)) words.push(...strings(value));
      else strings(value).forEach((s) => choices.add(s.trim()));
    }
    for (const row of rows) {
      const kind = questions.get(row.key)?.kind ?? "unknown";
      if (TEXT_KINDS.has(kind)) words.push(...strings(row.shows));
      else strings(row.shows).forEach((s) => choices.add(s.trim()));
    }
    return { words, choices };
  }

  /** A CSS selector for the field's element: its id, its name, else its path from the nearest id. */
  function selectorOf(node) {
    if (!(node instanceof Element)) return undefined;
    if (node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) return `#${CSS.escape(node.id)}`;
    const name = node.getAttribute("name");
    if (name && document.querySelectorAll(`${node.localName}[name="${CSS.escape(name)}"]`).length === 1) return `${node.localName}[name="${name}"]`;
    const path = [];
    for (let at = node; at && at !== document.body && path.length < 6; at = at.parentElement) {
      if (at.id) {
        path.unshift(`#${CSS.escape(at.id)}`);
        break;
      }
      const same = [...(at.parentElement?.children ?? [])].filter((c) => c.localName === at.localName);
      path.unshift(same.length > 1 ? `${at.localName}:nth-of-type(${same.indexOf(at) + 1})` : at.localName);
    }
    return path.join(" > ");
  }

  const visible = (node) => (node instanceof Element ? (node.checkVisibility ? node.checkVisibility() : node.getClientRects().length > 0) : false);

  /** Each field of this page's fill, its values out, as a report lists it. */
  function fieldsOf(rows, redact) {
    const fieldOf = window.WIA.fieldOf;
    return rows.map((row) => {
      const q = questions.get(row.key);
      const kind = String(q?.kind ?? "unknown");
      const plan = planned.get(row.key);
      const label = redact(row.label ?? q?.label ?? row.key);
      const node = fieldOf?.(row.key) ?? null;
      const error = row.status === "failed" ? errors.get(row.key) ?? "Error" : undefined;
      const readback =
        row.status === "filled" ? "matches" : row.status === "failed" && (error === "Readback" || /^meant /.test(row.reason ?? "")) ? (isEmpty(row.shows) ? "empty" : "differs") : "unread";
      return {
        name: row.key,
        label,
        label_shape: labelShape(label),
        kind,
        required: Boolean(row.required),
        ...(q?.options?.length ? { options: q.options.slice(0, 100).map((o) => redact(String(o))) } : {}),
        ...(node ? { selector: redact(selectorOf(node) ?? "") } : {}),
        ...(fieldOf ? { visible: visible(node) } : {}),
        ...(row.source ?? sources.get(row.key) ? { source: row.source ?? sources.get(row.key) } : {}),
        planned: shapeOf(plan, kind),
        status: row.status,
        ...(row.reason ? { reason: quoted(row.reason, { planned: plan, shows: row.shows, redact }) } : {}),
        readback,
        ...(row.shows !== undefined ? { shows: shapeOf(row.shows, kind) } : {}),
        ...(error ? { error } : {}),
        ...(edited.has(row.key) ? { edited: true } : {}),
      };
    });
  }

  /** Whether a text node stands in an option list or an option's own label: the employer's words, kept. */
  function inOptions(node) {
    const parent = node.parentElement;
    if (!parent) return false;
    if (parent.closest("option, optgroup, datalist, [role=option], [role=listbox], [role=radio], [role=checkbox], legend")) return true;
    const label = parent.closest("label");
    return Boolean(label && label.querySelector('input[type="radio"], input[type="checkbox"]'));
  }

  /** A link with no query, fragment or sign-in, and none at all for a mailto:, tel: or data: one. */
  function bareLink(value) {
    if (/^\s*(mailto|tel|sms|data|blob|javascript):/i.test(value)) return "";
    try {
      const url = new URL(value, location.href);
      return `${url.origin}${url.pathname}`;
    } catch {
      return "";
    }
  }

  const LINKS = new Set(["href", "src", "action", "formaction", "srcset", "data-src", "poster", "background"]);
  const KEEP_VALUE = new Set(["checkbox", "radio", "submit", "button", "reset", "image"]);

  /**
   * The form's HTML with every value out: what the student typed, picked or
   * attached (input values, a textarea's text, checked and selected marks,
   * an editable box's text), the panel, scripts and styles, a link's query,
   * and each personal word (`redact`); a choice WorkIt made shown as page text
   * outside its option list (a dropdown's chosen value) is «shown». Its
   * structure, labels, options and attributes stay, so a developer can fill
   * it in a test. The form's own element when the fields share one, else the body.
   */
  function snapshot(redact, choices) {
    const fieldOf = window.WIA.fieldOf;
    const first = [...questions.keys()].map((name) => fieldOf?.(name)).find((node) => node instanceof Element);
    const form = first?.closest("form");
    const root = form && form.querySelectorAll("input, select, textarea").length >= 2 ? form : document.body;
    if (!root) return undefined;
    const clone = root.cloneNode(true);
    clone.querySelectorAll("#workit-autofiller-overlay-host, script, noscript, style, link, template, meta").forEach((node) => node.remove());
    clone.querySelectorAll("svg").forEach((node) => node.replaceChildren());
    for (const node of [clone, ...clone.querySelectorAll("*")]) {
      const tag = node.localName;
      if (tag === "input") {
        const type = (node.getAttribute("type") ?? "text").toLowerCase();
        if (KEEP_VALUE.has(type)) node.removeAttribute("checked");
        else node.removeAttribute("value");
      }
      if (tag === "textarea" || node.hasAttribute("contenteditable")) node.textContent = "";
      if (tag === "option") node.removeAttribute("selected");
      for (const attr of ["aria-checked", "aria-selected", "aria-pressed", "data-value", "data-initial-value"]) node.removeAttribute(attr);
      for (const { name, value } of [...node.attributes]) {
        if (/^on/i.test(name)) node.removeAttribute(name);
        else if (LINKS.has(name)) node.setAttribute(name, bareLink(value));
        else if (value) node.setAttribute(name, redact(value));
      }
    }
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
    const texts = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node);
    for (const node of texts) {
      if (node.nodeType === Node.COMMENT_NODE) {
        node.remove();
        continue;
      }
      const text = node.nodeValue ?? "";
      if (!text.trim()) continue;
      node.nodeValue = !inOptions(node) && choices.has(text.trim()) ? text.replace(text.trim(), "«shown»") : redact(text);
    }
    const html = clone.outerHTML;
    return html.length > HTML_MAX ? `${html.slice(0, HTML_MAX - 40)}<!-- cut at ${HTML_MAX} characters -->` : html;
  }

  /** What this page would report, its values out: for the background's preview (report/preview). */
  function collect(trigger) {
    const rows = (window.WIA.status?.summary().fields ?? []).filter((row) => !row.note && !String(row.key).startsWith("_"));
    const { words, choices } = personalWords(rows);
    const redact = redactor(words);
    const fields = fieldsOf(rows, redact);
    const byName = new Map(rows.map((row) => [row.key, row]));
    const steps = timeline.slice(-TIMELINE_MAX).map((step) => {
      const row = byName.get(step.field);
      const clean = (text) => quoted(text, { planned: planned.get(step.field), shows: row?.shows, redact });
      return { ...step, ...(step.message ? { message: clean(step.message) } : {}), ...(step.stack ? { stack: clean(step.stack) } : {}) };
    });
    return { trigger, frame: window.top === window ? "top" : "iframe", fields, timeline: steps, html: rows.length ? snapshot(redact, choices) : undefined };
  }

  const ROW_CSS = `
    .row .report-this {
      all: unset; cursor: pointer; display: inline-block; margin-top: 4px; padding: 2px 8px; font-size: var(--text-meta); font-weight: 500;
      color: var(--color-ink); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-control); background: var(--color-panel);
    }
    .row .report-this:hover { background: var(--color-hover); }
    .row .report-this:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
    .row .report-this[data-report-trigger="row"] { border-color: transparent; color: var(--color-ink-meta); }
    .row:not([data-open]) .report-this[data-report-trigger="row"] { display: none; }
  `;
  let rowStyled = false;

  /**
   * A checklist row's report button (overlay.js puts it under the row), or
   * null: Report this on a field that failed (read-back or an error), on one
   * the student edited after WorkIt filled it, and on the fill's own error;
   * Wrong? on any other filled field, shown once its row is opened. Each
   * opens the card with that field marked.
   */
  function rowAction(field) {
    let trigger = null;
    if (field.note) trigger = field.key === "_error" ? "error" : null;
    else if (edited.has(field.key)) trigger = "edited";
    else if (field.status === "failed" && errors.has(field.key) && errors.get(field.key) !== "NoAnswer") trigger = errors.get(field.key) === "Readback" ? "readback" : "error";
    else if (field.status === "filled") trigger = "row";
    if (!trigger) return null;
    if (!rowStyled && window.WIA.panel?.addCss) {
      window.WIA.panel.addCss(ROW_CSS);
      rowStyled = true;
    }
    const action = el("button", "report-this", trigger === "row" ? "Wrong? Report it" : "Report this");
    action.type = "button";
    action.dataset.reportTrigger = trigger;
    action.addEventListener("click", trusted(() => open({ trigger, field: field.note ? null : field.key })));
    return action;
  }

  const CARD_CSS = `
    [data-slot="report"] .report-lead { margin: 0 0 8px; color: var(--color-ink-meta); }
    [data-slot="report"] .report-sent { margin: 0 0 10px; padding: 8px; border: 1px solid var(--color-border); border-radius: var(--radius-control); background: var(--color-well); }
    [data-slot="report"] dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; font-size: var(--text-note); }
    [data-slot="report"] dt { color: var(--color-ink-meta); }
    [data-slot="report"] dd { margin: 0; color: var(--color-ink); overflow-wrap: anywhere; }
    [data-slot="report"] ul { margin: 4px 0 0; padding-left: 16px; font-size: var(--text-note); color: var(--color-ink); }
    [data-slot="report"] .report-none { font-size: var(--text-note); color: var(--color-ink-meta); }
    [data-slot="report"] label { display: block; margin: 0 0 4px; font-weight: 600; font-size: var(--text-note); }
    [data-slot="report"] fieldset { margin: 0 0 10px; padding: 0; border: 0; }
    [data-slot="report"] legend { margin: 0 0 4px; font-weight: 600; font-size: var(--text-note); }
    [data-slot="report"] .report-marks { max-height: 160px; overflow: auto; border: 1px solid var(--color-border); border-radius: var(--radius-control); padding: 4px 8px; }
    [data-slot="report"] .report-marks label { display: flex; gap: 6px; align-items: baseline; font-weight: 400; margin: 2px 0; }
    [data-slot="report"] .report-marks span { color: var(--color-ink-meta); }
    [data-slot="report"] .report-layout { display: flex; gap: 6px; align-items: baseline; font-weight: 400; margin: 0 0 10px; }
    [data-slot="report"] details { margin: 0 0 10px; font-size: var(--text-note); }
    [data-slot="report"] summary { cursor: pointer; color: var(--color-ink-meta); }
    [data-slot="report"] pre {
      max-height: 200px; overflow: auto; margin: 4px 0 0; padding: 6px; white-space: pre-wrap; overflow-wrap: anywhere;
      font-size: var(--text-meta); background: var(--color-well); border-radius: var(--radius-control);
    }
    [data-slot="report"] textarea {
      box-sizing: border-box; width: 100%; min-height: 64px; margin: 0 0 10px; padding: 6px 8px; resize: vertical;
      font: inherit; color: var(--color-ink); background: var(--color-panel); border: 1px solid var(--color-border); border-radius: var(--radius-control);
    }
    [data-slot="report"] textarea:focus-visible, [data-slot="report"] input:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }
    [data-slot="report"] .report-actions { display: flex; gap: 8px; }
    [data-slot="report"] .report-said { margin: 0 0 10px; }
    [data-slot="report"] .report-said[data-error] { color: var(--color-danger); }
  `;
  let styled = false;

  /**
   * Opens the report card in place of the tabs, with a fresh preview of what
   * this page would send. `field`: a field to mark wrong at once (a row's
   * Report this); `trigger`: what opened it (report-parts.js TRIGGERS).
   */
  async function open({ trigger = "menu", field = null } = {}) {
    const panel = window.WIA.panel;
    if (!panel?.root) return;
    if (!styled) {
      panel.addCss(CARD_CSS);
      styled = true;
    }
    const place = panel.slot("report");
    panel.open?.();
    panel.showView("report", true);
    const back = () => panel.showView("report", false);
    place.replaceChildren(el("h2", "", "Report a problem"), el("p", "report-lead", "Reading this page…"));

    let draft;
    try {
      draft = collect(trigger);
    } catch (error) {
      // A page WorkIt can't read whole still gets a report: its page's parts, and what broke, in the timeline.
      console.warn("[report] couldn't read the page:", error);
      draft = { trigger, timeline: [{ t: 0, kind: "error", message: `report: ${error?.message ?? error}`, stack: String(error?.stack ?? "") }] };
    }
    const answer = await send({ type: "report/preview", draft });
    if (!answer?.ok || !answer.report) {
      place.replaceChildren(el("h2", "", "Report a problem"), el("p", "report-said", "WorkIt couldn't read this page. Reload it and try again."), button("Back", back));
      return;
    }
    const { report } = answer;
    const marked = new Set(field && report.fields.some((f) => f.name === field) ? [field] : []);

    const sent = el("div", "report-sent");
    const list = el("dl");
    const parts = [["job_system", "Job system", report.job_system], ["posting_url", "Posting", report.posting_url], ["engine_version", "Engine", report.engine_version],
      ["extension_version", "Extension", report.context?.extension_version], ["browser", "Browser", report.context?.browser]];
    for (const [part, name, value] of parts) {
      const dd = el("dd", "", value ?? "");
      dd.dataset.part = part;
      list.append(el("dt", "", name), dd);
    }
    sent.append(list);
    const wrong = report.fields.filter((f) => f.error);
    if (wrong.length) {
      const items = el("ul");
      for (const f of wrong) items.append(el("li", "report-field", `${f.kind} · ${f.label_shape} · ${f.error}`));
      sent.append(el("p", "report-none", `Fields that went wrong (${wrong.length})`), items);
    } else {
      sent.append(el("p", "report-none", "No field went wrong in WorkIt's fill."));
    }

    const json = el("pre", "report-json");
    const note = el("textarea");
    // The page's layout (its HTML, values out) goes along unless the student unticks it (KAN-456: opt-in, ticked by default).
    const layout = el("input");
    layout.type = "checkbox";
    layout.checked = true;
    layout.id = "workit-report-layout";
    const summary = el("summary");
    const showJson = () => {
      json.textContent = JSON.stringify(finalize(report, { marked: [...marked], note: note.value, layout: layout.checked }), null, 1);
      summary.textContent = layout.checked && report.html
        ? `Exactly what WorkIt sends (the form's page with every value taken out: ${Math.ceil(report.html.length / 1024)} KB)`
        : "Exactly what WorkIt sends";
    };
    layout.addEventListener("change", showJson);

    const marks = el("fieldset");
    if (report.fields.length) {
      marks.append(el("legend", "", "Which field is wrong? (optional)"));
      const box = el("div", "report-marks");
      for (const f of report.fields) {
        const label = el("label", "report-mark");
        const tick = el("input");
        tick.type = "checkbox";
        tick.checked = marked.has(f.name);
        tick.dataset.name = f.name;
        tick.addEventListener("change", () => {
          if (tick.checked) marked.add(f.name);
          else marked.delete(f.name);
          showJson();
        });
        label.append(tick, f.label || f.label_shape || f.name, el("span", "", f.status ?? ""));
        box.append(label);
      }
      marks.append(box);
    }

    note.id = "workit-report-note";
    note.maxLength = NOTE_MAX;
    note.placeholder = "What went wrong, and what should WorkIt have done? Leave out anything personal.";
    note.addEventListener("input", showJson);
    const label = el("label", "", "Note (optional)");
    label.htmlFor = note.id;
    const said = el("p", "report-said");
    said.hidden = true;

    const all = el("details", "report-all");
    all.append(summary, json);
    const layoutLabel = el("label", "report-layout");
    layoutLabel.append(layout, "Include the page's layout (no answers)");
    showJson();

    const sendButton = button("Send report", async () => {
      sendButton.disabled = true;
      said.hidden = true;
      const text = note.value.trim();
      const answer = await send({ type: "report/send", marked: [...marked], note: text || null, layout: layout.checked });
      if (answer?.ok) {
        place.replaceChildren(el("h2", "", "Report a problem"), el("p", "report-said", "Sent. Thanks for telling WorkIt."), button("Back", back));
        return;
      }
      sendButton.disabled = false;
      said.dataset.error = "";
      // 429: the day's limit (KAN-478), in the API's own words.
      said.textContent = answer?.status === 401 ? "Sign in to WorkIt to send a report."
        : answer?.status === 429 && answer.error ? answer.error : "WorkIt couldn't send it. Try again.";
      said.hidden = false;
    });
    const actions = el("div", "report-actions");
    actions.append(sendButton, button("Back", back));
    place.replaceChildren(
      el("h2", "", "Report a problem"),
      el("p", "report-lead", "WorkIt sends only what's listed here, and only when you press Send. Your answers and personal details are taken out first."),
      sent, marks, label, note, layoutLabel, all, said, actions,
    );
  }

  /** A failed field's error name (ERRORS), if the fill named one: fill-event.js's counts (KAN-476). */
  const errorOf = (name) => errors.get(name);
  window.WIA.report = { track, failed, result, follow, log, labelShape, rowAction, collect, errorOf };
  window.WIA.reportCard = { open };
})();

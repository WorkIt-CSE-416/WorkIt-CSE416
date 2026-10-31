// What a fill report may hold, and how its personal values come out, in one
// place for the whole extension: the panel's card (content/report.js), the
// toolbar popup and the background (background/report.js) all read it. The
// backend's schema (backend/app/schemas/fill_reports.py) keeps its own copy.
// A plain script, loaded as a content script and a page script, and imported
// by the background for its side effect; pure, so test/report-parts.spec.ts
// runs it in Node.
//
// ERRORS: the error names a failed field may carry (the backend's
// ErrorName). Readback: the field shows something other than its answer.
// FillError: the engine couldn't fill it. Handoff, NoForm: the engine's own.
// NoAnswer: WorkIt had no answer for it. Error: anything else.
// TRIGGERS: what opened the card (the ⋯ menu, a fill's error, a field that
// failed read-back, a field the student edited after WorkIt filled it, a row
// they marked wrong). NOTE_MAX: the longest note. HTML_MAX: the longest form
// snapshot (the backend's HTML_MAX). FIELD_PARTS, TIMELINE_PARTS: the only
// keys a field or a timeline step may have; the background drops any other.
//
// shapeOf(value, kind): an answer's shape, never the answer ("text:12",
// "option", "options:3", "file", "none"). redactor(words): a function that
// takes `words` (the student's values: profile, planned answers, what the
// page showed) out of a text, whole words only, case aside, and anything that
// looks like an email, a phone number or a file name. quoted(text): a fill
// reason with what it quotes taken out. finalize(report, { marked, note }):
// the report as Send sends it, the one function the preview and Send share.
globalThis.WIA = globalThis.WIA || {};

(function () {
  "use strict";

  const ERRORS = Object.freeze(["Readback", "FillError", "Handoff", "NoForm", "NoAnswer", "Error"]);
  const TRIGGERS = Object.freeze(["menu", "error", "readback", "edited", "row"]);
  const FIELD_PARTS = Object.freeze([
    "kind", "label_shape", "error", "name", "label", "required", "options", "selector", "visible", "source", "planned", "status", "reason", "readback", "shows", "edited",
  ]);
  const TIMELINE_PARTS = Object.freeze(["t", "kind", "field", "status", "message", "stack"]);
  const NOTE_MAX = 1000;
  const HTML_MAX = 500_000;

  const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
  const PHONE = /(?<![\w])(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w])|\+\d{10,14}(?!\d)/g;
  const FILE = /[^\s"'<>/\\]+\.(?:pdf|docx?|rtf|odt|txt|pages)\b/gi;
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /** An answer's shape: what kind and how long, never what it says. */
  function shapeOf(value, kind) {
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) return "none";
    if (Array.isArray(value)) return `options:${value.length}`;
    if (typeof value === "object") return "file";
    if (kind === "select" || kind === "multi_select") return "option";
    if (kind === "file") return "file";
    return `text:${String(value).length}`;
  }

  /** The words to take out: each string value, split names and phone digits too, two characters or more. */
  function wordsOf(values) {
    const words = new Set();
    const add = (value) => {
      if (typeof value === "number") value = String(value);
      if (typeof value !== "string") return;
      const text = value.trim();
      if (text.length < 2) return;
      words.add(text);
      // A name's parts ("Test Person" → Test, Person), and a phone's digits as forms retype them.
      if (/^[\p{L}'. -]+$/u.test(text)) for (const part of text.split(/\s+/)) if (part.length >= 2) words.add(part);
      const digits = text.replace(/\D/g, "");
      if (digits.length >= 7 && /^[\d\s()+.-]+$/.test(text)) {
        words.add(digits);
        words.add(digits.slice(-10));
      }
      // A link without its scheme, as a page may print it.
      if (/^https?:\/\//i.test(text)) {
        const bare = text.replace(/^https?:\/\//i, "").replace(/\/$/, "");
        words.add(bare);
        words.add(bare.replace(/^www\./i, ""));
      }
    };
    for (const value of values) (Array.isArray(value) ? value : [value]).forEach(add);
    return [...words].sort((a, b) => b.length - a.length);
  }

  /** A function taking `values` (and emails, phone numbers, file names) out of a text: «redacted», «email», «phone», «file». */
  function redactor(values = []) {
    const words = wordsOf(values);
    const pattern = words.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "giu") : null;
    return (text) => {
      if (typeof text !== "string" || !text) return text;
      let out = text.replace(EMAIL, "«email»");
      if (pattern) out = out.replace(pattern, "«redacted»");
      return out.replace(PHONE, "«phone»").replace(FILE, "«file»");
    };
  }

  /**
   * A fill reason with its values out: `planned` and `shows` (the field's
   * answer and what the page showed) as «planned» and «shown», then whatever
   * it still quotes as «redacted», then `redact`.
   */
  function quoted(text, { planned, shows, redact = (t) => t } = {}) {
    if (typeof text !== "string" || !text) return text;
    const marks = [[stringsOf(planned), "«planned»"], [stringsOf(shows), "«shown»"]];
    const markOf = (inner) => marks.find(([values]) => values.includes(inner.trim()))?.[1] ?? "«redacted»";
    // A quote first, whole ("meant 'Test', page shows 'Pat'"), then the values wherever else they stand.
    let out = text.replace(/(["“‘]|(?<![\p{L}\p{N}])')([^"'“”‘’]{1,300}?)(["”’]|'(?![\p{L}\p{N}]))/gu, (_, open, inner, close) => `${open}${markOf(inner)}${close}`);
    for (const [values, mark] of marks) for (const value of values) out = out.split(value).join(mark);
    return redact(out);
  }

  /** A value's strings, trimmed, longest first (a file answer has none). */
  const stringsOf = (value) =>
    (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value])
      .filter((v) => typeof v === "string" && v.trim())
      .map((v) => v.trim())
      .sort((a, b) => b.length - a.length);

  /**
   * The report Send sends: `report` (the background's preview) with the fields the student marked wrong and their note,
   * and the page's layout (`html`) only while `layout`, the card's "Include the page's layout" box, is ticked (KAN-456).
   */
  function finalize(report, { marked = [], note = null, layout = true } = {}) {
    const wrong = new Set(marked);
    const text = typeof note === "string" && note.trim() ? note.trim().slice(0, NOTE_MAX) : null;
    const { html, ...rest } = report;
    return { ...rest, ...(layout && html !== undefined ? { html } : {}), fields: report.fields.map((field) => (wrong.has(field.name) ? { ...field, marked: true } : field)), note: text };
  }

  globalThis.WIA.reportParts = Object.freeze({ ERRORS, TRIGGERS, FIELD_PARTS, TIMELINE_PARTS, NOTE_MAX, HTML_MAX, shapeOf, redactor, quoted, finalize });
})();

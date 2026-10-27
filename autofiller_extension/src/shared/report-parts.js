// What a fill report may hold, in one place for the whole extension: the
// panel's card (content/report.js), the toolbar popup and the background
// (background/report.js) all read it. The backend's schema keeps its own copy.
// A plain script, loaded as a content script and a page script, and imported by
// the background for its side effect.
//
// ERRORS: the error names a failed field may carry (backend/app/schemas/
// fill_reports.py's ErrorName). Readback: the field shows something other than
// its answer. FillError: the engine couldn't fill it. Handoff, NoForm: the
// engine's own. NoAnswer: WorkIt had no answer for it. Error: anything else.
// NOTE_MAX: the longest note the student may add.
globalThis.WIA = globalThis.WIA || {};
globalThis.WIA.reportParts = Object.freeze({
  ERRORS: Object.freeze(["Readback", "FillError", "Handoff", "NoForm", "NoAnswer", "Error"]),
  NOTE_MAX: 1000,
});

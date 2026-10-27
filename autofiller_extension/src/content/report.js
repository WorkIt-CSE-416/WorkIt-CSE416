// Report a problem (KAN-403), in the shell's "report" slot (panel.js): a
// preview card listing exactly what WorkIt would send, and Send, which sends
// it (background report.js, POST /fill-reports). A report is:
//
// - the job system (the Fill engine's jobOf site; "unsupported" on a job
//   system it doesn't fill), the posting's public link (no query or
//   fragment), and the Fill engine's version (the pinned tag);
// - per failed field: its kind, its label's shape (labelShape below) and the
//   error's name (ERRORS); never the reason, which can quote the page or the
//   student's answer, never an answer, never what the page shows;
// - the student's note, if they write one.
//
// Nothing is sent but on Send, and each report needs its own press: after a
// send the card says so and offers no second Send until it is opened again.
//
// window.WIA.reportCard.open() opens it (the header's ⚑, the settings view,
// the unsupported-site state). window.WIA.report is what the fill tells it:
// each question's kind (track) and each failed field's error name (failed).
// Loaded after panel.js by the static launcher and by every fill; the first
// copy keeps the state.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  if (window.WIA.reportCard) return;
  const { send } = window.WIA.ui;

  // The error names a report may carry and the note's limit (shared/report-parts.js).
  const { ERRORS, NOTE_MAX } = window.WIA.reportParts;
  const SHAPE_MAX = 120;

  const kinds = new Map();
  const errors = new Map();

  /** The fill's questions, for each field's kind. */
  function track(questions) {
    for (const q of questions ?? []) if (q?.name && q.kind) kinds.set(q.name, String(q.kind));
  }

  /** A field failed with this error name (ERRORS), or by a fill result ({ status, reason, error }). */
  function failed(name, error) {
    const named = typeof error === "string" ? error : error?.error ?? (/^meant /.test(error?.reason ?? "") ? "Readback" : "FillError");
    errors.set(name, ERRORS.includes(named) ? named : "Error");
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

  /** Each failed field of this page's fill, as a report lists it. */
  function fields() {
    const rows = window.WIA.status?.summary().fields ?? [];
    return rows
      .filter((row) => row.status === "failed" && !row.note && !String(row.key).startsWith("_"))
      .map((row) => ({ kind: kinds.get(row.key) ?? "unknown", label_shape: labelShape(row.label), error: errors.get(row.key) ?? "Error" }));
  }

  const CSS = `
    [data-slot="report"] .report-lead { margin: 0 0 8px; color: var(--color-ink-meta); }
    [data-slot="report"] .report-sent { margin: 0 0 10px; padding: 8px; border: 1px solid var(--color-border); border-radius: var(--radius-control); background: var(--color-well); }
    [data-slot="report"] dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; font-size: var(--text-note); }
    [data-slot="report"] dt { color: var(--color-ink-meta); }
    [data-slot="report"] dd { margin: 0; color: var(--color-ink); overflow-wrap: anywhere; }
    [data-slot="report"] ul { margin: 4px 0 0; padding-left: 16px; font-size: var(--text-note); color: var(--color-ink); }
    [data-slot="report"] .report-none { font-size: var(--text-note); color: var(--color-ink-meta); }
    [data-slot="report"] label { display: block; margin: 0 0 4px; font-weight: 600; font-size: var(--text-note); }
    [data-slot="report"] textarea {
      box-sizing: border-box; width: 100%; min-height: 64px; margin: 0 0 10px; padding: 6px 8px; resize: vertical;
      font: inherit; color: var(--color-ink); background: var(--color-panel); border: 1px solid var(--color-border); border-radius: var(--radius-control);
    }
    [data-slot="report"] textarea:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }
    [data-slot="report"] .report-actions { display: flex; gap: 8px; }
    [data-slot="report"] .report-said { margin: 0 0 10px; }
    [data-slot="report"] .report-said[data-error] { color: var(--color-danger); }
  `;
  let styled = false;

  const { el, button } = window.WIA.ui;

  /** Opens the report card in place of the tabs, with a fresh preview of what this page would send. */
  async function open() {
    const panel = window.WIA.panel;
    if (!panel?.root) return;
    if (!styled) {
      panel.addCss(CSS);
      styled = true;
    }
    const place = panel.slot("report");
    panel.open?.();
    panel.showView("report", true);
    const back = () => panel.showView("report", false);
    place.replaceChildren(el("h2", "", "Report a problem"), el("p", "report-lead", "Reading this page…"));

    const where = await send({ type: "report/preview" });
    if (!where?.ok) {
      place.replaceChildren(el("h2", "", "Report a problem"), el("p", "report-said", "WorkIt couldn't read this page. Reload it and try again."), button("Back", back));
      return;
    }
    const report = { job_system: where.job_system, posting_url: where.posting_url, engine_version: where.engine_version, fields: fields() };

    const sent = el("div", "report-sent");
    const list = el("dl");
    for (const [part, name] of [["job_system", "Job system"], ["posting_url", "Posting"], ["engine_version", "Engine"]]) {
      const value = el("dd", "", report[part]);
      value.dataset.part = part;
      list.append(el("dt", "", name), value);
    }
    sent.append(list);
    if (report.fields.length) {
      const items = el("ul");
      for (const f of report.fields) items.append(el("li", "report-field", `${f.kind} · ${f.label_shape} · ${f.error}`));
      sent.append(el("p", "report-none", `Fields that went wrong (${report.fields.length})`), items);
    } else {
      sent.append(el("p", "report-none", "No field went wrong in WorkIt's fill."));
    }

    const note = el("textarea");
    note.id = "workit-report-note";
    note.maxLength = NOTE_MAX;
    note.placeholder = "What went wrong? Leave out anything personal.";
    const label = el("label", "", "Note (optional)");
    label.htmlFor = note.id;
    const said = el("p", "report-said");
    said.hidden = true;

    const sendButton = button("Send report", async () => {
      sendButton.disabled = true;
      said.hidden = true;
      const text = note.value.trim();
      const answer = await send({ type: "report/send", report: { ...report, note: text || null } });
      if (answer?.ok) {
        place.replaceChildren(el("h2", "", "Report a problem"), el("p", "report-said", "Sent. Thanks for telling WorkIt."), button("Back", back));
        return;
      }
      sendButton.disabled = false;
      said.dataset.error = "";
      said.textContent = answer?.status === 401 ? "Sign in to WorkIt to send a report." : "WorkIt couldn't send it. Try again.";
      said.hidden = false;
    });
    const actions = el("div", "report-actions");
    actions.append(sendButton, button("Back", back));
    place.replaceChildren(
      el("h2", "", "Report a problem"),
      el("p", "report-lead", "WorkIt sends only what's listed here, and only when you press Send. Never your answers or the page's text."),
      sent, label, note, said, actions,
    );
  }

  window.WIA.report = { track, failed, fields, labelShape };
  window.WIA.reportCard = { open };
})();

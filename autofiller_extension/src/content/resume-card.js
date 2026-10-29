// The résumé's actions (KAN-399, moved by KAN-424), from background
// resume-tab.js: once the form's Resume/CV row is opened, its card says
// which file the form gets and what to do about it. The Resume tab that
// held them is gone: a student rarely switches résumés mid-fill, and when
// they must (the wrong one went in, or none did), the row that needs it is
// where they look.
//
// - Attached: the file's name and kind, Preview (opens it in a new tab) and
//   Change.
// - None attached: Upload Resume (a file from their computer, saved to
//   their Resumes and attached) and Choose Resume.
// - Change and Choose Resume open Choose a Resume, a dialog over the panel
//   listing their résumés (uploaded, base, tailored for this job) as the
//   Resumes page's table does, the attached one marked, with Upload a New
//   Resume under the list. A pick is kept for the tab and saved for the
//   application, and the new file goes into the form's résumé field in
//   place, through the Fill engine's file fill (the failed card's
//   fill-one-field, content-script.js `fixesOf`).
//
// Loaded after panel.js by the static launcher and by every fill; the first
// copy keeps the state. Each fill hands its Plan over with `use(fixes)`;
// overlay.js's row asks `card(field)` for the opened row.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  if (window.WIA.resumeCard) return;
  const panel = window.WIA.panel;
  if (!panel) return;
  const { send, el } = window.WIA.ui;

  const CSS = `
    .row-card.resume-card .resume-name { font-weight: 600; color: var(--color-ink); overflow-wrap: anywhere; }
    .resume-dialog-backdrop {
      position: absolute; inset: 0; z-index: 2; display: flex; align-items: flex-start; justify-content: center; padding: 64px 12px 12px;
      background: color-mix(in srgb, var(--color-ink) 30%, transparent);
    }
    .resume-dialog {
      box-sizing: border-box; width: 100%; max-height: 100%; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 12px;
      background: var(--color-panel); border-radius: var(--radius-card); box-shadow: var(--shadow-lift);
      font-size: var(--text-label); color: var(--color-ink);
    }
    .resume-dialog .dialog-head { display: flex; align-items: center; justify-content: space-between; }
    .resume-dialog h2 { margin: 0; font-size: var(--text-subtitle); font-weight: 600; }
    .resume-dialog button {
      all: unset; cursor: pointer; box-sizing: border-box; border-radius: var(--radius-control); font-size: var(--text-note); font-weight: 600;
    }
    .resume-dialog button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }
    .resume-dialog [data-close] { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 9999px; }
    .resume-dialog [data-close]:hover { background: var(--color-hover); }
    .resume-dialog [data-close] svg { width: 16px; height: 16px; fill: currentColor; }
    .resume-dialog .options { all: unset; display: flex; flex-direction: column; border: 1px solid var(--color-border); border-radius: var(--radius-card); overflow: hidden; }
    .resume-dialog .options li { list-style: none; }
    .resume-dialog .options li + li { border-top: 1px solid var(--color-border); }
    .resume-dialog .resume-option { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 12px; font-weight: 400; }
    .resume-dialog .resume-option:hover { background: var(--color-hover); }
    .resume-dialog .resume-option[aria-current] { cursor: default; background: var(--color-brand-tint); }
    .resume-dialog .option-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .resume-dialog .option-name { color: var(--color-ink); font-weight: 600; overflow-wrap: anywhere; }
    .resume-dialog .option-kind { font-size: var(--text-note); color: var(--color-ink-meta); }
    .resume-dialog .option-state { font-size: var(--text-note); font-weight: 600; color: var(--color-brand-ink); }
    .resume-dialog [data-upload] {
      align-self: flex-start; padding: 6px 12px; border: 1px solid var(--color-border-control); color: var(--color-ink); background: var(--color-panel);
    }
    .resume-dialog [data-upload]:hover { background: var(--color-hover); }
  `;

  const KINDS = { uploaded: "Uploaded file", built: "Built in WorkIt", tailored: "Tailored for this job" };
  const RESUME = /r[ée]sum[ée]|\bcv\b|curriculum/i;
  // Upload Resume's file types: the ones the API reads (backend services/text_extraction.py).
  const TYPES = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  // Phosphor's X (regular): the dialog's Close.
  const CLOSE = `<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>`;

  let fixes = null; // the fill's Plan (content-script.js), once the form is filled
  let state = null; // resume/tab's answer
  let said = "";
  let dialog = null;

  const refresh = () => window.WIA.overlay?.refresh?.();
  const bytes = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const base64Of = (buffer) => {
    let text = "";
    const all = new Uint8Array(buffer);
    for (let i = 0; i < all.length; i += 0x8000) text += String.fromCharCode(...all.subarray(i, i + 0x8000));
    return btoa(text);
  };
  /** The panel's frame: the dialog's containing block, so it covers the panel and its rounded corners clip it. */
  const frame = () => panel.root?.querySelector(".panel") ?? null;

  /** Whether `field` is the form's résumé upload: the field the attached file went into, or a file field named for one. */
  function isResume(field) {
    const question = fixes?.questions?.find((q) => q.name === field.key);
    if (!question || question.kind !== "file") return false;
    const name = state?.attached?.name;
    return Boolean((name && fixes.answers[field.key]?.file === name) || RESUME.test(question.label ?? field.label ?? ""));
  }

  async function preview() {
    const answer = await send({ type: "resume/file" });
    if (!answer?.file) {
      said = "WorkIt couldn't open the resume. Try again.";
      return refresh();
    }
    window.open(URL.createObjectURL(new Blob([bytes(answer.file.base64)], { type: answer.file.mimeType })), "_blank");
  }

  async function use(option) {
    closeDialog();
    said = `Switching to ${option.name}…`;
    refresh();
    await attach(await send({ type: "resume/choose", key: option.key }), "WorkIt couldn't switch the resume. Try again.");
  }

  function pickFile() {
    closeDialog();
    const input = Object.assign(document.createElement("input"), { type: "file", accept: TYPES, hidden: true });
    input.addEventListener("change", async () => {
      const chosen = input.files?.[0];
      input.remove();
      if (!chosen) return;
      said = `Uploading ${chosen.name}…`;
      refresh();
      const file = { filename: chosen.name, mimeType: chosen.type || "application/octet-stream", base64: base64Of(await chosen.arrayBuffer()) };
      const answer = await send({ type: "resume/upload", file });
      await attach(answer, "WorkIt couldn't upload the resume. Try again.", answer?.already ? "You uploaded this resume before, so WorkIt used that one. " : "");
    });
    frame()?.append(input);
    input.click();
  }

  /** The form's résumé field: the planned answer that attaches the file now attached, else the file field named for one. */
  function resumeField() {
    if (!fixes) return null;
    const name = state?.attached?.name;
    const planned = name ? Object.keys(fixes.answers).find((n) => fixes.answers[n]?.file === name) : null;
    return planned ?? fixes.questions.find((q) => q.kind === "file" && RESUME.test(q.label ?? ""))?.name ?? null;
  }

  /** A chosen or uploaded résumé's file (the background's answer) into the form's résumé field. */
  async function attach(answer, failed, before = "") {
    if (!answer?.ok || answer.error || !answer.file) {
      said = answer?.error ?? failed;
      return draw();
    }
    const file = answer.file;
    const field = resumeField();
    if (!fixes) said = `Saved. WorkIt attaches ${file.filename} when it fills this page.`;
    else if (!field) said = `Saved. This form has no resume field to attach ${file.filename} to.`;
    else {
      fixes.answers[field] = { file: file.filename, type: file.mimeType, base64: file.base64 };
      const result = await fixes.put(field);
      window.WIA.status?.setStatus(field, result.status, result.reason, result.shows, "profile");
      said = result.status === "filled" ? `Attached ${file.filename}.` : `Saved, but WorkIt couldn't attach it. Attach ${file.filename} yourself.`;
    }
    said = before + said;
    await draw();
  }

  function closeDialog() {
    dialog?.remove();
    dialog = null;
  }

  /** Choose a Resume: the student's résumés in a dialog over the panel, the attached one marked. */
  function openDialog() {
    closeDialog();
    const place = frame();
    if (!place || !state) return;
    const backdrop = el("div", "resume-dialog-backdrop");
    const box = el("div", "resume-dialog");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Choose a Resume");
    const close = el("button");
    close.type = "button";
    close.dataset.close = "";
    close.setAttribute("aria-label", "Close");
    close.innerHTML = CLOSE;
    close.addEventListener("click", closeDialog);
    const head = el("div", "dialog-head");
    head.append(el("h2", null, "Choose a Resume"), close);
    const list = el("ul", "options");
    for (const option of [...(state.attached ? [{ ...state.attached, current: true }] : []), ...state.others]) {
      const item = el("li");
      const row = el("button", "resume-option");
      row.type = "button";
      const text = el("span", "option-text");
      text.append(el("span", "option-name", option.name));
      if (KINDS[option.kind]) text.append(el("span", "option-kind", KINDS[option.kind]));
      row.append(text);
      if (option.current) {
        row.setAttribute("aria-current", "true");
        row.append(el("span", "option-state", "Attached"));
        row.addEventListener("click", closeDialog);
      } else row.addEventListener("click", window.WIA.ui.trusted(() => use(option)));
      item.append(row);
      list.append(item);
    }
    const upload = el("button", null, "Upload a New Resume");
    upload.type = "button";
    upload.dataset.upload = "";
    upload.addEventListener("click", window.WIA.ui.trusted(pickFile));
    box.append(head, list, upload);
    backdrop.append(box);
    backdrop.addEventListener("click", (event) => event.target === backdrop && closeDialog());
    backdrop.addEventListener("keydown", (event) => event.key === "Escape" && closeDialog());
    place.append(backdrop);
    dialog = backdrop;
    (list.querySelector("button:not([aria-current])") ?? close).focus();
  }

  /** The opened Resume/CV row's card (overlay.js), or null for any other row. */
  function card(field) {
    if (!isResume(field)) return null;
    const { make, line } = window.WIA.rowCard;
    if (!state) return make({ className: "resume-card", lines: [{ text: "Sign in to WorkIt to change the resume here.", kind: "meta" }] });
    const lines = [];
    const slot = [];
    let buttons;
    if (state.attached) {
      lines.push({ text: KINDS[state.attached.kind] ? `Attached · ${KINDS[state.attached.kind]}` : "Attached", kind: "meta" });
      slot.push(el("div", "resume-name", state.attached.name));
      buttons = [
        { label: "Change", data: { change: "" }, onClick: openDialog },
        { label: "Preview", onClick: preview },
      ];
    } else {
      lines.push("No resume attached to this application yet.");
      buttons = [{ label: "Upload Resume", primary: true, data: { upload: "" }, onClick: pickFile }];
      if (state.others.length) buttons.push({ label: "Choose Resume", onClick: openDialog });
    }
    const after = [];
    if (said) {
      const words = line({ text: said, kind: "meta" });
      words.setAttribute("aria-live", "polite");
      after.push(words);
    }
    return make({ className: "resume-card", lines, slot, buttons, after });
  }

  async function draw() {
    const answer = await send({ type: "resume/tab" });
    state = answer?.ok ? answer : null;
    refresh();
  }

  window.WIA.resumeCard = {
    card,
    /** The fill's Plan (content-script.js `fixesOf`): the form's résumé field and how to fill it alone. */
    use(planned) {
      fixes = planned;
      draw();
    },
  };

  panel.onBuilt(() => panel.addCss(CSS));
})();

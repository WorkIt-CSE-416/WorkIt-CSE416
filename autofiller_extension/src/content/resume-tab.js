// The panel's Résumé tab (KAN-399), in the shell's "tab:resume" slot
// (panel.js), from background resume-tab.js:
//
// - The résumé this form gets, by its file name, with Preview (the file
//   opens in a new tab).
// - Its Keyword match against the job, "3 of 5 keywords" with the matched
//   and missing ones, as the backend counts them (only a résumé built in
//   WorkIt has one). A posting's first read spends one of the day's Tailor
//   uses (decision 1064), so it waits for the student's press of Check
//   keyword match (uses 1 Tailor run today); a job read here before shows
//   its match by itself (background resume-tab.js keywordsFor).
// - Tailor for this job: WorkIt's Tailor page for the job, in a new tab.
// - The student's other résumés (uploaded, base, tailored for this job),
//   each with Use this: the choice is kept for the tab and saved for the
//   application, and the new file goes into the form's résumé field in
//   place, through the Fill engine's file fill (the same fill-one-field the
//   failed card's Try again uses, content-script.js `fixesOf`).
//
// Loaded after panel.js by the static launcher and by every fill; the first
// copy draws. Each fill hands its Plan over with `use(fixes)`.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  if (window.WIA.resumeTab) return;
  const panel = window.WIA.panel;
  if (!panel) return;
  const { send } = window.WIA.ui;

  const CSS = `
    .resume {
      display: flex; flex-direction: column; gap: 12px; padding: 12px; margin: 8px 0;
      background: var(--color-panel); border: 1px solid var(--color-border); border-radius: var(--radius-card);
    }
    .resume section { display: flex; flex-direction: column; gap: 6px; }
    .resume .label { font-size: var(--text-note); font-weight: 600; color: var(--color-ink-meta); }
    .resume .attached { flex-direction: row; align-items: center; gap: 8px; }
    .resume .attached .file { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .resume .resume-name { font-weight: 700; color: var(--color-ink); overflow-wrap: anywhere; }
    .resume .kind, .resume .option-kind { font-size: var(--text-note); color: var(--color-ink-meta); }
    .resume button {
      all: unset; cursor: pointer; box-sizing: border-box; padding: 4px 10px; border-radius: var(--radius-control);
      border: 1px solid var(--color-border-control); background: var(--color-panel); color: var(--color-ink);
      font-size: var(--text-note); font-weight: 600; white-space: nowrap;
    }
    .resume button:hover { background: var(--color-hover); }
    .resume button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }
    .resume button[disabled] { cursor: default; color: var(--color-ink-subtle); }
    .resume .keywords .count { font-weight: 700; color: var(--color-ink); }
    .resume .keywords ul { all: unset; display: flex; flex-wrap: wrap; gap: 4px; }
    .resume .keywords li {
      list-style: none; padding: 1px 8px; border-radius: var(--radius-control); font-size: var(--text-note);
      background: var(--color-well); color: var(--color-ink-muted);
    }
    .resume .keywords .matched li { background: var(--color-positive-tint); color: var(--color-positive-ink); }
    .resume .keywords p { margin: 0; font-size: var(--text-note); color: var(--color-ink-muted); }
    .resume .tailor { align-self: flex-start; }
    .resume .options { all: unset; display: flex; flex-direction: column; gap: 6px; }
    .resume .resume-option { list-style: none; display: flex; align-items: center; gap: 8px; }
    .resume .resume-option .option-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .resume .option-name { color: var(--color-ink); overflow-wrap: anywhere; }
    .resume .said { margin: 0; font-size: var(--text-note); color: var(--color-ink-muted); }
    .resume .said:empty { display: none; }
  `;

  const KINDS = { uploaded: "Uploaded file", built: "Built in WorkIt", tailored: "Tailored for this job" };

  const { el, button } = window.WIA.ui;

  let fixes = null; // the fill's Plan (content-script.js), once the form is filled
  let state = null; // resume/tab's answer
  let said = "";
  const matches = new Map(); // Keyword match by résumé key, once read
  let body = null;

  const bytes = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

  async function preview() {
    const answer = await send({ type: "resume/file" });
    if (!answer?.file) {
      said = "WorkIt couldn't open the résumé. Try again.";
      return draw();
    }
    const url = URL.createObjectURL(new Blob([bytes(answer.file.base64)], { type: answer.file.mimeType }));
    window.open(url, "_blank");
  }

  /** The form's résumé field: the planned answer that attaches the file now attached. */
  function resumeField() {
    const name = state?.attached?.name;
    if (!fixes || !name) return null;
    return Object.keys(fixes.answers).find((n) => fixes.answers[n]?.file === name) ?? null;
  }

  async function use(option, pressed) {
    pressed.disabled = true;
    said = `Switching to ${option.name}…`;
    paint();
    const answer = await send({ type: "resume/choose", key: option.key });
    if (!answer?.ok || answer.error || !answer.file) {
      said = answer?.error ?? "WorkIt couldn't switch the résumé. Try again.";
      return draw();
    }
    const file = answer.file;
    const field = resumeField();
    if (!fixes) said = `Saved. WorkIt attaches ${file.filename} when it fills this page.`;
    else if (!field) said = `Saved. This form has no résumé field to attach ${file.filename} to.`;
    else {
      fixes.answers[field] = { file: file.filename, type: file.mimeType, base64: file.base64 };
      const result = await fixes.put(field);
      said = result.status === "filled" ? `Attached ${file.filename}.` : `Saved, but WorkIt couldn't attach it. Attach ${file.filename} yourself.`;
    }
    await draw();
  }

  function keywordsSection() {
    const section = el("section", "keywords");
    const attached = state.attached;
    if (!attached) return section;
    if (attached.kind !== "built" && attached.kind !== "tailored") {
      section.textContent = `Keyword match is for résumés built in WorkIt.${state.jobId ? " Tailor one for this job." : ""}`;
      return section;
    }
    if (!state.jobId) {
      section.textContent = "Keyword match needs this job in WorkIt.";
      return section;
    }
    const match = matches.get(attached.key);
    if (!match) {
      section.append(el("p", null, "Reading this job's keywords…"));
      return section;
    }
    if (match.unread) {
      section.append(button("Check keyword match (uses 1 Tailor run today)", () => readKeywords(true)));
      return section;
    }
    if (match.error) {
      section.append(el("p", null, match.error));
      section.append(button("Try again", () => {
        matches.delete(attached.key);
        paint();
      }));
      return section;
    }
    const total = match.matched.length + match.missing.length;
    section.append(el("div", "label", "Keyword match"), el("div", "count", `${match.matched.length} of ${total} keywords`));
    for (const [kind, words, title] of [["matched", match.matched, "On your résumé"], ["missing", match.missing, "Missing"]]) {
      if (!words.length) continue;
      const list = el("ul", kind);
      for (const word of words) list.append(el("li", null, word));
      section.append(el("div", "label", title), list);
    }
    return section;
  }

  /**
   * Reads the attached built résumé's Keyword match once the tab shows, if
   * this job's keywords were read before (no Tailor use spent); else the
   * match waits for Check keyword match (`spend`).
   */
  function readKeywords(spend = false) {
    const attached = state?.attached;
    if (!attached || body.hidden || !state.jobId) return;
    if (matches.has(attached.key) && !(spend && matches.get(attached.key)?.unread)) return;
    if (attached.kind !== "built" && attached.kind !== "tailored") return;
    matches.set(attached.key, null);
    if (spend) paint();
    send({ type: "resume/keywords", key: attached.key, spend }).then((answer) => {
      matches.set(attached.key, answer?.ok && answer.unread
        ? { unread: true }
        : answer?.ok && !answer.error && answer.matched
          ? { matched: answer.matched, missing: answer.missing }
          : { error: answer?.error ?? "WorkIt couldn't read this job's keywords. Try again." });
      paint();
    });
  }

  function paint() {
    if (!body) return;
    const root = el("div", "resume");
    if (!state) {
      root.append(el("p", "said", "Sign in to WorkIt to see your résumé here."));
      body.replaceChildren(root);
      return;
    }
    const attached = el("section", "attached");
    const file = el("div", "file");
    if (state.attached) {
      file.append(el("div", "label", "Attached"), el("div", "resume-name", state.attached.name));
      if (KINDS[state.attached.kind]) file.append(el("div", "kind", KINDS[state.attached.kind]));
      attached.append(file, button("Preview", preview));
    } else {
      file.append(el("div", "label", "Attached"), el("div", "kind", "No résumé yet. Add one on WorkIt's Resumes page."));
      attached.append(file);
    }
    root.append(attached, keywordsSection());
    if (state.jobId) {
      const tailor = button("Tailor for this job", async () => {
        const answer = await send({ type: "resume/tailor" });
        if (!answer?.ok || answer.error) {
          said = answer?.error ?? "WorkIt couldn't open Tailor. Try again.";
          paint();
        }
      });
      tailor.classList.add("tailor");
      root.append(tailor);
    }
    if (state.others.length) {
      const section = el("section", "switch");
      const list = el("ul", "options");
      for (const option of state.others) {
        const row = el("li", "resume-option");
        const text = el("div", "option-text");
        text.append(el("span", "option-name", option.name));
        if (KINDS[option.kind]) text.append(el("span", "option-kind", KINDS[option.kind]));
        const pick = button("Use this", () => use(option, pick));
        row.append(text, pick);
        list.append(row);
      }
      section.append(el("div", "label", "Switch résumé"), list);
      root.append(section);
    }
    const line = el("p", "said", said);
    line.setAttribute("aria-live", "polite");
    root.append(line);
    body.replaceChildren(root);
    readKeywords();
  }

  async function draw() {
    const answer = await send({ type: "resume/tab" });
    state = answer?.ok ? answer : null;
    paint();
  }

  window.WIA.resumeTab = {
    /** The fill's Plan (content-script.js `fixesOf`): the form's résumé field and how to fill it alone. */
    use(planned) {
      fixes = planned;
      if (body) draw();
    },
  };

  panel.onBuilt(() => {
    panel.addCss(CSS);
    body = panel.slot("tab:resume");
    // Its Keyword match is read the first time the tab shows.
    new MutationObserver(() => readKeywords()).observe(body, { attributes: true, attributeFilter: ["hidden"] });
    draw();
  });
})();

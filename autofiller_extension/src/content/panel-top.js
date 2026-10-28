// The panel's top (KAN-395), in the shell's slots (panel.js):
//
// - "batch-line": in a batch tab, "Batch · 3 of 5 ready · Next tab →"
//   (Next tab goes to the batch's next other tab that needs the student),
//   kept up to date as the batch's tabs change; on Workday, a line with the
//   step shown, "Step 3 of 6 · My Experience", read off Workday's step bar.
// - "job-card": the tab's job, trimmed (logo when known, title, then company, place and pay on one line)
//   with its Match score as a ring and its band, and "You applied on Oct 25"
//   when WorkIt has the application as applied (background panel-top.js).
//
// Loaded after panel.js by the static launcher and by every fill; the first
// copy draws, once the shell exists.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  if (window.WIA.panelTop) return;
  window.WIA.panelTop = {};
  const panel = window.WIA.panel;
  if (!panel) return;
  const { send } = window.WIA.ui;

  const CSS = `
    [data-slot="batch-line"] { display: flex; flex-direction: column; gap: 2px; }
    [data-slot="batch-line"] .line { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
    [data-slot="batch-line"] button {
      all: unset; cursor: pointer; font-weight: 600; color: var(--color-ink); border-radius: var(--radius-control); padding: 0 2px;
    }
    [data-slot="batch-line"] button:hover { text-decoration: underline; }
    [data-slot="batch-line"] button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }
    [data-slot="batch-line"] .step { color: var(--color-ink-muted); }
    /* The job card, trimmed (KAN-424): no box of its own and no letter square, since the page already names
     * the job. The title, then the company and its place and pay on one line, and the Match score small. */
    [data-slot="job-card"] .job { display: flex; align-items: center; gap: 8px; }
    [data-slot="job-card"] .job-logo { flex: none; width: 24px; height: 24px; border-radius: 6px; object-fit: contain; }
    [data-slot="job-card"] .job-text { flex: 1; min-width: 0; }
    [data-slot="job-card"] .job-title { font-size: var(--text-label); line-height: var(--text-label--line-height); font-weight: 600; color: var(--color-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    [data-slot="job-card"] .job-line { font-size: var(--text-note); color: var(--color-ink-meta); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    [data-slot="job-card"] .job-company { color: var(--color-ink-muted); font-weight: 500; }
    [data-slot="job-card"] .track { margin-top: 6px; }
    [data-slot="job-card"] .track[hidden] { display: none; }
    [data-slot="job-card"] .track-button {
      all: unset; box-sizing: border-box; cursor: pointer; padding: 4px 10px; border-radius: var(--radius-control);
      border: 1px solid var(--color-border-subtle); background: var(--color-panel); color: var(--color-ink);
      font-size: var(--text-note); font-weight: 600;
    }
    [data-slot="job-card"] .track-button:hover { background: var(--color-hover); }
    [data-slot="job-card"] .track-button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
    [data-slot="job-card"] .track-button[disabled] { cursor: default; opacity: 0.6; }
    [data-slot="job-card"] .track-said { font-size: var(--text-note); color: var(--color-ink-meta); }
    [data-slot="job-card"] .track-said.error { color: var(--color-danger); }
    [data-slot="job-card"] .applied { margin-top: 4px; font-size: var(--text-note); font-weight: 600; color: var(--color-positive-ink); }
    [data-slot="job-card"] .match { flex: none; display: flex; align-items: center; gap: 6px; }
    [data-slot="job-card"] .ring { position: relative; width: 32px; height: 32px; }
    [data-slot="job-card"] .ring svg { width: 32px; height: 32px; transform: rotate(-90deg); display: block; }
    [data-slot="job-card"] .ring .track { stroke: var(--color-border); }
    [data-slot="job-card"] .ring .arc { stroke: var(--color-brand); }
    [data-slot="job-card"] .ring .score {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; color: var(--color-ink);
    }
    [data-slot="job-card"] .band { font-size: var(--text-note); line-height: var(--text-note--line-height); color: var(--color-ink-muted); max-width: 52px; }
  `;

  // The Match score's bands, by their lowest score (frontend/src/lib/match.ts; GLOSSARY.md).
  const BANDS = [
    [90, "Excellent Match"],
    [80, "Strong Match"],
    [65, "Good Match"],
    [0, "Weak Match"],
  ];
  const bandOf = (score) => BANDS.find(([min]) => score >= min)[1];
  const PER = { hour: "an hour", week: "a week", month: "a month", year: "a year" };

  const { el } = window.WIA.ui;

  /** "$45–$55 an hour", "$120k a year", "EUR 50k": the posting's pay as it states it. */
  function payText({ min, max, currency, period }) {
    const amount = (n) => {
      const short = n >= 1000 ? `${Math.round(n / 100) / 10}k`.replace(".0k", "k") : String(Math.round(n * 100) / 100);
      return !currency || currency === "USD" ? `$${short}` : `${currency} ${short}`;
    };
    const range = min !== null && max !== null && min !== max ? `${amount(min)}–${amount(max)}` : amount(min ?? max);
    return PER[period] ? `${range} ${PER[period]}` : range;
  }

  /** "Oct 25", in the student's own time zone. */
  const dayOf = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  function ring(score) {
    const box = el("div", "match");
    box.setAttribute("aria-label", `Match score ${score}, ${bandOf(score)}`);
    const shape = el("div", "ring");
    const length = 2 * Math.PI * 19;
    shape.innerHTML = `<svg viewBox="0 0 44 44" aria-hidden="true"><circle class="track" cx="22" cy="22" r="19" fill="none" stroke-width="4"/><circle class="arc" cx="22" cy="22" r="19" fill="none" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(length * Math.max(0, Math.min(score, 100))) / 100} ${length}"/></svg>`;
    shape.append(el("span", "score", String(score)));
    box.append(shape, el("div", "band", bandOf(score)));
    return box;
  }

  /** The job card, from the background's panel/job (nothing drawn when no job is named). */
  async function drawJob() {
    const answer = await send({ type: "panel/job" });
    const job = answer?.job;
    const place = panel.slot("job-card");
    if (!place) return;
    if (!job || !(job.title || job.company)) {
      // No job to name: the slot holds only Track on WorkIt, shown when the background says this job is listed.
      place.replaceChildren(trackLine(place));
      return;
    }
    const row = el("div", "job");
    if (job.logo) {
      const logo = el("img", "job-logo");
      logo.alt = "";
      logo.src = job.logo;
      // A logo the page won't load (its own image rules) goes: the company's name is beside it.
      logo.addEventListener("error", () => logo.remove(), { once: true });
      row.append(logo);
    }
    const text = el("div", "job-text");
    if (job.title) text.append(el("div", "job-title", job.title));
    const meta = [job.location, job.pay && payText(job.pay)].filter(Boolean).join(" · ");
    if (job.company || meta) {
      const line = el("div", "job-line");
      if (job.company) line.append(el("span", "job-company", job.company));
      if (meta) line.append(`${job.company ? " · " : ""}${meta}`);
      text.append(line);
    }
    row.append(text);
    if (typeof job.match === "number") row.append(ring(job.match));
    const parts = [row];
    if (job.appliedAt) parts.push(el("div", "applied", `You applied on ${dayOf(job.appliedAt)}`));
    else parts.push(trackLine(place));
    place.replaceChildren(...parts);
    place.hidden = false;
  }

  /**
   * Track on WorkIt (KAN-424, background/track.js), under the job card of a
   * form the student opened themselves whose job WorkIt lists: the button
   * saves it to their Applications and has their submit here mark it
   * Applied. Tracked, a line says so; once marked, that it was. A batch tab
   * (batch apply tracks it), a job WorkIt doesn't list, or a signed-out
   * student shows nothing.
   */
  function trackLine(place) {
    const box = el("div", "track");
    box.hidden = true;
    const show = (state) => {
      // A slot that holds nothing else shows with the line.
      if (state === "tracked" || state === "applied" || state === "trackable") place.hidden = false;
      if (state === "tracked") box.replaceChildren(el("div", "track-said", "Tracked on WorkIt. Your submit here marks it Applied."));
      else if (state === "applied") box.replaceChildren(el("div", "applied", "Marked Applied on WorkIt."));
      else if (state === "trackable") {
        const button = el("button", "track-button", "Track on WorkIt");
        button.type = "button";
        button.title = "Save this job to your Applications, and mark it Applied when you submit";
        button.addEventListener(
          "click",
          window.WIA.ui.trusted(async () => {
            button.disabled = true;
            const answer = await send({ type: "track/start" }).catch(() => null);
            if (answer?.state) return show(answer.state);
            button.disabled = false;
            box.append(el("div", "track-said error", "WorkIt couldn't track this job. Try again."));
          }),
        );
        box.replaceChildren(button);
      } else return (box.hidden = true);
      box.hidden = false;
    };
    send({ type: "track/state" })
      .then((answer) => show(answer?.state))
      .catch(() => {});
    return box;
  }

  window.WIA.panelTop.refresh = () => void drawJob();

  // The batch line's parts: the batch's (from the background) and Workday's step (from the page).
  let batch = null;
  let step = "";

  function paintLine() {
    const place = panel.slot("batch-line");
    if (!place) return;
    const lines = [];
    if (batch) {
      const line = el("div", "line", `Batch · ${batch.ready} of ${batch.total} ready`);
      if (batch.next) {
        const next = el("button", "", "Next tab →");
        next.type = "button";
        next.addEventListener("click", window.WIA.ui.trusted(() => send({ type: "panel/next-tab" })));
        line.append(" · ", next);
      }
      lines.push(line);
    }
    if (step) lines.push(el("div", "line step", step));
    place.replaceChildren(...lines);
    place.hidden = !lines.length;
  }

  async function refreshBatch() {
    const answer = await send({ type: "panel/batch-line" });
    batch = answer?.line ?? null;
    paintLine();
    return answer;
  }

  /** "Step 3 of 6 · My Experience", from Workday's step bar ("" when it shows none). */
  function workdayStep() {
    const bar = document.querySelector("[data-automation-id=progressBarActiveStep]");
    const lines = (bar?.innerText ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    const count = lines.map((l) => /step (\d+) of (\d+)/i.exec(l)).find(Boolean);
    if (!count) return "";
    const name = lines[lines.length - 1].replace(/^(current )?step \d+ of \d+\s*/i, "");
    return `Step ${count[1]} of ${count[2]}${name ? ` · ${name}` : ""}`;
  }

  /** Keeps the step line up with Workday's steps, which load in the same page. */
  function watchWorkday() {
    let timer = null;
    const read = () => {
      timer = null;
      const now = workdayStep();
      if (now === step) return;
      step = now;
      paintLine();
    };
    read();
    new MutationObserver(() => {
      timer ??= setTimeout(read, 250);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  panel.onBuilt(() => {
    panel.addCss(CSS);
    void drawJob();
    void refreshBatch().then((answer) => {
      if (answer?.site === "workday") watchWorkday();
    });
    // A batch tab's state changes as its tabs fill and the student answers (batch-store.js keeps it here).
    chrome.storage?.onChanged?.addListener?.((changes, area) => {
      if (area === "local" && changes.workit_batch) void refreshBatch();
    });
  });
})();

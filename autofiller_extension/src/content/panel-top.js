// The panel's top (KAN-395), in the shell's slots (panel.js):
//
// - "batch-line": in a batch tab, "Batch · 3 of 5 ready · Next tab →"
//   (Next tab goes to the batch's next other tab that needs the student),
//   kept up to date as the batch's tabs change; on Workday, a line with the
//   step shown, "Step 3 of 6 · My Experience", read off Workday's step bar.
// - "job-card": the tab's job (logo, title, company, place, pay when known)
//   with its Match score as a ring and its band, and "You applied on Oct 25"
//   when WorkIt has the application as applied (background panel-top.js).
//
// Loaded after panel.js by the static launcher and by every fill; the first
// copy draws, once the shell exists.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  if (window.WIA.panelTop) return;
  window.WIA.panelTop = true;
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
    [data-slot="job-card"] .job { display: flex; align-items: flex-start; gap: 10px; }
    [data-slot="job-card"] .job-logo, [data-slot="job-card"] .job-initial {
      flex: none; width: 40px; height: 40px; border-radius: var(--radius-control); border: 1px solid var(--color-border);
      object-fit: contain; background: var(--color-panel); box-sizing: border-box;
    }
    [data-slot="job-card"] .job-initial {
      display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: var(--text-body); color: var(--color-ink-meta); background: var(--color-well);
    }
    [data-slot="job-card"] .job-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    [data-slot="job-card"] .job-title { font-size: var(--text-body); line-height: var(--text-body--line-height); font-weight: 700; color: var(--color-ink); }
    [data-slot="job-card"] .job-company { font-weight: 600; color: var(--color-ink-muted); }
    [data-slot="job-card"] .job-meta { font-size: var(--text-note); color: var(--color-ink-meta); }
    [data-slot="job-card"] .applied { margin-top: 8px; font-size: var(--text-note); font-weight: 600; color: var(--color-positive-ink); }
    [data-slot="job-card"] .match { flex: none; display: flex; flex-direction: column; align-items: center; gap: 2px; width: 64px; }
    [data-slot="job-card"] .ring { position: relative; width: 44px; height: 44px; }
    [data-slot="job-card"] .ring svg { width: 44px; height: 44px; transform: rotate(-90deg); display: block; }
    [data-slot="job-card"] .ring .track { stroke: var(--color-border); }
    [data-slot="job-card"] .ring .arc { stroke: var(--color-brand); }
    [data-slot="job-card"] .ring .score {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: var(--text-note); color: var(--color-ink);
    }
    [data-slot="job-card"] .band { font-size: var(--text-note); line-height: var(--text-note--line-height); color: var(--color-ink-muted); text-align: center; }
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
    if (!place || !job || !(job.title || job.company)) return;
    const row = el("div", "job");
    const initial = el("div", "job-initial", (job.company || job.title).trim().charAt(0).toUpperCase());
    initial.setAttribute("aria-hidden", "true");
    if (job.logo) {
      const logo = el("img", "job-logo");
      logo.alt = "";
      logo.src = job.logo;
      // A logo the page won't load (its own image rules) leaves the company's first letter.
      logo.addEventListener("error", () => logo.replaceWith(initial), { once: true });
      row.append(logo);
    } else {
      row.append(initial);
    }
    const text = el("div", "job-text");
    if (job.title) text.append(el("div", "job-title", job.title));
    if (job.company) text.append(el("div", "job-company", job.company));
    const meta = [job.location, job.pay && payText(job.pay)].filter(Boolean).join(" · ");
    if (meta) text.append(el("div", "job-meta", meta));
    row.append(text);
    if (typeof job.match === "number") row.append(ring(job.match));
    const parts = [row];
    if (job.appliedAt) parts.push(el("div", "applied", `You applied on ${dayOf(job.appliedAt)}`));
    place.replaceChildren(...parts);
    place.hidden = false;
  }

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
        next.addEventListener("click", () => send({ type: "panel/next-tab" }));
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

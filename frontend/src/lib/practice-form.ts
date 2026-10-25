/**
 * THE PRACTICE FORMS (KAN-378): two made-up job postings whose application
 * forms WorkIt hosts itself, at /practice/<company>/<job>/apply
 * (app/practice/[company]/[job]/[page]/route.ts). Onboarding's last step runs
 * a practice batch on them, so a new student sees batch apply's whole flow
 * (tabs filling, the Ready and Needs you groups, review, their own Submit)
 * before a real job posting.
 *
 * THEY LOOK LIKE A HIRING SYSTEM, NOT LIKE WORKIT: a company's logo and
 * posting over a plain form, in the system font, as the forms the student
 * will meet are. The markup follows Lever's hosted form (an
 * `application-question` block per field, the custom questions as a card
 * template), so the extension fills it with the Fill engine's own Lever
 * Filler and nothing practice-only runs in the engine
 * (autofiller_extension/src/background/engine.js, `practiceJob`).
 *
 * SUBMIT SENDS NOTHING, ANYWHERE. The form has no action; its Submit is
 * handled in the page, which checks the required fields and opens the job's
 * /thanks page with no data at all. Not to an employer, and not to WorkIt
 * either. The extension marks the practice job submitted when its tab
 * reaches /thanks.
 *
 * Plain HTML, not a React page, so the extension's end-to-end test
 * (autofiller_extension/test/practice.extension.spec.ts) serves the very
 * page WorkIt serves: this file imports nothing. The colours are WorkIt's
 * tokens (app/globals.css), copied by name into the page's own :root, since
 * the page loads no app stylesheet; change both together.
 */

/** One custom question, as a Lever card template holds it. */
type CardField =
  | { type: "text" | "textarea"; text: string; required: boolean }
  | { type: "multiple-choice"; text: string; required: boolean; options: { text: string }[] };

export type PracticeJob = {
  /** The company's slug in the form's link. */
  company: string;
  /** The job's id in the form's link (a UUID, as a hiring system's). */
  id: string;
  companyName: string;
  title: string;
  place: string;
  team: string;
  about: string[];
  /** The posting's own questions, after the standard ones. */
  card: { id: string; fields: CardField[] };
};

const YES_NO = [{ text: "Yes" }, { text: "No" }];

/**
 * The practice batch's postings, in the order their tabs open. The first
 * asks only what a profile answers, so it lands in Ready; the second asks
 * for a written answer, which a batch leaves to the student, so it lands in
 * Needs you.
 */
export const PRACTICE_JOBS: readonly PracticeJob[] = [
  {
    company: "harbor-robotics",
    id: "6f1c2a9e-3b7d-4c51-9e2a-0d8b5f4a7c13",
    companyName: "Harbor Robotics",
    title: "Software Engineering Intern, Summer 2027",
    place: "Boston, MA",
    team: "Engineering",
    about: [
      "Harbor Robotics builds the software that steers autonomous boats around busy harbors. Interns join a product team for twelve weeks and ship code that runs on the fleet.",
      "You will write and test services in Python and TypeScript, review code with your mentor, and present your project to the company at the end of the summer.",
    ],
    card: {
      id: "2c9d4e7a-8f13-4b6e-a5d0-71e3c8b29f46",
      fields: [
        {
          type: "multiple-choice",
          text: "Are you legally authorized to work in the United States?",
          required: true,
          options: YES_NO,
        },
        {
          type: "multiple-choice",
          text: "Will you now or in the future require sponsorship for employment visa status?",
          required: true,
          options: YES_NO,
        },
      ],
    },
  },
  {
    company: "lumen-health",
    id: "b84e0d27-5a6c-4f39-8d1e-3c7a92f6e015",
    companyName: "Lumen Health",
    title: "Data Engineering Intern",
    place: "Remote (US)",
    team: "Data Platform",
    about: [
      "Lumen Health helps clinics see which patients need a follow-up call. The data platform team moves millions of visit records a day into the models and dashboards clinics use.",
      "As an intern you will build and monitor data pipelines, write SQL and Python, and learn how health data is kept private.",
    ],
    card: {
      id: "e6a13f58-0c4d-4e92-b7a5-9d2f60c8314b",
      fields: [
        {
          type: "multiple-choice",
          text: "Are you legally authorized to work in the United States?",
          required: true,
          options: YES_NO,
        },
        { type: "textarea", text: "Why do you want to intern at Lumen Health?", required: true },
      ],
    },
  },
];

/** The link of a practice job's application form, under `origin` (WorkIt's own). */
export function practiceFormUrl(origin: string, job: PracticeJob): string {
  return `${origin}/practice/${job.company}/${job.id}/apply`;
}

/** The practice page at `company`/`id`/`page` ("apply" or "thanks"), or null when there is none. */
export function practicePage(company: string, id: string, page: string): string | null {
  const job = PRACTICE_JOBS.find((j) => j.company === company && j.id === id);
  if (!job) return null;
  if (page === "apply") return applyPage(job);
  if (page === "thanks") return thanksPage(job);
  return null;
}

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "#39" }[c]};`,
  );

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2);

/** WorkIt's tokens (app/globals.css), named as there, for the page's own styles. */
const TOKENS = `
  --color-ink: #121a28;
  --color-ink-muted: #3b3e46;
  --color-ink-meta: #596980;
  --color-panel: #ffffff;
  --color-canvas: #f5f5f5;
  --color-well: #f7f7f7;
  --color-border: #e3e9f0;
  --color-border-control: #8a8f9a;
  --color-positive-ink: #107a52;
  --color-danger: #c02a3d;
  --color-warning: #8a5a00;
  --color-warning-tint: #fdf0d9;
  --radius-control: 0.5rem;`;

const STYLES = `
  :root {${TOKENS}
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--color-panel); color: var(--color-ink); font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .practice-notice { background: var(--color-warning-tint); color: var(--color-warning); font-size: 13px; text-align: center; padding: 8px 16px; }
  .main-header { border-bottom: 1px solid var(--color-border); }
  .main-header .content, .content { max-width: 760px; margin: 0 auto; padding: 0 24px; }
  .main-header .content { display: flex; align-items: center; gap: 12px; height: 72px; font-weight: 600; font-size: 18px; }
  .logo { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: var(--radius-control); background: var(--color-ink); color: var(--color-panel); font-size: 15px; letter-spacing: 0.04em; }
  .posting-header { padding: 40px 0 24px; border-bottom: 1px solid var(--color-border); }
  .posting-header h2 { margin: 0 0 6px; font-size: 30px; line-height: 1.25; }
  .posting-categories { color: var(--color-ink-meta); font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; }
  .section { padding: 24px 0; color: var(--color-ink-muted); }
  h4 { margin: 32px 0 12px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-ink-meta); }
  ul.questions { list-style: none; margin: 0; padding: 0; }
  .application-question { display: flex; gap: 24px; padding: 10px 0; }
  .application-question > label, .application-question > .card-question { display: flex; flex-wrap: wrap; gap: 8px 24px; width: 100%; }
  .application-label { width: 220px; flex-shrink: 0; font-size: 15px; padding-top: 8px; }
  .required { color: var(--color-danger); margin-left: 4px; }
  .application-field { flex: 1; min-width: 240px; }
  input[type=text], input[type=email], input[type=tel], textarea { width: 100%; font: inherit; color: inherit; padding: 8px 12px; border: 1px solid var(--color-border-control); border-radius: var(--radius-control); background: var(--color-panel); }
  textarea { min-height: 140px; resize: vertical; }
  .choice { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
  .resume-upload-success { display: block; margin-top: 6px; color: var(--color-positive-ink); font-size: 14px; }
  .resume-upload-success[hidden] { display: none; }
  .submit { margin: 32px 0 64px; }
  .submit button { font: inherit; font-weight: 600; color: var(--color-panel); background: var(--color-ink); border: 0; border-radius: var(--radius-control); padding: 12px 28px; cursor: pointer; }
  .thanks { padding: 64px 0; }
  .thanks h2 { font-size: 28px; margin: 0 0 12px; }
  .thanks p { color: var(--color-ink-muted); }
  @media (max-width: 640px) { .application-label { width: 100%; padding-top: 0; } }
`;

const NOTICE = "Practice application hosted by WorkIt. Nothing you send here reaches an employer.";

function frame(job: PracticeJob, title: string, body: string, script = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="practice-notice" role="note">${NOTICE}</div>
<div class="main-header"><div class="content"><span class="logo" aria-hidden="true">${escape(initials(job.companyName))}</span>${escape(job.companyName)}</div></div>
<div class="content">
${body}
</div>
${script}
</body>
</html>`;
}

/** One standard field, as Lever lays it out: the label, then its control. */
function standard(label: string, control: string, required: boolean): string {
  return `<li class="application-question"><label><div class="application-label">${escape(label)}${required ? '<span class="required">✱</span>' : ""}</div><div class="application-field">${control}</div></label></li>`;
}

const text = (name: string, type = "text", required = false, autocomplete = "") =>
  `<input type="${type}" name="${name}"${autocomplete ? ` autocomplete="${autocomplete}"` : ""}${required ? " required" : ""}>`;

/** The posting's own questions: the card template the Filler reads them from, then each one's control. */
function card(job: PracticeJob): string {
  const prefix = `cards[${job.card.id}]`;
  const template = escape(JSON.stringify({ fields: job.card.fields }));
  const questions = job.card.fields.map((field, i) => {
    const name = `${prefix}[field${i}]`;
    const required = field.required ? " required" : "";
    const control =
      field.type === "multiple-choice"
        ? field.options
            .map(
              (o) =>
                `<label class="choice"><input type="radio" name="${name}" value="${escape(o.text)}"${required}>${escape(o.text)}</label>`,
            )
            .join("")
        : field.type === "textarea"
          ? `<textarea name="${name}"${required}></textarea>`
          : `<input type="text" name="${name}"${required}>`;
    return `<li class="application-question custom-question"><div class="card-question"><div class="application-label">${escape(field.text)}${field.required ? '<span class="required">✱</span>' : ""}</div><div class="application-field">${control}</div></div></li>`;
  });
  return `<input type="hidden" name="${prefix}[baseTemplate]" value="${template}">\n<ul class="questions">${questions.join("\n")}</ul>`;
}

// THE PAGE'S OWN SCRIPT. The Fill engine's Lever Filler waits until the page
// says it has started (Lever's jQuery is ready), and for the résumé until the
// page shows it took the file; this page says both, as Lever's does. Submit
// sends nothing: it opens /thanks once the browser's own check of the
// required fields passes.
const SCRIPT = `<script>
  window.jQuery = { isReady: true };
  const form = document.getElementById("application-form");
  const resume = form.elements.resume;
  const took = document.querySelector(".resume-upload-success");
  resume.addEventListener("change", () => {
    const file = resume.files[0];
    took.textContent = file ? "Attached: " + file.name : "";
    took.hidden = !file;
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    location.assign(location.pathname.replace(/\\/apply\\/?$/, "/thanks"));
  });
</script>`;

function applyPage(job: PracticeJob): string {
  const body = `<div class="posting-header">
<h2>${escape(job.title)}</h2>
<div class="posting-categories">${escape(job.place)} / ${escape(job.team)} / Internship</div>
</div>
<div class="section">${job.about.map((p) => `<p>${escape(p)}</p>`).join("\n")}</div>
<form id="application-form">
<h4>Submit Your Application</h4>
<ul class="questions">
${standard("Resume/CV", `<input type="file" name="resume" accept=".pdf,.doc,.docx" required><span class="resume-upload-success" role="status" hidden></span>`, true)}
${standard("Full name", text("name", "text", true, "name"), true)}
${standard("Email", text("email", "email", true, "email"), true)}
${standard("Phone", text("phone", "tel", false, "tel"), false)}
${standard("Current company", text("org", "text", false, "organization"), false)}
</ul>
<h4>Links</h4>
<ul class="questions">
${standard("LinkedIn URL", text("urls[LinkedIn]", "text"), false)}
${standard("GitHub URL", text("urls[GitHub]", "text"), false)}
${standard("Portfolio URL", text("urls[Portfolio]", "text"), false)}
</ul>
<h4>Questions From ${escape(job.companyName)}</h4>
${card(job)}
<div class="submit"><button type="submit">Submit Application</button></div>
</form>`;
  return frame(job, `${job.companyName} - ${job.title}`, body, SCRIPT);
}

function thanksPage(job: PracticeJob): string {
  const body = `<div class="thanks">
<h2>Application submitted</h2>
<p>Thank you for applying to ${escape(job.title)} at ${escape(job.companyName)}.</p>
<p>This was a practice application: nothing was sent to anyone. Go back to WorkIt to carry on.</p>
</div>`;
  return frame(job, `${job.companyName} - Application submitted`, body);
}

claude --resume d2180972-e5d7-437b-a797-fd1cd9f01e44 
# Auto-apply: design

How WorkIt can take a student from "here are your matches" to "your
application is filled in, review it and submit" with as few steps as possible.

> **Status (2026-10-14).** A proposal for KAN-223. It builds on `main` after
> the ATS autofiller (KAN-164, #115) and job matching (KAN-139, #93). Each
> section names the code it depends on, so a reader can check that it is
> still true.
>
> **Decided:** the run happens in the student's own Chrome, through the
> extension. `architecture.md` has the parts, the messages and the build
> order. **Built:** the Match step (4.1). Everything else is a plan.

## Terms

The job terms are the repo's own (root `CLAUDE.md`, Conventions).

| Term | Means |
|---|---|
| **Hiring system** | Software a company uses to collect applications (an ATS): Greenhouse, Lever, Workday |
| **Job posting** | One open job, and its `job_postings` row. `apply_url` is the page on the hiring system where the student applies |
| **Base resume** | A resume the student uploaded, parsed into `resumes.parsed_json` |
| **Tailored resume** | A copy of a base resume, rewritten for one job posting |
| **Application** | One student's intent to apply to one job posting, from "saved" to "applied" and after |
| **Autofill run** | One attempt by the extension to fill one application's form |
| **Queue** | The student's applications that are ready to fill |

---

## 1. Summary

```
 1. Match            2. Tailor               3. Review              4. Fill                 5. Record
 /jobs/recommended → LLM rewrites the     → student reads and    → extension opens        → extension saves
 picks job postings  base resume for one    edits the tailored     apply_url, fills the     the result; the
 the student has     job posting; backend   resume in the          form, attaches the       student clicks the
 not applied to      renders it to PDF      webapp                 tailored PDF             hiring system's Submit
```

Steps 1 and 4 mostly exist. Steps 2, 3 and 5 are new.

**The student always clicks Submit.** The pipeline automates everything up to
that click and nothing after it. Section 9.1 gives the reasons.

## 2. Goals and non-goals

**Goals**

- Find the job postings that fit a student, using the matching that exists.
- Make one tailored resume per job posting, with no invented content.
- Fill the hiring system's form with the student's data and the tailored PDF.
- Track every application, so the Applications screen shows real data.
- Cost $0 per student at the current scale, like Scout.

**Non-goals**

- Submitting an application without the student (section 9.1).
- Solving CAPTCHAs or hiding automation from a hiring system.
- Creating accounts on a hiring system for the student. Workday asks for one
  per company; the student makes it.
- Writing cover letters. The same tailoring step can do it later.

## 3. What exists today

| Piece | State | Where |
|---|---|---|
| Job postings | Scraped and imported every 3 hours, with `apply_url` and a full description | `scraper/`, `backend/app/scripts/import_jobs.py`, `docs/job-pipeline.md` |
| Matching | Scores job postings 0–100 against the default resume, with up to 3 highlights | `GET /jobs/recommended/{applicant_id}` (`backend/app/routers/jobs.py`), `backend/app/services/matching/` |
| Parsed resume | `ParsedResume`: education, experience, skills, projects, certifications. No name or contact details | `backend/app/models/dto.py`, `backend/app/models/resume.py` |
| Resume file | Uploaded PDF in the `Resume` Storage bucket, served by `GET .../resumes/{id}/file` | `backend/app/routers/resumes.py` |
| LLM access | One OpenAI-compatible client; the model is configuration; a daily cap per account | `scout/workit_scout/llm.py`, `settings.py`, `quota.py` |
| Privacy boundary | Maps `parsed_json` to model input without names, contact details or links | `scout/workit_scout/facts.py` |
| Form filling | Chrome extension, started from its popup. Fills text fields, dropdowns and repeated sections. Never submits | `autofiller_extension/` |
| Webapp ↔ extension link | `externally_connectable`. Today it only answers "installed and signed in?" | `frontend/src/lib/autofill-extension.ts` |
| Applications screen | UI only, over a fixture (`data.ts`). Stages Saved, Applied, Interviewing, Offer | `frontend/src/app/(seeker)/applications/`, `frontend/src/app/(seeker)/tracker.ts` |

**Missing:** a tailoring step, a resume renderer (PDF), an `applications`
table, file upload in the extension, and any link from "this job posting" to
"fill its form".

---

## 4. The pipeline, step by step

### 4.1 Match (built)

Use `GET /jobs/recommended/{applicant_id}`. It scores job postings against the
primary resume only. The queue builder adds two rules on top:

- A minimum score: `min_match=60`. Tune it on real data, like the matching
  weights. Built: `fetch_recommended()` in `backend/app/routers/jobs.py`,
  and the route's `?min_match=`.
- Leave out job postings that already have an application for this student.
  Not built: it is a `NOT EXISTS` on `applications`, added once that table
  exists.

The scoring code does not change.

### 4.2 Tailor

A new function takes a base resume and a job posting and returns a tailored
`ParsedResume`.

**Where it lives: `scout/workit_scout/tailor.py`.** Scout is the package for
"the job assistant's brain" and already has the model client, the privacy
mapping and the test fake (`ScriptedLLM`). The rule in `scout/CLAUDE.md` holds:
the package never imports the backend and never touches the database. A
backend service loads the resume and the job posting and hands them in.

**What the model may do:**

- Reorder entries and bullets so the most relevant ones come first.
- Rephrase a bullet with the job posting's words, when the bullet already
  states that fact.
- Cut entries and bullets that do not fit, to keep one page.
- Reorder skills.

**What the model must never do:** add a skill, an employer, a title, a date, a
degree, a number or a technology that the base resume does not state. This is
Scout's grounding rule (`scout/CLAUDE.md`, "Grounding"). Invented skills are
the most common complaint about JobRight.

**Two checks enforce it:**

1. **A structural check in code**, after the model replies. Every skill must
   be in the base resume's skills. Every experience, education, project and
   certification entry must match a base entry by name and title, with the
   same dates. A reply that fails is rejected and the base resume is used.
2. **The student's review** (4.4) covers what code cannot check: whether a
   rephrased bullet still says only what the original said.

**The prompt is one frozen string** in the package, like `prompt.py`, so the
provider can cache the prefix. The resume and the job description go in the
messages after it.

**The output format is JSON** that validates as `ParsedResume`. A reply that
does not validate counts as a failure, same as the structural check.

### 4.3 Render

The tailored `ParsedResume` plus the name and contact details from
`applicant_profiles` become a one-page PDF.

- **In the backend**, because the extension and the webapp both need the
  same file and the API already owns the `Resume` bucket.
- **A pure-Python library** (fpdf2 or ReportLab) with one fixed template.
  Headless Chrome also works but makes the Vercel Function much larger and
  slower to start.
- **The file goes in the `Resume` bucket** under the student's folder, and
  the tailored resume's row stores its `storage_path`. Then the existing
  `GET .../resumes/{id}/file` serves it with no new code.
- **Contact details are added here, after the model step.** They never go to
  the model.

A tailored PDF will not look like the student's own design. The review step
shows the PDF, so the student can choose the base resume file instead.

### 4.4 Review

A webapp screen lists the queue. For each application it shows the job
posting, the match score, and the tailored resume next to the base resume,
with the changed lines marked.

The student can:

- **Approve** the tailored resume.
- **Edit** it. This uses the same editor as My Profile's resume edit
  (`resume-edit-dialog.tsx`), and the backend re-renders the PDF.
- **Use the base resume** instead.
- **Remove** the application from the queue.

This screen is the Auto Apply page (`/auto-apply`, between Jobs and
Applications in the sidebar). It exists, and today it shows only the resume
an application goes out with ("Applying with Resume:"). The queue joins it
there. `frontend/docs/screens.md`, "Auto Apply", has the screen's rules.

### 4.5 Fill

The student clicks **Start Auto Apply** once. The extension's runner then
walks the queue, one application at a time:

1. It loads the next queued application from the API: the job posting's
   `apply_url` and the resume to attach.
2. It opens `apply_url` in the run's own window.
3. It injects the content scripts it already has and runs the field engine.
4. It attaches the PDF to the form's file input (section 6).
5. The overlay shows what was filled, what failed and what was skipped, as
   it does today, with **Submitted** and **Skip**.
6. The student checks the form and clicks the hiring system's own Submit,
   then **Submitted**. The runner opens the next application.

The extension never submits, and never runs on a page the run or the student
did not open. `architecture.md` has the runner's states, its messages, and
how it survives Chrome's limits.

### 4.6 Record

After a fill, the extension saves an autofill run: which fields filled, which
failed, and which resume it attached.

The extension cannot reliably tell that the student submitted. Hiring systems
show different confirmation pages. So the overlay asks "Did you submit this
application?" with **Yes** and **Not yet**. **Yes** moves the application to
Applied and sets `applied_on`. Detecting each hiring system's confirmation
page can come later, one hiring system at a time.

---

## 5. Data model

This is a sketch for the migration's author, not the schema. Alembic is the
source of truth (root `CLAUDE.md`). Read `backend/app/models/CLAUDE.md` and
`backend/alembic/CLAUDE.md` before writing it. Every new table's migration
enables RLS with no policies.

`backend/app/models/CLAUDE.md` already reserves two of these: "applications"
as a later ticket, and "a separate `autofill_runs` table, not a column here"
for autofill state. This design follows both.

### `applications`

One row per student and job posting. It backs the Applications screen too, so
its shape follows `tracker.ts`'s `Application`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | `gen_random_uuid()` |
| `applicant_id` | uuid | FK `applicant_profiles.id`, CASCADE |
| `job_id` | uuid | FK `job_postings.id`. CASCADE or SET NULL is open (11) |
| `stage` | enum | `saved`, `applied`, `interviewing`, `offer`, `rejected`, `withdrawn`. Name equals value (models `CLAUDE.md`, Enums) |
| `resume_id` | uuid null | FK `resumes.id`, SET NULL. The resume to attach: tailored or base |
| `tailor_status` | enum | `none`, `pending`, `ready`, `approved`, `failed` |
| `match` | smallint null | The score when the application was made, so the card does not change later |
| `saved_on` | timestamptz | |
| `applied_on` | timestamptz null | Set when the student says they submitted |

`UNIQUE (applicant_id, job_id)`: one application per job posting.

### `autofill_runs`

One row per fill attempt. A failed run does not change the application.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `application_id` | uuid | FK `applications.id`, CASCADE |
| `hiring_system` | text | Read from the page's host (`greenhouse`, `workday`...) |
| `filled`, `failed`, `skipped` | smallint | Counts from `lib-status.js` |
| `report` | jsonb | The overlay's rows: field label, status, reason. No field values, so no personal data is stored twice |
| `created_at` | timestamptz | |

This data also shows which hiring systems need adapter work.

### `resumes`: one new column

`tailored_from_id uuid null`, FK `resumes.id`, SET NULL. It marks a tailored
resume.

- My Profile's resume list must hide rows where it is not NULL, or each
  application adds a resume to that list.
- A tailored resume is never the default resume and is never embedded for
  matching.
- `raw_text` stays NULL. The resume never existed as uploaded text.

### `autofill_answers`

Already planned in `backend/app/models/CLAUDE.md`, Known gaps: one JSONB bank
of answers per student for the questions hiring systems repeat (work
authorization, sponsorship, start date). Without it, every form stops at those
questions, and the fill rate stays low. Build it before or with this work.

---

## 6. Extension changes

All in `autofiller_extension/`. Its `CLAUDE.md` records "adds no backend
routes or schema". This design reverses that, so update that file in the same
change.

- **The runner and its port** from the Auto Apply page
  (`architecture.md`, sections 3 and 4).
- **Host permissions for hiring systems.** `activeTab` gives access only to
  the tab the student opened the popup on. A tab the extension opens itself
  needs a host permission. The prototype lists the hiring systems' hosts as
  required; the Chrome Web Store version moves them to optional
  (`architecture.md`, section 5.1).
- **File upload.** Fetch the PDF from `GET .../resumes/{id}/file`, make a
  `File`, put it in a `DataTransfer`, set the file input's `files`, and send
  `input` and `change` events. Some hiring systems use a drop zone instead of
  a visible input; Workday is one. Test each hiring system. The sample form
  (`test/sample-form.html`) needs a file input for this.
- **Screening questions** from `autofill_answers`, once that table exists.
- **The "Did you submit?" prompt** in the overlay, and the call that saves
  the autofill run.

The session rules stay as they are: the extension reads the webapp's cookie
and never refreshes it. A run lasts longer than the one-hour token, so the
Auto Apply tab keeps the session fresh (`architecture.md`, section 5.2).

## 7. API changes

New routes follow `backend/app/routers/CLAUDE.md`. Every route checks that
the token's account owns the applicant, like `assert_applicant_owns`.

| Method | Path | Does |
|---|---|---|
| GET | `/applicants/{id}/applications` | The tracker and the queue. Filter by `stage` |
| POST | `/applicants/{id}/applications` | Save a job posting. `{ job_id, tailor: bool }` |
| PATCH | `/applicants/{id}/applications/{app_id}` | Change stage, resume or tailor status |
| DELETE | `/applicants/{id}/applications/{app_id}` | Remove from the queue or tracker |
| POST | `/applicants/{id}/applications/{app_id}/tailor` | Make (or remake) the tailored resume. Counts toward the daily cap |
| POST | `/applicants/{id}/applications/{app_id}/runs` | The extension saves an autofill run |
| POST | `/applicants/{id}/applications/queue` | Start Auto Apply: add the matches at or above `min_match` that have no application yet, as `queued` (section 9.2) |

Editing a tailored resume uses the resume `PUT` that exists. It must
re-render the PDF when the row is a tailored resume.

**Tailoring is slow** (several seconds per model call). The `tailor` route
can answer `202` and set `tailor_status = pending`, and the webapp polls the
application. A Vercel Function can run long enough for one call, so start
with doing the work inside the request, and move to a background step only
if it times out.

---

## 8. Cost, quota and privacy

**Cost.** Tailoring is one model call per application. Production uses
Gemini's free tier, about 500–1,500 requests a day per project
(`scout/CLAUDE.md`, "Which model, where"). Scout uses the same quota, with
`SCOUT_DAILY_TURNS=20` per student.

- Give tailoring its own daily cap per student (start at 10), with the
  `quota.py` pattern.
- 100 active students at 10 a day is 1,000 requests: the top of the free
  quota, before Scout. Watch the quota in AI Studio. Above that, decide
  between a lower cap and a paid tier. Do not decide now.
- Tailor only what a student chose or approved, never every match in a
  batch.

**Privacy.** The rules from `scout/CLAUDE.md` apply. Only parsed resume
fields and the public job description go to the model. Names, email, phone
and links never do; reuse the `facts.py` mapping. The free tier may train on
prompts, which is why this rule exists.

**Storage.** Tailored PDFs hold contact details, like uploads. They go in the
private `Resume` bucket. Deleting an account does not delete Storage objects
yet (`backend/CLAUDE.md`, Auth, Still open). This adds more objects to that
gap.

---

## 9. Decisions

### 9.1 The student clicks Submit — recommended, and assumed above

| Option | Consequence |
|---|---|
| **Student submits (recommended)** | Keeps the rule in `autofiller_extension/CLAUDE.md`. Each application costs the student one review and one click. No wrong application goes out without them seeing it |
| Extension submits | Reverses that rule. Hiring systems use CAPTCHAs and bot detection, so it fails often. Their terms prohibit automated submission. A wrong answer reaches an employer under the student's name, and nobody can undo it |

### 9.2 How "automatic" the queue is

| Level | Consequence |
|---|---|
| 1. Student picks | The student clicks "Add to queue" on a job posting. Lowest cost: only chosen postings are tailored |
| **2. WorkIt queues the matches (chosen)** | Start Auto Apply queues the matches at or above `min_match` that have no application yet. The run fills them one by one, and the student submits each. Tailoring, when built, is per application and counts toward its cap |
| 3. Fully automatic | Ruled out by 9.1 |

### 9.3 Where tailoring runs

| Option | Consequence |
|---|---|
| **On demand, in the API (recommended)** | Costs a model call only for an application the student wants. Fits the free quota |
| Scheduled batch (like `scrape.yml`) | Tailors matches nobody looks at, and uses Scout's quota |

### 9.4 The MCP server (KAN-223's first question)

An MCP server (a tool interface that an AI agent such as Claude can call) can
expose the same routes as tools: list matches, queue, tailor, read runs. It
helps a developer or a power user drive the pipeline from an agent. It does
not replace the extension: only the extension can reach into a hiring
system's page in the student's own browser, signed in as the student.

Recommendation: build the API first. An MCP server is then a thin wrapper
over those routes with no logic of its own, and can come later.

---

## 10. Build order

`architecture.md`, section 8, has the order for the run: match (done), the
`applications` table, file upload, the runner, autofill runs, screening
answers. Tailoring comes after, in this order:

1. **Tailoring** in `scout/` with `ScriptedLLM` tests (grounding check,
   invalid JSON, quota), and the `tailor` route.
2. **PDF render** and `resumes.tailored_from_id`.
3. **Review** on the Auto Apply page.
4. **MCP server**, if still wanted.

The run makes applying faster with no AI at all. Tailoring adds to it.

## 11. Open questions

- **When a job posting closes or is deleted**, does its application stay
  (SET NULL on `job_id`, keep a copy of title and company) or go (CASCADE)?
  The tracker needs the row after the job posting closes, so SET NULL plus a
  copy is likely.
- **One page or not.** Cutting to one page is the norm for students, but it
  drops content. Make it a template setting?
- **Which resume template.** One fixed template, or let the student pick?
- **Rate of applications.** Should WorkIt limit how many applications a
  student sends per day, to protect quality, apart from the model cap?
- **Detecting submission** per hiring system, to replace the "Did you
  submit?" question.
- **Grounding of rephrased bullets.** The structural check cannot see a
  bullet that gained a claim. Is the student's review enough, or should a
  second model call compare each bullet with its original?

# Auto-apply: architecture

How WorkIt takes a student from "here are your matches" to "your application
is filled in; check it and submit", in as few steps as possible. This is the
one document for auto-apply (KAN-223): what it does, why, and how the code is
built. It replaces the earlier `design.md`.

> **Status (2026-10-15).** Decided: the run happens in the student's own
> Chrome, through the WorkIt extension. No WorkIt server ever drives a
> browser. The code is function based, in three layers, so that an MCP
> server can expose it later. **Built:** the Match step's function ("Match
> (built)", below), and the queue: `job_applications.stage`, the layer-1
> and layer-2 functions in `backend/app/auto_apply/` and their routes in
> `backend/app/routers/auto_apply.py` ("Data model", "API routes"), which
> the webapp now calls: a job's Auto Apply button queues it, Start Auto
> Apply queues a batch, and Live Activity lists the applications. The
> extension is next. Everything else is a plan. The exact function names are a
> sketch, to be settled when each step is built.

## Terms

The job terms are the repo's own (root `CLAUDE.md`, Conventions).

| Term | Means |
|---|---|
| **Hiring system** | Software a company uses to collect applications (an ATS): Greenhouse, Lever, Workday |
| **Job posting** | One open job, and its `job_postings` row. `apply_url` is the page on the hiring system where the student applies |
| **Base resume** | A resume the student uploaded, parsed into `resumes.parsed_json`. The **primary resume** is the one marked default |
| **Tailored resume** | A copy of a base resume, rewritten for one job posting |
| **Application** | One student's intent to apply to one job posting, from `queued` to `applied` and after |
| **Batch** | The applications one click of Start Auto Apply queues: 10 by default |
| **Run** | The extension working through the queue, one application at a time |
| **Autofill run** | One attempt by the extension to fill one application's form |
| **MCP server** | A tool interface that an AI agent (Claude, ChatGPT) can call. Each tool has a name, a description and an input schema |

---

## 1. Summary

```
 1. Match              2. Tailor (later)        3. Fill                   4. Record
 fetch_recommended  →  the model rewrites the → the extension opens    → the student clicks the
 ranks job postings    primary resume for one   apply_url in the run's   hiring system's Submit,
 against the primary   job posting; the API     window, fills the form,  then "Submitted" or "Skip";
 resume; a batch of    renders it to PDF        attaches the PDF         the API saves the result
 10 is queued
```

**The student clicks Submit on every application.** The run automates
everything up to that click and nothing after it ("Decisions", below).

### Goals

- Find the job postings that fit a student, using the matching that exists.
- Fill the hiring system's form with the student's data and resume.
- Later, make one tailored resume per job posting, with no invented content.
- Track every application, so the Applications screen shows real data.
- Expose the pipeline to AI agents through an MCP server, and charge for
  auto-apply.

### Non-goals

- Submitting an application without the student.
- Solving CAPTCHAs or hiding automation from a hiring system.
- Creating accounts on a hiring system for the student. Workday asks for one
  per company; the student makes it.
- Writing cover letters. The tailoring step can do it later.

## 2. What exists today

| Piece | State | Where |
|---|---|---|
| Job postings | Scraped and imported every 3 hours, with `apply_url` and a full description | `scraper/`, `backend/app/scripts/import_jobs.py`, `docs/job-pipeline.md` |
| Matching | `fetch_recommended()` scores job postings 0–100 against the experience bank, with up to 3 highlights and `min_match`. Also served as `GET /jobs/recommended/{applicant_id}` | `backend/app/routers/jobs.py`, `backend/app/services/matching/` |
| Parsed resume | `ParsedResume`: education, experience, skills, projects, certifications. No name or contact details | `backend/app/models/dto.py`, `backend/app/models/resume.py` |
| Resume file | Uploaded PDF in the `Resume` Storage bucket, served by `GET .../resumes/{id}/file` | `backend/app/routers/resumes.py` |
| LLM access | One OpenAI-compatible client; the model is configuration; a daily cap per account | `scout/workit_scout/llm.py`, `settings.py`, `quota.py` |
| Privacy boundary | Maps `parsed_json` to model input without names, contact details or links | `scout/workit_scout/facts.py` |
| Form filling | Chrome extension, started from its popup. Fills text fields, dropdowns and repeated sections. Never submits | `autofiller_extension/` |
| Webapp ↔ extension link | `externally_connectable`. Today it only answers "installed and signed in?" | `frontend/src/lib/autofill-extension.ts` |
| Auto Apply page | The primary resume, a Start button that only changes local state, and Live Activity over a fixture | `frontend/src/app/(seeker)/auto-apply/`, `frontend/docs/screens.md` |
| Applications screen | UI only, over a fixture (`data.ts`) | `frontend/src/app/(seeker)/applications/` |

**Built since:** the queue (`job_applications.stage`), its routes, and the
webapp's use of them (Auto Apply buttons, Start Auto Apply, Live Activity).
**Missing:** the extension calling them, the runner, file upload in the
extension, `autofill_runs`, tailoring and the PDF renderer, and the MCP
server.

---

## 3. Where the run happens

| Path | Result |
|---|---|
| **Extension, in the student's Chrome (chosen)** | Works. The hiring system sees the student's own browser, IP address and sign-ins. Chrome must be open |
| Headless browser on our servers | Rejected. Server traffic triggers CAPTCHAs. A server cannot read the student's email codes or use their Workday accounts. Vercel cannot host a browser for a whole run |

## 4. The parts

```
 ┌─────────────────────────┐  port "auto-apply"   ┌───────────────────────────┐
 │ Auto Apply page         │ ───────────────────▶ │ Extension background      │
 │ (webapp, /auto-apply)   │ ◀─────────────────── │ worker: the RUNNER        │
 │ Start / Pause,          │   run and item       │ one job posting at a time │
 │ Live Activity           │   updates            └──────┬──────────────┬─────┘
 └───────────┬─────────────┘                            │ tabs,        │ fetch, Bearer
             │ server actions                           │ scripting    │ token from the
             ▼                                          ▼              ▼ webapp's cookie
 ┌─────────────────────────┐                 ┌─────────────────┐  ┌───────────────┐
 │ Next server             │ ── Bearer ────▶ │ Hiring system   │  │ WorkIt API    │
 │ (refreshes the session) │                 │ tab: content    │  │ (FastAPI)     │
 └─────────────────────────┘                 │ scripts+overlay │  │ source of     │
             │                               └─────────────────┘  │ truth         │
             └──────────────────── Bearer ───────────────────────▶└───────▲───────┘
                                                                          │ API key
                                                              ┌───────────┴───────┐
                                                              │ MCP server (later)│
                                                              │ ← an AI agent     │
                                                              └───────────────────┘
```

| Part | Does | Never does |
|---|---|---|
| **WorkIt API** | Scores matches. Queues batches. Owns applications and autofill runs. Tailors and serves resumes | Opens a browser. Decides when the run moves on |
| **Auto Apply page** | Shows Live Activity. Sends Start and Pause. Keeps the session fresh while the run goes on ("Chrome limits") | Fills anything. Holds the queue in memory as the truth |
| **Runner** (extension background worker) | Takes the next application, opens its tab, starts the fill, waits for the student, records the result | Clicks Submit. Refreshes the session itself |
| **Content scripts** (in the hiring system's tab) | Fill fields, attach the PDF, show the overlay with **Submitted** and **Skip** | Talk to the API. Move to another page |
| **MCP server** (later) | Lists tools for an AI agent. Each tool calls one API route with the student's API key | Holds logic. Reaches the student's Chrome |

**The API is the source of truth.** The runner keeps only a cursor (which
application, which tab). If Chrome closes mid-run, nothing is lost: the
application is still in the queue, and the next Start picks it up. Because
the API holds the queue, either the webapp or an AI agent can start a batch;
the extension works through it the same way.

---

## 5. The function layers

The backend code for auto-apply is built in three layers, so that every
caller (the webapp, the extension, a script, an AI agent) goes through the
same functions.

| Layer | Holds | Called by | Exposed? |
|---|---|---|---|
| **1. Building blocks** | Database queries, pure logic and single model calls. Each function does one thing | Layer 2 only | No |
| **2. Pipeline steps** | One function per step a caller can ask for. Each calls layer-1 functions in order, and handles only what lies between them: errors, the transaction, fallbacks | Layer 3 | No |
| **3. Interfaces** | API routes now, MCP tools later. Each reads the input, checks who is asking, calls **one** layer-2 function and returns its result | The webapp, the extension, an AI agent | Yes |

### 5.1 The rules for each layer

- **Layer 1** knows nothing of the pipeline. It does not check who is asking.
  It does not call other layer-1 functions. Pure functions take no database
  session, so tests need no database.
- **Layer 2** functions are each **safe to call alone**. A step that must
  always run (the grounding check before a tailored resume is saved) runs
  inside the layer-2 function, so no caller can skip it. A step can be very
  thin: `get_matches` may only call `fetch_recommended`.
- **Layer 3** holds no pipeline logic. It has about as many functions as
  layer 2, not fewer: it is an adapter, not a parent. It never combines two
  layer-2 functions.
- **Stage checks enforce the order.** Each application has a stage. Each
  layer-2 function first checks that the application is in the stage it
  needs, and otherwise raises an error that names the step to call first.
  The routes are public HTTP endpoints that any client with a token can
  call in any order, so the order must be enforced here, not by which tools
  an MCP server lists.

### 5.2 A sketch of the functions

Names are not final.

| Layer | Function | Does |
|---|---|---|
| 1 | `fetch_recommended(db, account, filters, min_match, limit)` | Scores and ranks job postings. **Built** |
| 1, pure | `pick_batch(scored, size)` | Drops repeats of one company and title; takes the first `size`. Every hiring system stays in. **Built** |
| 1 | `queue_applications(db, applicant_id, job_ids)` | Saves the open ones with no application yet as `queued`; answers which. **Built** |
| 1 | `fetch_stage(db, applicant_id, job_id)` | The application's stage, or `None`. **Built** |
| 1 | `fetch_applications(db, applicant_id, stages)` | The applications, newest first, each with its job posting's listing and `open`. **Built** |
| 1 | `fetch_next_application(db, applicant_id)` | The oldest queued application whose job posting is open, with its `apply_url`. **Built** |
| 1, LLM | `tailor_resume(llm, parsed, job)` | A tailored `ParsedResume` (in `scout/`) |
| 1, pure | `check_grounding(base, tailored)` | Lists anything the model invented |
| 1, pure | `render_resume_pdf(parsed, contact)` | PDF bytes |
| 1 | `store_tailored_resume(db, storage, …)` | Saves the PDF and the resume row |
| 1 | `record_run(db, application_id, report)` | Saves one autofill result |
| 1 | `set_stage(db, applicant_id, job_id, stage)` | Moves it; `applied` also sets `applied_at`. **Built** |
| 2 | `get_matches(db, account, filters, min_match=60, size=10)` | `fetch_recommended`, leaving out every job posting with an application at any stage (`JobFilters.no_application_by`) → `pick_batch`. Reads only. **Built** |
| 2 | `start_batch(db, account, filters, min_match=60, size=10)` | `fetch_recommended` → `pick_batch` → `queue_applications`; one commit; returns the queued job ids, best first. **Built** |
| 2 | `queue_job(db, applicant_id, job_id)` | A job's Auto Apply button: `queue_applications` for one; a job with an application keeps its stage (`fetch_stage`). **Built** |
| 2 | `list_applications`, `get_application`, `next_application` | Thin: `fetch_applications`, `fetch_application` (`NotFound` without one), `fetch_next_application`. **Built** |
| 2 | `prepare_application(db, llm, storage, application_id)` | `tailor_resume` → `check_grounding` → `render_resume_pdf` → `store_tailored_resume`. If any step fails, keep the primary resume; never block the fill |
| 2 | `finish_application(db, applicant_id, job_id, outcome)` | Stage check (`queued` or `needs_you`, else `WrongStage`) → `set_stage`: submitted → `applied`, skipped → `skipped`, failed → `needs_you`. **Built**, without `record_run`, which waits for `autofill_runs` |

### 5.3 One step through all three layers

```
Webapp or AI agent: "start a batch of 10"
  Layer 3  POST /applicants/{id}/auto-apply/batches   (MCP tool: start_batch)
             checks the caller owns {id}, reads size=10
  Layer 2  start_batch(db, account, size=10)
             → fetch_recommended(...)          layer 1, query
             → pick_batch(scored, 10)          layer 1, pure
             → queue_applications(...)         layer 1, write
             commits once, returns the 10 job ids
  Layer 3  returns the ids as JSON
```

### 5.4 Where the files go

```
backend/app/auto_apply/
    rules.py        layer 1, pure:  pick_batch
    queries.py      layer 1, DB:    queue_applications, fetch_stage, fetch_application, fetch_applications,
                                    fetch_next_application, set_stage; later record_run
    pipeline.py     layer 2:        get_matches, start_batch, queue_job, list_applications,
                                    get_application, next_application, finish_application; later prepare_application
backend/app/routers/auto_apply.py   layer 3: the routes. Every router lives in app/routers/
scout/workit_scout/tailor.py        layer 1, LLM: tailor_resume, check_grounding
the MCP server                      layer 3, later: its own small program that calls the routes
```

`backend/CLAUDE.md` says services hold no database code. `app/auto_apply/`
holds functions that take a session, so it is a new kind of folder. Record
that rule in `backend/CLAUDE.md` when the folder is created.
`fetch_recommended` stays in `routers/jobs.py`, since the Jobs page uses it
too; layer 2 imports it from there.

### 5.5 The extension's functions

The extension's steps run in the student's Chrome, outside these layers. They
read and write the queue through the routes, like any other caller.

```js
runBatch()                       // parent: a loop, nothing else
  → nextApplication()            // GET from the API
  → openApplicationTab(url)      // the run's own window, one tab at a time
  → fillForm(tabId)              // the field engine that exists
  → attachResume(tabId, resumeId)
  → waitForDecision(tabId)       // the student clicks "Submitted" or "Skip"
  → finishApplication(...)       // POST to the API
```

---

## 6. Match (built)

The run applies to the student's matches. Matching already exists and is
reused: it scores every listed job posting against the student's
**experience bank** (KAN-212), never an uploaded resume.

- **`fetch_recommended(db, account, min_match=60)`** in
  `backend/app/routers/jobs.py` returns the matches, best first, as
  `ScoredJob`s (a job listing plus `match` and `highlights`). It checks no
  ownership; its caller does.
- **`GET /jobs/recommended/{applicant_id}?min_match=60`** returns the same
  list over HTTP. It checks that the token owns the applicant.
- **`min_match`** (default 0) leaves out job postings scored below it, before
  the offset. Auto-apply starts at 60; tune it on real data.
- It takes the signed-in account, not only its id: the bank's embedding
  text reads the student's identity (`load_identity`).
- An empty experience bank (no entries, no skills): the function raises
  `EmptyBank`, and the route answers 404.
- **No screen shows the matches.** The Auto Apply page does not list them.

The scoring and its weights are in `backend/app/services/matching/CLAUDE.md`.
Improving them is someone else's task ("Open questions").

## 7. The batch

One click of **Start Auto Apply** queues a batch of 10 job postings.

1. **Fetching and scoring are one step.** `fetch_recommended` finds, scores
   and ranks in one call. There is no separate "match the resume" step.
2. **Leave out what is done.** Every job posting that already has an
   application for this student (queued, applied, skipped) stays out. Without
   this, every click returns the same 10. Applied ones are left out today:
   `get_matches` sets `JobFilters.applied_by`, the Jobs page's own filter over
   `job_applications` (KAN-232), so they are never scored. Queued and skipped
   ones join that filter when the queue has a table.
3. **Freeze the batch at Start.** Pick the 10 once and save them as `queued`
   applications. New job postings arrive every 3 hours and scores change, so
   a list read during the run could change under it. A saved batch also lets
   Pause, Resume and a Chrome crash continue with the same 10.
4. **Use the student's filters.** Matching reads the resume only, not
   location, visa or start date. Pass the student's preferences as
   `filters=`, or let them set filters on the Auto Apply page.
5. **Keep one job posting per company and title.** Some roles are listed
   once per office. The batch does not filter by hiring system: a job
   posting the extension cannot fill (Workday, a company's own site) is
   queued like any other, and its fill fails to `needs_you` ("The run").

Why 10: the student checks each form before Submit, so 10 applications take
about 10 to 30 minutes. A small batch also limits the harm of a bad fill.

## 8. The run

### 8.1 Run states

```
            Start                 queue empty
   idle ──────────▶ running ─────────────────────▶ idle
                    │    ▲
              Pause │    │ Resume
                    ▼    │
                    paused

   running ──▶ stopped (needs the student: signed out, no permission, extension updated)
```

Pause takes effect between job postings. The current tab stays open, so the
student can still finish it.

### 8.2 One application

```
 next ─▶ (tailor) ─▶ opening ─▶ filling ─▶ waiting ─▶ recording ─▶ next
                       │          │          │
                       ▼          ▼          ▼ tab closed = Skip
                     failed     failed
```

1. **next.** The runner asks the API for the next queued application. None
   left: the run goes idle. Once tailoring exists, the API tailors the
   application here if it has no tailored resume yet, so no caller has to
   remember the step. Tailor the next one while the student checks the
   current one, so the student does not wait.
2. **opening.** It opens `apply_url` in the run's window ("Chrome limits")
   and waits for the tab's `complete` status. Limit: 30 seconds.
3. **filling.** It injects the content scripts (as the popup does today) and
   sends `fill/start` with the resume id. The content script fills, attaches
   the PDF, and replies with the counts and the report. Limit: 60 seconds.
4. **waiting.** The overlay shows what was filled, what failed and what was
   skipped, and two buttons. The runner waits for `student/decision`, with
   no time limit. Closing the tab counts as **Skip**.
5. **recording.** The runner saves an autofill run. **Submitted** moves the
   application to `applied` and sets `applied_on`. **Skip** moves it to
   `skipped`, so the next batch does not pick it again.

**failed** saves the run with the reason ("page did not load", "no form
found", "sign-in needed") and moves the application to `needs_you`. The run
goes on to the next one. Live Activity shows it under "Needs You".

The extension cannot reliably tell that the student submitted: hiring
systems show different confirmation pages. That is why the student clicks
**Submitted**. Detecting each hiring system's confirmation page can come
later, one hiring system at a time.

Workday asks for an account on each company's site. The runner cannot create
one. When the content script sees a sign-in form and no application form, it
reports "sign-in needed" and the runner moves on.

## 9. Messages

Every message has a `type`. The names follow the extension's existing
`auth/status` and `profile/get`.

### 9.1 Webapp ↔ runner

The Auto Apply page opens a long-lived port:
`chrome.runtime.connect(EXTENSION_ID, { name: "auto-apply" })`. Same
`externally_connectable` origins as the ping today.

| Direction | Type | Body |
|---|---|---|
| page → runner | `run/start` | `{ applicantId }` |
| page → runner | `run/pause` | `{}` |
| page → runner | `run/status` | `{}`. The runner answers with `run/state` |
| runner → page | `run/state` | `{ state: "idle" \| "running" \| "paused" \| "stopped", reason?, current?: applicationId }` |
| runner → page | `item/update` | `{ applicationId, status, detail }`. `status` uses Live Activity's names (`filling`, `review`, `applied`, `failed`...) |

The page also reloads Live Activity from the API after each `item/update`.
The message makes the page fast; the API keeps it correct.

### 9.2 Runner ↔ content script

| Direction | Type | Body |
|---|---|---|
| runner → tab | `fill/start` | `{ applicationId, resumeId }` |
| tab → runner | `fill/result` | `{ filled, failed, skipped, report, resumeAttached }` |
| tab → runner | `student/decision` | `{ decision: "submitted" \| "skipped" }` |

## 10. Chrome limits

### 10.1 Host permissions

`activeTab` covers only a tab the student opened the popup on. The runner
opens tabs itself, so it needs host permissions for the hiring systems.

- **Prototype: required `host_permissions`** for the hiring systems the
  scraper covers: `*.greenhouse.io`, `jobs.lever.co`, `jobs.ashbyhq.com`,
  `apply.workable.com`, `*.recruitee.com`, `*.myworkdayjobs.com`. Chrome
  shows one warning at install.
- **Before the Chrome Web Store: optional permissions.**
  `chrome.permissions.request` works only on a click inside an extension page,
  never on a click in the webapp. So the first Start opens a small extension
  page with one "Allow WorkIt on hiring sites" button.

**Company domains.** About 13% of the feed's `apply_url`s are a company's own
site with the hiring system's form in an iframe (`withwaymo.com`,
`jumptrading.com`). The runner injects into the hiring system's frame only
(`allFrames`, or `frameIds` from `webNavigation`). Test this on a real
posting before relying on it.

### 10.2 The session expires after one hour

The runner reads the webapp's session cookie and never refreshes it
(`autofiller_extension/CLAUDE.md`: two refreshers would sign the student
out). So the **Auto Apply tab keeps the session fresh**: while the run is
`running`, the page calls a cheap server action every 10 minutes. That
request passes the Next proxy, which refreshes the cookie when needed. The
runner reads the new cookie before each application.

If the student closes the Auto Apply tab, the run goes on until the token
expires. Then the runner stops with `reason: "signed_out"`, and the next Start
continues.

### 10.3 The background worker stops when idle

Chrome stops an extension's background worker after about 30 seconds with no
events. Two measures:

- The open port from the Auto Apply page sends `run/status` every 20 seconds
  while the run goes on. Each message resets the idle timer.
- The runner writes its cursor to `chrome.storage.session` after each step:
  `{ state, applicantId, applicationId, tabId, windowId, step }`. When the
  worker starts again, it reads the cursor and continues from that step.

### 10.4 Hidden tabs run slowly

Chrome slows timers in hidden tabs and stops page redraws. Some dropdowns wait
for a redraw. So the tab is never hidden:

- The runner opens **one window** for the run (`chrome.windows.create`) and
  reuses it, one tab at a time. The student's own windows stay as they are.
- The current application's tab is always the active tab in that window.
- Only one application fills at a time.

---

## 11. Tailoring (later)

Tailoring comes after the run works. The run makes applying faster with no
AI at all; tailoring adds to it.

### 11.1 Tailor

`tailor_resume` takes a base resume and a job posting and returns a tailored
`ParsedResume`.

**It lives in `scout/workit_scout/tailor.py`.** Scout already has the model
client, the privacy mapping and the test fake (`ScriptedLLM`). The rule in
`scout/CLAUDE.md` holds: the package never imports the backend and never
touches the database. Layer 2 loads the resume and the job posting and hands
them in.

**What the model may do:** reorder entries, bullets and skills so the most
relevant come first; rephrase a bullet with the job posting's words when the
bullet already states that fact; cut entries and bullets to keep one page.

**What the model must never do:** add a skill, an employer, a title, a date, a
degree, a number or a technology that the base resume does not state. This is
Scout's grounding rule (`scout/CLAUDE.md`, "Grounding"). Invented skills are
the most common complaint about JobRight.

**Two checks enforce it:**

1. **`check_grounding`, in code**, after the model replies. Every skill must
   be in the base resume's skills. Every experience, education, project and
   certification entry must match a base entry by name and title, with the
   same dates. A reply that fails is rejected and the base resume is used.
2. **The student's review** covers what code cannot check: whether a
   rephrased bullet still says only what the original said.

**The prompt is one frozen string** in the package, like `prompt.py`, so the
provider can cache the prefix. **The output is JSON** that validates as
`ParsedResume`; a reply that does not validate counts as a failure.

### 11.2 Render

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

A tailored PDF will not look like the student's own design, so the student
can choose the base resume file instead.

### 11.3 Review

The Auto Apply page lists the batch. For each application it shows the job
posting, the match score, and the tailored resume next to the base resume,
with the changed lines marked. The student can approve it, edit it (the same
editor as My Profile's, `resume-edit-dialog.tsx`; the backend re-renders the
PDF), use the base resume instead, or remove the application.

---

## 12. Data model

This is a sketch for the migration's author, not the schema. Alembic is the
source of truth (root `CLAUDE.md`). Read `backend/app/models/CLAUDE.md` and
`backend/alembic/CLAUDE.md` before writing it. Every new table's migration
enables RLS with no policies.

`backend/app/models/CLAUDE.md` reserves "a separate `autofill_runs` table,
not a column here" for autofill state. This design follows it.

### `job_applications` (built)

The application is KAN-232's `job_applications` row, one per student and job
posting (primary key `(applicant_id, job_id)`), not a second table: two
tables would both say "this student applied to this job" and could
disagree. Migration `c0467afe819c` added:

| Column | Type | Notes |
|---|---|---|
| `stage` | enum `application_stage` | `queued`, `needs_you`, `skipped`, `applied`. Default `applied`, for the Applied button's older inserts; a queued insert names its stage and writes `applied_at` NULL. Rows from before are `applied` |
| `created_at` | timestamptz | When the row was made: the queue's order |
| `applied_at` | timestamptz **null** now | Set when the student clicks **Submitted** or the Applied button; `NULL` while queued. A CHECK keeps an `applied` row dated |

- **The Jobs page hides `applied` rows only** (`JobFilters.applied_by`). A
  queued job stays on it; matches leave out every stage
  (`JobFilters.no_application_by`).
- **The Applied button turns a queued, skipped or needs_you row applied**
  (`mark_applied`, an upsert); an applied row keeps its first date.
- **A closed job posting keeps its application.** Closing is a status, not
  a delete, so the row and the listing stay; `fetch_next_application` passes
  over it and `GET .../applications` marks it `open: false`. Only a deleted
  job posting deletes its rows (CASCADE).
- **Later columns**, when their steps are built: `resume_id` (the resume to
  attach, tailored or base), `tailor_status`, `match` (the score when
  queued). The tracker's stages (`interviewing`, `offer`, `rejected`) are a
  later ticket (models `CLAUDE.md`, Out of scope) and an `ALTER TYPE`.

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
questions, and the fill rate stays low.

### `api_keys` and `usage` (for MCP)

See "MCP access and billing". `api_keys`: account id, a **hash** of the key
(never the key), a name, created and last-used times, a revoked flag.
`usage`: one row per charged action (account, action, time).

## 13. API routes

New routes follow `backend/app/routers/CLAUDE.md`. Each calls one layer-2
function. Every route checks that the caller owns the applicant, like
`assert_applicant_owns`. Paths are a sketch.

| Method | Path | Layer 2 | Does |
|---|---|---|---|
| GET | `/applicants/{id}/auto-apply/matches` | `get_matches` | The matches a batch would queue, with the Jobs page's filters. **Built** |
| POST | `/applicants/{id}/auto-apply/batches` | `start_batch` | Queues a batch (`{"size": 10}`, at most 50); answers the job ids. **Built** |
| POST | `/applicants/{id}/applications` | `queue_job` | A job's Auto Apply button: queues `{"job_id"}`. **Built** |
| GET | `/applicants/{id}/applications` | `list_applications` | Live Activity and later the tracker. `?stage=` repeats. **Built** |
| GET | `/applicants/{id}/applications/next` | `next_application` | What the runner fills next, or `null`. **Built** |
| GET | `/applicants/{id}/applications/{job_id}` | `get_application` | One application, as the list has it; 404 without one. Registered after `/next`. **Built** |
| POST | `/applicants/{id}/applications/{job_id}/finish` | `finish_application` | `{"outcome": "submitted" \| "skipped" \| "failed"}`; 409 when not queued or needs_you. **Built**; takes the autofill run's report once `autofill_runs` exists |
| POST | `/applicants/{id}/applications/{job_id}/tailor` | `prepare_application` | Make or remake the tailored resume. Counts toward the cap |

An application is named by its job id: the row's key is `(applicant_id,
job_id)`, and the applicant is in the path. `/jobs/recommended/{id}` stays
the Jobs page's route; it does not leave out queued jobs.

**Tailoring is slow** (several seconds per model call). The `tailor` route
can answer `202` and set `tailor_status = pending`, and the webapp polls the
application. A Vercel Function can run long enough for one call, so start
with doing the work inside the request, and move to a background step only
if it times out.

---

## 14. MCP access and billing

### 14.1 What an MCP server is, here

An MCP server publishes a list of tools. An AI agent reads the list and
decides by itself which tools to call, and in which order. **The agent
becomes the parent of the layer-2 steps.** So:

1. **Expose layer 2, never layer 1.** If `store_tailored_resume` were a tool,
   an agent could call it without `check_grounding`.
2. **Expose few tools.** A short list is easier for an agent to use well.
   Suggested: `get_matches` (read only), `start_batch(size)` (queues and
   returns at once), `get_batch_status` (each application's stage; the agent
   polls it), `skip_application(id)`.
3. **Not one "do everything" tool.** Tailoring 10 resumes takes many model
   calls, near the time limit of one request. The student fills and submits
   in Chrome over many minutes, and a tool cannot wait for that. And the
   agent could not stop between steps to show the student the matches.
4. **Inputs and outputs are ids and plain data.** An agent can only pass
   along what a tool returned to it.
5. **The stage checks are the real guarantee** (5.1). Which tools the MCP
   server lists makes the list easy to use. It does not make the order safe.
6. **The MCP tools call the routes, not the Python functions.** The routes
   check ownership, and the MCP server may run where there is no database
   access. Host it at WorkIt, so we control and update it.

**The extension cannot be an MCP tool.** The MCP server runs on our side and
cannot reach the student's Chrome. A batch an agent starts waits in the
queue until the extension works through it.

### 14.2 Access: API keys

The routes are already private: each protected route needs a signed-in
student's token. MCP adds a second kind of token, an **API key**.

1. The student pays for a plan, and WorkIt shows them an API key once.
2. They paste it into their AI app's MCP settings.
3. Each tool call sends the key. The API looks it up, finds the account and
   its plan, and allows or refuses the call.

To build:

- The `api_keys` table, and routes to create, list and revoke keys (a
  section in Settings). Only paid plans can create a key.
- A key check: a FastAPI dependency next to `get_current_account`
  (`app/deps.py`). It hashes the key, compares, rejects revoked keys, and
  returns the same account object. Layers 1 and 2 do not change.
- Limits per key: calls per minute.
- Never give out the service-role key or a long-lived Supabase token in place
  of an API key.

The MCP standard also supports OAuth sign-in for a hosted MCP server: the
user signs in, and pastes nothing. It is better for users and more work. Add
it later if needed.

### 14.3 Billing: charge the action

Reading routes are free: they show what the webapp shows. **What costs money
is auto-apply itself**: a batch, its fills, the tailored PDFs. So the plan
limit sits in the layer-2 step that does the action (`start_batch`,
`prepare_application`), not in the route or the MCP server. Every caller
meets it, whichever way they come in, so nobody can avoid it by calling the
routes with a normal sign-in token. The `usage` table counts each action; a
payment service (Stripe) bills a monthly plan or per use.

### 14.4 The student's own AI subscription

With MCP, the student's AI subscription pays for the agent's thinking. Our
tools still run on our server, and we pay for the work inside them.

| Work | Runs on | Our cost | Can the student's AI do it? |
|---|---|---|---|
| Matching | Our API | Small | No: it needs our data |
| Tailoring | Our API, our model | The main cost | Yes (below) |
| PDF render | Our API | Small | No: keep the file consistent |
| Autofill | The student's Chrome | None | Not needed |

**The student's AI can write the tailored resume**, with two tools:
`get_tailoring_task(application_id)` returns the resume facts, the job
description and the rules; the agent writes the resume;
`submit_tailored_resume(application_id, resume_json)` validates it, runs
`check_grounding` and renders the PDF. Our model cost for MCP users is then
close to zero.

- **Never trust the agent's output.** The grounding check stays on our
  server.
- **Send only what the task needs.** Each job description uses the student's
  AI usage too.
- MCP's "sampling" feature lets a server ask the user's AI for text
  directly. Not every AI app supports it, and the user approves each
  request. The two-tool design works everywhere.

**The line not to cross:** the student's AI may do work for that student, on
their request. Never hide instructions in tool results that make it do other
work, or use one student's AI for another student's tasks or for our own.
That is prompt injection: AI apps watch for it, and it breaks trust.

### 14.5 Before charging money

1. **The model's terms.** Production uses Gemini's free tier, which may train
   on prompts and may not allow paid products. A paid product needs a paid
   model tier, which costs per call.
2. **The hiring systems' terms.** They restrict automated applying. "The
   student clicks Submit" helps. Get a legal check before selling it.
3. **Key safety.** Show a key once, store only its hash, let users revoke
   keys, and limit calls per key.

---

## 15. Cost, quota and privacy

**Cost.** Tailoring is one model call per application. Production uses
Gemini's free tier, about 500–1,500 requests a day per project
(`scout/CLAUDE.md`, "Which model, where"). Scout uses the same quota, with
`SCOUT_DAILY_TURNS=20` per student.

- Give tailoring its own daily cap per student (start at 10, one batch),
  with the `quota.py` pattern.
- 100 active students at 10 a day is 1,000 requests: the top of the free
  quota, before Scout. Above that, decide between a lower cap and a paid
  tier.
- Tailor only applications in a batch, never every match.

**Privacy.** The rules from `scout/CLAUDE.md` apply. Only parsed resume
fields and the public job description go to the model. Names, email, phone
and links never do; reuse the `facts.py` mapping. The free tier may train on
prompts, which is why this rule exists.

**Storage.** Tailored PDFs hold contact details, like uploads. They go in the
private `Resume` bucket. Deleting an account does not delete Storage objects
yet (`backend/CLAUDE.md`, Auth, Still open). This adds more objects to that
gap.

## 16. Decisions

| Decision | Chosen | Rejected, and why |
|---|---|---|
| Who clicks Submit | **The student**, on every application. Each costs one review and one click; no wrong application goes out unseen | The extension: reverses the rule in `autofiller_extension/CLAUDE.md`; CAPTCHAs and bot detection make it fail often; hiring systems' terms prohibit it; a wrong answer reaches an employer under the student's name and cannot be undone |
| How the queue fills | **WorkIt queues a batch of matches** at Start | The student picks each one: slower. Fully automatic: ruled out by the row above |
| Where tailoring runs | **On demand, per application in a batch** | A scheduled batch: tailors matches nobody looks at, and uses Scout's quota |
| Where the run happens | **The student's Chrome** ("Where the run happens") | Our servers |
| How the code is shaped | **Three layers**, so MCP is a thin adapter | One function per screen: an agent could not reuse it |
| What we charge for | **The auto-apply action**, for every caller | Charging MCP access only: users would call the routes directly |

## 17. What changes where

| Folder | Change |
|---|---|
| `backend/` | `app/auto_apply/` (layers 1 and 2), `routers/auto_apply.py` (layer 3); the tables in "Data model"; later the API-key check and usage. `backend/CLAUDE.md` records the new folder's rule |
| `scout/` | `tailor.py`: `tailor_resume`, `check_grounding`, the frozen prompt |
| `frontend/` | Auto Apply page: the port to the runner, Start and Pause wired to it, Live Activity from the API, the session keep-alive; later the review and the API-key settings |
| `autofiller_extension/` | The runner; `onConnectExternal` for the port; `fill/start` in the content script; file upload; **Submitted** and **Skip** in the overlay; host permissions. Its `CLAUDE.md` changes too: it says the extension adds no backend routes, which stops being true |
| MCP server (new, later) | The tools in "MCP access and billing", each calling one route |

**File upload in the extension:** fetch the PDF from
`GET .../resumes/{id}/file`, make a `File`, put it in a `DataTransfer`, set
the file input's `files`, and send `input` and `change` events. Some hiring
systems use a drop zone instead (Workday). Test each hiring system. The
sample form (`test/sample-form.html`) needs a file input.

## 18. Build order

Each step ships alone and is about one ticket.

1. **Match**: `fetch_recommended` and `min_match` (done).
2. **The queue** (done): `job_applications.stage`, `app/auto_apply/`,
   `routers/auto_apply.py`, and the webapp on them: the Auto Apply buttons,
   Start Auto Apply and Live Activity (`frontend/docs/screens.md`, Auto
   Apply). The browser queue and Live Activity's fixture are gone.
3. **Extension: file upload**, tested on Greenhouse, Lever and Ashby. They
   host 87% of the job postings in the feed snapshot (`backend/data/feed.json`).
4. **Extension: the runner**, the port, host permissions, and the overlay's
   **Submitted** and **Skip**. Start and Pause go live.
5. **`autofill_runs`** and Live Activity from the API. The fixture goes.
6. **`autofill_answers`** for screening questions.
7. **Tailoring** in `scout/`, with `ScriptedLLM` tests (grounding check,
   invalid JSON, quota), and `prepare_application`.
8. **PDF render** and `resumes.tailored_from_id`.
9. **Review** on the Auto Apply page.
10. **MCP server**, API keys and billing.

## 19. Open questions

- **Scores bunch at the top.** On a laptop with no Ollama, the test account
  had 100+ matches at 60% or more, most at 98–100% (2026-10-14). Eligibility
  adds 15–27 points to almost every job, and the skill part is scaled to the
  best job in the list. Someone else owns the scoring fix; until then, the
  top 10 of a batch is close to a random pick from many similar jobs.
- **How an MCP-started run reaches the extension.** With no WorkIt tab open,
  nothing starts the extension and nothing keeps the session fresh. Either
  the extension checks the queue once a minute (`chrome.alarms`) and stops
  when the token expires, or the agent asks the student to open the Auto
  Apply page.
- **Company-domain iframes**: does injecting into the hiring system's frame
  work on every one? Test on Waymo and Jump Trading first.
- **How many applications per batch, and per day?** A limit protects
  quality and the student's reputation with employers.
- **When a job posting is deleted**, its application goes (CASCADE). A
  closed one stays, which covers the scraped feed. Revisit if companies
  delete their own job postings and the tracker must keep those rows.
- **Detecting Submit**: each hiring system's confirmation page could replace
  the **Submitted** button, one hiring system at a time.
- **Resume template**: one page or not; one fixed template, or the student
  picks?
- **Grounding of rephrased bullets.** The structural check cannot see a
  bullet that gained a claim. Is the student's review enough, or should a
  second model call compare each bullet with its original?

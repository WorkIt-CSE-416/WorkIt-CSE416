# Auto-apply: architecture

How WorkIt takes a student from "here are your matches" to "your application
is filled in; check it and submit", in as few steps as possible. This is the
one document for auto-apply (KAN-223): what it does, why, and how the code is
built. It replaces the earlier `design.md`.

> **Status (2026-10-16).** Decided: the run happens in the student's own
> Chrome, through the WorkIt extension. No WorkIt server ever drives a
> browser. The code is function based, in three layers, so that an MCP
> server can expose it later. **Built:** the Match step's function ("Match
> (built)", below), and the queue: `job_applications.stage`, the layer-1
> and layer-2 functions in `backend/app/auto_apply/` and their routes in
> `backend/app/routers/auto_apply.py` ("Data model", "API routes"), which
> the webapp now calls: a job's Auto Apply button queues it, Start Auto
> Apply queues a batch, and Live Activity lists the applications. The
> resume builder on `main` (KAN-181, 207, 208, 217, 220) built the resume
> side: base resumes from the experience bank, Tailor, the PDF render and
> sent resumes. The run reuses them ("The resume"), and the resume step's
> backend is built: `pick_resume`, `prepare_resume` and `POST
> .../applications/{job_id}/resume`. The runner's first step is built:
> Start and a job card's Auto Apply send `run/open`, and the extension
> opens the next queued application's `apply_url` in its own background
> tab (`autofiller_extension/src/background/runner.js`); the webapp shows that
> job as Working in Browser. Then the runner starts the extension's own
> fill in that tab ("The first fill", 8.3, KAN-305); the application stays
> `queued`. Everything else is a plan. The exact function names are a
> sketch, to be settled when each step is built.

## Terms

The job terms are the repo's own (root `CLAUDE.md`, Conventions).

| Term | Means |
|---|---|
| **Hiring system** | Software a company uses to collect applications (an ATS): Greenhouse, Lever, Workday |
| **Job posting** | One open job, and its `job_postings` row. `apply_url` is the page on the hiring system where the student applies |
| **Experience bank** | The student's entries, bullets and skills (`backend/app/services/bank.py`). Matching, base resumes and Tailor read it |
| **Base resume** | A resume built from the experience bank (`built_resumes` with no `job_posting_id`, KAN-207). Its default is `applicant_profiles.default_built_resume_id` |
| **Tailored resume** | A built resume for one job posting (`built_resumes.job_posting_id`), made with Tailor (KAN-217). At most one per job posting |
| **Uploaded resume** | A file the student uploaded (`resumes`). Its default is `applicant_profiles.default_resume_id`. It feeds the bank's import; matching never reads it |
| **Default resume** | The one resume the student starred, a built (base or tailored) or an uploaded one: the Resumes view calls it the primary resume. Starring one clears the other pointer (`built_resumes.set_default`), so a student never has two. A student's only resume is the default with no star click (`built_resumes.default_if_only`, on every add and delete) |
| **Sent resume** | The exact file a student applied with, kept in `sent_resumes` (KAN-208): what went to one job posting (Apply, KAN-220, or auto apply). A download keeps nothing (KAN-267) |
| **Application** | One student's intent to apply to one job posting, from `queued` to `applied` and after |
| **Batch** | The applications one click of Start Auto Apply queues: 10 by default |
| **Run** | The extension working through the queue: batch apply's tabs, at most five filling at once (8.4) |
| **Autofill run** | One attempt by the extension to fill one application's form |
| **MCP server** | A tool interface that an AI agent (Claude, ChatGPT) can call. Each tool has a name, a description and an input schema |

---

## 1. Summary

```
 1. Match              2. Resume                3. Fill                   4. Record
 fetch_recommended  →  the API picks the     →  the extension opens    → the student clicks the
 ranks job postings    resume (tailored, else   apply_url in the run's   hiring system's Submit,
 against the           the default) and keeps   window, fills the form,  then "Submitted" or "Skip";
 experience bank; a    it as a sent resume      attaches the PDF         the API saves the result
 batch of 10 is queued for the job posting
```

**The student clicks Submit on every application.** The run automates
everything up to that click and nothing after it ("Decisions", below).

### Goals

- Find the job postings that fit a student, using the matching that exists.
- Fill the hiring system's form with the student's data and resume.
- Attach the right resume to each application: the tailored one when the
  student made one with Tailor, else their default.
- Track every application, so the Applications screen shows real data.
- Expose the pipeline to AI agents through an MCP server, and charge for
  auto-apply.

### Non-goals

- Submitting an application without the student.
- Solving CAPTCHAs or hiding automation from a hiring system.
- Creating accounts on a hiring system for the student. Workday asks for one
  per company; the student makes it. The extension fills its Create Account
  form (the student's email and a password of its own for that company,
  kept only in the extension's local storage), but the student presses
  Create Account and opens Workday's email (KAN-373, 8.4).
- Writing cover letters. The tailoring step can do it later.

## 2. What exists today

| Piece | State | Where |
|---|---|---|
| Job postings | Scraped and imported every 3 hours, with `apply_url` and a full description | `scraper/`, `backend/app/scripts/import_jobs.py`, `docs/job-pipeline.md` |
| Matching | `fetch_recommended()` scores job postings 0–100 against the experience bank, with up to 3 highlights and `min_match`. Also served as `GET /jobs/recommended/{applicant_id}` | `backend/app/routers/jobs.py`, `backend/app/services/matching/` |
| Experience bank | The student's facts, filled by intake and import. Matching, base resumes and Tailor read it | `backend/app/services/bank.py`, `backend/app/routers/bank.py` |
| Base and tailored resumes | Built from the bank and rendered to PDF with Tectonic (Jake's Resume). Tailor proposes changes for one job posting; the student accepts or rejects each | `backend/app/services/built_resumes.py`, `services/resume_render/`, `services/tailor.py`, `frontend/src/app/(seeker)/jobs/[jobId]/tailor/` |
| Sent resumes | `POST .../sent-resumes` (Apply, with `job_posting_id`) keeps the resume sent and answers its file: the PDF itself (`data`) for a built resume, kept as a snapshot (KAN-267), or a 5-minute link (`url`) for an uploaded one | `backend/app/services/sent_resumes.py`, `backend/app/routers/sent_resumes.py` |
| Uploaded resume | PDF or DOCX in the `Resume` Storage bucket. Feeds the bank's import | `backend/app/routers/resumes.py` |
| LLM access | Scout's model chain. Daily uses per student and feature; Tailor has 2 a day | `scout/workit_scout/llm.py`, `backend/app/services/usage.py` |
| Privacy boundary | Identity fields (name, contact details, links) never reach a model: the seam removes them | `backend/app/services/identity.py`, `scout/` |
| Form filling | Chrome extension, started from its popup. Fills text fields, dropdowns and repeated sections. Never submits | `autofiller_extension/` |
| Webapp ↔ extension link | `externally_connectable`, one-shot messages: `run/open` (open the next queued application), `run/status` and `run/show` (Working in Browser) | `frontend/src/lib/autofill-extension.ts`, `autofiller_extension/src/background/runner.js` |
| Auto Apply page | Manage Resumes and Start Auto Apply, then Up Next (the queue and needs-you jobs, each with the resume it will get, a click to change it, and Add Jobs to queue saved ones), from the API. History is archived for now: applied jobs show on the Applications Tracker | `frontend/src/app/(seeker)/auto-apply/`, `frontend/docs/screens.md` |
| Applications screen | Saved and Applied columns live from `GET .../applications?stage=saved&stage=applied&scored=true` (KAN-261), each card with the Jobs page's score (KAN-256); Interviewing and Offer empty until the API stores those stages | `frontend/src/app/(seeker)/applications/` |

**Built since:** the queue (`job_applications.stage`), its routes, and the
webapp's use of them (Auto Apply buttons, Start Auto Apply, Live Activity).
The resume builder (KAN-181, 207, 208, 217, 220) also built base resumes,
Tailor, the PDF render and sent resumes. **Missing:** the resume step
(picking the resume and keeping it for the job posting), the extension
calling the routes, the runner, file upload in the extension,
`autofill_runs`, and the MCP server.

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
| **WorkIt API** | Scores matches. Queues batches. Owns applications and autofill runs. Picks the resume for each application and serves the file | Opens a browser. Decides when the run moves on |
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
  always run (the stage check before a resume is kept for an application)
  runs inside the layer-2 function, so no caller can skip it. A step can be very
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
| 1, pure | `pick_batch(scored, size)` | Drops repeats of one company and title; takes the first `size`. **Built** |
| 1, pure | `auto_apply_supported(apply_url)` (`hosts.py`) | Whether the host is a hiring system auto apply fills: every hiring system the Fill engine fills (KAN-370), never a job board. `FORM_URL` in `queries/jobs/filters.py` is the form auto apply opens: the apply_url on such a host, or the employer's form a job board's posting names (KAN-376). `AUTO_APPLY_SUPPORTED` (a form exists) is required by the matches and `queue_applications`. **Built** |
| 1 | `queue_applications(db, applicant_id, job_ids)` | Saves the open ones with no application yet as `queued`; answers which. **Built** |
| 1 | `fetch_stage(db, applicant_id, job_id)` | The application's stage, or `None`. **Built** |
| 1 | `fetch_applications(db, applicant_id, stages)` | The applications, newest first, each with its job posting's listing and `open`. **Built** |
| 1 | `fetch_next_application(db, applicant_id)` | The oldest queued application whose job posting is open, with its `apply_url`. **Built** |
| 1 | `pick_resume(db, applicant_id, job_id)` | The resume to attach: tailored to this job posting, else the default resume, else `None` ("The resume"). **Built** |
| 1 | `sent_resumes.send_built`, `send_uploaded` | Keep the file as a sent resume linked to the job posting; unchanged content returns the last one. **Built** (KAN-208, KAN-220) |
| 1 | `record_run(db, application_id, report)` | Saves one autofill result |
| 1 | `set_stage(db, applicant_id, job_id, stage)` | Moves it; `applied` also sets `applied_at`. **Built** |
| 2 | `get_matches(db, account, filters, min_match=60, size=10)` | `fetch_recommended`, leaving out every job posting with an application at any stage (`JobFilters.no_application_by`) → `pick_batch`. Reads only. **Built** |
| 2 | `start_batch(db, account, filters, min_match=60, size=10)` | `fetch_recommended` → `pick_batch` → `queue_applications`; one commit; returns the queued job ids, best first. **Built** |
| 2 | `queue_job(db, applicant_id, job_id)` | A job's Auto Apply button: `queue_applications` for one; a job with an application keeps its stage (`fetch_stage`). **Built** |
| 1 | `remove_queued(db, applicant_id, job_id)` | Deletes the application only while it is `queued`, in one statement, so a fill that finishes it meanwhile is never undone. **Built** |
| 2 | `dequeue_job(db, applicant_id, job_id)` | The Auto Apply button's second click and Live Activity's cross: `remove_queued`, one commit; the job has no application again, so a later batch may pick it. `NotFound` without one, `WrongStage` past queued. **Built** |
| 2 | `list_applications`, `get_application`, `next_application` | Thin: `fetch_applications`, `fetch_application` (`NotFound` without one), `fetch_next_application`. `list_applications(score_for=account)` adds each open posting's `match` through `fetch_recommended` (`JobFilters.job_ids`); only the Applications page asks, since it can embed the bank. **Built** |
| 2 | `prepare_resume(db, storage, applicant_id, job_id)` | Stage check (`queued` or `needs_you`, else `WrongStage`; none, `NotFound`) → `pick_resume` → `send_built` or `send_uploaded` with the job posting → `link_resume` (the application names the sent resume, KAN-267) → one commit → the sent resume and its file (`data` for a built resume's snapshot, a 5-minute `url` for an uploaded one), or `None` with no resume. Never tailors. **Built** |
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
                                    fetch_next_application, set_stage, remove_queued, pick_resume; later record_run
    pipeline.py     layer 2:        get_matches, start_batch, queue_job, dequeue_job, list_applications,
                                    get_application, next_application, record_fill, finish_application
                                    (and re-exports the steps below, so callers name every step as pipeline's)
    stages.py       layer 2:        the checks every step starts with (open_application, get_application),
                                    NotFound, WrongStage
    written.py      layer 2:        written answers: ask_questions, save_answers, save_own_answer, answer_bank,
                                    next_to_write, unanswered_questions
    resume.py       layer 2:        the resume an application sends: choose_resume, prepare_resume
backend/app/routers/auto_apply.py   layer 3: the routes. Every router lives in app/routers/
the MCP server                      layer 3, later: its own small program that calls the routes
```

`app/auto_apply/` holds functions that take a session, so it is its own
kind of folder (`backend/CLAUDE.md`, Code layout). `prepare_resume` calls
`services/sent_resumes.py` for the file, never Storage or Tectonic itself, so
a sent resume from auto apply follows the same rules as one from Apply.
`fetch_recommended` stays in `routers/jobs.py`, since the Jobs page uses it
too; layer 2 imports it from there.

### 5.5 The extension's functions

The extension's steps run in the student's Chrome, outside these layers. They
read and write the queue through the routes, like any other caller.

```js
runBatch()                       // parent: a loop, nothing else
  → nextApplication()            // GET from the API
  → openApplicationTab(url)      // the run's own background tab, reused
  → prepareResume(jobId)         // POST to the API: the sent resume and its file
  → fillForm(tabId, file)        // the field engine that exists, plus the file
  → waitForDecision(tabId)       // the student clicks "Submitted" or "Skip"
  → finishApplication(...)       // POST to the API
```

---

## 6. Match (built)

The run applies to the student's matches. Matching already exists and is
reused: it scores every listed job posting against the student's
**experience bank** (KAN-212) and its embedding. It reads no resume at all,
uploaded or built. So matching and the resume are separate: the bank decides
which job postings a batch gets, and "The resume" decides what file each
application sends. A student with an empty bank cannot start a batch, even
with resumes.

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
   this, every click returns the same 10. `get_matches` and `start_batch`
   set `JobFilters.no_application_by`, so a job posting with an application
   at any stage is never scored, a saved one (KAN-261) too: saving never
   queues a job by itself. Only the student's own Auto Apply click queues a
   saved job, which moves it to `queued`.
3. **Freeze the batch at Start.** Pick the 10 once and save them as `queued`
   applications. New job postings arrive every 3 hours and scores change, so
   a list read during the run could change under it. A saved batch also lets
   Pause, Resume and a Chrome crash continue with the same 10.
4. **Use the student's filters.** Matching reads the experience bank only, not
   location, visa or start date. Pass the student's preferences as
   `filters=`, or let them set filters on the Auto Apply page.
5. **Keep one job posting per company and title.** Some roles are listed
   once per office.
6. **Only hiring systems the extension fills: Greenhouse, for now.** The
   matches, a batch and a job's Auto Apply button take a job posting only
   when its `apply_url` host is a `greenhouse.io` one
   (`backend/app/auto_apply/hosts.py`, the one list; the SQL condition and
   `JobListing.auto_apply` both read it). A company's own careers page that
   embeds Greenhouse (`?gh_jid=`) stays out: the run would land on the
   company's page, not the form. Add a hiring system there once its fill
   works. This reverses an earlier choice to queue every hiring system and
   let unfillable ones fail to `needs_you`: a student saw a Workday or
   Ashby job queued that the run could only fail.
   **Job boards** (KAN-376): a job posting on LinkedIn, Indeed or another
   job board (`JOB_BOARDS` in `hosts.py`) is never opened, since their
   terms ban automated applications. When its text names the employer's
   own form on a hiring system the extension fills, that form is the job's
   `form_url` (`FORM_URL` in `queries/jobs/filters.py`) and the job is
   queued; the extension opens `form_url`, never the job board. Otherwise
   queueing it is a 404 whose detail says why. A company's own careers
   page is never followed through its text.

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
 next ─▶ resume ─▶ opening ─▶ filling ─▶ waiting ─▶ recording ─▶ next
                     │          │          │
                     ▼          ▼          ▼ tab closed = Skip
                   failed     failed
```

1. **next.** The runner asks the API for the next queued application. None
   left: the run goes idle.
2. **resume.** The runner calls `prepare_resume`. The API picks the resume,
   keeps it as a sent resume for this job posting and answers its file: the
   PDF itself (`data`, base64) for a built resume, or a 5-minute link
   (`url`) for an uploaded one, which the background worker downloads at
   once. No resume: the
   run fills the form without one ("The resume"). The run never tailors.
3. **opening.** It opens `apply_url` in the run's tab ("Chrome limits")
   and waits for the tab's `complete` status. Limit: 30 seconds.
4. **filling.** It injects the content scripts (as the popup does today) and
   sends `fill/start` with the file. The content script fills, attaches
   the PDF, and replies with the counts and the report. Limit: 60 seconds.
5. **waiting.** The overlay shows what was filled, what failed and what was
   skipped, and two buttons. The runner waits for `student/decision`, with
   no time limit. Closing the tab counts as **Skip**.
6. **recording.** The runner saves an autofill run. **Submitted** moves the
   application to `applied` and sets `applied_on`. **Skip** moves it to
   `skipped`, so the next batch does not pick it again.

**failed** saves the run with the reason ("page did not load", "no form
found", "sign-in needed") and moves the application to `needs_you`. The run
goes on to the next one. Live Activity shows it under "Needs You".

The extension cannot reliably tell that the student submitted: hiring
systems show different confirmation pages. That is why the student clicks
**Submitted**. Detecting each hiring system's confirmation page can come
later, one hiring system at a time. (Batch apply does detect it, from each
hiring system's answer to the submit: 8.4, KAN-374.)

Workday asks for an account on each company's site. The runner never
creates one: it fills the sign-in form and the student presses the button
(KAN-373, "Workday sign-in" in 8.4).

### 8.3 The first fill: Auto Apply starts the extension's fill (KAN-305)

**Built** (KAN-305), untested live. The smallest step that joins the runner to the fill engine that
exists. A job card's Auto Apply (and Start Auto Apply, which sends the same
message) opens the application in the run's background tab, as today, and
then the runner starts the extension's own fill in that tab: the same fill
that the popup's "Autofill This Page" starts. It adds no route, no message
type and no change to the content scripts.

```
 job card: Auto Apply
   │ queueJob (API)                              the job is queued, as today
   │ run/open ──────────────▶ runner (runner.js)
   │                            1. me()                         401 → signed_out
   │                            2. GET .../applications/next    none → queue_empty
   │                            3. open apply_url in the run's tab, wait for `complete`
   │                               (the tab already shows this job → no reload, no fill: kept)
   │                            4. wait for the form, 10 s      none → fill failed: no_form
   │                            5. inject the fill engine       refused → fill failed: not_allowed
   │ ◀── { opened, jobId, url, fill } ── answers once the fill has started
   ▼
 the card reads Working in Browser; the overlay in the tab shows what was filled
```

**"Is the extension active?" is the answer to `run/open`.** The webapp sends
no `ping` first: a ping adds a round trip, the state can change between the
ping and the open, and `run/open` must handle every case anyway.

The webapp does not show a failed fill or `not_installed` on the job card
yet; the column below is the plan for that warning.

| Answer to `run/open` | Means | The job card shows |
|---|---|---|
| No answer (`not_installed`) | No extension at the id, or the student turned it off | `openedNote`'s "Install the WorkIt extension...", under the button. Today the card is silent on this; a click on Auto Apply asks for a fill, so silence hides why nothing happens. The job stays queued |
| `signed_out` | The extension cannot read a fresh session | The note that exists |
| `queue_empty` | Nothing to open | Nothing |
| `opened`, `fill: "started"` | The tab loaded and the fill began | Working in Browser |
| `opened`, `fill: "kept"` | The tab already showed this job: no reload, no second fill | Working in Browser |
| `opened`, `fill: "failed"`, `reason` | `no_form` or `not_allowed` | Working in Browser, and a line: the application is open but was not filled; open the tab and use the extension's button |

**The decisions:**

- **The runner starts the fill, never the webapp.** The webapp sends
  `run/open` and names no tab, URL or file, so the `externally_connectable`
  channel stays as narrow as it is (`background.js`). A web page cannot
  reach into a hiring system's tab anyway.
- **The fill is the popup's fill, unchanged.** The runner calls
  `chrome.scripting.executeScript({ target: { tabId }, files })` with the
  popup's file list. `content-script.js` runs on injection: it reads
  `profile/get`, fills, and mounts the overlay. The file list moves from
  `popup.js` to one module in `src/shared/`, which the popup and the runner
  both import, so the two can never inject different files or a different
  order.
- **Fill only a page the runner loaded in this call.** When the tab already
  shows the next application (`saved.jobId === jobId`), the runner injects
  nothing. A second fill would write over what the student changed and
  mount a second overlay. A student who reloads the tab by hand fills it
  from the popup.
- **Wait for the form before the fill.** `content-script.js` reads the
  fields once, when it is injected, and Greenhouse can draw its form after
  `complete`. So the runner first injects a small function that resolves
  when a form field (`#first_name`, or an `input`, `select` or `textarea` in
  a `form`) exists, or after 10 seconds. It waits with a `MutationObserver`,
  never `requestAnimationFrame`, which a hidden tab does not run ("Hidden
  tabs run slowly"). No field: `fill: "failed", reason: "no_form"`. A closed
  job posting's page lands here too.
- **Do not wait for the fill to end.** The form wait already proves the
  runner may inject (a refused injection shows there as `not_allowed`), so
  the runner then injects the engine's files and answers at once. The
  answer says that the fill started, not what it filled; the overlay shows
  that.
- **Take the student to the tab for the fill** (replaced by 8.4). A hidden
  tab filled its text fields but not most dropdowns with the pre-engine
  filler. So once the form was ready, the runner made the run's tab active.
  The Fill engine fills hidden tabs as well as shown ones, so batch apply
  never shows a tab (8.4).
- **Host permission for Greenhouse.** `activeTab` covers only a tab the
  student opened the popup on, never one the runner opened. So
  `manifest.json` adds `https://*.greenhouse.io/*` to `host_permissions`:
  the same hosts as `backend/app/auto_apply/hosts.py`, the one list of the
  hiring systems auto apply takes ("The batch"). A hiring system added there
  is added to the manifest in the same change. An unpacked extension gets
  the new permission when the student reloads it in `chrome://extensions`.
  The manifest also lists the six other hiring systems the extension fills
  from its popup (KAN-341): its background fetches their job APIs, and
  injects Workday's fill again when a step loads as a new page. Auto apply
  still takes Greenhouse alone until `hosts.py` adds them.
- **The resume is the profile's for now.** The fill attaches what the
  popup attaches: the default resume (`resolveResumeFile`). It does not
  call `prepare_resume`, so it does not yet attach a tailored resume (11.3)
  and keeps no sent resume. The next step sends `prepare_resume`'s file
  with `fill/start` (9.2).
- **The stage stays `queued`.** Nothing finishes the application yet, so
  the next `run/open` finds the same job in the tab and leaves it. The
  overlay's Submitted and Skip and `POST .../finish` come next.

**Learned in the first live runs:** only the name fields filled, every
dropdown said "No options appeared", and the resume did not attach. The
fill engine waited with `requestAnimationFrame`, which a hidden tab never
runs. It now waits on DOM changes, and its typing does not use timers in a
hidden tab. Even then most dropdowns stayed empty in a hidden tab, so the
fill now runs with the tab shown (above), and the dropdowns fill. The waits stay fixed, so a fill
the student leaves early still finishes its text fields.

**Changes, by file:**

| File | Change |
|---|---|
| `autofiller_extension/src/background/runner.js` | Steps 4 and 5, and `fill` in the answer |
| `autofiller_extension/src/shared/` (one new module) | The content-script file list, out of `popup.js` |
| `autofiller_extension/src/popup/popup.js` | Imports the list |
| `autofiller_extension/manifest.json` | `https://*.greenhouse.io/*` in `host_permissions` |
| `autofiller_extension/CLAUDE.md` | The runner section: it now fills; the user-triggered rule (the Auto Apply click is the trigger); the host permission |
| `frontend/src/lib/autofill-extension.ts` | `fill` and `reason` in `OpenApplicationResult` |
| `frontend/src/app/(seeker)/auto-apply/` | Later, with the warning: `opened-note.ts` says a failed fill; the job card shows `not_installed` and a failed fill |
| `frontend/docs/screens.md` | Auto Apply: what a click does now |

### 8.4 Batch apply: five tabs at once (KAN-370)

**Built.** Replaces 8.3's one tab, one application at a time
(`autofiller_extension/src/background/batch.js`). `run/open` starts the
batch, or tops it up: the extension opens the queued applications in
background tabs in the student's window, at most **five filling at once**,
and the next queued one opens as soon as one finishes. Each finished tab
goes into one of two tab groups:

| Group (Chrome colour) | When |
|---|---|
| Ready (green) | Every field the form needs shows an answer |
| Needs you (orange) | A field failed, a required one is unanswered, the Plan left the student a note, a Workday step waits, or the job system has no Filler (nothing filled) |

A tab moves between the groups when that changes: the content script reads
back, through the engine, every required or failed field the student
edits. The student reviews each tab and presses the employer's Submit.

**Tab states and the stage column.** The API keeps the queue, its order and
each application's stage; the extension keeps only which tab shows which
job (`chrome.storage.local`, so a batch outlives Chrome: KAN-373 below).

| Tab state | `job_applications.stage` | Written by |
|---|---|---|
| queued, filling | `queued` | `POST .../applications`, a batch |
| ready | `queued` (it waits for the student's submit) | `PUT .../fill {"state": "ready"}` |
| needs_you | `needs_you` | `PUT .../fill {"state": "needs_you"}` |
| submitted, skipped, failed | `applied`, `skipped`, `needs_you` | `POST .../finish` (KAN-373, KAN-374) |

The next tab's job is `GET .../applications/next?skip=...`, past every job
the batch opened. No migration: what outlives a tab is the browser's
(which tab shows which job), kept in the extension's local storage.

**Resuming (KAN-373).** When Chrome starts again, or Start Auto Apply is
pressed after the batch's window was closed, the batch resumes. A tab
Chrome restored is found by its link and keeps its job, state and group,
and is not filled again; a job still filling when Chrome closed fills in
its restored tab, or opens again; a finished job whose tab is gone leaves
the batch. Then the queue goes on. A batch with no tab left has ended, and
the next Start begins a new one.

**Workday takes one slot.** At most one Workday application is in the batch
at a time: its pages each wait on the student (sign-in, then Save and
Continue). A queued Workday job met meanwhile waits and opens when that one
leaves the batch (closed, skipped or submitted); other job systems keep
filling beside it.

**Workday sign-in.** On a Workday Create Account or Sign In form, the
content script fills the student's email and a strong password unique to
that company's Workday (its tenant), made the first time and kept only in
the extension's `chrome.storage.local` on the student's computer: never sent
to WorkIt's servers (Chrome may offer to save it too). The student presses
Create Account and opens the verification email; the extension never
presses it. Later visits fill the saved login. The tab sits in Needs you
with "Sign in to continue" until the application's first step shows, and the
fill then goes on by itself (on a page signing in loads, too: the tab is
remembered for Workday's re-injection). Never one password shared across
companies, never a password on a server.

**Skip** is on a batch tab's panel: the application goes to `skipped`, its
tab closes, and the next queued one opens. Closing a tab is not Skip.

**The tabs fill hidden.** Checked 2026-10-25 with Chromium started directly
(Playwright keeps every page it drives visible): five saved Greenhouse forms,
and five live ones (filled only), filled in hidden tabs at once gave the same
fields as each filled in turn while shown. 8.3's hidden-tab failure was the
pre-engine filler's: it gave a dropdown 3 seconds while a hidden tab ran its
timers about once a second. Focus is not needed: react-select opens on the
engine's press though a page without focus fires no focus event.

**The panel waits for the fill.** The overlay mounted before Greenhouse's
React app took over the document (hydration) made React draw the form again,
dropping what was typed: with five tabs starting at once, the first box
filled read back empty in 1 to 10 forms of 50; in none once the panel went
on after the fill.

| Message | Direction | Body |
|---|---|---|
| `run/open` | webapp → extension | `{}`; answers `{ opened, jobId, jobIds, url, fill: "started" \| "kept" }` or why not |
| `run/status` | webapp → extension | `{}`; answers `{ jobId, jobIds }` |
| `run/show` | webapp → extension | `{ jobId }`; switches to that job's tab |
| `batch/state` | content script → background | `{ state: "ready" \| "needs_you" }` |
| `workday/login` | content script → background | `{ create }`; answers `{ email, password, made }`, the login for the page's Workday tenant (a new password for Create Account when none is saved) |
| `batch/skip` | content script → background | `{}`: the panel's Skip. The application goes to `skipped` (`POST .../finish`), its tab closes, the next one opens (KAN-373) |
| `batch/watch` | content script → background | `{}`; the engine starts watching the page for the student's submit |
| `batch/submitted` | content script → background | `{}`; the student's submit sent the application: mark it applied |
| `fill/read` | content script → background | `{ site, questions, names }`; answers what each field shows |
| `batch/questions` | content script → background | `{ questions: [{ name, label, required, max_length }] }`: the tab's questions that need writing, sent to the API for the student's Claude (KAN-377, 14.6); answers them with any saved answers |
| `batch/answers` | content script → background | `{}`; answers the tab's questions with the answers saved so far |
| `batch/own-answer` | content script → background | `{ name, label, answer, own }`: the student's words in a written answer (KAN-379), kept as the application's answer and reused on later forms (`PUT .../answers`); `own` false for an edit of an answer WorkIt filled |

**The student's submit marks it applied (KAN-374).** Built. Replaces 8.2's
**Submitted** button: the extension still never submits, but reads each
hiring system's own answer to the student's submit, through the Fill
engine's signal for it (`submitResult` on the submit's response, read in the
page; a success or failure notice; `submittedPage` for the confirmation page,
Lever's only signal). On success the batch keeps the resume the fill attached
as the application's sent resume (`PUT .../resume`), finishes it as
`submitted` (`applied`), and takes the tab out of its group. A refused submit
leaves the stage alone, shows the hiring system's words in the tab's panel,
and moves the tab to Needs you.

Next: Workday one slot at a time, Skip and resuming a batch (KAN-373).

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
| runner → tab | `fill/start` | `{ jobId, resume: { name, type, base64 } \| null }`. The file goes as base64: a message carries JSON only |
| tab → runner | `fill/result` | `{ filled, failed, skipped, report, resumeAttached }` |
| tab → runner | `student/decision` | `{ decision: "submitted" \| "skipped" }` |

## 10. Chrome limits

### 10.1 Host permissions

`activeTab` covers only a tab the student opened the popup on. The runner
opens tabs itself, so it needs host permissions for the hiring systems.

- **Prototype: required `host_permissions`** for the hiring systems auto
  apply takes (`hosts.py`): `*.greenhouse.io` only, for now (8.3). Each
  hiring system added there adds its host here. Chrome shows one warning at
  install.
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
  `{ state, applicantId, applicationId, tabId, step }`. When the
  worker starts again, it reads the cursor and continues from that step.

### 10.4 Hidden tabs run slowly

Chrome slows timers in hidden tabs and stops page redraws. Some dropdowns wait
for a redraw. The run's tab is hidden all the same:

- Batch apply opens **a background tab per application**
  (`chrome.tabs.create` with `active: false`) in the WorkIt tab's window,
  five filling at once (8.4). The student stays on the page they were on.
- **Never a new window.** The first build opened one with `focused: false`
  to keep the tab visible. From a full-screen window on macOS, the new
  window got its own Space and macOS switched the student to it. No Chrome
  API prevents this, and a minimized window is hidden too.
- The tab is set `autoDiscardable: false`, so Memory Saver never throws
  away a half-filled form.
- The tabs open, load and **fill hidden**, five at a time (8.4); the
  student is never taken to one. 8.3's runner showed its tab for the fill
  because the pre-engine filler left dropdowns empty in a hidden tab; the
  Fill engine does not. The fill waits on DOM changes
  (`MutationObserver`) and timers, never on redraws.

---

## 11. The resume

### 11.1 What exists

The resume builder on `main` (KAN-181, 207, 208, 217, 220) replaced this
section's earlier plan: a `tailor_resume` in `scout/`, an fpdf2 render and a
`resumes.tailored_from_id` column. **Do not build those.** The run reuses
what exists:

- **Base resumes** are built from the experience bank (Generate) and
  rendered to PDF with Tectonic. The student stars one as the default.
- **Tailor** (KAN-217) works on one job posting at a time. `POST
  .../tailor` proposes changes; the student accepts or rejects each one;
  `POST .../tailor/done` saves the job posting's one tailored resume. The
  truth rule (`services/truth_rule.py`, `invented`) drops a wording with a
  number or a tool that is in neither its original bullet nor the bank's
  skills, and Done refuses one (422). Identity fields never reach the model.
- **Sent resumes** (KAN-208) keep every resume a student applies with (a
  download keeps nothing since KAN-267): a built resume as a snapshot
  rendered again on open, an uploaded one as its own file. Unchanged
  content returns the last sent resume.
- **Apply** on the job posting page (KAN-220) offers the tailored resume
  first, else the default, and keeps the one sent as a sent resume linked to
  the job posting.

### 11.2 Tailor stays out of the run

Tailor is finished for its own use: one job posting, with the student
(`backend/tests/test_tailor.py`). It is not a step the run can take, for
three reasons:

1. **The limit.** A student has 2 Tailor runs per UTC day
   (`AI_TAILOR_CAP`), and Tailor has 40% of a daily pool of 1,000 uses
   across all students. A batch has 10 applications.
2. **The review.** Tailor saves only the changes the student accepts. A run
   with nobody watching would have to accept them all, and the truth rule
   checks numbers and tools, not claims ("Open questions").
3. **The time.** Each Tailor run is a model call of several seconds.

So **the run never tailors**. It attaches a tailored resume when the student
made one with Tailor.

### 11.3 Picking the resume

`pick_resume` takes the first that exists:

1. **The resume tailored to this job posting.** The student made it for this
   job posting and reviewed every change.
2. **The default resume.** The one the student starred, a base resume or an
   uploaded file. There is only one: starring a resume clears the other
   kind's pointer. An uploaded default with no stored file counts as none.
3. **None.** The run fills the form without a resume, and the overlay says
   "No resume attached", so the student can attach one by hand. The
   application does not go to `needs_you`: the rest of the form is filled.

This is Apply's order (11.1), so a job posting gets the same resume from
the Apply button and from auto apply. Apply then falls back to the first
resume in its list; the run does not guess, so a student with resumes but no
default gets none; Up Next shows no resume on its rows, and the student
can pick one per job there (11.3.1). The run never
generates a base resume: that is slow, and the student never asked for
it.

### 11.3.1 The student's own pick (KAN-359)

On the Auto Apply page, a click on a queued job's resume opens the Apply
dialog's resume lists, and the pick is kept as Apply keeps one: a sent
resume from that resume, linked to the job posting and named by the
application (`choose_resume`, `PUT .../applications/{job_id}/resume`).
`prepare_resume` then sends the student's pick, read back from that link
(`chosen_resume`), in place of `pick_resume`'s, from the resume's current
content. A link an earlier run made reads the same way: that run's own pick.
A source deleted since falls back to `pick_resume`.

**Still open:** the extension attaches the default resume itself
(`resolveResumeFile` in `autofiller_extension/src/background/api.js`) and
never calls `POST .../applications/{job_id}/resume`, so neither the rule
nor a pick reaches the form until it does.

### 11.4 Keeping the file

`prepare_resume` keeps the file as a sent resume linked to the job posting,
as Apply does:

- **The student sees what went out.** The job posting page's "You sent
  <name> on <date>" shows it, the same as for Apply. (The Resumes view's
  Sent list showed it too, until it was removed on 2026-10-18.)
- **A retry makes nothing new.** When Chrome closes and the run starts
  again, unchanged content returns the same sent resume.
- **It is fast.** A built resume renders in the request (Tectonic, about
  0.3 s); an uploaded resume makes no new file.
- **The link lasts 5 minutes.** The background worker downloads the file at
  once and never stores the link.
- **No new column.** An application's resume is the last sent resume for
  its job posting, so `job_applications` needs no `resume_id`.

### 11.5 Later

- **Tailor before Start.** Live Activity links each queued application to
  its job posting's Tailor screen, so the student tailors the ones that
  matter, within the daily limit, before the run.
- **Show the pick per application.** Live Activity names the resume each
  queued application will get (`pick_resume`, read only).

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
| `stage` | enum `application_stage` | `saved` (KAN-261, `17ea74fa4573`), `queued`, `needs_you`, `skipped`, `applied`. Default `applied`, for the Applied button's older inserts; a queued or saved insert names its stage and writes `applied_at` NULL. Rows from before are `applied` |
| `created_at` | timestamptz | When the row was made: the queue's order. Queueing a saved row moves it to now, so a job saved last month doesn't jump the queue |
| `applied_at` | timestamptz **null** now | Set when the student clicks **Submitted** or the Applied button; `NULL` while queued. A CHECK keeps an `applied` row dated |

- **The Jobs page hides `applied` rows only** (`JobFilters.applied_by`). A
  saved or queued job stays on it; matches leave out every stage, saved too
  (`JobFilters.no_application_by`).
- **The Applied button turns a saved, queued, skipped or needs_you row
  applied** (`mark_applied`, an upsert); an applied row keeps its first date.
- **A saved row is the Save button's, not a run's** (KAN-261). A batch
  never picks it. A job's own Auto Apply click does: `queue_applications`
  turns it `queued` (`ON CONFLICT DO UPDATE ... WHERE stage = 'saved'`) and
  leaves every other stage alone; Save never moves a
  later stage back, and Unsave deletes a saved row only. Live Activity asks
  for every stage but saved. Taking a queued job out of the queue deletes
  its row, so a job that was saved before it was queued is no longer saved.
- **A closed job posting keeps its application.** Closing is a status, not
  a delete, so the row and the listing stay; `fetch_next_application` passes
  over it and `GET .../applications` marks it `open: false`. Only a deleted
  job posting deletes its rows (CASCADE).
- **Later columns**, when their steps are built: `match` (the score when
  queued). No `resume_id`: the resume is the sent resume linked to the job
  posting ("The resume"). The tracker's stages (`interviewing`, `offer`, `rejected`) are a
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

### `autofill_answers`

**Built** (KAN-283): one JSONB bank of answers per student for the questions
hiring systems repeat, `backend/app/models/CLAUDE.md`, "The answer bank".
Onboarding's Profile step fills it, and My Profile's Application Questions
edits it later (KAN-269): work authorization, sponsorship,
citizenship and visa status, security clearance, gender, Hispanic or
Latino, race, veteran status and disability. Contact details and links are not in it: auto apply reads
them from `applicant_profiles`, their one home. `GET` and `PATCH /applicants/{id}/autofill-answers` read and
write it, a key at a time. Still to do: the extension fills forms from it,
and start date and the other repeated questions get keys. Without it, every
form stops at those questions, and the fill rate stays low.

### `written_answers` (built, KAN-377)

One row per question an application's form needs written, primary key
`(applicant_id, job_id, name)`, deleted with its application (CASCADE).
`name` is the form field's name in the Fill engine's Question set, so the
open tab knows where an answer goes; `label`, `required`, `max_length` (the
form's own limit) and `position` (the form's order) come from the tab;
`answer` and `answered_at` from the connector's save (14.6), or from the
same save when the student pastes an answer on the Written Answers page
(KAN-385), or from the student's own edit in the tab, which sets `own`
(KAN-379): their Claude's save never overwrites it, and later forms reuse
it first. A row per
question, not JSONB on the application: the connector's "oldest application
with a question left" is one SQL query, and saving one answer rewrites no
other.

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
| DELETE | `/applicants/{id}/applications/{job_id}` | `dequeue_job` | Takes a queued job out of the queue; 204. 404 with no application, 409 past queued. **Built** |
| GET | `/applicants/{id}/applications` | `list_applications` | Live Activity and later the tracker. `?stage=` repeats. **Built** |
| GET | `/applicants/{id}/applications/next` | `next_application` | What the runner fills next, or `null`. `?skip=` repeats: the jobs batch apply already has open in its tabs (KAN-370). **Built** |
| GET | `/applicants/{id}/applications/{job_id}` | `get_application` | One application, as the list has it; 404 without one. Registered after `/next`. **Built** |
| PUT | `/applicants/{id}/applications/{job_id}/fill` | `record_fill` | How a batch tab's fill left the form (KAN-370, 8.4): `{"state": "needs_you"}` moves it to `needs_you`, `{"state": "ready"}` back to `queued`. 404 with no application, 409 when not queued or needs_you. **Built** |
| PUT | `/applicants/{id}/applications/{job_id}/questions` | `ask_questions` | The questions a batch tab's form needs written (KAN-377, 14.6), kept for the connector; a question asked again keeps its answer. 404 with no application, 409 when not queued or needs_you. **Built** |
| GET | `/applicants/{id}/applications/{job_id}/questions` | `written_answers` | Those questions with the answers the student's Claude saved (`answer`, null until then); the open tab fills each new one. **Built** |
| PUT | `/applicants/{id}/applications/{job_id}/answers` | `save_own_answer` | The student's words for one written question in its tab (KAN-379, `{name, label, answer, own}`): replaces the application's answer. `own` true (a field WorkIt didn't fill, or what it filled replaced) marks it `own`; false (an edit of an answer WorkIt filled) keeps it not own and runs the connector's checks (422 with reasons). 404 with no application. **Built** |
| GET | `/applicants/{id}/applications/{job_id}/answer-bank` | `answer_bank` | The answers saved on the student's other applications this form may reuse, `{wording: {answer, own}}`: the Fill engine's Answer bank for its Plan (KAN-379; never one about another company, KAN-380). 404 with no application. **Built** |
| GET | `/applicants/{id}/written-questions` | `unanswered_questions` | Every open application's unanswered written questions, by job posting, oldest first: the Written Answers page for a student without Claude (KAN-385). **Built** |
| PUT | `/applicants/{id}/applications/{job_id}/written-answers` | `save_answers` | Answers the student pasted there, `{"answers": [{"name", "answer"}]}`, all or none, through the connector's own save and checks; the open tab fills them as it fills Claude's. 422 with `{"message", "reasons": {name: [...]}}` when one fails. **Built** |
| POST | `/applicants/{id}/applications/{job_id}/finish` | `finish_application` | `{"outcome": "submitted" \| "skipped" \| "failed"}`; 409 when not queued or needs_you. **Built**; takes the autofill run's report once `autofill_runs` exists |
| POST | `/applicants/{id}/applications/{job_id}/resume` | `prepare_resume` | Picks the resume and keeps it as a sent resume for the job posting. Answers the sent resume and a 5-minute link, or `null` with no resume. 404 with no application or a closed job posting, 409 when not queued or needs_you, 503 when the PDF cannot be made, 502 when Storage refuses the file. **Built** |

An application is named by its job id: the row's key is `(applicant_id,
job_id)`, and the applicant is in the path. `/jobs/recommended/{id}` stays
the Jobs page's route; it does not leave out queued jobs.

**No background step.** The `resume` route renders inside the request
(about 0.3 s) and calls no model.

---

## 14. MCP access and billing

### 14.1 What an MCP server is, here

An MCP server publishes a list of tools. An AI agent reads the list and
decides by itself which tools to call, and in which order. **The agent
becomes the parent of the layer-2 steps.** So:

1. **Expose layer 2, never layer 1.** If `send_built` were a tool, an agent
   could keep a resume for a job posting with no application, skipping the
   stage check.
2. **Expose few tools.** A short list is easier for an agent to use well.
   Suggested: `get_matches` (read only), `start_batch(size)` (queues and
   returns at once), `get_batch_status` (each application's stage; the agent
   polls it), `skip_application(id)`, `dequeue_job(id)`.
3. **Not one "do everything" tool.** Tailoring takes a model call and the
   student's review per job posting. The student fills and submits
   in Chrome over many minutes, and a tool cannot wait for that. And the
   agent could not stop between steps to show the student the matches.
4. **Inputs and outputs are ids and plain data.** An agent can only pass
   along what a tool returned to it.
5. **The stage checks are the real guarantee** (5.1). Which tools the MCP
   server lists makes the list easy to use. It does not make the order safe.
6. **The MCP tools call the routes, not the Python functions.** The routes
   check ownership, and the MCP server may run where there is no database
   access. Host it at WorkIt, so we control and update it. *Changed by
   KAN-377 (14.6): the connector runs inside the API and its tools call
   layer-2 functions, each checking that the token's student owns what it
   names, as a route does. A second service calling the routes would need
   its own deploy and a Supabase session to call them with.*

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
user signs in, and pastes nothing. It is better for users and more work.
*KAN-377 built OAuth instead (14.6): Anthropic's connector directory takes
OAuth only, and a key pasted into Claude is one more thing a student can
get wrong. No API keys.*

### 14.3 Billing: charge the action

Reading routes are free: they show what the webapp shows. **What costs money
is auto-apply itself**: a batch, its fills, the tailored PDFs. So the plan
limit sits in the layer-2 step that does the action (`start_batch`,
`prepare_resume`), not in the route or the MCP server. Every caller
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
`get_tailoring_task(application_id)` returns the bank facts, the job
description and the rules; the agent proposes the changes;
`submit_tailored_resume(application_id, changes)` runs the truth rule and
saves them as Tailor's Done does. Our model cost for MCP users is then
close to zero.

- **Never trust the agent's output.** The truth rule stays on our server.
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

### 14.6 The connector (KAN-377)

**Built, as the batch apply design's AI route** (KAN-369): WorkIt pays for
no model. The student adds WorkIt's remote MCP server to their own Claude
and runs the prompt "Write my WorkIt answers"; their Claude reads one
application at a time and saves its answers, and each answer fills into
the batch tab that asked for it.

**Where it runs.** Inside the API (`backend/app/connector/`), on the
official MCP Python SDK (`MCPServer`, Streamable HTTP, stateless, JSON
answers), at `<api>/mcp`. No second service. The SDK's session manager runs
in the API's lifespan (`app/main.py`); Vercel runs FastAPI lifespans, and
so does uvicorn in the container. `CONNECTOR_API_URL` and
`CONNECTOR_WEB_URL` (`app/config.py`) say where the API and the webapp are
reached from outside; production sets both.

**Sign-in: WorkIt is its own OAuth 2.1 authorization server.** The SDK
serves the endpoints at the API's root: `/.well-known/oauth-protected-resource/mcp`,
`/.well-known/oauth-authorization-server`, `/register` (dynamic client
registration, which Claude uses), `/authorize` (PKCE), `/token` and
`/revoke`. `app/connector/oauth.py` is the provider behind them, on three
tables (`connector_clients`, `connector_requests`, `connector_tokens`).

1. Claude calls `/mcp` with no token, gets a 401 naming the resource
   metadata, finds the authorization server, and registers itself.
2. It sends the student's browser to `/authorize`, which keeps the
   sign-in for 10 minutes and sends the browser to the webapp's consent
   page, `/connect/claude?request=<id>`.
3. The page, signed in with the student's normal Supabase session, shows
   who asks and calls `POST /connector/requests/{id}/approve` (or `/deny`).
   The API gives a code and answers the client's redirect URI; the page
   sends the browser there.
4. Claude trades the code at `/token` for an access token (1 hour) and a
   refresh token (90 days). Each refresh rotates both.

Tokens are random strings, not JWTs; only their sha256 is stored. A
connector token reaches `/mcp` only, and a Supabase session token is not a
connector token. Student accounts only.

**Tools and the prompt** (`app/connector/tools.py`). Each tool finds the
student from the token and calls one layer-2 step; inputs and outputs are
ids and plain data.

| Name | Kind | Does |
|---|---|---|
| `get_next_application` | tool, `readOnlyHint` | The oldest open application (queued or needs_you, posting open) with a written question unanswered (`next_to_write`): its job id, company, title, the posting's description, its unanswered questions (`name`, `question`, `required`, `max_length`), and the student's experience bank and skills (`bank_context`, no links). Only that application's material. `job_id: null` when none is left. Takes and answers a `chat` value (the job ids this chat was given, below); past `CONNECTOR_CHAT_CAP` it answers `start_new_chat: true`, a `message` for the student, and no application |
| `save_answers` | tool, a write (not destructive) | `{job_id, answers: [{name, answer}]}` (`save_answers`): all or none; refuses a name the application doesn't ask, an empty answer, or one that fails a check in code (`app/auto_apply/checks.py`, KAN-380: machine-made words, a run of 5 words copied from the student's writing samples, a number not in the bank, posting or question, another application's company unless the student worked or studied there (an entry's organization or school; a skill or bullet naming it doesn't count), a sentence over 30 words, a placeholder, or over the form's `max_length`, else 10,000; and Apply's editor checks: words that say how it was written, talk of the posting, time counted from today, "Hence" or more than one signpost word, more than 2 numbers (years aside), low-level detail, a course credited with what the student did; prose checks skip a choice), with every failing answer's reasons, each saying what to change, as one tool error for Claude to fix. Answers `{saved, left, read_first}`: `read_first` names the saved answers the student reads before Submit (`checks.high_stakes`: a question about this company or role, or about what isn't on their resume), WorkIt's form of Apply's high-stakes hold |
| `get_writing_samples` | tool, `readOnlyHint` | `app/connector/style.py` (KAN-384): the student's writing samples, word for word, and the style card saved from them, if any |
| `save_style_card` | tool, a write (not destructive) | `{card}`: adds or replaces the student's style card; refuses one when the student has no samples, or an empty one or one over 4,000 characters |
| "Write my WorkIt answers" | prompt | `app/connector/prompt.py`. The loop (next application, research its company if `get_research_task` names it (KAN-382), write, save, until the tool says to start a new chat) and the writing rules. **The rules live here only**; tool descriptions say what a tool does (Anthropic's review refuses descriptions that steer Claude) |

**The writing rules (KAN-381)** are Apply's pipeline, made general for any
student: a draft by Apply's rules for plain, concrete answers and its
shapes by question type (under 180 words, 220 for a two-part question,
within the form's `max_length`); a review as a recruiter, a hiring manager
and a founder would read it, rewritten until rated 8 of 10, at most two
rounds; a check that lists every claim the sources don't support; and an
edit of all of the application's answers together. Facts come only from
the student's experience bank and the posting. Apply's own facts, examples
and its owner's preferences are left out; a question the sources can't
answer (a preference, a reference, something only the student knows) is
left for the student, never guessed. Banned words stay out of the prompt,
since naming a word primes a model; the save checks them in code (KAN-380, separate).

**The style card (KAN-384).** A student keeps up to three writing samples
on WorkIt (`/applicants/{id}/writing-samples`; add, replace, remove).
`get_next_application` gives `style_card` when one is saved, and
`style_card_needed: true` when samples have no card yet; the prompt then
has Claude read them (`get_writing_samples`), build a card on how the
student writes (sentence length, openings, explanations, transitions,
punctuation, tone, endings, what they never do; examples of at most four
words, no facts) and save it (`save_style_card`) before it writes. Any
change to the samples deletes the card, so the next chat builds a new
one. Without samples, Claude writes in a plain, neutral voice. The card
holds no facts: the rules on sources hold, and the rules win where the
card disagrees. The samples stay on WorkIt for the copying check
(KAN-380, `pipeline.writing_samples`). Tests:
`tests/test_connector_style_card.py`, `tests/test_writing_samples.py`.

**A chat and its cap (KAN-381).** The server is stateless and Claude
sends nothing that names a chat, so the chat carries its own count: each
`get_next_application` answers a `chat` value (the job ids this chat was
given, comma-joined) and the chat passes it back. No value is a new chat.
After `CONNECTOR_CHAT_CAP` applications (5; lower it if the blind read,
KAN-386, finds a chat's last answers worse than its first) the tool says to
start a new chat. A new chat starts at the oldest open application with a
question unanswered, so a batch whose writing stopped at a Claude usage
limit resumes there: answers save all or none per application, so a
stopped application has nothing saved. A chat is never given the same
application twice, so a question Claude left out (no fact for it) can't
hold it. The value isn't signed: it guards only the student's own answer
quality, and one that isn't valid starts a new chat.
Tests: `tests/test_connector_chat.py`.

KAN-380 adds the checks in code on save (above), with `max_length` read
from the live form by the Fill engine's `limits`, and `answer_bank`, which
offers an answer about one company (`checks.company_specific`) on that
company's forms only. **Write early, reuse, keep edits (KAN-379):** when
jobs are queued (the webapp's `run/open`), the extension's `writeEarly`
(`batch.js`) reads each queued job's Question set from its form's link with
the Fill engine (no tab; Workday and Eightfold wait for theirs), plans it
with the job's answer bank (`GET .../answer-bank`) and sends what is left
to write (`PUT .../questions`), so the student's Claude writes before the
tab opens. Every batch tab plans with the same bank, so a question answered
before (by their Claude, or by them) is filled as a Saved Answer and never
reaches their Claude; an application with nothing left is never offered.
The student's own words in a written answer (`PUT .../answers`) are kept
as `own` and win on every later form. Own means written into a field
WorkIt didn't fill, or replacing what it filled: an edit of their Claude's
(or a saved) answer stays not own, is checked as their Claude's save is,
and is never filled on a form that bans AI text. **WorkIt calls no model on this path**: no tool or route of the
connector makes a `workit_scout` `LLM` (tested), and batch tabs never call
the essay-answer route.

**How an answer reaches the tab.** A batch tab whose Plan has questions
that need writing sends them (`PUT .../applications/{job_id}/questions`,
13) and shows each as waiting for the student's Claude. While any is
waiting, the tab asks for the saved answers every 10 seconds
(`GET .../questions`, through the background) and fills each new one
through the engine; the tab's group follows, so it moves to Ready once
nothing else needs the student. A question the student answers by hand
first keeps the student's answer.

**Company briefs** (KAN-382; `app/auto_apply/briefs.py`, tools in
`app/connector/briefs.py`). One brief per company, in `company_briefs`,
shared by every student who applies there and built by the first one's
Claude: WorkIt calls no model for it.

| Name | Kind | Does |
|---|---|---|
| `get_research_task` | tool, `readOnlyHint` | The first company of the student's open applications with a written question left whose brief is missing, older than 30 days, or scores under 60 of 100: the company, the job, why, its score, the categories it lacks, and the news sites a fact may cite. `company: null` when none needs it. A research that was not kept holds the company back 3 days |
| `save_company_brief` | tool, a write (not destructive) | `{company, facts: [{category, fact, url, quote, published, team}]}` for a company the student applies to (else a tool error). WorkIt reads each page through the safe fetcher (`app/services/page_fetch.py`) and keeps a fact only if its host is the company's own (a domain named for it, or its WorkIt profile's website) or a listed news site, its quote is on the page word for word (case, punctuation and spacing folded), and each number the fact states is in its quote; a date whose year the page doesn't show is dropped from the fact. Kept only with 3 or more checked facts and a higher score today than the kept brief. Answers `{saved, score, current_score, kept, dropped: [{url, reason}]}` |

`get_next_application` hands the application's company brief as
`company_brief` (category, fact, url, published, team), described as web
text. **The brief comes first**, as Apply builds it before its essays:
while the next application has a question in words and its company's brief
is missing or older than 30 days, and the company isn't held back after a
failed save, `get_next_application` answers `job_id: null` with
`research_first` naming the company, and the prompt starts its loop again
(get_research_task, save_company_brief). Once a brief is saved or the hold
applies, the application is given. A weak brief doesn't hold it (it was the
best found); an application with only choice questions needs no company
facts and goes out at once. **Score, in code:** 10 per category covered (products, launches,
engineering, team), 4 per checked fact up to 10, 4 per fact whose page is
under a year old up to 5; recency is counted on the day of the comparison,
so a brief scores lower as it ages. **The fetcher** reads http(s) only, on
the default port, the allowed hosts only (checked again on each of at most
3 redirects), never a host that resolves to a non-public address, and
connects to the address it checked (TLS still verified against the host
name), with 10 seconds and 2 MB per page, text types only. Tests use a fake
fetcher (`tests/test_company_briefs.py`); the fetcher's own refusals are in
`tests/test_page_fetch.py`.

**Adding it, and the directory** (KAN-383). Auto Apply's **Add to Claude**
and `/docs/mcp` open Claude's Add Custom Connector dialog with WorkIt's name
and `<api>/mcp` filled in (Anthropic's install link,
`frontend/src/lib/claude-connector.ts`); the student checks and confirms.
Anthropic's connector directory, which removes even that step and lets
Claude suggest WorkIt in a chat, needs every tool to carry a title and a
read-only or destructive hint (tested for every tool), no instructions in
tool descriptions, public docs (`/docs/mcp`) and a privacy policy that
covers the connector (`/privacy`). The submission is written out in
`docs/connector-directory.md`; the team sends it after deploying. Once
listed, `CLAUDE_CONNECTOR_LINK` points every Add to Claude at the listing.

**Why not Supabase Auth's OAuth 2.1 server** (decided 2026-10-25, KAN-377):
its docs call it beta and free "during the beta period", with no price after
it (WorkIt's Supabase is on the Free plan); dynamic client registration is
off until a dashboard setting turns it on on the shared project; its tokens
are Supabase session JWTs, which every other route would also accept, where
a connector token should reach the connector only; and no test could run it,
since the tests' throwaway database has no Supabase Auth.

---

## 15. Cost, quota and privacy

**Cost.** The run calls no model: matching is embeddings and Postgres, and
the resume is rendered. Tailor is the model cost, one call per job posting,
counted as a Tailor use (`backend/app/services/usage.py`): 2 per student per
UTC day, and 40% of a pool of 1,000 uses a day. Raising the Tailor limit for
auto apply is a cost decision, made with the model's price (`scout/CLAUDE.md`,
"Which model, where").

**Privacy.** Only bank facts and the public job description go to the model;
the seam removes identity fields (`load_identity`). The free tiers may train
on prompts, which is why this rule exists.

**Storage.** Sent resumes hold contact details, like uploads. They go in the
private `Resume` bucket. Deleting an account does not delete Storage objects
yet (`backend/CLAUDE.md`, Auth, Still open). This adds more objects to that
gap.

## 16. Decisions

| Decision | Chosen | Rejected, and why |
|---|---|---|
| Who clicks Submit | **The student**, on every application. Each costs one review and one click; no wrong application goes out unseen | The extension: reverses the rule in `autofiller_extension/CLAUDE.md`; CAPTCHAs and bot detection make it fail often; hiring systems' terms prohibit it; a wrong answer reaches an employer under the student's name and cannot be undone |
| How the queue fills | **WorkIt queues a batch of matches** at Start | The student picks each one: slower. Fully automatic: ruled out by the row above |
| Where tailoring runs | **Never in the run.** The student tailors with Tailor, one job posting at a time | In the run, per application: 2 Tailor runs a day, and nobody reviews the changes. A scheduled batch: tailors matches nobody looks at |
| What the Auto Apply page shows | **Jobs first** (KAN-359): Up Next (queued and needs-you jobs), each with its resume and a click to change it, and Add Jobs; History archived | A Resume List of every resume (until KAN-359): the page is about which jobs go out, and each job's own resume says more than the list did. One primary resume: no application is sure to get it |
| Where a student's own pick of a job's resume is kept | **The sent resume the application names** (`choose_resume`, KAN-359), which `prepare_resume` reads back (`chosen_resume`) and sends again from its current content | A `job_applications.resume_id` column: a migration, and a second record of what the sent resume already says |
| Which resume the run attaches | **Tailored, else the default resume** (Apply's order), kept as a sent resume | A new `job_applications.resume_id`: a second record of what the sent resume already says |
| Which job postings auto apply takes | **Only hiring systems the extension fills** (Greenhouse for now, "The batch") | Every one, failing the rest to `needs_you`: the queue filled with jobs the run could only fail |
| Where the run happens | **The student's Chrome** ("Where the run happens") | Our servers |
| How the code is shaped | **Three layers**, so MCP is a thin adapter | One function per screen: an agent could not reuse it |
| What we charge for | **The auto-apply action**, for every caller | Charging MCP access only: users would call the routes directly |

## 17. What changes where

| Folder | Change |
|---|---|
| `backend/` | `app/auto_apply/` (layers 1 and 2), `routers/auto_apply.py` (layer 3); `pick_resume`, `prepare_resume` and the `resume` route; the tables in "Data model"; later the API-key check and usage |
| `frontend/` | Auto Apply page: the port to the runner, Start and Pause wired to it, the session keep-alive; later the resume each application gets and a Tailor link per queued application and the API-key settings |
| `autofiller_extension/` | The runner; `onConnectExternal` for the port; `fill/start` in the content script; file upload; **Submitted** and **Skip** in the overlay; host permissions. Its `CLAUDE.md` changes too: it says the extension adds no backend routes, which stops being true |
| MCP server (new, later) | The tools in "MCP access and billing", each calling one route |

**File upload in the extension:** the background worker downloads the file
from `prepare_resume`'s link and sends it to the content script (base64). The
content script makes a `File`, puts it in a `DataTransfer`, sets the file
input's `files`, and sends `input` and `change` events. Some hiring
systems use a drop zone instead (Workday). Since KAN-340 the Fill engine
(the `fill-engine` submodule, `autofiller_extension/CLAUDE.md`) attaches
files, from the bytes the background passes it; its tests cover each
hiring system's saved forms.

## 18. Build order

Each step ships alone and is about one ticket.

1. **Match**: `fetch_recommended` and `min_match` (done).
2. **The queue** (done): `job_applications.stage`, `app/auto_apply/`,
   `routers/auto_apply.py`, and the webapp on them: the Auto Apply buttons,
   Start Auto Apply and Live Activity (`frontend/docs/screens.md`, Auto
   Apply). The browser queue and Live Activity's fixture are gone.
3. **The resume (backend)** (done): `pick_resume`, `prepare_resume` and the
   `resume` route, with tests (`backend/tests/test_auto_apply_resume.py` on
   real Postgres). No migration.
4. **Extension: file upload**, tested on Greenhouse, Lever and Ashby. They
   host 87% of the job postings in the feed snapshot (`backend/data/feed.json`).
5. **Extension: the runner**, the port, host permissions, and the overlay's
   **Submitted** and **Skip**. Start and Pause go live. Started: `run/open`
   opens the next queued application in the run's background tab, and
   `run/status` and `run/show` drive "Working in Browser" (one-shot
   messages, not yet the port). `run/open` also starts the extension's
   fill in that tab (8.3, KAN-305).
6. **`autofill_runs`**, and Live Activity shows each fill's report.
7. **`autofill_answers`** for screening questions. The bank and its routes
   are built (KAN-283); the extension does not read it yet.
8. **The Auto Apply page and Tailor**: the resume each application gets, and
   a Tailor link per queued application ("The resume", Later).
9. **MCP server**, API keys and billing.

Tailoring with its review, the PDF render and the resume editor are built
(KAN-207, 217, 218). They are not steps here.

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
- **Tailoring without review.** Should a batch tailor its applications with
  nobody accepting the changes? The truth rule sees numbers and tools, not a
  bullet that gained a claim, and the limit is 2 a day. Until this is
  decided, the run never tailors.
- **Skip and the sent resume.** Skip keeps the sent resume, as Apply does.
  The job posting page then says a resume was sent that went to no
  employer. Delete it on Skip instead?
- **The uploaded resume as a fallback.** It is the student's own file, but
  the bank may say more. Ask the student to Generate a base resume first?

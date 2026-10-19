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
> job as Working in Browser. It fills nothing yet.
> Everything else is a plan. The exact function names are a
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
| **Sent resume** | The exact file a student downloaded or applied with, kept in `sent_resumes` (KAN-208). With `job_posting_id` it records what went to that job posting (Apply, KAN-220) |
| **Application** | One student's intent to apply to one job posting, from `queued` to `applied` and after |
| **Batch** | The applications one click of Start Auto Apply queues: 10 by default |
| **Run** | The extension working through the queue, one application at a time |
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
  per company; the student makes it.
- Writing cover letters. The tailoring step can do it later.

## 2. What exists today

| Piece | State | Where |
|---|---|---|
| Job postings | Scraped and imported every 3 hours, with `apply_url` and a full description | `scraper/`, `backend/app/scripts/import_jobs.py`, `docs/job-pipeline.md` |
| Matching | `fetch_recommended()` scores job postings 0–100 against the experience bank, with up to 3 highlights and `min_match`. Also served as `GET /jobs/recommended/{applicant_id}` | `backend/app/routers/jobs.py`, `backend/app/services/matching/` |
| Experience bank | The student's facts, filled by intake and import. Matching, base resumes and Tailor read it | `backend/app/services/bank.py`, `backend/app/routers/bank.py` |
| Base and tailored resumes | Built from the bank and rendered to PDF with Tectonic (Jake's Resume). Tailor proposes changes for one job posting; the student accepts or rejects each | `backend/app/services/built_resumes.py`, `services/resume_render/`, `services/tailor.py`, `frontend/src/app/(seeker)/jobs/[jobId]/tailor/` |
| Sent resumes | `POST .../sent-resumes` keeps the exact file and answers a 5-minute download link. With `job_posting_id` it is Apply | `backend/app/services/sent_resumes.py`, `backend/app/routers/sent_resumes.py` |
| Uploaded resume | PDF or DOCX in the `Resume` Storage bucket. Feeds the bank's import | `backend/app/routers/resumes.py` |
| LLM access | Scout's model chain. Daily uses per student and feature; Tailor has 2 a day | `scout/workit_scout/llm.py`, `backend/app/services/usage.py` |
| Privacy boundary | Identity fields (name, contact details, links) never reach a model: the seam removes them | `backend/app/services/identity.py`, `scout/` |
| Form filling | Chrome extension, started from its popup. Fills text fields, dropdowns and repeated sections. Never submits | `autofiller_extension/` |
| Webapp ↔ extension link | `externally_connectable`. Today it only answers "installed and signed in?" | `frontend/src/lib/autofill-extension.ts` |
| Auto Apply page | "Resume List" (every resume the student has, with the pick rule under it), Start Auto Apply, and Live Activity from the API | `frontend/src/app/(seeker)/auto-apply/`, `frontend/docs/screens.md` |
| Applications screen | Saved and Applied columns live from `GET .../applications?stage=saved&stage=applied` (KAN-261); Interviewing and Offer empty until the API stores those stages | `frontend/src/app/(seeker)/applications/` |

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
| 1, pure | `auto_apply_supported(apply_url)` (`hosts.py`) | Whether the host is a hiring system auto apply fills: Greenhouse for now. `AUTO_APPLY_SUPPORTED` in `queries/jobs/filters.py` is the same rule in SQL, required by the matches and `queue_applications`. **Built** |
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
| 2 | `list_applications`, `get_application`, `next_application` | Thin: `fetch_applications`, `fetch_application` (`NotFound` without one), `fetch_next_application`. **Built** |
| 2 | `prepare_resume(db, storage, applicant_id, job_id)` | Stage check (`queued` or `needs_you`, else `WrongStage`; none, `NotFound`) → `pick_resume` → `send_built` or `send_uploaded` with the job posting → one commit → the sent resume and a 5-minute link, or `None` with no resume. Never tailors. **Built** |
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
                                    get_application, next_application, finish_application, prepare_resume
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
  → prepareResume(jobId)         // POST to the API: the sent resume and its link
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
   keeps it as a sent resume for this job posting and answers a 5-minute
   link. The background worker downloads the file at once. No resume: the
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
| runner → tab | `fill/start` | `{ jobId, resume: { name, type, base64 } \| null }`. The file goes as base64: a message carries JSON only |
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
  `{ state, applicantId, applicationId, tabId, step }`. When the
  worker starts again, it reads the cursor and continues from that step.

### 10.4 Hidden tabs run slowly

Chrome slows timers in hidden tabs and stops page redraws. Some dropdowns wait
for a redraw. The run's tab is hidden all the same:

- The runner opens **one background tab** for the run (`chrome.tabs.create`
  with `active: false`), beside the WorkIt tab, and reuses it. The student
  stays on the page they were on.
- **Never a new window.** The first build opened one with `focused: false`
  to keep the tab visible. From a full-screen window on macOS, the new
  window got its own Space and macOS switched the student to it. No Chrome
  API prevents this, and a minimized window is hidden too.
- The tab is set `autoDiscardable: false`, so Memory Saver never throws
  away a half-filled form.
- So the fill must work in a hidden tab: wait on DOM changes
  (`MutationObserver`), not on redraws or `requestAnimationFrame`. Test
  each hiring system's dropdowns and file upload in a background tab.
- Only one application fills at a time.

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
- **Sent resumes** (KAN-208) keep every file a student downloads or applies
  with, and answer a 5-minute download link. Unchanged content returns the
  last sent resume, with no new file.
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
default gets none, and the Resume List says to star one. The run never
generates a base resume: that is slow, and the student never asked for
it.

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
| DELETE | `/applicants/{id}/applications/{job_id}` | `dequeue_job` | Takes a queued job out of the queue; 204. 404 with no application, 409 past queued. **Built** |
| GET | `/applicants/{id}/applications` | `list_applications` | Live Activity and later the tracker. `?stage=` repeats. **Built** |
| GET | `/applicants/{id}/applications/next` | `next_application` | What the runner fills next, or `null`. **Built** |
| GET | `/applicants/{id}/applications/{job_id}` | `get_application` | One application, as the list has it; 404 without one. Registered after `/next`. **Built** |
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
| What the Auto Apply page shows | **Resume List**: every resume the student has, with the pick rule under it | One primary resume: no application is sure to get it, and matching does not read it |
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
systems use a drop zone instead (Workday). Test each hiring system. The
sample form (`test/sample-form.html`) needs a file input.

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
   messages, not yet the port; no fill).
6. **`autofill_runs`**, and Live Activity shows each fill's report.
7. **`autofill_answers`** for screening questions.
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

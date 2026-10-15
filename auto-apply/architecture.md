# Auto-apply: architecture

How the auto-apply run works in code: which part does what, the messages
between the parts, and where each piece of state lives. `design.md` is the
"what and why" (tailoring, the data model, cost). This file is the "how" for
the run itself. Read both before building any step.

> **Status (2026-10-14).** Decided: the run happens in the student's own
> Chrome, through the WorkIt extension (path 1). No WorkIt server ever drives
> a browser. Built: the Match step's function (section 7). Everything else
> here is a plan.

## 1. The decision

| Path | Result |
|---|---|
| **Extension, in the student's Chrome (chosen)** | Works. The hiring system sees the student's own browser, IP address and sign-ins. Chrome must be open |
| Headless browser on our servers | Rejected. Server traffic triggers CAPTCHAs, a server cannot read the student's email codes or Workday accounts, and Vercel cannot host a browser for a whole run |

**The student clicks Submit on every application.** The run fills the form,
attaches the resume and stops. The student checks the form, clicks the hiring
system's own Submit, and tells the overlay "Submitted" or "Skip". Then the run
opens the next job posting. `design.md`, section 9.1, gives the reasons.

## 2. The parts

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
             └──────────────────── Bearer ───────────────────────▶└───────────────┘
```

| Part | Does | Never does |
|---|---|---|
| **WorkIt API** | Scores matches. Owns applications and autofill runs. Serves the resume file | Opens a browser. Decides when the run moves on |
| **Auto Apply page** | Shows Live Activity. Sends Start and Pause. Keeps the session fresh while the run goes on (section 5.2) | Fills anything. Holds the queue in memory as the truth |
| **Runner** (extension background worker) | Takes the next application, opens its tab, starts the fill, waits for the student, records the result | Clicks Submit. Refreshes the session itself |
| **Content scripts** (in the hiring system's tab) | Fill fields, attach the PDF, show the overlay with **Submitted** and **Skip** | Talk to the API. Move to another page |

**The API is the source of truth.** The runner keeps only a cursor (which
application, which tab). If Chrome closes mid-run, nothing is lost: the
application is still in the queue, and the next Start picks it up.

## 3. The run

### 3.1 Run states

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

### 3.2 One application

```
 next ─▶ opening ─▶ filling ─▶ waiting ─▶ recording ─▶ next
            │          │          │
            ▼          ▼          ▼ tab closed = Skip
          failed     failed
```

1. **next.** The runner asks the API for the next queued application
   (`GET /applicants/{id}/applications?stage=queued&limit=1`). None left: the
   run goes idle.
2. **opening.** It opens `apply_url` in the run's window (section 5.4) and
   waits for the tab's `complete` status. Limit: 30 seconds.
3. **filling.** It injects the content scripts (as the popup does today) and
   sends `fill/start` with the resume id. The content script fills, attaches
   the PDF, and replies with the counts and the report. Limit: 60 seconds.
4. **waiting.** The overlay shows what was filled and two buttons. The runner
   waits for `student/decision`, with no time limit. Closing the tab counts
   as **Skip**.
5. **recording.** The runner saves an autofill run
   (`POST .../applications/{app_id}/runs`). **Submitted** also moves the
   application to `applied`. **Skip** moves it to `skipped`, so the next run
   does not open it again.

**failed** saves the run with the reason ("page did not load", "no form
found", "sign-in needed") and moves the application to `needs_you`. The run
goes on to the next one. Live Activity shows it under "Needs You".

Workday asks for an account on each company's site. The runner cannot create
one. When the content script sees a sign-in form and no application form, it
reports "sign-in needed" and the runner moves on.

## 4. Messages

Every message has a `type`. The names follow the extension's existing
`auth/status` and `profile/get`.

### 4.1 Webapp ↔ runner

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

### 4.2 Runner ↔ content script

| Direction | Type | Body |
|---|---|---|
| runner → tab | `fill/start` | `{ applicationId, resumeId }` |
| tab → runner | `fill/result` | `{ filled, failed, skipped, report, resumeAttached }` |
| tab → runner | `student/decision` | `{ decision: "submitted" \| "skipped" }` |

## 5. Chrome limits and the answer to each

### 5.1 Host permissions

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

### 5.2 The session expires after one hour

The runner reads the webapp's session cookie and never refreshes it
(`autofiller_extension/CLAUDE.md`: two refreshers would sign the student
out). So the **Auto Apply tab keeps the session fresh**: while the run is
`running`, the page calls a cheap server action every 10 minutes. That
request passes the Next proxy, which refreshes the cookie when needed. The
runner reads the new cookie before each application.

If the student closes the Auto Apply tab, the run goes on until the token
expires. Then the runner stops with `reason: "signed_out"`, and the next Start
continues.

### 5.3 The background worker stops when idle

Chrome stops an extension's background worker after about 30 seconds with no
events. Two measures:

- The open port from the Auto Apply page sends `run/status` every 20 seconds
  while the run goes on. Each message resets the idle timer.
- The runner writes its cursor to `chrome.storage.session` after each step:
  `{ state, applicantId, applicationId, tabId, windowId, step }`. When the
  worker starts again, it reads the cursor and continues from that step.

### 5.4 Hidden tabs run slowly

Chrome slows timers in hidden tabs and stops page redraws. Some dropdowns wait
for a redraw. So:

- The runner opens **one window** for the run (`chrome.windows.create`) and
  reuses it, one tab at a time. The student's own windows stay as they are.
- The current application's tab is always the active tab in that window.
- Only one application fills at a time.

## 6. What changes where

| Folder | Change |
|---|---|
| `backend/` | `fetch_recommended` and `min_match` (built). `applications` and `autofill_runs` tables and routes (`design.md`, sections 5 and 7). The queue's stages add `queued`, `needs_you` and `skipped` to the ones in `design.md` |
| `frontend/` | Auto Apply page: the port to the runner, Start and Pause wired to it, Live Activity from the API, the session keep-alive |
| `autofiller_extension/` | `runner.js` in the background worker; `onConnectExternal` for the port; `fill/start` in the content script; file upload; **Submitted** and **Skip** in the overlay; host permissions. Its `CLAUDE.md` changes too: it now has a run started from the webapp, and it calls new routes |

## 7. The Match step (built)

The run applies to the student's matches. Matching already exists and is
reused: it scores every listed job posting against the **primary resume**
(`default_resume_id`) and nothing else. It reads no other resume and no
profile field.

- **`fetch_recommended(db, applicant_id, min_match=60)`** in
  `backend/app/routers/jobs.py` returns the matches, best first, as
  `ScoredJob`s (a job listing plus `match` and `highlights`). The queue route
  (step 2) calls it. It checks no ownership; its caller does.
- **`GET /jobs/recommended/{applicant_id}?min_match=60`** returns the same
  list over HTTP, for the extension or the webapp. It checks that the token
  owns the applicant.
- **`min_match`** (default 0) leaves out job postings scored below it, before
  the offset. 60 is the threshold in `design.md`, section 4.1.
- No primary resume, or one that did not parse: the function raises
  `NoResume`, and the route answers 404.
- **Not yet:** leaving out job postings the student already applied to. That
  needs the `applications` table.
- **No screen shows the matches.** The Auto Apply page does not list them.

The scoring and its weights are in `backend/app/services/matching/CLAUDE.md`.

## 8. Build order

Each step ships alone and is about one ticket.

1. **Match**: `fetch_recommended` and `min_match` (done).
2. **`applications` table and routes**, with the `queued`, `needs_you` and
   `skipped` stages. Start Auto Apply queues the matches that have no
   application yet.
3. **Extension: file upload**, tested on Greenhouse, Lever and Ashby. They
   host 87% of the job postings in the feed snapshot (`backend/data/feed.json`).
4. **Extension: the runner**, the port, host permissions, and the overlay's
   **Submitted** and **Skip**. Start and Pause go live.
5. **`autofill_runs`** and Live Activity from the API. The fixture goes.
6. **`autofill_answers`** for screening questions.
7. Tailoring, as in `design.md`, sections 4.2 to 4.4.

## 9. Open questions

- **Scores bunch at the top without embeddings.** On a laptop with no Ollama
  running, the test account had 100+ matches at 60% or more, most at 98–100%
  (2026-10-14). The semantic part is missing, and the skill part is scaled to
  the best job in the list, so many jobs reach the top. Before the queue
  uses `min_match`, check the scores with embeddings on, and retune.
- **One role, several locations.** The feed lists some roles once per office
  (LSEG's "Intern - Software Engineer" in New York and in London). A run
  would apply to each. Group them, or let the student pick one place.

- **Company-domain iframes**: does injecting into the hiring system's frame
  work on every one? Test on Waymo and Jump Trading first.
- **How many applications per run**, and per day? A limit protects quality
  and the student's reputation with employers.
- **Detecting Submit**: each hiring system's confirmation page could replace
  the **Submitted** button, one hiring system at a time.
- **Which matches to skip by default**: postings on hiring systems the
  extension does not fill well yet (Workday) could stay out of the queue
  until it does.

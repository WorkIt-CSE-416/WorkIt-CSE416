# WorkIt and the Applications Tracker

Reference for Apply, reached from `apply-agent/CLAUDE.md`. Paths are relative to `apply-agent/`. A change in this area updates this file in the same PR.

## The WorkIt client and `apply login` (KAN-541)

`src/apply/workit.py` is the only module in Apply that calls WorkIt. Do not
call WorkIt from another module; add a method to `WorkIt` that uses `call`.

- `uv run apply login` opens WorkIt's sign-in page (`/login`) in a new
  Chrome with an empty, temporary profile. The student signs in there
  (password, Google or LinkedIn). Apply never types into it. Apply reads the
  web app's session cookie through Chrome's DevTools port, as the extension
  reads it (`webapp-session.js`), and checks it with `GET /auth/me`. Then
  Apply closes that Chrome and deletes its profile. Chrome starts as a plain
  process, not from Playwright. Its DevTools port alone sets
  `navigator.webdriver`, and Google's sign-in then refuses it (2026-11-03),
  so it starts with `--disable-blink-features=AutomationControlled` too.
- Because that browser is gone, only Apply has the session. Apply refreshes
  the access token itself at Supabase Auth
  (`/auth/v1/token?grant_type=refresh_token`, with the public anon key) and
  keeps the new refresh token: Supabase rotates it on each use. The
  extension must not do this (its CLAUDE.md, KAN-465), but Apply's session
  is not shared with a web app. A lock file (`workit-login.lock`) stops two
  processes from using one refresh token.
- The session is in `APPLY_HOME/workit-login.json` (mode 0600), with the
  Supabase URL that it belongs to. Never print it, log it or put it in a
  Record. To log out, delete the file.
- The API checks the bearer token (`backend/app/deps.py`, `security.py`).
  `call(method, path, body)` sends one request as the student. On a 401 it
  refreshes one time and tries again. `applicant_id()` is the student's id
  for the paths, read from `GET /auth/me` one time per client. Code outside
  `WorkIt` uses only its public methods.
- `workit.Stage` names WorkIt's application stages, and
  `workit.APPLIED_STAGES` is applied or later. Use them; do not write a
  stage name as a string in another module (`tracker.STAGES`, the import,
  the cleanup).
- Errors: `NotLoggedIn` (no file), `LoginExpired` (Supabase or WorkIt
  refused the login: run `apply login` again), `Unreachable` (no answer, or
  a 5xx).
- `apply doctor` has a "WorkIt" line. It is optional, as Gmail is: no
  login, an expired login, WorkIt that cannot be reached, and a company
  account are each a warn with a fix line, never a fail. A user with no
  WorkIt account still rehearses. When the access token expired, doctor
  refreshes it and saves the login again. This is the only write that
  doctor makes.
- Each request sends the `User-Agent` `WorkIt-Apply/1`. Cloudflare, in
  front of WorkIt's API, refuses the Python-urllib user agent (error 1010).
- `workit.LIVE` holds the live URLs and the anon key. They are the same
  public values as `autofiller_extension/src/shared/config.js`, and
  `test_workit_login.py` checks this. For a local WorkIt stack, set
  `APPLY_WORKIT_WEB`, `APPLY_WORKIT_API`, `APPLY_WORKIT_AUTH` (the Supabase
  URL) and `APPLY_WORKIT_ANON_KEY`.

**Tests.** `tests/fake_workit.py` is a fake WorkIt: one local HTTP server
that answers as Supabase Auth and WorkIt's API, and records each request
(`fake.requests`). Use `with FakeWorkIt() as fake:` and
`WorkIt(fake.site, tmp_path / "workit-login.json")`. `fake.session()` makes
a session, `fake.cookies(session)` gives the web app's cookie for it,
`fake.expire()` lets the access tokens expire, `fake.revoke()` signs out
every session, and `fake.stop()` makes WorkIt unreachable. Add a WorkIt
route with `fake.route(method, path, handler)`. `test_workit_login.py` needs
no browser and is in CI. `test_workit_sign_in_browser.py` opens Chromium
against the fake's `/login`, so run it on your Mac.

## `apply import-sheet`: the Tracker Sheet into the Applications Tracker (KAN-545)

`src/apply/sheet_import.py`. It runs one time, after `apply login`. ADR
0007 says why the Applications Tracker is the record.

- It reads the Applications tab of the Tracker Sheet (`sheet-id`) as text.
  It does not use `SheetTracker.rows()`, because that stops on an Outcome
  that is not in `Outcome`.
- Only rows with status submitted go in. Each other row is a skip, with
  its status.
- The stage comes from Outcome: interview to interviewing, offer to offer,
  rejected to rejected. Each other Outcome, and a blank one, is applied.
  An Outcome that is not in `Outcome`, and a missing or bad Date applied,
  go in at applied (or today) and are listed under "Check these".
- The resume is the file in the Application's folder under `sent/`
  (`worker.sent_folder`) whose name matches `attach.RESUME` and not
  `attach.COVER`. The folder of the day applied comes first. With no such
  file, the application goes in with no Sent resume.
- The dry run writes nothing. It reads `GET /auth/me`, `GET
  /applicants/{id}/applications`, and `POST /jobs/listed-by-link` for each
  row. Then the student types yes (`--dry-run` only lists).
- Each add is `WorkIt.record_applied`, the same method as a submit's
  write. In this order: `POST /jobs/added-by-link` (with `"track_only":
  true`, below), then `POST
  .../sent-resumes/file` (the resume, base64 JSON), then `PUT
  .../applications/{job_id}/stage` with `applied_on`, then `POST
  /jobs/{job_id}/applied` with `sent_resume_id`. It does nothing more to
  an application that is applied or later.
- It never changes an application that is applied or later in WorkIt. The
  dry run skips it, and the write skips it again if it became applied
  after the dry run. So a second run adds nothing, and a failed run can
  run again. Two rows of one job (`job_key`: WorkIt's link rule) are one
  add.
- A refused add is listed as FAILED and the others continue. WorkIt not
  answering stops the import.

**Tests.** `tests/test_sheet_import.py` runs the command on
`tests/fixtures/tracker-sheet.csv` (the real Sheet's columns, made-up rows)
against `tests/fake_tracker.py`: an Applications Tracker held in memory on
the fake WorkIt, with WorkIt's link rule, stages and Sent resumes.

## `apply clean-tracker`: delete the jobs the student did not apply to (KAN-546)

`src/apply/tracker_cleanup.py`. Run it after `apply import-sheet`.

- It reads `GET /auth/me`, `GET /applicants/{id}/applications` and the
  Applications tab of the Tracker Sheet. With no Sheet, it uses WorkIt
  only.
- It deletes only saved and queued applications. It keeps a saved or
  queued application when:
  - the student has an application at applied or later on the same job
    (`job_key`, so also on another posting of that job);
  - the Tracker Sheet has the same job as submitted (not imported yet). The
    dry run then says to run `apply import-sheet` first;
  - Apply's own Tracker (`APPLY_HOME/tracker.json`) has the job as held,
    missing fact or handoff. Apply writes these as needs_you, but the
    write can still wait in the queue. The dry run says "Apply is waiting
    for you on it (<status>)";
  - the student gave its link or job id with `--keep`.
- It never deletes or changes an application at applied, interviewing,
  offer or rejected, or at needs_you or skipped.
- The dry run writes nothing. Then the student types yes (`--dry-run`
  only lists).
- Each delete: `DELETE /jobs/{job_id}/saved` for saved, `DELETE
  /applicants/{id}/applications/{job_id}` for queued. Both routes delete
  only at that stage, in the same SQL statement, so an application that
  became applied after the dry run stays. WorkIt then refuses (409): the
  cleanup lists it as FAILED and continues. WorkIt not answering stops it.
- After the deletes, it reads the tracker again and prints the count of
  applied applications before and after. If one is gone, it lists it and
  exits 1.

**Tests.** `tests/test_tracker_cleanup.py`, against `tests/fake_tracker.py`
(with the two delete routes), with one application at each stage.

## Apply writes to the Applications Tracker (KAN-544)

Apply's Tracker is a file in the data folder: `tracker.FileTracker`
(`tracker.json`, one JSON file, a lock file around each read and write).
`cli.live_tracker()` wraps it in `tracker.WorkItTracker`: each `add` or
`update` that gives an Application a new status in `tracker.STAGES` also
sends a `workit.Write` through a `workit.WaitingWrites`.

- submitted to `applied`, with the resume from the Application's folder
  under `sent/` (`worker.sent_resume`: the profile's resume name, else a
  PDF named resume) kept as the Sent resume. This is
  `WorkIt.record_applied`, the import's write sequence. A job that is
  applied or later on WorkIt already stays as it is ("already
  interviewing").
  handoff, missing fact and held to `needs_you` (the stage PUT; a 409
  means the job is applied already, and is not an error). Apply never
  writes `queued`: on WorkIt that is the batch apply queue, and the
  extension fills a queued application. A `queued` write still in an
  older queue file is sent as `needs_you`.
  Every other status writes nothing.
- The job comes from `POST /jobs/added-by-link`, so a later status moves
  the same row. It is the extension's Write with Claude route (KAN-515);
  Apply sends `"track_only": true` (`WorkIt.add_by_link`), so WorkIt takes
  any link (not only a form auto apply fills), tracks a closed job as it
  is, and saves a new application or keeps its stage, where Write with
  Claude moves it to needs_you. A job WorkIt does not list becomes an
  **added job** (`added_by_student`; root `GLOSSARY.md`), never a status.
  The answer is `{"job_id", "stage"}`. New added jobs count against
  WorkIt's daily cap (50): a 429 (`workit.CapReached`) keeps the Write
  with `not_before`, the response's Retry-After or else the next UTC
  midnight (WorkIt's caps count UTC days). No flush sends it before then.
- A rehearsal writes only through `submitted_to`, when Lisul presses
  Submit himself. A rehearsal that he does not submit writes nothing.
  His confirmed Submit also saves the rehearsal's Record again as
  submitted, with the confirmation page as `after-submit.png`
  (`rehearsal._keep_confirmation`). Before, the Record kept saying held
  (KLA, 2026-11-03), though the Applications Tracker had it as applied.
- No answer, or no live login: the Write waits in `workit-queue.json` (one
  per Application, the newest). `apply run` and `apply rehearse` send the
  waiting writes first; `apply doctor`'s "WorkIt writes" line lists them
  ("waits for WorkIt's daily cap of added jobs until <time>" for a capped one).
  A Write that WorkIt refuses (a 4xx) is dropped and said.
- A write that fails never stops a run: the row is in Apply's Tracker.
- Apply does not write to the Tracker Sheet. The first `live_tracker()`
  with no `tracker.json` copies the Sheet's rows and Requests in, one time
  and read only (`sheet.copy_into`), so a run does not apply again to a
  job already applied to. `python -m apply.rankings` still writes its
  ranked tabs to the Sheet when you run it by hand.
- Lisul approves a Hold with the Apply window's Approve button (`POST
  /approve`, `Tracker.approve`), not a Sheet checkbox. `SheetTracker` has
  no `approve`: Apply never writes an approval to the Sheet (ADR 0007).
- A Hold's card shows one box per essay, with the essay's text only
  (`essays.cell_texts`). The `## <question>` heading and the Plan, Checks
  and Named lines of the Essay cell (`essays.as_cell`) are not in the box,
  so Lisul cannot change them. Approve sends his texts in order
  (`essays`). The window builds the cell again from the stored headings
  and lines and his texts (`essays.with_texts`), and `Tracker.approve`
  writes it with Approve, in one write. An empty essay is refused (400)
  with a message, and the Hold still waits. The next check fills the form
  with his words (`essays.from_cell`); a Plan line never goes to the form.
  The page keeps the edit in `sessionStorage` (`apply.essays`, by
  Application ID) until he approves, so a reload does not lose it.

**Tests.** `tests/test_tracker_record.py` (in CI) runs `WaitingWrites` and
`WorkItTracker` against `tests/fake_tracker.py`. `tests/test_rehearse.py
-k "applications_tracker or sends_nothing_to_workit"` rehearses a form
in Chromium: a submit by Lisul is Applied with the Sent resume, and no
submit sends nothing. `-k saves_the_record_again` checks his submit's Record.

## Already applied: no form is opened again (KAN-621)

On 2026-11-04 a rehearsal filled Astranis, which Lisul had applied to. The
Applications Tracker had it at applied. The held page had a live Submit,
and he sent it a second time.

`src/apply/already_applied.py` checks each link before any page opens
(`Adapters.applied_before`; live: `already_applied.Check`). It reads
WorkIt one time per run or rehearsal, through `WorkIt.applications`.

- A link is already applied when one of these says so:
  - WorkIt has an application at applied or later on the same job
    (`job_key`, so another Greenhouse host matches too);
  - Apply's Tracker (`tracker.json`) has a submitted row with the same
    Application ID or job;
  - a Record of the same Application has `after-submit.png`.
- A rehearsal of such a link ends as "already applied". Its terminal line
  and its tile say "Already applied on <date> (<source>)". No browser
  opens. A run makes it a Handoff and opens no form.
- `apply rehearse --force` fills it anyway. The held page keeps the submit
  guard on, under a red "You already applied on <date>, don't submit"
  note. Lisul presses Dismiss, then "Yes, I'm sure: unblock this page".
  Only then does `lift` take the guard off. The second button has no word
  that the guard blocks.
- WorkIt that cannot be read (no login, an expired login, no answer) is
  never a silent pass. The window's status line and the terminal say why
  (`already_applied.UNCHECKED`). The local checks still run.
- The check only reads WorkIt: it writes nothing there.

**Tests.** `tests/test_already_applied.py` (in CI) runs the check against
`tests/fake_tracker.py`. `tests/test_rehearse.py -k "already_applied or
could_not_run or force_rehearses"` rehearses in Chromium.

## The resume check (KAN-663)

`src/apply/resume_check.py` compares `files.resume_pdf` with policies.yaml's
`resume_source` (`repo`, `path`, `branch`, default `main`) by git blob sha.
The default is unset, and then nothing runs and doctor prints no line. A
different file stops `apply rehearse`, `apply run` and `approve-pass` at
their start, with one line that names both shas. In doctor, it is a fail. If
`gh` can't answer, it is a warning and the run goes on. The repo's sha is
kept for 10 minutes in `resume-source.json` in the data folder. A link sent
with `--into` joins a run that was checked at its start.

## The tailored resume is the Sent resume (KAN-547)

A student can tailor a resume to a job posting on WorkIt (Tailor,
`../docs/tailor_resume.md`). When the Posting has a tailored resume, Apply
gives the form that resume, and the Applications Tracker keeps that same
file as the Sent resume. Apply does not change how Tailor works.

- `tailored.resume_for` runs before each Application, in a run
  (`orchestrator._traced`) and in a rehearsal (`rehearsal._rehearse`). It
  asks `Adapters.tailored` (live: `tailored.from_workit`) for the PDF.
- `WorkIt.tailored_resume(url)` finds the job with `POST
  /jobs/listed-by-link`, the student's tailored resume for that job in `GET
  .../built-resumes` (`job_posting_id`), and renders it with `GET
  .../built-resumes/{id}/render`. It writes nothing.
- Apply writes the PDF to `APPLY_HOME/tailored/<application>/` with the
  file name of the profile's resume. The form gets it under that name, the
  Worker copies it to `sent/`, and the submit's write sends that copy
  (`worker.sent_resume`). Thus the file attached and the Sent resume are the
  same bytes.
- The Application gets a view of the profile (`tailored._WithResume`): only
  `files.resume_pdf` changes. The not-on-resume gate and the essays read the
  tailored resume too. Every write goes to the profile itself, and the
  profile file never changes.
- No WorkIt login, a job that WorkIt does not list, no tailored resume, or
  a profile with no resume: the profile's resume, as before. WorkIt down or
  a failed render: the profile's resume, and one line on stderr says so.

**Tests.** `tests/test_tailored_resume.py` (in CI) runs against
`tests/fake_tracker.py` (`FakeTracker.tailored`). `tests/test_run.py -k
tailored_resume` (the form gets the tailored file) and
`tests/test_rehearse.py -k tailored_resume` (Lisul's submit keeps it as the
Sent resume) open Chromium. The backend test
`backend/tests/test_sent_resumes.py -k tailored_resume_by_the_postings_link`
runs the same routes on Postgres.

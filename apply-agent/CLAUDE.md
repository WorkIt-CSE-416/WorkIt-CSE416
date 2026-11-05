# CLAUDE.md — Apply

Loaded on top of the root `../CLAUDE.md` when you work in `apply-agent/`.

## What Apply is

Apply is a command-line agent that applies to job postings for one person.
It reads a job posting, fills the application form in Chrome through the
Fill engine, writes the answers and essays with Claude, and shows the Apply
window (Start, Needs you, Answers, Accounts). A rehearsal fills the form and never
submits. It runs on the person's own Mac, with their own Chrome and their
own Claude Code login. It is a developer and power-user tool, not a student
feature: students apply through the extension and the connector (KAN-369).

Apply has its own domain language. Read `GLOSSARY.md` and `docs/adr/` here,
not the root ones, for its terms (root `GLOSSARY-MAP.md`). Write each
glossary entry in ASD-STE100 wording: sentences of 25 words or fewer.

## How it differs from `auto-apply/` and the extension

- `auto-apply/` is the design document for WorkIt's auto apply (KAN-223)
  and its rehearsal records. It holds no runnable code.
- `autofiller_extension/` is the Chrome extension that students install. It
  fills forms in the student's own Chrome; Scout and the connector write its
  answers, and the WorkIt backend keeps its state.
- `apply-agent/` is a Python program (uv, Playwright) that runs its own
  Chrome workers. Claude writes its answers. Its state is files in the data
  folder, not the WorkIt database. It calls the WorkIt API only through
  the WorkIt client (next sections), as the signed-in student.

Both Apply and the extension fill forms with the same Fill engine (next
section). A fix to how a field is read, planned from the profile, filled
or read back goes into the engine, not into Apply. Apply's own plan rules
(next section) are Apply-side checks, not fill fixes: they decide what
Claude may draft and what Apply's own read-back accepts, and the extension
has neither.

## The Fill engine

Apply loads the engine bundle from the extension's submodule:
`autofiller_extension/fill-engine/dist/engine.js`. Apply has no submodule
of its own, so one engine pin serves both. To use another engine checkout
(for example, a branch of the engine that you work on), set
`APPLY_FILL_ENGINE` to its folder (`~` is expanded). Apply then loads
`dist/engine.js` from that folder. The tests read the saved forms
(`test/fixtures/`) from the same folder. The repairer works on the submodule path in its Repair worktree.

Run `git submodule update --init` once per checkout. Without it, Apply
cannot fill a form, and `uv run apply doctor` says so.

Apply adds three rules to the engine's plan (`fill_engine.plan` and
`worker._Planned.add`). They stay in Apply: each one is about Claude (what
it drafts, the forms that Claude fill reads) or about Apply's own
read-back. The engine's `fillEach` already accepts the wording that a
try-list picked, so the extension needs none of them.

- A secret question (a password) is never sent to Claude to draft. It
  stays blank for the Filler. `records.SECRET` finds it. A security clearance
  question ("Top Secret clearance?") is not a secret.
- A Workday try-list answer (`a|b|c`) accepts each of its wordings in the
  read-back, because the fill takes the first one that it finds. Only the
  How did you hear question (and a "Details" list right after it) gets a
  try-list; another answer with a `|` must show whole. Which question is
  the How did you hear one is the engine's answer (`asksHowHeard`, from its
  own `HOW_HEARD`): Apply keeps no copy of the pattern.
- A form that Claude fill reads is planned with the company and role that
  its page names, when the link names none.

The engine's plan names each field it leaves blank on purpose, with why
(`fill_engine.Plan.blanks`). On Greenhouse's self-ID block, a race to
decline is one when Hispanic/Latino is answered: picking race's decline
there sets Hispanic/Latino to the decline too and hides race.

A How did you hear answer that Lisul recorded (the profile's
`answered_questions`, or his own Answer bank answer, under any how-heard
wording) wins in the engine's plan on every form that offers it. The
company's-own-site order applies only when none is recorded (Lisul,
2026-11-02).

An Answer bank entry with `answer: []` and `none: true` answers a
multi-select with none of its options (Roblox's partner organizations):
its boxes stay unticked, a blank on purpose in the plan.
`AnswerBank.answer(question, [])` saves one; an answer with options in it
drops `none`. An empty answer without `none` is still no answer.

Apply adds the Tracker to the facts that it gives the engine's plan
(`fill_engine._facts`). Each company with a submitted Application, except
the Posting being filled, joins `screeners.previously_applied_to` when the
profile keeps that list. A company where Lisul's Outcome is an interview
or an offer goes in `screeners.previously_interviewed_at`. So "Have you
previously interviewed at <company>?" is No when no record shows an
interview there. If he applied there but no interview is recorded, he
answers it himself.

A bare date (From, To, Start date, End date: a label that does not say
what the date is for) is answered for its section (KAN-595). The engine
finds the section from the field's panel, its help text, the heading or
intro just before it, or the questions before it. The section is
education, work experience or availability (`Plan.sections`). The plan
answers a school's or the internship's dates itself. Claude drafts any
other bare date and is told its section (`"about"` in the draft call); a
date that nothing places goes to Lisul. The Answer bank files a bare
date's answer under its section and label
(`"education / From (MM/DD/YYYY)"`, `Plan.filed`). A date that no section
places is never banked. An older entry filed under a bare label alone is
never read again. Lisul's own answer to a bare date applies to that form
only; Apply does not save it to the profile by its wording.

`README.md` is a teammate's setup path, from a clone to a rehearsal. Its
steps and doctor's fix lines say the same thing. When you change one,
change the other.

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

## Verifying a filled form (KAN-549)

After Apply fills a form, and before any submit, the Worker verifies it
(`worker._Planned.verify`, `verify.check`). This is the last part of the
Pre-submit check. It applies to rehearsals and to live runs. It only
reads: it does not click, type or submit.

- `apply_to(on_verify=...)` gets `None` when verifying starts, then the
  `verify.Verification`. The rehearsal and the Orchestrator send it to the
  window with `verify.verifying()`: the tile shows "Verifying…" with a
  spinner, then "Verified" with a check mark, or "Verified with N items
  that need you".
- Plain code makes the checks: a blank field that is not a Missing fact
  and not left blank on purpose (`_Planned.left`), the read-back
  (`fill_engine.readback_problems`), an empty file or a file in the wrong
  field, a value that is not one of the field's options, a graduation
  year that is not the profile's, a start date in the past, pay out of the
  posting's range (else off `compensation.fallback_hourly`), and in each
  essay a wrong pronoun or name for the applicant and another company's
  name (`verify.COMPANIES` and the policies' companies, less any that the
  sources or the posting name). Claude makes only the judgment checks, in
  the Pre-submit review call (`presubmit.SYSTEM`: contradictions, wrong
  answers); its findings join the flags.
- A review finding can name the right answer when the sources give it
  (`presubmit.Found.fixes`: an internship start in a school's From).
  Apply fills that answer in place of the wrong one (`_Planned.fix`). It
  then fills the form again, in a fresh page, and reviews it again, all
  before the window shows the form as ready. It does this once. A fix
  replaces only Claude's guesses (its drafts, and its drafts the Answer
  bank gave back). It never replaces an answer from the profile, Lisul's
  own answer, an essay, a file or a secret. A
  Claude draft that a fix replaces leaves the Answer bank. On Workday, the
  next fill goes Back to the step that holds the fixed answer
  (`WorkdayFiller._back_to_changed`). A read-back replan also refills
  this way.
- A flag that `holds` goes in the reason as `Verify: <field>: <why>` and
  holds a live run (Needs you, kind `check`). Read-back and review flags
  hold already by their own reason. A blank optional field holds as a
  blank required field does, also a voluntary self-ID field (Lisul's rule:
  a blank optional is a bug; the profile answers self-ID, a decline at
  least). Only an answer that Claude guessed (a new Answer bank draft, a
  Rescue) and a blank that the engine's plan meant are notes, which do
  not hold. The plan lists each field it leaves blank on purpose, with why
  (`Plan.blanks`: a duplicate "Other website", an "If other" follow-up to
  another pick, an optional fact the profile lacks); the note says why.
  An optional catch-all box that Apply left blank on purpose
  (`_Planned.kept_blank`, below) is a note too.
  An approved Hold is not held again by a flag; the read-back still holds
  it.
- In the window, each flag shows with its field and why, and has its own
  Dismiss (`POST /dismiss`). Apply keeps each dismissal for its
  Application in `APPLY_HOME/dismissed-flags.json` (`verify.dismiss`,
  `verify.dismissed`). A dismissed flag does not show after a window
  reload or in a new window (`verify.without_dismissed`), and it does not
  hold a new run of the same Application: `verify.check(dismissed=...)`
  keeps it in `verification.json` with `dismissed: true`. When every flag
  of a live run's Hold is dismissed, the Hold shows Approve.
- The Record keeps `verification.json` and a Verification section in its
  README.

**Tests.** `tests/test_verify.py`: a fake form with planted problems, a
clean form, a live run held by a flag, a dismissed flag in the window and
in a new run, a blank the engine meant, and the window's states.

## Resume a paused rehearsal (KAN-551)

A rehearsal that stops mid-form for Lisul does not end. It pauses on its
open page, and he fixes the page himself. Then he presses Resume, and Apply
goes on from the step that the page shows.

- A pause is a Handoff that `apply_to(on_pause=...)` gets in a rehearsal:
  while the Filler reads its questions (a Workday sign-in) or while it
  fills (a step that Workday will not leave, a pop-up, Claude fill's Next).
  `rehearsal._rehearse` shows it on the tile as its status (handoff, needs
  sign-in) with `resume={"ok": True}`, and the hold of the paused page
  (`_Kept.hold(resume=...)`) waits. The paused link gives back its Worker
  turn (`gate`) while it waits.
- Resume (`POST /resume`, `Board.resumed`) comes back on the same tab. The
  submit guard goes on again with `submit_guard.rearm`, with no reload, so
  his fixes stay. The fill loop then calls `filler.fill` again, with the
  same plan and Filler state. Apply never starts over, never submits, and
  never asks for a new code.
- His fixes: the Filler's `resumed(page)` reads the values of the step
  shown. The Workday Filler does not fill those fields again on that step,
  and `_Planned.keep` keeps each value that differs from Apply's answer as
  his answer (`_Planned.lisuls`). A Missing fact that he answered there
  waits on him no more. A Filler with no `resumed` keeps nothing (Claude
  fill does not type a field again that it filled already).
- A Filler's `resume_blocked(page)` says why Resume cannot go on yet. The
  Workday Filler says so until the page shows an application step (on
  Workday's or Google's sign-in page), so Resume never signs in or asks
  for a code. The why shows on the button, and the pause stays.
- A tab that closed, or a rehearsal that ended, makes `resume={"ok": False,
  "why": ...}` (`rehearsal.TAB_CLOSED`, `ENDED`). The button stays, turned
  off, and says why. Fill again still fills the form anew.
- Each pause and Resume is a line in `Rehearsed.history`, on the tile and
  in the Record's README (Pauses), and an event in the Trace.
- The window: a paused item in Needs you and its tile in Live show a
  Resume button (`.primary`), before Fix here and Open in Chrome. Both
  send `POST /resume` (`Dashboard.resume`, with the window's token). An
  item whose form fills again waits on him no more. A Resume that cannot
  go on is a 409 with the why, and the button is turned off with the why
  beside it (`.then` on the card, `.why` on the tile).
- Live runs do not pause. A run's Handoff ends, and its Worker moves on.

**Tests.** `tests/test_resume.py`: the fake Workday stops on a required
Degree; Lisul picks it on the page, presses Resume, and the form goes to
Review with no submit. Also a closed tab, the `/resume` route, and the
window's card and tile. Run it with `-k`; it opens Chromium.

## Resume while a rehearsal fills (KAN-594)

Lisul is never left on a form with no way to make Apply go on.
`src/apply/stuck.py` holds the rules.

- The tile says what Apply is doing while it fills (`stuck.doing`, the
  caption's `doing`): its banner ("Filling · Planning answers for
  'Application Questions'") and its detail line. The Worker says it at each
  step: reading the questions, planning a step, reading the company's pages,
  researching the company, writing answers, filling. A Filler that names its
  step has `step` (Workday's).
- A filling tile offers Resume (`Dashboard.state`, `stuck.why`) when:
  Apply waits on Claude (`stuck.Waits` wraps the rehearsal's Claude: each
  `ask` and `research`, not Claude fill's `drive`); the page shows a job
  system's field error (`stuck.FIELD_ERROR`, as data: Workday's
  errorHeading and errorMessage, an invalid field's message, `role=alert`,
  a class that says error; read every 2 s by the window's own CDP
  connection, `CdpFrames.field_error`, so it is seen while the Worker
  waits); or no progress for `STUCK_AFTER` (45 s: past a Filler's longest
  single wait, 30 s). A form held for Start, or verifying, offers none.
- Resume there: a wait on Claude stops at once (`claude_cli` kills its
  `claude -p`, and `stuck.Stopped` is raised); else the press is taken at
  the fill loop's next turn, or at the next pause. Then `go_on` keeps what
  Lisul put on the page (the Filler's `resumed`, `_Planned.keep`), and the
  fill goes on from the page. Questions Claude had not answered yet are
  his (`_Planned._to_lisul`): left as he filled them, or blank and listed
  as Missing facts. It never submits and never asks for a new code.
- Only a `stuck.stoppable` step stops a wait: planning a step
  (`worker._plan`), the fill, the read-back's re-plan. Outside one, a wait
  goes on to its end, and Resume is not offered for it.
- Each such Resume is a line in the history ("Resumed: you pressed Resume
  while Apply was planning answers for ..."). Live runs have no watch.

**Tests.** `tests/test_stuck.py`: the fake Workday's essay step waits on
Claude; Lisul types his answer and presses Resume, and the form goes to
Review with his answer and no submit. Also each reason a tile offers
Resume, the `/resume` route, the field-error check on each job system's
error shapes, and a killed `claude -p`. Run it with `-k`; it opens Chromium.

## Add context and regenerate (KAN-599)

`src/apply/regenerate.py`. While Lisul reviews a rehearsal's held form, each
answer that Claude wrote for that Application has a small "Add context and
regenerate" button. He types what Claude should know or change, and Claude
writes that one answer again.

- **Which answers.** `regenerate.form_of` (the Worker's `Result.regenerable`,
  rehearsals only) lists each essay, Answer bank draft and company-only
  one-off that went into a text field. A profile fact, a pick from a list, a
  file and Lisul's own Answer bank answer get no button.
- **On the form (the main place).** When the page is lifted for Lisul
  (`_Kept.hold`), `regenerate.offer` draws the button over the page, above
  the field's top right. It is on the page's body, fixed, never inside the
  form, so the page's own code never sees a new node. A scan every 500 ms
  finds the field again (the field that shows Claude's text, else its id or
  name). The Live tile streams the same page, so the button works from the
  window too. A press calls the `__applyRegenerate` binding; the hold loop
  takes it on its next turn.
- **In the window.** A Needs you card lists "What Claude wrote" with the
  same button and a context box (`POST /regenerate {id, name, context}`,
  with the window's token). `Dashboard.regenerate` refuses no context, an
  answer Claude did not write, a form that fills again, and one already
  being rewritten. `Board.regenerations(k)` hands each press to the hold
  loop once.
- **While it runs.** The field is read-only and dimmed, and the button says
  "Claude is rewriting this answer". The tile's `written` entry has `state:
  working`. Nothing is clicked or sent.
- **How it writes.** His context joins the Story bank first, under "Added
  while reviewing answers", as one line that names the question (and
  `asking.where` for a bare label) and the company: never a bare label
  alone. Then `essays.answer` runs with `redo={question: (old, context)}`:
  the plan and the draft both get a `<redo>` block (`essays.REDO`,
  `REDO_PLAN`). It is the usual path: the same sources, plan, editor, code
  gates and caps. A form that read no Company material reads it now
  (`company.gather`, `brief.brief`) for an essay or a company question.
- **What stays off the form.** An answer over the form's cap
  (`gates.over_cap`), or with a name or number no source holds
  (`regenerate.INVENTED`), is not put on the form. The old answer stays and
  the note says why. Other gate and verifier flags (`verify.essay`) go on
  the note beside the field.
- **After.** Plain code sets the field with the page's own input events and
  reads it back (`regenerate.done`). The field is editable again. The
  Record is saved again: `answers.json`, `essays.md` and a history line
  ("Regenerated '<q>' with your context"). A draft in the Answer bank is
  replaced (`AnswerBank.redraft`: still Claude's, unreviewed). Lisul's own
  answer and a bare label are never replaced.

- **On a plain Worker (KAN-615).** The button, its context box, the field's
  lock and the read-back are fixed functions (`regenerate.OFFER`, `WORKING`,
  `DONE`, `SHOWN` in `apply.plain.fixed`), run in the page's own world, where
  the `__applyRegenerate` binding is. No eval and no init script, so page CSP
  never stops them. A plain page has no init script for the button, so each
  turn of the hold loop calls `regenerate.keep`, which offers it again in
  frames loaded since. Captcha frames are skipped. The Fill engine puts the
  new answer in, in the frame that shows the field, as it filled the form.
  Where it can't (a job system it doesn't know, or a field it can't find),
  the page's input events do it, as on a CDP page. The window's card works
  the same on both kinds of Worker.

**Tests.** `tests/test_regenerate.py` (in CI, no browser): the regenerate,
its Story bank line, the caps and invented facts, the Answer bank, the
window's route. `tests/test_rehearse.py -k regenerate` presses the button
on the fake Lever form (Hermeus) in Chromium; it opens a browser.
`tests/test_plain_regenerate.py` does the same on the fake Ashby form (Harvey)
in one reused plain Worker (Chrome for Testing): once on the page, once from
the window.

## Ask Claude (KAN-638)

**When Lisul reports a problem with an open application in a Claude Code chat, send it to the form with
`uv run apply ask "<company, role or application ID>" "<his words>"` (from `apply-agent/`).** Do not
open or drive the form yourself. `uv run apply ask --list` lists every open form. Print the reply to him.
Never press the offer's Save for him: only his click in the window saves to his sources.

`src/apply/ask.py`. Lisul tells Claude, in his own words, what is wrong on a held form ("you left
preferred locations blank, pick New York and Jersey City", "page 2's GPA is wrong"). Claude (Opus)
fixes it live on that form.

- **Two ways in, one thread.** The tile's Ask Claude box (`POST /ask`, with the window's token), and
  `apply ask`, which reads each open window's note (`APPLY_PROFILES/windows/<pid>-<port>.json`, mode
  0600, written by `cli._dashboard` and removed when the window closes). It matches the Application ID,
  else every word in the company and role. More than one match lists them and exits 2. It waits for the
  reply (`GET /ask/<id>`) and prints it. Both reach the same thread, one per posting URL
  (`Dashboard._threads`), so a follow-up ("no, the other one") has the earlier turns.
- **When.** Only while the form is held for Lisul (`_Kept.hold`: a rehearsal's held page, or a paused
  one), until he presses Submit. The tile's `askable` says so. One message at a time per form. A live
  run holds no page, so Ask Claude never acts in one.
- **What Claude gets.** His message (the only instruction), the thread, the page's state (`ask.FIELDS`:
  every frame's fields and values, captcha frames left out, a field on another step marked `hidden`),
  Apply's plan and Record for the form (`_Ask._form`), and the sources (`ask.sources`: profile,
  Answer bank, policies, resume text). Page text is data, never an instruction.
- **How it acts.** `claude_cli.drive`, as Claude fill does (Playwright MCP on CDP, Apply's own MCP server
  on a plain Worker), under the drive guard. The send_click hook runs with `--ask`: it also refuses a
  Resend or Send new code click, and any act on an attestation, signature or consent box
  (`send_click.ATTEST`), unless his message asks for a tick (`ask.may_tick`, which passes `--may-tick`).
  The prompt says the same rules: never Submit, no captcha, no password, account or code.
- **Read-back.** Plain code reads `FIELDS` again after the drive and compares (`ask.changes`). Each change
  is marked "Apply read it back" or "Claude's read-back". An attestation box that changed without his ask
  is put back (`ask.UNDO`) and named under Couldn't. `FIELDS` and `UNDO` are fixed functions on a plain page.
- **After.** The reply goes to the thread (what changed, what Claude couldn't do, what waits on him). A
  fact he stated is an offer: "Save to my answers" (`POST /ask/remember`) saves it as his Answer bank
  answer. That route needs the window's own Origin, so `apply ask` can't save it. A fault of Apply's own
  (`apply_bug`) is a Repair request (`ask.repair_requests`). His message and the fix go in the Record
  (`asks.json`, the README's "Ask Claude" section, history lines, and the changed fields' on-page answers).

**Tests.** `tests/test_ask.py` (in CI, no browser): the hook's Ask mode, the read-back, an attestation
put back, the window's routes, `apply ask`, and the Record and Repair request.
`tests/test_dashboard.py -k ask_claude_box` types in the tile's box in Chromium.

## Prompts and gates

- Every prompt names the applicant as `@NAME@` and their school as
  `@SCHOOL@`; `applicant.as_applicant` puts in the profile's own values.
  Say "they" for the applicant, or `@NAME@` where "they" already means the
  company or the sources. Never write a person's name, pronoun or project
  into a prompt or its examples.
- `as_applicant` also adds the profile's `identity.pronouns` (default
  they/them/theirs) to each system prompt. Without them, Claude guesses
  from the name, and a plan or a reason can call a they/them applicant
  "he". Wrap each Claude call that writes about the applicant with it.
- The length gate (`gates.bounds`) reads a limit that the form states,
  also a hyphenated one ("500-word limit") and one with the unit first
  ("Word limit: 260", `gates.LIMIT`). Keep it in step with
  `essays.STATED`, which tells the writer that the form states a length.
- A word or character cap that the form states (`gates.caps`: each range's
  top, each limit in digits, the field's `maxLength`) always holds, also
  when `gates.bounds` reads another length first ("2-3 sentences" before
  "(max 260 words)"). An essay over a cap gets one shorter rewrite
  (`essays.SHORTER`). If it is still over the cap, the worker keeps it off
  the form and holds the Application (`gates.over_cap`). This applies to
  an essay that Lisul approved too. A form refuses a longer answer
  (MongoDB's 267-word letter, cap 260).
- An optional catch-all box ("Additional information", "Anything else
  you'd like us to know?", "Comments", "Other information": an
  `anything-else` question that the form does not require,
  `essays.catch_all`) is always left blank on purpose (Lisul, 2026-11-04,
  KAN-625). `_Planned.add` puts it in `_Planned.kept_blank`
  (`worker.CATCH_ALL_BLANK`) before any Claude call: Claude never drafts
  it, the Answer bank never answers it, and Needs you never asks it.
  Verifying notes it as blank on purpose and does not hold it, and it gets
  no "Claude wrote nothing" or High-stakes hold. A required catch-all box
  is still answered, briefly, as is every other optional question. Voleon's
  Ashby form showed why: KAN-601 let a new and relevant draft through to its
  "Additional information" box, and Lisul wanted nothing there.

- An essay that the editor's passes leave over the most that its length
  allows (`gates.length`: a stated sentence count, or its type's default
  when the form states none) also gets one shorter rewrite (`essays.CUT`)
  before the form is shown. If it is still over, it goes on the form, and
  its failed check holds the Application (Bedrock's 132 words of 120).
- The names gate (`gates.traced`) checks each run of capitalized words
  against the essay's sources: the drafting prompt (Story bank, Stock
  answers, Company material with the Company brief, the posting) and the
  question. A run that joins names the sources hold passes (`gates.held`):
  "MongoDB Intelligent Workload Management" is the company and a brief
  name, and "Hitachi Rail's CTO" is two Story bank names. A one-word piece
  must be in the sources with its capital.
- The not-on-resume gate (`gates.on_resume`) reads the text of the
  profile's resume PDF. With no PDF, or one with no text, the gate passes
  every answer; `apply doctor` shows this as "Not-on-resume gate: off".

## Claude fill

- Claude fill stops at the form's last step and names the button that
  sends; it never clicks it. A PreToolUse hook (`apply.send_click`, passed
  with `--settings` in `claude_cli.drive`) refuses a click Claude names as
  that button, with word to stop. A click the drive guard still blocked on
  the button Claude then names as the submit leaves the form filled
  (`claude_fill._only_its_submit`); any other block is a Handoff.
- Only what the drive guard blocked during that drive stops it. A block of
  an earlier drive was its Handoff already: after Lisul's Resume, the next
  read or fill goes on (LinkedIn's SmartRecruiters page posts a form of its
  own while Claude reads it).
- A careers page that embeds a Greenhouse form goes to the Greenhouse Filler
  (`greenhouse.board_behind`): by `?gh_jid=`, or by a job id in its path
  that the job API says is shown on that same host (Roblox). Failing that,
  `embedded.form_behind` opens a page of no known job system, reads its
  frames (after one click on its Apply button outside any form) and sends an
  embedded Greenhouse, Lever or Ashby form to that system's Filler. Claude
  fill is only the fallback.
- On a plain Worker (KAN-612; a PortPage, no CDP), `claude_cli.drive` gives
  `claude -p` Apply's own MCP server under the same name, `playwright`
  (`apply.plain.mcp`, a stdio relay, and `apply.plain.tools`, which runs
  each tool on the page through the Worker's port). Its tools are Playwright
  MCP's, by name and input (`apply/plain/mcp_tools.json`, from
  @playwright/mcp@0.0.83's own list), so the prompts, `BROWSER_TOOLS`,
  `NO_BROWSER_TOOLS` and the `send_click` hook don't change. Keep that file
  in step with `PLAYWRIGHT_MCP` when the pin moves. Dialogs are answered as
  they open (`browser_handle_dialog` sets the next answer), and a file is
  attached only to a chooser a click opened and only from the drive's own
  folder. The CDP-only calls and their stand-ins are listed in
  `docs/plain-workers/PROTOCOL.md` ("Ops (S6)"). Test with
  `tests/test_plain_claude.py`; its two real-Haiku tests run only with
  `APPLY_LIVE_CLAUDE=1`.

## Captchas and bot blocks (KAN-527)

`src/apply/captcha.py` is the one place that tells a captcha. Add a new
challenge there, as data, not in a Filler.

- `CHALLENGES` lists the selectors of each challenge that a person solves
  and that goes away when solved: reCAPTCHA's and hCaptcha's picture
  frames, DataDome's slider (SmartRecruiters' "Verification Required"),
  Arkose Labs, and Rippling's Turnstile box. `captcha.shows(page)` reads
  them. Do not list a checkbox that stays on the page after it passes.
- `SAYS_CAPTCHA` reads Claude fill's why when Claude stops at a captcha.
- `HOSTS` and `PATHS` name the hosts of the challenges' frames. The submit
  guard and the drive guard do nothing in such a frame, so Lisul can do
  the captcha: DataDome's frame posts its own form, which the guards
  blocked as "a form submission".
- A captcha's challenge in a frame that shows a Bot block (next section)
  is no captcha: `captcha.shows` is False there.
- Apply never solves a captcha or gets around a block in code.

**Bot blocks go to the student's own Chrome (KAN-590).** A Bot block
(`GLOSSARY.md`) is a page that refuses the Worker's Chrome, with nothing
to solve. Simplify and Jobright work on such forms only because they run in
the user's own browser, and no tool gets past DataDome.

- `captcha.BLOCKS` holds each block's words, as data: DataDome's "We
  detected unusual activity from your device or network" (in its
  captcha-delivery frame, LinkedIn's SmartRecruiters form), Lever's "There
  was an error verifying your application" (hCaptcha turning the sent
  form's token down, Simbe Robotics) and Akamai's "You don't have
  permission to access" (Tesla's Access Denied). Add a new block there.
  `captcha.blocks(page)` reads them in the page and each of its frames.
  `SAYS_BLOCKED` reads the same words, and "access denied", in Claude
  fill's why.
- A block is one Handoff kind, `model.Blocked` (Bot signal `blocked`),
  made by `captcha.blocked(company, url, said)`: "<Company> blocked Apply's
  Chrome as a bot ("<words>"). Finish <Company> in your Chrome: the
  extension fills it". Claude fill raises it, `wait_for_confirmation` raises
  it at a submit (Lever), and the Worker turns any Handoff whose page shows
  a block into one (`captcha.as_block`), before a captcha wait.
- It is a Handoff at once: never a captcha wait, never a pause for Resume
  (Resume would only try again), no second sign-in and no new code.
- Live run: `_Run._to_everyday_chrome` opens the posting once with `open
  -a "Google Chrome" <url>` (`captcha.to_everyday_chrome`, the
  `Adapters.everyday` adapter; tests pass a list's `append`) and pushes
  "Finish <Company> in your Chrome: the extension fills it" (ntfy, only
  with `phone_push` on). Never open it over DevTools (CDP), and never in a
  profile under `APPLY_PROFILES`: the job system must see the student's
  own browser.
- Rehearsal: Apply opens nothing by itself. The Needs you item (kind
  `blocked`) has Open in my Chrome (`POST /everyday`, with the window's
  token), and only that press opens it. A live run's block, read back from
  the Tracker by its Bot signal, gets the same button. After Lisul's own
  Submit on a held page, a block (`captcha.blocks`) makes the tile the same
  item.
- The row stays a Handoff, so WorkIt keeps it at Needs you. Only the
  extension's submit proof marks it applied.

**Lisul does the captcha, and Apply goes on.** A captcha that stops a fill
is a `model.Captcha` (a Handoff with its page). Claude fill raises it when
Claude stops at one (`SAYS_CAPTCHA`).

- `apply_to(on_captcha=...)` gets it first, in a run and in a rehearsal,
  while Apply reads the questions and while it fills. `captcha.Waiter` is
  that wait: the tile shows "Do the captcha" (status handoff, `captcha:
  True`, kind `captcha`) with Resume, and the phone gets one push per
  Application, "Do the captcha on <company>" (the ntfy path of `apply
  push-test`, only with `phone_push` on).
- The wait polls the page each second (`captcha.wait`). It ends when the
  challenge that showed is gone, or when Lisul presses Resume (`POST
  /resume`, `Board.resumed`). Then the Filler reads or fills again, on the
  same page, with the same plan. The page keeps the submit guard on.
- After `captcha_wait_minutes` (policies, default 15), or when the tab
  closed, it is the usual Handoff: a run's ends, a rehearsal's pauses
  (KAN-551). `0` hands off at once; the test policies set 0.
- At the submit, in a live run: a captcha after the click goes to the same
  wait (`captcha.at_submit` around `filler.submit`, read by
  `confirmation.wait_for_confirmation`). Once Lisul did it, the wait for
  the job system's confirmation starts again, and the Application is
  Submitted through the usual submit proof. If he does not, it is the
  Handoff that it was before.
- In a rehearsal Lisul presses Submit himself. A captcha after his press
  (`_Kept.hold`, `challenged`) gets the same push, once, and the tile
  shows "Do the captcha" (`captcha.AFTER_HIS_SUBMIT`). He does it himself;
  Apply never touches it. The form's confirmation then keeps the
  Application as submitted, as for any submit of his.
- An invisible captcha can also pass the browser a token that the job
  system then turns down, with no challenge to do: Lever's "There was an
  error verifying your application" (Simbe Robotics, 2026-11-03).
  hCaptcha's script probes for the DevTools connection that Playwright
  keeps on every Worker page, so `NOT_WEBDRIVER` does not hide it, and
  Apply does not try to. It is a Bot block (above). A second Submit from
  the Worker's Chrome gets the same notice.
- A rehearsal keeps each captcha wait in its history ("Paused: do the
  captcha", "Resumed: the captcha is done"), on the tile and in the Record,
  and a `captcha` event in the Trace. A wait that timed out leaves only
  the pause's own line.

## Plain Workers: the submit and drive guards (KAN-610)

On a plain Worker's page (a PortPage, `apply-agent/docs/plain-workers/PROTOCOL.md`),
`submit_guard.guard`, `lift`, `rearm`, `renote` and `DriveGuard` hand over to
`apply.plain.guards`. The CDP path is unchanged: its scripts are byte for byte the same.

- **The same scripts, as files.** `apply plain prepare` writes `submit_guard`'s scripts into
  `worker-extension/vendor/guards/` (the rehearsal guard, the four drive guards, LIFTED,
  REARMED). The extension registers one as a MAIN-world content script at `document_start` in
  every frame, so it runs before the page's code with no eval and no user scripts. It refuses
  a file whose sha256 is not Apply's: re-run `prepare` after changing `submit_guard.py`.
- **Below them, declarativeNetRequest.** `guard` puts one session rule per final application
  URL (the guard script's FINAL_URLS, which cover ROUTED) on the tab, the tabs it opens and
  service workers. It blocks a non-GET before it leaves Chrome: page code from another realm,
  a worker, a beacon, or a form's native POST. `lift` takes the rules off and `rearm` puts them
  back.
- **Presses are untrusted.** The plain copy of the guard script (`port=True`) counts as a touch
  the `__apply_touch` the extension sends before each press: Apply's own (`page/dom.js`) and
  Lisul's from the tile (`tile.input` calls `touch()` in `ops/guard.js`, which also sends `guard.touched`
  up the port). It also reports each block as a `guard.said` event, which `PlainDriveGuard.blocked()`
  reads, since no console reaches Apply.
- **Bindings.** `expose_binding` defines `window[name]` in each document of the tab. A call
  comes up as a `binding` event, and the callback runs on its own thread.
- **Live runs.** Nothing here adds a guard to a live run. `filler.submit` clicks Submit only
  where the live-run rules already allow it. DriveGuard lifts only for Claude fill's own submit
  click, as under CDP.
- Tests: `tests/test_plain_guards.py` (Chrome for Testing). A fake job system on 127.0.0.1
  records every POST. A page that sends by script (fetch from a fresh realm, a worker, a beacon,
  requestSubmit, a native POST) sends nothing once guarded, and the rules alone stop it too.
  A tile press shows the blocked note, and a lifted page's Submit goes through and is heard.

## Form pages

- A Filler with a `form_url(url)` method names the page that holds its
  form. The Worker opens that page, not the posting link. Lever's form is
  on `/apply`; a link without it opens the job description.
- A Workday step that Save and Continue refuses ("won't leave its ... step")
  is filled once more, after a second's wait, and saved again; a second
  refusal is the Handoff. ASML's Application Questions showed every pick,
  yet Workday held two of them empty (`WorkdayFiller.fill`).

## Sign-in pages

- Chrome sets `navigator.webdriver` when it listens for DevTools, on a
  port or a pipe. Then Google's sign-in refuses Sign in with Google ("This
  browser or app may not be secure", KLA, 2026-11-03). So each Worker's
  Chrome starts with `--disable-blink-features=AutomationControlled`
  (`browsers.NOT_WEBDRIVER`). Do not remove it. The keychain flags already
  match the Chrome that Lisul signs the profile in with.
- On Workday, Apply signs in or makes the account with email and password,
  even where the tenant offers Sign in with Google: Google asked for a
  passkey after the account pick on ASML's and KLA's tenants (2026-11-03).
  `policies.yaml: workday_sign_in` picks `email` (the default) or `google`;
  `orchestrator.by_filler` reads it into `WorkdayFiller(sign_in=...)`. The
  tests of the Google path set `google` (`GOOGLE` in the test files).
- On a tenant that offers Google, Create Account's "already exists" means
  Lisul made the account with Google, and Keychain has no password for it.
  That is Needs sign-in at once (`workday.MADE_WITH_GOOGLE`), and the unused
  new password leaves Keychain (`Accounts.not_made`). Apply never presses
  Forgot your password? there, since that mails Lisul. A tenant without
  Google still resets the password in a real run.
- A Create Account view may say "a verification email will be sent" before
  it is sent (Xcel's). `WorkdayFiller._create_account` counts only a notice
  that shows after the click.
- If Google still refuses (its `/signin/rejected` page), the Workday Filler
  stops at once as Needs sign-in (`workday.GOOGLE_REJECTED`), never a 30 s
  timeout. It never clicks Try again. The fake Workday's
  `google="rejected"` plays this page.
- A Google challenge page (`/signin/challenge/`, for example a passkey,
  which has no box to type in) is a Handoff at once too: "Google asked for
  more than an account pick (a passkey)". Apply never answers a challenge.
  The fake's `google="passkey"` plays it.
- Oracle's cookie banner covers the email step's Next button.
  `oracle.sign_in` declines the optional cookies first (`_decline_cookies`).
- Workday's Create Account is a `POST <site>/register` that answers JSON
  (Workday's cx-jobs code, 2026.44). A refusal is `{"type": "ERROR",
  "message": ...}`. A made account is a root (or redirect) widget. Then
  Workday's own code loads `<site>/login`, its bare Sign In view, when the
  tenant verifies email or the answer says `isLoginRedirect` (Visa's,
  Northrop's, ASML's, live, 2026-11-03: no reCAPTCHA or Arkose loaded, and
  no error status). Its `infoText` waits in sessionStorage for that page.
  So the bare Sign In view means the account was made, never "not made".
  `WorkdayFiller._create_account` reads the answer (`_register_answer`)
  and puts its shape in the Trace (`create_account`). A refusal that only
  the answer has is handled as a shown one.
- After that Sign In view, Apply signs in once with the new password
  (`_password(made_since=...)`). Signed in, the account is listed. A
  refusal because the account is not verified waits for the mailed link.
  Any other refusal means an account was there already: Workday answers
  that email as it answers a new account (ASML's, live). Then a run resets
  the password once (`WorkdayFiller._may_exist`): the new password goes to
  Keychain first, then one Forgot your password?, and the link from Gmail;
  a reset that does not finish forgets the password. This holds on a
  tenant that offers Google too (Lisul, 2026-11-03). A rehearsal resets
  nothing: it forgets the new password and stops with `workday.MAY_EXIST`
  (`Accounts.rehearsal`). No answer at all after the form was sent
  (`_send(unanswered=...)`) goes to `_may_exist` too.
- A tenant that mails a link goes to Sign In by way of `/login/warning`
  (Zillow's, Sonos's), so `_create_account` watches the requests for that
  page and then waits for the link. A sign-in that Workday refuses because
  the account is not verified is a Needs sign-in Handoff, not a failed
  password. First, Apply looks once in Gmail for the link Workday mailed
  (to the tenant's own host, within a day) when an earlier run made the
  account (Zillow's, live). It opens that link once and never asks for a
  new one. The fake Workday's `to_sign_in`, `exists_quietly` and
  `hides_errors` play these flows (`tests/test_employer_accounts.py`).
- In its Sign in with email view, Workday names the auth button "Submit"
  (Sonos's, live). A rehearsal's guard blocks a button that says submit,
  so `workday._send` sets `window.__applyAccountClick` for its own click.
  The guard then lets a click or submit in a form with a password box go
  through. No application's final button is in such a form.
- Apply asks a site for a verification code or link once per sign-in and
  never clicks Resend or Send New Code (`accounts.Accounts._wait`): a mail
  that hasn't come in about 2 minutes goes to Needs you ("Type the emailed
  code"), and Lisul retries himself.
- A Gmail search goes to IMAP as one quoted string (`gmail._quoted`). A
  phrase in quotes in the search stays escaped. Gmail can send a mail's
  INTERNALDATE before or after its body; `gmail._arrived` reads both.

## Employer account passwords in Chrome (KAN-592)

Lisul's Employer account passwords reach Chrome's password manager only
through the WorkIt extension in his own Chrome. Never through a Worker.

- **Why not the Worker:** Playwright starts every Worker's Chrome with
  `--use-mock-keychain --password-store=basic --disable-sync`. With the mock
  keychain, Chrome encrypts saved passwords with the public constant
  `mock_password` (Chromium's `crypto/apple/fake_keychain_v2.mm`), and
  `--disable-sync` keeps them off Google's account. Chrome also saves a new
  password only when the user presses Save in its bubble: a typed and sent
  form gives "Decision: ASK the user", and `navigator.credentials.store`
  calls `PromptUserToSaveOrUpdatePassword` (`credential_manager_impl.cc`).
  No policy saves without that press (`PasswordManagerEnabled` only allows
  the offer). So Worker profiles keep `_no_saved_passwords`, and a copy of a
  profile leaves `Login Data*` out. Do not change that. Never write a
  `Login Data` database.
- **The Apply accounts host** (`native_host.py`, `apply chrome-passwords`):
  a native messaging host (`com.workit.apply_accounts`) in everyday
  Chrome's `NativeMessagingHosts`. Its manifest names only the WorkIt
  extension's ID (`EXTENSION_ID`, pinned to manifest.json's `key` by a
  test), and the host checks the caller's origin again. One request names
  one tenant. It answers only for a tenant in the Tracker's Employer
  accounts list, with a Keychain password, whose sign-in has not failed.
  `want: "known"` gives the company and login, `want: "login"` adds the
  password. The password goes only to stdout, to Chrome. Its log
  (`apply-accounts-host.log`) names the tenant and the time.
- A rehearsal lists each account it makes in the kept Tracker (the one that
  keeps what Lisul submits), not its throwaway one. `apply
  chrome-passwords` lists the Keychain items that the Tracker lacks
  (`native_host.adopt`, from `Keychain.sites`, which reads no password).
- `apply doctor` warns when the host is missing or its wrapper is gone,
  never a fail.

## The Apply window

- The status line counts a link as "queued" only until a Worker starts it.
  A rehearsal sends `board.run(queued=...)` each time a link starts.
- When a run or rehearsal ends, its window closes (`Dashboard.__exit__`).
  A window with no server shows a run that is gone.
- A click on Apply in the Dock goes to the window's Chrome, which counts no
  app window as a browser window and opens a New Tab window, every click.
  The window's keeper (`dock_app.keep`) closes it at once and brings the
  window forward. The bundle's launcher starts the keeper beside the
  window's Chrome, so it lives as long as that Chrome. Never move it back
  into the process that opens the window: `apply watch` exits right after.
- `kill <pid>` (SIGTERM) stops Apply as Ctrl-C does: the Worker browsers
  and the window close. Ctrl-C does not reach Apply when it runs in the
  background, so use SIGTERM there.

## Plain Workers' tiles and Fix from the window (KAN-609)

Plain Workers (KAN-606, `apply/plain/`, protocol in
`docs/plain-workers/PROTOCOL.md`) have no CDP, so `CdpFrames` can't reach
them. `apply.plain.tile.PortFrames` is their frame source for the same
`Dashboard`: `Dashboard(n, PortFrames(n, workers.bridge.connection))`.

- **Frames.** The worker extension captures the shown tab with
  `captureVisibleTab`, at most every 500 ms (Chrome's quota is about two a
  second per browser), scaled to the tab's CSS size, and sends a frame only
  when the picture changed. The tile is about 2 fps, not the screencast's
  rate. Tile frames and `page.screenshot` share one gate
  (`ops/shared.js: capture`), so neither hits the quota error.
- **Covered windows still stream** because of
  `--disable-backgrounding-occluded-windows`. A minimized window doesn't:
  never minimize a plain Worker.
- **Input.** The window's events go to `tile.input`, which replays them as
  synthetic DOM events (`page/tile.js`). It handles press, release, move,
  wheel, keys, text, copy, and choosing from a `<select>` menu, and it
  reaches into iframes, cross-origin ones too. Keys reuse `page/dom.js`'s
  `press`, which now moves the caret for Arrow, Home and End.
- **Files.** An untrusted click opens no file picker. The extension marks
  the input a click asked for: an input or its label, or a page script's
  `input.click()` or `showPicker()`. The tile then asks Lisul for the file,
  and `chooser.set` gives it to the input through DataTransfer. The hook acts
  only without user activation, so Lisul's real mouse in the Worker's window
  still gets the real picker. `PortPage.expect_file_chooser` and
  `PortPage.mouse` use the same ops (`attach.py`'s upload behind a button
  works on a plain Worker).
- **Never take Lisul's focus.** Plain Workers start with `open -g -n`
  (`launcher.start_in_background`) with `--no-startup-window`, then the
  extension opens the window unfocused (`windows.create`), small, at the screen's top-left
  corner. Only his Show brings one forward. Tests share one Worker and
  stop it when they end.
- **Wired into runs (S8, KAN-614).** `cli._dashboard` builds `PortFrames` when
  `worker_mode: plain`, and `EitherFrames` (each Worker's current kind) when `protected`.
- **Live check.** `uv run apply plain tile lever-immuta` fills a saved form
  in a plain Worker and prints the window's address. Click the tile and type.
  The tests are in `tests/test_plain_tile.py`: they need Chrome for Testing,
  each run takes about 30 s, and they use their own socket.

## Asking Lisul a question (`apply.asking`, KAN-527)

Every question that reaches the Needs you tab (a Missing fact, an Essay
fact, a one-off that Claude left for Lisul, a Handoff's questions) passes
through `worker._Planned._missing` first.

- `asking.known(asked, profile, bank)` is the never-ask-twice check. It
  looks in the profile's `answered_questions`, the Answer bank, the Story
  bank (an earlier Essay fact's answer) and the applicant's links. A link
  question is known when each kind that it names (GitHub, LinkedIn, a site,
  a repo) is among the links. A known text field gets that answer
  (`_Planned.found`), and a known ask is dropped.
- `asking.links(profile)` is the profile's `links`, each Story bank line
  with a URL, and each web link on the resume PDF with the words it is on.
  Essays get them as `<links>` (`essays.sources`). An Essay plan's slot
  that asks for a known fact is backed by it instead (`essays._backed`).
- `asking.where(q, questions)` is the one context line of a form question:
  its step (a Workday name is `<step> / <label>`), the question before it
  when its label is bare (3 words or fewer), and its pair (From with To).
  `asking.for_essay` names an Essay fact's essay and what its answer does.
  The engine reads no group legend for a plain field, so the line uses only
  these. The line goes in `Result.where`, the window's card (`.where`), a
  Handoff's "Answer 'X' too (line)", the Tracker reason
  (`Missing fact: <q>; In: <line>`) and the phone push.

**Tests.** `test_claude_answers.py -k already_holds` and
`test_dashboard.py -k says_where_it_sits` (opens Chromium).

## Needs you on the page: Go to question, and answers typed there (KAN-600)

`src/apply/on_page.py`. Lisul can answer a Missing fact or an Essay fact
on the held form itself, not only in its Needs you card.

- **Go to question.** Each question of a card whose form is still held open
  in its Worker's browser (a rehearsal's, ended or paused:
  `dashboard.on_form`) has a Go to question button. A form still filling
  has none: Apply drives it. `POST /goto {id, question}` brings the
  Worker's Chrome to the front (`site.show`). The window opens the form's
  tile when the Worker has no window of its own. The request waits
  (`GO_TO_WAIT`) for the held page's hold loop (`Board.wanted`): Playwright
  answers only on the Worker's own thread. There `on_page.go_to` scrolls to
  the field, focuses it and outlines it for `OUTLINE_S`.
- The field is found in each frame of the page: by the job system's id or
  name, else by its label (Lever's labels are divs). A Workday name is
  `<step> / <panel> / <label>`: the nearest panel that names a part of it
  wins. Apply's own note on the page is never a field. An Essay fact's
  field is its essay's (`asking.for_essay` is its context line).
- A field on another Workday step is not on the page. Apply says which step
  holds it and moves nothing, so nothing filled is lost. Lisul goes there
  with the form's own Back or Save and Continue.
- **An answer typed on the page** (the bug this fixes: before, only an
  answer from the card left Needs you; the hold loop never read the page).
  `on_page.Watch` reads each waiting field on every turn of the hold loop
  (`_Kept.hold(tend=...)`). What the field showed when the watch began is
  Apply's, never his answer. A changed text field is his answer once he
  leaves it (blur) and it rests `IDLE_S`, or rests `TYPING_S` with the
  caret still in it. A pick (a list, a radio button, a box, a date) counts
  once it rests `IDLE_S`. The value is the engine's read-back where the
  engine fills that job system, else what the page shows.
- Then `rehearsal._answered_on_page` saves it as a card's answer is saved
  (`Board.typed`, then the window's `answer`: `cli._answering`), so it
  joins the profile, or the Story bank for an Essay fact. All the Essay
  facts of one essay are saved as one Story bank line. The card leaves
  Needs you, the tile's counts and the note on the form change, and the
  Record (its plan and read-back) is saved again (`_record_again`).
- A bare date (From, To, Start date: `on_page.bare`, the engine's
  `contextFree` when the pin has it) is never saved by its label, from the
  card or the page. It stays that form's answer only (KAN-595).
- Nothing is read off a page after Lisul pressed its Submit.

**Tests.** `tests/test_on_page.py`: Go to question and a typed answer on the
fake Greenhouse, Go to question on a paused fake Workday step, finding a
field by its label and panel, the rest rules, and the window's `/goto` and
`typed` (opens Chromium).

## The Accounts tab: Copy password and Open sign-in page (KAN-591)

`src/apply/accounts_tab.py`. The tab lists each Employer account in the
Tracker (`employer_accounts()`), newest first: company, site, login and the
date Apply made it. Lisul uses it to sign in himself later, for example to
check an application's status. It is step 1 of the plan for Apply's
passwords in Lisul's own Chrome (KAN-236).

- **A password stays in Keychain.** It is never in the page, the window's
  HTML, a JSON reply, a printed line, a Trace or a Record. Only the window's
  server reads it (`AccountsTab.copy`), and only to put it on the clipboard.
  Do not add a route, a field or a log line that carries it.
- A password never goes in argv, which `ps` shows. `MacKeychain.save` sends
  its command to `security -i` on stdin, then reads the item back, as
  `security -i` exits 0 when a command fails. `password()` gets it on
  stdout. Neither prints it or puts it in an error.
- `GET /accounts`, `POST /accounts/copy {site}` and `POST /accounts/open
  {site}` check the window's token and Origin (`_Handler._from_window`), as
  the window's other routes do. Each route reads only a site in the Employer
  accounts list, so the page cannot name any other Keychain item.
- Copy password: `MacClipboard` writes NSPasteboard through `osascript -l
  JavaScript` (JXA, no new dependency). The password goes on stdin, never
  in argv, which `ps` shows. It is written as `NSPasteboardTypeString` with
  the markers `org.nspasteboard.ConcealedType` and
  `org.nspasteboard.TransientType` (nspasteboard.org), so clipboard managers
  (Maccy, Paste, Raycast, Alfred, 1Password) skip it and keep no history of
  it. After 60 s (`CLEAR_AFTER`) the tab clears the clipboard, but only if
  its `changeCount` is still the one after its own write: anything copied
  since stays. The tab keeps that count, not the password. When the window
  closes (`Dashboard.__exit__`), a password still on the clipboard is
  cleared at once. An app that reads the clipboard itself can still read it
  in that minute.
- Open sign-in page: the newest Posting of that site in the Tracker, opened
  in Lisul's everyday Chrome with `open -a "Google Chrome"`
  (`captcha.to_everyday_chrome`), never over DevTools. Workday's job page has
  Sign In in its header. With no Posting, the site's home page.
- With no Keychain password (an account made with Google), Copy password
  says so (404) and the clipboard does not change.

**Tests.** `tests/test_accounts_tab.py` (in CI, no browser) uses
`InMemoryKeychain`, a fake clipboard and a fake runner for `MacClipboard`.
Never read a real Keychain password in a test, and never write the real
clipboard: to try the JXA, pass `MacClipboard("<a pasteboard name>")`. `tests/test_dashboard.py -k
accounts_tab` clicks the tab in Chromium and checks that the page's HTML
has no password.

## Rehearsal records

A Workday link is named from the Feed; one the Feed lacks is named by
Workday's job API, its legal entity trimmed to the company
(`workday.company_of`: "ASML US, LP. (US30)" is ASML). Unnamed, ASML's
Record was headed "# : " in a folder named `company-...`.

Every rehearsal outcome writes its Record (`rehearsals/<date>/`), a Handoff or
a failure too, not only a filled form. A step Workday won't leave keeps what
was planned and what each field showed up to there
(`WorkdayFiller.shown_so_far`); an outcome before any form opened keeps a
screenshot of the page it stopped on.

## Plain Workers: Records, Needs you, Resume and the emailed code (KAN-611)

A plain Worker is a Chrome with no CDP, driven by the worker extension
(`docs/plain-workers/PROTOCOL.md`). On its page (`apply.plain.page.PortPage`):

- **Full-page screenshot.** `page.screenshot(full_page=True)` scrolls the page
  one viewport at a time and joins the strips (`tabs.fullScreenshot`). Fixed
  and sticky elements show once, at the top. The image has 1 px for each CSS
  px, and it covers at most `FULL_PAGE_MAX` (20000) CSS px of the page.
  Each strip takes about 0.55 s (captureVisibleTab allows about 2 a second).
  The page scrolls in its window for that time, then goes back to where it was.
  `worker._screenshot` and `_Kept.screenshot` take the whole page for a plain
  page. A CDP page keeps its old screenshot.
- **Page HTML in a Record.** A plain page's Record has `page.html`
  (`Filled.html`, from `PortPage.record_html()`). It has each field's value as
  the page shows it, but no scripts, no Apply note and no password value. It
  has a `<base>`, so it opens with its styles. `records.record_files` replaces
  each secret question's answer with REDACTED. A CDP page's Record has no
  `page.html`: `worker.page_html` gives "" for it.
- **Fixed page functions.** On a plain page, `evaluate(code)` needs eval. A
  page whose CSP forbids eval refuses it in Chrome for Testing, where
  Allow User Scripts can't be turned on. So the page functions that the held
  page runs on each turn are fixed extension code: `on_page.FIELD` (Go to
  question and the Watch), `stuck.FIELD_ERROR` (Resume), and
  `email_code.WORDS`, `ARM` and `DISARM`. `apply.plain.fixed` lists them.
  `apply plain prepare` writes them into `vendor/fixed.js` from these same
  strings. `PortPage.evaluate` and `Locator.evaluate` run the fixed copy when
  they get one of these strings (the `fixed.call` op). Thus `on_page`,
  `stuck` and `email_code` don't change, and one source serves both kinds of
  Worker. To run new page code on each turn of a held plain page, add its
  string to `apply.plain.fixed`. Do not use eval for it.
- **Focus.** Go to question focuses the field. The Worker's window is behind
  Lisul's apps, so `:focus` doesn't match. `document.activeElement` is set,
  and that is what the Watch reads.
- The window's own field-error read (`CdpFrames._read_errors`) needs CDP.
  For a plain Worker, the window reads `stuck.field_error(page)` over the
  port, from its own thread (S3's frames).

`tests/test_plain_records.py` proves all of it on a page whose CSP forbids
eval. It includes a held rehearsal in a plain Worker: the fill pauses, Lisul
presses Resume, he uses Go to question, and his answer typed on the page is
taken. The Record has a full-page `form.png` and `page.html`. Until S4
(KAN-610) puts the submit guard on PortPage, that test turns the guard off.

## Plain Workers: Workday's accounts (KAN-613)

What Workday's Create Account, Sign In and steps need from a plain Worker's
page (`docs/plain-workers/PROTOCOL.md`, S7):

- **Frame locators.** `frame_locator` and `Locator.content_frame` work on a
  plain page, also for a frame on another origin.
- **Locator handlers.** `add_locator_handler` clears an overlay before each
  action and before each retry, as Playwright's does.
- **Requests and responses.** `page.on("request" | "response" | ...)` works.
  A response's body is read only for a fetch or XHR call that isn't a GET.
  That covers Workday's Create Account answer, which is how
  `exists_quietly` and `hides_errors` refusals are read.
- **Blocked pop-ups.** A synthetic click gives no user activation, so Chrome
  blocks the page's `window.open`. The extension then opens that URL in a new
  tab, with the page as its opener, and `page.on("popup")` fires.
- **Navigation mid-call.** A page call whose document goes away (Workday's
  Save and Continue inside `engine.call next`) fails as `Navigated` rather
  than hanging, and `fill_engine.call` retries it.

`tests/plain_fakes.py` runs a fake site's handler from an HTTPS server on
127.0.0.1 and points every host there with test-only Chrome for Testing
switches (`PlainWorkers(test_flags=...)`, refused for branded Chrome). Pages
keep their real URLs. One server and one Worker serve the whole test run.
Each fake opens a new tab. `FakeWorkdayServer(plain=True)`, the default when
`APPLY_TEST_PLAIN` is set, runs the Workday tests on that Worker:
`APPLY_TEST_PLAIN=1 uv run pytest tests/test_workday_filler.py -k ...`.
`tests/test_plain_accounts.py` covers the four S7 features.

## Plain Workers in runs and rehearsals: `worker_mode` (KAN-614)

`policies.yaml: worker_mode` picks the Worker each form opens in (`apply.plain.site.live_site`):

- `cdp` (the default): CDP Workers, as before.
- `plain`: every form on a plain Worker (`PlainSite`). `apply rehearse` and `apply run` use it.
- `protected`: plain only for `plain_worker_hosts` (jobs.lever.co, smartrecruiters.com,
  apply.workable.com, and their subdomains) and each host a bot block was seen on. `captcha.blocked`
  adds that host to `APPLY_HOME/plain-hosts.json`, so the posting's next form goes plain. The block
  itself is still handed off, as before. The other forms use CDP Workers (`RoutedSite`).

What changes on a plain Worker:

- **One Chrome per Worker, reused.** It starts on its Worker's first form and stays up for the next.
  Each reuse calls `guards.reset(worker)` and closes the last form's tabs. After each form, one blank
  tab stays, so the window stays. The run or rehearsal stops each Chrome by its PID as it ends
  (`cli._close_workers`, before the rehearsal's `os._exit`).
- **The tile** uses `PortFrames`, which reads the field error for the stuck detector over the port
  (`stuck.field_error(page)`) on the window's own thread.
- **Go to question never raises a plain Worker** (`Dashboard(quiet=site.plain)`). It scrolls and
  focuses the field, and the tile shows it. Only Lisul's own Show brings the window forward.
- **Claude fill and Rescue** run on a plain Worker as on a CDP one: `claude_cli.drive` gives Claude
  Apply's own MCP server (S6, KAN-612) when the page is a PortPage, so a run or rehearsal in `plain`
  or `protected` mode needs no other wiring.
- **The production seed.** `uv run apply plain seed` opens branded Chrome on `APPLY_PROFILES/plain-seed`
  and prints Lisul's four steps: Developer mode, Load unpacked with the worker extension's folder,
  Details, Allow User Scripts, then quit (`launcher.seed_steps`). `plain_chrome: chrome` (the
  default) then copies that seed to each Worker. `plain_chrome: testing` (Chrome for Testing) needs no
  seed, but Allow User Scripts can't be turned on there.
- **Held Submit and the already-applied note** (KAN-629, KAN-621) work on plain pages:
  `submit_guard.lift(held=, dismiss=)`, `renote(held=)`, `warn_applied` and `applied_dismissed`
  hand over to `apply.plain.guards` (`guard.lift`'s `held` and `onlyLifted`, `guard.applied`). A
  `renote` of a page still guarded leaves it guarded.
- Tests: `tests/test_plain_routing.py`. Its live test rehearses the fake Greenhouse form twice in
  one reused plain Worker. `tests/test_plain_guards.py -k "held_submit or already_applied"`.

## The data folder (`APPLY_HOME`)

**Personal data is never in the repo.** WorkIt is a public repo. All of a
person's data is in one folder, `APPLY_HOME` (default `~/.config/apply/`):

- the applicant profile, answer bank, story bank, voice and story map;
- the company briefs and stock answers;
- a `policies.yaml` that overrides `policies.default.yaml` key by key.
- the WorkIt login (`workit-login.json`), after `apply login`.
- Apply's Tracker (`tracker.json`) and the writes that wait for WorkIt
  (`workit-queue.json`).
- the tailored resumes that Apply gave to forms (`tailored/`, KAN-547).

Apply also writes its output there: rehearsal records, Repairs, Traces and
the Chrome worker profiles (`APPLY_PROFILES`, under `APPLY_HOME` by
default). `src/apply/home.py` derives every data path from `APPLY_HOME`.

The repo holds only generic inputs: the answering guides (`answering/`),
`policies.default.yaml` (with `live_runs` off) and the profile template.
When `APPLY_HOME` has no profile, Apply copies the Test Person sample data
into it and the window shows "Sample data".

- Never commit a data file. `.gitignore` here lists each data file name.
- For a test run, set `APPLY_HOME` and `APPLY_PROFILES` to a scratch folder,
  so the run does not write into your real data folder.

## Testing

- **Never run the full test suite (`uv run pytest` over all of `tests/`)
  for a small change.** It takes more than 20 minutes. Run it only for a
  major change that touches many modules, and say why.
- Run only the tests that the change touches, with `-k`. For example,
  `tests/test_workday_filler.py` alone takes about 5 minutes; do not run
  the whole file again after each small fix.
- Run `uv run ruff check .` here before you commit. It uses the backend's
  ruff config. `pyproject.toml` lists the findings that Apply keeps on
  purpose, each with its reason.
- CI (the `apply` job in `../.github/workflows/ci.yml`) runs ruff and only
  a fixed list of fast test files: the files that need no browser, no
  network and no `claude` CLI. When you add a test file that needs none of
  them, add it to that list. CI never runs the Filler tests
  (`test_*_filler.py`, `test_claude_fill.py` and the other files that open
  Chromium). Run the ones that your change touches on your Mac, with `-k`.
- **Prove a fix on the real form.** Rehearse the job posting that showed the
  bug (`uv run apply rehearse <url>`) and read its record. A rehearsal never
  submits. A unit test that passes is not the check that matters; the live
  form is.
- **Never press Submit** on a form, and never turn on `live_runs` for a
  test. A rehearsal leaves the browser open on the last page; leave it
  there.
- **Never press a button after an Emailed code.** On a page held for Lisul,
  `email_code.py` types the code that a job system emails after his own
  Submit, and nothing more (`test_email_code.py` checks that it has no click
  or key press). Test it on the fakes only: never press Submit on a real
  posting to make a code come. Two held pages whose lookups overlap on the
  same senders type neither code (`_join`, `CROSSED`): Greenhouse mails
  every company's code from one sender, and the newest mail after each press
  could be the other page's.
- Kill only the processes you started, by PID. Other people's rehearsals
  can run on the same Mac.

## Repairs

A Repair is Claude's fix to Apply's own code for a fill bug (`GLOSSARY.md`,
`docs/adr/0002`). Repairs are off: `policies.default.yaml` sets
`repair.max_per_day: 0`. When you turn them on in your data folder, a Repair
merges into the branch Apply runs from (or `repair.branch`) and pushes to
this checkout's `origin`, the WorkIt repo. It also moves the engine pointer
`autofiller_extension/fill-engine` on that branch, which is the extension's
pointer too. A Repair never runs on `main` (`repair_waiting` refuses it):
its pushes would move fill-engine's `main` and WorkIt's `main` to code
Claude wrote, and only WorkIt's `main` is protected.

## The privacy gate

`scripts/privacy_gate.py` scans the files for personal data (phone numbers,
email addresses, street addresses, student IDs, links to private repos) and
for secrets (API keys, GitHub and Slack tokens, private keys, cookies).
The identifiers it looks for come from a local file outside the repo
(`private-identifiers.txt`), never from the repo.

Run it before you push any file that you copied from a personal checkout.
If it finds something, remove it; do not push and fix later. A pushed file
stays in the public history.

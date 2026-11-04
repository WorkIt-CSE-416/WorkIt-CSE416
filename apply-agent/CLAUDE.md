# CLAUDE.md — Apply

Loaded on top of the root `../CLAUDE.md` when you work in `apply-agent/`.

## What Apply is

Apply is a command-line agent that applies to job postings for one person.
It reads a job posting, fills the application form in Chrome through the
Fill engine, writes the answers and essays with Claude, and shows the Apply
window (Start, Needs you, Answers). A rehearsal fills the form and never
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
submit sends nothing.

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
- Some Workday tenants answer Create Account with their bare Sign In view,
  and show no notice (Northrop's and Zillow's, live). A tenant that mails a
  link goes there by way of `/login/warning` (Zillow's), so
  `WorkdayFiller._create_account` watches the requests for that page and
  then waits for the link. A bare Sign In view with no such page means
  Workday made no account (Northrop's, live: a made account goes straight
  to the application). Apply then forgets the new password in Keychain,
  never signs in, and hands off for Lisul to make the account. A
  sign-in that Workday refuses because the account is not verified is a
  Needs sign-in Handoff, not a failed password. First, Apply looks once in
  Gmail for the link Workday mailed (to the tenant's own host, within a
  day) when an earlier run made the account (Zillow's, live). It opens that
  link once and never asks for a new one. The fake Workday's
  `to_sign_in` plays this flow (`tests/test_employer_accounts.py`).
- Apply asks a site for a verification code or link once per sign-in and
  never clicks Resend or Send New Code (`accounts.Accounts._wait`): a mail
  that hasn't come in about 2 minutes goes to Needs you ("Type the emailed
  code"), and Lisul retries himself.
- A Gmail search goes to IMAP as one quoted string (`gmail._quoted`). A
  phrase in quotes in the search stays escaped. Gmail can send a mail's
  INTERNALDATE before or after its body; `gmail._arrived` reads both.

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

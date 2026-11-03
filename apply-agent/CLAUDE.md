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
not the root ones, for its terms (root `GLOSSARY-MAP.md`).

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
  stays blank for the Filler.
- A Workday try-list answer (`a|b|c`) accepts each of its wordings in the
  read-back, because the fill takes the first one that it finds. Only the
  How did you hear question (and a "Details" list right after it) gets a
  try-list; another answer with a `|` must show whole. Keep
  `fill_engine.HOW_HEARD` the same as the engine's `HOW_HEARD` (`rules.ts`).
- A form that Claude fill reads is planned with the company and role that
  its page names, when the link names none.

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
  process, not from Playwright, so Google's sign-in accepts it.
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
  refreshes one time and tries again.
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
- Each add, in this order: `POST /jobs/added-by-link`, then `POST
  .../sent-resumes/file` (the resume, base64 JSON), then `PUT
  .../applications/{job_id}/stage` with `applied_on`, then `POST
  /jobs/{job_id}/applied` with `sent_resume_id`.
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
    missing fact or handoff. Apply writes a Hold as queued and the others
    as needs_you, so the Hold is live. The dry run says "Apply is holding
    it" (or "Apply is waiting for you on it");
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
sends a `workit.Write` through a `workit.Outbox`.

- submitted to `applied`, with the resume from the Application's folder
  under `sent/` (`worker.sent_resume`: the profile's resume name, else a
  PDF named resume) kept as the Sent resume (`POST
  .../sent-resumes/file`, then `POST /jobs/{id}/applied` with its id).
  handoff and missing fact to `needs_you`, held to `queued` (the stage
  PUT; a 409 means the job is applied already, and is not an error).
  Every other status writes nothing.
- The job comes from `POST /jobs/added-by-link`, so a later status moves
  the same row.
- A rehearsal writes only through `submitted_to`, when Lisul presses
  Submit himself. A rehearsal that he does not submit writes nothing.
- No answer, or no live login: the Write waits in `workit-queue.json` (one
  per Application, the newest). `apply run` and `apply rehearse` send the
  waiting writes first; `apply doctor`'s "WorkIt writes" line lists them.
  A Write that WorkIt refuses (a 4xx) is dropped and said.
- A write that fails never stops a run: the row is in Apply's Tracker.
- Apply does not write to the Tracker Sheet. The first `live_tracker()`
  with no `tracker.json` copies the Sheet's rows and Requests in, one time
  and read only (`sheet.copy_into`), so a run does not apply again to a
  job already applied to. `python -m apply.rankings` still writes its
  ranked tabs to the Sheet when you run it by hand.
- Lisul approves a Hold with the Apply window's Approve button (`POST
  /approve`, `Tracker.approve`), not a Sheet checkbox.
- A Hold's card shows its essays (the Essay cell, `essays.as_cell`) in a
  box that Lisul can edit before he approves. Approve sends his edit
  (`essay`), and `Tracker.approve` writes it to the row's essay with
  Approve, in one write. The next check fills the form with his words.
  The page keeps the edit in `sessionStorage` (`apply.essays`, by
  Application ID) until he approves, so a reload does not lose it.

**Tests.** `tests/test_tracker_record.py` (in CI) runs the Outbox and
`WorkItTracker` against `tests/fake_tracker.py`. `tests/test_rehearse.py
-k "applications_tracker or sends_nothing_to_workit"` rehearses a form
in Chromium: a submit by Lisul is Applied with the Sent resume, and no
submit sends nothing.

## Prompts and gates

- Every prompt names the applicant as `@NAME@` and their school as
  `@SCHOOL@`; `applicant.as_applicant` puts in the profile's own values.
  Say "they" for the applicant, or `@NAME@` where "they" already means the
  company or the sources. Never write a person's name, pronoun or project
  into a prompt or its examples.
- The not-on-resume gate (`gates.on_resume`) reads the text of the
  profile's resume PDF. With no PDF, or one with no text, the gate passes
  every answer; `apply doctor` shows this as "Not-on-resume gate: off".

## The data folder (`APPLY_HOME`)

**Personal data is never in the repo.** WorkIt is a public repo. All of a
person's data is in one folder, `APPLY_HOME` (default `~/.config/apply/`):

- the applicant profile, answer bank, story bank, voice and story map;
- the company briefs and stock answers;
- a `policies.yaml` that overrides `policies.default.yaml` key by key.
- the WorkIt login (`workit-login.json`), after `apply login`.
- Apply's Tracker (`tracker.json`) and the writes that wait for WorkIt
  (`workit-queue.json`).

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
- Kill only the processes you started, by PID. Other people's rehearsals
  can run on the same Mac.

## Repairs

A Repair is Claude's fix to Apply's own code for a fill bug (`GLOSSARY.md`,
`docs/adr/0002`). Repairs are off: `policies.default.yaml` sets
`repair.max_per_day: 0`. When you turn them on in your data folder, a Repair
merges into the branch Apply runs from (or `repair.branch`) and pushes to
this checkout's `origin`, the WorkIt repo. It also moves the engine pointer
`autofiller_extension/fill-engine` on that branch, which is the extension's
pointer too. Keep Repairs off on `main`.

## The privacy gate

`scripts/privacy_gate.py` scans the files for personal data (phone numbers,
email addresses, street addresses, student IDs, links to private repos) and
for secrets (API keys, GitHub and Slack tokens, private keys, cookies).
The identifiers it looks for come from a local file outside the repo
(`private-identifiers.txt`), never from the repo.

Run it before you push any file that you copied from a personal checkout.
If it finds something, remove it; do not push and fix later. A pushed file
stays in the public history.

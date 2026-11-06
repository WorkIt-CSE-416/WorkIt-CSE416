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
  the WorkIt client (`docs/workit.md`), as the signed-in student.

Both Apply and the extension fill forms with the same Fill engine
(`docs/fill-engine.md`). A fix to how a field is read, planned from the profile, filled
or read back goes into the engine, not into Apply. Apply's own plan rules
are Apply-side checks, not fill fixes: they decide what
Claude may draft and what Apply's own read-back accepts, and the extension
has neither.

## Rules for every run

- **Lisul reports a problem with an open application in a Claude Code chat:**
  send it to the form with `uv run apply ask "<company, role or application
  ID>" "<his words>"` (from `apply-agent/`). Do not open or drive the form
  yourself. `uv run apply ask --list` lists every open form. Print the reply
  to him. Never press the offer's Save for him: only his click in the window
  saves to his sources.
- **After a restart of the Mac:** run `uv run apply reopen` (`docs/restart-recovery.md`). It never
  types into a sign-in: Lisul signs in on each "needs sign-in" tile.
- **A next posting on a job site a running Worker is signed in to:** send it
  into that Worker with `uv run apply rehearse --into`, never into a new
  rehearsal (`docs/plain-workers/guide.md`).
- **Bot detection and captchas:** Apply never evades bot detection and never
  touches a captcha. It hands them to the user.
- **The Fill engine:** run `git submodule update --init` once per checkout.
  Without it, Apply cannot fill a form, and `uv run apply doctor` says so.
- **`README.md`** is a teammate's setup path, from a clone to a rehearsal. Its
  steps and doctor's fix lines say the same thing. When you change one,
  change the other.

## Reference by area

Read the file that matches your change. Update it in the same PR: it counts as
this folder's `CLAUDE.md` for its area.

- `docs/fill-engine.md`: Apply's plan rules, `fill_engine.py`, `APPLY_FILL_ENGINE`, or what the plan answers from the Tracker, the Answer bank or a bare date.
- `docs/workit.md`: a WorkIt call, `apply login`, `import-sheet`, `clean-tracker`, a Tracker write, the already-applied check, the resume check, or the tailored resume.
- `docs/held-forms.md`: verifying, a flag, Resume, Regenerate, Ask Claude, Fill again (`apply fill-again`), page gates, or how a question reaches Needs you.
- `docs/prompts-and-gates.md`: a prompt, a length, cap or names gate, or the catch-all box rule.
- `docs/claude-fill.md`: Claude fill, its Next and profile clicks, its dropdowns, or a Filler's `form_url`.
- `docs/captchas-and-bot-blocks.md`: a captcha wait, a block's handoff, or `captcha.py`.
- `docs/sign-in.md`: a sign-in page, an Employer account or its password, the Accounts tab, or `apply preflight`.
- `docs/apply-window.md`: the window's lifetime, its Dock keeper, or what a Record keeps.
- `docs/restart-recovery.md`: what survives a restart of the Mac: Workers' sign-ins across a quit, the open-forms list (`batch.py`), `apply reopen`, and `apply preflight --open`.
- `docs/plain-workers/guide.md`: `apply/plain/`, `worker_mode`, `--into`, or the worker extension.
- `docs/plain-workers/PROTOCOL.md`: a message between Apply and the worker extension.
- `docs/research/`: the research behind plain Workers and Employer account sign-in. Each note's Status line says what was built.

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
- **Agents: never read this folder raw.** Run `uv run apply data keys [FILE]`
  and `uv run apply data show-key KEY [--file FILE]`. They list the keys and
  the shape of each value (`<email>`, `<text, 12 chars>`), never a value. A URL
  keeps only its scheme and the end of its host.
- Apply's own stdout and stderr go through `apply.masked` (KAN-664): the
  profile's and Answer bank's values, addresses, phone numbers, and the ids
  and tokens in a URL are masked. A print that carries a typed answer or a
  message gives only its size (`masked.sized`). Add new prints the same way.
  Traces and Records are files on this Mac and keep the real values; `apply
  trace` prints through the same mask, which can't catch a value that no data
  file holds.
- To stop raw reads in Claude Code, install
  `tools/block-apply-home-reads.sh` as a PreToolUse hook. Nothing installs it
  for you. In `~/.claude/settings.json`, with the path to your checkout:

  ```json
  {"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command",
    "command": "/path/to/apply-agent/tools/block-apply-home-reads.sh"}]}]}}
  ```

  It refuses `cat`, `grep`, `sed`, Python and other readers on
  `~/.config/apply` or `$APPLY_HOME`. It can't see a path that is built at run
  time.
- For a test run, set `APPLY_HOME` and `APPLY_PROFILES` to a scratch folder,
  so the run does not write into your real data folder.
- `apply rehearse`, `apply run` and `approve-pass` refuse an `APPLY_HOME` or
  profiles folder under a temp path (`/tmp`, `/private/tmp`, `/var/folders`,
  KAN-665), since a reboot wipes held forms and sign-ins there. Test Person
  (`sample_data: true`) and tests (`APPLY_TEST_TEMP_OK`, set in `conftest.py`)
  go on. Use a scratch folder under your home folder for a rehearsal.

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
- **The submit guard's hostile pages** (`tests/test_submit_guard_hostile.py`,
  KAN-666) run every click path that presses through the guards (plain
  code's Next, the profile click, the account click, Ask Claude's press,
  Fill again) against pages built to trick them. Every pair must send no
  application request. A new click path joins `PATHS`, and a new trick joins
  `PAGES`, in the same PR. Its no-browser and CDP cases run in CI. Its plain
  Worker cases run where Chrome for Testing is installed. A guard PR gets an
  adversarial review first (root `CLAUDE.md`).
- **No test reaches past loopback** (`tests/network_block.py`, KAN-662). A
  socket or name lookup to another host raises `NetworkBlocked`, Chrome
  started by a test resolves other hosts to nothing, and Playwright's own
  requests are refused. The test then fails, even if it swallowed the error.
  A test that goes live on purpose names its hosts:
  `@pytest.mark.live_network("example.com")`. A program that a test starts
  other than Chrome (`curl`, `gh`) is not covered, so fake those.
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

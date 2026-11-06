# Apply

Apply fills job applications in its own Chrome windows and writes the
answers with Claude. A rehearsal fills the form and stops. **A rehearsal
never submits.** Apply runs on macOS only. Before you change code here, read
`CLAUDE.md`.

## You need

- A Mac with Google Chrome in `/Applications`.
- [uv](https://docs.astral.sh/uv/) (`brew install uv`).
- Claude Code, logged in with your own Claude plan: `claude auth login`.
  Apply's essays use your plan's usage.
- Read access to the private `workitjobs/fill-engine` repo (the Fill
  engine is a git submodule). git must sign in to GitHub without a prompt:
  run `gh auth login` and then `gh auth setup-git` once.

## Set up

1. Clone with the submodule:

   ```sh
   git clone --recurse-submodules https://github.com/workitjobs/workit.git
   ```

   If you cloned without it, run `git submodule update --init` in the
   checkout.

2. Install Apply. The last line is only for the tests:

   ```sh
   cd workit/apply-agent
   uv sync
   uv run playwright install chromium
   ```

3. Check the setup: `uv run apply doctor`. Each line says ok, warn or fail,
   with a fix. On a new Mac, two lines fail: "Applicant profile" (step 4
   fixes it) and "Worker profiles" (step 6 fixes it; after step 4 doctor
   lists each Worker profile, `worker-1` and on). With `worker_mode: plain`
   in `policies.yaml`, doctor checks "Plain seed" instead: `uv run apply
   plain seed` fixes it. Fix every other fail first. The warn lines are for
   optional features.

## First rehearsal: Test Person

4. Rehearse one Greenhouse job posting:

   ```sh
   uv run apply rehearse https://job-boards.greenhouse.io/formlabsinternships/jobs/8223362
   ```

   Your data folder (`APPLY_HOME`, default `~/.config/apply/`) is empty, so
   Apply copies the Test Person sample data (`sample/`) into it. The window
   says "Sample data". Apply fills the form as Test Person and stops. The
   result is "Filled, not sent". The first time takes about ten minutes,
   because Claude researches each company before it writes. The record (the
   answers and a screenshot) is in `~/.config/apply/rehearsals/<date>/`.
   Chrome stays open on the filled form; press Ctrl-C to stop Apply.

   Greenhouse and Lever postings work with the sample data. **Workday
   does not.** Workday refuses the sample's `example.com` email and 555 phone
   number. A Workday rehearsal also makes an employer account, and Workday
   sends mail to that address. Rehearse Workday only with your own data
   (step 5).

## Your own data

5. Replace the Test Person files in `~/.config/apply/` with your own:
   `applicant-profile.yaml` (copy `applicant-profile.template.yaml` from
   this folder and fill it in),
   `answer-bank.yaml`, `story-bank.md`, `voice.md`, your resume PDF and
   `company-briefs/`. A relative path under `files:` in the profile is read
   from the data folder. If you edit the sample profile instead, delete its
   `sample_data: true` line, or the window keeps saying "Sample data". Never
   put these files in the repo.

   To keep test data apart from real data, set `APPLY_HOME` to another
   folder. Set `APPLY_PROFILES` too, or the Chrome profiles go under
   `APPLY_HOME/profiles`.

6. Sign in to Google in Worker profile 1, by hand. Use the account you
   apply with. Quit Chrome (Cmd-Q) when you are done:

   ```sh
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --user-data-dir="$HOME/.config/apply/profiles/worker-1" \
     --use-mock-keychain --password-store=basic
   ```

   With `APPLY_HOME` or `APPLY_PROFILES` set, use the folder that `uv run
   apply doctor` prints. A run copies this profile to the other Workers.

7. Optional Keychain items:
   - `apply-gmail`: a Gmail app password, so Apply can read Workday and
     Greenhouse verification codes (also the code a job site emails after
     you press Submit on a rehearsal's page: Apply types it in, and Submit
     stays yours to press)
     ([docs/accounts-setup.md](docs/accounts-setup.md)).
   - `apply-ntfy`: an ntfy topic for phone notifications
     (`./scripts/setup-wizard.sh` sets it up).

8. Optional: log in to WorkIt, so Apply can write your applications to
   your Applications Tracker on WorkIt: a submit as Applied (with the
   resume sent), a Handoff, a missing fact or a held application as
   Needs you. You need a WorkIt student account. Rehearsals
   work without it; the writes wait until you log in.

   ```sh
   uv run apply login
   ```

   Apply opens WorkIt's sign-in page in a new Chrome window. Sign in there.
   Apply keeps the login in your data folder (`workit-login.json`), never in
   the repo, and closes the window. You log in one time; Apply refreshes the
   login by itself.

   `uv run apply doctor` then says "WorkIt: logged in as" your email. If it
   says that the login expired, run `uv run apply login` again.

   If you used a Tracker Sheet before, put its submitted applications into
   your Applications Tracker one time. Apply first lists each add and skip,
   and writes only when you type yes:

   ```sh
   uv run apply import-sheet
   ```

   Then you can delete the saved and queued applications of jobs that you
   did not apply to. Apply first lists each delete and keep, and deletes
   only when you type yes. It never deletes an application at applied or
   later. Use `--keep <link>` for a job that you still follow:

   ```sh
   uv run apply clean-tracker
   ```

9. Optional: let the WorkIt extension in your own Chrome sign you in to the
   Workday accounts that Apply made, so Chrome saves each password in its
   password manager (KAN-592). The extension must be loaded in that Chrome.

   ```sh
   uv run apply chrome-passwords
   ```

   It installs the Apply accounts host for Chrome, and lists each account
   that Keychain has (service `apply-ats`) in the Tracker. Then open the
   extension's options page and turn on Use My Apply Accounts. On a Workday
   Sign In page of such a tenant, press Sign In with Your Apply Account in
   the WorkIt panel, then Save when Chrome asks. `uv run apply doctor` then
   says "Apply accounts host: installed". Run the command again after you
   move the checkout: the host runs this checkout's Python.

Run `uv run apply doctor` again. Then rehearse a Workday posting.

## The demo

```sh
uv run apply rehearse --start-button --workers 3 <url> <url> <url>
```

Apply opens each form and plans its answers, then waits. Press Start in the
Apply window, and the Workers fill all the forms at once, each in its own
Chrome. Nothing is sent.

## Tests

CI runs ruff and only the fast test files (no browser, network or `claude`
CLI). The Filler tests need Chromium, so run the ones that your change
touches on your Mac, with `-k`: `uv run pytest tests/test_workday_filler.py
-k <name>`. Never run the full suite for a small change (over 20 minutes).

## More setup

- [docs/accounts-setup.md](docs/accounts-setup.md): Gmail, Keychain, Google
  sign-in.
- [docs/records-setup.md](docs/records-setup.md): Records repo and
  notifications.
- [docs/tracker-setup.md](docs/tracker-setup.md): Apply's Tracker (a file
  in the data folder) and what Apply writes to your Applications Tracker.
- `./scripts/setup-wizard.sh` walks through all of them.

# Setting up Records and run notifications

Or run `./scripts/setup-wizard.sh` from `apply-agent/`: it walks through every one-time setup step (Gmail, Records, notifications, Worker profile sign-in, live runs, the schedule), skipping what's already done.

This is a one-time checklist that takes about 5 minutes. Apply keeps each Application's Record (its planned answers, the answers read back from the page and a screenshot of the filled form) in a separate private GitHub repo of your own, here `<you>/apply-records` (`<you>` is your GitHub username). The Tracker row's Record link opens that Application's folder there. This is optional: until `records_remote` is set (step 3), Records stay in the data folder's `records/` and `apply doctor` says Records are off. After each run, Apply also shows one macOS notification with the run's counts.

## 1. Create the private repo, once

Apply never creates this repo itself. You create it, empty (no README, license or .gitignore):

- [ ] From any terminal signed in to GitHub as yourself:

  ```sh
  gh repo create <you>/apply-records --private --description "Apply's Records: what each Application sent"
  ```

  If you use the website instead, choose **Private** and leave every "Initialize this repository with" box unticked.

- [ ] Keep it private. A Record holds your name, email, phone and answers. Apply leaves out passwords and other secret answers, and records files by name only, but the rest is personal.

## 2. Let git push to it without a prompt

Apply pushes over HTTPS with git, unattended, so git needs your GitHub credentials:

- [ ] Run this once:

  ```sh
  gh auth setup-git
  ```

- [ ] Check it with `git ls-remote https://github.com/<you>/apply-records.git`. It must print nothing (the repo is empty) and must not ask for a password.

## 3. Point Apply at it

- [ ] Add this line to `policies.yaml` in the data folder (`$APPLY_HOME`, default `~/.config/apply`):

  ```yaml
  records_remote: https://github.com/<you>/apply-records.git
  ```

On its first save, Apply clones the repo to `~/.config/apply/apply-records`. Each later save commits there and pushes. If a push fails, for example because the Mac is offline, the Record stays committed in that clone and goes up with the next save. The Tracker link works from then on.

## 4. Allow the notification

macOS shows notifications from `osascript` under **Script Editor**:

- [ ] From `apply-agent/` in your checkout, run:

  ```sh
  APPLY_TEST_NOTIFY=1 uv run pytest -q tests/test_notification.py -k real
  ```

- [ ] If no banner appears, open **System Settings → Notifications → Script Editor**, turn on **Allow notifications**, choose **Banners** or **Alerts**, and run the command again.

After every run, a banner titled **Apply run finished** reads like `2 submitted, 1 held, 0 handoff, 0 missing fact, 1 new Employer account`.

## 5. Check the live repo (optional)

The Records tests run against a local stand-in for GitHub. To also run them against a real repo, point them at a **scratch** repo, never `apply-records`:

```sh
gh repo create <you>/apply-records-scratch --private
APPLY_TEST_RECORDS_REMOTE=https://github.com/<you>/apply-records-scratch.git uv run pytest -q tests/test_records_contract.py
gh repo delete <you>/apply-records-scratch --yes
```

## Size

A full-page screenshot is about 0.5 MB, so 1,000 Applications add about 0.5 GB to the repo. GitHub warns when a repo passes about 5 GB. If it gets there, start a second repo and point `records_remote` at it.

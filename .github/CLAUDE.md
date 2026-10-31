# CLAUDE.md — GitHub Actions

Loaded on top of the root `../CLAUDE.md` when working in `.github/`. The jobs
themselves are in `workflows/*.yml`; this file holds why they are shaped that
way and what bites.

## CI (`workflows/ci.yml`)

`scout/` has no job of its own: the backend installs it, so the backend job
lints and tests it too. The `api-worker` job type-checks the API's Cloudflare
Worker (`backend/cloudflare/`, `npm run check`), which nothing else builds
before the deploy on `main`.

The backend job runs `pgvector/pgvector:pg15` as a service on port 54330,
the same image and port as the local test container, and sets
`TEST_DATABASE_URL` to it. The tests migrate their own database to head on it
(`backend/CLAUDE.md`, "Tests against real Postgres"). Because `CI` is set
there, a test database that cannot be reached fails the job instead of
skipping the tests.

The backend job installs real Tectonic with `backend/scripts/fetch_tectonic.py`
(kept in the Actions cache) before pytest. Because `CI` is set, the resume
template text test fails, never skips, when Tectonic is missing
(`backend/app/services/resume_render/CLAUDE.md`).

The `extension-store-build` job (KAN-463) builds the Chrome Web Store package
(`autofiller_extension/store/build.mjs`), which fails if a packaged file names
localhost, vercel.app or "Prototype", and runs `store-build.spec.ts` and
`extension-id.spec.ts`. The package needs the private fill-engine submodule,
which the default token can't read, so the build steps run only once a
`FILL_ENGINE_TOKEN` secret (read access to WorkIt-CSE-416/fill-engine) is set;
without it they show as skipped and the job checks the extension ID only.

**Without `FILL_ENGINE_TOKEN`, the engine's tests are skipped, never green.**
`ci.yml`, `extension-nightly.yml` and `live-canary.yml` each first call
`workflows/engine-token.yml` (a reusable workflow, job `engine`), which
answers whether the secret is set and, when it isn't, writes "SKIPPED: ..."
to its job summary and a warning. A job that needs the engine depends on it
(`needs.engine.outputs.set == 'true'`), so it shows as skipped instead of a
run of tests that did nothing. Those jobs share their setup after the
checkout (Node, `autofiller_extension/test`'s `npm ci`, Playwright's
Chromium) in the composite action `actions/extension-setup`; the checkout
stays in each job, since a local action can't check out its own repo.

The `extension` job (KAN-464) runs the extension's Playwright suite headless
(`autofiller_extension/test`, both projects) on the engine the submodule
pins, and first fails if that engine commit's committed `dist/` differs from
what its `src/` builds. It runs only on a PR touching `autofiller_extension/`
(the engine pointer included) or `ci.yml`: the `changes` job
(`dorny/paths-filter`) decides, and a skipped job counts as passed. It leaves
out `speed.extension.spec.ts`, the timing harness (about 7 minutes alone),
which `workflows/extension-nightly.yml` runs with the rest every night at
07:41 UTC (and by hand: `gh workflow run extension-nightly.yml`). Both need
`FILL_ENGINE_TOKEN`, as `extension-store-build` does, and are skipped
without it. Both run on `macos-latest` (free on a public repo): on Linux, Chromium
asks `accounts.google.com` on its own (which `practice.extension.spec.ts`'s
request list catches) and a field a panel row scrolls to doesn't come into
view (`panel-reopen`, `workday-show`), found in the Playwright image
2026-10-31. On CI each spec gets two retries; a broken one fails all three.
The fill-engine repo has its own CI (its `.github/workflows/ci.yml`):
typecheck, the same stale-`dist/` check, and its tests, on every PR.

The frontend job runs `format:check`, so an unformatted file fails the PR.
Run `npm run format` before pushing. Markdown docs are in
`frontend/.prettierignore`, so Prettier never rewrites prose.

## Deploy to Cloudflare (`workflows/deploy.yml`, KAN-169)

Every push to `main` deploys both halves to Cloudflare Workers Paid
(`../docs/adr/0004-host-on-cloudflare.md`): the API job builds
`backend/Dockerfile` into a Container behind the Worker in
`backend/cloudflare/` (`api.workitjobs.ai`), and the web job builds the app
with OpenNext and deploys it (`workitjobs.ai`). A branch never deploys on
push, because each deploy overwrites production. To try one before merge, run
it by hand: `gh workflow run deploy.yml --ref <branch>`. Every run shares one
concurrency group (`deploy-cloudflare`), whatever its ref: a group per ref let
a branch run and a push to `main` deploy at once, so the app could end up on
one's code and the API on the other's.

- **Secrets:** `CLOUDFLARE_API_TOKEN` (account token from the "Edit Cloudflare
  Workers" template, scoped to the WorkIt account and the `workitjobs.ai`
  zone) and `CLOUDFLARE_ACCOUNT_ID`, which wrangler reads from the env.
- **The API's runtime values are one secret, `CF_API_SECRETS_JSON`**: a JSON
  object of every variable the API reads in production (first copied from
  Vercel's production env, before Vercel was retired). The job pipes it to
  `wrangler secret bulk` **before** the deploy: the image rollout restarts the containers with the secrets of that
  moment, and a secrets-only version restarts none, so set after, the new
  values reach no container until each sleeps (found 2026-10-21). `secret
  bulk` never deletes a secret, so a key dropped from the JSON keeps its old
  value. **Build it from the root `.env`, never `vercel env pull`**: Vercel
  returns every sensitive variable as the text `[SENSITIVE]`, which once
  shipped as the database URL and keys. To change one value, rewrite the whole JSON
  (`gh secret set CF_API_SECRETS_JSON < file.json`); never put a value in the
  workflow. `DIRECT_URL` never goes in it: migrations stay a local step.
- **`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
  `NEXT_PUBLIC_BRANDFETCH_CLIENT_ID` (KAN-442) are repo variables, not
  secrets**: Next inlines them at build time and all are public by design.
  Setting them as Worker secrets would do nothing. Without the Brandfetch
  one, every company logo falls back to what the scraper found.
- **A new Worker's first deploy needs `scripts/ensure-worker.sh`.** For a
  Worker that does not exist yet, Cloudflare answers wrangler's secrets lookup
  with "No access to the specified resource" rather than "not found" when the
  token is an account token, and the deploy fails. The script uploads a
  one-line placeholder first, only when the Worker is missing from the
  account's script list. A failed lookup is never read as "missing": it
  stops the deploy, because the placeholder answers 503, and put over the
  live Worker it would take the site down until the real deploy lands.
- **The token's account permissions must be scoped to the account**, not to
  the `workitjobs.ai` zone. Scoped to the zone, Workers Scripts Write grants
  nothing and every call answers "No access" (found 2026-10-21). Zone scope is
  right only for Workers Routes Write.
- **The health check** polls `https://api.workitjobs.ai/health/db` for five
  minutes, the database route because `/health` answers 200 with every
  secret wrong (it did, with `[SENSITIVE]` placeholders). Five minutes,
  because a fresh Container takes a while to start and a rollout replaces
  instances in steps; a red API job with a green deploy step usually means
  the rollout is not finished.

## Scheduled scrape and import (KAN-160)

`workflows/scrape.yml` runs the scraper and then
`app.scripts.import_jobs` into Supabase **every three hours at :17 UTC** (off the
hour: GitHub delays, and under load drops, runs scheduled on it). Daily is what
the big internship lists do and hourly the most any aggregator does; every few
hours gets a new posting onto the site the same day for a ~15 minute run that
only writes the rows that changed. Twelve of those minutes are Workday's (KAN-134):
its boards are read for a fixed share of each run and take about four runs to go
round, page reads stop 20 minutes in (`PAGES_UNTIL_S`) and no lane starts a board
after 30 (`BOARDS_UNTIL_S`), which keeps the job inside its 90-minute timeout
(`scraper/CLAUDE.md`, "Page reads have a deadline too"): a run cut off by the
timeout saves no store, so the next one repeats it. The scraper runs with `-u`, so
a slow run's log shows where it is.
**A change to the cron changes `RUN_EVERY` in `scraper/workit_scraper/store.py`
too**: quiet boards take turns by that slot. Each run keeps `feed.json`,
`closings.json` (why each stored job is not in the feed, which the import
reads beside `feed.json`), `internships.html` and `metrics.json` (each
provider's share of the run) as an artifact for a week.

It was every six hours until KAN-166. GitHub started those runs up to five hours
late and skipped some outright (2026-10-08 to 10-09), so a posting could wait
twelve hours. Three hours halves the average wait (about 1.5 hours) and the gap a
skipped run leaves, at no cost on a public repo, for twice the requests to the
boards; the scraper's robots.txt and per-site pacing still govern each run, and
the concurrency group queues a late run rather than overlapping it. Going below
an hour buys minutes, multiplies that traffic and raises the odds of a board
rate-limiting the shared GitHub runners, which would stall every job on it.

**Still open: GitHub runs about half of the schedule.** Between 2026-10-16 and
10-27 it started 50 of the 94 runs due at :17 (53%), a median 102 minutes late,
so the real gap between runs was a median 5.5 hours, at most 8.7. The fix being
weighed is a Cloudflare Cron Trigger that starts this workflow through GitHub's
API at exact times (`scraper/docs/coverage.md`, "Later").

- **Secret:** `DATABASE_URL` (the API's pooler URL, from the root `.env`), in the
  repo's Actions secrets. Without it the run fails at the import step and says so.
- **Secrets:** `SCOUT_ENDPOINTS_SMALL` and `SCOUT_ENDPOINTS`, for the
  import's keyword pass (`backend/CLAUDE.md`, The feed import): the small
  chain (KAN-356), then the default chain after it, each a JSON array on one
  line, copied from the root `.env`. The four single `SCOUT_*` variables are
  not passed: a chain says the same in one secret. These are the import's
  own: the deployed API reads its chains from `CF_API_SECRETS_JSON`, so the
  import can run on another account's quota than the students' features.
  Without either the run warns and extracts no keywords; the import itself
  still runs. The step unsets each one that is empty, because GitHub passes
  a missing secret as `""`, which Scout's settings refuse as a list.
- **The company list** (`scraper/boards.csv`) is grown by `build_boards.py`
  before every scrape, from the curated GitHub lists, so a company they name
  today is read on the next run without a commit. It only ever adds; the rules
  are in `scraper/CLAUDE.md`.
- **The scraper's memory** (`scraper/jobs.json`) lives in the Actions cache,
  restored from the newest entry and saved only after a scrape that finished. A
  missed cache is safe, just slow: that run re-reads every Greenhouse page and
  counts nothing as new.
- **Manual run:** Actions → Scrape jobs → Run workflow, or
  `gh workflow run scrape.yml` (inputs `full` and `dry_run`). A PR that touches the
  scraper, the import or this workflow runs it too, with the import always
  `--dry-run`.
- **It stops silently after 60 days without a commit** to `main` (GitHub pauses
  idle schedules). Re-enable with `gh workflow enable scrape.yml`.
- **When it fails, GitHub emails whoever last edited the cron line.** The import
  refuses to close more than half the jobs at once, so a broken scrape fails the
  run instead of emptying the site; nothing is written either way.

## Job alerts (KAN-298)

`workflows/job-alerts.yml` **no longer carries the real daily schedule.**
The digest (every opted-in applicant's best new matches, scored by the
same `fetch_recommended` + `pick_batch` auto apply's own batch uses,
`auto-apply/architecture.md`'s "Match (built)"/"The batch";
`backend/app/services/job_alerts.py`) now sends through AWS SES
(`backend/app/services/email.py`), authenticated by the sending EC2
instance's IAM role — a role's credentials never leave that instance, so
GitHub's runners structurally cannot send the real mail anymore. The live
run is a crontab entry on that instance, daily at 13:13 UTC (off the
hour, same reasoning as the scrape's own cron), running the same
`app.scripts.send_job_alerts` this workflow calls.
The same instance runs `app.scripts.send_fill_report_alerts` hourly
(KAN-478; e.g. `17 * * * *`), which emails the admins new fix report
groups through the same SES sender and role.

This workflow still exists for two things, both free of real AWS access:
a PR that touches the digest, the script, `email.py` or this workflow
runs it once, always `--dry-run` (never calls `send_email` at all); and
`workflow_dispatch` (Actions → Job alerts → Run workflow, or
`gh workflow run job-alerts.yml`, input `dry_run`) is still there for a
manual non-dry run, but with no IAM role attached it can only prove the
bell-notification path — `send_email` catches the missing-credentials
error, logs it, and returns `False`, the same best-effort outcome as a
bounced send.

- **Secrets:** `DATABASE_URL` and `GEMINI_API_KEY` only (both already set
  for the scrape workflow — reused here, not duplicated).
  `EMBEDDING_PROVIDER=gemini` is a plain env value here, not a secret, so
  the digest scores with the semantic part the deployed API itself
  doesn't have on by default (`backend/CLAUDE.md`'s "Still open" note on
  that).
- **One run at a time**, same reasoning as the scrape's concurrency group:
  two overlapping runs would double-send the same applicant. This guards
  against two *workflow* runs overlapping; it says nothing about the EC2
  crontab, which is the user's own to keep from overlapping a workflow run.
- **It stops silently after 60 days without a commit** to `main`, same as
  the scrape. Re-enable with `gh workflow enable job-alerts.yml`.
- **No retry and no queue.** One applicant's failure (an empty bank, a
  bounced email) is caught, counted in the run's report, and logged; it
  never stops the rest of the run, and nobody is sent two digests to make
  up for a missed day.
- **Still open:** the EC2 crontab has no built-in failure alerting the
  way this workflow's schedule trigger got from GitHub for free. Not set
  up yet (a dead-man's-switch ping or a CloudWatch alarm would do it).

## Retention purge (KAN-482)

`workflows/retention-purge.yml` runs `app.scripts.purge_old_data` against
production **daily at 07:43 UTC** (off the hour, same reasoning as the
scrape). It deletes rows past their retention period and logs a count per
table, never a row. The periods live in one place,
`backend/app/services/retention.py`'s `RETENTION`, and the privacy policy's
retention section quotes the same numbers (KAN-474): change both together.
A rule whose table does not exist yet (`fill_events`, until KAN-476) is
skipped and logged as such.

- **It never runs from a PR.** Every run reaches the production database,
  so unlike the scrape and job alerts there is no `pull_request` trigger.
  Only the schedule, on `main`, deletes. A manual run (Actions → Retention
  purge → Run workflow, or `gh workflow run retention-purge.yml`) is always
  a dry run: it logs what it would delete and deletes nothing.
- **Secret:** `DATABASE_URL`, the one the scrape already uses.
- **A failed scheduled run opens an issue** titled "Retention purge failed"
  (or comments on the open one) with the run's link, so the team is told.
  Close it once fixed. GitHub also emails whoever last edited the cron line.
- **It stops silently after 60 days without a commit** to `main`, same as
  the scrape. Re-enable with `gh workflow enable retention-purge.yml`.

## Live canary (`workflows/live-canary.yml`, KAN-468)

The saved forms under `autofiller_extension/fill-engine/test/fixtures/forms/`
are frozen recordings, so a job system that changes its markup or API would
otherwise surface only as students' fix reports. Each night (and by hand:
`gh workflow run live-canary.yml`) the canary reads live forms and compares
them with those saved forms.

- **What it reads.** `autofiller_extension/test/canary/postings.json` names,
  per job system, one board, its pinned postings and the fields its form
  page must show. Each run lists the board's open postings with the job
  system's public API (never the production database) and reads `count`
  of them: the pinned ones still open, then listed ones. For each, the
  engine's own read gives the Question set (`questionSet`), the form is
  opened headless, and the engine's `readback` must find the `onPage`
  fields there (Ashby's `readQuestions` too, its host's fallback). The
  Question set must hold every field all of that system's saved
  `question-set.json` files share, with the same kind, and no kind they
  never have. A form that differs is read once more before it counts.
- **It never fills.** It types nothing, uploads nothing and presses no
  button. `test/canary.spec.ts` runs first and fails if `canary/*.mjs` calls
  any engine function but `jobOf`, `questionSet`, `readback` or
  `readQuestions`, or any of Playwright's fill, click or press calls.
- **A changed form opens an issue** "Live canary: `<site>` form changed"
  (or comments on the open one) naming each posting and its field-kind diff,
  with the default `GITHUB_TOKEN`. A crash before the comparison opens "Live
  canary failed". Close the issue once the engine is fixed.
- **A closed posting is not a change.** A pinned posting the board no longer
  lists is reported in the run's summary as "posting closed" and another
  listed one is read instead; replace it in `postings.json` when convenient.
- **Covered:** Greenhouse, Lever, Ashby, Rippling, Workable, the systems
  whose form opens with no sign-in and whose saved forms have a Question
  set.
- **Skipped, and why:**
  - **Workday, Oracle, iCIMS, SuccessFactors, TikTok:** the form sits behind
    an Apply button or a sign-in, which the canary never presses.
  - **Eightfold, Waymo:** no saved field list (Question set) to compare.
  - **SmartRecruiters:** a bot check (and its robots.txt); so is any other
    system that adds one.
- **Secret:** `FILL_ENGINE_TOKEN`, as in CI: without it the canary job is
  skipped and the `engine` job's summary says SKIPPED. The schedule runs only on `main`, and stops after 60 days
  without a commit there (`gh workflow enable live-canary.yml`).
- **Run it locally:** `cd autofiller_extension/test && npm ci && node
  canary/run.mjs` writes `canary-out/report.md` and `canary-out/issues/`.

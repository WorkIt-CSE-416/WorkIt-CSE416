# CLAUDE.md — GitHub Actions

Loaded on top of the root `../CLAUDE.md` when working in `.github/`. The jobs
themselves are in `workflows/*.yml`; this file holds why they are shaped that
way and what bites.

## CI (`workflows/ci.yml`)

`scout/` has no job of its own: the backend installs it, so the backend job
lints and tests it too.

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

The frontend job runs `format:check`, so an unformatted file fails the PR.
Run `npm run format` before pushing. Markdown docs are in
`frontend/.prettierignore`, so Prettier never rewrites prose.

## Scheduled scrape and import (KAN-160)

`workflows/scrape.yml` runs the scraper and then
`app.scripts.import_jobs` into Supabase **every three hours at :17 UTC** (off the
hour: GitHub delays, and under load drops, runs scheduled on it). Daily is what
the big internship lists do and hourly the most any aggregator does; every few
hours gets a new posting onto the site the same day for a ~15 minute run that
only writes the rows that changed. Twelve of those minutes are Workday's (KAN-134):
its boards are read for a fixed share of each run and take about four runs to go
round, which keeps the job well inside its 30-minute timeout (`scraper/CLAUDE.md`).

It was every six hours until KAN-166. GitHub started those runs up to five hours
late and skipped some outright (2026-10-08 to 10-09), so a posting could wait
twelve hours. Three hours halves the average wait (about 1.5 hours) and the gap a
skipped run leaves, at no cost on a public repo, for twice the requests to the
boards; the scraper's robots.txt and per-site pacing still govern each run, and
the concurrency group queues a late run rather than overlapping it. Going below
an hour buys minutes, multiplies that traffic and raises the odds of a board
rate-limiting the shared GitHub runners, which would stall every job on it.

- **Secret:** `DATABASE_URL` (the API's pooler URL, from the root `.env`), in the
  repo's Actions secrets. Without it the run fails at the import step and says so.
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

`workflows/job-alerts.yml` runs `app.scripts.send_job_alerts` **daily at
13:13 UTC** (off the hour, same reasoning as the scrape's own cron): every
opted-in applicant's best new matches, scored by the same `fetch_recommended`
+ `pick_batch` auto apply's own batch uses (`auto-apply/architecture.md`,
"Match (built)"/"The batch"; `backend/app/services/job_alerts.py`), as a
bell notification and an email through Resend. Daily, not every few hours
like the scrape: a new job posting can wait for the next scrape, but a
digest in someone's inbox every three hours would train them to ignore it.

- **Secrets:** `DATABASE_URL` and `GEMINI_API_KEY` (both already set for
  the scrape workflow — reused here, not duplicated) and `RESEND_API_KEY`
  (new; without it `send_email` logs and returns `False`, so the run still
  writes every bell notification, it just sends no mail). `EMBEDDING_PROVIDER=gemini`
  is a plain env value here, not a secret, so the digest scores with the
  semantic part the deployed API itself still doesn't have on by default
  (`backend/CLAUDE.md`'s "Still open" note on that).
- **One run at a time**, same reasoning as the scrape's concurrency group:
  two overlapping runs would double-send the same applicant.
- **Manual run:** Actions → Job alerts → Run workflow, or
  `gh workflow run job-alerts.yml` (input `dry_run`). A PR that touches the
  digest, the script or this workflow runs it too, always `--dry-run`
  (never needs `RESEND_API_KEY` to pass, since a dry run never calls
  `send_email`).
- **It stops silently after 60 days without a commit** to `main`, same as
  the scrape. Re-enable with `gh workflow enable job-alerts.yml`.
- **No retry and no queue.** One applicant's failure (an empty bank, a
  bounced email) is caught, counted in the run's report, and logged; it
  never stops the rest of the run, and nobody is sent two digests to make
  up for a missed day.

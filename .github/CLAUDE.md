# CLAUDE.md — GitHub Actions

Loaded on top of the root `../CLAUDE.md` when working in `.github/`. The jobs
themselves are in `workflows/*.yml`; this file holds why they are shaped that
way and what bites.

## CI (`workflows/ci.yml`)

Runs on every PR to `main`: a frontend job, a backend job and a scraper job.
`scout/` has no job of its own: the backend installs it, so the backend job
lints and tests it too. The scraper job runs through `uvx`, so the scraper
still installs nothing.

## Scheduled scrape and import (KAN-160)

`.github/workflows/scrape.yml` runs the scraper and then
`app.scripts.import_jobs` into Supabase **every three hours at :17 UTC** (off the
hour: GitHub delays, and under load drops, runs scheduled on it). Daily is what
the big internship lists do and hourly the most any aggregator does; every few
hours gets a new posting onto the site the same day for a ~3 minute run that
only writes the rows that changed.

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

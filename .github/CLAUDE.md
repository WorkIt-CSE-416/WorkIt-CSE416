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
  object of every variable the API reads in production, copied from Vercel's
  production env. The job pipes it to `wrangler secret bulk` **before** the
  deploy: the image rollout restarts the containers with the secrets of that
  moment, and a secrets-only version restarts none, so set after, the new
  values reach no container until each sleeps (found 2026-10-21). `secret
  bulk` never deletes a secret, so a key dropped from the JSON keeps its old
  value. **Build it from the root `.env`, never `vercel env pull`**: Vercel
  returns every sensitive variable as the text `[SENSITIVE]`, which once
  shipped as the database URL and keys. To change one value, rewrite the whole JSON
  (`gh secret set CF_API_SECRETS_JSON < file.json`); never put a value in the
  workflow. `DIRECT_URL` never goes in it: migrations stay a local step.
- **`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are repo
  variables, not secrets**: Next inlines them at build time and both are public
  by design. Setting them as Worker secrets would do nothing.
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
- **Secret:** `SCOUT_ENDPOINTS` (the model chain, the same JSON as the API's),
  for the import's keyword pass (`backend/CLAUDE.md`, The feed import). Without
  it the run warns and extracts no keywords; the import itself still runs. The
  step unsets it when empty, because Scout's settings refuse `""` as a list.
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

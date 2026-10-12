# CLAUDE.md

Repo-wide rules, always loaded. Each folder below has its own `CLAUDE.md` that
loads on top of this one when you touch a file in it; read it before writing
code there. A rule lives at the deepest level that fully contains it, with a
pointer above rather than a copy.

## Layout

Each half is self-contained: its own manifest, lockfile and toolchain. Python
tooling stays inside its package; the repo root holds none.

- `frontend/` — the Next.js app and the whole JS build. `npm install` runs
  here, never at the root, which would grow a second `node_modules` and
  lockfile nothing builds from.
- `backend/` — the Python API (FastAPI, SQLAlchemy, Alembic). Owns the
  database. Driven by `uv run ...` from inside `backend/`.
- `scout/` — Scout, the job assistant's brain (KAN-138): a plain package the
  API installs, with no database and no HTTP. Running it locally needs Ollama
  and `ollama pull qwen3.5:4b`.
- `scraper/` — the job-board scraper (KAN-55). Standard library only, never
  touches the database; runs with `python3 -m workit_scraper`, tests under
  `uvx pytest`.
- `.github/` — CI and the scheduled scrape-and-import (KAN-160).
- `docs/` — team prose that spans the repo (below).

## The database

Postgres on Supabase, reached only by the backend through SQLAlchemy. The
Next.js app holds no ORM, connection string or schema: a query you want in a
React component belongs in an endpoint.

**Alembic is the single source of truth for schema.** Every schema change is a
migration; the Supabase dashboard's schema editor bypasses Alembic silently,
so it stays unused. `backend/db/*.md` hold design rationale only.

**Claude never runs `uv run alembic upgrade head`** — nor `downgrade`, `stamp`,
or anything else that writes to the database. Write the migration, check it
offline with `--sql`, then tell the user to run the command. Applying one
changes a shared database, and applying one whose file wasn't committed broke
every teammate's Alembic on 2026-09-21 (`backend/alembic/CLAUDE.md`).

## Auth

Supabase Auth issues the session; the Python API authorizes. The Next server
keeps the session in Supabase's cookies and forwards the access token to
FastAPI as a Bearer header; FastAPI verifies it and decides what the account
may do. Signup goes through FastAPI, which creates the auth user (account type
in `app_metadata`) and the profile row with the same id.

- SQLAlchemy connects as one privileged role that bypasses RLS, so
  authorization lives in Python.
- **Every new table's migration enables RLS with no policies**: a deny-all
  backstop against the public anon key.
- The **anon** key goes to `frontend/`; the **service-role** key stays in
  `backend/`.

Before touching sign-in on either half, read `backend/CLAUDE.md`'s Auth
section (the flow and its rules) and `frontend/CLAUDE.md`'s Next side.

## Commands

The root `package.json` forwards every `frontend/` script via
`npm --prefix frontend run <script>`, so `npm run dev` works from the root or
from `frontend/`. A script added to `frontend/package.json` needs its
forwarding line added at the root too. `frontend/CLAUDE.md` explains each
script; first-time setup is `npm run install:frontend`.

The root forwards frontend scripts only. The backend runs through `uv run`
inside `backend/`, its commands listed in `backend/CLAUDE.md`.

## CI and deployment

CI runs on every PR to `main`; merge only on a green check. The jobs, the
three-hourly scrape and its gotchas are in `.github/CLAUDE.md`.

Both halves deploy to **Vercel as two projects from this repo** (Root
Directory `frontend` and `backend`, the API as one Vercel Function). Merging to
`main` deploys production; every PR gets preview URLs for both. The Next
project's `API_URL` points at the API project. Migrations stay a manual, local
step, never part of a deploy. Supabase (Authentication → URL Configuration)
must list each deployed origin's `/auth/callback`, or OAuth sign-in bounces.
Settings and env vars: each half's Deployment section.

## Cross-platform

The team works on macOS and Windows.

- Every npm script is a single binary invocation, using npm's own flags
  (`--prefix`) to reach other folders. Anything needing more steps becomes a
  Node script under `frontend/scripts/` (see `clean.mjs`). Shell syntax (`rm
  -rf`, `&&`, `$(...)`, `cd`) breaks on Windows.
- Line endings are LF, normalized by `.gitattributes`; only
  `.bat`/`.cmd`/`.ps1` use CRLF.
- Build paths with `node:path`.

## Documentation

**Every code change updates the nearest `CLAUDE.md` in the same change**: a
new file in a layout tree, a new command, a changed convention or invariant, a
decision made or reversed, a "still open" item closed. A change that leaves
its `CLAUDE.md` describing the old behaviour is incomplete and does not merge.
When something is learned the hard way, write it into the nearest `CLAUDE.md`
with the failure it prevents.

- `CLAUDE.md` — guidance for Claude: conventions, invariants, rationale, what
  must not change and why, what is still open.
- `README.md` — deliberately short. Explanation goes in a `CLAUDE.md` or the
  docs folders, never back into a trimmed README.
- `frontend/docs/` — frontend prose too long for a `CLAUDE.md`.
- `backend/db/` — schema design rationale.
- `docs/job-pipeline.md` — the job pipeline end to end, in plain terms. A
  change to how jobs are scraped, imported, stored, served or filtered updates
  it alongside the `CLAUDE.md` beside the code.
- `docs/agents/` — configuration for the `mattpocock-skills` plugin.

## Conventions

- Branches are `KAN-###-slug` off `main`; Jira links PRs through the key.
- Prettier formats code and runs from `frontend/`. It skips the markdown docs
  and never reaches the root `CLAUDE.md` or `README.md`.
- **Job terms, in anything written for people:** a **hiring system**
  (Greenhouse, Workable: an ATS) hosts **company job boards** (one company's
  page of open jobs), which list **job postings**. WorkIt's own `/jobs` is "the
  Jobs page". The scraper's code keeps its older names (`board`, `provider`).
- Pre-PR review and bug hunts use the `pr-review` skill
  (`.claude/skills/pr-review/`).

## Agent skills

`mattpocock-skills` (`/grill-with-docs`, `/to-spec`, `/to-tickets`,
`/implement`, `/triage`, `/wayfinder`...) reads its configuration from
`docs/agents/`. Each person installs the plugin themselves.

- **Issue tracker:** Jira, project KAN on workitsbu.atlassian.net, through the
  Atlassian MCP server. Ask before creating tickets. `docs/agents/issue-tracker.md`.
- **Triage labels:** the five default roles, as Jira labels under their own
  names. `docs/agents/triage-labels.md`.
- **Domain docs:** single-context, one `GLOSSARY.md` and `docs/adr/` at the
  root, created with the first settled term or decision. `docs/agents/domain.md`.

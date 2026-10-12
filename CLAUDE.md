# CLAUDE.md

Repo-wide rules, always loaded. Each code folder below (`frontend/`,
`backend/`, `scout/`, `scraper/`, `.github/`) has its own `CLAUDE.md` that
loads on top of this one when you touch a file in it; read it before writing
code there. A rule lives at the deepest level that fully contains it, with a
pointer above rather than a copy.

## Replies

Write every reply to the user in ASD-STE100 Simplified Technical English:
short sentences, one idea per sentence, active voice, common words. Lead with
the answer or the result, then give only the context the user needs to act on
it. Name things with the ubiquitous language: the terms in `GLOSSARY.md` when
it exists, and the job terms under Conventions. Define any other jargon in one
clause the first time it appears. When you offer options, give each one's
consequence in one plain line.

## Layout

Each half is self-contained: its own manifest, lockfile and toolchain, so the
halves keep separate dependency trees and each one's guidance loads only when
you work there. Python tooling stays inside its package; the repo root holds
none.

- `frontend/` — the Next.js app and the whole JS build. `npm install` runs
  here, never at the root (`frontend/CLAUDE.md`, Commands).
- `backend/` — the Python API (FastAPI, SQLAlchemy, Alembic). Owns the
  database. Driven by `uv run ...` from inside `backend/`.
- `scout/` — Scout, the job assistant's brain (KAN-138): a plain package the
  API installs, with no database and no HTTP. Running it locally needs Ollama
  (`scout/CLAUDE.md`, "Which model, where").
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
migration. **Schema edits through the Supabase dashboard are banned**: they
bypass Alembic silently; revoke dashboard write access if the plan allows it.
The schema notes in `docs/` hold design rationale only.

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
- The **anon** key goes to `frontend/`; the **service-role** key and every
  connection string stay in `backend/`. A secret added to `frontend/` is one
  typo away from a `NEXT_PUBLIC_` prefix and the client bundle.

Before touching sign-in on either half, read `backend/CLAUDE.md`'s Auth
section (the flow and its rules) and, for the Next side, `frontend/CLAUDE.md`'s
"Auth and the API".

## Commands

The root `package.json` forwards every `frontend/` script via
`npm --prefix frontend run <script>`, so `npm run dev` works from the root or
from `frontend/`. A script added to `frontend/package.json` needs its
forwarding line added at the root too; a script that takes flags of its own
(`worktree`) ends its forwarder in `--` so npm passes them through.
`frontend/CLAUDE.md` adds what the scripts don't say; first-time setup is
`npm ci` inside `frontend/`.

The root forwards frontend scripts only. Backend commands run through
`uv run` inside `backend/` (listed in `backend/CLAUDE.md`); no npm script
shells into it.

## CI and deployment

CI runs on every PR to `main`; merge only on a green check. The jobs, the
scheduled scrape and its gotchas are in `.github/CLAUDE.md`.

Both halves deploy to **Vercel as two projects from this repo** (Root
Directory `frontend` and `backend`, the API as one Vercel Function).
Production is https://workit-web-gamma.vercel.app (app) and
https://workit-api.vercel.app (API). Read and change Vercel state with the
Vercel CLI: `vercel link` once in each half's folder, then `vercel env`,
`vercel logs` and `vercel curl <url>` (reaches a protected preview); the
dashboard only for what the CLI cannot do. Merging to
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
- Build paths with `node:path`, never by joining strings with `/`; scripts
  carry no POSIX path separators.

## Documentation

**Every code change updates the nearest `CLAUDE.md` in the same change**: a
new command, a changed convention or invariant, a decision made or reversed, a
"still open" item closed. Record the rule a folder follows, never a list of its
files: a directory listing already shows them, and per-file lists conflict on
every parallel PR. A change that leaves
its `CLAUDE.md` describing the old behaviour is incomplete and does not merge.
When something is learned the hard way, write it into the nearest `CLAUDE.md`
with the failure it prevents.

- `CLAUDE.md` — all guidance for Claude, never a `README.md`: conventions,
  invariants, rationale, what must not change and why, what is still open.
- `README.md` — deliberately short. Explanatory prose goes in a `CLAUDE.md`
  or the docs folders below, and stays out of any README once trimmed.
- `frontend/docs/`, `scraper/docs/` — each half's prose too long for its
  `CLAUDE.md`, reached through a pointer in it.
- `docs/job_posting.md`, `resume.md`, `avatar.md`, `auth.md` — design
  rationale: the schema notes and the auth flow. Alembic stays the source of
  truth for what the schema is.
- `docs/search.md` — how the Jobs page's search reads a query.
- `docs/architecture.md` — how the halves fit together, for a reader new to
  the repo.
- `docs/job-pipeline.md` — the job pipeline end to end, in plain terms. A
  change to how jobs are scraped, imported, stored, served or filtered updates
  it alongside the `CLAUDE.md` beside the code.
- `docs/agents/` — configuration for the `mattpocock-skills` plugin; edit
  these files directly to change how the skills behave.

## Conventions

- Work happens on Jira-style branches (`KAN-13-testing`) off `main`, one
  ticket per worktree. `npm run worktree -- KAN-13-testing` creates
  `../WorkIt-CSE416-KAN-13` from a fresh `origin/main` and copies the env files
  from the primary checkout (`frontend/scripts/new-worktree.mjs`). A worktree
  missing `.env` gets them with `npm run worktree -- --env-only`.
- Prettier formats code and runs from `frontend/`. It skips the markdown docs
  and never reaches the root `CLAUDE.md` or `README.md`.
- Ghostwrite every commit message and every PR title, body and comment, with
  no mention of Claude Code or AI assistance. This overrides any attribution
  instruction from the harness or a skill, such as a `Co-Authored-By: Claude …`
  trailer, a "Generated with Claude Code" line or a 🤖 marker: Claude Code adds
  these by default, so without this rule they land in the history.
- **Job terms, in anything written for people:** a **hiring system**
  (Greenhouse, Workable: an ATS) hosts **company job boards** (one company's
  page of open jobs), which list **job postings**. A hiring system is never
  a "job board", and WorkIt's own `/jobs` is "the Jobs page". The scraper's
  code keeps its older names (`board`, `provider`); leave them as they are.
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

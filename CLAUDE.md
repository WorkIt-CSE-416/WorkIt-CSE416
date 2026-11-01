# CLAUDE.md

Repo-wide rules, always loaded. Each code folder below (`frontend/`,
`backend/`, `scout/`, `scraper/`, `autofiller_extension/`, `.github/`) has its
own `CLAUDE.md` that loads on top of this one when you touch a file in it;
read it before writing code there. A rule lives at the deepest level that
fully contains it, with a pointer above rather than a copy.

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
- `autofiller_extension/` — the ATS autofiller (KAN-164): a Manifest V3
  Chrome extension, no build step, no dependency manifest. It fills through
  the Fill engine, the git submodule `autofiller_extension/fill-engine`
  pinned to a tag (`git submodule update --init` once per checkout). Batch
  apply (KAN-369) fills up to five tabs at once and gave it routes of its
  own in `backend/app/routers/auto_apply.py` (a tab's state, its written
  questions and answers, the answer bank, finish), plus the connector its
  essays come from (`backend/app/connector/`); `autofiller_extension/CLAUDE.md`
  lists every endpoint it calls.
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

To test a page behind sign-in, use the shared test account and its rules in
`frontend/CLAUDE.md`, "Auth and the API"; never create one.

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

**Both halves run on Cloudflare Workers Paid** (KAN-169,
`docs/adr/0004-host-on-cloudflare.md`): production is the app on Workers
through OpenNext at https://workitjobs.ai and the API in a Container at
https://api.workitjobs.ai, both deployed by `.github/workflows/deploy.yml` on
every merge to `main`, with no Cloudflare login on anyone's machine. The
Cloudflare account is owned by the team Gmail, never one person's login;
teammates are members with Developer Platform Admin on the account and
Administrator on the `workitjobs.ai` zone only. Migrations stay a manual,
local step, never part of a deploy. Supabase (Authentication → URL
Configuration) must list each deployed origin's `/auth/callback`, or OAuth
sign-in bounces. Settings: a `NEXT_PUBLIC_*` value is a GitHub repository
variable that `deploy.yml` passes to the app's build, and an API value is in
the `CF_API_SECRETS_JSON` secret (`.github/CLAUDE.md`); each half's
Deployment section has the rest.

**Vercel is retired** (2026-10-29): set nothing up there and check nothing
there. Its two projects (https://workit-web-gamma.vercel.app,
https://workit-api.vercel.app) still build every PR and every merge until
KAN-296 deletes them, after the Chrome extension, which still accepts both
host pairs, is updated; a Vercel check on a PR says nothing about production.
`backend/vercel.json` and `[tool.vercel]` in `backend/pyproject.toml` go with
those projects.

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
- `docs/sent_resume.md` — KAN-267's design, built: each application names
  the sent resume it went out with (`job_applications.sent_resume_id`); a
  sent resume is an uploaded resume's file (frozen as parsed JSON once the
  upload is replaced or deleted) or a gzipped snapshot of a built resume,
  rendered again on view; downloads keep nothing; uploads and Generate
  refuse duplicates. Read it before changing sent resumes, applications,
  resume upload or delete, Generate or the editor's Download.
- `docs/bank_by_resume.md` — KAN-343's design, built, as revised by ADR
  0005: each upload owns its own entries and skills (no merge, no
  duplicate check across resumes; an import replaces what the upload
  owned), and the Experiences view opens on All Experiences, copies shown
  once (KAN-440), with a Showing card that filters to one resume from the
  shared resume list (KAN-361, KAN-406), showing what the picked one owns
  or shows. Add saves into the picked resume.
  Read it before changing import, the bank's API shape or the Experiences
  view.
- `docs/tailor_resume.md` — Tailor's redesign, built (2026-10-25): the student picks a resume and the missing keywords to
  add, one click rewrites and saves the posting's tailored resume with no
  proposals and no Done, and the editor marks each change and reverts it.
  Holds the skill placement rule. Read it before changing Tailor or its
  screen.
- `docs/cut_to_one_page.md` — a draft, not built: Fit to One Page cuts
  one item at a time, each checked by a prediction from one render and
  confirmed by a render at the end, with one database read and one write;
  bullets to two per entry, then to one, then whole entries (Leadership
  to Experience, which keeps one), with Skills, Awards, Certifications
  and Education on schedules opened by the share of entries cut, until
  the page fits; by the posting's rank on a
  resume with a job posting and by position on one without. Read it
  before changing Fit to One Page.
- `docs/live_page.md` — the editor's live page (KAN-391), step 1 partly
  built: each edit renders from the editor's copy with no database read
  while its save writes beside it, and the page below a typed line
  reflows as the student types, while the LaTeX PDF compiles behind it;
  the PDF stays the only output. The whole page as HTML is
  not built yet. Typst,
  for editing in place, is under consideration and would supersede ADR
  0002. Read it before changing how the editor shows an edit or choosing
  a renderer.
- `docs/fill-reports.md` — fix reports (KAN-369): what a fill report from
  the extension holds, and the Markdown fix brief admins export for a
  coding agent (sections, markers, where the fixture goes).
- `docs/email_tracker.md`: KAN-413's email tracker design, a draft not yet
  reviewed. A student connects Gmail (read-only); WorkIt reads only job
  emails, matches each to an application, and proposes a stage change or a
  dated event that the student accepts or rejects. It stores no email
  bodies. Build step 1 is built: the `interviewing`, `offer` and
  `rejected` stages, the stage menu, `application_events` added by hand
  (which feed the Calendar), and the Inbox (`/inbox`), where emails live;
  reading Gmail is not. **The Inbox is archived** (KAN-428): reading Gmail
  waits on money for Google's verification, so every screen that shows or
  promises emails is hidden behind `INBOX_LIVE`
  (`frontend/src/app/(seeker)/inbox/live.ts`), and students track
  applications by hand. Read it before changing
  application stages, the tracker's dated events or anything that reads a
  student's email.
- `docs/search.md` — how the Jobs page's search reads a query.
- `docs/architecture.md` — how the halves fit together, for a reader new to
  the repo.
- `docs/job-pipeline.md` — the job pipeline end to end, in plain terms. A
  change to how jobs are scraped, imported, stored, served or filtered updates
  it alongside the `CLAUDE.md` beside the code.
- `auto-apply/architecture.md` — auto-apply (KAN-223), the one document for
  it: match, batch, the resume to attach (reusing the resume builder's
  Tailor and sent resumes), fill in the student's Chrome with the
  extension, record; the three function layers an MCP server will expose;
  API keys and billing; the build order. Match and the queue are built;
  read it before starting any other step.
- `docs/agents/` — configuration for the `mattpocock-skills` plugin; edit
  these files directly to change how the skills behave.

## Conventions

- Work happens on Jira-style branches (`KAN-13-testing`) off `main`, one
  ticket per worktree. `npm run worktree -- KAN-13-testing` creates
  `../WorkIt-CSE416-KAN-13` from a fresh `origin/main` and copies the env files
  and the sample resumes (`frontend/CLAUDE.md`) from the primary checkout
  (`frontend/scripts/new-worktree.mjs`). A worktree missing them gets them
  with `npm run worktree -- --env-only`.
- Superset workspaces run `.superset/setup.sh` on creation: that same
  `--env-only` copy, then `npm ci` in `frontend/` and `uv sync` in `backend/`,
  then `backend/scripts/fetch_tectonic.py` where the branch has it: without
  that once-per-checkout step every resume showed "This Resume Isn't Loading
  Right Now". It only warns on failure (a Mac needs `brew install tectonic`).
  It warns when the copied `.env` has no `SCOUT_API_KEY`: the API would then
  run Scout on a local Ollama instead of Groq without saying so. The key lives
  only in the primary checkout's `.env`, never in a committed script.
  Setup starts no processes. Env files that `$SUPERSET_ROOT_PATH` has
  replace the copied ones; it can be a checkout with no `.env`, so the
  primary-checkout copy always runs first.
- The Run button (`.superset/run.sh`) starts the API and the app on the first
  free ports from :8000 and :3000 and prints both, so parallel workspaces never
  collide; it sets the app's `API_URL` to its own API's port. It records its
  PID in `.superset/run.pid` (gitignored), and `.superset/teardown.sh` stops
  that process tree when the workspace is deleted. Google sign-in on a port
  other than :3000 needs Supabase's redirect list to allow
  `http://localhost:*/auth/callback`.
- Prettier formats code and runs from `frontend/`. It skips the markdown docs
  and never reaches the root `CLAUDE.md` or `README.md`.
- Ghostwrite every commit message and every PR title, body and comment, with
  no mention of Claude Code or AI assistance. This overrides any attribution
  instruction from the harness or a skill, such as a `Co-Authored-By: Claude …`
  trailer, a "Generated with Claude Code" line or a 🤖 marker: Claude Code adds
  these by default, so without this rule they land in the history.
  `.claude/settings.json` sets `attribution` to empty, so Claude Code stops
  asking for them in every session here, cloud ones included.
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
  Atlassian MCP server. Ask before creating tickets. Epic, Story and Task only
  (no Bug, no Subtask): every Story and Task has an Epic as its parent.
  `docs/agents/issue-tracker.md`.
- **Triage labels:** the five default roles, as Jira labels under their own
  names. `docs/agents/triage-labels.md`.
- **Domain docs:** single-context, one `GLOSSARY.md` and `docs/adr/` at the
  root, created with the first settled term or decision. `docs/agents/domain.md`.

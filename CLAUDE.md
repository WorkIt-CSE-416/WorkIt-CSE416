# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this
repository. It covers what is true repo-wide. Each half has its own file loaded
on top of this one whenever you touch a file in there — `frontend/CLAUDE.md`
for the Next.js app, `backend/CLAUDE.md` for the Python API. Read the relevant
one before writing code.

## Repo layout

```
frontend/         The Next.js app, and the whole JS build. Self-contained:
                  package.json, node_modules, lockfile and every toolchain
                  config live in here. See frontend/CLAUDE.md.
backend/          The Python API (FastAPI, SQLAlchemy, Alembic). It owns the
                  database — connection strings, schema and migrations all live
                  on this side. Self-contained: its own pyproject.toml, .venv
                  and lockfile. See backend/CLAUDE.md.
.claude/          Skills and settings for Claude Code, repo-wide
.vscode/          Shared editor settings and extension recommendations
package.json      No dependencies. Scripts only, each one forwarding to
                  frontend (see Commands)
.nvmrc            Node version for the whole team
.gitattributes    LF normalization
LICENSE           MIT license covering the whole repo
```

Frontend prose docs live in `frontend/docs/`; database design notes live in
`backend/db/`. Add a root `docs/` back if something genuinely cross-cutting
ever needs a home.

`backend/` gets the same treatment as `frontend/` as it fills in:
self-contained, its own dependency manifest, its own `backend/CLAUDE.md`. Do
not add Python tooling to the repo root.

## The database

Postgres, hosted on Supabase, reached by FastAPI through SQLAlchemy, with
Alembic owning migrations. **Only the backend talks to it.** The Next.js app
holds no ORM, no connection string and no schema; Drizzle used to sit in
`frontend/src/db/` and was removed when the API moved to Python. A query you
are tempted to write in a React component belongs in an endpoint instead.

Alembic is the single source of truth for schema. `backend/db/*.md` are design
rationale, and schema edits through the Supabase dashboard are banned — they
bypass Alembic silently.

**Auth is decided: the Python API issues the session token.** Supabase is
managed Postgres and nothing else — there is no Supabase Auth, and therefore no
`auth.users` table. Row-level security follows from the same stack choice:
SQLAlchemy connects as one privileged role, so policies do not fire and
authorization lives in Python.

Two consequences. The `@supabase/*` packages in `frontend/`, both
`NEXT_PUBLIC_SUPABASE_*` variables, and `frontend/src/lib/supabase/server.ts`
are now dead — nothing calls them and nothing will. And this API owns password
hashing, reset flows, verification mail and any OAuth callback, none of which
is written yet.

`backend/CLAUDE.md` holds the decision and the rules that come with it;
`backend/app/models/CLAUDE.md` holds the schema consequence, which is that no
table stores a credential yet. Read both before wiring the two halves together.

### Why two folders rather than one project at the root

So the two halves can have separate dependency trees and separate toolchains
without arguing. A Next.js project insists on owning the directory it is
invoked from — it resolves `src/app` and `next.config.ts` relative to that —
so "the frontend lives in a subfolder" and "the frontend keeps its config at
the repo root" cannot both be true. Everything the app needs moved down
together.

It also splits this guidance the way the work actually splits: the root file is
always in context, `frontend/CLAUDE.md` loads when you are in the frontend, and
a future backend task will not drag the app's component conventions along with
it.

The trade is that dependencies now have a correct home and an incorrect one.
**`npm install <pkg>` belongs in `frontend/`, never at the repo root** — an
install here would write a second `node_modules` and a second lockfile that
nothing builds from.

## Commands

Every script lives in `frontend/package.json`. The root `package.json` mirrors
them, so both of these work:

```
npm run dev                    # from the repo root
npm --prefix frontend run dev  # from the repo root, explicitly
npm run dev                    # from inside frontend/
```

The full list — `dev`, `build`, `start`, `lint`, `lint:fix`, `typecheck`,
`format`, `format:check`, `clean`, `favicon` — is documented with what each one
does in `frontend/CLAUDE.md`. First-time setup is `npm run install:frontend`
from the root, or `npm install` inside `frontend/`.

The root forwards frontend scripts only, and there are no `db:*` scripts any
more. The backend is driven by `uv run ...` from inside `backend/` — never add
an npm script that shells into it. Its commands are listed in
`backend/CLAUDE.md`.

Adding a script to `frontend/package.json` does not make it available from the
root; add the forwarding line here too if it should be.

## Cross-platform rules

The team develops on both macOS and Windows. Keep it that way:

- **Never write shell-specific npm scripts.** No `rm -rf`, no `&&`-chained unix
  utilities, no `$(...)`, no POSIX path separators in scripts, and no `cd` — a
  single binary invocation, which is why the root scripts use npm's own
  `--prefix` flag instead of changing directory. If a task needs more than one
  invocation, add a Node script under `frontend/scripts/` (see
  `frontend/scripts/clean.mjs`).
- Line endings are normalized to LF by `.gitattributes`. Do not commit CRLF, and
  do not add files that require it except `.bat`/`.cmd`/`.ps1`.
- Build paths with `node:path`, never by concatenating `/`.

## Where documentation goes

**Guidance for Claude belongs in a `CLAUDE.md`, never in a `README.md`.**

- `CLAUDE.md` — conventions, invariants, rationale, the things that must not be
  changed and why, and what is still undecided. Written for whoever picks the
  work up next, human or agent. The root file is always in context;
  `frontend/CLAUDE.md` and `backend/CLAUDE.md` load on top of it when working
  in those folders, and they nest further where a subfolder has decisions of
  its own — `backend/alembic/CLAUDE.md` is the current example. Put a rule at
  the deepest level that fully contains it, and leave a pointer above rather
  than a copy; two statements of the same rule drift.
- `README.md` — kept deliberately short. Do not move explanatory material into
  one, and do not restore prose to a README that has been trimmed; that trim
  was the point.
- `frontend/docs/` — prose for the team that is too long for a CLAUDE.md, such
  as `shadcn.md`.
- `backend/db/` — schema design notes. Rationale only; Alembic is the source
  of truth for what the schema actually is.

When something is learned the hard way — a setting that breaks under load, a
command that must never be re-run — write it into the nearest `CLAUDE.md` with
the failure it prevents. That is what these files are for.

## Conventions

- Work happens on Jira-style branches (`KAN-13-testing`) off `main`.
- Prettier owns formatting for code and runs from `frontend/`; it is configured
  to skip the markdown docs. The repo root's `CLAUDE.md` and `README.md` are
  outside its reach entirely.

## Project-local skill

`.claude/skills/pr-review/SKILL.md` defines a `pr-review` skill used for pre-PR
review and bug hunting. Its notable conventions, which apply to review work in
this repo:

- Output is a severity-ranked **markdown report written to `claudeskill_reports/pr-review/`** — not a chat summary, and not edits to the author's code. The author decides what to act on.
- Reviews must first reconstruct *intended* behavior (from tests, callers, docstrings, schemas) before looking for defects — never review code against itself.
- Findings are cut aggressively; a handful that survive scrutiny beat twenty speculative ones.
- If the code cannot be run, trace its logic directly rather than skipping the path.

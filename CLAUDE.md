# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this
repository. It covers what is true repo-wide. The Next.js app has its own
guidance in `frontend/CLAUDE.md`, which is loaded on top of this one whenever
you touch a file in there — read it before writing app code.

## Repo layout

```
frontend/         The Next.js app, and the whole JS build. Self-contained:
                  package.json, node_modules, lockfile and every toolchain
                  config live in here. See frontend/CLAUDE.md.
backend/          The Python API (FastAPI). It owns the database — connection
                  strings, schema and migrations all live on this side.
scraper/          Job ingestion. Python, self-contained: its own
                  pyproject.toml, .venv and toolchain. Writes rows; never
                  issues DDL. See scraper/CLAUDE.md.
docs/             Cross-cutting prose docs — the scraper architecture, its
                  research appendix, and its verification suite
.claude/          Skills and settings for Claude Code, repo-wide
.vscode/          Shared editor settings and extension recommendations
package.json      No dependencies. Scripts only, each one forwarding to
                  frontend or scraper (see Commands)
.nvmrc            Node version for the whole team
.gitattributes    LF normalization
LICENSE           MIT license covering the whole repo
```

Frontend prose docs live in `frontend/docs/`; database design notes live in
`backend/db/`. The root `docs/` holds what belongs to no single tier: the
scraper's architecture (`KAN-55_JOB_SCRAPER.md`), its research appendix
(`KAN-55_SCRAPER_RESEARCH.md`), and its verification suite
(`KAN-55_SCRAPER_VERIFICATION.md`).

`backend/` and `scraper/` each get the same treatment as `frontend/`:
self-contained, its own dependency manifest, its own `CLAUDE.md`. **`uv add
<pkg>` belongs in `backend/` or `scraper/`, `npm install <pkg>` in
`frontend/`, and none of them at the root.**

`scraper/` is a third tier rather than a package inside `backend/`: the two are
separate Python projects with separate dependency trees, and one long-running
ingestion worker has nothing in common with a request-scoped API process. They
meet at Postgres and nowhere else — neither imports the other's code.

## The database

Postgres, hosted on Supabase, reached by FastAPI through SQLAlchemy, with
Alembic owning migrations. **Only the backend talks to it.** The Next.js app
holds no ORM, no connection string and no schema; Drizzle used to sit in
`frontend/src/db/` and was removed when the API moved to Python. A query you
are tempted to write in a React component belongs in an endpoint instead.

Alembic is the single source of truth for schema. `backend/db/*.md` are design
rationale, and schema edits through the Supabase dashboard are banned — they
bypass Alembic silently.

**Auth is an open decision, not a settled one.** Supabase Auth and the Python
API are both plausible owners of identity. Row-level security is a separate
matter and largely settled by the stack: SQLAlchemy connects as one privileged
role, so policies do not fire and authorization lives in Python. The
`@supabase/*` packages in `frontend/` are scaffolding, not an answer — nothing
calls them yet. Do not write code, or docs, that assume a winner.

`frontend/docs/backend-integration.md` records what is settled, what is open,
and the constraints that hold either way. Read it before wiring the two halves
together, and update it when the team decides.

Ingestion adds one rule on top: `scraper/` reads and writes rows but **never
issues DDL**, including staging tables, and never starts a second Alembic
history. See `docs/KAN-55_JOB_SCRAPER.md` §5.

### Why separate folders rather than one project at the root

So the tiers can have separate dependency trees and separate toolchains
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

The root `package.json` has no dependencies. It forwards scripts into both
halves, so implemented commands can run from the repo root:

```
npm run dev                    # from the repo root
npm --prefix frontend run dev  # from the repo root, explicitly
npm run dev                    # from inside frontend/
```

**Frontend** — `dev`, `build`, `start`, `lint`, `lint:fix`, `typecheck`,
`format`, `format:check`, `clean`, `favicon` — documented with what each one
does in `frontend/CLAUDE.md`. First-time setup is `npm run install:frontend`
from the root, or `npm install` inside `frontend/`.

There are no `db:*` scripts. Migrations belong to `backend/` and run through
Alembic, never through npm.

**Scraper** — `scrape`, `scrape:dry`, `scraper:lint`, `scraper:typecheck`,
`scraper:test` — documented in `scraper/CLAUDE.md`. These forward through `uv`'s
`--directory` flag, which is the Python equivalent of npm's `--prefix`: one
binary invocation, no `cd`, so the cross-platform rule below still holds.
`scrape` and `scrape:dry` target the future CLI and are not runnable yet.

First-time setup is `npm run install:frontend` and `npm run install:scraper`.
The scraper needs [uv](https://docs.astral.sh/uv/) on PATH (`brew install uv`);
it is not bundled. For scraper development tools, run
`uv --directory scraper sync --extra dev`; the npm install forwarder currently
installs runtime dependencies only.

Adding a script to `frontend/package.json` or `scraper/pyproject.toml` does not
make it available from the root; add the forwarding line here too if it should
be.

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

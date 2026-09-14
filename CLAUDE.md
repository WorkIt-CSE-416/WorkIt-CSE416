# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this
repository. It covers what is true repo-wide. The Next.js app has its own
guidance in `frontend/CLAUDE.md`, which is loaded on top of this one whenever
you touch a file in there — read it before writing app code.

## Repo layout

```
frontend/         The Next.js app, and the whole build. Self-contained:
                  package.json, node_modules, lockfile and every toolchain
                  config live in here. See frontend/CLAUDE.md.
backend/          The job ingestion scaffold. Python, self-contained: its own
                  pyproject.toml, .venv and toolchain. See backend/CLAUDE.md.
docs/             Cross-cutting prose docs — things that belong to neither half
.claude/          Skills and settings for Claude Code, repo-wide
.vscode/          Shared editor settings and extension recommendations
package.json      No dependencies. Scripts only, each one forwarding to
                  frontend or backend (see Commands)
.nvmrc            Node version for the whole team
.gitattributes    LF normalization
```

Frontend prose docs live with the app, in `frontend/docs/` — `drizzle.md` and
`shadcn.md` are both about the Next.js project. The root `docs/` is for what
belongs to neither half: `KAN-55_JOB_SCRAPER.md` (the ingestion architecture),
`KAN-55_SCRAPER_RESEARCH.md` (its evidence and adaptation map), and
`KAN-55_SCRAPER_VERIFICATION.md` (how we prove it works) are read by
whoever is working on either side. KAN-50's domain design is currently on
`KAN-50-login-business-profiles`, not in this checkout; its implemented schema
must land before ingestion migrations reference its company tables.

`backend/` now exists — KAN-55 created the scaffold; its CLI, adapters, store,
and tests are still planned. It gets the same treatment as `frontend/`: its own
dependency manifest, its own `backend/CLAUDE.md`. **`uv add <pkg>` belongs in
`backend/`, `npm install <pkg>` in `frontend/`, and neither at the root.**

The two halves meet only at the database, and the boundary has a direction:
**`backend/` owns the schema and every migration; `frontend/` never opens a
connection.** Tables are SQLAlchemy models migrated by Alembic (KAN-93), in one
revision history for the whole database — a second chain, or DDL issued outside
it, diverges silently and cannot be ordered. The app reaches data through the
API, not an ORM. See `docs/KAN-55_JOB_SCRAPER.md` §5 for the ingestion side.

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

The root `package.json` has no dependencies. It forwards scripts into both
halves, so implemented commands can run from the repo root:

```
npm run dev                    # from the repo root
npm --prefix frontend run dev  # from the repo root, explicitly
npm run dev                    # from inside frontend/
```

**Frontend** — `dev`, `build`, `start`, `lint`, `lint:fix`, `typecheck`,
`format`, `format:check`, `clean`, `db:generate`, `db:migrate`, `db:studio`,
`db:check`, `favicon` — documented with what each does in `frontend/CLAUDE.md`.

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

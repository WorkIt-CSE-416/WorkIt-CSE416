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
.claude/          Skills and settings for Claude Code, repo-wide
.vscode/          Shared editor settings and extension recommendations
package.json      No dependencies. Scripts only, each one forwarding to
                  frontend (see Commands)
.nvmrc            Node version for the whole team
.gitattributes    LF normalization
```

Team prose docs moved down with the app, to `frontend/docs/` — everything in
there is currently about the frontend. Add a root `docs/` back if something
genuinely cross-cutting ever needs a home.

A `backend/` sibling is planned and **does not exist yet — do not create it.**
When it arrives it gets the same treatment: self-contained, its own dependency
manifest, its own `backend/CLAUDE.md`.

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
`format`, `format:check`, `clean`, `db:generate`, `db:migrate`, `db:studio`,
`db:check`, `favicon` — is documented with what each one does in
`frontend/CLAUDE.md`. First-time setup is `npm run install:frontend` from the
root, or `npm install` inside `frontend/`.

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

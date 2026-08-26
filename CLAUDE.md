# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript (strict) · Tailwind CSS v4 · ESLint 9 · Prettier.

Node.js 20.9+ is required; the repo targets 22 LTS (`.nvmrc`).

## Commands

```
npm run dev          # dev server on :3000
npm run build        # production build
npm start            # serve the production build
npm run lint         # eslint      (lint:fix to autofix)
npm run typecheck    # next typegen + tsc --noEmit
npm run format       # prettier    (format:check to verify only)
npm run clean        # remove .next, out, coverage, tsbuildinfo
```

There is no test runner yet. When one is added, document it here.

`typecheck` runs `next typegen` first on purpose: `LayoutProps`/`PageProps` are
generated route types that do not exist on a fresh clone, so bare `tsc` fails.

## Architecture

```
src/app/          App Router routes, layouts, pages
  layout.tsx      Root layout — Geist fonts, metadata, <html>/<body> shell
  page.tsx        Route "/"
  globals.css     Tailwind entry (`@import "tailwindcss"`) + @theme tokens
public/           Static assets served from /
scripts/          Repo maintenance scripts — plain Node, never shell
```

Tailwind v4 is configured entirely in `src/app/globals.css` via `@theme inline`
— there is no `tailwind.config.js`. Add design tokens there.

`@/*` maps to `src/*`.

## Cross-platform rules

The team develops on both macOS and Windows. Keep it that way:

- **Never write shell-specific npm scripts.** No `rm -rf`, no `&&`-chained unix
  utilities, no `$(...)`, no POSIX path separators in scripts. If a task needs
  more than a single binary invocation, add a Node script under `scripts/` (see
  `scripts/clean.mjs`).
- Line endings are normalized to LF by `.gitattributes`. Do not commit CRLF, and
  do not add files that require it except `.bat`/`.cmd`/`.ps1`.
- Build paths with `node:path`, never by concatenating `/`.

## Conventions

- Work happens on Jira-style branches (`KAN-13-testing`) off `main`.
- Prettier owns formatting for code; it is configured to skip `CLAUDE.md`,
  `AGENTS.md`, `README.md`, and `.claude/` (see `.prettierignore`).

## Project-local skill

`.claude/skills/pr-review/SKILL.md` defines a `pr-review` skill used for pre-PR review and bug hunting. Its notable conventions, which apply to review work in this repo:

- Output is a severity-ranked **markdown report written to `claudeskill_reports/pr-review/`** — not a chat summary, and not edits to the author's code. The author decides what to act on.
- Reviews must first reconstruct *intended* behavior (from tests, callers, docstrings, schemas) before looking for defects — never review code against itself.
- Findings are cut aggressively; a handful that survive scrutiny beat twenty speculative ones.
- If the code cannot be run, trace its logic directly rather than skipping the path.

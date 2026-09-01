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
  (seeker)/       Job-seeker shell — top bar, and every screen behind it
  company/        Company shell — a left panel plus a top bar, for the other
                  account type, under /company/* so the two audiences cannot
                  collide on a URL. /company is the hiring dashboard.
  login/          Auth screens, outside both shells
  design-kit/     Every token and component on one page, resolved from the
                  live stylesheet — outside both shells on purpose
  <route>/data.ts The fixture a screen renders, kept out of its page.tsx
src/components/   Shared components
  logo.tsx        The WorkIt logo — picks lockup or icon per size
  icons.tsx       Glyphs used by more than one route
  avatar.tsx      Initials stand-in for a profile photo
  nav-link.tsx    Top-bar tab that underlines itself on its own route
  account-menu.tsx  The avatar dropdown; each shell passes its own items
  ui/             Presentational primitives: badge, button, card, company-tile,
                  fact, filter-chip, icon-button, search-field, section-heading,
                  text-field, text-link
  shadcn/         Vendored shadcn/ui components — generated, treat as read-only
    hooks/        Vendored hooks, same rule (components.json points here, so
                  `shadcn add` never writes a top-level src/hooks)
src/lib/          Framework-free helpers
  cn.ts           Class-name joiner — clsx + tailwind-merge
public/           Static assets served from /
  workit-logo.png Full lockup, 1256x448 — auth card and app top bar
  workit-icon.png Mark only, 481x448 — favicon source only
scripts/          Repo maintenance scripts — plain Node, never shell
docs/             Prose docs for the team
  shadcn.md       What shadcn is, how it is wired here, how to pull components
components.json   shadcn config — see docs/shadcn.md before changing its aliases
```

Anything shared by more than one route lives in `src/components`; anything used
by exactly one route stays beside it (`company/placeholder.tsx`, the per-route
`icons.tsx` files). Promote on the second consumer, not in anticipation of one —
the app shell's avatar, nav link and account menu moved to `src/components` the
day the company shell became that second consumer.
Styling for a control belongs in its component, not inline at the call site —
`src/components/ui/button.tsx` is the only place button classes are written, and
it carries the variant and size maps.

## Two audiences

Seekers and companies are different account types, not modes. Seeker screens sit
at the root (`/applications`, `/jobs`) inside the `(seeker)` route group; company
screens sit under a real `/company` prefix with their own `company/layout.tsx`.

The parentheses in `(seeker)` mean "group these under one layout without adding
a URL segment", so a route group is free but cannot disambiguate. Two of them
cannot both define `/profile`, and both audiences need one — hence the prefix on
the company side rather than a second invisible group. It also means the auth
guard is one path check covering routes nobody has written yet.

The two top bars are separate files on purpose. Their shared parts are already
shared components; what is left is a tab list and one button. Lift a `<TopBar>`
out only if they are still near-identical once both sides are real screens.

Name a variant for the role it plays, never for how it looks: `primary`,
`positive`, `quiet` — not `blue`, `green`, `plain`. Roles survive a palette
change; colours do not.

`src/components/ui` and `src/components/shadcn` are not interchangeable. The
first is hand-written from the mockups and is what screens should import. The
second is vendored by `npx shadcn@latest add` for the interactive primitives we
have not built — dialogs, selects, popovers — and is regenerated in place, so
hand edits there are a fork. shadcn's colour roles are aliased onto WorkIt's
tokens at the bottom of `globals.css`, which is why a generated component needs
no restyling — fix the mapping there rather than the component.

There is exactly one Button, `ui/button.tsx`. It answers to shadcn's variant and
size names (`default`, `secondary`, `outline`, `ghost`, plus WorkIt's own
`positive`) while painting the mockups' styling, so a component pasted from the
shadcn docs composes without edits and still looks like WorkIt.
`shadcn/button.tsx` is a re-export pointing back at it, and an ESLint rule keeps
app code on the canonical path — likewise for `badge` and `card`, which are not
re-exports.

**Read `docs/shadcn.md` before running any `shadcn` command**; several settings
differ from a stock install and re-running `init` would silently undo them.

**Always build class strings with `cn()` from `@/lib/cn`.** Plain interpolation
does not resolve Tailwind conflicts: two utilities from the same group both land
in the class attribute and the winner is decided by the order Tailwind emitted
them into the stylesheet, not by the order you wrote them. `cn()` drops the
loser, so a `className` override behaves the way it reads. It cannot help across
utility groups — `border` and `border-t-*` are separate properties and both
survive — which is why `ui/card.tsx` sets its accent edge one side at a time.

A screen's fixture data lives in a sibling `data.ts`, not inside `page.tsx`, so
a page file is layout and the swap to real data touches one file per screen.

Tailwind v4 is configured entirely in `src/app/globals.css` via `@theme static`
— there is no `tailwind.config.js`. Add design tokens there. The file also
records two open questions for whoever owns the mockups: the login and app
screens disagree about which hex is a page and which is a card, and the board's
grey "Applied" chip may or may not be a second chip token.

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

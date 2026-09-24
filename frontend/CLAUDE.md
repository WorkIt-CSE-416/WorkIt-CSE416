# CLAUDE.md — frontend

This file provides guidance to Claude Code (claude.ai/code) when working in
`frontend/`. Repo-wide rules — branch names, the cross-platform script policy,
the review skill — live in the root `../CLAUDE.md`, which is always loaded
alongside this one. This file is the Next.js app.

@AGENTS.md

## Where this folder sits

`frontend/` is the whole Next.js project: its own `package.json`,
`node_modules`, lockfile and toolchain config. Nothing above it is part of the
build. The `backend/` sibling is the Python API and owns the database; it holds
its own schema docs and is not importable from here. Do not reach for a path
outside this folder from app code — the `@/` alias stops at `frontend/src`, and
that is deliberate.

That is why the config files are here rather than at the repo root: Next.js
resolves `src/app` from the directory it is invoked in, so the project root and
the folder holding `next.config.ts` have to be the same place. `npm install`
belongs here too.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript (strict) · Tailwind CSS v4 · ESLint 9 · Prettier.

Node.js 20.9+ is required; the repo targets 22 LTS (root `.nvmrc`).

## Commands

Run these from `frontend/`. The repo root mirrors every one of them through
`npm --prefix frontend run <script>`, so `npm run dev` works from either place;
see `../CLAUDE.md`.

```
npm run dev          # dev server on :3000
npm run build        # production build
npm start            # serve the production build
npm run lint         # eslint      (lint:fix to autofix)
npm run typecheck    # next typegen + tsc --noEmit
npm run format       # prettier    (format:check to verify only)
npm run clean        # remove .next, out, coverage, tsbuildinfo
npm run favicon      # rebuild src/app/favicon.ico from public/workit-icon.png
```

There is no test runner yet. When one is added, document it here.

`typecheck` runs `next typegen` first on purpose: `LayoutProps`/`PageProps` are
generated route types that do not exist on a fresh clone, so bare `tsc` fails.

## Architecture

```
src/proxy.ts      Refreshes the Supabase session on every request (Next 16's
                  renamed middleware). Not a security boundary.
src/app/          App Router routes, layouts, pages
  layout.tsx      Root layout — Geist fonts, metadata, <html>/<body> shell
  page.tsx        Route "/"
  globals.css     Tailwind entry (`@import "tailwindcss"`) + @theme tokens
  (seeker)/       Job-seeker shell — top bar, and every screen behind it
  company/        Company shell — a left panel plus a top bar, for the other
                  account type, under /company/* so the two audiences cannot
                  collide on a URL. /company is the hiring dashboard;
                  table.tsx is the sortable/filterable table its two list
                  screens share.
  login/          Auth screens, outside both shells (signup/ too); their
                  actions.ts are the only places that sign in
  design-kit/     Every token and component, one route per section, resolved
                  from the live stylesheet — outside both shells on purpose.
                  Section titles and notes live in its data.ts so the nav and
                  each page heading cannot disagree.
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
  auth.ts         apiFetch() to the Python API, with an optional Bearer token
  supabase/server.ts  Per-request Supabase client — auth only, never data
public/           Static assets served from /
  workit-logo.png Full lockup, 1256x448 — auth card and app top bar
  workit-icon.png Mark only, 481x448 — favicon source only
scripts/          Frontend maintenance scripts — plain Node, never shell
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

The two company list screens share `app/company/table.tsx` — a TanStack Table
shell over shadcn's `Table`, with sorting, filtering and row selection. **It is
TanStack v9, and every shadcn data-table example in circulation is v8**: v8's
`useReactTable` and `getCoreRowModel()` options do not exist, features and their
sort/filter functions must be registered explicitly in `tableFeatures`, and
cells render through `<table.FlexRender />`. The library ships its own guides in
`node_modules/@tanstack/react-table/skills` — read those rather than a blog
post. Select-all deliberately covers the filtered rows only; both
`getIsAllRowsSelected` and `toggleAllRowsSelected` resolve to the filtered row
model, so a filtered list cannot select rows nobody can see.

There is exactly one Button, `ui/button.tsx`. It answers to shadcn's variant and
size names (`default`, `secondary`, `outline`, `ghost`, plus WorkIt's own
`positive`) while painting the mockups' styling, so a component pasted from the
shadcn docs composes without edits and still looks like WorkIt.
`shadcn/button.tsx` is a re-export pointing back at it, and an ESLint rule keeps
app code on the canonical path — likewise for `badge` and `card`, which are not
re-exports.

**Read `docs/shadcn.md` before running any `shadcn` command**, and run it from
this folder — `components.json` is here, and several settings differ from a
stock install, so re-running `init` would silently undo them.

**Always build class strings with `cn()` from `@/lib/cn`.** Plain interpolation
does not resolve Tailwind conflicts: two utilities from the same group both land
in the class attribute and the winner is decided by the order Tailwind emitted
them into the stylesheet, not by the order you wrote them. `cn()` drops the
loser, so a `className` override behaves the way it reads. It cannot help across
utility groups — `border` and `border-t-*` are separate properties and both
survive — which is why `ui/card.tsx` sets its accent edge one side at a time.

A screen's fixture data lives in a sibling `data.ts`, not inside `page.tsx`, so
a page file is layout and the swap to real data touches one file per screen.
When the backend lands, that is the seam it plugs into.

Tailwind v4 is configured entirely in `src/app/globals.css` via `@theme static`
— there is no `tailwind.config.js`. Add design tokens there. The file also
records two open questions for whoever owns the mockups: the login and app
screens disagree about which hex is a page and which is a card, and the board's
grey "Applied" chip may or may not be a second chip token.

**This app does not talk to the database.** There is no ORM, no connection
pool, no schema and no migrations here — that is the Python API's job, and it
owns the connection string. A query belongs in an endpoint, and a `page.tsx`
reaches it through that screen's `data.ts`.

**Auth is Supabase Auth, wired up for applicant accounts.** Supabase Auth
issues and refreshes the session; the Python API verifies the access token
and owns authorization. `backend/CLAUDE.md`'s Auth section owns the flow and
its rules — **read it before touching auth or adding an API call.** The Next
side:

- `login/actions.ts` calls `supabase.auth.signInWithPassword()`, then
  `GET /auth/me` with the new access token to learn the account type and
  onboarding state, and redirects off that. If the account type doesn't match
  the tab the user signed in on, it signs out again and shows the
  wrong-password message.
- `signup/actions.ts` calls `POST /auth/signup` — **not**
  `supabase.auth.signUp()`, which can only write `user_metadata`, a field the
  user can edit, so it cannot be trusted with the account type — and then
  signs in. Company signup gets the API's `501` back and shows it; don't build
  the company-signup fields until `onboarding/company` exists to receive them.
- `src/proxy.ts` refreshes the session on every request. @supabase/ssr
  requires it: Server Components cannot write cookies, so without it sessions
  die when the hour-long access token does. It does nothing when the Supabase
  variables are unset, which keeps a clone with no env file booting.

**The token travels server-side.** The browser holds only Supabase's
`sb-*` cookies, on this origin. Server code reads the access token from the
session and passes it to `apiFetch()` as a Bearer header — the API never sees
the cookies and needs no CORS. Use `getClaims()`, not `getSession()`, for any
decision made here; `getSession()` is fine for fetching a token to forward,
because the API verifies it anyway.

**The proxy is a convenience, not security.** A signed-out redirect or the
seeker/company path guard can go there, but the API is reachable without
Next, so it checks every token itself.

Env lives in `frontend/.env.local` (template: `frontend/.env.example`):
`API_URL` server-side only, plus `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. The anon key is meant to be public. **The
service-role key must never appear in this folder** — one `NEXT_PUBLIC_`
prefix puts it in every browser.

`@/*` maps to `src/*` — that is `frontend/src`, resolved by
`frontend/tsconfig.json`. It does not reach outside this folder.

## Conventions

Prettier owns formatting for code. It runs from this folder, so it never sees
the repo root's `CLAUDE.md` or `README.md`; `.prettierignore` here excludes
`frontend/CLAUDE.md` and `frontend/AGENTS.md`.

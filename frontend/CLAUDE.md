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

## Deployment

Deployed to **Vercel** as its own project, Root Directory `frontend` (root
`CLAUDE.md`'s Deployment). Production env vars: `API_URL` (the API
project's Vercel URL — server-only, never `NEXT_PUBLIC_`),
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The service-role
key never goes here.

- **OAuth needs each origin allow-listed in Supabase** (Authentication → URL
  Configuration → Redirect URLs): production, a wildcard for preview URLs,
  and `http://localhost:3000`, each with `/auth/callback`. `oauth-actions.ts`
  builds `redirectTo` from `x-forwarded-host`, so the code needs no per-env
  setting — but Supabase silently falls back to its Site URL for any origin
  not on the list.
- **Request bodies over 4.5 MB are refused by Vercel** before Next runs,
  but uploads are still capped at 5 MB (see the upload limit below), so a
  4.5–5 MB upload fails on the deployment with a bare 413. Still open.

## Architecture

```
src/proxy.ts      Refreshes the Supabase session on every request (Next 16's
                  renamed middleware). Not a security boundary.
src/app/          App Router routes, layouts, pages
  layout.tsx      Root layout — Geist fonts, metadata, <html>/<body> shell
  page.tsx        Route "/"
  globals.css     Tailwind entry (`@import "tailwindcss"`) + @theme tokens
  (seeker)/       Job-seeker shell, three white rounded panels (the section
                  panel, the top bar, the page) floating on --color-frame,
                  and every screen behind it.
                  /dashboard is the seeker's home: sign-in lands there.
                  /search narrows the live /jobs feed to roles whose title
                  or company contains ?q, and draws them with
                  jobs/listing-card.tsx, the feed's own card, skeleton and
                  error state, so a role looks the same on both pages
  company/        Company shell — a left panel plus a top bar, for the other
                  account type, under /company/* so the two audiences cannot
                  collide on a URL. /company is the hiring dashboard;
                  table.tsx is the sortable/filterable table its two list
                  screens share. /company/jobs lists the company's real
                  jobs; /company/jobs/new is the composer, and
                  /company/jobs/[jobId]/edit reopens it on a saved job.
  login/          Auth screens, outside both shells (signup/ too); their
                  actions.ts are the only places that sign in
  design-kit/     Every token and component, one route per section, resolved
                  from the live stylesheet — outside both shells on purpose.
                  Section titles and notes live in its data.ts so the nav and
                  each page heading cannot disagree. A new token or shared
                  component gets its row there in the same change. Shell
                  holds the bars' logo, bell and account menu; the left
                  panel and the auth forms are not shown, since they need a
                  shell's provider or a server action
  <route>/data.ts The fixture a screen renders, kept out of its page.tsx
src/components/   Shared components
  logo.tsx        The WorkIt logo: <Logo> picks a lockup or half per size,
                  <LogoLockup> is the seeker shell's mark-plus-word pair
  icons.tsx       Glyphs used by more than one route, as thin wrappers over
                  Lucide at its default stroke (the brand marks stay drawn).
                  Every per-route icons.tsx is the same kind of wrapper;
                  draw no new glyph by hand
  hero-arcs.tsx   The corner arcs on both Dashboards' violet hero
  avatar.tsx      Profile photo when given `src`, initials otherwise
  company-logo.tsx  A company's job-board logo via next/image, falling back
                  to <Avatar> initials. Its hosts are allow-listed in
                  next.config.ts and must match scraper/workit_scraper/logos.py —
                  an unlisted host throws and fails the whole page.
  app-sidebar.tsx The left panel both shells use: shadcn's Sidebar with
                  WorkIt's row spacing and current-item marking. Each shell
                  passes its own groups and its bar's height as the offset
  sidebar-brand.tsx  The bar's corner cell: the panel toggle and the logo, as
                  wide as the panel below it. Shared by both shells
  notifications-menu.tsx  The bar's bell, a popover holding an empty state.
                  Shared by both shells
  save-button.tsx The one Save control on every job surface
  resume-upload.tsx Dropzone + file preview, no upload logic. Used by
                  onboarding and profile.
  account-menu.tsx  Both bars' account dropdown: a name and email header,
                  the shell's rows, then Sign Out (Sign In without
                  onSignOut). The seeker bar passes its photo-name-email
                  block as the trigger, Settings and Help as its rows, and
                  shows the header only below lg, where that block is the
                  photo alone
  ui/             Presentational primitives: badge, button, card, company-tile,
                  empty-state, fact, filter-chip (only the design kit shows
                  it today), icon-button, search-field, section,
                  section-heading, section-link, select-field, text-field,
                  text-link
  shadcn/         Vendored shadcn/ui components — generated, treat as read-only
    hooks/        Vendored hooks, same rule (components.json points here, so
                  `shadcn add` never writes a top-level src/hooks)
src/lib/          Framework-free helpers
  cn.ts           Class-name joiner — clsx + tailwind-merge
  api.ts          Server-only apiUpload (multipart, POST or PUT), apiGet,
                  apiDelete. Guarded with `import "server-only"`. Uses
                  API_URL (not NEXT_PUBLIC_*).
  session.ts      getApplicantSession() — the signed-in id + access token —
                  and getAccessToken() for any account type. Server-only, and
                  never in a "use server" file (see below)
  resume-actions.ts  Server actions for resumes: parse (saves nothing),
                  upload, list, delete, read and replace one's parsed
                  content, make one primary, and a signed file link. Used
                  by both onboarding and profile.
  avatar-actions.ts  Server actions for the profile photo: get/upload/remove
  job-actions.ts  Server actions for the company's jobs: saveJob (create, or
                  update with the updated_at it was loaded with, so a save over
                  someone else's is a 409) and changeJobStatus (pause, resume,
                  close)
  job-queries.ts  Server-only reads of the company's jobs for Server
                  Components: listCompanyJobs (pages through the API) and
                  getCompanyJob. Not actions, so not public endpoints
  avatar-rules.ts Accepted photo types and size, for the client-side check
  auth.ts         apiFetch() to the Python API (with optional Bearer token),
                  extractErrorMessage, and auth types. Server-only.
  supabase/server.ts  Per-request Supabase client — auth only, never data
public/           Static assets served from /
  workit-logo.png Full lockup, 1256x448, violet — the auth card
  workit-logo-ink.png  The same lockup in --color-ink, for the company top bar
  workit-icon-ink.png  The ink mark alone, the lockup cut at x=481
  workit-wordmark-ink.png  The ink "WorkIt" alone, cropped to its letters.
                  The two make <LogoLockup> in logo.tsx, the seeker shell's
                  logo, which sets the word at ~55% of the mark's height
                  (the drawn lockup has it at 40%, which read as too small)
  workit-icon.png Mark only, 481x448 — favicon source only
scripts/          Frontend maintenance scripts — plain Node, never shell
docs/             Prose docs for the team
  shadcn.md       What shadcn is, how it is wired here, how to pull components
components.json   shadcn config — see docs/shadcn.md before changing its aliases
```

Anything shared by more than one route lives in `src/components`; anything used
by exactly one route stays beside it (`company/placeholder.tsx`, the per-route
`icons.tsx` files). Promote on the second consumer, not in anticipation of one —
the app shell's avatar and account menu (and a top-bar nav link, deleted once
both shells moved to a left panel) went to `src/components` the
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

The two shells are separate layouts on purpose, and they no longer look
alike. The seeker shell floats: the section panel runs the full height with
the logo in its header, beside a top bar and the page, each a white
`rounded-shell` panel on the lavender `--color-frame`, 12px apart and 12px
from the window. The company shell is still docked: a full-width bar with the
lavender corner cell (`components/sidebar-brand.tsx`, company only now) over
a full-bleed panel. `app-sidebar.tsx` draws both, as `variant="floating"` or
the default `docked`. Their other shared parts (the bell, the account menu,
the search field) are in `src/components`, and what is left is each bar's
search target and copy. Each bar's search is a GET `next/form`
to its own results page: `/search` for a seeker, `/company/applicants` for a
company. The seeker field is `(seeker)/search/query-field.tsx`, a client
component that shows `?q` while on /search and empties elsewhere, because a
layout never receives searchParams. Lift a `<TopBar>` out only if they are
still near-identical once both sides are real screens.

Seeker pages break on the width they actually get, not the window's: the shell
makes its page panel `@container/main`, because an open panel takes 280px
with its insets. A
layout that splits into columns uses `@3xl/main:` and friends, and a card that
rearranges itself (the job card) is its own `@container`. Pages render a
`<div>`, not a `<main>` — shadcn's `SidebarInset` already is the `<main>`.

The seeker bar shows the signed-in account's real photo, with the full name
and email beside it from lg, at 40px like the bar's grey-filled round
bell and search controls (`(seeker)/bar.ts`); it reads `getCurrentAccount()` in
`lib/session.ts`, cached per render. The whole block is the trigger of
`components/account-menu.tsx`, passed in as its `children`, and opens
Settings, Help and Sign Out (with the account header only below lg, where the
block shows just the photo). From xl the
bar adds a pill for roles posted in the last 24 hours when there are any
(`(seeker)/status.ts`).
The greeting is the Dashboard's heading, and the resume nudge is the profile
strength card at the panel's foot (`(seeker)/profile-strength.tsx`), which
counts only steps the API can see. Only messages backed by real data belong in
the bar — deadlines go first once the tracker has a backend, and not before.
The seeker panel holds only the search (Dashboard, Jobs, Applications, My
Profile), with no caption over it. Settings, Help and Sign Out, once its General
group, live in the bar's account menu and nowhere else. The
seeker layout redirects to /login when `getSessionUser()` finds no session,
so the shell never draws a signed-out state and the bar's account block is
always filled (from the session's email if /auth/me is down). The company panel keeps
Settings alone in its footer, and its account menu holds only the account
header and Sign Out. The company bar's Sign Out
is real, but its name is still hard-coded in `company/layout.tsx`.

`components/stat-tile.tsx` is shared by both dashboards, and both use its
`plain` variant; its card form has no caller today. The seeker Dashboard gives
each kind of content its own surface instead of a white card each: the numbers
open under the greeting, one violet Next Up hero (the only solid colour), open
sections for Activity and the lists. There is no pipeline section: its
funnel only restated the headline numbers. Fixtures are in
`(seeker)/dashboard/data.ts` until the tracker is real. Its range is
`?range=`, links rather than client state.

The company Dashboard and the seeker Profile follow the same surfaces. On
/company: open KPI tiles beside one violet Most Urgent hero, open sections for
the chart, Highlights and Needs Your Attention, a grey Hiring Pipeline band
with no cards inside it, and one white card, the Recent Applicants table. On
/profile: an open identity band, Resume as the only card, and open sections
for Work Experience, Skills and Application Settings. Both heroes draw
`components/hero-arcs.tsx`. An open section's one way onward sits at the top
right of its heading: `ui/section-link.tsx` for a link, `<Button
variant="section">` for an action. Keep it that way: a page of identical boxes
has no first place to look. Each page's docblock says what goes where.

Each stage has one colour and one icon, `(seeker)/stage-colors.ts`, read by
the Dashboard's Up Next and the Applications board, grid and list alike; on the board
the stage tints the column panel, never the cards inside it. The three views
also say the same thing about an application: each shows its next step
through `(seeker)/applications/next-step.tsx` ("Nothing scheduled" when
there is none). There is no progress bar; it only restated the stage.

A match score has its own colour and never borrows a stage's. The four
`--color-match-*` tokens in `globals.css` are one magenta ramp, deeper for a
better match, read only through `matchColor()` in `lib/match.ts`: the board's
match badge, the job page's match rail and the company Dashboard's match bar.
They paint strokes, dots and bars, never text; the tier words stay ink-muted.
Stages and statuses own violet, blue, amber, green, grey and red, so a new
score display takes `matchColor()` and a new stage display takes its stage
map, never the other's.

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

Its stock text sizes are bound the same way: `text-xs` is `--text-note` and
`text-sm` is `--text-body`, so a menu row or a select option is body type by
construction and moves when the scale does. WorkIt's own code still writes the
token names, never `text-sm`. Where a vendored piece draws something the scale
has no token for, the call site sets the token, since the file is not ours to
edit: a `DialogTitle` or `SheetTitle` takes `text-subtitle font-semibold`
(stock is 16px medium, a pairing nothing else uses), and a `Calendar` takes
`[&_.rdp-weekday]:text-note` for its 12.8px weekday row. `text-base` stays
unbound on purpose: it is the 16px that keeps iOS from zooming into the text
and search fields below sm. `/design-kit/type` shows what each stock size
resolves to.

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
When the backend lands, that is the seam it plugs into — unless a client
component imports that `data.ts`. The server-only API helpers cannot go there
without breaking the build, so the fetch gets its own sibling marked
`import "server-only"`. The Jobs feed is the first case: `(seeker)/jobs/listings.ts`
fetches `GET /jobs` for /jobs, /search and the Dashboard's New Matches, and
its `data.ts` still holds the fixtures `filters.tsx` (client) and the
`/jobs/[jobId]` detail view use. A live role cannot open at `/jobs/[jobId]`
yet: its id is the employer's apply URL and the detail view reads fixtures
only, so its card's Apply Now goes to the employer's posting instead.
A live card still has the full shape of a fixture card: every `job_postings`
fact the scraper cannot give (job type, salary, years) is passed as
`NOT_LISTED` from `components/job-posting-card.tsx` and drawn as its icon with
"Salary not listed" in italic, and the match rail is its placeholder
(`score={null}`: an empty ring and "Score Coming Soon") until matching
exists. Null still means a fact the posting has none of, and is left out. A live fetch in a page calls
`await connection()` so `next build` does not prerender it with no API running.

Tailwind v4 is configured entirely in `src/app/globals.css` via `@theme static`
— there is no `tailwind.config.js`. Add design tokens there. The file also
records two open questions for whoever owns the mockups: the login and app
screens disagree about which hex is a page and which is a card, and the board's
grey "Applied" chip may or may not be a second chip token.

**This app does not talk to the database.** There is no ORM, no connection
pool, no schema and no migrations here — that is the Python API's job, and it
owns the connection string. A query belongs in an endpoint, and a `page.tsx`
reaches it through that screen's `data.ts`.

**Auth is Supabase Auth, wired up for applicants and company owners.** Supabase Auth
issues and refreshes the session; the Python API verifies the access token
and owns authorization. `backend/CLAUDE.md`'s Auth section owns the flow and
its rules — **read it before touching auth or adding an API call.** The Next
side:

- `login/actions.ts` calls `supabase.auth.signInWithPassword()`, then
  `GET /auth/me` with the new access token to learn the account type and
  onboarding state, and redirects off that: an applicant to
  `/onboarding/applicant` until onboarded and `/dashboard` after, a company
  account always to `/company`. **Skipped for now (KAN-141):** the applicant
  onboarding check is commented out in both `login/actions.ts` and
  `signup/actions.ts`. A new applicant (signup, or a first Google/LinkedIn
  sign-in through `/signup/choose-account-type`) goes straight to `/profile`
  in onboarding's place; a returning one (login, or a returning OAuth sign-in
  in `auth/callback/route.ts`) lands on `/dashboard`, the seeker's home. The
  API still reports `onboarding_completed` and the onboarding screen still
  works by URL; uncomment those blocks to turn it back on. Companies skip the onboarding check because
  nothing sets their `onboarding_completed_at` yet, so it would send every
  company login to the `/onboarding/company` stub — restore it when company
  onboarding is built. If the account type doesn't match the tab the user
  signed in on, it signs out again and shows the wrong-password message.
- `signup/actions.ts` calls `POST /auth/signup` — **not**
  `supabase.auth.signUp()`, which can only write `user_metadata`, a field the
  user can edit, so it cannot be trusted with the account type — and then
  signs in. The Company tab opens on Create Company; Join a Company is shown
  disabled with a Soon badge until it has a form (`signup/signup-form.tsx`).
  Create Company sends the owner's fields plus a
  nested `company` object (name, websiteUrl, contactEmail, contactPhone,
  sizeRange — a `company_size_range` value from `backend/app/models/dto.py`),
  sent only when `accountType` is `company`. The API creates the company and
  the owner's membership, and the action then redirects an applicant to
  onboarding and a company to `/company`. Join a Company has no form yet.
- **A key the API's Pydantic schema doesn't declare is dropped silently**
  (the default `extra="ignore"`), not rejected. A field added to a request
  body here does nothing until `backend/app/schemas/` declares it too.
- `src/proxy.ts` refreshes the session on every request. @supabase/ssr
  requires it: Server Components cannot write cookies, so without it sessions
  die when the hour-long access token does. It does nothing when the Supabase
  variables are unset, which keeps a clone with no env file booting.
- **Google and LinkedIn sign-in** go through Supabase's native OAuth
  providers (`google`, `linkedin_oidc` — backend/CLAUDE.md's Auth section has
  the dashboard setup). `src/lib/oauth-actions.ts`'s `signInWithOAuth` server
  action, bound to each provider, backs the Google/LinkedIn buttons on both
  `/login` and `/signup` (one shared row, `components/auth-alternatives.tsx`,
  so the two cards cannot drift apart); it calls Supabase's own `signInWithOAuth()` with
  `skipBrowserRedirect: true` and redirects to the URL it returns, since a
  Server Action can't navigate the browser itself. The provider sends the
  browser back to `src/app/auth/callback/route.ts`, which exchanges the code
  for a session, then calls `GET /auth/oauth/status`: Supabase creates
  `auth.users` itself for an OAuth sign-in, bypassing `POST /auth/signup`
  entirely, so a first-time sign-in has no `account_type` and no profile row
  yet. That sends it to `/signup/choose-account-type` — the same
  `AccountTypeSwitcher` as `/login` and `/signup`, plus `CompanyFields`
  (promoted out of `signup-form.tsx`, its second consumer) when the choice is
  Company — whose `actions.ts` calls `POST /auth/oauth/account-type` and then
  `supabase.auth.refreshSession()`, because the access token already in hand
  was issued before that endpoint set `account_type` and won't carry it until
  refreshed. An already-completed identity gets `needs_account_type: false`
  and goes straight to the same destination a password sign-in would.
  **The Google button sends `queryParams: { prompt: "select_account" }`.**
  Without it, a Google account Google itself rejects (unverified app,
  not a test user — decided entirely on Google's side, before any redirect
  back here) looks stuck on retry: Google silently reuses the browser's
  last-picked account and shows the same "Access blocked" page again. The
  prompt forces the account chooser open every attempt, so a blocked try can
  retry with a different account instead of repeating the same dead end.
  LinkedIn's OIDC prompt support isn't the same, so this stays Google-only.

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

**Resume upload is wired.** The onboarding form (`onboarding/applicant`)
uploads on Continue, unreviewed. The seeker profile (`(seeker)/profile`)
supports up to 5 resumes, newest first: on file select it calls
`parseResume` (nothing saved), opens `resume-edit-dialog.tsx` on every
section of the result, and only Save calls `uploadResume` with the file plus
the edited `parsed_json`; Cancel discards it. When nothing was read and
nothing typed, Save leaves `parsed_json` out, so the API parses the file
itself and marks it `parse_failed` rather than "parsed". That dialog is a
panel sliding in from the right over a darkened page, built from the
vendored dialog's parts because the vendored Sheet's 10% overlay cannot be
darkened from outside. A click on the darkened page does not close it — that
would throw away every unsaved edit — but › and Escape do. Each resume row (`resume-row.tsx`) has an eye — a short-lived signed
link from `getResumeFileUrl`: a PDF opens in a new tab, opened inside the
click so it is not blocked as a popup (if it is blocked anyway, the page says
so rather than leaving the profile); a DOCX downloads — and a star that
makes it primary (`setPrimaryResume`). All of these actions live in
`src/lib/resume-actions.ts`, whose `ParsedResume` type mirrors the API's.
The `ResumeUpload` component (`src/components/resume-upload.tsx`) is a pure
dropzone + file preview — it knows nothing about upload logic or limits.

**The profile's Work Experience and Skills come from the primary resume's
`parsed_json`** (`getParsedResume`), or the newest one's when none is primary —
`shownResume` in `page.tsx`. Work Experience's Edit opens
`resume-edit-dialog.tsx` on that one section, so all roles are edited in one
modal; each skill opens `entry-dialog.tsx`, which reuses the same field
table. Every save PUTs the whole `ParsedResume` back (`updateParsedResume`).
Collapsed, Work Experience previews the first two roles with descriptions cut
to two lines, and one chevron in its heading expands the whole section. The
chevron appears only when the preview hides something; whether a description
overflows depends on the column's width, so `resume-sections.tsx` measures it
with a ResizeObserver. The one-section edit modal numbers its entries
("Experience 1", …) since it has no section headings to go by.
Deleting the resume the sections show switches them to whichever `shownResume`
picks next.

**The sections' editors stay shut while the shown resume switches.** Every
editor saves onto whichever resume is shown, so from a star or delete click
until the sections have moved to the next resume (`switching` and
`profileLoading` in `page.tsx`), Edit, Add and the skill chips are disabled.
An editor left open across a switch saved one resume's roles over another's.
A switch the page did not start — a background refresh, after another tab
changed the primary — can still land under an editor already open, so both
sections are keyed by the shown resume's id: the switch remounts them, which
closes that editor. If a switch's content fails to load, the sections are
cleared rather than left on the outgoing resume, which after a delete no
longer exists; with resumes still listed they say the content didn't load,
not "Upload a resume".

**My Profile is cached for the life of the seeker shell.**
`(seeker)/profile-cache.tsx` keeps the page's last state (resumes, the shown
resume's content, the photo URL) in a provider in `(seeker)/layout.tsx`. A
return visit renders it at once and refetches in the background. Only
settled state is saved: not mid-load, not while a photo upload's `blob:`
preview is on screen (that URL is revoked once the upload ends), and not
after a failed load. It lives in the layout, not a module variable, because
sign-out redirects to `/login`, outside the shell, and that unmount is what
drops it — a module variable would show one account's resumes to the next
person to sign in in that tab.

**Profile photo upload is wired** on the seeker profile. The pencil button
opens a file picker restricted to JPEG/PNG/WebP; the file is checked against
`avatar-rules.ts`, previewed immediately, and sent through `uploadAvatar`,
rolling back on failure. The API re-encodes it to a 512px WebP and returns a
signed URL valid for an hour — so it is fetched per page load, never stored.
`backend/db/avatar.md` owns the formats, limits and why. The seeker bar
fetches it per render (`(seeker)/account-status.tsx`); the company bar still
shows initials.

**The upload limit is in three places that must agree:** the API's
`MAX_UPLOAD_BYTES`, `MAX_AVATAR_BYTES` here, and `serverActions.bodySizeLimit`
in `next.config.ts`, which must stay above 5 MB plus multipart overhead or
Next rejects the request with a generic error before the action runs. Resumes
share the same 5 MB / `6mb` pair.

**Never export a token-returning helper from a `"use server"` file.** Every
export of one becomes an endpoint the browser can call, so exporting
`getApplicantSession` from `resume-actions.ts` would hand any page script the
access token. Helpers like it live in `server-only` modules (`session.ts`)
and are imported by the action files. The same goes for reads only Server
Components call: they live in a `server-only` module (`job-queries.ts`), not
beside the mutations, so they never become endpoints either.

**A saved timestamp becomes a calendar day in the browser, never on the
server.** The server runs in UTC, so a closing date or a Posted day computed
there is a day off for anyone in the Americas. The job composer builds its
form from the raw job in a `useState` initializer, and the jobs table's Posted
cell swaps in the local day after hydration with `useSyncExternalStore`.
`formatDate` in `lib/format-date.ts` formats in UTC on purpose and is only
right for date-only strings.

`@/*` maps to `src/*` — that is `frontend/src`, resolved by
`frontend/tsconfig.json`. It does not reach outside this folder.

## Conventions

**Copy is Title Case, with named exceptions.** Title Case for page titles;
section, card and dialog headings; empty-state titles; buttons and links that
act as actions; menu items; tabs and segments; filter and field labels and
their options; column headers; badges, pills and stage names; and an
accessible name with no visible text (a landmark, a group, a hidden field
label). Sentence case only for helper text, descriptions and subtitles,
tooltips (so an icon button's label, which is its tooltip, too),
placeholders, empty-state body copy, error and validation messages, and a
measured value or annotation outside a badge ("Over 7 days", "vs last week").
Fixture data (job titles, companies, people) stays as written. A label that
doubles as a value, like the composer's "Full-Time", moves together with
every comparison against it, never on its own.

Prettier owns formatting for code. It runs from this folder, so it never sees
the repo root's `CLAUDE.md` or `README.md`; `.prettierignore` here excludes
`frontend/CLAUDE.md` and `frontend/AGENTS.md`.

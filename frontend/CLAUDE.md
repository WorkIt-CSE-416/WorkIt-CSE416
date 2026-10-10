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
src/react-canary.d.ts  Loads React's canary types (<ViewTransition>,
                  addTransitionType): the App Router runs React canary, and
                  @types/react's stable entry does not declare them
src/app/          App Router routes, layouts, pages
  layout.tsx      Root layout — Geist fonts, metadata, <html>/<body> shell
  page.tsx        Route "/"
  globals.css     Tailwind entry (`@import "tailwindcss"`) + @theme tokens
  (seeker)/       Job-seeker shell, three white rounded panels (the section
                  panel, the top bar, the page) floating on --color-frame,
                  and every screen behind it.
                  /dashboard is the seeker's home: sign-in lands there.
                  /jobs and /search take ?location= (repeated ISO codes,
                  US or US-CA), ?workplace=, ?experience= and ?posted=
                  (option values from jobs/data.ts, never labels), passed
                  straight on to GET /jobs. readFilters in
                  jobs/listings.ts drops anything the API would 422 on
                  (places past 60 too), so a bad link narrows less
                  instead of reading as an outage whose Try Again repeats
                  it; a new filter param goes through it. Location,
                  Workplace, Experience and Date Posted filter; Job Type
                  and Salary are still inert, and Industry was removed
                  until jobs carry one. The Location facet in
                  jobs/filters.tsx is fed by GET /jobs/locations.
                  A Popover of two panels, not a Select: countries left,
                  the ticked country's states right. A country alone is
                  all of it, with states ticked just those
                  (ticksFrom/placesFrom there). Don't move it back into a
                  Select with rows that come and go: a multiple Select
                  whose item list shrinks (Base UI 1.7) re-applies the
                  value from before the press, which undid the untick
                  /search narrows the live /jobs feed to roles whose title
                  or company contains ?q, and draws them with
                  jobs/listing-card.tsx, the feed's own card, skeleton and
                  error state, so a role looks the same on both pages.
                  /applications is the tracker: a board, grid and list over
                  the fixture in applications/data.ts, every choice in the
                  URL (applications/query.ts), ?app= opening one application
                  in the detail panel. tracker.ts is the tracker's shape and
                  date logic; local-time.tsx prints its dates in the
                  viewer's own zone and links them to the Calendar.
                  /calendar puts the same entries on a Month, Week or
                  Agenda (calendar/), rendered in the browser.
                  template.tsx wraps each section's page in the page
                  transition (Motion, below); company/ has its own
  api/scout/      The one route handler: forwards a Scout turn to the API with
                  the session's token and pipes the NDJSON reply back. A route
                  handler, not an action, because the reply streams
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
  shallow-routing.tsx  Changes a page's query in place: <ShallowRouting>
                  (wrapping the seeker pages in (seeker)/layout.tsx) holds
                  the query the page shows, useShallowParams reads it, and
                  <ShallowLink> and SegmentedLinks' `shallow` move it. See
                  Motion, below
  resume-upload.tsx Dropzone + file preview, no upload logic. Used by
                  onboarding and profile.
  account-menu.tsx  Both bars' account dropdown: a name and email header,
                  the shell's rows, then Sign Out (Sign In without
                  onSignOut). The seeker bar passes its photo-name-email
                  block as the trigger, Settings and Help as its rows, and
                  shows the header only below lg, where that block is the
                  photo alone
  scout/          Scout, the job assistant. scout-store holds the one chat per
                  tab (a module store, so no provider); scout-panel docks
                  beside the page, never over it, and opens only on a click.
                  It stays mounted and opens in two moves: its room appears
                  at once and the page settles into its new width, while the
                  panel slides in from the window's edge; Escape or its X
                  closes it and hands
                  focus back to the bar's launcher, which shows pressed while
                  the panel is open;
                  stream.ts mirrors the API's NDJSON events; reply-text
                  renders a reply's **bold** and "- " bullets, the prompt's
                  whole formatting vocabulary, with no markdown library (a
                  reply stays escaped text otherwise). The brain is the
                  repo's scout/ — read its CLAUDE.md first.
  ui/             Presentational primitives: animated-number, badge, button,
                  card, company-tile, empty-state, fact, filter-chip (only
                  the design kit shows it today), icon-button, search-field,
                  section, section-heading, section-link, segmented-control,
                  select-field, text-field, text-link
  shadcn/         Vendored shadcn/ui components — generated, treat as read-only
    hooks/        Vendored hooks, same rule (components.json points here, so
                  `shadcn add` never writes a top-level src/hooks)
src/lib/          Framework-free helpers
  cn.ts           Class-name joiner — clsx + tailwind-merge
  format-count.ts formatCount() for a headline figure ("1,234", "12.3K"),
                  in en-US so the server and the browser print the same
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
  profile-actions.ts Server actions for the applicant's identity fields:
                  getProfile (GET) and updateProfile (PATCH). Used by the
                  seeker profile page and cached alongside resumes and avatar
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
  supabase/cookies.ts  sessionCookieOptions(): httpOnly, 7-day sb-* cookies.
                  Both cookie writers (server.ts, src/proxy.ts) go through it
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

Seeker pages break on the width they actually get, not the window's: the
shell renders them inside `@container/main`, because an open panel takes
280px with its insets. **That width is the one they have with the panel
open, in both states**: collapsing the panel re-centres the page in the room
it frees and never rearranges it (`(seeker)/layout.tsx`, "A PAGE KEEPS THE
WIDTH"). Keyed to the `<main>` itself, collapsing between about 800 and
1300px moved the Dashboard from one column to two and its range switch from
the page's right edge to its middle, wrapped the Calendar's view switch, and
turned the Week into seven columns. The container is `--panel-gain`
narrower than the `<main>`, a registered length that eases over the panel's
own 200ms linear, so the page holds its width through the animation; keep
the two durations equal. A layout that splits into columns uses
`@3xl/main:` and friends, a card that rearranges itself (the job card) is
its own `@container`, and both see the same width whether the panel is open
or not. On Applications and the Calendar the segmented control sits at the
top right of the header wherever it fits beside the title, the title
wrapping first; the Dashboard's range switch sits at the top right of its
first column and wraps under the greeting where that column is narrow.
Pages render a
`<div>`, not a `<main>` — shadcn's `SidebarInset` already is the `<main>`.

The seeker bar shows the signed-in account's real photo, with the full name
and email beside it from lg, at 40px like the bar's grey-filled round
bell and search controls (`(seeker)/bar.ts`); it reads `getCurrentAccount()` in
`lib/session.ts`, cached per render. The whole block is the trigger of
`components/account-menu.tsx`, passed in as its `children`, and opens
Settings, Help and Sign Out (with the account header only below lg, where the
block shows just the photo). A "N New Roles Since Yesterday" pill used to sit
beside it from xl; it was removed as a distraction, along with the
`/jobs?limit=500` fetch it made on every page.
The greeting is the Dashboard's heading, and the resume nudge is the profile
strength card at the panel's foot (`(seeker)/profile-strength.tsx`), which
counts only steps the API can see. Only messages backed by real data belong in
the bar — deadlines go first once the tracker has a backend, and not before.
The seeker panel holds only the search (Dashboard, Jobs, Applications,
Calendar, My Profile), with no caption over it. Settings, Help and Sign Out, once its General
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
`(seeker)/dashboard/data.ts` until the tracker is real, except Next Up and Up
Next, which take the tracker fixture's upcoming events (`getUpNext`). Next
Up's arrow opens that application's detail panel and its date that week on
the Calendar; an Up Next row opens its day in the Calendar's Agenda, and View
All the Agenda; Waiting's Follow Up opens the Applications list filtered to
Applied. The stat tiles do not link: their figures are a separate fixture
from the tracker's twelve applications, so a tile would open a list that
disagrees with its number. Its range is `?range=`, moved in place: the
headline (`dashboard/headline.tsx`) is handed every range's figures and reads
`?range=` itself (`useRange` in `range-switch.tsx`), so a new range counts
its numbers with the switch's thumb instead of after the server draws the
page again. The streak always shows the full year regardless of range.

**Activity is a daily streak** (`(seeker)/dashboard/streak.tsx`), no longer
a weekly pace chart: the past year of applications per day as a heat map that
folds into a 3D skyline, adapted from 21st.dev's Contribution Skyline. Its
heading is Activity; its files and tokens say streak. `streak-model.ts`
is its pure maths (grid, levels, stats, camera), `streak-canvas.ts` the
canvas engine (no React: the section mounts it once and it re-reads a ref
every frame), `streak.tsx` the section. It stays beside the Dashboard rather
than in `components/ui` until a second route wants it. The canvas reads its
colours off the section at mount: `--color-streak-1..4`, a violet ramp
validated as ordinal in `globals.css`, and `--color-border-subtle` for an
empty day, so a token edit restyles it. The current streak runs to the
viewer's today (yesterday while today is open), so `today` comes from
`useSyncExternalStore`: UTC on the server, the browser's own after hydration.
It ignores `?range=`, since a streak is every day. Its fixture is
`appliedDays()` in `data.ts`, seeded and walked from a fixed epoch so a date
keeps its count; the tracker swaps in one `{ date: appliedOn, count: 1 }` per
sent application.

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
the Dashboard's Up Next, the Applications board, grid, list and detail panel,
and the Calendar alike; on the board the stage tints the column panel, never the cards
inside it. A dated entry wears one stage by its kind (`KIND_STAGE` there): an
interview is Interviewing's amber, an offer Offer's green, a deadline Saved's
grey, the applied date and a follow-up Applied's violet. The three views also
say the same thing about an application: each shows its next step through
`(seeker)/applications/next-step.tsx` ("Nothing scheduled" when there is
none). There is no progress bar; it only restated the stage.

**Application dates are real dates.** The tracker fixture
(`(seeker)/applications/data.ts`) dates every application against the
request (`getApplications` and `getNow`, both `cache()`d), on a New York
clock, so the sample search is always mid-flight; a timed event that lands on
a weekend moves to the Monday after. The shape is `(seeker)/tracker.ts`, and
it is what the tracker's backend should return: an ISO instant for something
at a time, a bare ISO date for something due on a day. The server decides
what is upcoming against `getNow()` (a day-only entry stays upcoming until
its day has ended in UTC-12) but never which day an instant falls on: it
prints the UTC date, and `<When>` in `(seeker)/local-time.tsx` swaps in the
viewer's own "Tomorrow, 2:00 PM" after hydration.

**The Applications page keeps every choice in its URL** (`applications/query.ts`):
`?view=`, `?stage=` (a comma list), `?q=`, the list's `?sort=` and `?app=`,
the application open in the detail panel. Links and a GET form, not client
state, so every view stays a server component and the Dashboard can link to a
filtered list or one application. The layout is the exception in how it
moves, not in where it lives: the page renders all three layouts, each
building its links for itself, `applications/view-panes.tsx` shows the one
the URL names, and the switcher moves `?view=` in place. Anything else that
builds a link from the layout (the filter bar, Clear Filters) reads it in the
browser through `useApplicationsQuery`, since a layout switch never asks the
server to draw them again. A card or row is one link: its role, stretched
over it. Its next step is a second, `relative` link to that week on
the Calendar, which paints over the stretched one.

**Every choice of one among a few is `ui/segmented-control.tsx`**: the
Calendar's Month, Week and Agenda, the Dashboard's range, the Applications
layouts, the sign-in card's Applicant or Company, and the company chart's
range. A pill-shaped track (a 5% ink wash, so it reads on the white page and
the off-white auth card alike, and no outline) with a white thumb that slides
to the chosen option on the 300ms glide (Motion, below), and jumps under
reduced motion. The options are equal width, so the thumb is placed with CSS
alone and the server renders it in place. `SegmentedLinks` is for a choice
kept in the URL: the thumb moves on the click, before anything else answers.
Every caller today passes `shallow`, which moves the query in place
(`components/shallow-routing.tsx`) for content the page already holds, so
the content redraws with the thumb; without it, the page goes back to the
server and the content follows a round trip later. `SegmentedToggle` is for component state, on Base UI's
ToggleGroup for its arrow keys and single tab stop; a null value hides the
thumb. An icon option is a rendered element, not a component, since a server
page passes the options. Build a new segmented choice from it rather than
styling a ToggleGroup by hand.

**The Calendar** (`(seeker)/calendar/`) shows every dated entry: the day each
application went in, interviews, offers and their deadlines, closing dates
and follow-ups, in their kind's stage colour, with a legend. `?view=` picks
Month, Week or Agenda (two weeks), `?date=` anchors it on a bare day, and
`?app=` opens the same detail panel Applications does, with a way across.
Without `?date=` it opens on the viewer's today, which the server cannot
know, so the views render in the browser behind a placeholder
(`calendar-view.tsx`, `useHydrated`). They read the view and the day from
the page's query themselves (`useCalendarQuery` in `view-switch.tsx`), and
the view switch, the arrows, Today and a day's number move it in place; an
entry is a real link, since its panel is drawn on the server. Its layout follows a reference the team
picked: the span's title at the top left with round grey arrows at the top
right, small uppercase weekday names, each day a light grey rounded tile with
gaps rather than a ruled grid, today's tile white and outlined in the brand,
and the legend at the foot. Week days and Agenda entries are the same tiles,
and Today is a grey pill just left of the arrows, in their fill, so the three
read as one group.
It sits open on the page, not in a card: the page panel is already white.
Month chips name the company and carry no time, since the colour already says
what kind of entry it is; Week and Agenda name both. A
link into the Calendar from anywhere else goes through `DayLink` in
`(seeker)/local-time.tsx`, which picks the viewer's local day the way
`<When>` picks their words.

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
A live card still has the full shape of a fixture card: its facts are two
fixed rows of three (location, job type, salary; then work style, level,
and start or years), each value in ink beside a grey glyph, so each fact sits in the same column on every card
(KAN-157). Every `job_postings` fact the posting does not state (the scraper
fills job type, salary and years when it does) is passed as `NOT_LISTED`
from `components/job-posting-card.tsx` and leaves its slot empty; a screen
reader still hears "Salary not listed". The slots used to print that in
italic, and over half the feed's cards had at least one. Under 448px of card
body the empty slots close up instead. The title stops at two lines and a
fact at its column's edge, each whole on hover. An internship shows when it
starts in place of years (the card's `startTerm` fact: "Start in Summer
2027"), and its job type always reads "Internship", as Jobright shows it. Scraped pay
always arrives as a min/max range, and `formatSalary` prints one whose ends
meet as a single amount. The match rail is its placeholder
(`score={null}`: an empty ring and "Score Coming Soon") until matching
exists. Null still means a fact the posting has none of: its slot is empty
too, with nothing for a screen reader. A live fetch in a page calls
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
`sb-*` cookies, on this origin. They are **httpOnly and live 7 days**
(`lib/supabase/cookies.ts`, since 2026-10-08; the @supabase/ssr default is
readable by page scripts and 400 days). The 7 days count from the last
token refresh, so they are an idle limit, not a cap on how long a session
lasts; a hard cap is Supabase's session time-box (dashboard → Authentication
→ Sessions). Set `maxAge` in that helper's `setAll` path, never through
`createServerClient`'s `cookieOptions`: @supabase/ssr 0.12 overwrites that
maxAge with its own default. httpOnly holds only while no
`createBrowserClient()` exists; adding one means turning it off.
Server code reads the access token from the session and passes it to `apiFetch()` as a Bearer header — the API never sees
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
resume's content, the photo URL, the applicant profile fields) in a provider
in `(seeker)/layout.tsx`. A
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

## Motion

Everything that moves speaks one language, defined in `globals.css` (the
Motion block in `@theme`, and the view-transition rules after it) and shown
moving at `/design-kit/motion`. The rules:

- **Three curves, picked by role.** `--ease-glide` for what travels and
  settles (a thumb, a highlight, a card lifting, a page arriving),
  `--ease-spring` for what pops into place (a chip's cross, a badge, never
  anything that travels far), `--ease-exit` for what leaves. Durations go by
  role too: 150ms for a press or a colour, 200ms for a hover fill or a nudge,
  about 250ms for content arriving, 300 to 320ms for a glide. An exit is
  always shorter than the entrance after it, so the old thing is gone before
  the new one asks to be looked at.
- **Every control answers the pointer.** A button presses to 98%, an icon
  button or a calendar arrow to 90%, a segment to 96%, and a card that is one
  whole target lifts 2px onto `--shadow-lift` and settles on the press. The
  presses live in `ui/button.tsx`, `ui/icon-button.tsx` and
  `ui/segmented-control.tsx`, so a new control gets one by using them. A
  colour change eases rather than snaps, an underline fades in
  (`decoration-transparent` to `decoration-current`) rather than appearing,
  and an arrow leans 2px the way its link goes while the link is hovered.
- **Content arrives, staggered and capped.** A list rises in
  (`animate-rise`; a table row takes `animate-fade`, since browsers do not
  reliably paint a row's transform) with an `animation-delay` per item,
  capped at the sixth to tenth item so a long list never keeps anyone
  waiting. Only arrival animates. A figure that changes in place counts to
  its new value (`ui/animated-number.tsx`, which never counts up on load),
  and a line of words fades in again, keyed on what it says.
- **The left panel's highlights glide.** Each menu in
  `components/app-sidebar.tsx` draws one hover fill and one current fill
  behind its rows and moves them by row index, with nothing measured, so
  pointing down the panel slides one fill instead of blinking a fill per row.
  GlideMenu there has the details.
- **Pages and views change through React's `<ViewTransition>`**, which Next
  16 runs on every navigation with no config. `(seeker)/template.tsx` and
  `company/template.tsx` wrap each section's page. A template remounts when
  the section changes but not when only the query does, so moving between
  sections is an exit and an enter (`page-exit`, `page-enter`) while a filter
  or `?app=` is not. Inside a page, the Applications results are keyed on
  their shape (the view, the board's columns, or nothing matching) and swap
  (`swap-enter`, `swap-exit`); within one shape each card or row is keyed by
  its application (`applications/reflow.tsx`) and glides to its new place
  when the list is sorted or filtered (`reflow`). The Calendar keys its
  title and view on the span, and its arrows and Today tag their moves
  `nav-back` or `nav-forward` (`<ShallowLink transitionType>`, which does what
  `<Link transitionTypes>` does for a real navigation), so the span slides
  the way time went (`step-back`, `step-forward`). Every `<ViewTransition>` here sets
  `default="none"`, so it animates only for the change it names.
- **A choice the page can already draw never waits on the server.** The
  Dashboard's range, the Applications layout and the Calendar's view and
  span move the query in place (`components/shallow-routing.tsx`): the
  content holds every option and reads the query itself, so it redraws in
  the next frame, where a link to the server made it trail the segmented
  control's thumb by a round trip. The shown query is held in
  `<ShallowRouting>`'s state and set inside a transition, and the address
  bar follows once that has drawn. It cannot be read straight from
  `useSearchParams` after a bare `history.pushState`: Next applies that URL
  in a microtask after the caller's transition has ended (its router
  reducer is async), so the redraw is an ordinary update and no
  `<ViewTransition>` runs. Anything that depends on the server (a filter,
  the list's sort, `?app=`) stays a real link.
- **The root's own crossfade is off** (`::view-transition-old(root)` is
  hidden). Everything outside a `<ViewTransition>` then updates live, which
  is what lets the sidebar's fill glide beside a changing page instead of
  ghosting at both rows. The overlay lets clicks through.
- **The detail panel slides out before it navigates.** Closing shuts the
  sheet locally and drops `?app=` in `onOpenChangeComplete`, since the
  navigation unmounts it; `applications/detail-panel.tsx` says why it
  remembers the object it closed on rather than the id.
- **Reduced motion is one rule**, at the foot of the motion CSS: every
  animation, transition and view transition completes at once (1ms, not 0,
  so Base UI's dialogs still hear an animation end). Do not add
  `motion-reduce:` per component; the rule already covers it.
- **Chrome skips a view transition in a hidden tab**, and the browser pane
  times one out while the pane is not on screen ("Transition was aborted
  because of timeout in DOM update"). Neither is a bug. Check one in a
  visible window, or watch the `view-transition-class` React sets.
- **Scout's panel slides in; the page does not get squeezed.** It stays
  mounted, inert while closed. Opening makes its 396px of room in one step, so
  the page lays itself out once and then settles into place (a 32px glide and
  fade, `scout-page-in` in `globals.css`), while the panel slides in from the
  window's edge on transform alone (360ms). Closing gives the room back at
  once, and the panel slides out over the page's edge (200ms) as the page
  settles wider; holding the room until it had gone read as lag. Animating the panel's width instead made
  the page re-lay itself out every frame, rewrapping text and dropping a
  column partway through. Below md it rises over the window instead. Its
  messages rise in, its thinking is three looping dots (`--animate-typing`),
  and its Send stays hoverable (aria-disabled) so its tooltip can say why it
  won't send. `components/scout/scout-panel.tsx` has the details.
- **Clickable means the hand.** Tailwind v4 dropped the pointer from
  buttons, so `globals.css` restores it in one place: buttons,
  `role="button"`, tabs, switches, checkboxes, selects and the native parts
  of a field (a search field's clear cross, a date field's picker, a file
  input's button) in the base layer, and menu, select and combobox rows in
  the utilities layer, where it outranks the vendored `cursor-default`. A
  new clickable element gets the hand from that rule or by being a link;
  write `cursor-pointer` only on something that is neither, like a `<label>`
  that toggles a switch.

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

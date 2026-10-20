# CLAUDE.md — frontend

The Next.js app. Loads on top of the root `../CLAUDE.md`, which holds the
repo-wide rules (branches, cross-platform scripts, where docs go).

@AGENTS.md

## Where this folder sits

`frontend/` is the whole Next.js project and nothing above it is part of the
build: Next resolves `src/app` from the directory it runs in, so the project
root and `next.config.ts` must share a folder. The `@/` alias stops at
`frontend/src` on purpose; app code never reaches a path outside this folder,
and `backend/` is not importable from here.

Stack: Next.js 16 (App Router, Turbopack), React 19, TypeScript strict,
Tailwind CSS v4, ESLint 9, Prettier. Node 20.9+, targeting 22 LTS (root
`.nvmrc`).

## Commands

Scripts are in `package.json`; run them from `frontend/` (the root mirrors
them). Notes the scripts don't say:

- **Install with `npm ci`.** Plain `npm install` rewrites `package-lock.json`;
  use `npm install <pkg>` only when adding a dependency, and only here.
- `typecheck` runs `next typegen` first because `LayoutProps`/`PageProps` are
  generated route types that do not exist on a fresh clone; bare `tsc` fails.
- There is no test runner yet. When one is added, document it here.
- **To test a resume upload**, use a file from `frontend/public/resumes/`.
  The folder is git-ignored because it holds real people's resumes, so put
  your own there once, in the primary checkout: `npm run worktree` and every
  Superset workspace's setup copy it into the new worktree with the env files.
  Delete an upload once the test is done; it lands in the shared database.

## Deployment

Vercel project with Root Directory `frontend`; production URLs and the Vercel
CLI are in the root `CLAUDE.md`. `API_URL` points at the API project
(server-only, never `NEXT_PUBLIC_`); the other env vars are
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

- **OAuth needs each origin allow-listed in Supabase** (Authentication → URL
  Configuration → Redirect URLs): production, a wildcard for previews and
  `http://localhost:3000`, each with `/auth/callback`. `oauth-actions.ts`
  builds `redirectTo` from `x-forwarded-host`, but Supabase silently falls back
  to its Site URL for any origin not on the list.
- **Vercel refuses request bodies over 4.5 MB** before Next runs, while uploads
  are capped at 5 MB, so a 4.5–5 MB upload fails deployed with a bare 413.
  Still open.

## Architecture

- **Route groups.** Seekers and companies are different account types, not
  modes. Seeker screens sit at the root inside the `(seeker)` route group;
  company screens sit under a real `/company` prefix. A route group adds no URL
  segment, so two groups cannot both define `/profile` and both audiences need
  one; the prefix also makes the auth guard one path check. Auth screens
  (`login/`, `signup/`) and `design-kit/` sit outside both shells.
- **The business side is hidden until it ships** (KAN-239). `src/proxy.ts`
  redirects `/company` and `/onboarding/company` (and everything under them)
  to `/coming-soon`, "Waiting for Deployment", before its env check, so a
  clone with no env file is gated too. `components/account-type-switcher.tsx`
  has its toggle commented out and always submits `applicant`, so login,
  signup and choose-account-type show no Company option. The company code
  stays in place. To bring it back, delete the proxy block and
  `app/coming-soon/`, then uncomment the switcher's toggle. The API still
  accepts company signups; the gate is the UI only.
- **The page at `/` is the landing page, `app/(landing)/`**, ported from
  the team's Astro marketing site (`WorkIt-Website`, kept outside this repo)
  in place of the old Job Seeker / Hiring chooser. Its components keep the
  site's markup, classes, Inter type and copy, with two deliberate changes.
  **Colour and logo:** the site's numbered blue scale became
  `landing-brand-50` to `950` in `globals.css`, the same steps in WorkIt
  violet, so a component copied from the site needs only `brand-N` renamed
  to `landing-brand-N`. Restyling a component during that recolour was
  reverted once: the team wants the site's look unless it asks. **Layout,
  after Calendly's homepage:** every full-width band (hero, grey bands,
  footer) is a rounded panel inset from the window (`PANEL` and
  `PANEL_INSET` in `page.tsx`); the header floats as a white rounded bar
  once the page scrolls (`floating-header.tsx`); and the site's feature
  carousel and grey product placeholder became one pinned product tour
  (`product-tour.tsx`): from lg up it pins to the screen and scrolling steps
  through the four features, each with its own app colour; below lg the
  stops stack, because a pinned card with the resume animation does not fit
  a phone. The site's placeholder benefit grid and three steps became an
  expanding card row (`journey.tsx`: Find, Apply, Track, Hear back; the
  card under the pointer widens) and a hiring-system section
  (`hiring-systems.tsx`). The site's closing "Be first in line" banner is
  removed for now. **The hiring-system list in
  `data.ts` is a claim that WorkIt reads those systems**: it must match
  `scraper/workit_scraper/providers.py`'s `LISTING_URL`. Its logos come from
  the Google favicon host `next.config.ts` already allows; Workday's and
  BambooHR's are only 16px there, so they look soft on a sharp screen.
  The hero's backdrop is an animated SVG city (`city-model.ts` draws it,
  `hero-city.tsx` renders it after hydration, since server-rendered its path
  data would add hundreds of KB to the page): New York-style towers, six of
  which rise as violet wireframes with a job tag. Its heights are capped per
  column so nothing reaches the text at its 1600px design scale; it keeps
  that scale from lg up (cropped at the sides) and shrinks to the panel's
  width below lg, under the text. A change to the hero's text size or the
  buttons' width means re-checking those caps (`ceiling` in
  `city-model.ts`): the buttons once ran wider than the caps assumed and
  towers rose behind them. Its job cards show only where they fit:
  `placeCards` in `hero-city.tsx` measures each one against the panel's
  sides and the text's line boxes (`data-hero-text`, `data-hero-box` in
  `page.tsx`) on every resize, nudging a card inward or skipping it; a
  fixed breakpoint once hid them on every laptop-width window. Measure text
  runs, not elements: a block line's box spans the full width. Violet is
  the wireframes' alone; keep roofs and spires neutral. It does not use
  `ui/` components, Title Case or the type tokens; those rules are for app
  screens. Rules in `landing.css` that set `display` or a size sit in
  `@layer components`, or they beat a `hidden` or `h-12` utility on the
  same element. Its animations use `motion`
  (`motion/react`), which only this route imports; the feature animations
  expect the tour's `MotionConfig reducedMotion="user"` around them. What
  differs from the site, and why: the Applicant / Company switcher is left
  out while the business side is hidden; nav and footer link to this
  page's sections, since the site's other pages are not in the app; the
  waitlist form became a sign-up link, since its email went through the
  site's own server; every call to action goes to `/signup`, `/login` or
  `signInWithOAuth`. The testimonial and FAQ still hold the site's
  placeholder copy.
- **The Calendar, and the Dashboard's Next Up, Up Next and Waiting, are
  archived for now** (KAN-261): the tracker stores no dated events or
  follow-ups yet. `src/proxy.ts` sends `/calendar` to the Dashboard, its
  sidebar row is commented out, and all their code stays. `docs/screens.md`
  (Calendar, Seeker Dashboard) says how to bring them back.
- **The Applications board is archived** (KAN-256): the list is the
  default view, and `?view=board` opens it. `applications/board.tsx` stays;
  `docs/screens.md`, Applications, says how to bring it back.
- **Pages render a `<div>`**, not a `<main>`: shadcn's `SidebarInset` already is
  the `<main>`. Seeker pages size off `@container/main`, never the window
  (`docs/design.md`).
- **A screen's fixture data lives in a sibling `data.ts`**, so `page.tsx` is
  layout and the swap to real data touches one file. A live fetch that a
  client component's `data.ts` cannot hold gets its own sibling marked
  `import "server-only"` (`(seeker)/jobs/listings.ts` is the first). A live
  fetch in a page calls `await connection()` so `next build` does not prerender
  it with no API running.
- **The application tracker is live and has no fixture** (KAN-261): saved
  and applied jobs come from the API (`(seeker)/applications/tracked.ts`,
  cached per request by `getTracker` in `data.ts`), each with the Jobs
  page's own match score (`?scored=true`, KAN-256) and the resume last sent
  to its posting (the sent resumes list; its failure only empties that
  column). A row or card opens the application's own page,
  `/applications/[jobId]` (KAN-256), not a side panel. Interviewing, Offer and
  dated events stay empty until the API stores them; a failed read shows an
  error, never stand-in cards. A job's application
  stage (`saved`, `queued`...) reaches its Save and Auto Apply buttons from
  one read per page. Auto Apply never picks a saved job for a batch; only
  the job's own Auto Apply click queues it.
  `docs/screens.md`, Applications, has the rest.
- **Promote to `src/components` on the second consumer**, not in anticipation;
  anything used by one route stays beside it (the per-route `icons.tsx`).
- **`src/components/ui` is hand-written and is what screens import.**
  `src/components/shadcn` (and its `hooks/`) is vendored by `shadcn add` and
  regenerated in place, so a hand edit there is a fork. shadcn's colour roles
  and stock text sizes are aliased onto WorkIt's tokens at the bottom of
  `globals.css`; fix the mapping there, not the component. **Read
  `docs/shadcn.md` before running any `shadcn` command**, and run it from this
  folder: `components.json` differs from a stock install and re-running `init`
  silently undoes it.
- **One Button, `ui/button.tsx`**, the only place button classes are written;
  it answers to shadcn's variant names so pasted shadcn code composes.
  `shadcn/button.tsx` re-exports it and an ESLint rule keeps app code on the
  canonical path (likewise `badge` and `card`). A control's styling belongs in
  its component, not at the call site.
- **One mark for Scout and AI, `SparkleIcon`** (`components/icons.tsx`,
  KAN-257): every Scout or AI control, and Scout's mark in the chat and
  the panel header, draws it. An ESLint rule refuses Lucide's `Sparkles`
  imported anywhere else; a hand-drawn sparkle beside Lucide's had given
  the assistant two marks (`docs/design.md`, Brand and icons).
- **A button is a rounded rectangle; a pill is a chip** (`ui/chip.tsx`, KAN-251).
  Pick a button's size by where it sits (`docs/design.md`, Components). A
  `className` on a Button or Chip may place it or colour a state, never change
  its height, padding, radius, type size, line height or border width: the
  `no-restricted-syntax` rule in `eslint.config.mjs` fails the lint on a plain
  string class. It cannot read a class built in `cn()`, a template string or a
  variable, so keep overrides out of those too. A new box is a new size in the
  component.
- **Build class strings with `cn()` from `@/lib/cn`.** Plain interpolation
  leaves both conflicting utilities in the attribute and the stylesheet's
  emit order picks the winner. `cn()` cannot merge across groups (`border` and
  `border-t-*` both survive), which is why `ui/card.tsx` sets its accent edge
  one side at a time.
- **Tailwind v4 is configured in `src/app/globals.css` via `@theme static`**;
  there is no `tailwind.config.js`. Write the token names (`text-body`), never
  stock sizes like `text-sm`. A new token or shared component gets its row in
  `/design-kit` (titles in `design-kit/data.ts`) in the same change.
- **Name a variant for its role, never its look**: `primary`, `positive`,
  `quiet`, not `blue`, `green`, `plain`.
- **`components/company-logo.tsx` hosts are allow-listed** in `next.config.ts`
  and must match `scraper/workit_scraper/logos.py`; an unlisted host throws
  and fails the whole page.
- **`src/react-canary.d.ts`** loads React's canary types (`<ViewTransition>`,
  `addTransitionType`): the App Router runs React canary and `@types/react`'s
  stable entry lacks them.
- **A page can take Scout's panel over** with `components/scout/
  scout-takeover.tsx`: its children portal into the panel in place of
  Scout's chat while the page is mounted, so the bar's Scout button opens
  the page's assistant. The Experience Bank puts intake there. Open it only
  on a click (the panel's rule), never on page load; a link a student
  clicked to get here may open it once, then drop its query param.
- **The company table (`app/company/table.tsx`) is TanStack Table v9**, and
  every shadcn data-table example in circulation is v8. Read the guides in
  `node_modules/@tanstack/react-table/skills`, not a blog post.
- **pdf.js (`pdfjs-dist`, pinned exactly) loads on the resume editor
  page only** (KAN-209), through `import("pdfjs-dist")` inside an effect in
  `(seeker)/resumes/[resumeId]/pdf-pages.tsx`: about 110 KB gzip plus a
  290 KB worker, which every other page would otherwise pay for, and its
  module touches browser globals, so a top-level import breaks the server
  render. The worker comes from `new URL("pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url)`, which Turbopack emits as a static file. After a build,
  only the editor route's client manifest names the pdf.js chunk.
  `npm install` on a Mac dropped two optional `@emnapi/*` entries from the
  lockfile when pdf.js was added; they were put back by hand. Check the
  lockfile diff for removals after adding any dependency.
- **A saved timestamp becomes a calendar day in the browser, never on the
  server.** The server runs in UTC, so a day computed there is a day off for
  the Americas. Swap the local day in after hydration (`useSyncExternalStore`);
  `LocalDate` and `When` in `(seeker)/local-time.tsx` do it for a seeker
  screen. `formatDate` in `lib/format-date.ts` formats in UTC and suits
  date-only strings only.

## Auth and the API

**This app does not talk to the database.** No ORM, pool, schema or
migrations; a query belongs in an API endpoint, reached through
`lib/api.ts` / `lib/auth.ts` (server-only, using `API_URL`). Supabase Auth
issues the session; the Python API verifies the token and authorizes.
`backend/CLAUDE.md`'s Auth section owns the flow — **read it before touching
auth or adding an API call.** The login, signup and OAuth flows on this side
are in `docs/auth.md`.

- **The token travels server-side.** The browser holds only Supabase's `sb-*`
  cookies; server code reads the access token and forwards it to `apiFetch()`
  as a Bearer header, so the API never sees cookies and needs no CORS. Use
  `getClaims()`, not `getSession()`, for any decision made here; `getSession()`
  is fine for fetching a token to forward.
- **Cookies are httpOnly, 7 days idle** (`lib/supabase/cookies.ts`, used by
  both writers, `supabase/server.ts` and `src/proxy.ts`). Set `maxAge` in that
  helper's `setAll` path, never through `createServerClient`'s
  `cookieOptions`: @supabase/ssr 0.12 overwrites it. httpOnly holds only while
  no `createBrowserClient()` exists.
- **`src/proxy.ts` (Next 16's middleware) refreshes the session on every
  request**, because Server Components cannot write cookies and sessions would
  die with the hour-long access token. It is a convenience, not security: the
  API is reachable without Next and checks every token. Its session step
  no-ops when the Supabase env vars are unset, so a clone with no env file
  boots; the business-side redirect above runs first, either way.
- **Never export a token-returning helper from a `"use server"` file.** Every
  export there is a browser-callable endpoint. Token helpers (`session.ts`)
  and Server-Component-only reads (`job-queries.ts`) live in `server-only`
  modules that action files import.
- **The feed's reads send the viewer's token when there is one**
  (`viewerToken` in `(seeker)/jobs/listings.ts`), so the API can leave out a
  signed-in applicant's applied jobs. It answers null with no Supabase env
  vars, so a fresh clone's feed still loads. Those reads never take
  `revalidate`: Next would cache one applicant's list and serve it to all.
- **Signup goes through `POST /auth/signup`**, not `supabase.auth.signUp()`,
  which can only write user-editable `user_metadata` and so cannot be trusted
  with the account type.
- **A key the API's Pydantic schema doesn't declare is dropped silently**, not
  rejected. A field added to a request body here does nothing until
  `backend/app/schemas/` declares it too.
- **The service-role key never appears in this folder**: one `NEXT_PUBLIC_`
  prefix puts it in every browser. Env lives in `.env.local` (template
  `.env.example`); the anon key is meant to be public.
- **The upload limit lives in three places that must agree**: the API's
  `MAX_UPLOAD_BYTES`, `MAX_AVATAR_BYTES` in `lib/avatar-rules.ts`, and
  `serverActions.bodySizeLimit` in `next.config.ts`, which must stay above
  5 MB plus multipart overhead (`6mb`) or Next rejects the request before the
  action runs.
- **My Profile's cache (`(seeker)/profile-cache.tsx`) lives in the seeker
  layout, never a module variable**: sign-out leaving the shell is what drops
  it, and a module variable would show one account's profile to the next
  person in that tab.
- **Resume facts are edited in the experience bank only** (KAN-211). An
  upload writes its reading into the bank itself (ADR 0003); no screen holds
  a second copy of an upload's facts to edit. Two editors of the same facts
  drift apart, and built resumes read the bank. Every screen that reports an
  import says it with `lib/import-summary.ts`, from the `bank` of an upload
  or an Import Updated Resume, or Import Again's response. An upload's row
  on the Resumes view offers Import Updated Resume (a newer file for that
  row), never a re-read of the stored file, which only ever read the same
  text. "Read It With
  AI" (KAN-222) runs only on a click, never on its own, and shows only
  while `uses_left` is above 0; a failed reading writes nothing and says
  why.
- **Applicant server actions call the API through `applicantCall`**
  (`lib/applicant-call.ts`, server-only): the session, the Bearer token,
  GET/DELETE/fetch, and a `Result<T>` (`data`, `error`, `status`) that never
  throws. A new action file under `/applicants/{id}` wraps it with its own
  base path rather than copying the fetch.
- **A built resume's download goes through `sendBuiltResume`**
  (`lib/sent-resume-actions.ts`, KAN-208), PDF or Word (`"docx"`), never
  `renderResumePdf` or the API's `/docx`: every download keeps a sent resume, and the API returns a Storage link that
  downloads the file. A download cancelled at the missing-character warning
  deletes the sent resume it just made (`created`), so only files the
  student took are kept. Apply on the posting detail goes through
  `applyWithResume` (KAN-220) and keeps its sent resume: the student is
  told WorkIt kept a copy, so it is never deleted behind their back. No
  screen lists sent resumes since the Resumes view's Sent card went
  (2026-10-18); a job posting's page says which one went there.
- **Unsaved drafts kept across a reload go through `lib/local-drafts.ts`**
  (intake's draft entry, KAN-213, and its skipped sections, KAN-214): one key prefix, cleared by Sign Out in
  `account-menu.tsx` and on the login page, which an expired session also
  reaches. A draft stored under any other key outlives sign-out.
- **To test a page behind sign-in, use the shared test account**:
  `TEST_ACCOUNT_EMAIL` / `TEST_ACCOUNT_PASSWORD` in the root `.env`. It is a
  normal applicant with test data only, on the one shared Supabase project, so
  it signs in to the live site too. Never create an account for testing, never
  give this one admin or company rights, and never put real personal data on
  it. If the variables are missing, run `npm run worktree -- --env-only`; if
  they are still missing, ask the user. Never write the values into a
  committed file, PR or comment: the repo is public.

## Screens, design and motion

- **Screens**: before changing how a screen behaves (Jobs page and filters, job
  posting page and card, seeker Dashboard, Applications, Calendar, My Profile,
  Resumes & Experiences, Scout's panel, applicant onboarding, company
  screens), read its section in `docs/screens.md`.
- **Design**: before changing a shell, a page's layout or widths, a colour
  (stage or match), a segmented control or a `ui/` component, read
  `docs/design.md`.
- **Motion**: before adding or changing an animation, transition, hover or
  press state, `<ViewTransition>` or shallow routing, read `docs/motion.md`.

## Conventions

**Copy is Title Case, with named exceptions.** Title Case for page titles;
section, card and dialog headings; empty-state titles; buttons and links that
act as actions; menu items; tabs and segments; filter and field labels and
their options; column headers; badges, pills and stage names; and an
accessible name with no visible text. A tooltip that only pairs a name with
its status is two labels, so Title Case too: intake's step chips say
"Projects · Not Started" (KAN-257). Sentence case only for helper text,
descriptions and subtitles, other tooltips (so an icon button's label too),
placeholders, empty-state body copy, error and validation messages, and a
measured value or annotation outside a badge ("Over 7 days", "vs last week").
Fixture data stays as written. A label that doubles as a value, like the
composer's "Full-Time", changes together with every comparison against it.

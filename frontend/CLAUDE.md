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
- **Local browser testing:** sign in as the shared non-production test
  applicant, `TEST_APPLICANT_EMAIL` / `TEST_APPLICANT_PASSWORD` in
  `frontend/.env.local`. Use that account rather than creating one.

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
- **Pages render a `<div>`**, not a `<main>`: shadcn's `SidebarInset` already is
  the `<main>`. Seeker pages size off `@container/main`, never the window
  (`docs/design.md`).
- **A screen's fixture data lives in a sibling `data.ts`**, so `page.tsx` is
  layout and the swap to real data touches one file. A live fetch that a
  client component's `data.ts` cannot hold gets its own sibling marked
  `import "server-only"` (`(seeker)/jobs/listings.ts` is the first). A live
  fetch in a page calls `await connection()` so `next build` does not prerender
  it with no API running.
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
- **The company table (`app/company/table.tsx`) is TanStack Table v9**, and
  every shadcn data-table example in circulation is v8. Read the guides in
  `node_modules/@tanstack/react-table/skills`, not a blog post.
- **A saved timestamp becomes a calendar day in the browser, never on the
  server.** The server runs in UTC, so a day computed there is a day off for
  the Americas. Swap the local day in after hydration (`useSyncExternalStore`);
  `formatDate` in `lib/format-date.ts` formats in UTC and suits date-only
  strings only.

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
  API is reachable without Next and checks every token. It no-ops when the
  Supabase env vars are unset, so a clone with no env file boots.
- **Never export a token-returning helper from a `"use server"` file.** Every
  export there is a browser-callable endpoint. Token helpers (`session.ts`)
  and Server-Component-only reads (`job-queries.ts`) live in `server-only`
  modules that action files import.
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
  it, and a module variable would show one account's resumes to the next
  person in that tab.

## Screens, design and motion

- **Screens**: before changing how a screen behaves (Jobs page and filters, job
  posting page and card, seeker Dashboard, Applications, Calendar, My Profile,
  Scout's panel, company screens), read its section in `docs/screens.md`.
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
accessible name with no visible text. Sentence case only for helper text,
descriptions and subtitles, tooltips (so an icon button's label too),
placeholders, empty-state body copy, error and validation messages, and a
measured value or annotation outside a badge ("Over 7 days", "vs last week").
Fixture data stays as written. A label that doubles as a value, like the
composer's "Full-Time", changes together with every comparison against it.

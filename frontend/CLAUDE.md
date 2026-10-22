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
  site's markup, classes and copy, with two deliberate changes, and set the
  app's own face (`--font-sans`, Plus Jakarta Sans) instead of the site's
  Inter, so the page and the app read as one product; Google Sans loads only
  for the Google sign-in button.
  **Colour and logo:** the site's numbered blue scale became
  `landing-brand-50` to `950` in `globals.css`, the same steps in WorkIt
  violet, so a component copied from the site needs only `brand-N` renamed
  to `landing-brand-N`. Restyling a component during that recolour was
  reverted once: the team wants the site's look unless it asks. **Layout,
  after Calendly's homepage:** every full-width band (hero, grey bands,
  footer) is a rounded panel inset from the window (`PANEL` and
  `PANEL_INSET` in `layout-parts.tsx`, the frame every marketing page
  shares with `CONTAINER` and `SectionHeading`; the group's `layout.tsx`
  renders the header and footer, and each page renders its own `<main>`); the header floats as a white rounded bar
  once the page scrolls (`floating-header.tsx`); and the site's feature
  carousel and grey product placeholder became one pinned product tour
  (`product-tour.tsx`): from lg up it pins to the screen and scrolling steps
  through the four features, each with its own app colour, in the hero
  headline's order (Resumes, Matching, Auto Apply, Updates for Tailored,
  Matched, Applied, Tracked), set by `features` in `feature-data.ts`.
  The Resumes and Matching stops are each one story told a scene at a
  time, not every step at once, on the shared `Story` (`story.tsx`: the
  scene timer, the scene title and the stage). The title is a glass pill
  with the scene's number, its caption and a progress line; it is not a
  switcher: the team had the step bar of buttons removed (KAN-316), and
  the caption had floated as small grey text under it. A story plays only
  in view, from the start each time (its stage remounts on each return,
  so a scene that plays on mount starts when it is seen), and holds one
  finished scene for reduced motion. All four stops are on it (KAN-316).
  Auto Apply (`auto-apply-visual.tsx`, the stop the team renamed from
  Autofill as the bigger claim): one Greenhouse-style application fills
  field by field (typed, picked, the tailored resume attached, an answer
  drafted from the bank) while the page scrolls to Submit, and the
  student's pointer clicks Submit; then the camera pulls back to 3 × 3,
  5 × 5 and 7 × 7 windows of the queue, filled for the student. **Its copy
  must match what auto apply does** (`auto-apply/architecture.md`,
  `autofiller_extension/CLAUDE.md`): it fills one application at a time in
  one background tab and never submits, so the page never says "at once",
  "in parallel" or that WorkIt sends an application. The team first asked
  for "49 in parallel"; that was reworded to a queue when the run was
  checked. Change it if the run changes. Every window is drawn at the
  stage's size and one transform scales the grid; the far windows are big
  type and bars, filled by CSS transitions, and a ring mounts only one
  step before the camera reaches it. Updates (`updates-visual.tsx`): the same Cloudflare application
  hears back. Each update drops in as a notification, then lands: the
  card's track moves on (the board's stage colours, Viewed in the stop's
  pink) and the update opens below it. It replaced a live feed with a
  green "Live" dot, which the team found generic. Resumes (`resume-visual.tsx`): loose
  experience-bank entries gather into
  one pile, a template is picked, the resume writes itself in Jake's look,
  then a job posting arrives and the same page is tailored to it: mock AI
  suggestions (Keep, Cut, Rewrite, Add) appear in the gutters beside the
  lines they change, each marked with `SparkleIcon`, and apply on the page
  as a highlight, a red strike or a green insertion while the match
  climbs. The page sizes to its content; fixed to the stage's height it
  squeezed its last lines. Its Modern and Compact templates are looks the
  app does not have yet (it renders Jake's Resume only), a choice the team
  made for the page; drop them or mark them if that matters. Matching
  (`matching-visual.tsx`) follows the real score
  (`backend/app/services/matching/scoring.py`): the same student's bank is
  read into a profile, five postings are scanned for the student's skills,
  each is scored, and the top one shows its four factors (Meaning, Skills,
  Title, Experience) as bars with no numbers, since the weights are still
  guesses in the code; then the cards sort into Best Match order, the
  Jobs page's own name for it. Its postings name real employers, like the
  hero's cards; so do the Autofill and Updates stops and the journey
  cards, which take their companies from the applications board
  (`board-data.ts`), each logo a favicon tile (`favicon-logo.tsx`). Scores
  on the hero, the board and both stories are green, amber or red through
  `scoreTone` (`score-tone.ts`). Below lg the
  stops stack, because a pinned card with the resume animation does not fit
  a phone. The site's placeholder benefit grid and three steps became an
  expanding card row (`journey.tsx`: Find, Apply, Track, Hear back; the
  card under the pointer widens) and the hiring-systems section
  (below). The site's closing "Be first in line" banner is
  removed for now. **The applications section** ("Every application, from
  saved to signed.", KAN-316): its board (`application-board.tsx`) shows
  real employers from `scraper/boards.csv` with intern or new-grad titles
  and no note line, its cards frosted glass over blobs in the four stages'
  colours, so the glass has colour to blur. The stage list beside it is
  `StageTimeline` (`stage-timeline.tsx`): one search moving from saved to
  signed, a track that fills stage by stage, nodes that light in each
  stage's colour, a glass highlight that slides to the current stage, a
  tally that counts up, and a burst at the offer. Its rows are a fixed
  height (`ROW`), since the track and fill are measured in rows; a longer
  description must still fit two lines at phone width. Node colours are
  CSS variables, so they change by CSS transition: motion cannot tween a
  `var()`. The list is `isolate`, or the highlight's `-z-10` drops behind
  the page's background. **The hiring-system list in
  `data.ts` is a claim that WorkIt reads those systems**: it must match
  `scraper/workit_scraper/providers.py`'s `LISTING_URL`. Its logos are
  files in `public/hiring-systems/`, each from the company's own site or
  its GitHub organization, square and at least 48px: the Google favicon
  host had only 16-32px copies of BambooHR's and Workday's, which looked
  blurry. A hiring system added to the list needs its file there too.
  **The hiring-systems section** (`hiring-systems.tsx`) draws the job
  pipeline (`docs/job-pipeline.md`) as a stream. From lg up, one lane per
  hiring system carries job postings from real employers on that system
  in `scraper/boards.csv` (`streams` in `data.ts`) into WorkIt's mark: a
  senior role is struck through and falls away, an internship or new-grad
  role goes in and comes out as a glass card on the Jobs page side,
  sorted by Best Match. Below lg it runs top to bottom in two or three
  columns. The lines under the mark are pipeline steps, so each is a
  claim. The team dropped the two cards that sat under it (Autofill for
  Chrome, Scout): their feature pages cover them. One clock (a motion
  value, in seconds) drives every chip and moves only in view and in a
  visible tab; with reduced motion it stays at `STILL_AT`, the one still
  frame. A lane's chips are evenly spaced slots, and each takes the lane's
  next posting every lap; a lane too short for two (below about 1200px)
  carries one, since two overlapped at 1024px. `STILL_AT` was picked by
  simulating every layout, so no chip is mid-fall and the first card comes
  out within two seconds; re-check it after changing lanes, speeds or
  postings. When a kept posting's card is already shown, the next one not
  shown comes out instead: with the same few postings going round, the
  list once sat unchanged for 15 seconds. A chip keeps its lap in a ref as
  well as state: `useTransform` sets its value again while the chip
  renders, and a listener that set state from the old lap looped ("Too
  many re-renders"). While the Browser pane is hidden it draws no frames,
  so neither `requestAnimationFrame` nor `ResizeObserver` runs and the
  stream stands still; each screenshot draws one frame (about 40ms of the
  clock), so check it with screenshots and script reads, not by waiting.
  The hero's backdrop is an animated SVG city (`city-model.ts` draws it,
  `hero-city.tsx` renders it after hydration, since server-rendered its path
  data would add hundreds of KB to the page): New York-style towers, six of
  which rise as violet wireframes with a job tag. The strip's viewBox starts
  100px above the ground's origin (`STRIP_TOP`): the tallest side towers
  reach there and were once cut flat at the top. The ground grid runs ten
  rows behind the back row of buildings and fades out towards the text, so
  it reads as a plane behind the low centre. Its heights are capped per
  column so nothing reaches the text at its 1600px design scale. The cap
  slopes between the text's steps (`SLOPE`) and towers ease into it
  (`soft`): cut flat at four stepped caps, the skyline stood in terraces
  with sharp corners near the middle; it keeps
  that scale from lg up (cropped at the sides) and shrinks to the panel's
  width below lg, under the text. A change to the hero's text size or the
  buttons' width means re-checking those caps (`ceiling` in
  `city-model.ts`): the buttons once ran wider than the caps assumed and
  towers rose behind them. Its job cards show only where they fit:
  `placeCards` in `hero-city.tsx` measures each one against the panel's
  sides and the text's line boxes (`data-hero-text`, `data-hero-box` in
  `page.tsx`) on every resize, nudging a card inward or skipping it; a
  fixed breakpoint once hid them on every laptop-width window. Measure text
  runs, not elements: a block line's box spans the full width. The cards are
  frosted glass (`.glass-card` in `landing.css`, a `backdrop-filter` over
  the towers; the page's one glass look, shared with the tour's scene
  titles and the board's cards). Their fade runs on the tag's children, never the tag itself:
  an ancestor below full opacity is a backdrop root, so the blur would see
  nothing behind it and snap on only when the fade ended. Two cards on one
  side of the city once stacked on each other: a card now shows for less
  time than the gap between two tags on its side (`city-model.ts`'s
  delays, `hero-city-tag-fade`), so change both together. The cards name
  real employers from `scraper/boards.csv` with intern or new-grad titles,
  the only roles the scraper keeps, and their logos come from the favicon
  host. Their score chips are green, amber or red (`scoreTone` in
  `score-tone.ts`, from the positive, warning and danger tokens), not the
  app's magenta match bands: the team wanted the hero to show a spread of
  fits at a glance. In the
  pinned product tour, `Fit` (`fit.tsx`, shared with the feature pages'
  stage) scales a visual to the visual area's height
  and width, up to 1.5x (and, in the stacked stops, down to their width
  only), so the 520px-wide stories fit a short laptop screen and fill a
  big one: at 1x they sat small in an area of empty colour, which the team
  flagged. Each story's stage is the height of its tallest scene, no more,
  since spare stage height is what shrinks the scale; and its
  `AnimatePresence` must not get `initial={false}`, which blocks the first
  animation of every motion element inside it: the old Matching stop's
  rows once sat still at their end value until a tab switch remounted
  them. Violet is
  the wireframes' alone; keep roofs and spires neutral. It does not use
  `ui/` components, Title Case or the type tokens; those rules are for app
  screens. Rules in `landing.css` that set `display` or a size sit in
  `@layer components`, or they beat a `hidden` or `h-12` utility on the
  same element. Its animations use `motion`
  (`motion/react`), which only this route imports; the feature animations
  expect the tour's `MotionConfig reducedMotion="user"` around them. What
  differs from the site, and why: the Applicant / Company switcher is left
  out while the business side is hidden; the nav and footer link to the
  marketing pages (next bullet), not to this page's sections; the
  waitlist form became a sign-up link, since its email went through the
  site's own server; every call to action goes to `/signup`, `/login` or
  `signInWithOAuth`. The testimonial still holds the site's placeholder
  copy; never fill it with an invented quote. The FAQ answers are product
  claims, each tied to its source in a comment in `data.ts`.
- **The marketing site is the home page, a page per feature, Pricing and
  the Resources pages**, all in `app/(landing)/`, after Linear, Notion and
  Calendly. The home page is the overview. The header reads Features ▾,
  Resources ▾, Pricing, Log in and Get started (the team renamed Product to
  Features); its old anchor links (Features, Applications, FAQ) are gone.
  The team first kept two links and turned down a third, Help Center among
  them; on 2026-10-21 it reversed that and added Resources ▾ (MCP docs,
  Help Center, Blog). Still turned down: Integrations (too small for a
  page), a public job list (no postings shown signed out), What's New and
  For Career Centers.
  **The Resources list is `resources/catalog.ts`**: each item's name, link,
  icon and menu line, in menu order. The Resources menu, the phone menu and
  the footer's Resources column read it. None of the three has a page yet,
  so each item carries `soon`: the menus mark it Soon, and its route
  (`docs/mcp/`, `help-center/`, `blog/`) renders `ComingSoonPage`
  (`resources/coming-soon.tsx`) with the item's copy, kept out of search
  results. Its copy is a claim like the FAQ's: the MCP server is only
  planned (`auto-apply/architecture.md`, section 14), so no line says it
  exists. A real page replaces the route file and the item drops `soon`.
  The Help Center is `/help-center` because `/help` is the signed-in app's
  Help page (`app/(seeker)/help/`): a second `/help` in this group stops
  every page with "two parallel pages that resolve to the same path".
  **The feature list is `features/catalog.ts`**: each feature page's slug,
  name, icon and colour, in menu order. The Features menu, the phone menu,
  the footer's Features column, each page's related-feature cards and the
  tour's "Learn more" links all read it, and the tour's stops take their
  colours from it, so a feature wears one colour and one mark
  (`FeatureIcon`) everywhere. Tracker shows the tour's Updates animation
  in its pink; Scout had no stop, so it took amber, the one app colour
  left free. **One template, one content file per feature**:
  `features/[slug]/page.tsx` is the route (`generateStaticParams` lists
  the five slugs and `dynamicParams = false` makes any other a 404; the
  metadata comes from each content file), and `features/feature-page.tsx`
  draws every one: hero, the animation shown large, three or four deep
  dives, How it works, the other features, an FAQ and a closing call to
  action. Each page's copy and visuals live in its own
  `features/content/<slug>.ts` (the shape is `features/types.ts`), so
  writing one page never touches another's file; all five exist, and
  `content/index.ts`, which maps them, is never edited per page. A content
  file's `line` is also the Features menu's line under the name. Its copy
  is a product claim like the FAQ's: auto apply fills one application at
  a time and the student clicks Submit on each, so no page says WorkIt
  submits or applies in parallel. Until each page's own session rewrites
  it, a file holds stub copy, marked as such at its top. A content file
  imports its animation, a client component (the four tour visuals carry
  `"use client"` so a server file can import them); the template wraps it
  in `FeatureMotion` (`MotionConfig reducedMotion="user"`) and `Fit`. A
  page with no animation (Scout, for now), or a deep dive with no
  `visual`, shows a placeholder in the feature's colour. The hero and the
  closing call to action use `SocialSignUpButton` (`social-sign-up.tsx`,
  shared with the home hero) and the FAQ is `FaqList` (`faq-list.tsx`).
  **The header menus** (`NavMenu` in `nav-menu.tsx`, both Features and
  Resources) are disclosures with `aria-expanded`, not ARIA menus, since
  their items are links: a mouse hover opens one, a click pins it, Esc
  closes it and returns focus, and tabbing out, a click outside, a link
  inside or a route change closes it. `NavMenuGroup` holds which one is
  open, so only one shows: a hover on the other trigger moves to it, and
  with a state per menu a pinned panel stayed open under the other's.
  `header.tsx` draws both panels on the server and passes them in, so the
  content files never reach the browser; both draw their items with
  `MenuLink` (`FeatureIcon`, name, line), and the Resources tile is one
  neutral colour, never a feature's. Features, Resources and Pricing
  share one box, `NAV_ITEM` in `layout-parts.tsx`: Pricing as a bare
  inline link sat 1px lower, its 14px text on the list item's 16px
  baseline. The Features panel's foot row links to the home page's
  `#hiring-systems`; the team decided that section gets no page of its
  own. **The bar's white fill
  is a layer behind the nav, not the nav's parent**: with `backdrop-blur`
  on an ancestor, that ancestor is the panel's backdrop root, and the
  panel's own blur would see nothing behind it. The phone menu is the
  native popover in `mobile-menu.tsx`, which also closes when one of its
  links is followed: the header stays mounted from page to page, so an
  open popover would sit over the next page. Each header menu is one
  expandable group in it (`MobileGroup`, a native `<details>`). The
  footer's link columns are Features and Resources, from the two
  catalogs, then `site.footer`'s.
- **The Pricing page, `app/(landing)/pricing/`, shows the team's plans.**
  Every plan, price, daily limit, feature row and billing answer lives in
  its `data.ts`; the page holds layout only. The team picked Free, Plus
  ($15) and Pro ($29) a month, or 20% less on a 3-month term (a job search
  lasts one recruiting season, so there is no yearly term), on 2026-10-21,
  at about half of Simplify+'s and Jobright Turbo's price, and had the page
  show them plainly: no "Prices are not final" or "Not on sale yet" note,
  which an earlier version had. WorkIt has no billing yet, so every account
  is on Free; while `PAID_PLANS_ON_SALE` is false each paid plan's button
  leads to the free sign-up and says so ("Start free, then Plus"; "Get Plus"
  would sell a plan nobody can buy, and one "Get started for free" on every
  plan read as the same plan three times). Set it to true only once billing
  ships and the API enforces the paid limits. Every limit is a claim: Free's
  Tailor and Scout limits are the API's caps today (`ai_tailor_cap`,
  `ai_scout_cap` in `backend/app/config.py`), so change both together; a
  Scout use is one message, a Tailor use one Tailor run or the first keyword
  check against a job posting WorkIt has not read; no answer says Auto Apply
  attaches a resume, since the extension's upload is unverified live;
  employer replies stay "Coming soon" until they are built, whatever the
  home page's tour shows. **Layout, after Jobright's pricing page:** one
  board (`PlanBoard`). From xl up a glass panel holds the intro, the switch
  and the paid plans heading their columns, Free has its own grey panel on
  the right, and each feature runs across as a row, a CSS subgrid so its
  cells line up under the plans. The panels and Plus's column strip are
  absolutely placed grid children: with no row set they span the grid's full
  height, and they take no cell from auto-placement, which would push the
  rows below the grid. Below xl the same markup stacks, the plans as a row
  of three from md, then a box per plan under each feature; the 14rem plan
  columns need xl's width. The board replaced three cards with lists and a
  separate comparison table, which the team found boring. Colour follows the
  tiers: Plus, the recommended plan, is filled violet with a tilted
  "Recommended" badge over its top edge, so no plan may take
  `overflow-hidden`; Pro is white with violet pills; Free, the basic tier,
  is grey (`canvas`, grey checks, a plain white button), since violet on
  Free read as a paid plan. The hero's blobs are violet only and the same on
  both sides: a magenta blob once showed through the glass as pink. The team
  turned down soft circles on Plus (they read as a sun), silk ribbons,
  patterned card tops (dots, tiles, crosses), and a tile grid with rings
  behind the heading; keep the plans plain. Two cascade traps: `.glass-card`
  and `.landing :focus-visible` are unlayered, so they beat any Tailwind
  utility; a ring on a glass card loses to its box-shadow (use an outline),
  and a focus colour needs `!`. The Monthly / 3 months switch is two native
  radios, and the prices read the checked one with `group-has-[...]`, so the
  page ships no script for it.
- **The Calendar, and the Dashboard's Next Up, Up Next and Waiting, are
  archived for now** (KAN-261): the tracker stores no dated events or
  follow-ups yet. `src/proxy.ts` sends `/calendar` to the Dashboard, its
  sidebar row is commented out, and all their code stays. `docs/screens.md`
  (Calendar, Seeker Dashboard) says how to bring them back.
- **The Applications board is archived** (KAN-256): the list is the
  default view, and `?view=board` opens it. `applications/board.tsx` stays;
  `docs/screens.md`, Applications, says how to bring it back.
- **The sidebar is pinned or opens on hover** (KAN-300,
  `components/hover-sidebar.tsx`). A hover opens shadcn's provider over the
  page, so anything sized by the panel's width reads `useSidebarPin().pinned`,
  never shadcn's `state`, or it moves on every hover (`docs/design.md`).
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
  page's own match score (`?scored=true`, KAN-256) and the sent resume the
  application names (`sent_resume`, KAN-267: "Did You Apply?" sends it
  through `markApplied`, auto apply links its own), which View Resume opens in a dialog (`applications/view-resume.tsx`,
  KAN-267: `openSentResume`, nothing downloaded). A button inside a
  clickable row or card must not open the application on a near miss: the
  list's cell prevents its clicks and the card's strip sits over the
  stretched link, and a dialog opened from one stops its own clicks, since
  React passes them up through the portal. A row or card opens the application's own page,
  `/applications/[jobId]` (KAN-256), not a side panel. Interviewing, Offer and
  dated events stay empty until the API stores them; a failed read shows an
  error, never stand-in cards. A job's application
  stage (`saved`, `queued`...) reaches its Save and Auto Apply buttons from
  one read per page. Auto Apply never picks a saved job for a batch; only
  the job's own Auto Apply click queues it.
  `docs/screens.md`, Applications, has the rest.
- **A "Back" link to a dynamic page goes back in history when it can.** Next
  keeps no dynamic page for a link visit (`staleTimes.dynamic` is 0), but
  reuses the one it holds on a history Back. A job page's Back that followed
  its link re-ran the whole feed fetch and Best Match scoring, so the list
  seemed slow to load; `BackToJobs` now calls `router.back()` when
  `cameFrom()` is its target (`docs/screens.md`, Job posting page).
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
  and fails the whole page. It measures each logo on load: a square mark
  fills the tile edge to edge, a wide wordmark sits on white with padding.
  Framed with padding, square marks on their own colour (Figma, Cloudflare)
  looked shrunk. The image is hidden until measured, and next/image only
  reports the load once the browser has decoded it, which a hidden browser
  tab (the Browser pane when it is not shown) can hold back, so check it
  with the page visible.
- **`src/react-canary.d.ts`** loads React's canary types (`<ViewTransition>`,
  `addTransitionType`): the App Router runs React canary and `@types/react`'s
  stable entry lacks them.
- **A page can take Scout's panel over** with `components/scout/
  scout-takeover.tsx`: its children portal into the panel in place of
  Scout's chat while the page is mounted, so the bar's Scout button opens
  the page's assistant. The Experience Bank puts intake there. Open it only
  on a click (the panel's rule), never on page load; a link a student
  clicked to get here may open it once, then drop its query param.
- **The company table (`app/company/table.tsx`) and the Applications list
  (`(seeker)/applications/list.tsx`, KAN-282) are TanStack Table v9**, and
  every shadcn data-table example in circulation is v8. Read the guides in
  `node_modules/@tanstack/react-table/skills`, not a blog post. Auto
  Apply's two tables (KAN-285) are plain shadcn `Table`s with sort headings:
  a short table with no column moves gains nothing from TanStack. They
  share the Applications list's frame and its promoted pieces
  (`components/clickable-row.tsx`, `match-badge.tsx`, `reflow.tsx`,
  `field-facet.tsx`); a new seeker table starts from those, not a copy.
- **A filter whose rows the page already holds moves the URL in place**
  (`useShallowPush`, `docs/motion.md`): Live Activity's Status and sort
  (KAN-285). A tick passes `{ replace: true }`, so ticks are not steps of
  Back, as the Applications page's server-side picks replace the URL.
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
- **`/login` and `/signup` send a signed-in visitor to their home**
  (`redirectIfSignedIn` in `lib/session.ts`); the landing page at `/` never
  does, so a signed-in student can still read it. Every sign-in path picks
  the destination with `homePath` (`lib/auth.ts`): company, onboarding, or
  the Dashboard. Before this, a saved session went unnoticed: the landing
  page's Log In always opened the form, and Google's account chooser
  (`prompt: "select_account"` in `oauth-actions.ts`) made it look like a
  fresh sign-in every visit. `/signup/choose-account-type` is not redirected:
  a new OAuth identity is signed in there before it has an account.
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
- **A profile link becomes an href only through `safeHref`**
  (`lib/profile-links.ts`, KAN-262), which allows http(s) alone. The API
  refuses anything else since KAN-262, but a link saved before then may be
  any text, a `javascript:` one included. The same file holds `webLink`, the
  browser's copy of the API's check, and `linkText`, the resume header's way
  of printing a link.
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
- **An API error's message comes from `extractErrorMessage`** (or
  `errorMessage` for a body already read), which reads all three shapes of
  `detail`: a string, Pydantic's list, and an object with `message` plus
  the row it names (the duplicate resume 409s, KAN-267). Reading
  `detail` as a string alone showed "Something went wrong" for those.
  A duplicate upload (`uploadResume`'s `duplicateOf`) is no failure for
  onboarding: the file is already there.
- **A built resume's download keeps nothing** (KAN-267): the PDF through
  `renderResumePdf` (base64 and its `file_name`), the Word file through
  `downloadWordResume` (`lib/built-resume-actions.ts`), saved by the
  browser from a Blob (`resumes/download-menu.tsx`). Until KAN-267 every
  download went through `sendBuiltResume` and kept a sent resume in
  Storage, so the bucket filled with files no employer saw; that action is
  gone. The missing-character warning still holds a PDF until Download
  Anyway. Pick a Resume is hidden for now (`frontend/docs/screens.md`, Job
  posting page): Apply Now opens the employer's page and asks "Did You
  Apply?", whose Yes keeps the pick through `applyWithResume`. It went through
  `applyWithResume` (KAN-220) at Apply wherever it
  sits: the job posting page, the feed cards on /jobs and /search, and the
  Dashboard's New Matches (KAN-290). It keeps its sent resume: the student
  is told WorkIt kept a copy, so it is never deleted behind their back.
  **Resume files download on Resumes & Experiences only** (KAN-267): the
  editor's Download and an upload's row (`lib/save-file.ts`). The Apply
  dialog links there (Open in Resumes) and downloads nothing, though the
  API still answers a send's file (a Storage `url`, or for a snapshot the
  PDF as `data`) for auto apply. No
  screen lists sent resumes since the Resumes view's Sent card went
  (2026-10-18); a job posting's page says which one went there.
- **Unsaved drafts kept across a reload go through `lib/local-drafts.ts`**
  (intake's draft entry, KAN-213, and its skipped sections, KAN-214), and
  so does a per-browser view preference that should leave with the student
  (the Applications list's column layout, KAN-282): one key prefix, cleared by Sign Out in
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
An answer quoted from a self-identification form keeps the form's words and
case: onboarding's veteran and disability answers ("I am not a protected
veteran", Form CC-305's "I do not want to answer"), so a student recognises
the answer the employer's form will show.
Fixture data stays as written. A label that doubles as a value, like the
composer's "Full-Time", changes together with every comparison against it.

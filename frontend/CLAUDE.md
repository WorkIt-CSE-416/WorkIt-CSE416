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
  On a Mac it drops the top-level `@emnapi/core` and `@emnapi/runtime`
  entries (optional, for wasm32), and CI's `npm ci` on Linux then fails
  with "Missing: @emnapi/runtime from lock file" (KAN-169, and pdf.js
  before it). Copy them back from `main`'s lockfile, and check it with
  `npm ci` in a `node:22` container before pushing.
- `typecheck` runs `next typegen` first because `LayoutProps`/`PageProps` are
  generated route types that do not exist on a fresh clone; bare `tsc` fails.
- There is no test runner yet. When one is added, document it here.
- **To test a resume upload**, use a file from `frontend/public/resumes/`.
  The folder is git-ignored because it holds real people's resumes, so put
  your own there once, in the primary checkout: `npm run worktree` and every
  Superset workspace's setup copy it into the new worktree with the env files.
  Delete an upload once the test is done; it lands in the shared database.

## Deployment

**Cloudflare Workers through OpenNext** (KAN-294, ADR 0004): the Worker
`workit-web` at `workitjobs.ai`, configured in `wrangler.jsonc`, deployed by
CI with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The Vercel project
(Root Directory `frontend`, URLs in the root `CLAUDE.md`) keeps running until
the KAN-296 cutover.

- **Scripts**: `cf:build` runs `next build` and turns `.next/` into
  `.open-next/`; `cf:preview` serves that output in the local Workers runtime;
  `cf:deploy` uploads it. Each is one binary, so `cf:preview` and `cf:deploy`
  need a fresh `cf:build` first. `npx wrangler deploy --dry-run --outdir
  <dir>` prints the upload size with no Cloudflare login: the Workers Paid cap
  is 10 MiB gzip (3.6 MiB on 2026-10-20). Never run a real deploy locally.
- **`@opennextjs/cloudflare` is pinned exactly**: each release's peer range
  sets a floor on `next` (1.20.6 is the newest that takes `next` 16.3.3).
  Raise them together; a newer adapter on an older Next fails to install.
- **`NEXT_PUBLIC_*` are build-time.** Next inlines them into the bundle, so
  they must be set where `cf:build` runs (the CI build step), not as Worker
  vars or secrets. Server-only runtime values (`API_URL`, never
  `NEXT_PUBLIC_`) are `vars` in `wrangler.jsonc`, or Worker secrets if secret.
- **The build bakes `.env*` files into the Worker** as fallbacks under its
  vars (`.open-next/cloudflare/next-env.mjs`). Build for a deploy only where
  no `.env.local` exists (CI), or the local `API_URL` ships as a fallback.
- **`src/proxy.ts` stays a Node proxy.** OpenNext 1.20 bundles Node
  middleware with a warning ("experimental, not officially maintained"); the
  redirects and the sign-in redirect worked under `wrangler dev` on
  2026-10-20, with dummy Supabase vars; a real session refresh is untested.
  If a later adapter rejects it, rename it back to `middleware.ts`
  exporting `middleware` on the Edge runtime (ADR 0004).
- **`next/image` is unoptimized on Cloudflare** (`next.config.ts`): logos
  load from their own hosts. Vercel keeps the optimizer until the KAN-296
  cutover, read from `VERCEL`, which every Vercel build sets and OpenNext's
  never does. The Cloudflare Images binding bills per unique transformation
  past 5,000 a month, which the feed's logos would outrun. Where it is off,
  `remotePatterns` and the SVG settings do nothing; they stay for the day the
  optimizer returns.
- **The OpenNext build is not guaranteed on Windows.** Run `cf:*` in WSL, or
  leave them to CI; `dev`, `build` and the rest work natively.
- **OAuth needs each origin allow-listed in Supabase** (Authentication → URL
  Configuration → Redirect URLs): production, a wildcard for previews and
  `http://localhost:3000`, each with `/auth/callback`. Settings' links and
  confirm emails add `?next=/settings/...` to it; if Supabase sends those to
  its Site URL instead (untested on 2026-10-23), add a `**` wildcard entry
  for each origin's callback. `lib/request-origin.ts` (OAuth sign-in, linking, Change Email)
  builds the origin from `x-forwarded-host` on Vercel, whose proxy sets it,
  and from `Host` elsewhere: on Cloudflare `x-forwarded-host` is whatever the
  browser sent. It assumes https for any host
  but localhost when `x-forwarded-proto` is missing; Supabase silently falls
  back to its Site URL for any origin not on the list.
- **Vercel refuses request bodies over 4.5 MB** before Next runs, while uploads
  are capped at 5 MB, so a 4.5–5 MB upload fails there with a bare 413.
  Cloudflare allows 100 MB, so this closes at the KAN-296 cutover.

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
  through the four features, each with its own app colour, in the
  pipeline's order (Resumes, Matching, Auto Apply, Updates), set by
  `features` in `feature-data.ts`.
  The Resumes and Matching stops are each one story told a scene at a
  time, not every step at once, on the shared `Story` (`story.tsx`: the
  scene timer, the scene title and the stage). The title is a glass pill
  with the scene's number and its caption; it is not a switcher: the team
  had the step bar of buttons removed (KAN-316), the caption had floated
  as small grey text under it, and a progress line along the pill's foot
  was removed too. A story plays only
  in view, from the start each time (its stage remounts on each return,
  so a scene that plays on mount starts when it is seen), and holds one
  finished scene for reduced motion. All four stops are on it (KAN-316).
  Auto Apply (`auto-apply-visual.tsx`, the stop the team renamed from
  Autofill as the bigger claim): one Greenhouse-style application fills
  field by field (typed, picked, the tailored resume attached, an answer
  drafted from the bank) while the page scrolls to Submit, and the
  student's pointer clicks Submit; then the camera pulls back to 3 × 3,
  5 × 5 and 7 × 7 windows of the queue, filled for the student. Each far
  window shows its match (`scoreTone`), and the queue leaves out the weak
  fits (under 70), so it reads as the best fits, not as the mass
  copy-paste the statement warns about. **Its copy
  must match what auto apply does** (`auto-apply/architecture.md`,
  `autofiller_extension/CLAUDE.md`): it fills one application at a time in
  one background tab and never submits, so the page never says "at once",
  "in parallel" or that WorkIt sends an application. The team first asked
  for "49 in parallel"; that was reworded to a queue when the run was
  checked. Change it if the run changes. Every window is drawn at the
  stage's size and one transform scales the grid; the far windows are big
  type and bars, filled by CSS transitions, and a ring mounts only one
  step before the camera reaches it. A restart fades the old grid out
  before the blank form comes in (`mode="wait"`): together they showed
  through each other. The camera is clipped at the stage,
  which is the close-up window's own size and corners, and the window's
  shadow is drawn on the clip, outside it: a clip 24px wider, to leave the
  shadow room, showed as a pale band over the gradient and under the
  scene title. Updates (`updates-visual.tsx`): the same application
  hears back. Each update drops in as a notification, then lands: the
  card's track moves on (the board's stage colours, Viewed in the stop's
  pink) and the update opens below it. The notification drops into that
  room under the card, and the update comes in once it has risen away:
  dropped over the card, its glass blurred the card's title into a grey
  smear. The Viewed update says only what its notification says ("Stripe
  viewed your application"): "Your resume was opened … by the recruiting
  team, just now" claimed WorkIt sees a recruiter open a file. It replaced a live feed with a
  green "Live" dot, which the team found generic. **One application
  runs through the whole tour** (after Twain's way of carrying one object
  down the page): `followedJob` in `feature-data.ts`, Stripe's Software
  Engineer Intern posting, is the hero's Stripe card, the job Resumes
  tailors to, Matching's top match, the form Auto Apply fills and the
  application Updates follows; change it there and every stop follows. A card
  that flew from the hero's Stripe card into the tour and docked above
  each stop's copy as a tracker of that application (`JobFlight` and
  `TourBaton` in `tour-baton.tsx`) was built and taken out for now: the
  team found it out of place beside the copy. The file stays, not
  mounted; to bring it back, render `JobFlight` in `PinnedTour` with the
  pin's entry progress and a ref on a dock above the copy, and
  `TourBaton` in that dock. Measure both ends of the flight every frame,
  since both move, and leave the copy room on short screens. **The bridge**
  (`bridge.tsx`, between the hero and the tour) is the segue the team
  asked for: from lg up the scroll cues its phases and each plays to its
  end in time (`useSceneTime`, "Scroll cues, time plays", below), from the
  moment it comes up under the hero (so the postings seem to rise out of
  the city) through a pinned stretch, 260vh in all; every posting floats
  while the scene rests (`.bridge-float`), the six that fit until they
  sort (`data-sorted`), so they do not stand out by standing still. Real
  employers' postings flood the screen ("Thousands of internships open
  every season"): the line comes up with the section, and the flood rises
  on a cue of its own once the stage is on screen (played with the line,
  the rise ran below the fold). The six that fit, the six highest scores,
  sort into a grid with their scores while the rest go ("WorkIt finds the
  ones that fit you"); their cards are wider (`FIT_W`), so each title
  shows whole beside its score (at the others' width it read "Software
  Engin…"). One line shows at a time, and only the line on screen takes a
  click or a selection: the three sit in one place, and a drag over the
  visible one selected a hidden one. The six then stack into one under
  the four steps, which light in turn ("And it helps with every step of
  the search": "every step after that" put Matching after the match), and as the
  tour comes up those four pills fly into its tab bar (`TabFlight`,
  mounted by `PinnedTour` with the pin's entry progress). The flight marks
  `<html>` with `data-tab-flight` (idle, flying, landed), and landing.css
  hides the bridge's pills while they fly and the tour's tab bar until
  they land, so each pill is drawn once; with no flight the attribute is
  absent and the tabs show. The flying pills leave with the bridge pills'
  colour rings and land looking as the tabs do (the first white, the rest
  clear with grey labels), and the tab bar shows with no fade: drawn
  plain, the four rings vanished at take-off, and a fade made the pills
  blink as they landed. Below lg and with reduced motion it is a still
  block, no pin. The four tabs' labels, icons and colours are one list,
  `TOUR_TABS` in `tour-tabs.ts`, a plain module that both the tour and the
  bridge import: a server page cannot pass icon components to a client
  one as props. **Keep every scroll-linked range inside 0 to 1**: motion
  hands scroll-linked opacity and filters to the browser's own animations,
  which throw on a keyframe offset past 1 ("Offsets must be null or in the
  range [0,1]"), and a bridge caption's range ending at 1.01 crashed the
  whole page. The Browser pane's console keeps messages across reloads and
  merges repeats, so an old error looks current: before chasing one,
  check that the chunk in its stack is in this build's
  `.next/static/chunks`. Resumes (`resume-visual.tsx`): loose
  experience-bank entries gather into
  one pile, a template is picked, the resume writes itself in Jake's look,
  then a job posting arrives and the same page is tailored to it: mock AI
  suggestions (Keep, Cut, Rewrite, Add) appear in the gutters beside the
  lines they change, each marked with `SparkleIcon`, and apply on the page
  as a highlight, a red strike or a green insertion while the match
  climbs. While the page writes itself, the status above it is a loader
  card the shape of the job card that replaces it (the team found a
  pulsing dot and a line of text too plain): a spinning ring round the
  page icon, the section being written, a percentage, and a bar along its
  foot edge, then a green "Resume ready". It keeps time from the page's own
  line count (`FIRST_LINE`, `LINE_STEP`, `LINE_FOR`), so it ends as the
  last line lands; a line added to the page needs no change there. The
  page sizes to its content; fixed to the stage's height it
  squeezed its last lines. Its Modern and Compact templates are looks the
  app does not have yet (it renders Jake's Resume only), a choice the team
  made for the page; drop them or mark them if that matters. Matching
  (`matching-visual.tsx`) follows the real score
  (`backend/app/services/matching/scoring.py`): the same student's bank is
  read into a profile, five postings are scanned for the student's skills,
  each is scored, and the top one shows its four factors (Meaning, Skills,
  Title, Experience) as bars with no numbers, since the weights are still
  guesses in the code; then the cards sort into Best Match order, the
  Jobs page's own name for it. The weak fits keep full strength once
  ranked (faded to 0.55, their 10px lines fell to 2.2:1; their scores and
  the order say they fit less), and the profile's first scene plays again
  on each loop (a `key` per reading: the board stays mounted, and from the
  second loop that scene held still). Each reading appears in the middle
  of the stage, in place: with no starting pose the card flew in from the
  stage's top left corner each time, which the team found odd. The card
  lists the bank's experiences (`profile.experiences`, the Resumes stop's
  entries), each with an icon for the job, not bare "Past titles", and its
  "Read from your experience bank" pill stays on one line (wrapped, it
  broke into two pills). Its postings name real employers, like the
  hero's cards; so do the Autofill and Updates stops, which take their
  companies from the applications board
  (`board-data.ts`), each logo a favicon tile (`favicon-logo.tsx`). Scores
  on the hero, the board and both stories are green, amber or red through
  `scoreTone` (`score-tone.ts`). Below lg the
  stops stack, because a pinned card with the resume animation does not fit
  a phone. The site's placeholder benefit grid and three steps became the
  hiring-systems section (below). A "How it works" deck of four step
  cards (Find, Apply, Track, Hear back) that flipped in turn after the
  applications section was removed on 2026-10-22, at the user's ask: it
  told the tour's four steps a third time, after the reader had seen
  each one, and made the page about 15% longer. It had carried the page's
  only "Coming soon" mark for employer replies, so the tour's Updates stop
  and the route's Interview and Job Offers stops now carry their own
  (`SoonChip` in `layout-parts.tsx`, from `soon` on the feature or the
  stage): the tracker stores no employer replies. **The statement**
  (`statement.tsx`, between the hiring-systems section and the
  applications section, after Twain's) tells one thing at a time and
  plays on its own like a carousel that loops (`useStoryLoop`): once the
  scene is on screen the beats follow one another in time, the finale
  holds about three seconds, then both columns fade, the story resets
  (bin emptied, count back to nothing) and starts again; it pauses off
  screen and in a hidden tab. The scroll plays no part: the section is a
  screen-high panel, not pinned, and nothing the scroll does moves the
  story. Cued beat by beat by the scroll, it stopped whenever the reader
  did, which the team found broken; then, pinned for 260vh with a bar per
  beat over the caption and the scroll taking it to its finale near the
  pin's end (a hand-off for the card's flight into the applications
  section), it still read as driven by the scroll, and the bars sat close
  over the gate's red chip, so the team had the bars, the pin and the
  hand-off taken out on 2026-10-22. A beat lasts about four seconds (`RATE`), so the page, its
  marks, its notes and its verdict hold together for over a second, the
  evidence its caption names: at three seconds they shared the screen for
  a quarter of one. The team found
  four captions at
  once too much text and the first scene's gates, glass bin and rubber
  stamps "AI slop". The headline, "Slop
  applications get skipped." with "Slop" under a red wavy line, runs one
  line across the top. It was "Stop sending slop applications.", a second
  "Stop" right after the hero's tagline; it now says what the three beats
  show. The wave is a layer of its own (`.slop-wave`): a
  text decoration is repainted only inside a selection's highlight, so
  selecting the headline cut off the wave's lower half. On the left only the current beat's caption shows,
  under its gate's chip; it lifts away as the next comes in, and its words
  come into focus as they are read. The chips are label-sized, each gate's
  mark on a white disc, and from lg up the marks move (`GateIcon`,
  `.gate-*` in landing.css: a scan line runs down the page, the shield
  shakes and its "!" blinks, the bot blinks and its antenna light pulses);
  the team found small chips with still icons hard to notice. The finale's
  chip is "With" and WorkIt's own logo, mark and word, its figure's head
  hopping now and then (`.workit-hop`), where it had a check and "With
  WorkIt" in text, and the screening panel's header names WorkIt with the
  logo too. The marks rest while the section is off screen (`data-paused`)
  and with reduced motion. On the right
  one screening panel for one posting (`followedJob`) reads three things
  a student sends blind, one after another: a generic resume (ATS
  filter), a copy-paste application (spam detection), a template cover
  letter (slop detection). A scan line runs down each page, the lines
  that sink it get a red mark and a note beside the page (the reason, not
  a stamp), the panel's status turns to its verdict, and the page
  crumples into a paper ball thrown on an arc into a solid wastebasket
  (never see-through: its far wall is drawn behind the balls, its body in
  front), which rocks as each lands; the balls pile at the rim under a
  count. The pages are laid out on fixed lines (`top-[..]`) so each
  note's `y` meets its line. Then the same panel reads WorkIt's
  application, `<FollowedCard stage="saved" />`, and finds it ready to
  submit, with three green checks; it sits inside the panel, clear of the
  bin. The captions, the panel's titles and
  statuses and the notes are array ranges on `opacity` and `transform`,
  so the browser runs them; the pages and balls are one pose per frame
  on `will-change` layers. The scene is drawn at a fixed size and scaled
  by `Fit`; its root is `shrink-0`, since its children are all absolute
  and, as Fit's flex child, it shrank to the column, so Fit read that
  width and never scaled it down on a phone. Below lg and with reduced
  motion it is still: every caption in a short list, then the finished
  frame; on a phone only the finale's card and checks, at their own size
  (the whole scene scaled into the column was a 58% miniature, its labels
  7px). The captions and notes are product copy: the gates' are hedged
  ("often", "look like"), since they describe the market, and the last
  one's claims follow the rules above, never a promise to pass an ATS. The site's closing "Be first in line" banner is
  removed for now. **The applications section** ("Every application, from
  saved to signed.", KAN-316) is one search's route (`applications.tsx`,
  "The home page's lower half", below): four stops, Saved, Applied,
  Interview and Job Offers, each with its stage's line and count
  (`stages` in `board-data.ts`), and under each a pile of real employers'
  logos counting the search down. Its copy says what the tracker keeps
  today: one list, each job's match score and the resume each
  application went out with. A board, a next step and a deadline per card,
  and a follow-up day are not built, so no line promises them, and
  Interview and Job Offers say "Coming soon". Its eyebrow is the
  feature's name, "Application tracker": "For applicants" said nothing
  once the whole site was for applicants. A tilted board of glass cards over
  blobs in the four stages' colours, with a stage list whose glass
  highlight slid from row to row, was here first: the team found the
  board, the card laid over its tilt and the gradient ugly, and had the
  section redrawn on 2026-10-22.
  **The hiring-system list in
  `data.ts` is a claim that WorkIt reads those systems**: it must match
  `scraper/workit_scraper/providers.py`'s `LISTING_URL`. Its logos are
  files in `public/hiring-systems/`, each from the company's own site or
  its GitHub organization, square and at least 48px: the Google favicon
  host had only 16-32px copies of BambooHR's and Workday's, which looked
  blurry. A hiring system added to the list needs its file there too.
  **The hiring-systems section** draws the job pipeline
  (`docs/job-pipeline.md`). From lg up it is a 3D scene after Twain's ring
  of logo coins (`hiring-pipeline.tsx`, "The home page's lower half",
  below); the flat stream (`hiring-systems.tsx`) is its still version,
  below lg and with reduced motion, and lends it `JobCard`. In the stream, from lg up, one lane per
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
  carries one, since two overlapped at 1024px. Below lg the columns run at
  one speed and their chips take turns across the columns, three a column,
  two columns below a 640px stream and three from it: at different speeds,
  five chips a column drifted into each other and overlapped in most
  frames on a phone, and three narrower columns met where they converge.
  A chip scales about its leading point (`origin-top-left`), so a kept one
  shrinks into the mark. `STILL_AT` was picked by simulating every width
  below lg: no chip is mid-fall or overlapping, a role is struck, and the
  first card comes out within two seconds; re-check it after changing
  lanes, speeds or postings. When a kept posting's card is already shown, the next one not
  shown comes out instead: with the same few postings going round, the
  list once sat unchanged for 15 seconds. A chip keeps its lap in a ref as
  well as state: `useTransform` sets its value again while the chip
  renders, and a listener that set state from the old lap looped ("Too
  many re-renders"). While the Browser pane is hidden it draws no frames,
  so neither `requestAnimationFrame` nor `ResizeObserver` runs and the
  stream stands still; each screenshot draws one frame (about 40ms of the
  clock), so check it with screenshots and script reads, not by waiting.
  **The hero's tagline** is "Stop ___ by hand." (`hero` in `data.ts`,
  `hero-title.tsx`), after Twain's swapping word. The team wanted one hard
  line that names the pain and the whole pipeline with matching and auto
  apply first; earlier taglines ("Tailored. Matched. Applied. Tracked.",
  "Applying to jobs shouldn't feel like a second job") each missed part of
  that. The blank loops through the pipeline in the tour's order
  (rewriting resumes, searching for jobs, filling out applications,
  tracking applications), starting on filling out applications, each
  phrase held 3.2 s (`HOLD`), and pauses off screen and in a hidden tab.
  It walked the pipeline once and rested on filling out applications, so
  that phrase showed twice and the headline then stood still, which the
  team disliked; at 2.3 s a phrase read for about a second. It starts on
  the widest phrase, so the job cards, placed against the text a second
  after load, clear every later one. A swap rolls the old
  phrase out letter by letter (tipping back in 3D and lifting, each word
  blurring as one) as the new one rolls up, the two crossing (`AnimatePresence`
  `mode="popLayout"`); "Stop" and the phrase are `layout="position"`, so
  "Stop" glides as the line changes width; a brush stroke redraws under
  each phrase. The first phrase is server-rendered and rises by CSS
  (`.hero-char`), so the headline shows before the script; screen readers
  get the whole sentence once in a hidden line, and the moving copy, which
  carries `data-hero-text` for the job cards' placement, is hidden from
  them. From lg up "Stop filling out applications" must fit one line (the
  h1's clamp size and `max-w-6xl`). Below lg a phrase wraps between words,
  the stroke goes under its last word (under the whole box it ran past the
  text), and the h1 keeps four lines' room, centred, so the subtitle does
  not jump on each swap, and "by hand." glides with the phrase. The swaps
  pause in a hidden tab, and the hidden sentence for screen readers is not
  selectable (a drag over the headline copied it as well). With reduced
  motion it rests and never swaps.
  The rise and stroke are `animation: none` there: paused at their first
  frame, as an older rule did, the subtitle and buttons stayed invisible.
  The subtitle names the steps and says the student clicks Submit.
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
  since spare stage height is what shrinks the scale. `Fit` is a motion
  element, so motion knows its scale: a `layout` move inside a plain
  scaled div (Matching's Best Match sort) started each card from its old
  place times the scale. Under 50rem of window height the tour's padding
  tightens, so the stories keep their design size on a laptop. The visual
  area's colour crossfades with the panel's, one layer per stop, siblings
  of the story so its glass still blurs them: as one gradient it changed
  in a single frame. The scene count in each title pill swaps with the
  number and caption. The pinned card
  takes the height left inside the panel's padding (flex, not a height
  worked out from the window's): sized as 100dvh minus the chrome it left
  8px to spare, and the switcher sat on the panel's top edge and the card
  ran into its bottom one. Each
  stop's blur-in ends with `filter: none` (`transitionEnd`): a leftover
  `blur(0px)` drew the stop on a surface of its own, which washed out the
  Auto Apply camera's big layer, and made it a backdrop root, which stops
  the glass blurring. Its
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
  copy, so it is hidden (`testimonial.show` in `data.ts`) until a real,
  approved quote exists: shown, it read as an unfinished site on
  production. Never fill it with an invented quote. The FAQ answers are product
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
  tour's "Learn more" links (each stop's only link: the team dropped the
  "Try it free" beside it, since the header and hero already ask for the
  sign-up) all read it, and the tour's stops take their
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
  `visual`, shows a placeholder in the feature's colour. The hero uses
  `SocialSignUpButton` (`social-sign-up.tsx`, shared with the home hero),
  the closing call to action is `ClosingCta` (`closing-cta.tsx`, shared
  with the home page; its own file so the client scenes that import
  `layout-parts.tsx` do not pull the sign-up's server action in), and the
  FAQ is `FaqList` (`faq-list.tsx`).
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
  tiers: Plus, the recommended plan, is filled violet with a straight
  "Popular" pill centred on its top edge, so no plan may take
  `overflow-hidden`. The team had a tilted "Recommended" badge made
  straight and renamed on 2026-10-22; "Popular" is a claim no sale backs
  yet (every account is on Free), so revisit it if it must be literal. Pro is white with violet pills; Free, the basic tier,
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
  page ships no script for it. **It opens with motion** (`.price-*` in
  landing.css), all CSS animations of `opacity` and `transform` from the
  server's HTML, so they play before the script loads and end on the page
  as drawn: the hero rises in (`.hero-rise`), the board's panels settle,
  Plus's strip grows down, the plan cards rise one after another (`--d`),
  the Popular pill pops on and a light sweeps once across Plus (clipped by
  its own layer, since the card may not clip). A switched price rolls in
  and the old price's strike draws, with no script: a CSS animation starts
  again each time its element is shown, so each price is an inline block
  (a transform does nothing to an inline box). Each feature row rises in,
  its feature and then each plan's cell, with its check popping; on load
  the rows follow the cards, and from lg up a row still below the screen
  waits and rises as it arrives (`RowArrival`, `data-row`). Nothing above
  the glass fades: the panels fade on themselves. The FAQ is the shared
  `FaqList` in a `FocusIn`, as on the home page, and the closing band's
  headline, line and button rise in a `FocusIn`. Still with reduced
  motion.
- **The home page's lower half** (after the tour: hiring systems, the
  statement, the applications section, the FAQ, the closing call to
  action and the footer; the testimonial is hidden) reads as one story, like the hero, bridge and tour
  above it. **One object is carried down the page**: the application the
  tour followed (`followedJob`), drawn as a tracker card by `FollowedCard`
  (`thread.tsx`; its text per stage is `followedStages` in
  `board-data.ts`, dated after the Updates stop). The statement's finale
  reads it, and it waits on the applications route's first stop and rides
  the route stop by stop to the offer, where its trip ends. A `Flight`
  once carried it from the statement's last frame onto the route, and on
  from the route to a "How it works" card: both went (the cards with
  their section, the first when the statement came to loop on its own,
  since its finale was rarely on screen as the reader moved on, and the
  card flew out of nowhere). **The applications section** (`applications.tsx`)
  pins for 280vh from lg up; the scroll cues each move to the next stop
  (`CUES`) and the move plays in time (`useSceneTime`, about 1.25 s a
  stop), so the card never rests between two stops. The card rides above
  a line through the four stops, flush with the line's ends at the first
  and last; `stageAt` in `stage-timeline.tsx` glides between whole stops,
  and the card, the line's fill and the flying logos all read it, so they
  arrive together as the stop lights. Each stop's line sits beside the
  card while it rests there (`RouteCaption`), right of it at the first
  two stops and left at the last two, where the route ends; beside the
  heading, far from the card, the team found it out of place. Each stop
  has its own caption, fixed at that stop, shown only while the card
  rests on that stop once the section has pinned: it fades in just
  after the landing pop and out as soon as the card moves, so no caption
  changes its words or side while it can be seen. One caption that
  swapped both glitched: the card's stage changes at the landing, and
  that caption had already faded back in with the old words, then
  swapped them and jumped sides in view. The piles hold each stage's count (24, 12, 4, 1) from one
  list, `LOGOS`, furthest first, so every logo that reaches a stop came
  from the pile before and the last one is the followed application. A
  logo going on waits on the pile before, exactly over its twin so it
  cannot be seen, until that pile is reached, then flies on an arc; the
  piles' places are plain arithmetic from the stops, nothing measured but
  the route's width. One violet runs the route; the stage colour shows
  only in the card's chip and ring: the team found the old four-colour
  gradient ugly. Under 800px of height the card is drawn at 78% so the
  heading, route and piles fit at 1280 × 720. `Burst` keeps its 0.55s
  delay for the Updates stop; the route passes its own. The tracker
  card's next step fits one line at every stage (Saved's reads "Apply with
  tailored resume"), so the card keeps one height (`CARD_HEIGHT`): on two
  lines at Saved it stood taller and its top dropped as it moved on. Its
  new words come in as the old ones finish going (`swap`'s delay):
  `popLayout` ran both at once, and two lines showed through each other.
  Below lg the stops are a still list with full piles and the card at its
  offer.
  **Headings come into
  focus** through `FocusIn` (`focus-in.tsx`): an observer marks the
  wrapper and a CSS transition ends at the element's own `filter: none`.
  A scroll-driven `view()` animation was tried first: under a pin, Chrome
  placed the heading's view timeline hundreds of pixels off and it stayed
  blurred for most of the pinned stretch. The FAQ's list sits in a
  `FocusIn` too, so its rows rise in one after another, in time (`--i`
  on each row); on `view()` each row was scrubbed over its own few pixels
  at the screen's foot and stopped half faded there. Its answers are in
  the body colour (`ink-muted`), its questions `text-lg`: in the meta grey
  at body size the list read faint. The page ends, as every feature page
  does, on a closing call to action (`ClosingCta` on the brand's
  backdrop; its copy is `closing` in `data.ts`, the FAQ's "How do I get
  started?" claim): without it the FAQ ran into the footer and the only
  sign-up buttons were in the hero and the header. **Hiring systems**
  (`hiring-pipeline.tsx`), at the user's request after Twain's ring of
  logo coins, comes right after the tour, before the statement: it is
  where the postings come from, the proof behind the bridge's flood and
  Matching, and it names the systems whose filter is the statement's
  first beat. At the page's end it read as an afterthought, just above
  the FAQ's "Where do the jobs come from?". It pins for 220vh in a grey
  panel: the seven hiring systems
  come in as thick coins (CSS 3D: a face, three stacked discs for the
  edge, a back, under the stage's `perspective`; seven discs read the
  same at every angle but edge-on) and keep tumbling in a slowly turning
  ring beside the heading, on their own clock (`useLoopClock`), for as
  long as the reader rests there: scrubbed by the scroll, the ring froze
  whenever the reader stopped. The clock alone turns them, at one steady
  pace (`ORBIT`, `TUMBLE`), whether or not the page moves: the scroll
  added its own turn as the section came up, so the coins spun fast while
  scrolling and crawled once the reader stopped. The scroll's cue, a third through, sends
  each coin to the pipe, in time, to turn side-on as a coupling; the
  glass pipe grows out to WorkIt's mark, and the postings flow. The
  ring's clock stops while the coins fly, so their landing turns, reckoned
  from the ring, hold still. Each coin carries its logo on both faces and
  stands near upright, a few degrees askew: turned with its place on the
  ring, a logo stood on its side or upside down, and the blank back hid it
  for half the tumble. The
  couplings sit together at the intake end like a manifold: spread along
  the whole pipe they hid most titles. The postings ride a conveyor of
  evenly spaced places (`SPACING`), each given to the hiring systems in
  turn and shown from that system's coupling on, so they never overlap
  in the one pipe; a senior role is struck through and filtered out
  before the mark, a kept role goes in and comes out as a `JobCard` as it
  folds into the mark: sent at the end of its lap, out of sight past the
  mark, a card came some six seconds after its posting and read as
  unrelated to it. The pipe fills from the couplings when the flow first
  runs (`fresh`): shown at once, three postings popped in mid-pipe; a
  return to a running flow fades it in. The flow's clock runs only once
  the pipe has formed, in view and in a visible tab. The pipe starts just behind the first coupling, whose coin
  hides its end: an open-end ellipse there, and later the bare rounded
  end, read as a stray circle. WorkIt's mark is plain glass on the grey,
  with no violet glow behind it (the team found it decorative). A card
  comes at most every `CARD_GAP` (2.8 s), so each settles before the
  next; `JobCard` takes the `ref` that `AnimatePresence`'s `popLayout`
  passes (dropped, a leaving card could not pop out and the rest jumped)
  and animates its position only. The copy says "freshest", never the
  scraper's 3-hour schedule, at the team's ask, and the diagram labels
  only its two ends, "Company job boards" and "Your Jobs page", in one
  annotation style (`DiagramLabel`: small capitals set wide, in the body
  grey, since the meta grey spaced 0.14em read faint on the tinted
  panels); the team found a bold label with "Always fresh" beside it and a "Sorted by
  Best Match" note cluttered. The first coin's edge and the left label
  sit on the heading's left edge. A posting pill has a fixed width
  (`PILL_W`), so its right edge is known: it stops `MARK_GAP` short of
  WorkIt's mark and a kept one folds into it from that edge; sized to
  its title, a pill slid under the mark. Its level (Intern, New Grad,
  Co-op) stays whole while the role before it is cut short: it is why
  WorkIt keeps the posting, as "Senior" is why it drops one. The testimonial's panel grows into place (`GrowIn`, a
  scale only: a fade or filter on a panel would make it the backdrop root
  of the glass inside; a `transform` string over an offset the browser
  can express, so it runs as a scroll animation, below). The testimonial reads word by word, in
  time, once it is well on screen (`useArrived` in `hooks.ts`), and keeps
  its placeholder copy, hidden for now. The footer,
  on every marketing page, closes on "workit" (the logo's own outline,
  `LOGO_WORD` from `components/logo.tsx`, as a CSS mask) filled with
  HTML rows of the page's job titles, the followed one in the pale
  brand violet a weight up, which slide in from alternate sides, in time,
  once 60% of the word shows (`footer-wordmark.tsx`, `useArrived` with a
  threshold: a line a third up the screen was out of reach on a tall
  window), then keep drifting slowly (`.wordmark-drift`, a track of the
  titles twice moved by half its width), paused off screen. It opens on
  `site.tagline`, which is also the home page's title, so it speaks to
  students ("Your job search, without the busywork."): the site's
  two-sided pitch to recruiters went while the business side is hidden.
  The footer marks the Resources pages Soon, as the header's menu does: none has a
  page yet. **Below lg
  and with reduced motion every one of these is still**: no pin, no
  flight, no heading blur, the finished frame. Two exceptions below lg:
  the statement still follows its section through the screen, and hiring
  systems falls back to the flat stream, which keeps flowing. **Checking these scenes in
  the Browser pane**: a script's `scrollTo` jumps, but a Lenis glide still
  under way overrides it, so start from a still page; the pane draws
  frames lazily, so a screenshot after a script scroll often shows an older
  frame and motion values and rects read by script are stale. A real
  wheel scroll (the computer tool's scroll) draws fresh frames; scroll by
  script, then wheel one notch, then look. IntersectionObservers and CSS
  transitions wait for frames too: take a screenshot before reading
  `data-paused` or a transitioned colour. Each screenshot draws one frame,
  so a scene on a clock (the pipe's flow, the statement's loop, a held
  scroll) moves about 40ms per screenshot: take a batch of small ones to
  move it on.
- **Scroll cues, time plays.** The home page's scenes move on their own;
  the scroll only takes the reader to the next phase. The team disliked
  scenes scrubbed by the scroll, which froze half way through a move
  whenever the reader stopped (a ball in mid-air, the card between two
  stops, the coin ring standing still). So:
  - A scene that tells a short story the reader should see whole (the
    statement) plays it on its own and loops, like a carousel, and is not
    pinned: the scroll plays no part in it.
  - A pinned scene's poses read a timeline from `useSceneTime`
    (`scene-time.ts`): once the scroll reaches a phase's cue, the scene
    plays the whole phase in time and rests at its end; scrolling back
    plays it back. A cue holds until the scroll is 0.02 short of it, so a
    reader resting on its line does not set it going to and fro. Pick a
    cue's `to` where nothing is half done: a scene resting half way
    through a move is the bug this fixes. A label that changes at a
    phase's boundary swaps just after it, never before: the statement's
    beats rest on their boundary, and with the swap before it a resting
    beat showed no caption, title or verdict (`fadeWindow`).
  - A phase that should keep moving while it rests runs its own loop on
    `useLoopClock`, stopped off screen and in a hidden tab: the coin
    ring, the pipe's flow, the bridge's floating postings (CSS).
  - A reveal on arrival (the testimonial's words, the footer wordmark's
    rows, the headings' and the FAQ's `FocusIn`) plays in time once the
    element is well on screen (`useArrived`), and resets only once it is
    wholly below the screen, with a second observer: one observer that
    reset at the arrival line undid reveals in full view whenever the
    reader scrolled back a little.
  - Still scroll-linked, by design: the flight that carries the bridge's
    step pills into the tour's tabs (both ends move with the page), and
    entrances that track their section's position (the tour panel's and
    `GrowIn`'s scale).
  - Timeline values from `useSceneTime` are animated by script, so their
    transforms run on the main thread while a phase plays and cost
    nothing at rest; the array-range rule below matters for what is
    still scroll-linked.
- **The marketing pages scroll smoothly with Lenis** (`smooth-scroll.tsx`,
  mounted by the `(landing)` layout): a wheel or trackpad glides to rest.
  Touch stays native and reduced motion turns it off. It ticks in motion's
  `frame.setup`, before motion reads the scroll; in `frame.update`, as
  Lenis's docs show, every scroll-linked value ran a frame behind and the
  flying card and pills trailed their ends. A script scroll goes through
  `scrollPageTo` (a native smooth scroll fought the glide), which
  measures the page again first, since Lenis clamps a scroll to the
  height it measured up to 250 ms before; a scroll area inside a page
  needs `data-lenis-prevent` (the phone menu has it). Its CSS is in
  landing.css, not `lenis/dist/lenis.css`, whose `html.lenis { height:
  auto }` undid `h-full` on `<html>`. The pages set no `scroll-behavior:
  smooth`: Lenis glides the wheel and in-page links, and on `<html>` it
  animated every jump a script made.
- **Each marketing page keeps its place across navigations**
  (`smooth-scroll.tsx`): a link to another page opens it at its top, a
  link with a #section lands on that section under the header, and Back
  and Forward return to where the reader was on that history entry (the
  Navigation API's entry key, or the URL where the API is missing), kept
  in sessionStorage (`workit:landing-scroll`) so a return from another
  site does too. A reload starts at the top, or at the URL's #section,
  where the hero's intro and the pinned scenes start: restoring the
  reader's place on a reload was tried first, and the team found it
  wrong for these pages. The key is not the seeker shell's
  `workit:scroll` ((seeker)/scroll-memory.tsx, which keeps its places in
  another shape): one shared key left each side reading the other's
  data, and the Jobs feed lost its place after a visit here. While these
  pages show,
  `history.scrollRestoration` is "manual", and it is set back on leaving
  them. A place is saved on each scroll, and also as a click lands and as
  the page is left: a scroll's own event waits for the next frame, so a
  link clicked right after a scroll could leave before its place was
  kept. A return is held each frame until the page can reach it and its
  height stands still (a second and a half at most; the reader's own
  scroll ends it), since the home page grows after it mounts: held only
  until the height stood still, a return to its foot stopped 280px short.
  Before this, `scroll-behavior: smooth` animated Next's move to a new
  page's top, so a page showed its foot and scrolled up; Next skips that
  move when the new page's start is already on screen, so a short page
  opened from the footer stayed at its foot; and the browser restored a
  place before the home page had grown, so Back stopped short.
- **Type on the marketing pages.** Plus Jakarta Sans is 1.26em tall
  (ascent 1.038, descent 0.222), taller than any display line, so a
  wrapped heading's lines overlap by a few pixels. The selection
  (`.landing ::selection`) is see-through, 14% of the brand violet, so a
  line's highlight tints the letters of the line above where they reach
  into it: the opaque brand-100 cut off their descenders (g, p, y).
  Headings that wrap at 30 to 36px (`SectionHeading`, the footer tagline,
  the tour's stop headings, the closing call to action on a phone) take
  `leading-tight`, which clears the overlap; display lines (the hero,
  the statement, the bridge) keep 1.08 and rely on the see-through
  selection. A decoration that hangs below the line is drawn as a layer
  of its own (`.slop-wave`), since a selection repaints decorations only
  inside its highlight. Labels at 12px and under on a tinted panel or on
  glass use `ink-muted`: there the meta grey fell under 4.5:1 (the
  pipeline's labels and step captions, the tracker card's lines, company
  lines, Soon chips, the tour's scene count); on plain white `ink-meta`
  holds 5.6:1. White text
  sits only on a fill that holds 4.5:1: `positive-ink`, not `positive`
  (2.8:1), and ink, not white, on the amber fill. The header's links tint
  their box on hover (`NAV_ITEM`), as the menus' items do: slate-800
  darkening to ink was too slight to see.
- **Scroll-driven motion stays cheap, or the page lags.** A team member
  found the home page laggy; an audit traced it to these, now rules:
  - Motion hands a scroll-linked value to the browser (it runs off the
    main thread) only for the keys `opacity`, `filter`, `clipPath`,
    `transform` and `backgroundColor`, from `useTransform` with array
    ranges, not chained, on an HTML element, over a `useScroll` offset the
    browser can express. So a scale or a rise is a `transform` string
    (`["scale(0.9)", "scale(1)"]`), never `scale`, `x` or `y`, which
    always run as script; `["start end", "start 0.3"]` cannot be
    expressed, `["start end", "start start"]` with a `[0, 0.7]` range can.
    An array range is fixed at first render, so a value that switches
    after mount goes in the style (`moving ? grow : "none"`).
  - A function transform runs every scroll frame, so derive one pose per
    element per frame (`useTransform(p, v => poseAt(v))`, then each part
    from it), not one call per part.
  - An element moved by script gets `will-change-transform`, so the move
    is composited instead of repainting what is under it.
  - No filter left on at rest: end a blur on `"none"`, never
    `blur(0px)`. Never animate a blur per letter, nor per word in a
    scroll-driven scene; the hero tagline blurs its two or three words as
    a swap plays, while its letters only roll.
  - Animate transforms, never `top`, `left`, `width` or `height`: a bar
    that fills is drawn at its full length and grows by `scaleX` from
    its left end (the applications route, Matching's factor bars, Auto
    Apply's upload bar, the hiring-systems strike), and a sweep moves by
    `x` on a layer the size of the card it crosses.
  - Nothing scroll-linked is SVG: the browser never moves SVG content on
    its own layer, so the footer wordmark's 29 rows of titles (some
    12,000 glyphs, once SVG text under a clip path) repainted the whole
    word on every frame. They are HTML under a CSS mask of the outline.
  - Never fade a `preserve-3d` root: below full opacity it flattens. The
    hiring-systems coins fade their faces, and each coin's pose is one
    `transform` string a frame.
  - An endless loop is a CSS animation of a transform (`.tour-*` in
    landing.css: the Resumes loader's ring and sheen, the Updates scan
    and typing dots), never a motion `repeat: Infinity`, which runs
    script on every frame it shows.
  - Loops stop off screen: the hero city's 67 SVG animations pause through
    `data-paused` (an IntersectionObserver, with `!important` over each
    piece's `animation` shorthand). The city's wireframe glow stays an SVG
    blur filter: a wide faint stroke in its place was tried and read as a
    hard band, not a glow.
  - Logos from the Google favicon host load `unoptimized`: they are
    small PNGs already, and some 60 each went through `/_next/image`.
  - Write a `data-*` mark on `<html>` only when it changes.
- **The legal pages, `/privacy` and `/terms`, are drafts awaiting team
  review**, in `app/(landing)/` on the shared `legal-page.tsx` shell (one
  readable column of text; the group's layout draws the header and footer
  around it, so the shell draws neither) and linked from the footer's Legal
  column. Google's OAuth brand verification
  needs both public on the site's own domain, so they render signed out and
  no redirect may catch them. Each sentence describes what the code does
  today; a business or legal decision stays a `TeamToDecide` placeholder,
  never a guess. A change to what WorkIt collects, shares or sends to a
  model updates `/privacy` in the same change, with `LEGAL_UPDATED`.
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
- **The application tracker is live and has no fixture** (KAN-261), and
  its page shows as the Tracker (KAN-342: "Tracker" in the sidebar,
  "Application Tracker" as its heading) while its URL and code keep
  `applications` (`docs/screens.md`, Applications). Saved
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
  dated events stay empty until the API stores them (the Dashboard's
  Interviews number is a dash, KAN-342); a failed read shows an error, never
  stand-in cards. The Dashboard's four numbers are all live and all links
  (KAN-342); its Good Matches reads the Best Match scores
  (`getGoodMatchDates`), and it lists no jobs of its own. A job's application
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
- **A job posting's page has a rail of jobs beside it** (KAN-297), drawn by
  `(seeker)/jobs/layout.tsx` so it survives job-to-job navigation. It reads
  the list `FeedList` last showed (`jobs/shown-list.ts`); a new list screen
  whose cards open job pages writes it the same way, or the rail shows the
  last /jobs or /search list (`docs/screens.md`, Job posting page). Every
  reader that pages a list of roles goes through `nextPage`
  (`jobs/list-pages.ts`), which picks the action for the list's order and
  counts the offset; the feed and the rail each had a copy until the
  KAN-297 review. A list kept for the session builds on `sessionStore`
  (`jobs/session-store.ts`), as the feed's Load More pages and the rail's
  list do, and ages by `LIST_FRESH_FOR`. The rail checks its list's age on
  every job opened, not once: checked on mount only, it sat on its skeleton
  for good once the list passed half an hour, since it stays mounted.
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
- **Icons are Phosphor's, from `@phosphor-icons/react/ssr`** (KAN-350),
  through the wrappers in `components/icons.tsx` or a route's own
  `icons.tsx`. Lucide is gone (it read as every AI app's default) and the
  lint refuses `lucide-react`, and Phosphor's main entry too: its icons read
  a React context, so a server component that imported one would fail.
  Phosphor adds no `aria-hidden` and fills by `weight`, never by a `fill`
  class, which paints the whole glyph. A glyph Phosphor lacks goes in
  `components/custom-icons.tsx` with all its weights (`docs/design.md`,
  Brand and icons).
- **One mark for Scout and AI, `SparkleIcon`** (`components/icons.tsx`,
  KAN-257): every Scout or AI control, and Scout's mark in the chat and
  the panel header, draws it. An ESLint rule refuses Phosphor's sparkle
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
  and must match `scraper/workit_scraper/logos.py`. With the optimizer on, an
  unlisted host throws and fails the whole page (on Vercel); where
  `images.unoptimized` holds (Cloudflare, Deployment), the list is not checked, so keep it current anyway. It
  measures each logo on load: a square mark
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
  lockfile diff for removals after adding any dependency. Adding Lenis
  only cleared `"dev": true` on `sharp`'s `@img/*` packages (`next`
  depends on `sharp` too), which is correct and removes no entry.
- **A saved timestamp becomes a calendar day in the browser, never on the
  server.** The server runs in UTC, so a day computed there is a day off for
  the Americas. Swap the local day in after hydration (`useSyncExternalStore`);
  `LocalDate` and `When` in `(seeker)/local-time.tsx` do it for a seeker
  screen. `formatDate` in `lib/format-date.ts` formats in UTC and suits
  date-only strings only. A `"use client"` component is no exception: the
  server renders it first. The Resumes view's "Uploaded Oct 21" (server)
  against "Oct 20" (a browser in the Americas) broke hydration with React
  error #418 (2026-10-22). `toLocaleDateString()` in render is safe only for
  data fetched in an effect.
- **A relative time ("Posted 5 minutes ago") rendered in a client component
  sits in an element with `suppressHydrationWarning`**, as the job card's
  badge does. The clock moves between the server render and hydration, so
  the text can differ by one unit; the flag covers that element's own text
  only, so keep it on the innermost one.

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
- **The Experiences view shows one resume at a time** (KAN-343,
  `../docs/bank_by_resume.md`): a dropdown of every uploaded, base and
  tailored resume, opening on `?resume=`, else the starred resume, else the
  newest. The rules (which items a pick shows, the opening pick, the "Also
  used in" line) live in `(seeker)/bank/holdings.ts` and read only the
  API's `resume_ids`; never work out a resume's items in a component.
  Intake always gets the whole bank. A
  new entry or skill saved under a resume pick is on no resume yet, so the
  page says where it went instead of letting it vanish.
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
  `renderResumePdf` (base64 and its `file_name`), the Word file and the
  PDF's LaTeX source through `downloadResumeFile(id, "docx" | "tex")`
  (`lib/built-resume-actions.ts`), saved by the
  browser from a Blob (`resumes/download-menu.tsx`). Until KAN-267 every
  download went through `sendBuiltResume` and kept a sent resume in
  Storage, so the bucket filled with files no employer saw; that action is
  gone. The missing-character warning still holds a PDF until Download
  Anyway. Pick a Resume is hidden for now (`frontend/docs/screens.md`, Job
  posting page): Apply Now opens the employer's page and asks "Did You
  Apply?", whose Yes keeps the pick through `applyWithResume`. It went through
  `applyWithResume` (KAN-220) at Apply wherever it
  sits: the job posting page and the feed cards on /jobs and /search
  (KAN-290). It keeps its sent resume: the student
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
  `account-menu.tsx` and in Settings, by Delete Account, and on the login
  page, which an expired session also reaches. A draft stored under any other key outlives sign-out.
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
  Resumes & Experiences, Scout's panel, applicant onboarding, Settings,
  company screens), read its section in `docs/screens.md`.
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

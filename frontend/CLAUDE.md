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
- **`public/_headers` gives `/_next/static/*` a one-year immutable cache**
  (KAN-368). OpenNext copies `public/` into `.open-next/assets`, and wrangler
  reads `_headers` there without uploading it as an asset. Without it, hashed
  chunks, CSS and fonts went out with `max-age=0, must-revalidate` and every
  full load paid a 304 round trip per file (28 to 53 ms on workitjobs.ai).
  Never widen it past `/_next/static/*`: HTML and un-hashed `public/` files
  would stop updating for users after a deploy. Vercel ignores it. After a
  deploy, `curl -sI` one chunk, one CSS file and one woff2 and look for
  `immutable`.
- **Still open: on Cloudflare the prerendered marketing pages render per
  request** until an incremental cache is set (OpenNext's default is the
  "dummy" cache), so the prerender gain below is full on Vercel only
  (KAN-368).
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
  tour comes up the tour's own tabs take off from those four pills and
  fly into its tab bar (`useTabFlight`, used by `PinnedTour` with the
  pin's entry progress; KAN-368): once the tour has risen to `TAKE_OFF`
  each tab jumps to its pill's place, looking as the pill does (white,
  with its colour ring), and flies to the bar in time, one after another,
  shedding the ring and, but for the first, the white fill; below
  `FLY_BACK` they fly back. The tabs live in the tour's panel, so they
  move with the page as the browser scrolls it (the panel is not clipped,
  its backdrops are, so the tabs can start above it). Two earlier
  versions placed copies on a fixed layer by script on every scroll:
  between the two ends through an ease, they sank past the rising bar and
  came back up with it; held still and then carried by the bar, they
  bunched with their rings touching over the panel's edge. Both trailed
  the page by a frame once the wheel went native, which read as a glitch.
  A flight runs once each way, and only the latest one settles: started
  again on each scroll step, an older run's end settled the tabs mid
  flight. The flight marks `<html>` with `data-tab-flight` (idle, flying,
  landed); landing.css hides the bar until the tabs take off and the
  bridge's pills once they have, so each pill is drawn once, and keeps
  the bar bare (no fill, no ring) while they fly; with no flight the
  attribute is absent and the tabs show. With reduced motion it is a still block, no pin.
  **Below lg it is its own scene, `ScrolledBridge`** (KAN-368): the same
  three lines, one at a time, over a 330px stage on a short pin (150svh),
  the scroll cueing each phase through `useScrollCue` (`scene-time.ts`):
  eight postings strewn two to a band, tilted and a touch smaller or
  larger (`SCATTER`), the three that fit sorting into a centred column
  with their scores by the company, then the four steps lighting. Every
  card is one size and placed so none covers another's text at 320 to
  430px: twelve cards in three columns, the fit ones wider, buried each
  other, and two even columns read as a table. Unpinned, the 520px section
  left the screen before its last phase; a timed loop played whether or
  not the reader scrolled, which the team rejected. The four tabs' labels, icons and colours are one list,
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
  stops are one row that swipes sideways, a stop at a time, the next
  peeking in, with a 44px dot per stop under it (`StackedTour`, KAN-368),
  because a pinned card with the resume animation does not fit a phone:
  stacked, they took 3,290px of a 390px phone. A story's root is
  `shrink-0`: as `Fit`'s flex child it shrank to its title's 380px, so
  `Fit` scaled it too little and its 520px scenes were cut at the panel
  (the Auto Apply window, the Matching card). Where `Fit` draws a story
  smaller, its scene title grows back by as much, up to the stage's width
  (`FitScale`, story.tsx), so the line that tells the scene reads at about
  12px on a phone; the scene's own details stay small. The site's placeholder benefit grid and three steps became the
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
  hand-off taken out on 2026-10-22. A dark panel that opened out to the
  window's edges as it came up (a scroll-linked clip path) was tried on
  2026-10-25, to set this section apart from the light ones round it; the
  team found its background and transition odd, and it went back to the
  light panel. A beat lasts about four seconds (`RATE`), so the page, its
  marks, its notes and its verdict hold together for over a second, the
  evidence its caption names: at three seconds they shared the screen for
  a quarter of one. The team found
  four captions at
  once too much text and the first scene's gates, glass bin and rubber
  stamps "AI slop". The headline, "Slop
  applications get skipped.", runs one line across the top from lg up.
  "Slop" is drawn as AI slop (`SlopWord`, slop-word.tsx, KAN-368): a
  glossy magenta-to-cyan gradient with a pink glow, a sweeping gloss,
  twinkling sparkles and goo dripping off the letters, picked by the team
  from six treatments over a red spell-checker wave they found too plain.
  It is still text for screen readers and copying. Its drips run only as
  far as the room under the headline allows (`--reach` in landing.css:
  0.4 on a phone, where "get skipped." wraps under it, 0.6 on a tablet,
  0.7 from lg up, with `pt-14` above the first caption's chip), stop
  with the section's loop (`data-paused`) and hang still with reduced
  motion. It was "Stop sending slop applications.", a second
  "Stop" right after the hero's tagline; it now says what the three beats
  show. On the left only the current beat's caption shows,
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
  width and never scaled it down on a phone. Below lg it loops too, in
  one column (`CompactStatement`, KAN-368): the beat's caption over the
  screening panel alone, without the bin, drawn at about 0.85 on a phone,
  a thrown page leaving the panel's edge (the whole scene scaled into the
  column was a 58% miniature, its labels 7px, which is why phones showed
  it still until then). With reduced motion it is still: every caption in
  a short list, then the finished frame. The captions and notes are product copy: the gates' are hedged
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
  Interview and Job Offers say "Coming soon". Its heading is centred over
  the route, and the FAQ after it holds its heading on the left while the
  questions pass on the right (lg up), so neighbouring sections open
  differently (KAN-368). Its eyebrow is the
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
  role goes in and comes out as a glossy card on the Jobs page side,
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
  which rise as violet wireframes with a job tag. **It is drawn as layers**
  (`getLayers`, KAN-368): each run of still buildings is one image (an SVG
  document as a blob URL, made once per build), and the pieces that move
  (the six towers and the two pulsing wireframes) are small inline SVGs
  between them, split where they fall in the draw order, so every building
  in front of a tower stays in front; the ground, streaks and pools are
  one inline SVG under them all. One inline SVG of some 5,700 paths made
  Chrome's per-frame re-layering of the page take 12 to 20ms on an M1
  wherever the city was within reach of the screen (the hero, the bridge,
  the tour), so the main thread was 69 to 99% busy at rest and frames fell
  to 25 to 40 a second; an image is one item to it, and re-layering is now
  0.6ms, the main thread 12 to 24% busy at rest, and a trackpad scroll
  down the page holds 60 frames a second. The buildings' colours and line
  weights are `LOOK` in hero-city.tsx, written into each image (which
  landing.css cannot reach) and into the page for the live layers; keep
  them there. The city shows once its images have loaded
  (`data-ready`), so the towers never stand alone on bare ground. The
  images snap to whole device pixels and inline SVG does not, so a still
  building can sit up to one device pixel from where one inline SVG drew
  it; the towers and ground match exactly. The strip's viewBox starts
  100px above the ground's origin (`STRIP_TOP`): the tallest side towers
  reach there and were once cut flat at the top. The ground grid runs ten
  rows behind the back row of buildings and fades out towards the text, so
  it reads as a plane behind the low centre. Its heights are capped per
  column so nothing reaches the text at its 1600px design scale. The cap
  slopes between the text's steps (`SLOPE`) and towers ease into it
  (`soft`): cut flat at four stepped caps, the skyline stood in terraces
  with sharp corners near the middle; it keeps
  that scale from lg up (cropped at the sides) and shrinks to the panel's
  width below lg, under the text. **Below sm a phone gets its own build**
  (`buildCity({ phone: true })`, KAN-368): twice the panel's width with
  only the middle half shown, about 1.7 times the scale, so it builds that
  half alone, with the skyline's shape across it, no text caps (on a phone
  the city sits under the buttons) and the wireframes moved in from the
  cropped sides, of which only the left side's send up a job card: with
  both sides' cards, one from each side showed at once and they overlapped
  in the middle in half of all frames. page.tsx's spacer grows to match
  (`h-[70cqw]`). Shrunk
  whole to a 390px phone, the city was a 150px strip at 23% scale with
  bare ground in the middle, which read as too small. A change to the hero's text size or the
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
  titles). Their fade runs on the tag's children, never the tag itself:
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
  the five slugs and the page's `notFound()` makes any other a 404; the
  metadata comes from each content file). **Never set `dynamicParams = false`
  on a prerendered dynamic segment here** (KAN-368): an unlisted value then
  matches no route, Next falls through to the seeker `@modal/[...catchAll]`,
  which matches every path, and a signed-out visitor lands on `/login`
  instead of the 404, and `features/feature-page.tsx`
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
  FAQ is `FaqList` (`faq-list.tsx`). **Every pair of social buttons has
  "Or sign up with email" under it** (`EmailSignUpLink`, to /signup), and
  below sm the header shows a short "Get started" beside the menu button
  (KAN-368): with Google and LinkedIn alone, a student with neither found
  the way in only inside the phone menu. **Tap targets reach 32 to 48px
  without changing the look**: an FAQ row's padding is its summary's, so
  the whole row opens it (on the `<details>` only a 28px strip did), and
  the footer links, the tour's "Learn more" and the email link widen
  their tap with an `::after` (18 to 23px boxes before).
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
  swapped them and jumped sides in view. The logos come from one list,
  `LOGOS`, furthest first: the first `count` of each stage (24, 12, 4, 1)
  reach it, so every logo that reaches a stop came from the pile before
  and the last one is the followed application. **Each logo is drawn once
  and moves** (`MovingTile`, KAN-368): as the card glides to a stop, the
  logos going on fly there from the pile before on an arc, and the ones
  that went no further close up behind them, so at the offer the piles
  hold 12, 8, 3 and 1, each role in one place. A copy once flew on from
  over its twin and left the twin behind, so every role that went on sat
  in two piles, which the team read as duplicates. The stage chips keep
  the totals that passed through (24 roles, 12 sent). The stops ahead show
  dashed slots where their logos will land, gone once they have. The
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
  Below lg the stops are a still list, each with the logos left there at
  the route's end (`leftAt`), seven at most and a "+N" (`STILL_PILE`; the
  full piles, 24 and 12 tiles, read as noise on a phone), and the card at
  its offer.
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
  the FAQ's "Where do the jobs come from?". **It slides up over the
  tour** (KAN-368): the tour keeps its last stop pinned for
  `TOUR_COVER_VH` more (`layout-parts.tsx`), and this section starts that
  far up the page, so its panel rises over the tour's while the tour sinks
  back (scaled to 0.94, shaded by a layer over it, since a filter would
  stop its glass blurring) and fades as the cover ends: once unpinned it
  scrolled away in the strip above this section's panel. The panel casts
  a soft shadow on the tour as it comes (a blurred ellipse under its top
  edge, faded as it pins): without it the grey edge barely showed and the
  cover read as a fog. The tour reads the cover's progress from a box
  the cover's height at the foot of its pin: a box of no height gave the
  browser's view timeline nothing to measure, it stood at its end, and
  the tour vanished at once and left the screen blank, which read as an
  abrupt cut. Both read the one constant; with reduced motion neither
  moves. It pins for 220vh in a grey
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
  return to a running flow fades it in. So the fill is quick, the
  conveyor starts with a place at the last coupling, where the coins end,
  and on the first lap each place takes the coupling just ahead of it
  (KAN-368): started at the pipe's end with the systems in turn, only one
  posting could come out, behind the coins, and the first one cleared
  them 7.1 s after the scroll's cue (now 1.5 to 1.9 s, then one about
  every 2.7 s). Where a place is compared with the coupling it starts
  on, the test allows a pixel (`EPS`): the first place starts exactly on
  the last coupling, and rounding put it a hair past on some frames and not
  on others, so the first posting flickered on and off all the way down
  the pipe. The flow's clock runs as soon as the pipe has formed
  (`PIPE_IN`'s end), in view and in a visible tab. The pipe starts just behind the first coupling, whose coin
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
  titles twice moved by half its width), paused off screen. Its copyright year is `new Date().getFullYear()` read
  on the server, so on a prerendered page it is frozen at build time and
  rolls over with the first deploy after 1 January (KAN-368). It opens on
  `site.tagline`, which is also the home page's title, so it speaks to
  students ("Your job search, without the busywork."): the site's
  two-sided pitch to recruiters went while the business side is hidden.
  The footer marks the Resources pages Soon, as the header's menu does: none has a
  page yet. **Below lg
  and with reduced motion every one of these is still**: no pin, no
  flight, no heading blur, the finished frame. Exceptions below lg: the
  bridge plays on a short pin, cued by the scroll; the statement loops in
  one column; the tour swipes; and hiring systems falls back to the flat
  stream, which keeps flowing. **Checking these scenes in
  the Browser pane**: a script's `scrollTo` jumps, but a Lenis glide still
  under way (an in-page link's) overrides it, so start from a still page; the pane draws
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
  - Still scroll-linked, by design: entrances and exits that track their
    section's position (the tour panel's and `GrowIn`'s scale, the tour
    sinking under the hiring-systems section). The bridge's hand-off to the tour's
    tabs is cued by the scroll and plays in time.
  - Timeline values from `useSceneTime` are animated by script, so their
    transforms run on the main thread while a phase plays and cost
    nothing at rest; the array-range rule below matters for what is
    still scroll-linked.
- **The marketing pages run Lenis with the wheel left native**
  (`smooth-scroll.tsx`, mounted by the `(landing)` layout;
  `smoothWheel: false`, as twain.ai runs it, KAN-368): Lenis glides
  in-page links and script scrolls only. Its wheel glide, on until then,
  moved a 300px notch 70 to 100px in the first 50ms, took about 250ms to
  get 90% of the way and drifted on for over half a second after a fast
  scroll, and the team felt it as lag; the native wheel lands at once.
  Do not turn it back on to smooth a scene: a pinned scene that looks
  steppy under a notched mouse wheel is a scene to fix. Touch stays
  native and reduced motion turns Lenis off. It ticks in motion's
  `frame.setup`, before motion reads the scroll; in `frame.update`, as
  Lenis's docs show, every scroll-linked value ran a frame behind and the
  flying card and pills trailed their ends. A script scroll goes through
  `scrollPageTo` (a native smooth scroll fought the glide), which
  measures the page again first, since Lenis clamps a scroll to the
  height it measured up to 250 ms before; a scroll area inside a page
  needs `data-lenis-prevent` (the phone menu has it). Its CSS is in
  landing.css, not `lenis/dist/lenis.css`, whose `html.lenis { height:
  auto }` undid `h-full` on `<html>`. The pages set no `scroll-behavior:
  smooth`: Lenis glides in-page links, and on `<html>` it animated every
  jump a script made.
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
- **A solid card on the marketing pages is `.gloss-card`** (landing.css,
  KAN-368): a white body shading to a pale violet at its foot under a top
  sheen, a hairline lit from above and a stack of soft shadows. It
  replaced `bg-white` with a 5% ring and one shadow, which the team found
  flat ("basic white cards with borders"). Glass (`.glass-card`) is for a
  card over colour, where its blur has something to show; over a grey or
  white panel it read as that same flat card. An element with it carries
  no `ring-*` or `shadow-*` utility, which would replace its shadows, and
  paper (a resume page, the statement's pages) stays flat paper.
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
  - Keep big vector art out of the DOM when it does not move: Chrome
    re-layers the whole page's paint on every frame anything repaints, and
    each element within reach of the screen adds to it, so thousands of
    SVG paths slowed every frame of the hero, the bridge and the tour, even
    paused (the hero city, above). Draw the still part as an image.
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
  The CSS side of that rule: `HoverSidebarProvider` writes
  `data-pinned="true"|"false"` on the shadcn wrapper in both shells, and CSS
  sized by the pinned width keys on it, never on `data-state`, which a peek
  flips to expanded. **`--panel-gain` is registered with `inherits: false`**
  (KAN-368), so every element that reads `var(--panel-gain)` must carry
  `transition-[--panel-gain] duration-200 ease-linear
  md:in-data-[pinned=false]:[--panel-gain:calc(var(--sidebar-width)_-_var(--sidebar-width-icon))]`
  itself, or it reads 0px and never moves. The readers today are
  `[data-scout-page]` in `(seeker)/layout.tsx`, the Applications wrapper, and
  the job rail's frame and aside (`jobs/jobs-rail.tsx`); keep the 200 ms
  linear equal to shadcn's gap. It used to inherit and ease on the column
  above the page, which restyled about 4,258 elements on every frame of a pin
  (130 to 250 ms frames at 4x CPU). A sidebar row eases its current fill to
  the clicked row the moment its link starts navigating (`useLinkStatus`),
  while `aria-current` stays on the committed row.
- **The seeker layout has a `@modal` slot** (KAN-364): a route opened as a
  modal over the current page through an intercepting route, Settings
  for now (`(seeker)/@modal/(.)settings`). A soft navigation to its address
  opens the modal there; a hard load reaches the route's own layout, which
  for Settings draws the same modal over the Dashboard, so Settings is a
  modal on every way in (`docs/screens.md`, Settings). The slot's
  `default.tsx` and `[...catchAll]/page.tsx` both render nothing: without
  the catch-all, a link out of the modal to another seeker page would leave
  the modal open over it, since a slot keeps what it last matched. The
  catch-all makes every path a page to the lint's
  `@next/next/no-html-link-for-pages`, so it flags every internal
  `<a href>`: use `<Link>`, or, where a full reload is the point (the
  Experiences view's Try Again), disable the rule on that line with the
  reason.
- **The seeker layout wraps the page slot, and only the page slot, in
  `<Suspense fallback={null}>` inside `ShallowRouting`, with a
  `display: contents` div inside the boundary** (KAN-368). Without the
  boundary a hard load sent no byte of the shell until the page's slowest
  read answered (on the Dashboard, a whole scoring pass). Never wrap
  `{modal}`, and never add a `loading.tsx` beside the layout: it would wrap
  `@modal` too. The div must stay: React plays a `<ViewTransition>` enter on
  a Suspense reveal only when no DOM node sits between the two
  (`docs/motion.md`). **Still open, two costs.** On a hard load a page's
  `redirect()` or `notFound()` now answers 200 (a meta refresh plus a client
  redirect, or a client-drawn not-found with `noindex`): bare `/settings`,
  `/applications?app=x`, a bad `/jobs/{id}`, a bad `/applications/{jobId}`
  and a bad `/resumes/uploaded/{id}`. A page that must answer a real 3xx or
  404 cannot rely on the status. And React reveals a streamed boundary no
  sooner than 300 ms after the shell's first frame, so a fast page can land
  up to about 300 ms later on a hard load; only slow pages gain. The real
  signed-in spread is unmeasured.
- **A slow seeker page gets a `loading.tsx` drawn in its own frame**
  (KAN-368). Every seeker route is dynamic, and Next prefetches a dynamic
  route only down to a loading boundary, so a click changed nothing on screen
  until the page's reads were done. Give a page one only if it is slow:
  React holds a shown fallback for 300 ms, so a fast page gets slower. A
  skeleton stands at the height of what replaces it, so nothing below jumps.
  A page with two long reads streams each in its own `<Suspense>` over a
  skeleton of its shape, and starts every read before its first `await` (the
  Dashboard: only the account is awaited). **Settings' modal has no
  `loading.tsx`**: one under `@modal` drew a second modal and backdrop over
  the first; each section streams in its own boundary instead. A clickable
  table row holds its hover tint while its navigation is pending
  (`data-pending`), and the profile photo loads `lazy`, or React holds a
  navigation's commit inside the page's `<ViewTransition>` until the
  never-cached photo downloads.
- **Nothing in the root layout or the root `not-found` may read cookies,
  headers or the session** (no `getCurrentAccount`, `getSessionUser`,
  `cookies()`, `headers()`; KAN-368). Next renders the root not-found into
  every page's tree, so one session read there made all 63 routes dynamic on
  2026-10-24. Check a build's route table with `NEXT_PUBLIC_SUPABASE_*` set
  (the deploy's `cf:build` log, or `npm run build` with `.env.local`): `/`
  must be `○`, `/features/*` `●`, and `.next/prerender-manifest.json` must
  list `/`. CI's build has no env, so it shows `○` even with a `cookies()`
  read (`createSupabaseServerClient` throws first): CI cannot catch this. The
  404's button goes to `/home` (`app/home/route.ts`), which reads the session
  on click and redirects with `homePath()`; the label is always "Back to
  Dashboard".
- **A fresh visit to `/jobs` draws in one round trip** (KAN-368). The page
  draws Best Match with the saved filters in the same response, and
  `jobs/canonical-url.tsx` then writes that address in place (a shallow
  replace). The address it writes must equal `sortHref('match', saved)`
  exactly, and the page must read its sort and filters from that address
  (`paramsOf`), not from the saved filters: `RememberFeed`, `ScrollMemory`
  and Load More's kept pages key on the address, so a drifted one loses the
  list on Back or a reload, and a saved `pay_per` of `hour` with no range
  reads back as `year`. Never bring `redirect()` back: the Jobs link paid two
  round trips with a blank panel between. **Still open:** the bar shows bare
  `/jobs` for about 0.4 s (until page-enter ends, `docs/motion.md`), and a
  filter pick in that window builds its URL from the bare address.
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
  its page shows as the Applications Tracker (KAN-342: in the sidebar,
  the tab and its heading) while its URL and code keep
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
  (KAN-342); its Strong Matches reads the Best Match scores
  (`getMatchDates`), and Top Matches under them lists the twelve
  best-scoring jobs as flat rows that scroll inside a tile, with no score
  floor (`getTopMatches`); its Auto Apply button picks jobs for the queue
  from the best matches auto apply can fill, each one chosen by the seeker. A job's application
  stage (`saved`, `queued`...) reaches its Save and Auto Apply buttons from
  one read per page. Auto Apply never picks a saved job for a batch; only
  the job's own Auto Apply click queues it, or the Auto Apply page's Add
  Jobs, where the seeker picks each one (`auto-apply/add-jobs-dialog.tsx`).
  That dialog is the one place several jobs are queued at once. Up Next's
  resume picker stores a job's resume as the sent resume its application
  names; the extension does not read it yet (`docs/screens.md`, Auto
  Apply).
  Every resume dialog (Did You Apply?, Tailor's Pick a Resume, Up Next's
  Choose a Resume) picks through one table, `ResumeLists` in
  `jobs/resume-picker.tsx` (KAN-360): change it there, never per dialog
  (`docs/screens.md`, Job posting page).
  `docs/screens.md`, Applications, has the rest.
- **/search keeps the filter row, and shows what its words filter by**
  (KAN-308). A new search from the top bar sends only ?q, so it starts
  with no filters; the row stays on /search to narrow the results. The
  words "remote", "intern", "new grad" or "summer 2027" also narrow them,
  as the API reads them (`docs/search.md`, the facts), so each shows as a
  chip above the results (`search/search-facts.tsx`, from GET
  /jobs/search-facts) whose cross searches again without its words. A
  fact the API learns to read needs a label in `factLabel` there, or its
  chip shows the raw key. A PR removed the row on 2026-10-24 to "clear the
  filters" a search already cleared; the chips were the missing part.
- **A "Back" link to a dynamic page goes back in history when it can.** Next
  keeps no dynamic page for a link visit (`staleTimes.dynamic` is 0), but
  reuses the one it holds on a history Back. A job page's Back that followed
  its link re-ran the whole feed fetch and Best Match scoring, so the list
  seemed slow to load; `BackToJobs` now calls `router.back()` when
  `cameFrom()` is its target (`docs/screens.md`, Job posting page).
- **Every other seeker Back goes to the page that opened it**
  (`(seeker)/back-link.tsx`, KAN-363): `BackLink`, or `useBack` for a
  control drawn its own way (the editor's phone arrow), given the page's
  parent for a direct visit. The scroll memory records each page's opener
  (`openerOf`, sessionStorage, the last 50 pages) on every forward arrival
  and never on a return, so a detour and the browser's Back keep it. A
  new Back control uses them, never a fixed `href`; a new seeker page a
  Back can name joins `PAGES` there. Each Back named its parent until
  then: an application opened from the Calendar went to the tracker, a
  resume opened from Experiences to Resumes. Not the job page
  (`BackToJobs` skips the rail's job-to-job clicks to the list), a 404's
  or placeholder's way out (no page to go back to), or a step form's
  Back (the step before).
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
- **The feed's loading state is its last first page** (KAN-287,
  `jobs/feed-fallback.tsx`): `FeedList` keeps the first page it drew as a
  snapshot (`jobs/feed-pages.ts`), and the Suspense fallback draws it while
  the server fetches the fresh one, so any visit to /jobs paints cards at
  once; the skeleton shows only without a snapshot for the query. A return
  adds the kept Load More pages; a fresh arrival still drops those and shows
  the first page alone (asked for 2026-10-10). The snapshot lives apart from
  the kept pages so that dropping one never drops the other, and only a
  fetched page dates either: a rewrite on every mount would restart
  `LIST_FRESH_FOR` and keep stale pages alive for good.
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
  class, which paints the whole glyph. Every glyph draws about a 2px line
  at `size-4`, not Phosphor's 1px: one rule in `globals.css` thickens them
  (KAN-365), and `custom-icons.tsx`'s `STROKE` matches it. A glyph
  Phosphor lacks goes in `components/custom-icons.tsx` with all its
  weights (`docs/design.md`, Brand and icons).
- **Anything clicked or picked is medium (500)**: buttons, chips,
  segmented controls, filter options, and shadcn's menu, select and
  combobox rows, which `globals.css` sets by `data-slot` since they set no
  weight of their own (KAN-365). Regular text is 450, not 400
  (`--font-weight-normal`): the face's 400 read thin in small grey text. The four weights and their jobs are in
  `docs/design.md`, Type weights, and on `/design-kit/type`.
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
- **Never key a Tailwind `group-*` variant on the shell wrapper, or on any
  large ancestor whose attribute changes often** (KAN-368). Tailwind v4
  compiles it to `.cls:is(:where(.group)[attr] *)`, and Chrome then restyles
  that ancestor's whole subtree; the cost comes from the rule sitting in the
  stylesheet, whether or not an element carries the class. Use `in-data-*`
  (`:where([attr]) .cls`) or an arbitrary `[sel_&]` variant, and make the
  class string leave every source file: grep the built CSS for
  `sidebar-wrapper)[data-peek`. A peek open and close restyled 4,265
  elements (77 to 84 ms at 4x CPU) against 245 without the rule.
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
- **How many rows a table or list shows depends on where it sits.** A
  full-page table (the Applications list, Up Next) shows every row and the
  page scrolls. A list or table inside a dialog or a tile scrolls inside
  itself at one height, the `--spacing-scroll-box` token (`max-h-scroll-box`
  or `h-scroll-box`, 320px): the resume picker, Add Jobs and Top Matches.
  Each picked its own height before, and Add Jobs grew to 90% of the window.
- **A filter whose rows the page already holds moves the URL in place**
  (`useShallowPush`, `docs/motion.md`): Live Activity's Status and sort
  (KAN-285). A tick passes `{ replace: true }`, so ticks are not steps of
  Back, as the Applications page's server-side picks replace the URL.
- **pdf.js (`pdfjs-dist`, pinned exactly) loads on the resume pages
  only**: the editor (KAN-209) and an upload's page (KAN-366,
  `(seeker)/resumes/uploaded/[id]`, which draws through the same
  `PdfPages`), through `import("pdfjs-dist")` inside an effect in
  `(seeker)/resumes/[resumeId]/pdf-pages.tsx`: about 110 KB gzip plus a
  290 KB worker, which every other page would otherwise pay for, and its
  module touches browser globals, so a top-level import breaks the server
  render. The worker comes from `new URL("pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url)`, which Turbopack emits as a static file. After a build,
  only those two routes' client manifests name the pdf.js chunk.
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
  is fine for fetching a token to forward. `getSessionUser()` also returns
  `accountType` from the verified claims (`app_metadata.account_type`,
  written only by the API's service-role key). Use it for "applicant or
  company" on the Next side, not `getCurrentAccount()`: `/auth/me` costs an
  API call on every soft navigation, since the layout that shares it through
  `cache()` does not render again then (KAN-368). The claim keeps its old
  value until the token refreshes (at most an hour), and the API still
  authorizes every call. **Still open:** `isApplicant()` is now true for an
  applicant while the API is down, so Apply Now asks "Did You Apply?" and
  marking fails with its own error.
- **Cookies are httpOnly, 7 days idle** (`lib/supabase/cookies.ts`, used by
  both writers, `supabase/server.ts` and `src/proxy.ts`). Set `maxAge` in that
  helper's `setAll` path, never through `createServerClient`'s
  `cookieOptions`: @supabase/ssr 0.12 overwrites it. httpOnly holds only while
  no `createBrowserClient()` exists.
- **`src/proxy.ts` (Next 16's middleware) refreshes the session on every
  request that renders session-dependent content**, because Server Components
  cannot write cookies and sessions would die with the hour-long access token.
  Its matcher leaves out the static marketing pages (`/`, `/pricing`,
  `/terms`, `/privacy`, `/features/*`, `/blog`, `/help-center`, `/docs/*`,
  `/coming-soon`), so they prerender and a visit there runs no proxy
  (KAN-368). A new marketing page adds its name to the matcher's lookahead;
  one left out still works, with one proxy call more. Every session-reading
  path and every path with a proxy redirect (`/company*`,
  `/onboarding/company`, `/calendar`) must stay matched. **Still open:** time
  spent only on marketing pages no longer extends the 7-day idle cookie; the
  first app request does. It is a convenience, not security: the
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
  modules that action files import. **Likewise never export from a
  `"use server"` file a function that fetches a URL or path it is handed**:
  any page script could call it with any argument, an open fetch proxy
  (SSRF; KAN-368). Keep such helpers unexported (`readPdf` in
  `lib/resume-actions.ts`) or in a `server-only` module
  (`lib/job-queries.ts`, `lib/resume-queries.ts`).
- **A client screen never loads through several server actions**: Next runs
  them one at a time per client, so a page that looks parallel pays N round
  trips in a row (KAN-368). Use one action that runs `Promise.all` on the
  server, or a server component. Shell components start reads that do not
  depend on `/auth/me` together with `getCurrentAccount`
  (`account-status.tsx`, `profile-strength.tsx`), or the chip waits on two
  API calls in a row on every hard load and `router.refresh()`.
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
  person in that tab. My Profile loads through one server action,
  `getProfilePage` (`lib/profile-page-actions.ts`; KAN-368): its photo,
  profile and answer bank ran in a row on a first visit, and a Save waited
  behind them. A read added to My Profile joins that action.
- **Resume facts are edited in the experience bank only** (KAN-211). An
  upload writes its reading into the bank itself (ADR 0003); no screen holds
  a second copy of an upload's facts to edit. Two editors of the same facts
  drift apart, and built resumes read the bank. Every screen that reports an
  import says it with `lib/import-summary.ts`, from the `bank` of an upload
  or a replace (the resume picker's, at the limit), or Import Again's
  response. A newer version of an upload is a delete and an upload: the
  Resumes view's row offered Import Updated Resume until KAN-362, and never
  a re-read of the stored file, which only ever read the same text. "Read It With
  AI" (KAN-222) runs only on a click, never on its own, and shows only
  while `uses_left` is above 0; a failed reading writes nothing and says
  why.
- **The Resumes view is one list of every resume** (KAN-362,
  `(seeker)/resumes/built-resumes.tsx`): uploaded, generated and tailored,
  newest first, each as its card (`components/resume-row.tsx`'s box, star
  and icons: star, Rename, Download, Delete), in one card that scrolls
  inside itself at `max-h-scroll-box` (`resume-list.tsx`). **It is laid
  out as the Applications Tracker is**, so keep the two alike: the search
  on its own row, then the Type filter (`FieldFacet`, the Applications
  list's dropdown, in `?type=`) and the Sort dropdown (Last Edited, the
  default; Oldest First; Name, A to Z; in `?sort=`, KAN-366) with Upload
  Resume and Generate Resume at the right, both above the list, and `EmptyState` in the list's place
  when no card shows. Upload Resume and Generate Resume never sit in the
  shared header. A card says what it is in its own line ("Uploaded …",
  "Last edited … · For <posting>"), so the list needs no Type or date
  column: two table versions came first in KAN-362, one with Type and
  Last Edited columns and sort headings, one with each row's icons in a
  `⋯` menu, and the user found the columns useless beside the cards and
  the menu hid the actions students use. Three views behind pills, then
  tabs, came before that: each split one list though every card acts
  alike, and a student had to look in three places for their latest
  resume. The resume picker still splits Generated (base and tailored)
  from Uploaded; whether it takes a Type filter too is open.
- **Every resume opens a page of WorkIt's own** (KAN-366): a built resume
  the editor (`(seeker)/resumes/[resumeId]`), an upload its view page
  (`(seeker)/resumes/uploaded/[id]`, the static segment winning over
  `[resumeId]`). The upload's page reads the PDF on the server
  (`readUploadedResume` in `lib/resume-queries.ts`, server-only: it starts the resume list and the file link together, then downloads the PDF, base64, only for a listed PDF; the list still decides the 404; KAN-368) and draws it with
  the editor's `PdfPages` and no click targets; a DOCX gets a Download
  card, since pdf.js cannot draw one. Its bar (the editor's look) holds
  Make Primary, Rename, Delete and Download, calling what the upload's
  card calls, and reads the name and star back with `router.refresh()`
  rather than guessing them. An upload's card opened its Storage link in
  a new tab until then (`lib/preview-resume.ts`, now gone), so an upload
  left the app and a DOCX simply downloaded.
- **The Experiences view shows one resume at a time** (KAN-343, ADR 0005,
  `../docs/bank_by_resume.md`): a Showing card names the pick, drawn as
  the Resumes page draws a resume (KAN-363), and its Change Resume opens
  the shared resume table (KAN-361, `(seeker)/bank/resume-bar.tsx` over
  `(seeker)/jobs/resume-picker.tsx`'s `ResumeLists`), with Not From an
  Upload as a row under the table, in its radio group, while anything no
  upload owns exists or while it is the pick. The page opens on
  `?resume=`, else the starred resume, else the newest. A pick applies on Show Resume, never on a row
  click, so the arrow keys can move it. The dropdown it replaced had no
  search and cut long names short. The rules (which items a pick shows, the opening pick, the "Also
  used in" line) live in `(seeker)/bank/holdings.ts` and read only the
  API's `resume_ids`; never work out a resume's items in a component.
  Intake always gets the whole bank. Add sends the pick (`createEntry`,
  `addSkill`), so the new item belongs to that upload or shows on that
  built resume and stays in view. `resume_ids` names at most one upload,
  so the note in an entry's editor (KAN-363, "Saving also changes this
  entry on …") names built resumes only, each name a link that switches
  the pick to that resume. The entry's view names none. The Showing card opens its resume as a Resumes row does (the
  editor, or the upload's own page, `/resumes/uploaded/[id]`); Rename,
  Download, Make Primary and Delete stay on the Resumes view, so the page
  never shows a resume deleted from under it. All Experiences was removed
  (2026-10-23). **Every item must show under some pick**: Not From an
  Upload holds what no upload owns (intake's, or one that came from
  several uploads before ADR 0005). It was removed too at first, which
  left 96 entries and 242 skills of 8 students that every reader used but
  no student could see, edit or delete, so it came back (2026-10-24).
  Clear All (KAN-352) deletes what a card shows, from the whole bank, as
  Delete Entry does (`docs/screens.md`, Resumes & Experiences). **Every
  card's heading is LinkedIn's** (KAN-363, `SectionActions` in
  `bank-screen.tsx`): a + that adds, on all seven cards, and a pencil
  (hidden while the card is empty) that opens the card's edit mode, one
  card at a time. Only in edit mode do entries show their pencil, skills
  their pencil and ×, and the heading Clear All and Done. Delete Entry is
  at the foot of the editor an entry's pencil opens.
- **The Experiences view has a section nav** (KAN-349,
  `(seeker)/bank/section-nav.tsx`): one sticky row of links to the seven
  section cards, each with its count under the current pick, the one in
  view lit. It is one row at every width, scrolling sideways where it does
  not fit, so its height never changes; every section card's `scroll-mt-16`
  is room for it, and a card added to the page needs that margin and an
  `id` of `section-<id>` too, or a jump to it (and Scout's scroll) lands
  under the row. A click keeps its link lit until the student scrolls on:
  lit by the scroll alone, a click on Certifications ended with Skills lit,
  since a short last card never reaches the top.
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

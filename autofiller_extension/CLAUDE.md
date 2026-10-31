# CLAUDE.md — autofiller_extension

Guidance for Claude Code when working in `autofiller_extension/`. Repo-wide
rules live in the root `../CLAUDE.md`, which is always loaded alongside this
one. This folder is a Chrome extension (Manifest V3) that fills job
applications from WorkIt's own applicant data — the prototype described in
the "Custom ATS Autofiller Build Plan" doc, built directly on
`backend/`'s existing API rather than a separate profile store.

## Where this folder sits

A third kind of project in this repo, alongside `frontend/` and `backend/`:
no server, no build step, no dependency manifest. It's loaded into Chrome
as an unpacked extension and talks to the **existing** WorkIt backend over
HTTP. Nearly everything it fills is read-only against data that already
had an endpoint: `applicant_profiles`, the **experience bank** (`GET
/applicants/{id}/bank`, KAN-212), the onboarding **job preferences** (`GET
/applicants/{id}/preferences`, KAN-231), and the **autofill answer bank**
(`GET /applicants/{id}/autofill-answers`, KAN-283) — the same rows the
Experience Bank and onboarding screens read and write, never an uploaded
resume's `parsed_json`. Same rule the recommender and Scout follow
(`backend/CLAUDE.md`): the bank, not a resume, is the source of truth for
what the student has done. `src/background/engine.js` maps the schools and
the jobs it gives the Fill engine from the bank's `entries` by `section`,
and the skills from its `skills`, not from a `ParsedResume`.

**One exception**: essay-question generation (below) is the first feature
here that needed a genuinely new backend route,
`POST /applicants/{id}/essay-answer`, because it's the first one that calls
a model — and an extension can't hold a model API key client-side without
exposing it. Every other value this folder fills still comes from an
endpoint that already existed for the webapp.

**No npm, no TypeScript compiler, no bundler.** Every file here is the file
Chrome actually loads — plain ES2020+ JavaScript, JSDoc `@typedef`s in
`src/shared/types.js` standing in for compile-time types. The Fill engine
comes the same way: a git submodule whose committed bundle is loaded as it
is (below). Only `test/` has a `package.json`, for its test runner; nothing
the extension loads depends on it.

## The Fill engine (KAN-329, KAN-340): what fills the form

The form is filled by the **Fill engine**, the TypeScript engine Apply
(Lisul's autopilot) fills with too: one copy of every job system's filler
and of the answer rules, so a fix lands in both. It lives in the private
repo `WorkIt-CSE-416/fill-engine` and sits here as the submodule
`fill-engine/`, **pinned to a tag**. A person moves the pin (`git -C
autofiller_extension/fill-engine checkout vX.Y.Z`, commit the gitlink), so
a change to the engine reaches students only when someone here chooses it.
Moving the pin also means changing `ENGINE_VERSION` in
`src/background/report.js` (what a problem report names);
`test/report.extension.spec.ts` fails until it matches `git describe --tags`.
**A checkout needs `git submodule update --init` once**, or Chrome can't
load `fill-engine/dist/engine.js` and every fill fails. The extension never
builds it: `dist/engine.js` is committed in the engine repo.

- **Two worlds.** The bundle runs in the page's own JavaScript world
  (`world: "MAIN"`): it waits for React's state on the form's nodes, and on
  Ashby wraps the page's `fetch`, neither of which an extension's isolated
  world can see. The overlay and `content-script.js` run in the isolated
  world, where `chrome.runtime` is. `src/shared/content-scripts.js`'s
  `injectFill` loads both, engine first, for the panel and batch apply
  alike. Every panel and fill file list loads `src/content/ui.js` first
  (the shared `ask`/`send` message helpers and the `el`/`button` node
  helpers) and `src/shared/report-parts.js` (a fill report's error names
  and `NOTE_MAX`, also imported by `background/report.js` and loaded by the
  popup; the backend's schema keeps its own copy). It first claims the page (`window.WIA.running`, set in one step)
  and injects nothing into a page whose fill is running: a batch tab
  opened on a Workday step is injected twice as it loads (`batch.js`'s
  `startFill` and `background.js`'s per-page-load Workday fill), and two
  copies of the panel scripts side by side left no panel (KAN-369,
  `test/workday-show.extension.spec.ts`). Its "Frame with ID 0 was
  removed" only means the filled page went (a Workday fill's script lasts
  as long as its page), so it isn't logged. The isolated world's files are classic scripts, not modules: each
  sets its part of `window.WIA` and `content-script.js`, loaded last, runs
  the fill with them, so `CONTENT_SCRIPT_FILES`' order matters. Beside the
  status rows (`lib-status.js`) and the panel (`overlay.js`),
  `workday.js` reads Workday's pages (the step shown, a settled step, the
  sign-in it fills) as `window.WIA.workday`, and `written-answers.js` the
  questions that need writing (their rows, Generate or the student's
  Claude, the student's edits of them) as `window.WIA.writtenAnswers`,
  and `batch-tab.js` a batch tab's side (`batch/state`, the walk's
  `batch/flags` and `batch/focus`, the submit watch) as `window.WIA.batchTab`,
  and `card-flag.js` the flag card under a flagged row (after `overlay.js`,
  which draws it; a row card, `row-card.js`) as `window.WIA.flagCard`.
  The content script reaches the engine through the background,
  which runs `engine.js`'s `runEngine` (the engine's own dispatcher,
  `FillEngine.call`) in the page's MAIN world with
  `chrome.scripting.executeScript` (`fill/plan`, `fill/page`, both answered
  by `engine.js`'s `handleFill`). The background also imports the bundle
  itself, for what needs no page: reading the job and planning.
- **The engine reads the job.** `fill/plan` gets the job's Question set,
  company, role and text from the engine (`jobOf`, `questionSet`,
  `jobNames`, `jobDescription`, `textOf`), which asks each job system's
  public API with the background's `fetchText`: the same URLs and queries
  Apply asks. Eightfold's, TikTok's and Workday's questions are read off the open form
  by the engine (`readQuestions`; `engine.js`'s `READ_OFF_PAGE`), and Ashby's form too when its query
  fails. It then asks the engine's `plan` for answers from the WorkIt
  profile (`engineProfile`) and `POLICIES`. No job system's URLs, queries,
  parsing or company names live here: change them in the engine repo.
  A Plan asks what needs no other answer at once (KAN-369): the profile and
  the batch's record of the tab, then the job's questions beside its names
  and text (`readNames`) and the job's answer bank, which `planQuestions`
  waits for only to plan (it takes the bank as a promise). Each URL is
  still asked once per Plan (`once`), so the requests are the same ones.
  A batch tab's job reads start sooner still: `openTab` asks the job's
  questions, names and text as the tab opens (`plan-reads.js`'s
  `readAhead`, the engine's same calls through `readJobAhead`), while the
  page loads, and the tab's first Plan takes them (`planReads`): once, and
  only within a minute (a tab held by a human check plans afresh). A read
  that failed is asked again by the Plan. Never the answer bank (read fresh
  for each Plan, KAN-379), nor a job whose questions only its open form
  shows (Workday, Eightfold, TikTok, practice forms); every later Plan of the tab
  (a Workday step, an Eightfold follow-up) reads afresh.
- **The engine fills the page and checks it.** `fill/page` calls the
  engine's `fillEach`, which fills in the engine's own order (files first
  where the job system parses the résumé into the form, Workable in one go,
  Workday's repeating sections first) and says how each field went:
  filled, failed with the engine's reason, or skipped when the form never
  showed it. One field the engine can't fill doesn't stop the rest. A field
  that shows something other than its planned answer (or a wording the
  Plan accepts), or shows nothing, is failed with what the page shows, so
  the student checks it: "skipped" means only that the form doesn't show
  the field. Once the whole page is filled the engine reads every filled
  field back again, so one a later answer emptied (a form that redraws a
  box) is failed too (KAN-375). A batch tab with a failed field goes to
  Needs you.
- **More questions mean a new plan.** A fill that brings on questions
  (Eightfold's follow-ups, Workday's new panels) answers `more`; the
  content script plans again with them (`extra`) and fills what is new.
- **Workday, a step at a time.** The student signs in and starts the
  application (a batch tab starts it itself, below); the content script fills each step as it shows (sections
  first, then each field, then reads the step again for follow-ups), then
  waits. The student checks the step and presses Save and Continue; the
  next step is filled when Workday shows it: a step is told from the last
  by its name and its number in the bar, since a tenant may name two steps
  alike (a second "Application Questions"). A step the tab filled before
  (the student went back to it, or it loaded again; `workday.filledBefore`,
  session storage) gets only its empty fields filled, so the student's
  saved answers stay. A fill whose step is left while it fills stops
  planning there (`workday.stepId`), so the step shown next is the step
  loop's to fill. The extension never presses
  Submit. **Fill to Review** (KAN-369, `workday-walk.js`, Apply's walk): in
  a batch tab, and outside one once the student presses the panel's Fill to
  Review (kept for the tab in sessionStorage), a filled step with nothing
  for the student is saved with Workday's own Save and Continue
  (`pageFooterNextButton` or `bottom-navigation-next-button`, only when it
  reads Save and Continue, Continue or Next), so every step fills up to
  Review, where the panel says "Check everything on Workday's Review page,
  then press Submit." A step stops the walk, and the panel says why, when a
  row needs the student (failed, unanswered, a written answer still coming,
  a guessed answer, a flag, the Plan's note), a required field shows
  nothing (`fill/required`, asked on Workday only here), or the
  self-identification card waits. The button is pressed on a step once
  (its name, its number in Workday's bar and the path, kept for the tab,
  so a second "Application Questions" on a link that doesn't change is a
  step of its own). A press Workday drops (in 3 s the button never
  disabled, no error, the same step) is made again on the same button, 3
  presses in all, as Apply's `_next` (Applied Materials, live). Right
  before every press it reads the button's words and looks for the Review
  page again, so a button a tenant relabels Submit after a dropped press is
  never pressed. It is
  never pressed again after Workday shows an error that stays 5 s, its
  "Something went wrong" page, or 30 s with no new step; then the student
  presses it. A step WorkIt can't plan (the profile didn't load, say)
  is the student's: its line reads "WorkIt couldn't fill this step" (Needs
  you), the walk never presses on it, and the fill waits for the next step
  the student moves to and fills it as any other (`fillShown`'s
  `unplanned`, content-script.js). Tests: `test/workday-review.extension.spec.ts`. A
  step that loads as a new page drops the
  content script, so the background remembers the tab
  (`workday_fill_tabs`, session storage) and injects the fill again when
  it loads. Workday's nested prompts are slow to read, so each tenant's
  are kept in `chrome.storage.local` (`workday_trees`), as Apply keeps
  them, and so are its dropdowns' choices (trees marked `list`): the next
  fill on that tenant reads a dropdown from them without opening it, and
  the engine checks them when it fills it (a choice gone since re-plans the
  field with what shows). Tests: `test/workday-lists.extension.spec.ts`;
  `test/speed.extension.spec.ts` times each fake step (`workday`,
  `workday-2` to `workday-5`). Its own How Did You Hear About Us? is never read: the engine
  searches it for each source in turn (WorkIt, LinkedIn, then the rest) and
  takes the first found.
  `test/workday-steps.extension.spec.ts` walks a whole application (Apply's
  fake Workday steps, as new pages and drawn in place) from Create Account
  to Review, Fill to Review saving each step it can and the test answering
  and saving, as the student, each step where the walk stops.
- **Stepped systems share one loop (`steps.js`).** `window.WIA.steps` is
  the stepped job system on the page (Workday's `workday.js`, Oracle's
  `oracle.js`, SuccessFactors' `successfactors.js`, iCIMS's `icims.js`), the extension's side of the engine's Stepper seam
  (fill-engine `src/steps.ts`, README "Stepped forms"). The step loop
  (content-script.js), Fill to Review (`workday-walk.js`), the checklist's
  field lookup (batch-tab.js `fieldOf`) and the primary button use only its
  face: `isOn`, `name`, `step()`, `stepId()`, `stepAfter(from)`, `quiet()`,
  `filledBefore()`, `fieldOf(key)`, `nextLabel`, `reviewName`, `waiting`
  {title, reason}, an optional `watchGate(onView)`, and `walk` {next,
  review, goesOn, banner, wentWrong()}. A new stepped system (iCIMS,
  SuccessFactors) is one more script giving it, loaded before `steps.js`
  (shared/content-scripts.js), plus its name in `steps.js`'s list.
- **Oracle Recruiting Cloud** (`oracle.js`, KAN-369). The manifest runs on
  `*.oraclecloud.com/hcmUI/CandidateExperience/*`. Oracle's Apply opens an
  email gate (Email Address, a terms box, a hidden honeypot; a returning
  candidate may get a one-time code): it is the student's. WorkIt never
  types into it or presses its Next; the panel says "Enter your email to
  start" and tells them to enter it and continue. Each section (Personal
  Info, Job Application Questions, Experience, More About You) then fills
  as it shows, in the same page, its line "Oracle: <section>", and Fill to
  Review presses Oracle's Next on each section with nothing for the
  student, stopping at Summary (its Submit is the student's). A closed
  Oracle job (its page says it is no longer available) gets "This job is
  closed" (closed-posting.js) instead of the wait for the email. A profile
  item's inline form (Add Education, Add Experience) isn't filled. The
  sections' markup comes from Simplify's and Jobright's selectors, not a
  live read: live-check before relying on it. Tests:
  `test/oracle.extension.spec.ts` (the engine's fake Oracle page).
- **SAP SuccessFactors** (`successfactors.js`, KAN-369). The manifest runs on
  the career sites' `/career*` and `/portalcareer*` pages of
  `*.successfactors.com|.eu` and `*.sapsf.com|.eu` (backend
  AUTO_APPLY_HOSTS the same four). A posting usually lives on the
  employer's own career site (jobs.sap.com, `*.jobs2web.com`, a branded
  host), where the extension doesn't run: its Apply goes on to the career
  site's sign-in. The sign-in and its Create an Account page are the
  student's: WorkIt never types an email or password there, never makes an
  account and never presses their buttons; the panel says "Sign in to
  SuccessFactors, then press Fill". Signed in, the application's fields are
  read off the page (they differ by employer): "Application" (its
  sections) and, at some employers, "Questions" (the screening page), each
  with its line "SuccessFactors: <page>"; Fill to Review presses its Next
  and stops where only Apply goes on (the student's). Education and
  Employment entries aren't filled. The signed-in markup comes from
  Simplify's and Jobright's selectors, not a live read: live-check before
  relying on it (fill-engine `test/fixtures/forms/successfactors-acuity/README.md`).
  Tests: `test/successfactors.extension.spec.ts` (the saved live sign-in,
  and the engine's fake application page).
- **iCIMS** (`icims.js`, KAN-369). The manifest runs on
  `*.icims.com/jobs/*`. iCIMS draws every page in its own iframe
  (`#icims_content_iframe`, same host): the panel and the fill stay on the
  top page and work in that frame's document (the face's `doc()`, which
  Fill to Review reads too); the launcher skips the frame. The candidate's
  sign-in (email, the privacy-notice consent and "I accept", then a
  password or a new login; an invisible hCaptcha) is the student's: WorkIt
  never types into it or presses its Next, and the panel says "Sign in to
  iCIMS, then WorkIt fills". Each step (a new page in the frame, watched
  by polling) then fills as it shows, its line "iCIMS: <step>"; Fill to
  Review presses Next on each step with nothing for the student and stops
  on the step whose button reads Submit. A batch tab skips the form wait
  (the form is in the frame) and its fill waits for the sign-in. A closed
  job (`/jobs/search?...notFound=1`) says "This job is closed". Education
  and Experience entries (`iCIMS_CollectionContainer`) aren't filled. The
  steps' markup comes from Simplify's and Jobright's selectors, not a live
  read: live-check before relying on it. Tests:
  `test/icims.extension.spec.ts` (the engine's fake iCIMS site).
- **A job's page is not always its form.** A Lever, Ashby, Rippling,
  Workable, Eightfold or TikTok posting shows the job on one page and the form on
  another (`jobOf`'s `form`). On the job's page the overlay names the
  form's link and fills nothing; batch apply opens the form itself
  (`formFor`: `formUrl`, then the engine's `greenhouseForm`). A hosted
  Greenhouse job whose board shows it on the company's own site (the
  Job Board API's `absolute_url` is off greenhouse.io) is sent there, its
  form in an iframe the fill can't reach, so it opens as its embedded form
  (`job-boards.greenhouse.io/embed/job_app?for=<board>&token=<job>`), as does
  an embed link without `for=` (its page names the board). Write-early reads
  the same link. On a company's careers page that holds Greenhouse's form in an
  iframe (`iframe[src*="greenhouse.io/embed/job_app"]`), the overlay names
  that iframe's link instead of "can't fill this job system yet"
  (`content-script.js`).
- **TikTok's form is behind the site's own sign-in, the student's
  (KAN-369).** TikTok and ByteDance share one form and the engine's
  `"tiktok"` Filler (`lifeattiktok.com`, `careers.tiktok.com`,
  `jobs.bytedance.com`, `joinbytedance.com`); a posting's form
  (`/resume/<id>/apply`) sends a signed-out student to
  `/login?redirect_path=...`. WorkIt never signs in there and never types
  an email or password: on the sign-in (`engine.js`'s `signInFirst`, or the
  engine's `readQuestions` throwing `Handoff` on a page with a password
  box) `planFill` answers `signIn`, the engine's line, and the panel shows
  "Sign in to TikTok, then press Fill" (ByteDance on its hosts) and fills
  nothing. A batch tab on it is injected at once (`startFill`, no form
  wait, no second opening) and needs the student; the background remembers
  the tab (`background.js`'s `SIGN_IN_TABS_KEY`) and fills it once it
  reaches the form, as a new page or the site's own move in the page.
  `test/tiktok.extension.spec.ts` serves the engine's rebuilt form fixture
  behind a made-up sign-in. The form was never seen signed in (the engine's
  `test/fixtures/forms/tiktok-README.md` lists what needs a live check).
- **The profile adapter gives only what WorkIt holds.** Name, email,
  phone, home, links, the default resume, the transcript, the latest school and the jobs from the
  bank, and the nine autofill answers, in the words the engine's rules
  read. The home is the profile's free-text location (KAN-372) as the
  engine's `homePlace` reads it: a city with a US state ("Stony Brook, NY")
  or a city, region and country; anything less certain is left out, so the
  form's location questions and phone country stay the student's. Never
  parse the location here. With no street address, Workday's City, State,
  Country and Country Phone Code come from the home; "previously worked
  here" is read from the bank's jobs (by whole words of the employer). Anything else (pay, relocation, a home address, consent boxes,
  start dates) stays the student's: the Plan lists it as a Missing fact and
  the overlay says "WorkIt has no answer for this". `POLICIES` holds no
  student's choice; "How did you hear?" is WorkIt in a text box; a list
  takes WorkIt, else LinkedIn in its own wording ("LinkedIn.com", "Job
  Board > LinkedIn"), else the careers site or "Job Board" (`how_heard.first`,
  tried before a brought `prefer`). `us_roles_only` is on, since WorkIt lists US roles only: a
  question about working abroad ("the right to work in the UK?") is No, and
  a role abroad a Screener. The engine's own rules decide everything else; change a rule in
  the engine repo, not here.
- **SmartRecruiters fills in two pages** (`src/content/smartrecruiters.js`).
  A posting (`jobs.smartrecruiters.com/<company>/<id>`) opens its one-click
  form through `?oga=true`; the form's questions are read off the page a
  page at a time (`readQuestions`, through its components' shadow roots).
  Once the first page is filled and nothing on it needs the student (no
  failed row, no required answer still being written), `fill/next` has the
  engine press Next, never Submit, and the screening page is filled as the
  same tab's fill. Otherwise the first page is the student's, with a
  "SmartRecruiters: first page" line telling them to press Next. Names and
  text come from the public Posting API (`api.smartrecruiters.com`, in the
  manifest). The form serves a captcha to a headless browser, so its tests
  run on the engine's stand-in built from other autofillers' selectors
  (`test/smartrecruiters.spec.ts`), not a saved live form.
- **Only job systems the engine covers are filled.** `engine.js`'s `jobOf`
  names them (Greenhouse, Lever, Ashby, Rippling, Workable, Eightfold,
  SmartRecruiters, Workday, Oracle, SuccessFactors, iCIMS, Waymo and TikTok/ByteDance). On any other page the overlay says
  WorkIt can't fill this job system yet and nothing is touched: there is
  no generic filler any more (the old label-matching one filled most forms
  wrong, and was deleted with its Greenhouse adapter in KAN-340).
  A closed job on a system it covers is told apart (`closedPosting`, in
  closed-posting.js): Greenhouse sends it to its board with `?error=true`,
  Workable to the account with `?not_found=true`, others say so on the
  page ("no longer accepting applications"; TikTok's and ByteDance's "404
  Page not found", where the engine's `NoForm` or the posting's link is
  checked too); the overlay then says This job is closed instead.
- **Tests**: `test/extension.ts` runs the fill as Chrome does, minus
  Chrome: `ENGINE_FILES` and `CONTENT_SCRIPT_FILES` evaluated in a saved
  form's page (served by the engine repo's own fakes and fixtures, through
  the submodule), the content script's messages answered by `handleFill`.
  `greenhouse.spec.ts` and `job-systems.spec.ts` fill one saved form of each
  job system (Workday step by step, the student's Save and Continue played
  by the test) from a WorkIt-shaped profile, checking what each field shows
  and that nothing was submitted. Run: `npm --prefix autofiller_extension/test ci`,
  then `npm --prefix autofiller_extension/test test` (Chromium:
  `npx playwright install chromium` once).

## Two surfaces, one engine

The build plan doc's "JobRight has two operating modes" framing, applied
here:

- **The extension is what actually fills a third-party ATS page.** This is
  the only technically possible way to do it — a webapp page cannot reach
  across the same-origin boundary into `greenhouse.io`'s DOM no matter how
  it's built. Every competitor in the market research hits this same wall
  and solves it the same way.
- **The webapp's role is a thin, optional bridge** (`frontend/src/lib/
  autofill-extension.ts`), using Chrome's `externally_connectable` to ask
  batch apply to open (and fill) the queued applications, which jobs its
  tabs show, and to switch to one of them, and onboarding's practice batch
  and install check (`ping`, KAN-378), and Settings' link to the Workday
  Sign-Up page (`workday/signup-open`, which only opens it: no login
  crosses) — nothing more. The job cards'
  "Autofill ready" badge, `ping`'s first caller, was removed (KAN-278).
  The extension's core function
  never depends on this bridge: it works from its own panel on the job
  page, bridge or no bridge.

**`externally_connectable.matches` takes exact origins, never a glued
prefix+wildcard.** `manifest.json` lists `http://localhost:3000/*` and the
deployed webapp origins (`https://workitjobs.ai/*`,
`https://workit-web-gamma.vercel.app/*`) by exact hostname —
`https://workit-web*.vercel.app/*` looks like it should mean "any preview
of this project" but Chrome refuses to even load the manifest over it
("Invalid host wildcard"). A match pattern's wildcard can only be an
entire leading subdomain label (`*.vercel.app` — valid, but matches *any*
site on Vercel, not just this one), never a literal prefix fused with one.
There is no Chrome-native way to express "any `workit-web-*` subdomain" —
the honest tradeoff is that the webapp badge only lights up on origins
listed here by hand, so a new preview URL (a different branch, a
redeployed production domain) needs adding before the badge works there.
Same category of limitation `backend/CLAUDE.md` already documents for
Supabase's Redirect URLs allow-list, for the same underlying reason.

## Why it's user-triggered, not automatic

Filling is something the student starts: **Autofill This Page** in the
panel (background.js `panel/fill`, which runs `injectFill` in the frame
that asked) or their Auto Apply click (below). **This prototype never
auto-submits, ever**: the student always clicks the real Submit button
themselves, on the job system's own page, after reviewing what got
filled.

**What does run on page load is a small check, and only on the job
systems' hosts** (KAN-394): manifest.json's second `content_scripts` entry
(`tokens.js`, `panel.js`, `launcher.js`, top frame, `document_idle`) on the
same hosts `host_permissions` already lists, so it adds no install
warning. `launcher.js` waits for the page's load plus a second (a node
drawn during Greenhouse's start-up makes it redraw the form, see the
overlay), asks the background `panel/where` (the engine's `jobOf` on the
page's link, and whether the tab is a batch's), and on a job page outside
a batch draws only the edge tab. Nothing fills, nothing is read from the
form, and other pages get nothing drawn. **Any posting there, in
WorkIt's feed or not**: nothing here asks the API whether it knows the
job (the job card falls back to the engine's `jobNames`, the answer bank
to the page's company), so a posting the student found anywhere fills as
a feed job does (`test/any-site.extension.spec.ts`; live, 2026-10-28: a
Discord Greenhouse posting not in the feed filled 15 of 17 required
fields, and Lever, Ashby and Workday postings showed Autofill). The entry
runs in every frame (`all_frames`), so a job system's form embedded in an
employer's page (Greenhouse's `embed/job_app` iframe on Databricks',
Stripe's or Airbnb's careers site) gets the edge tab and fills inside its
frame, though the employer's page itself is out of reach. A page on any
other host is never touched unless the student allows that site (below).

**Employer career sites the student allows (KAN-369,
`background/site-access.js`).** No site beyond the job systems' hosts is
asked at install: `optional_host_permissions` is `https://*/*`, and the
toolbar popup on a posting-like page of another host offers **Allow
WorkIt on <host>**, whose click calls `chrome.permissions.request` for
that one origin (it needs the click; Simplify and Jobright ask the same
way). Once granted, `popup/allow` keeps the origin (chrome.storage.local
`allowed_sites`), registers the launcher's files for it
(`registerContentScripts`, id `site-<host>`, kept across restarts), runs
them in the tab at once, and answers what it found: the engine's own
reading of the page (`pageJobUrl`: `jobOf` of the link, or a
SuccessFactors career-site posting its page marks with rmkcdn assets or
`data-careersite-propertyid`, read as `ats=successfactors`), in which case
the panel opens; or a frame showing a form the engine covers ("Open
WorkIt's tab at the right edge of the application form"); or nothing
("WorkIt found no application it fills on this page.", with Request this
job system kept). `panel/where`, `fill/*` and the toolbar read the page
through `pageJobUrl`. A SuccessFactors posting's panel says to press Apply
and sign in (its form is the career site's, which the manifest covers).
The options page's Sites You Allowed lists them with Remove
(`sites/remove`: `chrome.permissions.remove`, then the scripts go);
Chrome's own removal is followed at the worker's start and on
`permissions.onRemoved`. Batch apply is unchanged: it opens only links the
API names. Not covered yet: iCIMS Jibe and Workday on company hosts, and
`tiktokusds.com`, which the engine's `jobOf` doesn't read.

**The one other trigger is the student's own Auto Apply click** (KAN-305,
KAN-370): batch apply fills the tabs it opened for that click (below). It
is still a click, never a page load, and it still never submits. It is why
`host_permissions` lists each hiring system's host: `activeTab` never
covers a tab the extension opened.

## Batch apply (KAN-370): five tabs at once, in Ready and Needs you groups

`src/background/batch.js` replaced KAN-305's one-tab runner
(`auto-apply/architecture.md`, "Batch apply"). The Auto Apply page's Start,
and a job card's Auto Apply once it queues the job, send `run/open` over
`externally_connectable`; the batch opens the queued applications, each in
its own background tab in the window that asked, **at most `WINDOW` (5)
filling at once**, and opens the next one as soon as one finishes. The
tabs open together: each application's form link (`formFor`, a Job Board
API read for Greenhouse) is looked up while the next application is asked,
then the tabs open in the queue's order (`topUp`; one round trip a tab, not
two or more; `test/plan-fetch.extension.spec.ts`). A
finished tab goes into the **"Ready"** tab group (green: every field it
needs shows an answer) or **"Needs you"** (orange: anything unfilled, a
note the Plan left the student, a Workday step, or a job system with no
Filler), and moves between them when that changes. A tab whose fill itself
went wrong (the Plan failed, except on a Workday step, which is Needs you; Workday's error page, a covered job system's
page that never loaded or took no fill) is **failed**: in Needs you too,
but its own state. The student reviews
each tab and presses the employer's own Submit; nothing here submits.
`run/status` answers which job postings the batch's tabs show (`jobIds`)
and each tab's state (`jobs`), which Up Next reads as each row's live
status; `run/show` switches to one (`jobId`), and `run/close` closes one
(Up Next's Remove on a row open in a tab, before it dequeues or skips the job; the application keeps
its stage, so a queued one waits again and a needs_you one shows Needs You).

`batch.js` is the batch itself (opening, topping up, groups, states,
resume after a restart, the practice batch); background.js imports each
message's function from the module that owns it. Beside it:
`batch-store.js` keeps the batch in `chrome.storage.local` and runs every
change one at a time (`serially`), so every module reading or changing the
batch goes through it. `write-early.js` sends the queued jobs' written
questions before their tabs open (`writeEarly`); `next-needs-you.js`
walks the tabs for Next Thing That Needs You (`nextNeedsYou`); `tab-load.js`
waits for an opened tab's page and form (`waitForLoad`, `formShows`).

- **A human check where the form should be needs the student.** A tab
  whose form doesn't show within 10 s, on a page with a captcha
  (Cloudflare's Turnstile, hCaptcha, reCAPTCHA: its frame, or words such
  as "Verify you are human", `humanCheckShows`), first gets a short turn
  in front (`human-checks.js`'s `tryInFront`): Chrome holds back a tab no
  one sees, and a managed check often passes on its own once seen. Only
  when the student isn't in the tab's window (it isn't the focused window
  that was focused last), so WorkIt never takes the tab they look at; the
  window's own tab comes back after 5 s unless they switched meanwhile.
  The cost: a student in another app or window sees their batch window
  change tabs for 5 s. A check that passes during the first look (its page
  loads anew: `formShows` answers null) is looked at again in the new page.
  Still there, the tab goes to Needs you, the toolbar's badge counts the
  checks waiting (`markCheck`, titled "A job needs you to prove you're
  human"), and it keeps waiting up to 5 minutes for the form (`formAfterHumanCheck`, also
  across the new page a passed check loads); the fill runs once it shows.
  Meanwhile the page shows no panel, so nothing of WorkIt's covers the
  check's widget (Jobright removes its own the same way), but its rows
  (`human-check.js`, `injectHumanCheck`) hold the "todo" note "Prove
  you're human on this page" that Next Thing stops at (on the tab: no
  field to show), first of all, as the check blocks the tab's whole form
  (`waitingChecks`); the fill puts up its own panel once the form shows.
  The walk's listener, added once per page, answers from the latest
  fill's rows (`window.WIA.walk`), as a passed check may draw the form in
  the same page. No Chrome notification: the
  `notifications` permission adds "Display notifications" to Chrome's
  install warnings (and an update that adds a warning turns the installed
  extension off until the student accepts), so the badge alone tells a
  student elsewhere. The extension never solves a check. A form that never shows has failed,
  as any other. Tests: `test/batch.extension.spec.ts` ("a human check
  before the form", "a human check's page shows only the check", "a human check that
  passes on its own").

- **The URLs always come from the API, never the message.** `run/open`
  carries no URL: a page on an allowed origin that could hand the worker
  a URL could make it open any site. Its one field, `jobIds`, is the jobs
  the student picked in Up Next (UUIDs only, at most 100; anything else is
  dropped): it only filters the API's queue (`?only=`). Picked jobs open
  before the rest, and a batch started from picks opens nothing else
  (`picked`, `pickedOnly`); a `run/open` with no `jobIds` (Start Auto
  Apply, the popup) opens the whole queue again. `run/show`'s `jobId` only
  picks among the batch's own tabs.
- **Never a job board** (KAN-376; GLOSSARY.md, "Job board"). A tab opens
  `job.form_url`, the employer's form the API names (a LinkedIn or Indeed
  posting is queued only through the form its text names, and refused
  otherwise), else `job.apply_url`. A link on a job board's host
  (`src/background/job-boards.js`, the same hosts as `hosts.py`
  `JOB_BOARDS`) is never opened, whatever the API answers: the batch
  passes over it and leaves its stage alone.
- **The API keeps the queue, its order and each application's stage.**
  The next tab's job is `GET .../applications/next?skip=...`, skipping every
  job this batch opened (and `&only=...` while picked jobs wait); a tab's state is `PUT .../applications/{job}/fill`
  (`needs_you`, or `ready`, which moves the stage back to `queued`: the
  application waits for the student's submit). Tab states map onto the
  stage column: queued, filling and ready are `queued`; needs_you is
  `needs_you`; submitted and skipped are `applied` and `skipped`
  (`.../finish`, KAN-373/374); failed is `needs_you`, recorded as a
  needs_you fill, so the student can still finish the form by hand.
- **What only the browser knows lives in `chrome.storage.local`**
  (`workit_batch`: each tab's job, link and state, the jobs opened, the two
  group ids). Chrome stops this worker after ~30 seconds idle and clears
  its variables; every change is driven by an event (a content script's
  `batch/state`, a closed tab, `run/open`), so a restarted worker carries
  on. Changes run one at a time (`serially`): two tabs finishing together
  would otherwise both open the same next job. Local, not session,
  storage, so the batch outlives Chrome (KAN-373, below).
- **A batch resumes where it stopped (KAN-373).** Once per browser session
  (`onStartup`, and the worker's first start in the session, since Chrome
  sends no `onStartup` to an extension loaded with `--load-extension`, as
  the tests load it), and on `run/open`, `resume()` matches the saved tabs
  to the open ones: a tab id that is gone is looked for **by its link**,
  which is where Chrome's "Continue where you left off" restores it. Found,
  the job keeps its state and group there and is **not filled again**
  (only one still filling is); `autoDiscardable` is set again, since a
  restored tab loses it. Not found, a job still filling opens again and a
  finished one leaves the batch (its stage is the API's). Tabs closed with
  their window (`removeInfo.isWindowClosing`) stay in the batch for that
  match; they never free a place, which would open the next job in a
  window that is closing. A batch with no tab left has ended: the next
  `run/open` starts a new one, so a job the student closed unsubmitted
  comes back then. Chrome restores only tabs whose page had loaded.
- **Skip is on the batch tab's panel (KAN-373).** The panel's ⋯ menu has
  Skip in a batch tab only (`overlay.mount({ onSkip })`); it sends
  `batch/skip`, and `skipTab` records the application as skipped
  (`POST .../finish {"outcome": "skipped"}`), closes the tab, removes it
  from the batch and tops the window up. If the API refuses, the tab stays,
  so the student can press it again. **Closing a tab is not Skip**: a
  window closed, or Chrome quitting, closes every tab, and the student may
  close a tab only to come back to the job later; it just leaves the batch.
- **A closed job leaves by itself (KAN-369).** A batch tab whose job system
  says the job is closed (`content/closed-posting.js`: Greenhouse's
  `?error=true` board, Workable's `?not_found=true`, or "no longer
  accepting applications" on a covered host) is skipped the way Skip is,
  with the outcome `closed` (`closeClosedTab`): the API marks it skipped and
  its scraped posting closed, so it is neither applied nor failed, its tab
  closes and the next job opens. Two ways in: the fill's "This job is
  closed" note sends `batch/closed`, and `startFill` asks the same check
  when the page shows no form at all (Workable's closed page).
- **One Workday application at a time (KAN-373).** A Workday application
  runs over many pages, each waiting on the student (sign-in, then Save
  and Continue), and Chrome throttles hidden tabs, so the batch holds one
  Workday tab at most. A queued Workday job met while one is open waits in
  the batch's `held` list (left out of the queue reads with the opened
  ones) and opens as soon as the open one leaves the batch: closed,
  skipped, or out of the fill states (filling, ready, needs_you, failed), as a
  submitted one will be (KAN-374). The other job systems fill beside it;
  the slot doesn't count against the five filling.
- **Workday's start buttons (KAN-369).** In a batch tab, on Workday's job
  page, `workday.js`'s `watchStart` presses Apply (`adventureButton` or
  `continueButton` reading exactly Apply or Continue Application, as
  Apply's `_start` finds them), then Apply Manually
  (`[data-automation-id=applyManually]`) in the popup Apply opens, each at
  most once a page (its path: Workday changes pages in place), and stops
  once the sign-in form or a step shows. **Autofill with Resume and Use My
  Last Application are never pressed**: WorkIt fills from the profile.
  Jobright and Simplify press these only after the student presses their
  own button (resume-2027 `research/open-decisions-forms.md`); in a batch,
  the student's Start batch is that press. Outside a batch (the panel's
  Autofill This Page) the student presses them. **Learned live** (NVIDIA
  and Salesforce, 2026-10-25, headless, stopped at the sign-in): the
  synthetic press (`press`) works on both, Apply's popup shows Apply
  Manually a moment after, and it loads `/apply/applyManually`, then
  Create Account/Sign In (NVIDIA's social-first, with Sign in with email).
- **Workday Sign-Up (KAN-369).** The extension's options page
  (`src/options/`, opened from the panel's Settings) lets the
  student set one registration email (prefilled from their WorkIt profile,
  `profile/get`) and one password for every company's Workday, as Jobright's
  "Sign-up Information" does. A live checklist (12+ characters, upper, lower,
  number, special) gates Save; Show/Hide and Clear. **The page writes the
  login straight to `chrome.storage.local` (`workday_signup`)**: no message
  carries it, the page never shows a saved password back, and it never
  reaches the API, a log or the webapp
  (`test/workday-signup.extension.spec.ts` checks every API request).
  With one saved, `workdayLogin` gives a tenant with nothing saved that
  login in place of a new password: Create Account copies it into the
  tenant's `workday_logins` entry (`signup: true`, `made`, so it is pressed
  as a new password is), and Sign In fills it as `fresh` (no account known
  here), so it still switches to Create Account first, as with nothing
  saved; with no switch link it presses Sign In with it, and a refusal saves
  the copy `refused`. A tenant saved before keeps its own login. With none
  set, everything is as below. Every press rule below holds unchanged.
  The page opens from the popup, the consent card's Set One Password
  (`workday/signup-open`) and the webapp's Settings > Connected Apps (the
  same message over `externally_connectable`; it only opens the page).
- **Workday sign-in (KAN-373).** On Workday's Create Account or Sign In
  form (`[data-automation-id=signInFormo]`; Workday's step bar calls it a
  step, which `workdayStep()` ignores), `workday.js` asks
  `workday/login` and types the student's email and the login
  `workday-logins.js` keeps for that company's tenant (`jobOf(url).tenant`):
  on Create Account a new 20-character password, saved before it is typed,
  in both boxes. Rules: **passwords live only in `chrome.storage.local`
  (`workday_logins`)**, never in an API call, a webapp message or a log;
  **one per tenant, never shared**; the extension never opens the
  verification email: the student does. A box the student typed in is left
  alone. **Pressing for the student (KAN-369)**, as Jobright and Simplify
  do (resume-2027 `research/workday-accounts.md`): the panel asks once
  ("Let WorkIt Sign You In to Workday", `askWorkdayAccounts`), and Sign Me
  In stores `workday_accounts_for_me` (`workday/allow`). From then on, at
  every company, `workday.js` presses "Sign in with email", switches to
  Create Account when nothing is saved there (to Sign In when the saved
  login has signed in, `signedIn`, set by the first `fill/plan` on the
  tenant, or made the account, `created`, set by `workday/created` when
  Workday answers the extension's Create Account by asking to verify the
  email, in an alert or the page's text), ticks the terms box and names its words in the panel, and
  presses Create Account (only with a password made on that page, and only
  once the box shows ticked, `checked` or `aria-checked`, a moment later;
  else it says to tick it and press Create Account, and keeps the
  password) or Sign In, once the boxes hold the login and the page has
  settled. **Each button is pressed again only when Workday dropped the
  press**: the worker watches (`watchWorkdaySends`, webRequest, observing
  only) for the tab's non-GET request to the tenant's host outside /wday/;
  with none 10 s after a press and the form still showing, it is pressed
  again, at most 3 times, and never once one went out (`workday/sent`).
  Workday's message after a press (a visible one that wasn't there at the
  press) is shown (a verification email: open it, come back and press Sign
  In), and a refused Create Account drops its new password
  (`workday/forget`). **A refused Sign In is never pressed again, on any
  page** (Workday locks accounts): `workday/refused` saves `refused` on the
  tenant's login, its password is no longer typed, and it clears when the
  student signs in there (the tenant's next `fill/plan`). Every change to
  `workday_logins` runs one at a time (`serially` in `workday-logins.js`),
  so two tenants' Create Account at once keep both passwords. Without the
  student's yes, nothing is pressed. The
  panel says "Sign in to continue" and the tab sits in Needs you until a
  step shows; then the fill goes on, in the page or (the tab is
  remembered by `workday/login`) on the page signing in loads. A tenant's
  account made without WorkIt has no saved password: only the email is
  filled, and the panel points a new candidate to Create Account.
  **Learned live** (CACI and Xcel Energy, 2026-10-25, filled only):
  - A Workday posting shows no form, so `startFill` injects the fill there
    without waiting for one, and a batch tab on Workday gets the fill again
    on every page it loads (`background.js`'s `onUpdated`): Apply loads the
    sign-in as a new page, and so does Workday's `/login` after Create
    Account for an account that exists.
  - Switching between Sign In and Create Account draws the form again and
    empties what was just typed (Xcel). So the sign-in fill runs on every
    change to the page and again 0.3, 1 and 2.5 seconds after each lookup,
    typing only into empty boxes.
  - Some tenants first offer Google, LinkedIn or "Sign in with email"
    (Xcel); the student picks, and the form fills when it shows. Xcel
    mails a verification link; CACI signed straight in.
  - Workday names a step in its bar before it draws the step's fields: a
    fill that started at once, right after sign-in, read only Country on
    CACI. A step is read once the page has been still for 1 second (10 at
    most).
- **The content script says when a tab is ready.** In a batch tab
  (`injectFill(tabId, { batch: true })` sets `window.WIA.batch`),
  `batch-tab.js` sends `batch/state` once the fill ends; `content-script.js` watches
  the student's edits (input, change, and click: a dropdown picked with the
  mouse fires neither of the others): the engine reads back (`fill/read`) every required
  or failed field, so emptying one moves the tab to Needs you and answering
  the last one moves it to Ready.
- **Never Ready while the form would refuse the submit.** After the fill
  and after each edit, the engine names every field the form requires now
  that shows nothing (`fill/required`, the engine's `emptyRequired`): a
  required one with no row yet, and one the form requires only once
  another is answered, which no Question set marks required (Greenhouse's
  phone country once Phone shows a number: its submit answers "Select a
  country", seen on Arc's form), and a required field the Question set
  lacks altogether, which only the page shows (Ashby, Eightfold: the
  engine's `unaskedQuestions`). Each becomes a failed, required row named
  by the field's label, so the tab needs the student until it shows an
  answer; an unasked one joins the tab's questions, so edits read it back.
  **These reads must only read**: they run while the student works in
  the form and while WorkIt fills it. The engine once read Greenhouse's
  phone country by opening its picker, which took the focus (an Enter
  meant for Submit went to the picker) and closed any list open
  elsewhere (the self-identification fill's, under load). Test:
  `test/submit.extension.spec.ts` ("leaves their focus where they put it").
- **A batch tab's essays come from the student's own Claude** (KAN-377;
  `auto-apply/architecture.md` 14.6). The essay route is never batch
  apply's. The tab sends the questions its Plan needs written, and every
  one-off draft but a file (KAN-369): a choice whose options were read goes
  with `kind` "choice"/"choices" and its `options`, which the connector
  shows Claude and takes only, and a "choices" answer joins its options
  with "; " as the engine reads one
  (`batch/questions` → `PUT .../applications/{job}/questions`), shows each
  as waiting for the student's Claude, and asks for the saved answers every
  10 seconds (`batch/answers` → `GET .../questions`) until none is left,
  every 2 seconds in the first minute (KAN-369: Claude often saves one
  soon, write early having sent most questions before the tab opened; a
  Rewrite with Claude's wait does the same), filling each through the
  engine; its group follows. The review's polls keep 10 seconds. The background takes
  the job from the batch's own record of the tab (`jobInTab`), never from
  the message. A question the student answered first keeps their answer;
  one Claude's answer fills is labelled Claude (KAN-375's sources). A
  practice batch's tabs (KAN-378) send nothing: a practice job has no
  application at WorkIt, so its essays stay the student's.
  **The pre-submit review** (KAN-369): once every written answer is in,
  the tab keeps polling `GET .../questions` until each answer is
  `reviewed` by the student's Claude (`get_review_task`/`save_review`,
  backend `app/auto_apply/review.py`). A `flag` goes on its row
  (`status.flag`; warning tint and the reason) only while the field still
  shows the answer the review read, and the row needs the student (Needs
  you, Next Thing walks to it) until their edit (any `setStatus` clears
  it). A student with no connector added (`connector/added` →
  `GET .../connector`) has no Claude to review, so the tab stops asking;
  otherwise it stops after 180 polls (30 minutes). The student's edit of an
  answer whose verdict the tab showed, once saved (`batch/own-answer`),
  starts the poll again until the edit's verdict lands (their own words
  count as reviewed at once). Tests: `test/paste.extension.spec.ts`.
  **The flag card** (`card-flag.js`, KAN-369, a row card) under a flagged row: the
  reason, the flagged sentence quoted (`flag_quote`; a click focuses the
  field with it selected, as does the walk's `show`), and three actions.
  **Keep** asks once, then `batch/flag` → `POST .../review/keep` records it
  as the student's choice (no later review flags that text) and the flag
  clears. **Rewrite with Claude** (not on the student's own words) →
  `POST .../review/rewrite` clears the answer, and `get_next_application`
  hands the question to their Claude again with the flag; the row waits
  (Write with Claude) and keeps its flag (`rewriting`, so the tab still
  needs the student), the field's old text isn't taken as an edit, and
  the new answer is filled when it lands (`writtenAnswers().rewrite`, via
  `window.WIA.writing`). **Edit myself** focuses the field with the
  sentence selected; an edit that leaves the sentence in keeps the flag.
  **Rewrite on any answer their Claude wrote** (KAN-424, card-written.js,
  flagged or not): `batch/redo` → `POST .../review/redo` with `steer`,
  the same clear-and-hand-back path with the student's request as the
  reason (written-answers.js `redo`, `undo`).
  A wrong-company flag (`flag_hard`) is drawn in the danger colour; like
  every flag it keeps the tab out of Ready and in the walk until resolved.
  A hidden tab's timers slow to about once a minute after five minutes, so
  an answer can take that long to land. Tests:
  `test/connector.extension.spec.ts` (Ashby's Harvey form: no saved
  Greenhouse form has an essay the Plan sends to Claude).
  **A row whose answer needs a fact only the student can give says so**
  (KAN-369, an Essay fact): when their Claude asks rather than invents
  one (`save_fact_question`), `GET .../questions` gives the row `ask`, and
  each poll turns its waiting line into "Your Claude needs a fact from you
  first: <question>" with the Written Answers link, where the student
  answers it (`showAsk`); once they have, `ask` is gone and the row waits
  for their Claude again. The extension never answers it itself. Test:
  `test/connector.extension.spec.ts`.
  **A follow-up is decided again once its parent is answered**: a parent
  question sent to Claude ("Are you currently working with Amplify?")
  has no answer at plan time, so its follow-up ("If a contingent worker,
  which agency...?") waits too. Each poll while rows wait, the tab asks
  `fill/moot` (the engine's `notCalledFor` over what the form now shows,
  Claude's and the student's answers alike) and a follow-up the answer
  doesn't call for stops waiting: skipped "Not needed", or filled N/A
  (Guessed) where the form asks for it. Its question stays at WorkIt; an
  answer Claude saves for it later is not filled. Test:
  `test/connector.extension.spec.ts` (Ashby's Amplify form).
  **An answer the student pastes on the webapp's Written Answers page
  (KAN-385) arrives the same way**: the API saves it through the
  connector's own save, and the tab's poll can't tell the two apart, so
  the extension has no paste path of its own and must not grow one. The
  tab's "Waiting for your Claude" line ends in a link to that page, on the
  webapp origin the student signed in on (`batch/answers-page`, a row's
  `link` in lib-status.js), so a student without Claude knows where to go.
  Since KAN-424 that line is said once, under the "Waiting on Your
  Claude" box's head (groups.js `waitingNote`, with Write with Claude),
  not on each of its rows. Test: `test/paste.extension.spec.ts`, Lumen's
  practice form queued as a real application (its one written question is all that needs the
  student, so the filled answer moves the tab to Ready; Harvey's other
  questions keep it in Needs you).
  **The same row has Write with Claude** (a row's `claude` in
  lib-status.js): a link to `https://claude.ai/new?q=Write%20my%20WorkIt%20answers`
  in a new tab, which opens a new chat with the trigger in its box, not
  sent, and a click that also copies the trigger, with "Press Enter in
  Claude (or paste)". claude.ai's `?q=` is undocumented (it once sent the
  text by itself, and may stop working), so the copy is the fallback.
  The trigger is overlay.js's `CLAUDE_TRIGGER`, the connector prompt's
  title (`backend/app/connector/prompt.py` TITLE); every line that names
  it uses that constant. Never put the student's data in the link: it
  lands in browser history. Test: `test/claude-start.extension.spec.ts`.
- **The opened row waiting for the student's Claude carries the waiting
  card** (KAN-369, KAN-424, `src/content/card-waiting.js`,
  `window.WIA.waitingCard`, a row card; the overlay asks it for the row
  the student pressed). Pressing the row already took them to the field,
  where what they type is theirs; the card is a paste box. Until KAN-424
  every waiting row carried a card with "Waiting 4 min", Write with
  Claude, the box and Write it myself: five waiting questions were five
  paste boxes, and the red box above them scrolled out of sight. Write
  with Claude is now the waiting box's head, once; a flagged answer sent
  back to their Claude (Rewrite), which stays in the red box, keeps it on
  its row. Save answer sends `batch/paste` → `PUT .../applications/{job}/written-answers`,
  the Written Answers page's route, so a pasted answer passes the same
  checks as Claude's (saved by="student", not own); a 422's reasons for
  that question (`ApiError.reasons`) show in the card under the box, and
  the draft stays. A saved one fills at once (source "pasted"); the next
  poll finds the row filled and leaves it. Cards are kept by key across
  renders, and render puts the focus back, so a draft survives other
  rows changing. Tests: `test/waiting-card.extension.spec.ts`.
- **Writing starts when jobs are queued, and a question is answered once**
  (KAN-379). On `run/open`, once the tabs have opened, `write-early.js`'s
  `writeEarly` reads every queued job the batch hasn't opened with
  `engine.js`'s `questionsToWrite` (the engine's `questionSet` from the
  form's link, no tab; Workday and Eightfold wait for their tab, a job
  board's link is passed over) and sends what is left to write
  (`PUT .../questions`, `max_length` null until the tab reads the form's).
  Each job once per browser session (`workit_written_early`). Every Plan of
  a batch tab, and each early read, uses the job's answer bank
  (`GET .../applications/{job}/answer-bank`) as the engine's Answer bank:
  a question answered before fills as a Saved Answer and is never sent.
  A Plan outside a batch (no application) uses the student's saved answers
  too, `GET .../answer-bank?company=` with the company the engine read off
  the page (`planQuestions` takes the bank as a function of it).
  Each Plan of a batch tab, and each early read, also gives the engine the
  job's `job_type` (the queued application's, kept on the batch's record of
  the tab, `jobTypeInTab`) as the Posting's `job_type`: a full-time role's
  start date ("Date available") is the day the student graduates, an
  internship's its earliest start. Outside a batch it is unknown, and the
  internship's start stands.
  The Posting's `location` is the job system's own (the engine's
  `jobNames`, spread into the Posting with the company and title): on a
  posting placed only abroad the engine answers work-authorization,
  sponsorship, located-in, relocation and pay questions for that country,
  or leaves them to the student, never with the US facts.
  The student's words in a written answer (or one the bank filled) are
  read back by `watchEdits` and saved after a 2-second pause
  (`batch/own-answer` → `PUT .../answers`); while WorkIt's own fill of one
  runs (`fillingWritten`), no edit is read. **Only the student's own words
  count as theirs**: words in a field WorkIt didn't fill, or ones that
  replace what it filled wholesale (no run of 5 words left of it, the
  copy check's run). An edit of their Claude's answer (or a saved one of
  their Claude's) keeps its source label, is sent with `own: false`, and
  WorkIt checks it as their Claude's; a refusal fails the row with the
  reason (`workitFilled`, `replaces`). On Workday each step's fill
  watches that step's edits, and the watch stops once the step is left
  (Workday draws the next step in the same page, or loads it as a new
  one, where the fill is injected again); a Workday tab is never Ready,
  so `fill/required` isn't asked there. Tests:
  `test/write-early.spec.ts` (the read, no page) and
  `test/write-early.extension.spec.ts` (Workday: a step's own words, an
  edit of Claude's answer on the next page, and a step drawn in the page).
- **The student is told what was captured** (KAN-369,
  `src/content/captured-notice.js`, a part above the panel's list): once
  their own words are saved (only `own: true`, never an edit of WorkIt's
  fill), the panel says "Saved N new answers for later forms." (N counts
  questions, not saves) with **Review**, which opens the webapp's Written
  Answers page in a new tab (`batch/answers-page`), where each is marked
  New, and **Undo**, which takes every one back (`batch/own-answer-undo`;
  the field keeps the words, the question stays for their Claude) and
  says "Not saved. Later forms won't fill it." A question taken back is not
  saved again on this page (keepOwn asks `capturedNotice.undone`). No
  question is asked before a save; structured fields (profile facts) are
  still saved only through a click (the Guessed card's Save for next time).
  Test: `test/connector.extension.spec.ts` (typed into Harvey's form).
- **A written question's limit comes from the Fill engine** (KAN-380).
  `planFill` passes the Question set through the engine's `limits`, which
  reads each text field's own `maxlength` on the page, and `planRows`
  gives each `written` row its `max_length` (null when the field sets
  none). Both `batch/questions` and the essay route take it from the row;
  never read a box's `maxLength` in the content script (a field's element
  is named differently on each hiring system: the engine knows how). The
  API refuses a saved answer over it.
  Tests: `test/greenhouse.spec.ts`.
  `batch/questions` also sends a question's `description` when the engine
  read one (the help text under the label, "3-4 sentences", cut to 1,000
  characters; KAN-369), so the student's Claude writes to the form's own
  length; a question without one sends no key.
- **One rule for "needs you"** (KAN-369 Q7, `lib-status.js`'s
  `status.needsYou`, with `toCheck` and `waitingOnClaude`): the Autofill
  tab's red box ("2 Need Your Answer"), the button's "Answer 1 of N",
  Next Thing's "N things need you", a batch tab's state
  (`tabState`, which also waits for required rows on the student's
  Claude), the submit warning and the walk's red dots all use it. A row
  needs the student when it is a "todo" note, or a field the page shows
  now (`shown`: not display: none on it and its box; with no element
  found by its key, its question's words are on the page, and never on
  Workday, where that means another step) that failed, was flagged, or is
  required and still empty after the fill ("pending", or a written answer
  not yet asked of their Claude). A required "skipped" field (the form
  doesn't ask it) or one the form hides goes to the collapsed "N the form
  isn't asking now" group; a guess is amber (`toCheck`), never counted.
  Stop autofill leaves the fields it didn't reach "pending", not
  "skipped". Tests: `test/needs-you-rule.extension.spec.ts`.
- **"Next Thing That Needs You" walks the batch** (KAN-375). Each batch
  tab's panel has the button. `next-needs-you.js`'s `nextNeedsYou` asks every batch
  tab, in the order the tabs opened, which of its rows need the student
  (`batch/flags`: red first, the rows that need the student by the one
  rule above; then amber, `check`: each "Guessed" answer until the student
  says it looks right or changes
  it (the Guessed card below), which doesn't keep the tab from Ready;
  each answer that just arrived from the student's Claude once, too
  (`window.WIA.unseenAnswers`, cleared when the walk shows it);
  notes last; a note is a row marked `note`, "todo" or "done" for news
  like "Application sent", never a key starting "_": Ashby keys its own
  fields `_systemfield_...`), goes to the first one after the last it went to (cursor in
  `chrome.storage.session`, `workit_batch_next`: the tab's place in the
  batch and the row's place among all the tab's rows, `batch/flags`'s
  `order`, so it goes on after a row the student just answered; rows
  waiting for the student's Claude, `batch/flags`'s `late`, come after
  everything else in the batch; every tab's red rows come before any
  tab's amber ones, and the cursor's `tier`, 0 red, 1 amber, 2 late,
  says which part it is in), switches to its tab and
  has the content script scroll to and focus the field and mark its row
  (`batch/focus`). Past the last one the panel says "Nothing else needs
  you." and the next press starts again. A field is found by the job
  system's own field id (`batch-tab.js`'s `fieldOf`); on Workday, whose
  keys are "<step> / <label>" (the engine's Question names), by its
  `formField-*` box on the step shown, labelled as the engine labels it
  (`workday.js`'s `fieldOf`: a repeating section by its title, a panel's
  field as "Work Experience 1 / Job Title", a repeated label "(2)"); a
  key from another step finds none. A tab nothing
  was filled in is one stop, the page itself. This is the only time the
  extension switches tabs on its own, and only on the student's press.
- **Where the walk lands, the page is marked** (KAN-369, `marks.js`,
  `window.WIA.marks`): the field scrolls to the middle and gets a ring in
  the brand colour for 3 seconds, in its own shadow host
  (`#workit-marks-host`), whose root is closed as the panel's is; it
  follows the field each frame while shown and never takes a click. **No
  dot stays on the field** (KAN-424): an orange dot used to sit on a field
  while its row needed the student, but its amber didn't match the panel's
  red box and read as a stray blot on the employer's form; the panel's
  boxes say what is left.
- **A panel row takes the student to its field** (KAN-369, `overlay.js`'s
  `jump`): pressing a field's row (any row but a note; Enter on its label
  too) runs the walk's own `show(key)` (`batch-tab.js`, as
  `window.WIA.showField`, made for every fill, batch or popup): the field
  scrolls to the middle, takes focus and gets the ring, and the row is marked current. A press on a
  button, link or box inside the row, or anywhere in its row card, keeps
  its own behaviour. A field the page doesn't show gets "WorkIt can't find
  this field on the page." under its row for a few seconds; on Workday one
  keyed to another step (keys start with the step) says "This is on
  Workday's <step> step." (each step's fill starts the panel's rows again,
  so this is rare). Tests: `test/panel-reopen.extension.spec.ts`, and
  `test/workday-show.extension.spec.ts` for Workday's row press and Next
  Thing.
- **The panel's Close (Collapse) hides it; it never goes** (KAN-369, KAN-394): its
  rows, cards, answers, the Next Thing bar and any moment card stay as they
  were in the page, and the edge tab ("Show WorkIt panel", "The panel's
  shell") brings the panel back at once, nothing filled again. The toolbar
  icon and Alt+W do too. Only a new
  fill on the page (Fill Again, the fill after a human check) removes the
  last fill's rows: `overlay.js`, injected again, unmounts the one before
  it first.
- **A failed field gets a card** (KAN-369, `card-failed.js`, in the shared
  row card `row-card.js`), shown on the row the student opened (pressed,
  or the button's "Answer 1 of N" took them to), KAN-424; a closed failed
  row shows its reason alone. The card is still made for every failed row
  (it reads what the page shows as it is made, below): "We put X; the page shows Y.", why in plain words
  ("This field ended up empty on the page.", "This dropdown never committed
  a choice.", "The site rejected this value.", "The page changed it."), and
  the site's own error quoted when the page marked the field
  `aria-invalid` (the element its `aria-errormessage`/`aria-describedby`
  names, else the nearest alert or error-styled text). **Put mine back**
  fills the planned answer again, alone, and reads it back; only on
  Greenhouse, Lever, Ashby and Rippling (where the engine fills one field
  alone safely), never for a value the site marked invalid, and not again
  once it didn't take. **Keep the page's** takes what the page shows as the
  student's own answer (Source "student"), so the row stops counting; an
  empty optional one becomes "skipped", and an empty required one has no
  Keep. A card shows on every failed field with a planned answer (not a
  file); the fill hands each Plan to `window.WIA.failedCard.use`. The card
  stores what the page showed on the row (`shows`), so the student's
  later edit is a change from it: a click elsewhere no longer turns a
  failed field showing a wrong value into "You answered this".
- **The row card** (`row-card.js`, `window.WIA.rowCard`) is the one shape
  for every review state (failed, guessed, flagged, waiting on Claude): a
  title, sentences, a quote, the answer's highlighted sentence, a slot for
  the card's own elements (the waiting card's paste box), at most three
  buttons, and a tone (warning, danger) for its edge; tokens only. A
  feature adds `rowCard.add((field) => card | null)`; the panel draws the
  first card for a row in place of its reason, and `overlay.refresh()`
  draws again when a card's own state changes. The flag and waiting cards
  build theirs with `rowCard.make` and the overlay draws them itself (a
  waiting card is kept across renders for its draft). The submit warning
  is a moment card at the top of the panel, not a row's, so it stays an
  `overlay.momentCard`.
- **See cover letter** (KAN-369, `src/content/letter-preview.js`,
  `window.WIA.letterPreview`): a filled row for a written answer WorkIt
  filled (the student's Claude's, a pasted one, a saved one the Plan
  filled) has a "See cover letter" button ("See answer" when its label
  names no cover letter) that opens the letter as the form has it, before
  Submit: a text box's text as the engine last read it back (so the
  student's edit shows, `watchEdits`), or for an upload (a file question:
  Ashby's, Greenhouse's Cover Letter, Workday's; Workable's and Lever's
  cover letters are text boxes) the exact text `asUploads` made the PDF
  of, under "Attached as <file>". An upload whose read-back names another
  file says the form now shows that file instead. Its card
  (`rowCard.make`) offers **Copy**, **Edit myself** (focuses the field;
  for a PDF it also says to remove WorkIt's file and attach their own)
  and, only while the row is flagged, **Rewrite with Claude** through the
  flag card's route (`batch/flag` rewrite, then `writing.rewrite`):
  review.py refuses to rewrite an unflagged answer. `written-answers.js`
  tells it what it filled (`letterPreview.filled`); it changes no status,
  so it never holds Submit or the walk. Tests:
  `test/letter-preview.extension.spec.ts`.
- **The submit warning holds a Submit while something is open** (KAN-369,
  `src/content/submit-warning.js`, `window.WIA.submitWarning`, batch tabs
  only). When the student presses the employer's Submit (a button or
  submit input whose words start with "Submit", on every job system; Next,
  Save and Continue and a job page's Apply never count) and the tab has a
  failed field, a required one still waiting, or a review flag (fields
  only, never a note), a capture-phase listener on `window` cancels that
  press before the page's own handlers see it, and the panel shows a card
  (`overlay.momentCard`, role `alertdialog`): "N things still need you",
  each with a few words why, then **Show me** (`batch/walk-from`:
  `next-needs-you.js`'s `walkFrom` starts the walk's cursor at the first
  and focuses it) and **Submit anyway**, which re-sends nothing: it lets
  every later press on this page through and says "Press Submit again".
  Enter on the button arrives as its click; a form sent with no button is
  held from its `submit` event. A tab with nothing open is never held.
  Tests: `test/submit-warning.extension.spec.ts`.
- **The tabs fill hidden; the student is never taken to one.** KAN-305's
  runner showed its tab before the fill, because hidden fills by the
  pre-engine filler left most dropdowns empty. The Fill engine does not
  need that: five saved Greenhouse forms, and five live ones (filled only,
  never submitted), filled in hidden tabs at once gave the same fields as
  each filled in turn while shown (2026-10-25). Focus was ruled out: in a
  page without focus, `focus()` fires no focus event, and react-select still
  opens on the engine's press. The old filler waited 3 seconds for a
  dropdown's options while a hidden tab ran its timers about once a second;
  the engine waits 10 and never on a redraw.
- **The panel goes on the page after the fill** (`content-script.js`), on
  every job system but Workday. Mounted first, it is a node Greenhouse's
  React app didn't render as it took over the document (hydration), so
  React drew the form again and dropped what was typed: with five tabs
  starting at once, the first box filled read back empty in 1 to 10 forms
  of 50, and in none of 50 once the panel waited. Anything else this
  extension adds to a page waits for the fill the same way.
- **A batch tab is never discarded.** It is set `autoDiscardable: false`,
  so Memory Saver can't throw away a half-filled form the student hasn't
  looked at.
- **Never a new window.** A window opened with `focused: false` from a
  full-screen window on macOS got its own Space, and macOS switched the
  student to it; no Chrome API stops that. The tabs open in the window
  that asked.
- **Tab groups need the `tabGroups` permission**, which shipped with batch
  apply: a permission added in a later release disables the extension
  until the student accepts it. Chrome's group colours are a fixed list,
  so Ready and Needs you take the ones nearest WorkIt's positive and
  warning colours. A group the student closed or emptied is made again.
- **Opening needs no permission; filling needs the host.**
  `chrome.tabs.create`, `chrome.tabs.update` (`autoDiscardable` too),
  `chrome.windows.update` and a tab's load `status` need none (only url,
  title and favicon need `tabs`). Injecting the fill does: `activeTab`
  doesn't cover a tab the batch opened, so `host_permissions` lists each
  hiring system auto apply takes, the same hosts as
  `backend/app/auto_apply/hosts.py` (all eight job systems the engine
  fills, KAN-370; TikTok's by its exact careers hosts, never all of
  tiktok.com or bytedance.com). A host added there
  is added to `manifest.json` in the same change, or its fills answer
  `not_allowed`. After pulling a manifest change, reload the unpacked
  extension in `chrome://extensions`. The background also fetches their
  job APIs, and injects Workday's fill again on its next page. An Eightfold board on a
  company's own domain (Netflix's `explore.jobs.netflix.net`, the
  engine's `EIGHTFOLD_COMPANIES`) is listed by its host: without it, the
  job's names and text failed to fetch. `test/manifest.spec.ts` checks one
  link of each.
- **Waymo's careers site is its own job system** (`careers.withwaymo.com`,
  the engine's site `waymo`). It shows each posting of Waymo's Greenhouse
  board with a form its site vendor builds, with no Greenhouse frame, so
  `embedsGreenhouse` leaves out every link `jobOf` covers and the page's
  own form is filled, its questions read off the open form as Eightfold's
  are (`readQuestions`; none written ahead). `manifest.json` lists the
  host; `waymo.com/joinus/<job>` opens the careers site's
  `/jobs?gh_jid=<job>`. Its Submit posts to `/call_to_actions/<id>/form_submissions`
  (`SUBMIT_REQUESTS.waymo`, not proof alone: how it answers a refusal isn't
  recorded), and a closed posting's "Looks like you got lost" page is a
  closed job. Until the engine's Waymo Filler both of Waymo's careers
  hosts were left out (hosts.py's former `SKIP_EMBEDDING`).
- **A `?gh_jid=` link opens Greenhouse's own form when its board is
  the site's name** (KAN-424, `engine.js`'s `formFor`): stripe.com's
  link is board `stripe`, and when the Job Board API's job under that
  board is shown on the link's own host, the tab opens
  `job-boards.greenhouse.io/embed/job_app?for=<board>&token=<id>`. Stripe's
  link lands on the job's description, its form a page further behind
  Apply, so a batch tab opened on it found no form and filled nothing
  (live, 2026-10-28). Any other `?gh_jid=` link opens as below.
- **A careers page that embeds Greenhouse is filled in its iframe**
  (KAN-369). A `?gh_jid=` link on a company's own site (hosts.py takes
  them all) whose board isn't the site's name opens as it is, and the fill runs in
  the page's `*.greenhouse.io/embed/job_app` frame only
  (`embedded-forms.js`; `injectFill`'s and `formShows`'s `frameId`). The
  extension has no host permission for the company's page: Chrome redacts
  its URL from `chrome.tabs`, and `allFrames` refuses the whole tab, but a
  frame on a permitted host takes a script by its frameId. That frameId is
  read from the iframe's own request through `webRequest` (no new
  permission, so no install warning; `webNavigation` would warn "Read your
  browsing history") and kept per tab in `storage.session`. No embed frame
  within 10 seconds, or no form in it, and the tab needs the student. The
  panel shows inside the frame. Popup Autofill on such a page still names
  the iframe's `src` (decision 633). Greenhouse's page starts React only in
  `requestIdleCallback`, which an iframe in a background tab may never run:
  its form stayed dead and the fill waited on it for good (1 run in 2 to 4
  with four Chromiums at once). The manifest's one static content script,
  `embed-idle.js` (MAIN world, `document_start`, the embed frame only),
  gives those callbacks a 500 ms deadline.
- **Wait for the page, then the form, then fill.** `startFill` waits for
  the tab's `complete` status (30 seconds at most), injects `waitForForm`,
  which watches the DOM (never `requestAnimationFrame`: a hidden tab runs
  none) for up to 10 seconds, then injects the fill. A page that never
  loads, shows no form, or is on a host the extension may not touch (a job
  system with no Filler) fills nothing and goes to Needs you. Ashby's
  application has no `<form>` element, so the wait also takes a field in
  Ashby's `[data-field-path]` boxes; without it every Ashby tab went to
  Needs you with nothing filled (`test/ashby.extension.spec.ts`). A tab the
  job system moved off its form (the link no longer a form by `jobOf`) opens
  the form again, once: Lockheed Martin's Eightfold sends one of two forms
  opened at once in a new session to its job search, and the form shows the
  second time (`test/batch.extension.spec.ts`).
- **The overlay puts itself back when the page removes it.** Greenhouse's
  React app can drop nodes it didn't render, sometimes by replacing
  `<html>` itself. `overlay.js`'s `keepAttached` watches the whole document
  and appends the same host again, to whichever `<html>` exists.
- **`run/open` never reloads or refills a tab already open.** A second
  click (another card, Start again) tops up the window from the queue and
  leaves the open tabs alone (`fill: "kept"` when nothing new opened). A
  student who reloads a tab by hand fills it from the panel's Autofill This Page.
- **A Workable form fills from empty, in a batch or not.** Workable
  restores an unsent draft from local storage (`evergreen-*`) as its form
  opens, and the engine won't add to entries a section already lists. A
  batch tab forgets the draft and reloads as it opens (`batch.js`'s
  `startFill`), only when there was one: every fresh form writes an empty
  index (`evergreen-meta-peristence` = `{}`), which is no draft, and the
  reload costs a second page load (about a second live); the student's own Autofill does so only when its first Plan
  finds entries showing once the form's Submit shows (`tab-load.js`'s
  `forgetShownWorkableDraft`), then fills again, so what the student typed
  by hand on that form is lost (`test/workable.extension.spec.ts`). The
  draft is forgotten again as the page goes (`pagehide`): Workable can save
  it back after it was forgotten, seen as a flaky refill in that test.
- **Nothing here waits on a redraw.** The first runner fill (before the
  Fill engine) filled the name fields, then reported "No options appeared"
  on every dropdown: its waits polled with `requestAnimationFrame`, which a
  hidden tab never runs. A new wait in `src/` watches the DOM
  (`MutationObserver`) with a `setTimeout` limit.
- **The student's submit marks the application applied (KAN-374).** The
  extension never clicks, presses or sends a form's Submit; it only reads
  the job system's answer once the student has. Each signal is the Fill
  engine's (`src/submit.ts` in the engine, tested there on recorded
  answers): in the page, `watchSubmit` wraps the page's `fetch` and reads
  the submit's answer (Greenhouse: an OK answer; Ashby: every form result a
  success, no block message, from either of its submits: the multiple-forms
  mutation, or `ApiSubmitSingleApplicationFormAction` for a posting with no
  survey forms, which the engine and `SUBMIT_REQUESTS` once missed, so such
  an Ashby application was never marked) and watches for a success or failure notice
  that newly shows (Ashby, Workable, Eightfold, Rippling, Workday); in the
  background, `submittedPage` is the page shown once an application is sent
  (Greenhouse's confirmation; Lever's thanks, its only signal, since its
  form is a plain HTML post). A batch tab's content script asks for the
  watch (`batch/watch`, with a random key it makes in the isolated world)
  before its fill, listens for the engine's `fillengine:submit:<key>`
  event (its detail is JSON: an object detail reaches the isolated world as
  null), and on a sent application says
  `batch/submitted`. The key keeps out a page script that merely guesses
  the event's name, but not one written to hook the engine before it runs
  (it shares the engine's world), nor one that moves the tab to a thanks
  page itself. So the page's signals are only hints: **on a job system
  with a known submit request, the application is marked applied only on
  the job system's own answer to it**, which the service worker sees with `chrome.webRequest`
  (`src/background/submit-proof.js`, observing only, no body;
  `SUBMIT_REQUESTS` is the one table of each job system's submit request).
  Greenhouse's OK answer marks it alone; Ashby (it answers 200 to a
  refusal), Lever (its post redirects to the thanks page) and Workable
  also need the page's hint after the answer, within 5 minutes. A job
  system with no `SUBMIT_REQUESTS` row (Workday, Eightfold, Rippling: no
  submit request of theirs is recorded) is marked from the page's hint
  alone (its confirmation notice), weaker but no worse than before the
  proof; a page script there can fake it. Add a row only from a recorded
  submit request. `webRequest` shows no install warning (Chrome's permissions
  list gives none; the hosts are already in `host_permissions`, which it
  also needs, for the request and its initiator), so adding it doesn't
  disable the extension on update; `debugger` would read bodies but warns.
  Limit: a page script that hooks the engine can still pair a fake hint
  with a real Ashby refusal (a 200). `markSubmitted` (batch.js) then keeps the resume the
  fill attached as the sent resume (`PUT .../resume` with the profile
  resume's `uploaded_resume_id` or `built_resume_id`; one that fails is
  logged, never blocks), marks it applied (`POST .../finish
  {"outcome": "submitted"}`), and takes the tab out of its group. Once
  only: the answer and the confirmation page may both say so, and a tab
  marked applied ignores later `batch/state`. A refused submit is a failed
  row with the job system's words ("Greenhouse refused it: ..."), which
  moves the tab to Needs you; the application stays unapplied. A practice
  batch (KAN-378) is left out: its forms are no applications, and their
  submit is their own `/thanks` page (`submitPractice`).
- **"I submitted this"** (KAN-369): a batch tab's panel ⋯ menu has it, for a
  submit detection missed. It answers only the student's own click
  (`isTrusted`, as every panel action, below), says `batch/i-submitted`, and the worker marks the application
  applied with `markSubmitted`, as a detected submit. A detected submit
  says "Application sent / WorkIt marked it Applied." on the panel, the tab
  leaves its group, and the Auto Apply page shows the row Applied. The
  student's submit is caught also after the panel is closed (the watch is
  the page's, not the panel's) and after a refill (the engine keeps its
  first watch and key, whose listener stays). Tests:
  `test/submit-detect.extension.spec.ts`.
- **A live check** (KAN-424): `loadExtension(handlers, { live: true })`
  fakes only localhost (the API and webapp), so a test file run by hand
  can open a real posting in a batch tab with the fake student's profile
  and read what the form shows. It never submits; never commit one that
  runs in CI. This is how Stripe's form-less link was found.
- **Tests** (`test/batch.extension.spec.ts`; KAN-373's resume, Skip,
  Workday slot and sign-in in `test/batch-sessions.extension.spec.ts`,
  with fake Workday tenants and sign-in pages in `fake-job-systems.ts`;
  the resume test restarts Chromium on the same profile with
  `--restore-last-session`): the unpacked extension loaded
  into Chromium (`test/loaded-extension.ts`) runs a batch of seven saved
  forms and asserts the window and the groups. Playwright's routing never
  sees the service worker's requests or the first load of a tab the
  extension opens, so the harness sends every host name to fakes in the
  test process (`--host-resolver-rules`): the API (`test/fake-api.ts`) and
  the engine's saved forms (`test/fake-job-systems.ts`). Nothing reaches a
  real WorkIt API, even one running on this machine.
  `test/submit.extension.spec.ts` has the student press a saved
  Greenhouse form's Submit (from the keyboard, the tab brought to the
  front: a hidden tab runs no animation frames, which Playwright's clicks
  wait for), with the fake submit endpoint answering OK or refusing.
  Headless Chromium
  never hides a background tab and Playwright keeps every page it drives
  active, so neither can check hidden-tab timing: that was checked with
  Chromium started directly, its tabs never attached.

A batch tab opens a job's form, not its page (`formUrl`: a Lever
`apply_url` opens the posting, and the form is at `.../apply`). Still
open: a submit refused by Lever (a plain post) shows only on Lever's
page, not in the panel. With the student's Chrome window behind another app, macOS may
slow every tab further; not yet measured.

## Track on WorkIt (KAN-424): a form the student opened themselves

A job form the student opens themselves (from the Jobs page or any company
job board, not a batch tab) whose job WorkIt lists gets **Track on WorkIt**
under the panel's job card (`content/panel-top.js`'s `trackLine`;
`background/track.js`). Pressed, the job is saved to their Applications
(`POST /jobs/{id}/saved`, which keeps any stage it already has) and the tab
is kept as tracked; their submit there then marks it applied (`POST
/jobs/{id}/applied`, as the website's Applied button does), and the line
reads "Marked Applied on WorkIt." Not "Add to Auto Apply": the student is
already on the form, and a queued job would open again in the next batch.

- **The panel asks before it offers** (`track/state`): `POST
  /jobs/listed-by-link` names the listed job and the student's stage and
  writes nothing. A batch tab (batch apply tracks it), a job WorkIt doesn't
  list, an API that can't answer or a signed-out student shows nothing; a
  job already applied shows "Marked Applied on WorkIt." With no job card
  (the engine read no names), the slot shows the line alone.
- **The same proof as a batch tab's submit** (submit-proof.js): the
  background's `markAnySubmitted` marks a batch tab's application
  (`markSubmitted`) or a tracked tab's job (`markTracked`), and nothing for
  any other tab, so the job system's answer to a submit in a tab nobody
  tracks marks nothing. Greenhouse's answer proves it alone; elsewhere the
  page's hint is needed too, as in a batch. **Every fill asks to watch**
  (`batch/watch`); the background watches a batch tab or a tracked one at
  once and keeps any other tab's key (`unwatched`) until Track on WorkIt
  starts its watch, so a press after the fill is caught. `batch/submitted`
  answers `untracked` for a tab nobody tracks, and the page says nothing.
- **A tracked tab is one job**: kept in chrome.storage.session
  (`tracked_tabs`) with the job's identity (the engine's jobOf, as the job
  card matches a page to a posting); a tab that moves to another job's page
  stops being tracked (`followTrackedTab`), so its next submit can't mark
  the wrong job, while a thanks page, which names no job, keeps it. A
  closed tab is forgotten.
- **No sent resume is recorded** for a tracked tab's submit (a batch tab's
  names the resume its fill attached); the application keeps whatever it
  named. **Not covered:** a tracked tab's submit warning (batch tabs only)
  and "I didn't submit this" (a batch tab's; a tracked tab's mark is undone
  on the website's Applications page).

Tests: `test/track.extension.spec.ts` (Ashby's Cohere form: Track, then the
student's submit marks it applied; an untracked form's submit marks
nothing; a job WorkIt doesn't list offers nothing).

## The practice batch (KAN-378): onboarding's batch on WorkIt's own forms

Onboarding's last step (`frontend/src/app/onboarding/applicant/practice-step.tsx`)
sends `practice/open` with the links of WorkIt's two practice forms
(`frontend/src/lib/practice-form.ts`, `/practice/<company>/<job>/apply`);
`batch.js`'s `startPractice` opens them as a batch, with the same tabs,
fill and groups as a real one, and `practice/status` says where each is.

- **Only practice forms on the asking page's own site are opened.** The
  one message that takes links: each must be `practiceJob(url)`'s `apply`
  page (`engine.js`: a path under `/practice/` on one of `config.js`'s web
  origins) and on `sender.origin`. Anything else is dropped, and a message
  with none left fails.
- **The engine fills it as a Lever form.** The practice form is laid out as
  Lever's hosted form, so `jobOf` gives a practice link the site `lever`
  and its Question set is the engine's `parseQuestions("lever", html)` of
  the page itself, fetched by the background (the WorkIt web origins are
  in `host_permissions`). Nothing practice-only is in the engine. The page
  sets `window.jQuery.isReady` and shows `.resume-upload-success`, the two
  signals the Lever Filler waits for.
- **No API queue or stages.** A practice batch keeps its jobs and the
  submitted ones in `workit_batch` itself (`practice`); `topUp` takes the
  next job from there and `setTabState` records no stage. Starting a real
  batch (`run/open`) ends a practice one; `practice/open` while a real
  batch has tabs open answers `batch_running`.
- **Submit is reaching `/thanks`.** The practice form's Submit sends
  nothing and opens the job's `/thanks` page; `background.js` sees that
  URL change (`tabs.onUpdated`, which gives the URL for hosts in
  `host_permissions`) and `submitPractice` marks the job submitted and
  takes its tab out of the batch and its group. Real submit detection is
  KAN-374's.
- **`ping` also answers `pinned`** (`chrome.action.getUserSettings().isOnToolbar`,
  null where Chrome can't say), for onboarding's install step.
- **Tests** (`test/practice.extension.spec.ts`): the loaded extension fills
  both practice forms, served from the webapp's own module, into Ready and
  Needs you; the student's Submit on each reaches `/thanks` with no data,
  and nothing reaches any host but WorkIt's site and API.

## Onboarding's later moments (KAN-387): asked when first needed

Onboarding stops at the practice batch; what it no longer asks up front is
asked on the form that first needs it, in that tab's panel (`overlay.js`'s
`.moment` cards). Each moment is shown once per student, in one tab:
`moments.js`'s `claimMoment` keeps which were shown in `chrome.storage.local`
(`workit_moments`, by applicant id), one claim at a time, so five tabs
finishing together show it once. A student who passes it by answers it in
My Profile instead.

- **The self-identification, on the first form that asks it.** Onboarding
  never asks gender, Hispanic or Latino, race, veteran or disability
  (`frontend/src/lib/autofill-answers.ts`'s `SELF_ID_KEYS`). `planFill`
  names this form's self-identification questions the student hasn't
  answered (`selfId`): the engine plans again as if every missing one were
  "declined", and the questions only that plan answers are theirs. Never a
  list of labels here: which question is which stays the engine's. The tab
  asks (`selfid/ask`); the one that claims it shows the student WorkIt's own
  options (`self-id.js`, copied from the frontend's: change both together),
  nothing preselected, each with Leave Blank. Save and Fill sends the picked
  ones (`selfid/save`, each key and value checked), PATCHes the autofill
  answers, refreshes the cached profile, and tells every other batch tab
  (`selfid/saved`); each plans again and fills those questions. Until then
  nothing is guessed: the fields stay as the Plan left them. Later forms
  fill them from the profile and ask nothing. Not Now saves nothing.
- **Adding Claude, at the batch's first question for it.** Once a batch
  tab has sent its questions for the student's Claude (`batch/questions`),
  it asks `moment/claude`: a student whose Claude already holds a sign-in
  (`GET .../connector`, a live connector token) never sees the step, and
  the first tab to claim it shows Add to Claude. That opens the webapp's
  `/connect/claude/add`, which redirects to Claude's Add Custom Connector
  dialog: the install link is built only in
  `frontend/src/lib/claude-connector.ts`, from the API's address, which the
  extension doesn't keep. The step is one sentence ("Add WorkIt to your
  Claude once. Its answers then fill in here.", KAN-424); the webapp's
  Connect Claude page tells the student to choose "Always allow".
  A practice batch never shows it (its essays stay the student's).
- **Writing samples, once the first written batch is.** A batch tab that
  sends its questions is `writing` (`batch.js`'s `setWriting`, kept in the
  batch); once its last one shows an answer it says `batch/written`, and
  whether Claude wrote any. When no batch tab still waits and Claude wrote
  for this batch, the tab that finished last asks for samples (Add Samples
  opens the webapp's `/profile#writing-samples`; Skip closes it), once, and
  never for a student who has some (`GET .../writing-samples`). A batch the
  student wrote all by hand doesn't ask: the samples are only for their
  Claude's style card.
- **Tests** (`test/moments.extension.spec.ts`): two saved Greenhouse forms
  that both ask the self-identification, for a student with none saved: one
  tab asks, the save reaches the API once, both forms fill, and a later form
  fills without asking. Two Harvey tabs show the add-Claude step once, with
  the webapp's link; with the connector added, neither shows it. In two
  Harvey tabs, the samples ask waits for the second answer and shows once;
  a student with samples is never asked.

## Auth: inherits the webapp's session, has no sign-in of its own

`src/background/webapp-session.js` reads the signed-in session straight out
of the WorkIt webapp's own `sb-*` cookie, via the `cookies` permission.
**This replaced an earlier approach** — an independent sign-in
(`auth.js` hitting Supabase's REST token endpoint directly, plus Google
sign-in through `chrome.identity.launchWebAuthFlow`) — once asked for
sign-in to go through the webapp instead. That earlier code is gone, not
commented out; its reasoning is kept here rather than as dead code, and
it's a reasonable fallback to reach for again if the cookie-reading
approach turns out not to hold up (see Open Items).

**Why `httpOnly` doesn't block this.** `frontend/src/lib/supabase/
cookies.ts` sets `httpOnly: true` on every session cookie specifically so
page JavaScript (`document.cookie`) can't read it — an XSS defense. The
`chrome.cookies` API is a different, more privileged boundary: it's a
browser-level extension capability that sits above the page sandbox
`httpOnly` protects against, and it can read `httpOnly` cookies by design.
That's exactly why the `cookies` permission carries its own "read
sensitive site data" warning on the Chrome Web Store — this is a real,
broader trust boundary than anything else this extension asks for, not a
loophole being exploited.

**The cookie's exact shape was read out of the installed package source
in `frontend/node_modules`, not guessed:**
- Name: `@supabase/supabase-js`'s `SupabaseClient.ts` derives
  `` `sb-${hostname.split('.')[0]}-auth-token` `` from the project URL —
  for this project, `sb-zhdrvdrojipkluhzgsea-auth-token`
  (`src/shared/config.js`'s `SUPABASE_SESSION_COOKIE_KEY`). WorkIt's
  `server.ts` doesn't override `cookieOptions.name`, so nothing in this
  repo chose that name — it's `@supabase/ssr`'s own default.
- Encoding: `@supabase/ssr`'s `createServerClient.ts` defaults
  `cookieEncoding` to `"base64url"` (also not overridden here), so the
  value is a JSON session object, base64url-encoded, prefixed with
  `base64-` (`cookies.ts`'s `BASE64_PREFIX`).
- Chunking: if the encoded value exceeds 3180 bytes
  (`utils/chunker.ts`'s `MAX_CHUNK_SIZE`), it's split across
  `<name>.0`, `<name>.1`, ... — `webapp-session.js`'s
  `reassembleSessionCookie` re-implements `chunker.ts`'s own
  `combineChunks` read-side, since that's an internal module this
  extension can't import.

**Reads cookies with `chrome.cookies.get({ url, name })`, one name at a
time — never `getAll`.** Live-tested against a real signed-in session:
`chrome.cookies.getAll()` came back empty under every filter shape tried
(by `url`, by `domain`, by bare `name`, with no filter at all) despite
`chrome.permissions.contains` confirming the host permission was actually
granted and the cookie visibly present in DevTools — while `get()` with the
exact cookie name found it every time. Since every cookie name this file
needs is already known (the fixed key, plus its numbered chunks), there was
never a real reason to enumerate with `getAll` in the first place; `get()`
sidesteps whatever that was rather than depending on `getAll` getting
fixed. `getCookie()` also always passes a real path (`${origin}/`), not a
bare origin with no path at all — only confirmed working against an actual
page path (`/dashboard`) during that same live test, so the bare-origin
case is avoided rather than assumed safe.

**No refresh is attempted here on purpose.** Supabase rotates the
refresh_token on each use. If this extension refreshed independently and
the webapp's own `src/proxy.ts` refreshed around the same time, one of the
two would present an already-rotated refresh_token and fail — which could
sign the user out of the actual webapp over something happening in the
background here. `getSession()` just reads what's there; an expired
access_token means the popup asks the user to revisit a WorkIt tab (which
refreshes it) rather than this extension trying to fix it quietly. See
Open Items for what a from-scratch refresh story would need to look like
if this turns out to be too conservative in practice.

**Two host families until KAN-296.** Production runs on Cloudflare
(`workitjobs.ai`, `api.workitjobs.ai`). Vercel is retired, but its projects
(`workit-web-gamma.vercel.app`, `workit-api.vercel.app`) still answer until
KAN-296 deletes them, on the same Supabase project and database, so the
published extension keeps both pairs. `config.js`'s `PROD_SITES`
pairs each webapp origin with its API, Cloudflare first.
`webapp-session.js` reads the cookie from localhost, then each pair in
order, and tags the session with the origin it came from. `api.js` then
calls the API paired with that origin, so a student who signed in on
Vercel stays on Vercel. A localhost session with no local API uses the
first pair. The popup's sign-in link opens the first pair's webapp. A
host in `PROD_SITES` must also be in `manifest.json`'s `host_permissions`
(and, for a webapp origin, `externally_connectable.matches`); without it,
the cookie read and the site's Auto Apply message fail silently. Drop the
Vercel pair and its manifest entries in KAN-296, before the Vercel projects go. **A new
`host_permissions` entry makes Chrome disable the extension on update
until each installed user approves the new hosts**, so add hosts in
batches, not one at a time.

## The backend routes it calls, and why each is safe

Batch apply (KAN-369) added routes of its own, all in
`backend/app/routers/auto_apply.py` and `routers/connector.py`, each
checking the student owns the application: a tab's state (`PUT
.../fill`), its written questions and saved answers (`PUT`/`GET
.../questions`), the student's edits (`PUT .../answers`), the answer bank
(`GET .../answer-bank`), the sent resume and finish (`PUT .../resume`,
`POST .../finish`), and whether Claude is connected (`GET
.../connector`). Report a problem (KAN-403, fix reports KAN-369) sends
`POST /fill-reports` (`routers/fill_reports.py`): no applicant in the path;
the row names the signed-in sender, who alone can read it back. The popup's Request this job system
(KAN-369) sends `POST /job-system-requests` (`routers/job_system_requests.py`):
the host alone, no account in the row. The off switch (KAN-467) reads `GET
/extension/config` (`routers/extension_config.py`), public and sent with no
token: it names only the job systems turned off. The rest are older:

`src/background/api.js` mostly calls endpoints that already exist for the
webapp: `GET /auth/me`, `GET /applicants/{id}/profile`, `GET
/applicants/{id}/bank`, `GET /applicants/{id}/preferences`, `GET
/applicants/{id}/autofill-answers`, `GET /applicants/{id}/resumes`, `POST
/applicants/{id}/resumes` (Upload Resume on the Resume/CV row's card,
KAN-424, the Resumes page's own upload), `GET
/applicants/{id}/built-resumes` (plus `.../built-resumes/{id}/render`), and
batch apply's `GET /applicants/{id}/applications/next`. All were already
reachable with a Bearer token before the extension called them. Two routes
existed only for this extension — essay-answer generation and `GET
.../resumes/{resume_id}/bytes` — each explained in its own section below,
with why no existing endpoint was safe/usable from here. A third is batch
apply's `PUT .../applications/{job_id}/fill` (KAN-370): the stage is the
API's record of each tab, and no route set `needs_you` back to `queued`.

**The profile is fetched once at a time.** `getAutofillProfile` keeps the
fetch under way and hands it to every caller that comes meanwhile: write
early (`write-early.js`) fetches it as a batch starts, and a fast-loading
tab's Plan used to ask the whole profile (eight calls, the resume's bytes
among them) a second time beside it (KAN-369, seen on Rippling). A forced
fetch (`force`, after an edit) never joins one under way, which may have
started before the edit. A cached profile is used only for the account
signed in, read from the access token's `sub` (`webapp-session.js`) with no
API call: before KAN-312, one cached under ten minutes ago was used for
whoever signed in next, so a second student on the same Chrome got the
first one's name and answers. Past its 10 min TTL a profile under a day old
is used at once while a fresh one is fetched behind (a cold API answered in
4-9 s live); an older one is waited for. The
fetch starts before anything waits for it (`warmProfile`): as the webapp
pings (its pages opening, Auto Apply's among them) and as a job page's
panel asks `panel/where`. Not at `run/open`: its seven parts, asked before
the tabs open, took Chrome's six connections to an HTTP/1.1 API and held
`applications/next` one round trip (every tab 150 ms later at a 150 ms API);
write early asks for it once the tabs have opened (`test/batch.extension.spec.ts`). Its parts (profile, bank, preferences, autofill answers, the
resume, the transcript, the brought fill profile) are asked at once after
`/auth/me`, not one after another: none needs another's answer, and the
transcript waits for the resume only to tell their names apart. Live, at a
few hundred ms a call, that is about three round trips instead of eight.
`test/plan-fetch.extension.spec.ts`.

**Who is signed in is asked once a minute.** `me()` keeps `/auth/me`'s
answer for a minute per session token (a batch asked it before nearly every
call: three round trips after each fill alone); a new token, no session
(signed out) or a refused answer asks again. `test/plan-fetch.extension.spec.ts`.

**What a student brought from Apply lies under WorkIt's fields.** `GET
/applicants/{id}/fill-profile` (KAN-369) is the Fill engine's own profile
and policies the student imported from Apply
(`backend/app/scripts/import_apply_profile.py`; `backend/app/models/CLAUDE.md`,
"The Fill engine's profile"). `fetchAutofillProfile` keeps it as the
profile's `fill` (best effort: without it, WorkIt's fields alone).
`engine.js` `engineProfile` lays what WorkIt builds over it, section by
section (`layered`): a value WorkIt holds wins, one it lacks (null, empty)
leaves the brought one, so a screener or a self-identification answer WorkIt
has no field for still fills. Policies go the other way (`enginePolicies`):
the student's brought rules lie over WorkIt's `POLICIES`, since they say how
that student applies (Apply's how-heard beats WorkIt's default). Its answer bank
arrives through `GET .../answer-bank` with the rest. Each job WorkIt holds
goes to the engine with its bullets, in their order, one a line, as its
`description` (Workday's Role Description, as Apply gives it).
`test/apply-profile.spec.ts`.

**The email it fills is the profile's `contact_email`, else `/auth/me`'s
sign-in email** (KAN-262). A seeker may apply with a different address than
the one they sign in with, and My Profile is where they set it. Filling the
sign-in email always would put the wrong address on every application.

The backend needed **zero CORS changes** for this to work: MV3 extensions
with a target host listed in `manifest.json`'s `host_permissions` bypass
CORS entirely for fetches made from the background service worker — the
browser trusts the extension's declared permission instead of requiring the
server to opt in. This is standard, documented Chrome extension behavior,
not something this prototype had to build. See Open Items for the one
caveat (this is unverified against a live Chrome instance — see below).

## Work authorization, visa, clearance and EEO self-identification questions

KAN-283's `autofill_answers` (`backend/app/models/autofill_answers.py`) holds
the nine answers hiring systems repeat on every form:
`work_authorized_us`, `needs_sponsorship`, `work_authorization_status`,
`security_clearance`, `gender`, `hispanic_latino`, `race`,
`veteran_status`, `disability_status`. Onboarding's Profile step and My
Profile write it, and the extension writes only the self-identification a
form first asks (KAN-387, above); otherwise it only reads it, and `engine.js`'s
`engineProfile` turns each option key into the fact the engine's rules
read (yes/no as true/false, "declined" as "decline", the rest in
`frontend/src/lib/autofill-answers.ts`'s own words). The engine picks the
form's option that says the same thing.

The same bank holds the **Application answers** (KAN-369, My Profile's
section of that name): `engineProfile`'s `applicationFacts` gives them as
`logistics.*` (on-site, 40 h, start and end dates, terms, relocation, ranked
`location_preferences` one place an area (with its city alone), `referrals` from `referred_at`),
`identity.home_address` (line 1 and zip over the location's city and state),
`identity.summer_2027_location`, `identity.languages` (spoken and written)
and `screeners.*` (relatives at a company, a relative who is a public
official, prior government work, non-compete, pending offers). A screener is
only the student's own answer, never a default; an empty list is their
"none". `schoolYear` derives `education.class_year` and
`returning_to_school_after_internship` from the latest education entry's
end month (`engineProfile(profile, today)`), with no new input.
The rest of the section reaches the engine as `identity.age_18_or_over`,
`identity.pronouns`, `voluntary_self_id.{sexual_orientation, transgender,
communities}` (decline as "decline"; communities [] is "none of these"),
`experience_facts.role_interests`, `links.x_twitter_url` and
`work_authorization.citizenship_countries` (any country; the engine picks it
from a list of countries of citizenship, two being a dual citizen's). Pay is the
student's own answer, laid over the policies by `enginePolicies`:
`compensation.fallback_hourly` (their hourly figure) and
`accept_stated_rate` (with "Open to the posted range" as the words). From
the bank, with no new input: `experience_facts.prior_internships_count`
(jobs titled intern or co-op; unknown while the bank holds no job) and
`identity.current_company` (the job held now).

- **`work_authorized_us`/`needs_sponsorship` fall back to the onboarding
  "Visa Sponsorship" job-search filter** (`applicant_preferences.visa`,
  KAN-231) when a student hasn't answered KAN-283's questions yet —
  `background/api.js`'s `inferredAnswers`. `null` ("I Don't Need One")
  means authorized and no sponsorship needed; `"sponsors"` means
  sponsorship will be needed (it says nothing about current work
  authorization, so that one stays unanswered). A real saved answer always
  wins.
- **An unanswered question is the student's, never a guess** — a wrong
  answer on a legal-eligibility or self-identification question is worse
  than one the student fills in. The Plan lists it as a Missing fact; the
  overlay marks it failed when the form requires it, skipped when not.

## Attaching the student's resume file

Greenhouse's "Resume/CV" field is a stable `input#resume`, `type="file"`,
`accept=".pdf,.doc,.docx,.txt,.rtf"` — confirmed live (The Trade Desk's
posting), sitting behind styled "Attach"/"Enter manually" buttons but the
real file input is directly targetable underneath both.

- **Resolved to file bytes at profile-fetch time, not a pointer.**
  `background/api.js`'s `resolveResumeFile` runs as part of every
  `fetchAutofillProfile`: it reads My Profile's one default resume — an
  upload (`GET /applicants/{id}/resumes`, `is_default`) or a built resume
  (`GET /applicants/{id}/built-resumes`, `is_default`; the two are never
  both set, `backend/app/models/CLAUDE.md`'s "Built resumes") — and fetches
  the actual bytes right there, base64-encoded onto the cached
  `AutofillProfile.resume`. A built resume reads straight from the API:
  `GET .../built-resumes/{id}/render` already returns its PDF base64 in the
  response body (`backend/app/routers/built_resumes.py`'s
  `RenderResponse.pdf`), the same render the resume editor's own preview
  uses.
- **A second new backend route, after essay-answer.** An uploaded resume's
  first implementation read `GET .../resumes/{id}/file`, the webapp
  preview's 5-minute signed Storage URL, and fetched it directly from the
  background worker. That shipped, was reasoned as safe (MV3 background
  workers bypass CORS for `manifest.json`'s listed `host_permissions`,
  which cover this API's origins), and was even checked live: a
  cross-origin `fetch()` to this project's `/storage/v1/object/sign/...`
  endpoint from the webapp's own tab came back `type: "cors"` — a real,
  readable response, not the `TypeError: Failed to fetch` a true CORS
  block throws. **It still didn't attach from inside a real loaded
  extension** — the one check that manual test couldn't stand in for.
  Signed Storage URLs live on Storage's own domain, outside this
  extension's `host_permissions` entirely, so that fetch answers to
  whatever CORS policy the Storage bucket itself has — and the live
  failure says that policy allows the webapp's own origin (which my manual
  test used) without necessarily allowing a `chrome-extension://` one. The
  fix was the one this section used to name as a fallback: `GET
  /applicants/{id}/resumes/{resume_id}/bytes`
  (`backend/app/routers/resumes.py`'s `get_resume_file_bytes`) downloads
  the file server-side (Supabase's Python client, no browser CORS
  involved) and returns the raw bytes from this API's own origin instead
  — an origin `host_permissions` already trusts, so there is no third
  party's CORS policy left to depend on. `background/api.js`'s
  `apiFetch`/`apiFetchBinary` now share one `apiRequest` helper (session
  check, Bearer header, base URL) so this one binary-response endpoint
  didn't need its own copy of that logic.
- **Best-effort, like the visa-filter fallback above.** No resume, or any
  fetch failure along the way, collapses to the same thing — `resume:
  null` — rather than failing the whole profile load over one field. The
  Plan then lists the resume as a Missing fact (failed only when the form
  requires it).
- **The engine attaches it**, from `{ file, type, base64 }`, through a
  `DataTransfer` and the events a file picker fires, and waits for
  Greenhouse's uploader to show the file.

## Attaching the student's transcript (KAN-369)

Some forms ask for an unofficial transcript (Verkada requires one). The
student keeps one on My Profile (`backend/app/routers/documents.py`).
`resolveTranscriptFile` fetches it with the resume, at profile-fetch time:
`GET /applicants/{id}/documents`, then `GET .../documents/transcript/bytes`
(from this API's own origin, as the resume's `.../bytes` and for the same
reason), onto `AutofillProfile.transcript`. `engineProfile` gives its name
as `files.unofficial_transcript_pdf`, the engine's name for it (rules.ts
plans it for a "transcript" upload, never a graduate transcript), and
`withFiles` gives the planned file its bytes. A transcript named as the
resume is gets a `Transcript_` prefix, since a planned file is matched to
its bytes by name. Best effort, like the resume: no transcript, or a failed
fetch, is `transcript: null`, and the Plan lists a required transcript as
a Missing fact. Test: `test/transcript.extension.spec.ts`.

No photo is ever uploaded, not even a placeholder image (Simplify fills a
required one with a blank white PNG in its best-effort mode; WorkIt never
puts a fake file in a real application). The engine's Plan leaves a photo
upload (avatar, photo, picture, headshot) blank: Workable's optional Photo
stays empty, and a required one is a handoff the panel lists under "Left
for you" ("Photo upload: add a photo yourself"), while the still-empty
required field keeps the batch tab in Needs you. WorkIt stores no profile
photo for forms.

## Essay-question generation: the one opt-in, model-backed feature

Open-ended questions ("Why do you want to work here?") have no fixed
answer. The Fill engine's Plan says which questions need a written answer
(its essays, and its drafts in a text area; `engine.js`'s `planRows`), and
the overlay lists each as "needs_generation" (`lib-status.js`).

- **One blanket opt-in, never per-question.** After the fill, the overlay's
  `promptForEssays` asks once: "N essay question(s) found — generate
  answers with AI from your experience bank?" Nothing is sent anywhere
  until the student clicks **Generate**. **Not Now** marks each one
  "skipped" (never "failed": the student chose to answer it).
- **AI traps and bans stay the student's.** A form or posting that bans
  AI-written answers, or a posting that speaks to AI agents, makes the Plan
  hand those questions off instead: they never reach the essay route, and
  the overlay lists the Plan's reason under "Left for you". Outside a batch
  tab, a draft that is a choice (a dropdown) or one line ("Nick Name") is
  the student's: the essay route writes sentences and can't pick an option
  (`planRows`' `generate` is false for them). In a batch tab the student's
  Claude answers them (below).
- **Generation is sequential** (`written-answers.js`'s `onGenerate`), one
  `essay/generate` per question: each is its own counted AI use, and the
  overlay shows each row as it lands. The answer is then filled through the
  engine like any other. The box's own `maxlength` goes with the question,
  capped at the route's 5000: Workable's cover letter takes 200000, and the
  route answered that with a 422.
- **A letter for an upload goes up as a PDF.** An optional cover letter
  upload is an essay under the student's `cover_letter: "always"` policy
  (often brought from Apply). Its written words, Claude's or the essay
  route's, are made a PDF (`letter-pdf.js`: Helvetica, wrapped, no
  library) named for the student as their resume is
  (`First_Last_Cover_Letter.pdf`, with the first and last name the
  student goes by when the profile brought from Apply holds one, else the
  legal ones) by `engine.js`'s `asUploads` before `fill/page` fills it, so
  the row shows the file's name. The letter is headed as the resume is:
  the name, larger, over a contact line (phone | email | LinkedIn |
  GitHub, the links without `https://www.`), as Apply's letter is. No
  date or "Re:" line: the student's Claude writes the whole letter.
- **Company name and job title come from the job system's API** (the Job
  Board API's `company_name` and `title`), not the page's title.
- **The model call is `POST /applicants/{id}/essay-answer`**
  (`backend/app/routers/essay_answer.py`): grounded in the whole
  experience bank, checked against the truth rule, never given identity
  data. The question, company and role count as given, so an answer may
  name them (before that, every live answer was refused: "Cloudflare" and
  the pronoun "I" read as invented tools). A 429/503/422 becomes the row's "failed" reason verbatim (a 422
  that lists errors, as their messages: `api.js`'s `errorMessage`); there is
  no retry.
- **Nothing is persisted.** The question and the generated answer are
  never saved.

## The panel's shell (KAN-394): one docked panel, slots to plug into

The extension's on-page UI is one panel, `src/content/panel.js`
(`window.WIA.panel`): 380 px wide, floating 8 px in from the top, right and bottom
edges with `--radius-shell` (20 px) corners, with its own scroll, over the page (the page is never resized), in a
shadow root on `#workit-autofiller-overlay-host`, so the employer's styles
can't reach it. **The root is closed**: the page's scripts get null from
`host.shadowRoot` and see none of its text or buttons; the extension's own
files reach it through `window.WIA.panel.root` in their isolated world.
**Every panel action that changes something answers only the student's own
click** (`event.isTrusted`, through `ui.js`'s `trusted`, which `button()`
and row-card buttons use): Disconnect Claude, Send report, a Choose a Resume row, Upload Resume, the job card, Tailor,
Fill Again, Next job / Next tab, Looks right, Keep, Rewrite, Save answer,
Stop and Skip, Skip this job, I submitted this, I didn't submit this,
the essay banner's Generate, the self-ID Save. The marks' root (`marks.js`, the ring) is closed too. Tests: the test copies of the extension
(`loaded-extension.ts` `openPanel`, over `CLOSED_ROOT_FILES`: panel.js and marks.js) open both roots, since Playwright's
locators can't reach a closed one; `loadExtension(..., { closedPanel: true })`
keeps them closed (`test/panel-closed.extension.spec.ts`). There is no bottom-right card any more, and the toolbar
popup has no fill controls. The whole panel is white, the body as well as
the header (a gray body made every card read as a gray slab); its cards keep
their borders. The header holds WorkIt's logo as the webapp draws it (the
figure violet, the word ink), then ⋯ and Close, each a bare 18 px
Phosphor glyph (DotsThree, X) in a 32 px target named by its
`aria-label`, with no outline (a circle border read as odd; hover shows the
round target). Text glyphs sat off their line and read too small. Purple is
otherwise kept for the primary action. The Claude moment card is rounded like
the boxes under it.

**Slots.** panel.js draws only the frame; every other file plugs into a
slot by name, `panel.slot(name)`, and adds its styles with
`panel.addCss(css)` (tokens only):

| Slot | What goes there | Today |
|---|---|---|
| `header-actions` | buttons beside ⋯ and Close (kept empty: actions go in the ⋯ menu) | none |
| `batch-line` | Workday's step line only ("Step 3 of 6 · My Experience") | panel-top.js |
| `job-card` | the job card (title, company, Match score) | panel-top.js |
| `primary` | the one big button, fixed at the panel's bottom; `panel.setPrimary({ label, onPress, secondary })` or `panel.fillButton(label)` | Autofill This Page / Fill this step (launcher.js), then primary.js: "Next: N need you", Review and submit, Go to Save and Continue, Fill Again's question |
| `tab:<id>` | a tab's body; `panel.addTab({ id, label })` adds one, the strip shows from two | `tab:autofill`, the only one (KAN-424): overlay.js's summary, essay banner, moment cards, parts and rows |
| `settings` | the settings view, shown by the ⋯ menu's Settings in place of the tab's body (`panel.showSettings`; `panel.onView(hook)` hears it open) | panel-settings.js: Claude connection, Open the panel by itself, Report a problem, Workday Sign-Up, Back |
| `report` | Report a problem, shown in place of the tab's body; open it with `window.WIA.reportCard.open({ trigger, field })` | report.js: the preview, Which field is wrong?, the note, Exactly what WorkIt sends, Send report, Back |

**The frame (KAN-369 Q4-Q6).** Top to bottom: the header (WorkIt, ⋯,
Close: Close is the old Collapse, `data-collapse`); the batch line, job
card and tab strip, fixed (they never scroll, in every state but signed
out, where panel-states.js hides the tabs); the tab's body or a view
(settings, report), which scrolls (`.scroll`); and the `primary` slot,
fixed at the bottom (`.bottom`, gone while the slot is empty). A view
covers only the tab's body: the strip stays, and pressing a tab leaves the
view. **The ⋯ menu** (`panel.menuItem(id, { label, onPress, order } |
null)`, role menu, shut by Escape, a press elsewhere in the panel or an
item) holds, by `order`: I submitted this (10) and Skip (20) in a batch
tab (overlay.mount), Fill Again (30) after a fill (primary.js), Report a
problem (40) and Settings (50), the shell's own. Each item carries
`data-<id>` (`[data-skip]`, `[data-submitted]`, `[data-again]`); an item
that changes something passes its `onPress` through `ui.trusted`. Tests
open it with `menuItem(host, name)` (test/loaded-extension.ts).
`test/panel-controls.extension.spec.ts` covers the frame.

**One view (KAN-424).** The shell makes one tab, Autofill, so the strip
(the webapp's segmented control, `.tabs`, which `addTab` shows from two)
stays hidden. The Resume tab (KAN-399) and the Answers tab (KAN-400) are
gone: a student rarely switches résumés mid-fill, and a written answer is
a field like the rest, only one that asks more of them. The résumé's
actions are the Resume/CV row's card (resume-card.js, "The résumé's card"
below) and the written answers a box in the list (card-written.js,
"Written answers in the list"). Keyword match and Tailor for this job
left the panel: the job card links to the job's page on WorkIt, which has
both. `addTab`, `showTab` and the strip's styles stay for a later tab;
the chosen tab is still kept in `sessionStorage` (`workit-panel-tab`).

`batch-line`, `job-card` and `settings` are cards hidden while empty: a
file that fills one sets `hidden = false`. A file loaded before the shell
exists waits for it with `panel.onBuilt(hook)`. overlay.js keeps its API
(`mount`, `refresh`, `addPart`, `momentCard`, ...); `mount` now fills the
Autofill tab instead of making a host, and `unmount` (a fill again)
empties it and leaves the shell. panel.js is loaded first by the static
launcher and again by every fill (`CONTENT_SCRIPT_FILES`,
`HUMAN_CHECK_FILES`), in the same isolated world: the first copy makes the
shell, later ones return at once. It also owns the font (`overlay/font`)
and `keepAttached` (Greenhouse replacing `<html>`).

**When it shows.** A batch tab's panel opens once its fill is done
(`panel.autoOpen` from `overlay.mount`; on Workday at the first step); a
job page outside a batch shows only the edge tab, with Autofill This Page
behind it; other pages show nothing. The student's press on Autofill This
Page opens it (it is open already).

**The edge tab** replaces the old "WorkIt" pill: Close (the header's
×, `data-close` kept for older tests) leaves it on the right edge. It is
dragged up and down (a move under 4 px is a press, which opens the panel);
its ⋯ menu has **Hide until next visit** (this page only: the next page
load shows it again) and **Hide on this site**. Per site (host name),
`panel_sites` in chrome.storage.local (background.js `panel/where`,
`panel/site`) keeps `{ top, collapsed, hidden }`: where the tab sits, a
collapse (a batch tab's panel then stays collapsed on that site), and the
site hide (a batch tab's edge tab still shows). Opening the panel by any
press lets a collapse and a hide go.

**The toolbar icon and Alt+W.** `panel/where` on a job page sets that
tab's popup to "" (per tab, so both behaviours coexist), so the icon's
press reaches `action.onClicked`; it and the `toggle-panel` command
(Alt+W, changeable at chrome://extensions/shortcuts) call `toolbarPressed`,
which sends `panel/toggle` to the tab (whichever frame has the shell
answers). A job page with no shell yet gets one, open; any other tab gets
its popup back and opened. Signed out, the popup is one line ("Sign in
to WorkIt to fill job applications.") and **Sign In to WorkIt** (KAN-424):
the popup reads the session each time it opens, so it needs no Check Again
button, and it no longer explains that the extension borrows the website's
sign-in. Off job pages the popup shows who is signed in and is
**tailored to what the student is doing, not to whether the website is
open** (KAN-424, `background/popup-home.js`, `popup/home`), with that
case's one next step as its button: during a batch, "Your Batch", its
status ("2 jobs in your batch · 1 ready · 1 needs you") and **Go to Next
Job** (`popup/next`: the first tab that needs the student, else a ready
one); with no batch, "Auto Apply", "3 jobs queued." and **Start Auto
Apply** (`popup/start`: the webapp's own `run/open`, so the batch opens
as from the Auto Apply page); with an empty queue, **Find Jobs** (the
Jobs page). A queue that can't be read shows nothing rather than "empty".
Then Open WorkIt, as a quiet link. **No Workday Sign-Up** (KAN-424): on
every page the popup's link read as "sign in to Workday"; it lives in the
panel's Settings and the website's Settings > Connected Apps. The three answer
only the popup's own page (`fromPopup`: the sender's URL is the
extension's popup.html; a content script's is its job page), so a page's
script can't open a batch or switch tabs. Tests:
`test/popup-home.extension.spec.ts`, and the batch case in
`test/panel-shell.extension.spec.ts`. A failed profile read shows "WorkIt
couldn't load your profile." with Try again (KAN-401), never the request's
words; api.js's `errorMessage` says "WorkIt's server couldn't do that just
now." for an error answer with no words of its own, never "Request failed
(404)". `globalThis.workitToolbar`
is the tests' press of the icon, which no page can press. A test can't
press an extension command's keys either, so the Alt+W test checks only
that Chrome bound it.

Tests: `test/panel-shell.extension.spec.ts` (docked, over the page, the
page's styles kept out; the edge tab alone on a job page and nothing
elsewhere; Autofill This Page from the panel; drag and hides kept per
site; a kept collapse in the next batch tab; the toolbar and Alt+W; the
popup elsewhere), `test/panel-reopen.extension.spec.ts` (Collapse, then
the edge tab or the toolbar brings the same rows back, no fill).

### The primary button (KAN-396): its words follow the next action

`src/content/primary.js` (`window.WIA.primary`, loaded by every fill after
the card files) owns the `primary` slot once a fill mounts its rows
(`overlay.mount` calls `primary.mount`; `overlay.offerNext` hands it the
walk). One purple button at the panel's bottom (KAN-369 Q5):

- **Before a fill**: `panel.fillButton(panel.startLabel())`: Autofill This
  Page, or **Fill this step** on a Workday host outside a batch (it fills the
  step shown; the fill then fills each later step as it shows, and Fill to
  Review, `workday-walk.js`, is still what presses Save and Continue, only
  once the student asks).
- **"Answer 1 of 3"** while anything on this page is red (KAN-424;
  lib-status.js's one rule, through `batch-tab.js`'s `flagged()`). It goes
  to this page's first red field in page order (`walk.show`: scrolled to,
  focused, ringed) and, pressed again, **to the same field until it shows
  an answer**: it never moves on past a mistake and never leaves the tab.
  "of 3" counts every field that has been red on this page since the fill
  (`seenRed`), so the first number climbs as the student answers them. It
  replaced "Next: 3 need you" (KAN-396), which ran Next Thing: each press
  moved on whether the field was answered or not, and in a batch tab went
  to another tab while this one still had open mistakes; its words also
  read like "next job". Next Thing itself is Alt+N's (below). What the
  button answers shows under it (`[data-said]`).
- **Review and submit** once nothing is red (amber guesses may be left:
  Alt+N still walks them): scrolls to the employer's Submit
  (the submit warning's rule: a visible control whose words start with
  "Submit", never WorkIt's host), rings it (marks.js) and focuses it. It
  never presses it. A Submit under the open panel (Anduril's sits at the
  right) collapses the panel to its edge tab, for this page only
  (`collapse({ keep: false })`), so the student can press it. On a Workday step that isn't the last (`phase` "step")
  it reads **Go to Save and Continue** and rings Workday's footer button
  instead; on Review its Submit.
- **Alt+N**: the `next-thing` command (manifest.json, changeable at
  chrome://extensions/shortcuts). background.js `commandPressed` sends
  `panel/next` to the tab; the frame with the button runs Next Thing (the
  walk: `batch-tab.js`'s `flagged().keys`, red rows first, then unchecked
  guesses and Claude's just-arrived answers; in a batch tab across the
  batch's tabs, `batch/next`; outside one, this page's rows in page order
  after the last it went to, then "Nothing else needs you."), whatever the
  button reads (so a batch tab with nothing left still walks on to the
  next tab). Tests press it with `globalThis.workitCommand`
  (`pressNextThing` in test/loaded-extension.ts).
- **There is no count line** (KAN-424). The Autofill tab's `.summary`
  ("Required 12 of 14 filled · 3 need you · 1 waiting on Claude") said
  the button's count again; the checklist's box titles and folded lines
  (groups.js) carry the counts now, by the same rules.
- **Fill Again** is the ⋯ menu's; it asks once, over the button, "This
  replaces what you changed on this page.", with Fill Again and Cancel;
  Cancel changes nothing.
- Outside a batch the fill now reads back the student's edits too
  (content-script.js `watchEdits`, which only a batch ran before), so a row
  they answer stops being open and the button can reach Review and submit;
  their answers are still saved only in a batch (keepOwn, card-guess.js).
- While a Workday step fills, the button reads "Filling…", disabled; the
  Workday loop calls `primary.refresh()` once the step's phase is set.

**Embedded Greenhouse forms.** The launcher's static content script runs in
every frame (`all_frames`) of the listed hosts, so a company careers page
that embeds Greenhouse's form (`boards.greenhouse.io/embed/job_app` in an
iframe) gets the edge tab and the panel inside the iframe, and its Autofill
This Page fills that frame (`panel/fill` uses `sender.frameId`). The
company page itself, like any host the manifest doesn't list, gets
nothing: no edge tab, and the toolbar icon opens the popup, which has no
fill controls since KAN-394.

Tests: `test/panel-primary.extension.spec.ts` ("Answer 1 of N" against
the red box, staying on the first red field; Alt+N; Review and submit
rings Submit and sends nothing; Fill Again's Cancel; Fill this step on
Workday; the embedded form).

### Live progress (KAN-398): Scanning, Autofilling · N%, Cancel and Skip

`src/content/progress.js` (`window.WIA.progress`, loaded just before
content-script.js) covers the `primary` slot while a fill runs: the slot
gets `data-progressing`, which hides its button, and a `[data-progress]`
block shows "Scanning this page", then "N fields found" (the Question set
the Plan read), then "Autofilling · 37%" over a bar (its `aria-valuenow`
counts the fields done), with **Cancel**. The fields themselves are the
Autofill tab's checklist (groups.js, drawn from the start). `fillShown`
calls `begin` (with `stay` on Workday, which adds "Stay on this page until
WorkIt finishes this step."), `found`, `filling` before each `fill/page`
(a fill that brings on questions adds to the total) and `end` when it
returns, so on Workday the notice goes with each step's fill.

- **The engine's events.** The engine runs in the page's world, so
  `filling` returns a key (`workit-` and a `crypto.randomUUID()`, as the
  submit key, so a page can't guess the event names and stop or skip the
  fill) that `fill/page` hands the engine's `fillEach` as `events`
  (engine.js `fillPage`). The engine dispatches
  `fillengine:field:<key>` on `document` as each field starts and is done,
  and listens for `fillengine:stop:<key>` and `fillengine:skip:<key>`
  (detail: the field's name). See the engine README.
- **Cancel** (titled Stop autofill) stops the fill before the engine's next field (the
  field being filled finishes). The result comes back `stopped`; the fields
  not reached get "Not filled: you stopped the fill." (Needs you when
  required) and a "You stopped the fill" note, no more questions are
  planned, and a Workday walk ends at that step.
- **Skip** shows on a checklist row still filling after 5 s (`STUCK_AFTER`,
  `progress.isStuck`, the row gets `data-stuck`; `progress.skip`). The
  engine stops waiting for it and goes on; the field comes back `left` and
  shows as failed, "You skipped this. Answer it yourself.", marked red. It isn't sent to a problem report as an engine error. The skipped
  fill's own work isn't cancelled in the page (the engine can't abort a
  filler mid-way), so a slow upload may still land later.
- A batch tab off Workday has no shell until its fill is done (the
  hydration rule above), so it shows no progress and nothing can be
  stopped there.

Tests: `test/panel-progress.extension.spec.ts` (the states in order with
their counts on Anduril; Stop leaves the résumé unattached and says so; a
held upload shows Skip on its row after 5 s and turns red; Workday's
stay-on-page notice shows and goes).

## The panel's other states (KAN-401): signed out, sent, a site it can't fill, errors

`src/content/panel-states.js` (`window.WIA.panelStates`, loaded after
report.js everywhere it is: manifest, `CONTENT_SCRIPT_FILES`, background.js
`SHELL_FILES`) and `src/background/panel-states.js`:

- **Signed out**: `panelStates.start()` is what the launcher and the
  toolbar call in place of `panel.fillButton` before a fill. Signed out
  (`auth/status`), the panel shows the job card (panel-top.js reads the
  names without an account) and **Sign in to WorkIt** only: the tabs give
  way (`.panel[data-signed-out]`). The button opens the webapp's `/login`
  (`panel/sign-in`; the local webapp when it answers, else WorkIt's site).
  When the student comes back to the tab signed in, Autofill This Page.
- **Sent**: once a batch tab's application is marked applied (a submit
  WorkIt saw, or I submitted this), `panelStates.sent()` puts "Sent ·
  Marked applied on WorkIt" over the fill's button (kept, hidden), with
  **Next job →** (`panel/next-tab`) while another tab needs the student and
  **I didn't submit this** (trusted clicks only, as I submitted this):
  `batch/unsubmitted` (batch.js `unmarkSubmitted`) posts `finish` with
  outcome `unsubmitted` and the tab's `state` from before the mark
  (`tab.before`): Ready sets the application back to queued, anything else
  to needs_you, with no date (backend pipeline.py), and the tab to that
  state, in its group.
- **A site WorkIt can't fill**: every host the manifest lists is a job
  system the Fill engine fills, so the panel never shows this (an allowed
  employer site with nothing to fill gets no panel either); the toolbar
  popup does, on a web page of any other host (not WorkIt's own) that looks
  like a job posting (`panel-states.js` `looksLikePosting`: a jobs, careers,
  apply or position part in its path, or a schema.org `JobPosting` block,
  read in the tab), where the icon's press lets it read the tab's link
  (activeTab). On any other page the popup is the usual batch status. It says "WorkIt
  can't fill this site yet" with **Save to WorkIt** (`popup/save`: `POST
  /jobs/saved-by-link`, which saves the feed's job whose apply link the page
  is, ignoring query, fragment and a trailing slash; "WorkIt doesn't list
  this job yet." when there is none) and **Report a problem** (what it sends:
  job system "unsupported", the posting link as below, the engine, and an
  optional note, `NOTE_MAX` long; then Send report, `popup/report`), and
  between them **Request this job system** (KAN-369, `popup/request`:
  `POST /job-system-requests {"host"}`, the page's host and nothing else;
  "Requested. WorkIt adds the job systems students ask for most."). The
  hosts asked are kept in chrome.storage.local `requested_job_systems`, so
  each is sent once from a browser and the popup then says "You requested
  this job system." instead of the button (test:
  `request-system.extension.spec.ts`). Nothing leaves on opening the popup. Its
  test opens popup.html with `?tab=<id>` and loads a copy of the extension
  granted the fake host (`loadExtension`'s `grantHosts`), standing in for
  activeTab, which no test can press.
- **Between Workday steps**: the panel is never empty. When a step shows
  (in the same page, or as a new page), the fill's loop resets the rows and
  at once draws the step's line, "Workday: My Experience · Filling this
  step…" (content-script.js), with the button at Filling…; the step's rows
  follow as it fills.
- **A job system WorkIt turned off** (KAN-467, `src/background/remote-config.js`):
  when a job system's markup changes and fills break, an admin turns it off
  on the API (`backend/CLAUDE.md`, "The per-job-system off switch") and
  the extension stops filling it with no Store release. The worker reads
  `GET /extension/config` (public, no Bearer; `api.js` `publicFetch`, 3 s
  timeout) as it starts, and again at the next panel or fill once the copy
  in chrome.storage.local `workit_remote_config` is 15 minutes old, so a
  switch reaches a student within 15 minutes. A read that fails keeps the
  last copy; with none, every job system fills. It is data, never code
  (Manifest V3 forbids remote code, not JSON). `fill/available` answers the
  page's job system name (`jobOf(url).site`) when it is off: the panel's
  `start()` shows "WorkIt can't fill Workday right now" in place of its
  button, and `content-script.js` checks it before anything fills, types
  or presses (Workday's sign-in too), shows the same as a failed row and
  stops, so a batch tab needs the student. Test:
  `test/job-system-off.extension.spec.ts`.
- **Errors**: every failed request the panel or popup makes is a plain
  sentence with Try again (or the same button, which retries), never a
  status code or the route's raw words.

Tests: `test/panel-states.extension.spec.ts`.

## The panel's top (KAN-395): header, batch line, job card

The header (panel.js) is WorkIt's logo (logo.tsx's lockup, the figure
violet and the word "workit" in ink, as the webapp and the popup's header
draw it; change the copies together), ⋯ (the menu, above: Report a problem, Settings, a
batch tab's I submitted this and Skip, Fill Again) and Close. `src/content/panel-top.js` fills two slots, loaded
after panel.js everywhere panel.js is (manifest, `CONTENT_SCRIPT_FILES`,
background.js `SHELL_FILES`):

- **Step line** (`batch-line`): on Workday only, "Step 3 of 6 · My
  Experience", read off Workday's step bar (`progressBarActiveStep`) and
  kept up as the steps load, in batch tabs and out; hidden everywhere else.
  **No batch count (KAN-424):** "Batch · R of N ready · Next tab →" took
  the panel's first line to say what the batch's tabs already show, so it
  is gone. The background still answers `panel/batch-line` (the site, and
  for the Sent card whether another tab needs the student), and Next job →
  on the Sent card still goes there (`panel/next-tab`).
- **Job card** (`job-card`, `panel/job`): WorkIt's own posting when the
  student has an application for it (a batch tab's by its job id, any other
  tab's by the Fill engine's jobOf identity of the page against the
  posting's form_url / apply_url), from `GET .../applications?scored=true`
  (read once per 30 s for all tabs). A card like the rows' boxes (the
  panel is white, so the border sets it apart), with no letter square: the
  logo when the API has one (in a 40 px tile; gone if the page won't load
  it), the title on up to two lines, then one line of company, place (`location_label`) and pay ("$45–$55 an
  hour"), and the Match score as a small ring
  (purple) with its band (Strong Match at 80,
  as frontend/src/lib/match.ts), and "You applied on Oct 25" at the applied
  stage. No application, or signed out: the engine's `jobNames` read gives
  title and company only. No score: no ring. **A job WorkIt has is a link**
  (KAN-424): the whole card (`.job[role=link]`, Enter too) opens its job
  page on WorkIt, `/jobs/{job}` on the origin the student signed in on
  (`panel/open-job`, background resume-tab.js `openJob`), in a new tab. A
  job known only from the page's own names isn't.

Tests: `test/panel-header.extension.spec.ts` (a batch tab's card and ring
with no batch count; an own tab's header, Report placeholder and applied card; a
Workday tab's step line).

## Report a problem (KAN-403, fix reports KAN-369): a preview, then Send

A report is written for the developers' coding agent: an admin exports it
as a fix brief (`../docs/fill-reports.md`) that says what went wrong, where
and in which engine file, with the form as a fixture. `src/content/report.js`
(loaded after panel-top.js everywhere it is) fills the `report` slot.
**`window.WIA.reportCard.open({ trigger, field })`** opens it: the ⋯ menu's
Report a problem (a second press closes it), the settings view, the
unsupported-site state, and a checklist row's button (below), which marks
its field wrong at once. The card lists exactly what Send sends, and Send
sends just that:

- the page (the background names it from the tab's URL): the job system
  (the Fill engine's `jobOf` site, "unsupported" when it fills none there),
  the posting's link (only the query parts that name a posting,
  `POSTING_PARAMS`: for, token, gh_jid, jobId, job_id, jobid, jobReqId,
  career_job_req_id, each a plain id; no other part, fragment or
  user:password), the Fill engine version (`ENGINE_VERSION`, which the
  engine's build stamps: package.json's version and a hash of src/; the
  backend's `fill_report` script turns it back into a commit), and
  `context`: the extension's manifest version, the browser ("Chrome 141"),
  the time, `jobOf`'s recognition (site, on its form, the posting's ids),
  top frame or iframe; `trigger`: what opened the card (`TRIGGERS`);
- every field of the fill (the checklist's rows): its name, label (values
  out), label shape, kind, options, required, the selector WorkIt found it
  by (`window.WIA.fieldOf`) and whether it shows, the Plan's source, the
  planned answer's **shape** (`shapeOf`: `text:12`, `option`, `options:3`,
  `file`, never the answer), status, reason (the planned answer and what
  the page showed as «planned» and «shown», anything else it quotes as
  «redacted»), read-back (`matches`, `differs`, `empty`, `unread`), what
  the page shows as a shape, the error's name (Readback, FillError, Handoff,
  NoForm, NoAnswer, Error), `edited` (the student changed it after WorkIt
  filled it) and `marked` (they ticked it under Which field is wrong?);
- the timeline: the Plan, each field's start and end (the engine's
  `fillengine:field` events, `report.follow`), whole-fill errors, and an
  unnamed engine error's stack (`engine.js` `fillPage` puts it on the
  result), each `t` ms after the first, at most 400;
- `html`, the form's markup with every value out (`snapshot`): input
  values, a textarea's or editable box's text, checked, selected and
  aria-checked marks, scripts, styles, comments, the panel, a link's query
  (mailto:, tel: and data: links go whole), `on*` attributes, and each
  personal word; a choice WorkIt made that the page shows outside its
  option list (a dropdown's chosen value) is «shown». Structure, labels,
  options, ids, names and classes stay, so it loads in an engine test. The
  form's own element when the fields share one, else the body;
  `HTML_MAX` (500,000 characters), cut past it;
- the student's note, optional (`NOTE_MAX`).

**Personal values never leave the browser, by design.** Values come out
twice: on the page (`collect`, with the planned answers and what the page
showed, which only the page holds; text answers as whole words anywhere,
choices only where the page shows them as text) and in the background
(`previewReport`, with the profile's name, email, phone, links, address
and file names, which only the background holds), each through
`report-parts.js`'s `redactor`, which also replaces anything that looks
like an email, a phone number or a file name. The background keeps only
`FIELD_PARTS` and `TIMELINE_PARTS`, each of its type, and keeps the
preview in `chrome.storage.session` per tab and frame; the card shows that
preview whole (Exactly what WorkIt sends: the JSON, `finalize`d with the
student's marks and note as they type), and Send (`report/send {marked,
note}`) sends that stored preview through the same `finalize`, so a page
script can add nothing after the preview. The backend scrubs emails and
phones once more and refuses any other key (422). Tests:
`test/report-parts.spec.ts` (the redactor, reasons, shapes, finalize) and
`test/report.extension.spec.ts` (the fixture profile's values appear
nowhere in the card or the request, and the request equals the preview).

**Report this, at the moment it goes wrong.** `window.WIA.report.rowAction(field)`
gives each checklist row its button, which overlay.js puts under the
opened row only (and the fill's `_error` note), KAN-424, so a list of red
rows isn't a list of Report buttons:
**Report this** on a field that failed read-back (trigger `readback`) or
with an engine error (`error`), on a field the student edited after
WorkIt filled it (`edited`: a filled row that turns the student's, heard
through `status.subscribe`), and on the fill's own `_error` note; **Wrong?
Report it** on any other filled row, shown once the row is opened (`row`).
Each opens the card with that field ticked. NoAnswer rows get none: WorkIt
had nothing to fill.

**Nothing is sent but on Send**, one report per press: once sent, the card
says "Sent. Thanks for telling WorkIt." with Back and no second Send; a
new report means opening it again. Signed out, Send says "Sign in to WorkIt
to send a report." The toolbar popup's Report a problem sends the page's
parts, its context and the note only (`sendReport`). **The Web Store
listing's privacy practices must declare it** (the posting link, the form's
structure and the student's note leave the extension): for Lisul, before
release.

## The Autofill tab's checklist (KAN-397, KAN-369 Q1-Q3)

`src/content/groups.js` (`window.WIA.groups`, loaded before overlay.js)
draws the Autofill tab as one checklist of every field the fill touches,
in two sections, **Required** then **Optional** (`.section[data-section]`,
head `.section-head`). Notes (content-script.js's) stand above them.

- **Listed from the start (Q1).** progress.js's `begin` calls
  `overlay.live()`, which draws the list in the shell before the fill
  (only where the shell is up: the student pressed Autofill This Page; a
  batch tab off Workday has none until its fill is done, the hydration
  rule). The Plan registers every row before `fill/page`, so the whole list
  shows at once; `overlay.mount` then adds the header actions and the
  primary button to the list already drawn.
- **Marks** (`groups.markOf`, set as `data-mark` on each `.row`): `filling`
  (spinner, a pending row while `WIA.phase` is "filling"), `filled` (green
  check), `check` (amber question mark, lib-status.js `toCheck`),
  `needs-you` (red warning, lib-status.js `needsYou`, the one rule),
  `waiting` (blue clock, on the student's Claude), `empty` (gray circle:
  optional left empty), `not-asked` (a required question the form isn't
  asking now), `note`. **Each mark is the webapp's Phosphor glyph**
  (CheckCircle, Question and WarningCircle at fill weight for the states a
  field ends in; ClockCountdown, Circle and CircleNotch at regular), drawn
  as a CSS mask over its token colour with the webapp's 5-unit outline
  (`groups.js`'s `glyph`, paths copied from `@phosphor-icons/react`), so the
  panel's checklist reads as the website's icons do. Before KAN-424 they
  were ✓, ? and ! typed into coloured circles. A field the engine
  reports filled (its `fillengine:field` done event) turns green at once;
  the fill's answer then sets every row as WorkIt read it back.
- **Order (Q2).** The page's order: each row (a section by its first
  field) is placed where `window.WIA.fieldOf` finds its field, and rows
  whose field the page doesn't show yet come after, as registered
  (`groups.inPageOrder`; KAN-369, decision 1971). That is the list while
  the fill runs, in Required and Optional sections. **Once the fill is
  done** (content-script.js refreshes the list when the phase changes) it
  reads by what the student must do (KAN-424, `settledNodes`), each part in
  page order: a red box, "2 Need Your Answer" (`.box[data-box="needs-you"]`,
  counted by `needsYouCount()`, as the button), whose rows drop WorkIt's
  "has no answer for this" reason since the title says it; an amber box,
  "1 Guess to Check"; a blue one, "1 Waiting on Your Claude". **Each box's
  title folds it** (`button.box-toggle` inside `.box-head`, a chevron as
  the Filled line has): open by default, folded for the page's life once
  pressed, and a folded box keeps the row the student is on (`data-current`,
  `data-open`) in sight so Answer 1 of N never lands on a hidden row. Then
  folded lines (`.group[data-group]`, a press opens one for the page's life):
  "20 Filled", "2 Optional Left Empty" and "1 Not Asked Right Now" (the
  required questions the form isn't asking now). **A filled row the
  student is working with stays in sight** above the folded line: the one
  they pressed (`data-open`, `data-current`) or one holding a row card (a
  guess they said looks right keeps its Undo there). Before KAN-424 every
  filled row was listed in full and red and amber rose to the top of their
  section, which buried the two rows that mattered under twenty that
  didn't.
- **Repeated sections (Q3).** A field labelled "<Section> <n> / <part>"
  (Workday's panels, and Greenhouse's Employment block, which the engine
  labels the same way) or named "<part>--<n>" (Greenhouse's Education
  block, fill-engine greenhouse.ts `EDUCATION`) belongs to entry n of that
  section (`groups.entryOf`). A section is one row (`.entries[data-entries]`,
  its head Workday's "(entries)" question's row when there is one, marked
  with the worst of its fields) and under it a block per entry
  (`.entry`), titled by its company or school as the form shows it, else
  as the Plan fills it (the profile entry's; content-script.js hands each
  planned answer to `groups.planned`, which keeps only an entry's naming
  field), else "Work Experience 1" (`.entry-title`), listing the entry's
  fields with the same marks at 12 px (`.row.sub`). The section goes under Required when
  any of its fields is required.
- **Rows (Q4's row parts).** overlay.js's `row` keeps its cards, reasons and
  click to the field. A question shows two lines until its row is opened
  (`data-open`: the row the student last pressed, or Next Thing's), and its
  source badge (`.source`) shows only then.

Tests: `test/checklist.extension.spec.ts` (Anduril: every row listed and
spinning when the progress first says 0%, then red and amber first;
Coinbase with two made-up jobs: Work Experience and Education nested, titled
Globex, Initech and the school; `CHECKLIST_SHOTS=<dir>` saves screenshots),
`test/panel-tabs.extension.spec.ts` (the marks on Anduril, Looks right and
Undo turning the guess green and back, no tab strip), the waiting mark in
`test/waiting-card.extension.spec.ts`.

## Written answers in the list (KAN-424; the Answers tab, KAN-400, before it)

`src/content/card-written.js` (`window.WIA.writtenRow`, loaded after
letter-preview.js in `CONTENT_SCRIPT_FILES`) knows the fill's written
questions: content-script.js calls `writtenRow.use(prepared)` once a page
(or a Workday step) is filled. They are the ones written or waiting to be
written (`prepared.written`), the ones left for the student to write
(`rows.written`), the ones a saved answer filled in words (`plan.banked`,
text boxes), and any cover letter field (label or name "cover letter").

- **The Written Answers box** (groups.js `settledNodes`,
  `.box[data-box="written"]`, "2 Written Answers"): every one of them now
  filled, after the waiting box and before the folded lines. It is open
  and never folds into Filled, since a recruiter reads these answers and
  the student should before Submit; its title folds it like any box. An
  answer just in that the student hasn't seen (lib-status.js `toCheck`)
  stays here with its ? mark, so the amber box holds only guesses. A
  waiting one stays in the blue box, a flagged one in the red.
- **Each row** (overlay.js row, `writtenRow.parts`): the question, who
  wrote it (the source pill shows on these rows even closed: Claude, You,
  Pasted, Saved Answer), the answer's first three lines
  (`.written-preview`, the field's text as the engine read it back), and
  See answer (letter-preview.js) for all of it with Copy and Edit myself.
- **Rewrite** (a round ArrowsClockwise icon, `aria-label` "Rewrite") on an
  answer the student's Claude wrote, filled and unflagged, in a batch tab
  (written-answers.js `canRewrite`): it opens a card, "How should your
  Claude change it?", with **Shorter**, **More specific** and **More
  formal**, which send at once, and a box for their own words (Enter or
  **Rewrite** sends it; **Cancel** or Escape shuts it). It goes through
  `batch/redo` to `POST .../review/redo` with `steer` (backend review.py
  `redo`): the answer is cleared and handed to their Claude again with the
  request as its `rewrite` reason, the flag card's own path, so the row
  waits in the blue box until the new answer lands. Not offered on the
  student's own words, a pasted or saved answer, or the essay route's.
- **Undo rewrite**, under the row while it waits and after the new answer
  lands: the answer it had goes back into the field and is saved again
  through the paste route (`batch/paste`), so their Claude isn't handed the
  question; an error stays under the row.

Tests: `test/panel-answers.extension.spec.ts` (Lumen's practice question
written by the student's Claude, in Written Answers with its first lines;
Rewrite's steers, Shorter sent, the row waiting, Undo rewrite; the
student's own words as You with no Rewrite; a typed steer; Workable's
cover letter waiting). `fake-api.ts` records each `redo` and its steer in
`flagAnswers`.

## The panel's settings (KAN-402): Claude, auto-open, report, Workday

`src/content/panel-settings.js` fills the `settings` slot (loaded after
panel-top.js everywhere it is: manifest, `CONTENT_SCRIPT_FILES`,
background.js `SHELL_FILES`); `src/background/panel-settings.js` answers
its messages. The gear shows it in place of the tabs; Back returns.

- **Claude**: "Your Claude is connected." with **Disconnect** (`DELETE
  /applicants/{id}/connector`, which revokes the sign-in at once, as the
  webapp's Settings > Connected Apps does), or "Your Claude isn't
  connected." with **Add to Claude** (a new tab on the webapp's
  `/connect/claude/add`, which goes on to Claude's Add Custom Connector
  dialog). Signed out: "Sign in to WorkIt to connect your Claude." The
  state (`settings/read`, `GET .../connector`) is read again each time the
  gear opens the view and when the student comes back to the tab.
  A read that fails says "WorkIt couldn't check your Claude." with **Try
  again**, which reads it again (KAN-401).
- **Open the panel by itself** (on by default): `panel_auto_open` in
  chrome.storage.local, given to panel.js by `panel/where` (`autoOpen`).
  Off, a batch tab's panel stays closed with its edge tab, as a kept
  collapse does; the student opens it. Outside a batch nothing opens by
  itself anyway.
- **Report a problem**: opens the report card
  (`window.WIA.reportCard.open()`, report.js), as the header's ⚑ does.
- **Workday Sign-Up**: opens the extension's options page
  (`workday/signup-open`). No password field is ever in the panel: it
  lives in the employer's page.

Tests: `test/panel-settings.extension.spec.ts` (the Claude connection with
Disconnect and Add to Claude; auto-open off keeps a batch tab's panel
closed; the gear and Back, Report, Workday Sign-Up opening the options
page and no password field in the panel).

## The résumé's card (KAN-399; on the Resume/CV row since KAN-424)

`src/content/resume-card.js` (`window.WIA.resumeCard`, loaded after
panel-top.js wherever it is: manifest, `CONTENT_SCRIPT_FILES`,
background.js `SHELL_FILES`) draws the card of the opened Resume/CV row
(overlay.js asks `resumeCard.card(field)` before any other card, on the
opened row only), from `src/background/resume-tab.js` (`resume/tab`,
`resume/file`, `resume/choose`, `resume/upload`). The row is the file field
the attached résumé went into, or a file field labelled résumé or CV
(`isResume`, from the fill's Plan that content-script.js hands over with
`resumeCard.use(fixesOf(prepared))`). It used to be a tab of its own,
which read as a step every application needed.

- **Attached**: "Attached · Uploaded file" (or Built in WorkIt, Tailored
  for this job), the file's name, **Change** and **Preview** (the file,
  from the background, opens as a blob in a new tab).
- **None attached**: "No resume attached to this application yet." with
  **Upload Resume** (primary) and **Choose Resume** (when the student has
  any). A form whose résumé field is required puts this row in the red
  box, so Answer 1 of N lands on it.
- **Choose a Resume** (Change, Choose Resume): a dialog over the whole
  panel (absolute in `.panel`, backdrop of 30% ink; Close, Escape or a
  press outside shuts it, and a repaint keeps it open), listing the
  attached résumé first, marked Attached, then every upload, the base
  built résumés and the one tailored for this job, each row one button, as
  the Resumes page's table lists them; and **Upload a New Resume** under
  the list. A switch keeps the file
  for the tab (`resume_by_tab` in chrome.storage.session, dropped when the
  tab closes), saves it as the application's sent resume when the
  application is open (`PUT .../applications/{job}/resume`, the Auto Apply
  page's own choice), and fills the form's résumé field again alone
  through the Fill engine (the failed card's fill-one-field), and the row
  takes the result.
  Every later Plan in the tab attaches the switched file
  (background.js `withTabResume`), so a reload or Workday's next step keeps
  it, and `markSubmitted` records it as sent. Greenhouse replaces an
  attached file by pressing its Remove file first (engine, greenhouse.ts
  `upload`).
- **Upload Resume**: a file input (PDF or DOCX, as the API takes) in the
  panel's shadow root; the file goes to the background as base64, which
  posts it as multipart to `POST .../resumes` (api.js `uploadResume`; its
  FormData body drops the JSON content type), the Resumes page's own upload,
  so it lands on their Resumes and reads into their Experiences. Then the
  form switches to it as above (background `uploadAndChoose`). A file they
  uploaded before (the route's 409 names it, `ApiError.resumeId`) is used,
  not saved twice: "You uploaded this resume before, so WorkIt used that
  one." The sixth upload's limit and an unreadable file say the route's
  own words.

Tests: `test/panel-resume.extension.spec.ts` (the Resume/CV row's card:
the attached file, Preview, Choose a Resume; a pick saved and attached on
the form; Upload a New Resume, and a duplicate used). `fake-api.ts` has
`builtResumes` (render) and `uploads` (POST .../resumes).

## The overlay: honest per-field results

`lib-status.js` keeps one row per field and computes the headline only
from rows the form marks required, so an optional field left empty is
"skipped", never red, and no parent row can hide a failed one (the two
JobRight bugs the research caught). The overlay shows a failed row's
reason in red and a skipped row's in gray.

Each filled row carries its **Source** (KAN-375, `GLOSSARY.md`): the Fill
engine's Plan names each planned answer's (`plan.sources`: profile,
student, saved, guessed), the essay route's answers are "ai", the
student's own Claude's (the connector) "claude", and a value the student
types after the fill "student", and one pasted in a waiting row's card
"pasted". The overlay shows it as a badge (Profile,
Saved Answer, Claude, AI, You, Pasted, Guessed; the AI ones carry the sparkle) and
highlights a guessed row in the warning tint. Where an answer comes from
is the engine's to say: never work it out here.

**The Guessed card** (KAN-369, `src/content/card-guess.js`, loaded after
`overlay.js`): a guessed row's row card (`rowCard.add`) has **Looks
right**; the batch below is a part above the panel's list
(`overlay.addPart`: a part's `css` and `panel(summary)`). It makes the answer
the student's (its source becomes "student", the badge reads You, and
Next Thing That Needs You stops going to it) and, in a batch tab, saves
it as their own answer to the question (`batch/own-answer`, PUT
.../answers with `own: true`, the text the field shows; a multi-select's
picks joined with "; "). The backend's `answer_bank` offers it on later
forms by the question's wording, one about this company only on its
forms, and the engine's Plan fills it as the student's ("You"): their own
bank answer beats a rule's guess. A guess the student changes on the form
is theirs too (the edit read-back covers every guessed row, optional ones
included, `guessCard.watched`); its row offers **Save for next time**,
one click, and nothing is saved before. When two or more guessed rows are
consent boxes (agree, acknowledge, privacy notice, I understand), the
panel offers **Looks right ×N** for them at once; a question about
self-identification, the law (arbitration, certify, sign) or the right to
work is never in it, worded as consent or not. Outside a batch tab Looks
right confirms only: there is no application to save it to. WorkIt's own
policies leave consent boxes to the student, so the batch shows only for a
student whose policies (brought from Apply) tick them. Once saved, the
row reads "Saved for next time." with **Undo** for the rest of the page's
life (the card's state is in memory): Undo deletes the saved answer
(`batch/own-answer-undo`, DELETE .../answers?name=; the backend deletes
only the student's own, and a question the tab sent stays for their
Claude), every one a Looks right ×N press saved, and the row is what it
was: a guess with Looks right, or a change with Save for next time. A
failed delete says "WorkIt couldn't undo it. Try again." Tests:
`test/batch.extension.spec.ts` (the walk, the save, Undo of a change, the
next form), `test/greenhouse.spec.ts` (the batch skips self-ID and legal;
Undo after Looks right ×N).

Both of the extension's surfaces, the popup and the panel, follow
WorkIt's design system (`frontend/docs/design.md`). **The tokens are
defined once, in `src/shared/tokens.js`**: WorkIt's `--color-*`,
`--radius-*`, `--shadow-lift` and type-scale values, copied by hand from
`frontend/src/app/globals.css` (no build step can import its Tailwind
`@theme`), in px where globals.css has rem, since the overlay sits on an
employer's page whose root font size isn't WorkIt's. Change a value in
both; `test/tokens.spec.ts` fails when they differ, and when the popup or
the overlay writes a colour of its own (a hex, `rgb()` or `hsl()`). The
popup loads `tokens.js` as a plain script (it puts the tokens on its
`:root` before it paints); `content-scripts.js` injects it before
`overlay.js`, which puts `window.WIA.tokens` in its shadow root's
`:host`. The font is Plus Jakarta Sans, shipped in `fonts/` (OFL, its
licence beside it) under the family name "WorkIt Jakarta Sans" so it never
meets a page's own font of that name: the popup's `@font-face`, and for
the overlay a `FontFace` made from the bytes the background reads
(`overlay/font`), since `@font-face` does nothing in a shadow root and the
extension's files aren't web-accessible to the page. Until it loads, the
overlay uses the system font.

## Conventions

- **Plain scripts, shared globals, explicit load order** in `src/content/`:
  Chrome's static `content_scripts` declaration (and `chrome.scripting
  .executeScript`'s `files` array) don't support ES modules, so these files
  attach to `window.WIA` instead of using `import`/`export`. The load order
  that makes this work lives in exactly one place —
  `src/shared/content-scripts.js` (`ENGINE_FILES` in the MAIN world, then
  `CONTENT_SCRIPT_FILES`), which the panel and batch apply both use through
  `injectFill` — and a new content file is added there by hand.
- **`src/background/engine.js` uses no `chrome.*` API at import time**, so
  the test imports it as it is. Keep `chrome.*` calls in `background.js`.
- **`src/background/` and `src/popup/` do use ES modules** (`"type":
  "module"` in the manifest's `background` key; `popup.html`'s `<script
  type="module">`) — only the on-demand-injected content scripts can't.
- **The popup never talks to Supabase or the API directly.** Everything
  goes through `chrome.runtime.sendMessage` to the background service
  worker, because a service worker can be killed and restarted by Chrome
  at any time — it's the one place session state can actually live, not
  the popup (which is destroyed every time it closes).

## Open items

Flagged here rather than silently deferred — the user asked for a
prototype open to reorganization, and this is the honest list of what that
openness covers:

- **The loaded extension's round trip is not yet confirmed live
  (KAN-340).** The engine path (`engine.js`'s `planFill`, `fillOrder`,
  `fieldResult`, with the bundle from `ENGINE_FILES`) filled live
  Greenhouse forms (Arc Boat Company's, Pure Storage's, 2026-10-22) with a
  dummy profile and sent nothing; what no test reaches is the Chrome glue:
  `injectFill`'s MAIN-world load, `fill/plan` and `fill/field` through
  `executeScript`, the essay round trip (`essay/generate` → the live API →
  the filled field), and the resume's `.../bytes` fetch. Load it unpacked,
  sign in as a test student, run it on a Greenhouse posting with an essay
  question, and never press Submit. If a fill stops, the background
  service worker's console (`chrome://extensions` → this extension →
  "service worker") shows the error first.
- **No session at all if `@supabase/ssr` or `@supabase/supabase-js` get
  upgraded.** The cookie name, the `base64-` prefix, and the chunking
  threshold are that package's internal implementation, not a published
  contract — a version bump that changes any of them silently breaks
  `webapp-session.js` with no error, just `getSession()` returning null.
  Worth a quick recheck against `node_modules/@supabase/ssr/src/
  cookies.ts` and `utils/chunker.ts` after any `@supabase/ssr` or
  `@supabase/supabase-js` version bump in `frontend/package.json`.
- **No refresh story if the access token goes stale between WorkIt
  visits.** Right now that's "ask the user to reopen a WorkIt tab" (see
  Auth section's reasoning on refresh_token rotation). If that proves too
  rough in practice, the safer fix is having the *webapp* do the
  refreshing it already does (`src/proxy.ts`) and this extension only
  ever reading, never writing, the cookie — not independent refresh logic
  here.
- **Six job systems not yet checked live through the loaded extension
  (KAN-341).** Lever, Ashby, Rippling, Workable and Eightfold filled live
  forms through this fill path in a test browser, not the loaded
  extension; Workday was not filled live at all (it needs a signed-in
  student). Auto apply takes all seven since KAN-370 (`hosts.py`).
  Rippling has since filled two live forms end to end through a batch tab
  of the loaded extension (KAN-369, 2026-10-25), cover letter included.
- **One school, and no phone country.** The adapter gives the engine the
  latest education entry as the school; the earlier ones go only as
  `education.past_schools` (school, degree, end), which the high-school and
  "degrees completed" rules read, with `degree_level_now` (Undergraduate or
  Graduate) while the latest degree is unfinished. The bank's skills go as
  `experience_facts.skills`, a "Languages" group first. WorkIt holds no place
  the student lives, so Greenhouse's Country picker beside Phone is left for
  the student.
- **"Never served" is its own answer.** WorkIt's `veteran_status` adds
  `not_veteran` ("I am not a veteran"), which answers "Are you a veteran?",
  "have you ever served?" (No) and a branch or status (N/A).
  not_protected_veteran still answers only protected-status questions; never
  map it to false.
- **A profile saved before the name split** (KAN-326) has only
  `full_name`, so its first/last name is the first word and the rest:
  wrong for a multi-word given name or a middle name. Once My Profile
  saves the parts (`first_name`, `middle_name`, `last_name` on GET
  .../profile), the fill uses them, and a middle name goes only where a
  form asks for the full legal name.
- **No packaging/publishing path yet.** The `key` in `manifest.json` pins a
  stable *local* extension id (so the webapp bridge has something fixed to
  call) — it is not a Chrome Web Store signing key, and publishing for
  real would need its own key and listing.
- **The toolbar icons are rendered from the webapp's own icon**
  (KAN-424): `icons/icon-{16,32,48,128}.png` are
  `frontend/public/workit-icon.svg` (the favicon's source) drawn by
  `test/render-icons.mjs` (`node autofiller_extension/test/render-icons.mjs`,
  after `npm --prefix autofiller_extension/test ci`). Run it again whenever
  that SVG changes. The old `icons/icon.png`, a briefcase W from before the
  logo, is gone.

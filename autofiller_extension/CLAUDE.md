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
  Apply asks. Eightfold's and Workday's questions are read off the open form
  by the engine (`readQuestions`), and Ashby's form too when its query
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
  shows (Workday, Eightfold, practice forms); every later Plan of the tab
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
  them. Its own How Did You Hear About Us? is never read: the engine
  searches it for each source in turn (WorkIt, LinkedIn, then the rest) and
  takes the first found.
  `test/workday-steps.extension.spec.ts` walks a whole application (Apply's
  fake Workday steps, as new pages and drawn in place) from Create Account
  to Review, Fill to Review saving each step it can and the test answering
  and saving, as the student, each step where the walk stops.
- **A job's page is not always its form.** A Lever, Ashby, Rippling,
  Workable or Eightfold posting shows the job on one page and the form on
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
- **Only job systems the engine covers are filled.** `engine.js`'s `jobOf`
  names them (Greenhouse, Lever, Ashby, Rippling, Workable, Eightfold and
  Workday). On any other page the overlay says
  WorkIt can't fill this job system yet and nothing is touched: there is
  no generic filler any more (the old label-matching one filled most forms
  wrong, and was deleted with its Greenhouse adapter in KAN-340).
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
form, and other pages get nothing drawn. A page on any other host is
never touched: the panel has no way in there (an embedded Greenhouse form
on a company's own site is filled only by batch apply, decision 956).

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
and each tab's state (`jobs`), and `run/show` switches to one (`jobId`).

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
  carries no body: a page on an allowed origin that could hand the worker
  a URL could make it open any site. `run/show`'s `jobId` only picks among
  the batch's own tabs.
- **Never a job board** (KAN-376; GLOSSARY.md, "Job board"). A tab opens
  `job.form_url`, the employer's form the API names (a LinkedIn or Indeed
  posting is queued only through the form its text names, and refused
  otherwise), else `job.apply_url`. A link on a job board's host
  (`src/background/job-boards.js`, the same hosts as `hosts.py`
  `JOB_BOARDS`) is never opened, whatever the API answers: the batch
  passes over it and leaves its stage alone.
- **The API keeps the queue, its order and each application's stage.**
  The next tab's job is `GET .../applications/next?skip=...`, skipping every
  job this batch opened; a tab's state is `PUT .../applications/{job}/fill`
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
  (`src/options/`, opened from the popup's Workday Sign-Up button) lets the
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
  A wrong-company flag (`flag_hard`) is drawn in the danger colour; like
  every flag it keeps the tab out of Ready and in the walk until resolved.
  A hidden tab's timers slow to about once a minute after five minutes, so
  an answer can take that long to land. Tests:
  `test/connector.extension.spec.ts` (Ashby's Harvey form: no saved
  Greenhouse form has an essay the Plan sends to Claude).
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
  Test: `test/paste.extension.spec.ts`, Lumen's practice form queued as a
  real application (its one written question is all that needs the
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
- **A row waiting for the student's Claude carries the waiting card**
  (KAN-369, `src/content/card-waiting.js`, `window.WIA.waitingCard`, a row
  card; the overlay asks it for each such row's card). It shows how
  long the row has waited on this page ("Waiting 4 min"), Write with
  Claude, a paste box and Write it myself (the walk's `show`: scrolls to
  and focuses the field; what the student types there is theirs, as
  before). Save answer sends `batch/paste` → `PUT .../applications/{job}/written-answers`,
  the Written Answers page's route, so a pasted answer passes the same
  checks as Claude's (saved by="student", not own); a 422's reasons for
  that question (`ApiError.reasons`) show in the card under the box, and
  the draft stays. A saved one fills at once (source "pasted"); the next
  poll finds the row filled and leaves it. Cards are kept by key across
  renders, and render puts the focus back, so a draft survives other
  rows changing. The panel's summary counts these rows apart ("N waiting
  on Claude"). Tests: `test/waiting-card.extension.spec.ts`.
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
- **One rule for "needs you"** (KAN-369 Q7, `lib-status.js`'s
  `status.needsYou`, with `toCheck` and `waitingOnClaude`): the Autofill
  tab's Needs you rows, the required line's "N need you", the list's
  summary line, Next Thing's "N things need you", a batch tab's state
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
  the brand colour for 3 seconds, and a small orange dot
  (`--color-warning-strong`) that stays on it while its row still needs the
  student (failed, waiting, flagged), gone once resolved. Both sit in their
  own shadow host (`#workit-marks-host`), whose root is closed as the
  panel's is, follow the field each frame while shown, and never take a click. A guess, shown once, gets the ring only.
- **A panel row takes the student to its field** (KAN-369, `overlay.js`'s
  `jump`): pressing a field's row (any row but a note; Enter on its label
  too) runs the walk's own `show(key)` (`batch-tab.js`, as
  `window.WIA.showField`, made for every fill, batch or popup): the field
  scrolls to the middle, takes focus and gets the ring (and the dot while
  it needs the student), and the row is marked current. A press on a
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
  row card `row-card.js`): "We put X; the page shows Y.", why in plain words
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
  `backend/app/auto_apply/hosts.py` (all seven job systems the engine
  fills, KAN-370). A host added there
  is added to `manifest.json` in the same change, or its fills answer
  `not_allowed`. After pulling a manifest change, reload the unpacked
  extension in `chrome://extensions`. The background also fetches their
  job APIs, and injects Workday's fill again on its next page. An Eightfold board on a
  company's own domain (Netflix's `explore.jobs.netflix.net`, the
  engine's `EIGHTFOLD_COMPANIES`) is listed by its host: without it, the
  job's names and text failed to fetch. `test/manifest.spec.ts` checks one
  link of each.
- **A careers page that embeds Greenhouse is filled in its iframe**
  (KAN-369). A `?gh_jid=` link on a company's own site (hosts.py takes
  them, outside its `SKIP_EMBEDDING`) opens as it is, and the fill runs in
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
  extension doesn't keep. The step tells the student to choose "Always
  allow" for each of WorkIt's tools, so a run doesn't stop at every save.
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

**Two host families until the KAN-296 cutover.** Production runs on
Cloudflare (`workitjobs.ai`, `api.workitjobs.ai`) and on Vercel
(`workit-web-gamma.vercel.app`, `workit-api.vercel.app`) at the same time.
Both share one Supabase project and database. `config.js`'s `PROD_SITES`
pairs each webapp origin with its API, Cloudflare first.
`webapp-session.js` reads the cookie from localhost, then each pair in
order, and tags the session with the origin it came from. `api.js` then
calls the API paired with that origin, so a student who signed in on
Vercel stays on Vercel. A localhost session with no local API uses the
first pair. The popup's sign-in link opens the first pair's webapp. A
host in `PROD_SITES` must also be in `manifest.json`'s `host_permissions`
(and, for a webapp origin, `externally_connectable.matches`); without it,
the cookie read and the site's Auto Apply message fail silently. Drop the
Vercel pair and its manifest entries at the cutover. **A new
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
.../connector`). Report a problem (KAN-403) sends `POST /fill-reports`
(`routers/fill_reports.py`): no applicant in the path and no account in
the row, the report's parts only. The rest are older:

`src/background/api.js` mostly calls endpoints that already exist for the
webapp: `GET /auth/me`, `GET /applicants/{id}/profile`, `GET
/applicants/{id}/bank`, `GET /applicants/{id}/preferences`, `GET
/applicants/{id}/autofill-answers`, `GET /applicants/{id}/resumes`, `GET
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
started before the edit. Past its 10 min TTL a profile under a day old,
and of the account signed in, is used at once while a fresh one is fetched
behind (a cold API answered in 4-9 s live); an older one is waited for. The
fetch starts before anything waits for it (`warmProfile`): as a batch starts,
as the webapp pings (its pages opening, Auto Apply's among them) and as a
job page's panel asks `panel/where`. Its parts (profile, bank, preferences, autofill answers, the
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
(`window.WIA.panel`): 380 px wide, fixed to the right edge, full height
with its own scroll, over the page (the page is never resized), in a
shadow root on `#workit-autofiller-overlay-host`, so the employer's styles
can't reach it. **The root is closed**: the page's scripts get null from
`host.shadowRoot` and see none of its text or buttons; the extension's own
files reach it through `window.WIA.panel.root` in their isolated world.
**Every panel action that changes something answers only the student's own
click** (`event.isTrusted`, through `ui.js`'s `trusted`, which `button()`
and row-card buttons use): Disconnect Claude, Send report, Use this, Tailor,
Fill Again, Next job / Next tab, Looks right, Keep, Rewrite, Save answer,
Stop and Skip, Skip this job, I submitted this, I didn't submit this,
the essay banner's Generate, the self-ID Save. The marks' root (`marks.js`, the ring and dot) is closed too. Tests: the test copies of the extension
(`loaded-extension.ts` `openPanel`, over `CLOSED_ROOT_FILES`: panel.js and marks.js) open both roots, since Playwright's
locators can't reach a closed one; `loadExtension(..., { closedPanel: true })`
keeps them closed (`test/panel-closed.extension.spec.ts`). There is no bottom-right card any more, and the toolbar
popup has no fill controls. The header is neutral (white, ink); purple is
kept for the primary action.

**Slots.** panel.js draws only the frame; every other file plugs into a
slot by name, `panel.slot(name)`, and adds its styles with
`panel.addCss(css)` (tokens only):

| Slot | What goes there | Today |
|---|---|---|
| `header-actions` | buttons beside ⋯ and Close (kept empty: actions go in the ⋯ menu) | none |
| `batch-line` | the batch line ("Batch · 3 of 5 ready · Next tab →", Workday's step) | panel-top.js |
| `job-card` | the job card (title, company, Match score) | panel-top.js |
| `primary` | the one big button, fixed at the panel's bottom; `panel.setPrimary({ label, onPress, secondary })` or `panel.fillButton(label)` | Autofill This Page / Fill this step (launcher.js), then primary.js: "Next: N need you", Review and submit, Go to Save and Continue, Fill Again's question |
| `tab:<id>` | a tab's body; `panel.addTab({ id, label })` adds one, the strip shows from two | `tab:autofill`: overlay.js's summary, essay banner, moment cards, parts and rows; `tab:resume`: resume-tab.js (KAN-399); `tab:answers`: answers-tab.js (KAN-400), a placeholder until a fill |
| `settings` | the settings view, shown by the ⋯ menu's Settings in place of the tab's body (`panel.showSettings`; `panel.onView(hook)` hears it open) | panel-settings.js: Claude connection, Open the panel by itself, Report a problem, Workday Sign-Up, Back |
| `report` | Report a problem, shown in place of the tab's body; open it with `window.WIA.reportCard.open()` | report.js: the preview, the note, Send report, Back |

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

**Tabs (KAN-397).** The shell makes three: Autofill, Résumé and Answers.
Résumé and Answers hold a one-line placeholder (`.tab-placeholder`) until
their tickets fill them: `panel.slot("tab:resume").replaceChildren(...)`
(`addTab` with an existing id returns its body). The tab the student
presses is kept in the page's `sessionStorage` (`workit-panel-tab`), so
it lasts while the browser tab is open, across page loads and Workday
steps; `addTab` shows it again once that tab exists. A page that refuses
storage keeps the choice until it goes. `selectTab` from code doesn't
keep it.

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
its popup back and opened. Off job pages the popup shows who is signed in,
the batch's status ("2 jobs in your batch · 1 ready · 1 needs you",
`popup/batch`), Open WorkIt and Workday Sign-Up. A failed profile read shows "WorkIt
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
- **"Next: 3 need you"** (Next Thing) while anything is red
  (`status.needsYouCount()`, lib-status.js's one rule). It runs the walk
  (`batch-tab.js`'s `flagged().keys`: red rows first, then unchecked
  guesses and Claude's just-arrived answers). In a batch tab it is the cross-tab
  walk (`batch/next`); outside a batch, this page's rows in page order after
  the last it went to, then "Nothing else needs you." (`answerTheWalk` now
  runs in every fill; only a batch tab adds the `batch/flags` listener).
  What it answers shows under the button (`[data-said]`).
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
  `panel/next` to the tab; the frame with the button runs Next Thing,
  whatever the button reads (so a batch tab with nothing left still walks
  on to the next tab). Tests press it with `globalThis.workitCommand`
  (`pressNextThing` in test/loaded-extension.ts).
- The panel's one count line is the Autofill tab's `.summary` (overlay.js):
  "Required 12 of 14 filled · 3 need you · 1 waiting on Claude", the same
  `needsYouCount()` as the button and the checklist's red rows.
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

Tests: `test/panel-primary.extension.spec.ts` ("Next: N need you" and the
count line against the form's own asterisks; Alt+N; Review and submit
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
  system the Fill engine fills, so the panel never shows this; the toolbar
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
  optional note, `NOTE_MAX` long; then Send report, `popup/report`). Nothing leaves on opening the popup. Its
  test opens popup.html with `?tab=<id>` and loads a copy of the extension
  granted the fake host (`loadExtension`'s `grantHosts`), standing in for
  activeTab, which no test can press.
- **Between Workday steps**: the panel is never empty. When a step shows
  (in the same page, or as a new page), the fill's loop resets the rows and
  at once draws the step's line, "Workday: My Experience · Filling this
  step…" (content-script.js), with the button at Filling…; the step's rows
  follow as it fills.
- **Errors**: every failed request the panel or popup makes is a plain
  sentence with Try again (or the same button, which retries), never a
  status code or the route's raw words.

Tests: `test/panel-states.extension.spec.ts`.

## The panel's top (KAN-395): header, batch line, job card

The header (panel.js) is WorkIt's mark (logo.tsx's figure, in ink: the
header is neutral), ⋯ (the menu, above: Report a problem, Settings, a
batch tab's I submitted this and Skip, Fill Again) and Close. `src/content/panel-top.js` fills two slots, loaded
after panel.js everywhere panel.js is (manifest, `CONTENT_SCRIPT_FILES`,
background.js `SHELL_FILES`):

- **Batch line** (`batch-line`): in a batch tab, "Batch · R of N ready ·
  Next tab →", N the batch's open tabs and R those in state ready
  (background `panel/batch-line`, panel-top.js in background/). Next tab
  shows only while another tab needs the student (needs_you or failed); it
  goes to the next one after this tab, round from the first
  (`panel/next-tab`). The line follows the batch: the content script
  re-asks whenever `workit_batch` changes in chrome.storage.local. On
  Workday a second line, "Step 3 of 6 · My Experience", is read off
  Workday's step bar (`progressBarActiveStep`) and kept up as the steps
  load, in batch tabs and out.
- **Job card** (`job-card`, `panel/job`): WorkIt's own posting when the
  student has an application for it (a batch tab's by its job id, any other
  tab's by the Fill engine's jobOf identity of the page against the
  posting's form_url / apply_url), from `GET .../applications?scored=true`
  (read once per 30 s for all tabs): logo (the company's first letter when
  there is none or the page won't load it), title, company, place
  (`location_label`), pay ("$45–$55 an hour"), the Match score as a ring
  (purple, one of the two purple things) with its band (Strong Match at 80,
  as frontend/src/lib/match.ts), and "You applied on Oct 25" at the applied
  stage. No application, or signed out: the engine's `jobNames` read gives
  title and company only. No score: no ring.

Tests: `test/panel-header.extension.spec.ts` (a batch's line, card, ring and
Next tab; an own tab's header, Report placeholder and applied card; a
Workday tab's step line).

## Report a problem (KAN-403): a preview, then Send

`src/content/report.js` (loaded after panel-top.js everywhere it is)
fills the `report` slot. **`window.WIA.reportCard.open()`** opens it: the
header's ⚑ calls it (a second press closes it), and the settings view and
the unsupported-site state call the same function. The card lists exactly
what Send sends, and Send sends just that:

- the job system (the Fill engine's `jobOf` site, "unsupported" when it
  fills none there), the posting's link (the page's address with only the
  query parts that name a posting, `report.js` `POSTING_PARAMS`: for, token,
  gh_jid, jobId, job_id, jobid, jobReqId, career_job_req_id, each a plain
  id; no other part, fragment or user:password, which can carry the
  student's ids; the backend refuses any other part), the Fill engine version
  (`FillEngine.version`, which the engine's build stamps into
  `dist/engine.js`; `ENGINE_VERSION` in `background/engine.js`);
- each failed field: its kind (the Question set's), its label's shape
  (`labelShape`: lower case, quoted names, emails and links out, digits as
  `#`, only letters and spaces kept) and its error's name: Readback (it
  shows something other than its answer), FillError (the engine couldn't
  fill it), Handoff, NoForm, NoAnswer (WorkIt had none), Error;
- the student's note, optional.

**Never an answer, a reason or what the page shows**: a failed reason can
quote both. The content script tells report.js each question's kind
(`window.WIA.report.track`) and each failed field's error name
(`window.WIA.report.failed`); `engine.js`'s `fillPage` puts the error's
name on a whole-fill failure. The background (`report/preview`,
`report/send`) names the page's parts itself from the tab's URL and keeps
only the allowed parts of each field, so a page's script can add nothing.
`POST /fill-reports` (backend `routers/fill_reports.py`) stores it with no
account and refuses any other key (422).

**Nothing is sent but on Send**, one report per press: once sent, the card
says "Sent. Thanks for telling WorkIt." with Back and no second Send; a
new report means opening it again. Signed out, Send says "Sign in to WorkIt
to send a report." **The Web Store listing's privacy practices must declare
it** (the posting link and the student's note leave the extension): for
Lisul, before release.

Tests: `test/report.extension.spec.ts` (a batch tab's failed field: the
preview, nothing sent until Send, the request the fake API receives equals
the preview and holds no answer or page text, no second Send). Backend:
`tests/test_fill_reports.py`.

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
  check), `check` (amber ?, lib-status.js `toCheck`), `needs-you` (red !,
  lib-status.js `needsYou`, the one rule), `waiting` (blue, on the
  student's Claude), `empty` (gray: optional left empty), `not-asked` (a
  required question the form isn't asking now), `note`. A field the engine
  reports filled (its `fillengine:field` done event) turns green at once;
  the fill's answer then sets every row as WorkIt read it back.
- **Order (Q2).** While the fill runs, the Plan's order; once it is done
  (content-script.js refreshes the list when the phase changes), red and
  then amber rows rise to the top of their section, the rest in the Plan's
  order. Required questions the form isn't asking now close the Required
  section, collapsed to "N the form isn't asking now"
  (`.group[data-group="not-asked"]`).
- **Repeated sections (Q3).** A field labelled "<Section> <n> / <part>"
  (Workday's panels, and Greenhouse's Employment block, which the engine
  labels the same way) or named "<part>--<n>" (Greenhouse's Education
  block, fill-engine greenhouse.ts `EDUCATION`) belongs to entry n of that
  section (`groups.entryOf`). A section is one row (`.entries[data-entries]`,
  its head Workday's "(entries)" question's row when there is one, marked
  with the worst of its fields) and under it a block per entry
  (`.entry`), titled by its company or school as the form shows it
  (`.entry-title`, "Work Experience 1" until filled), listing the entry's
  fields with small dots (`.row.sub`). The section goes under Required when
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
Undo turning the guess green and back, the three tabs), the waiting mark in
`test/waiting-card.extension.spec.ts`.

## The Answers tab (KAN-400)

`src/content/answers-tab.js` (`window.WIA.answersTab`, loaded after
letter-preview.js in `CONTENT_SCRIPT_FILES`) fills `tab:answers` once a
page (or a Workday step) is filled: content-script.js calls
`answersTab.use(prepared)`, and the tab follows lib-status.js's rows from
then on (it subscribes; it keeps no rows of its own). Its questions: the
ones written or waiting to be written (`prepared.written`), the ones left
for the student to write (`rows.written`), the ones a saved answer filled
in words (`plan.banked`, text boxes), and any cover letter field (label or
name "cover letter"). Each row shows its label (a press goes to the field,
`WIA.showField`) and where its answer came from, from the row's status and
`source`: **Waiting for your Claude**, **Written by your Claude**,
**Pasted**, **Yours**, Written with AI (the essay route), Saved Answer,
Guessed, Not written yet, Needs you, Left empty. **See answer** is
letter-preview.js's toggle and preview (`render(field, { any: true })`:
any filled row, the student's own answers too), the same open state as the
Autofill tab's, so both redraw. **Write with Claude** (overlay.js's
`startClaude`) heads the tab only while a row waits for the student's
Claude. A form with no cover letter field ends with a "Cover letter · No
cover letter field" row ("on this step" on Workday, which fills a step at
a time). Before a fill the shell's placeholder stays.

Tests: `test/panel-answers.extension.spec.ts` (Lumen's practice question
waiting, then written by the student's Claude, with Write with Claude only
while it waits and See answer the form's text; Yours; Pasted; Workable's
cover letter box listed, no "No cover letter field").
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

## The Résumé tab (KAN-399)

`src/content/resume-tab.js` (loaded after panel-top.js wherever it is)
fills `tab:resume` from `src/background/resume-tab.js` (`resume/tab`,
`resume/file`, `resume/choose`, `resume/keywords`, `resume/tailor`):

- **Attached**: the file this form gets, by its file name and kind
  (Uploaded file, Built in WorkIt, Tailored for this job), with
  **Preview** (the file, from the background, opens as a blob in a new tab).
- **Keyword match** (GLOSSARY): a built résumé's "3 of 5 keywords" with the
  matched ("On your résumé") and missing ones, exactly as `GET
  .../built-resumes/{id}/keyword-match?job_posting_id=` gives them. A
  posting read for the first time spends one of the day's Tailor uses, so
  nothing is spent silently: the match shows by itself only for a job whose
  keywords WorkIt read before (`keywords_read_jobs` in chrome.storage.local,
  background `keywordsFor`); for any other the tab shows **Check keyword
  match (uses 1 Tailor run today)**, and only that press reads it. (The
  backend has no read that never extracts, so a posting the webapp already
  read still shows the button once.) An uploaded file has none
  ("Keyword match is for résumés built in WorkIt").
- **Tailor for this job** opens the website's `/jobs/{job}/tailor` on the
  origin the student signed in on. Only for a job WorkIt has an
  application for (`applicationForTab`, panel-top.js's lookup).
- **Switch résumé**: every upload, the base built résumés and the one
  tailored for this job, each with **Use this**. A switch keeps the file
  for the tab (`resume_by_tab` in chrome.storage.session, dropped when the
  tab closes), saves it as the application's sent resume when the
  application is open (`PUT .../applications/{job}/resume`, the Auto Apply
  page's own choice), and fills the form's résumé field again alone
  through the Fill engine (content-script.js hands each fill's Plan over,
  `resumeTab.use(fixesOf(prepared))`, the failed card's fill-one-field).
  Every later Plan in the tab attaches the switched file
  (background.js `withTabResume`), so a reload or Workday's next step keeps
  it, and `markSubmitted` records it as sent. Greenhouse replaces an
  attached file by pressing its Remove file first (engine, greenhouse.ts
  `upload`).

Tests: `test/panel-resume.extension.spec.ts` (the attached file, Preview,
the others and Tailor; a switch saved, attached on the form, and its
Keyword match). `fake-api.ts` has `builtResumes` (render, keyword-match).

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
- **No "not a veteran" answer.** WorkIt's `veteran_status` is
  protected_veteran, not_protected_veteran or declined. Since the engine's
  fix (KAN-329), "I am not a protected veteran" answers only
  protected-status questions; a plain "Are you a veteran?" or military
  service question is the student's (a Missing fact). Answering it needs a
  new value such as `not_veteran`, mapped to "I am not a veteran"; never
  map not_protected_veteran to false.
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
- **Icon is a placeholder.** `icons/icon.png` is `frontend/public/
  workit-icon.png` copied in at one size, referenced for all three manifest
  sizes (16/48/128) rather than three properly-generated files.

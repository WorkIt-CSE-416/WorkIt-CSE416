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
**A checkout needs `git submodule update --init` once**, or Chrome can't
load `fill-engine/dist/engine.js` and every fill fails. The extension never
builds it: `dist/engine.js` is committed in the engine repo.

- **Two worlds.** The bundle runs in the page's own JavaScript world
  (`world: "MAIN"`): it waits for React's state on the form's nodes, and on
  Ashby wraps the page's `fetch`, neither of which an extension's isolated
  world can see. The overlay and `content-script.js` run in the isolated
  world, where `chrome.runtime` is. `src/shared/content-scripts.js`'s
  `injectFill` loads both, engine first, for the popup and batch apply
  alike. The isolated world's files are classic scripts, not modules: each
  sets its part of `window.WIA` and `content-script.js`, loaded last, runs
  the fill with them, so `CONTENT_SCRIPT_FILES`' order matters. Beside the
  status rows (`lib-status.js`) and the panel (`overlay.js`),
  `workday.js` reads Workday's pages (the step shown, a settled step, the
  sign-in it fills) as `window.WIA.workday`, and `written-answers.js` the
  questions that need writing (their rows, Generate or the student's
  Claude, the student's edits of them) as `window.WIA.writtenAnswers`,
  and `batch-tab.js` a batch tab's side (`batch/state`, the walk's
  `batch/flags` and `batch/focus`, the submit watch) as `window.WIA.batchTab`.
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
  application; the content script fills each step as it shows (sections
  first, then each field, then reads the step again for follow-ups), then
  waits. The student checks the step and presses Save and Continue; the
  next step is filled when Workday shows it. The extension never presses
  Save and Continue or Submit. A step that loads as a new page drops the
  content script, so the background remembers the tab
  (`workday_fill_tabs`, session storage) and injects the fill again when
  it loads. Workday's nested prompts (its own How Did You Hear About Us?)
  are slow to read, so each tenant's are kept in `chrome.storage.local`
  (`workday_trees`), as Apply keeps them.
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
  parse the location here. Anything else (pay, relocation, a home address, consent boxes,
  start dates) stays the student's: the Plan lists it as a Missing fact and
  the overlay says "WorkIt has no answer for this". `POLICIES` holds no
  student's choice; "How did you hear?" is WorkIt, or the form's "Job
  Board". `us_roles_only` is on, since WorkIt lists US roles only: a
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
  and install check (`ping`, KAN-378) — nothing more. The job cards'
  "Autofill ready" badge, `ping`'s first caller, was removed (KAN-278).
  The extension's core function
  never depends on this bridge: it works from its own popup on whatever
  page the user is on, bridge or no bridge.

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

No `content_scripts` entry in `manifest.json`, and no background logic runs
on page load. Autofilling is something the user starts by clicking
"Autofill This Page" in the popup, which injects the content script files
into the current tab on demand (`chrome.scripting.executeScript` +
`activeTab`) rather than running on every page the user happens to visit.
Same reasoning as the build plan doc's core recommendation: **this
prototype never auto-submits, ever** — the user always clicks the real
Submit button themselves, on the ATS's own page, after reviewing what got
filled. `activeTab` also means no broad host-permission prompt for
arbitrary websites at install time.

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
filling at once**, and opens the next one as soon as one finishes. A
finished tab goes into the **"Ready"** tab group (green: every field it
needs shows an answer) or **"Needs you"** (orange: anything unfilled, a
note the Plan left the student, a Workday step, or a job system with no
Filler), and moves between them when that changes. A tab whose fill itself
went wrong (the Plan failed, Workday's error page, a covered job system's
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
  as "Verify you are human", `humanCheckShows`), goes to Needs you and
  keeps waiting up to 5 minutes for the form (`formAfterHumanCheck`, also
  across the new page a passed check loads); the fill runs once it shows.
  Meanwhile its panel (`human-check.js`, `injectHumanCheck`) says "Prove
  you're human on this page" (a "todo" note), with Skip and Next Thing,
  which stops there; the fill takes it down first (`clearHumanCheck`).
  The walk's listener, added once per page, answers from the latest
  fill's rows (`window.WIA.walk`), as a passed check may draw the form in
  the same page. The extension never solves a check. A form that never shows has failed,
  as any other. Tests: `test/batch.extension.spec.ts` ("a human check
  before the form", "a human check's tab says").

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
- **Skip is on the batch tab's panel (KAN-373).** The panel's header has a
  Skip button in a batch tab only (`overlay.mount({ onSkip })`); it sends
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
  filling each through the engine; its group follows. The background takes
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
  (KAN-369, `src/content/card-waiting.js`, `window.WIA.waitingCard`; the
  overlay asks it for each such row's card and adds its CSS). It shows how
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
- **A written question's limit comes from the Fill engine** (KAN-380).
  `planFill` passes the Question set through the engine's `limits`, which
  reads each text field's own `maxlength` on the page, and `planRows`
  gives each `written` row its `max_length` (null when the field sets
  none). Both `batch/questions` and the essay route take it from the row;
  never read a box's `maxLength` in the content script (a field's element
  is named differently on each hiring system: the engine knows how). The
  API refuses a saved answer over it.
  Tests: `test/greenhouse.spec.ts`.
- **"Next Thing That Needs You" walks the batch** (KAN-375). Each batch
  tab's panel has the button. `next-needs-you.js`'s `nextNeedsYou` asks every batch
  tab, in the order the tabs opened, which of its rows need the student
  (`batch/flags`: the rows that send a tab to Needs you, in page order:
  a note that asks something, a failed field, a required one still
  waiting for its answer, a review flag; never a filled one or a required
  one the form doesn't show or no longer calls for, "skipped"; and
  each "Guessed" answer once, for the student to check, which doesn't
  keep the tab from Ready;
  notes last; a note is a row marked `note`, "todo" or "done" for news
  like "Application sent", never a key starting "_": Ashby keys its own
  fields `_systemfield_...`), goes to the first one after the last it went to (cursor in
  `chrome.storage.session`, `workit_batch_next`: the tab's place in the
  batch and the row's place among all the tab's rows, `batch/flags`'s
  `order`, so it goes on after a row the student just answered; rows
  waiting for the student's Claude, `batch/flags`'s `late`, come after
  everything else in the batch, and the cursor's `late` says which part
  it is in), switches to its tab and
  has the content script scroll to and focus the field and mark its row
  (`batch/focus`). Past the last one the panel says "Nothing else needs
  you." and the next press starts again. A field is found by the job
  system's own field id (`batch-tab.js`'s `fieldOf`); a tab nothing
  was filled in is one stop, the page itself. This is the only time the
  extension switches tabs on its own, and only on the student's press.
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
  student who reloads a tab by hand fills it from the popup.
- **A Workable form fills from empty, in a batch or not.** Workable
  restores an unsent draft from local storage (`evergreen-*`) as its form
  opens, and the engine won't add to entries a section already lists. A
  batch tab forgets the draft and reloads as it opens (`batch.js`'s
  `startFill`); the student's own Autofill does so only when its first Plan
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
  success, no block message) and watches for a success or failure notice
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
.../connector`). The rest are older:

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
arrives through `GET .../answer-bank` with the rest. `test/apply-profile.spec.ts`.

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

Both of the extension's surfaces, the popup and the overlay, follow
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
  `CONTENT_SCRIPT_FILES`), which the popup and batch apply both use through
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

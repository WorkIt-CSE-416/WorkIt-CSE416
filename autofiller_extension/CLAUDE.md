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
what the student has done. `src/background/engine.js` maps the school and
the jobs it gives the Fill engine from the bank's `entries` by `section`,
not from a `ParsedResume`.

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
  `injectFill` loads both, engine first, for the popup and the runner
  alike. The content script reaches the engine through the background,
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
  Plan accepts) is failed with what the page shows, so the student checks
  it.
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
  form's link and fills nothing; the runner opens the form itself
  (`formUrl`).
- **The profile adapter gives only what WorkIt holds.** Name, email,
  phone, links, the default resume, the latest school and the jobs from the
  bank, and the nine autofill answers, in the words the engine's rules
  read. Anything else (pay, relocation, a phone country, consent boxes,
  start dates) stays the student's: the Plan lists it as a Missing fact and
  the overlay says "WorkIt has no answer for this". `POLICIES` holds no
  student's choice; "How did you hear?" is WorkIt, or the form's "Job
  Board". The engine's own rules decide everything else; change a rule in
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
  the runner to open (and fill) the next queued application, which job its
  tab shows, and to switch to that tab — nothing more. The job cards' "Autofill ready"
  badge, the bridge's one use of `ping`, was removed (KAN-278); the
  background script still answers `ping`, with no webapp caller. The extension's core function
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

**The one other trigger is the student's own Auto Apply click** (KAN-305):
the runner fills the application tab it opened for that click (below). It
is still a click, never a page load, and it still never submits. It is why
`host_permissions` lists `https://*.greenhouse.io/*`: `activeTab` never
covers a tab the runner opened.

## The auto-apply runner (KAN-223, KAN-305): opens and fills the next queued application

`src/background/runner.js` is the runner's first step
(`auto-apply/architecture.md`, "The run" and "The first fill"). The Auto
Apply page's Start, and a job card's Auto Apply once it queues the job,
send `run/open` over `externally_connectable`; the runner reads the oldest
queued application from `GET .../applications/next`, opens its
`job.apply_url`, and starts the fill there. Submitted/Skip and `POST
.../finish` are the next steps; until then the application stays
`queued`. Two more messages serve the webapp's "Working in
Browser": `run/status` answers which job posting the run's tab shows
(null once the student closes it), and `run/show` switches to that tab.

- **The URL always comes from the API, never the message.** `run/open`
  carries no body: a page on an allowed origin that could hand the worker
  a URL could make it open any site.
- **One background tab for the run, beside the WorkIt tab that asked.**
  `chrome.tabs.create({ active: false })` in the sender's window the first
  time, then `chrome.tabs.update` on the same tab; its id lives in
  `chrome.storage.session`, since Chrome stops the worker after ~30
  seconds idle and clears its variables. A closed tab is created again.
  **Never a new window**: a window opened with `focused: false` from a
  full-screen window on macOS got its own Space, and macOS switched the
  student to it; no Chrome API stops that. The tab is hidden until the
  student opens it, so Chrome slows its timers and stops its redraws,
  which some dropdowns wait on: the fill step must work in a hidden tab
  (`auto-apply/architecture.md`, "Hidden tabs run slowly").
- **The run's tab is never discarded.** It is set
  `autoDiscardable: false`, so Memory Saver can't throw away a
  half-filled form in a tab the student has not looked at yet.
- **Opening needs no permission; filling needs the host.**
  `chrome.tabs.create`, `chrome.tabs.update` (`autoDiscardable` too),
  `chrome.windows.update` and a tab's load `status` need none (only url,
  title and favicon need `tabs`). Injecting the fill does: `activeTab`
  doesn't cover a tab the runner opened, so `host_permissions` lists each
  hiring system auto apply takes, the same hosts as
  `backend/app/auto_apply/hosts.py` (Greenhouse only). A host added there
  is added to `manifest.json` in the same change, or its fills answer
  `not_allowed`. After pulling a manifest change, reload the unpacked
  extension in `chrome://extensions`. The manifest also lists the six
  other job systems the extension fills (KAN-341), which auto apply
  doesn't take yet: the background fetches their job APIs, and injects
  Workday's fill again on its next page.
- **The fill is the popup's fill.** Both call `injectFill`
  (`src/shared/content-scripts.js`); `content-script.js` runs on
  injection, so injecting is starting. The resume is the profile's default
  (`resolveResumeFile`), not yet `prepare_resume`'s, so a tailored resume
  is not attached and no sent resume is kept.
- **Wait for the form, not for the fill.** The runner first injects `waitForForm`, which watches
  the DOM (never `requestAnimationFrame`: a hidden tab runs none) for up
  to 10 seconds. Then it injects the engine and answers `run/open`
  without awaiting the fill.
- **The student is taken to the run's tab for the fill, and stays there.**
  Filled hidden, the text fields filled but most dropdowns did not, even
  with the waits below fixed: Chrome treats a hidden page differently (no
  redraws, timers about once a second, no focus), and react-select's menus
  need some of that. So `startFill` makes the run's tab active once the
  form is ready, and the dropdowns fill (confirmed live). Switching back
  to the WorkIt tab after the fill was built and dropped: it didn't help,
  since the student reviews this form next anyway.
- **The overlay puts itself back when the page removes it.** Once the
  runner showed the tab and filled at once, the fields filled but the
  panel never appeared: the fill landed as Greenhouse's React app took
  over the document (hydration), which drops nodes it didn't render.
  `overlay.js`'s `keepAttached` watches the whole document and appends the
  same host again, to whichever `<html>` exists. Anything else this
  extension adds to a page needs the same guard.
- **`run/open` never reloads or refills the application already open.**
  When the run's tab shows the next application's job posting, it is left
  as it is (`fill: "kept"`): a second click (another card, Start again)
  would otherwise throw away what the student typed, and a second fill
  would mount a second overlay. A student who reloads the tab by hand
  fills it from the popup. The saved job id is what's compared, not
  the URL, which the form's own steps change.
- **`run/open` answers once the fill has started** (the page's `status:
  "complete"`, 30 seconds at most, then the form, 10 seconds at most), with
  `fill: "started" | "kept" | "failed"` (`reason`: `no_form`,
  `not_allowed`, or the error's message), or with why nothing opened:
  `queue_empty`, `signed_out`, or an error such as a closed tab. No answer
  at all means no extension, or one turned off: that is the webapp's
  "is the extension active?" check. The webapp shows no failed fill yet.

- **Nothing here waits on a redraw.** The first runner fill (before the
  Fill engine) filled the name fields, then reported "No options appeared"
  on every dropdown: its waits polled with `requestAnimationFrame`, which a
  hidden tab never runs. A new wait in `src/` watches the DOM
  (`MutationObserver`) with a `setTimeout` limit. The engine polls with
  `setTimeout`, which a hidden tab slows to about once a second, one more
  reason the run's tab is shown before the fill. The test browser tool
  can't check hidden-tab timing: Chrome keeps a tab it drives visible and
  focused, so test with the real runner.

The runner opens a job's form, not its page (`formUrl`: a Lever
`apply_url` opens the posting, and the form is at `.../apply`). Still
open: why a hidden tab's dropdowns stay empty is not pinned
down (focus is the likeliest); if found, the fill could stay hidden. With
the student's Chrome window behind another app, macOS may still count the
shown tab as hidden. A tab closed within a second or two
of opening should be reported as that, not as the student's Skip.

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

## No backend changes, and why that's safe (almost always)

`src/background/api.js` mostly calls endpoints that already exist for the
webapp: `GET /auth/me`, `GET /applicants/{id}/profile`, `GET
/applicants/{id}/bank`, `GET /applicants/{id}/preferences`, `GET
/applicants/{id}/autofill-answers`, `GET /applicants/{id}/resumes`, `GET
/applicants/{id}/built-resumes` (plus `.../built-resumes/{id}/render`), and
the runner's `GET /applicants/{id}/applications/next`. All were already
reachable with a Bearer token before the extension called them. Two routes
exist only for this extension — essay-answer generation and `GET
.../resumes/{resume_id}/bytes` — each explained in its own section below,
with why no existing endpoint was safe/usable from here.

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
Profile write it; the extension only reads it, and `engine.js`'s
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
  the overlay lists the Plan's reason under "Left for you". A draft that is
  a choice (a dropdown) or one line ("Nick Name") is the student's too: a
  written answer can't pick an option, and the essay route writes
  sentences.
- **Generation is sequential** (`content-script.js`'s `onGenerate`), one
  `essay/generate` per question: each is its own counted AI use, and the
  overlay shows each row as it lands. The answer is then filled through the
  engine like any other.
- **Company name and job title come from the job system's API** (the Job
  Board API's `company_name` and `title`), not the page's title.
- **The model call is `POST /applicants/{id}/essay-answer`**
  (`backend/app/routers/essay_answer.py`): grounded in the whole
  experience bank, checked against the truth rule, never given identity
  data. The question, company and role count as given, so an answer may
  name them (before that, every live answer was refused: "Cloudflare" and
  the pronoun "I" read as invented tools). A 429/503/422 becomes the row's "failed" reason verbatim; there is
  no retry.
- **Nothing is persisted.** The question and the generated answer are
  never saved.

## The overlay: honest per-field results

`lib-status.js` keeps one row per field and computes the headline only
from rows the form marks required, so an optional field left empty is
"skipped", never red, and no parent row can hide a failed one (the two
JobRight bugs the research caught). The overlay shows a failed row's
reason in red and a skipped row's in gray.

## Conventions

- **Plain scripts, shared globals, explicit load order** in `src/content/`:
  Chrome's static `content_scripts` declaration (and `chrome.scripting
  .executeScript`'s `files` array) don't support ES modules, so these files
  attach to `window.WIA` instead of using `import`/`export`. The load order
  that makes this work lives in exactly one place —
  `src/shared/content-scripts.js` (`ENGINE_FILES` in the MAIN world, then
  `CONTENT_SCRIPT_FILES`), which the popup and the runner both use through
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
  student). Auto apply still takes Greenhouse only (`hosts.py`).
- **One school, and no phone country.** The adapter gives the engine the
  latest education entry only, and WorkIt holds no place the student lives,
  so Greenhouse's Country picker beside Phone is left for the student.
- **No "not a veteran" answer.** WorkIt's `veteran_status` is
  protected_veteran, not_protected_veteran or declined. Since the engine's
  fix (KAN-329), "I am not a protected veteran" answers only
  protected-status questions; a plain "Are you a veteran?" or military
  service question is the student's (a Missing fact). Answering it needs a
  new value such as `not_veteran`, mapped to "I am not a veteran"; never
  map not_protected_veteran to false.
- **First/last name is the first word and the rest** of `full_name` —
  wrong for anyone with a multi-word given name. WorkIt's own database
  has no separate first/last name fields to read instead
  (`backend/app/models/profiles.py`'s `Profile.full_name` is one column).
- **No packaging/publishing path yet.** The `key` in `manifest.json` pins a
  stable *local* extension id (so the webapp bridge has something fixed to
  call) — it is not a Chrome Web Store signing key, and publishing for
  real would need its own key and listing.
- **Icon is a placeholder.** `icons/icon.png` is `frontend/public/
  workit-icon.png` copied in at one size, referenced for all three manifest
  sizes (16/48/128) rather than three properly-generated files.

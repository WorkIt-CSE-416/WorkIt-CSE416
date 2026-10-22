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
what the student has done. `src/content/field-map.js`'s education and
experience arrays come from filtering the bank's `entries` by `section`,
not from a `ParsedResume`.

**One exception**: essay-question generation (below) is the first feature
here that needed a genuinely new backend route,
`POST /applicants/{id}/essay-answer`, because it's the first one that calls
a model — and an extension can't hold a model API key client-side without
exposing it. Every other value this folder fills still comes from an
endpoint that already existed for the webapp.

**No npm, no TypeScript compiler, no bundler.** Every file here is the file
Chrome actually loads — plain ES2020+ JavaScript, JSDoc `@typedef`s in
`src/shared/types.js` standing in for compile-time types. This was a
deliberate choice for a first prototype that needed to be reviewable and
loadable without a toolchain, not a position that a build step should never
be added — see Open Items.

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
one known Vercel preview origin
(`https://workit-web-gamma.vercel.app/*`) by exact hostname —
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
  extension in `chrome://extensions`.
- **The fill is the popup's fill.** Both inject `CONTENT_SCRIPT_FILES`
  (`src/shared/content-scripts.js`); `content-script.js` runs on
  injection, so injecting is starting. The resume is the profile's default
  (`resolveResumeFile`), not yet `prepare_resume`'s, so a tailored resume
  is not attached and no sent resume is kept.
- **Wait for the form, not for the fill.** `content-script.js` reads the
  fields once, so the runner first injects `waitForForm`, which watches
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

- **Nothing in the fill engine waits on a redraw.** The first runner fill
  filled the name fields, then reported "No options appeared" on every
  dropdown and never attached the resume: `waitForOptions` and `waitUntil`
  polled with `requestAnimationFrame`, which a hidden tab never runs, so
  each wait stalled until the student looked at the tab and then timed
  out. Both now wait on DOM changes (`MutationObserver`) with a
  `setTimeout` limit, and the pause between typed characters yields
  through a `MessageChannel` in a hidden tab, since Chrome runs a hidden
  tab's timers about once a second. A new wait in `src/content/` follows
  the same rule. The test browser tool can't check this: Chrome keeps a
  tab it drives visible and focused, so test with the real runner.

Still open: a Lever `apply_url` opens the job posting, not the form (that
is at `.../apply`). Why a hidden tab's dropdowns stay empty is not pinned
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

KAN-283 built the real field this used to lack: `autofill_answers`, one
JSONB bank per applicant (`backend/app/models/autofill_answers.py`), keyed
by the same nine question keys `src/content/field-map.js` now answers
directly from `profile.answers` (no more inference) —
`work_authorized_us`, `needs_sponsorship`, `work_authorization_status`,
`security_clearance`, `gender`, `hispanic_latino`, `race`,
`veteran_status`, `disability_status`. Onboarding's Profile step and My
Profile write it (`GET`/`PATCH /applicants/{id}/autofill-answers`); the
extension only reads it. Each rule's filled value is the exact label text
`frontend/src/lib/autofill-answers.ts` shows the student for that option,
copied rather than reworded, since that screen's own labels are already
written to match real hiring-system wording.

- **Only two of the nine are live-tested**, against a real Greenhouse
  posting's "U.S. Standard Work Authorization" section: "Are you legally
  authorized to work in the United States?" (`work_authorized_us`) and "Do
  you currently, or will you in the future, require sponsorship for
  employment authorization?" (`needs_sponsorship`), both a Yes/No/"I don't
  wish to answer" dropdown with a dynamic, per-posting field id — never
  Greenhouse's stable schema, so this is the generic label-matching path,
  not `ats-greenhouse.js`. The other seven (citizenship/visa status,
  security clearance, and the voluntary gender/Hispanic-or-Latino/race/
  veteran/disability self-identification — the "Voluntary
  Self-Identification" section every posting pairs with the
  work-authorization one) are built the same principled way but not yet
  confirmed against a live form; promote a synonym in `field-map.js` the
  day one doesn't match. `hispanic_latino` and `race` were built by a
  teammate's own KAN-299, independently of and in parallel with this
  session's own (reverted) attempt at the same gap — `backend/app/models/
  CLAUDE.md`'s Known Gaps had named it explicitly ("race and ethnicity
  self-identification have no key yet"). KAN-299's design splits it into
  two real EEO questions, not one combined field: Hispanic or Latino is
  its own yes/no/decline, race is a separate EEO-1-category question — the
  extension's `field-map.js` matches that split, `race` and
  `hispanic_latino` as two independent rules, not one.
- **`work_authorized_us`/`needs_sponsorship` fall back to the onboarding
  "Visa Sponsorship" job-search filter** (`applicant_preferences.visa`,
  KAN-231) when a student hasn't answered KAN-283's real questions yet —
  `background/api.js`'s `inferredAnswers`, kept from before KAN-283
  existed. That filter only ever supports two confident inferences: `null`
  ("I Don't Need One") means authorized and no sponsorship needed;
  `"sponsors"` means sponsorship will be needed (it says nothing about
  current work authorization — an OPT/CPT student can be both, so that one
  stays unanswered). A real saved answer always wins over this fallback.
  The filter's third old value, `"not_ruled_out"`, was dropped from the
  schema in KAN-275; `inferredAnswers` no longer has a branch for it.
- **An unanswered required field reports a specific overlay failure, never
  a guess** — a wrong answer on a legal-eligibility or voluntary
  self-identification question is worse than one the student fills in
  themselves. This is the same honesty rule every other field in this
  engine follows (`lib-fill.js`'s explicit `{ ok: false, reason }`,
  below).

## Greenhouse's phone country code

Greenhouse's identity section pairs `Phone` with a separate `Country`
field — confirmed live, a stable Greenhouse id alongside `first_name`/
`email`/`phone`, and a combobox of calling codes ("United States +1",
"Afghanistan +93", one per country), not a location/residence field (that's
the separate "Location (City)" field further down). This was unhandled
until now: `ats-greenhouse.js`'s `identity` array had `phone` but nothing
for `country`, so a required field next to it went unfilled on every
posting.

- **`splitPhoneCountry`** reads a leading `+<code>` off the bank's free-text
  `phone_number` (`backend/app/models/profiles.py`'s column has no format
  beyond length, so a student can type one), maps it to the country name
  Greenhouse's own option list uses (confirmed live: typing just "United
  States" is enough for `fillCombobox`'s substring match to find "United
  States +1"), and **strips the matched code from what Phone itself gets
  filled with** — showing the code twice, once in Country and again typed
  into Phone, would read as a mistake on the filled form.
- **Not exhaustive.** `CALLING_CODE_COUNTRIES` covers the calling codes
  WorkIt's own student population is likeliest to use, not all ~240. An
  explicit code the table doesn't recognize leaves Country unfilled
  (honest, no guess) but still fills Phone with the number in full,
  untouched.
- **No leading `+` at all, or `+1`, resolves to "United States"** — a
  deliberate default, not a guess: this product is explicitly US-only
  while it's young (`backend/app/models/CLAUDE.md`'s "Locations" section),
  so an uncoded number is the common domestic case here, and `+1` itself is
  shared by the US, Canada and ~19 Caribbean nations, so "United States" is
  the same kind of product-scoped default.
- **Longest-prefix matching** (3 digits, then 2, then 1) is correct by
  construction, not by luck: international calling codes are prefix-free,
  so trying the longest slice first and taking the first table hit can
  never pick a shorter code that happens to also be a prefix of the real
  one — confirmed against `+971...` (UAE, 3 digits) and `+91...` (India, 2
  digits) with no separator between the code and the local number, where a
  naive fixed-length read would get either wrong.
- **Live-tested logic, not yet a live fill.** The split function itself was
  checked against a dozen real-world phone shapes (with/without
  separators, no code at all, an unrecognized code); the actual
  `fillCombobox` selection on Greenhouse's Country field was verified
  separately by typing "United States" into the live field and confirming
  it filters to exactly one match. The two have not yet been run together
  through a loaded, reloaded extension — same open item as the
  essay-answer feature below.

## Attaching the student's resume file

Greenhouse's "Resume/CV" field is a stable `input#resume`, `type="file"`,
`accept=".pdf,.doc,.docx,.txt,.rtf"` — confirmed live (The Trade Desk's
posting), sitting behind styled "Attach"/"Enter manually" buttons but the
real file input is directly targetable underneath both. This was unhandled
until now: nothing in `ats-greenhouse.js` touched it, so a required field
on every posting went unfilled.

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
  null` — rather than failing the whole profile load over one field.
  `ats-greenhouse.js` then reports it as a normal skipped/failed overlay
  row (failed only when Greenhouse marks the field required), the same
  honesty rule every other field here follows.
- **`lib-fill.js`'s new `fillFile`** is the one place that builds a real
  `FileList`: a file input's `.value` is read-only and a plain array
  assigned to `.files` is rejected outright, so the only way in is a
  `DataTransfer` holding a `File` built from the decoded bytes — the same
  trick a user's own file picker produces, with a "change" event dispatched
  after so Greenhouse's own upload widget notices. Kept separate from the
  string-only `fillField` dispatcher, since a file's value is a structured
  object, not text.

## Essay-question generation: the one opt-in, model-backed feature

Open-ended application questions ("Why do you want to work here?", "What
experience do you have relevant to this role?") are always a `<textarea>`
with no fixed vocabulary — nothing in `field-map.js`'s synonym rules could
ever claim one. Before this feature, such a field fell straight through
`content-script.js`'s `if (!match) continue;` and simply vanished: never
registered, never shown in the overlay, no signal to the student that it
existed. Confirmed live: a required essay question on a real posting
(SingleStore's "Why do you want to work at SingleStore?") produced zero
overlay rows and zero warning before this was built.

- **Detection lives in the generic engine, not `ats-greenhouse.js`** —
  essay questions use dynamic, per-posting field ids on every ATS looked
  at, Greenhouse included, so there's nothing stable to adapt to. At the
  same `if (!match) continue;` line, a `<textarea>` with a label is now
  registered with a fourth status, `"needs_generation"` (`lib-status.js`),
  instead of silently skipped — closing the exact gap above. `summary()`'s
  `essayCount` is how `overlay.js` knows whether to show the batch prompt,
  without tracking its own parallel state.
- **One blanket opt-in, never per-question.** After the main fill pass,
  if any essay candidates were found, `overlay.js`'s `promptForEssays`
  shows one banner — "N essay question(s) found — generate answers with
  AI from your experience bank?" — with **Generate**/**Not Now**. Nothing
  is ever sent anywhere until the student clicks one. **Not Now** marks
  every candidate `"skipped"` (never `"failed"` — nothing went wrong, the
  student chose to answer it themselves); a skipped *required* field is
  the first time this engine has that combination, and it's intentional:
  `summary()`'s required/filled accounting doesn't change for it, so
  "0/1 required fields filled" keeps meaning exactly what it says — this
  field still needs the student's own attention, just not from a failure.
- **Generation is sequential, not parallel** (`content-script.js`'s
  `onGenerate`), one `essay/generate` message per candidate — each is its
  own counted AI use server-side, and the overlay shows real one-at-a-time
  progress as each row flips from blue to green (or red) rather than
  jumping all at once.
- **Company name and job title come from `document.title`**, read once via
  `pageContext()` — Greenhouse's confirmed live format is exactly "Job
  Application for {title} at {company}". Untested against any other ATS;
  a miss just means a more generic generated answer, never a failure. A
  DOM-read fallback (an `<h1>`, a logo `alt`) is a reasonable future
  improvement, not required.
- **The model call is `POST /applicants/{id}/essay-answer`**
  (`backend/app/routers/essay_answer.py`, `backend/CLAUDE.md`'s own
  section on it) — grounded in the whole experience bank, checked against
  the truth rule before it ever reaches the student, same as Tailor and
  the editor assistant. A 429/503/422 from that call becomes the row's
  `"failed"` reason verbatim; there's no retry built in; the student can
  always just write the field themselves.
- **Nothing is persisted.** The question's literal text and the generated
  answer are never saved anywhere — `backend/app/models/CLAUDE.md`'s
  "autofill_answers" section already anticipated this exact feature as the
  reason a company's own screening question would eventually get its own
  JSONB-backed slot; this ships the generation half first, deliberately,
  and storing is a separate, later step.

## Field engine — fixing JobRight's three bugs by construction

`src/content/` is organized around the three concrete failures the
"JobRight Autofiller Findings" doc caught, each fixed at a specific layer
rather than patched after the fact:

- **Dropdown no-match left silently blank** → `lib-fill.js`'s `fillSelect`/
  `fillCombobox` return an explicit `{ ok: false, reason }` the moment a
  typed value matches nothing, instead of leaving the field untouched with
  no signal.
- **A dishonest rollup percentage** (two failed sub-fields hidden inside
  one "done" parent) → `lib-status.js` never creates a parent entry for a
  repeated section (an education or experience entry) at all. Every
  sub-field is tracked as its own independent leaf, so the required-field
  percentage is computed only from leaves — there's no higher-level number
  that can disagree with what's actually filled.
- **An optional field flagged red for being empty** → `field-map.js`'s
  `isRequired()` reads the field's own `required`/`aria-required`/asterisk
  signal; `content-script.js` only ever marks a field `"failed"` when it's
  both required and empty or mis-filled. An empty optional field is
  `"skipped"` — present in the overlay, not alarming.

## A rule can offer an ordered list of candidates, not just one value

"How did you hear about this job?" (confirmed live on Braze's posting, a
required field) has no WorkIt profile data to answer honestly — unlike
every other `simpleFieldRules` entry in `field-map.js`, which all read a
real saved value. The honest answer is WorkIt itself, so this field names
it directly rather than reporting a failure for a field nothing in the
profile could ever fill. But the right literal text depends on whether the
field can hold any string or only one from a fixed list, and `field-map.js`
never sees the DOM element — it classifies by label text alone.

`lib-fill.js`'s `fillField` now accepts `value: string | string[]` for
exactly this: a plain string behaves exactly as before, and an array is
tried in order, first success wins. This needed no new "what kind of field
is this" detection in `field-map.js` at all — the existing success/failure
semantics of each fill strategy already encode the distinction. `fillText`
only ever fails on a field that can't hold text, so a free-text field
accepts `"WorkIt"` (the first candidate) immediately; `fillSelect`/
`fillCombobox` fail the moment nothing in the option list matches, so a
dropdown falls through to `"Job Board"` — the generic option nearly every
such field's own list already offers — without `field-map.js` ever
checking `field instanceof HTMLSelectElement` itself. One mechanism, no
field-type branching at the rule level; promote any other field with an
honest-but-not-personal-data answer to this same shape rather than a bare
string the day one comes up.

## A field the fill loop reveals mid-pass still gets filled

Found live on The Allen Institute for AI's Greenhouse posting: the EEOC
"Please identify your race" combobox doesn't exist in the DOM at all until
"Are you Hispanic/Latino?" has an answer. `content-script.js`'s fill loop
snapshots every field once, before it fills anything (`dom.findFormFields`),
so a field Greenhouse only renders in response to an earlier answer was
invisible to a plain `for...of` over that snapshot — it would never get its
own turn, no matter how correct `field-map.js`'s `race` rule already was.

The loop is an index loop (`for (let i = 0; i < fields.length; i++)`) with a
`try`/`finally` around each field's body: the `finally` re-queries
`dom.findFormFields(document)` after every field, regardless of which
`continue` fired, and pushes anything not already in `fields` onto the same
array. `i < fields.length` re-reads that array's current length each pass,
so a field appended this way gets its own iteration later in the same loop
— and a reveal chain more than one field deep (an answer that reveals a
field whose own answer reveals another) still terminates correctly, since
each new field is itself subject to the same re-scan. General, not
Greenhouse- or race-specific: any ATS with a conditionally-revealed field
is covered by the same mechanism.

## Posting-specific overrides are a last resort, in `ats-greenhouse.js` only

`ats-greenhouse.js`'s `POSTING_OVERRIDES`, keyed by Greenhouse's own job id
(the number at the end of `.../jobs/<id>` — stable per posting, confirmed
live), fills one specific posting's fields that have no honest general
answer: a field with no WorkIt data source at all (Ai2's "Location (City)",
since no part of WorkIt tracks a student's city — not even their own
profile), or that posting's own one-off custom question wording a synonym
rule would be too narrow to justify adding generally. **Promote an entry
out of here the moment it generalizes** — "willing to relocate" started as
an override here and moved to a real `field-map.js` rule once it was clear
most postings phrase that question close enough to match one synonym list;
Ai2's own override for it was deleted in the same change. Delete an entry
outright once its posting is gone or done with, rather than leaving it to
accumulate — this map is for "get one specific application unblocked right
now," not a growing per-company config.

## Repeated sections: clicking "Add" and filling every entry, not just the first

Found live on a real Workday application (not the sample form): a second
education/experience block doesn't exist in the DOM at all until the page's
own "Add Another Education"/"Add Another Work Experience" control is
clicked, and even once it exists, the old `field-map.js` always returned
`education[0]`/`experience[0]` no matter which block a field belonged to —
so a second block just got the first entry's data stamped on it again.
Fixed at both layers:

- **`content-script.js`'s `ensureRepeatedBlocks`** runs before field
  discovery, once per group (`education`, `experience`). It counts existing
  blocks by counting fields matching that group's one always-present-once-
  per-block synonym (`institution` for education, `company`/`employer` for
  experience), then clicks `dom.findAddButton` until the block count
  reaches the bank's actual entry count for that section, polling after
  each click (`dom.waitUntil`) since there's no completion event for a
  block finishing its render. A form that already shows enough blocks (the
  common case: one bank entry, one default block) never calls
  `findAddButton` at all. Only ever registers a status row on *failure* (no
  button found, or a click that didn't grow the block count) — so this
  stays invisible in the overlay on the path that already worked before
  this feature existed.
- **`dom.findAddButton(specificPattern, sectionPattern)`** tries the
  button's own wording first (a regex like "Add Another Education" against
  its text/value/aria-label). Found on a real Workday form: some of its
  sections instead give every "Add" control the exact same bare `"Add"`
  wording, with the section name only ever appearing once, in that
  section's own heading — nothing on the button itself to match against.
  For that case `findAddButton` falls back to every generic `/^\+?\s*add/i`
  control on the page: returned outright if it's the only one (nothing to
  disambiguate), otherwise resolved by walking up from whichever heading
  matches `sectionPattern` (e.g. `/education/i`) to find the smallest
  ancestor containing one of those generic buttons, preferring the one
  that comes *after* the heading in document order. This is DOM proximity,
  not real semantic section-scoping — it depends on `walkAllElements`
  actually returning elements in document order, which turned out not to
  be true before this feature needed it (see the fix in that function's
  own comment in `lib-dom.js`: its old stack-based traversal reversed
  sibling order past the first nesting level, which `findAddButton`'s
  "first candidate after the heading" logic would have silently gotten
  wrong on anything but a flat page like the sample form).
- **`field-map.js`'s `matchLabel`** takes a third argument, `occurrences` —
  a `Map` the caller owns and passes back in on every call, counting how
  many times each repeated template (`"education.institution"`,
  `"experience.company"`, ...) has matched so far. The *n*th field matching
  a template resolves to bank entry *n*: the first "School" field found
  in DOM order is `education[0]`, the second is `education[1]`. This is
  occurrence-counting, not real container-boundary detection — there's no
  attempt to find each block's actual DOM subtree. It holds as long as a
  form's repeated blocks render their sub-fields in the same relative
  order block-to-block (block 1's School before block 2's School, not
  interleaved) — true of every ATS looked at so far, but a structural
  assumption, not a guarantee. A field beyond the bank's entry count for
  that section (page has 3 blocks, bank has 2) is matched, counted, and then left
  alone — `matchLabel` returns `null` once `occurrence >= values.length`,
  the same "not something WorkIt has an opinion about" path an unrelated
  field takes.

**`test/sample-form.html`'s Education and Experience sections** are the
runnable check for this — both give their "Add" button the exact same bare
`"Add"` wording on purpose, so the page has two identical, ambiguous
add-like controls, exercising `findAddButton`'s section-heading fallback
specifically (not just its direct-wording match, which a differently-worded
button would have shortcut around without ever reaching the fallback).
Clicking either clones a second block via plain JS. Only actually exercises
`ensureRepeatedBlocks` at all when the signed-in applicant's experience
bank has 2+ entries in that group; with exactly one, the default block already
satisfies `neededCount` and no button is clicked — correctly.

Still open: `findAddButton`'s patterns (`buttonPattern`/`sectionPattern` in
`content-script.js`'s `REPEATED_GROUPS`) are untested against Workday's
actual wording beyond what prompted this fix — a button phrased some other
way (an icon-only "+" with no matching aria-label and no nearby heading at
all, say) won't be found, and `ensureRepeatedBlocks` reports that as a
failure row rather than silently giving up. The section-heading fallback
also assumes a real heading element (`h1`–`h6`, `legend`, or
`[role="heading"]`) actually exists for each section — a form that
labels a section with plain styled text and no heading semantics defeats
`nearestToSectionHeading` the same honest way: not found, reported, not
guessed at. Still only the FIRST occurrence of a `simpleFieldRules` field
(name, email, phone, ...) is handled — those were never repeated-section
fields and aren't affected by any of this.

## Conventions

- **Plain scripts, shared globals, explicit load order** in `src/content/`:
  Chrome's static `content_scripts` declaration (and `chrome.scripting
  .executeScript`'s `files` array) don't support ES modules, so these files
  attach to `window.WIA` instead of using `import`/`export`. The load order
  that makes this work lives in exactly one place —
  `src/shared/content-scripts.js`'s `CONTENT_SCRIPT_FILES`, which the
  popup and the runner both import — and a new content file is added
  there by hand.
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

- **The extension knows only the Vercel origins, not `workitjobs.ai`**
  (KAN-169). `PROD_WEB_URL`, `PROD_API_URL` and `manifest.json`'s
  `host_permissions` and `externally_connectable` name
  `workit-web-gamma.vercel.app` and `workit-api.vercel.app` alone. Signed in
  on `workitjobs.ai` only, a student has no session cookie where
  `webapp-session.js` looks, so the extension reads them as signed out and
  the site's Auto Apply cannot reach it. Both domains share one Supabase
  project and database, so pointing these at `workitjobs.ai` and
  `api.workitjobs.ai` is the whole change; it belongs with the KAN-296
  cutover. A new `host_permissions` entry makes Chrome ask installed users
  to approve it again.
- **Essay-question generation: the detection, overlay, and backend route
  are each confirmed working on their own; the full round trip through a
  loaded, reloaded extension (popup click → injected content script →
  `chrome.runtime.sendMessage("essay/generate")` → background service
  worker → the live API → filled field) has not been.** Detection and the
  overlay's banner/row states were verified by running the real
  `lib-dom.js`/`lib-status.js`/`field-map.js`/`overlay.js` against a real
  Greenhouse page with an injected essay field; the backend route was
  verified by import and by generating its OpenAPI schema. What's never
  been exercised end-to-end is the message-passing glue itself
  (`background.js`'s new `"essay/generate"` case, `api.js`'s
  `generateEssayAnswer`) — it follows the exact pattern `"profile/get"`
  already uses in production, but confirm it live (load unpacked, reload,
  run against a posting with a real essay question — Cloudflare's and
  Double Good's internship postings had one but closed between finding and
  testing them; search for another before assuming any specific posting
  still has one) before relying on it.
- **Resume file attachment: the Storage-CORS fix is unverified live, same
  as everything else here.** See "Attaching the student's resume file"
  above — the first version (a direct fetch to a signed Storage URL) was
  built, reasoned as safe, even checked with a manual cross-origin fetch
  from the webapp's own tab, and *still* didn't attach from inside a real
  loaded extension; the fix (`GET .../resumes/{resume_id}/bytes`, this
  API's own origin, no Storage CORS involved) hasn't yet had the same live
  test run against it. `fillFile`'s `DataTransfer` attach is also only
  reasoned from Greenhouse's confirmed `input#resume` DOM shape, not yet
  confirmed live either. Load unpacked, reload, and run against a posting
  with the Resume/CV field next — and if the file still doesn't attach,
  the bug is likelier in `fillFile`/the DOM shape than in the fetch this
  time, since the fetch no longer depends on a third party's CORS policy.
- **Live-tested, but only against one real ATS so far.** Signed-in-session
  reading (Auth section above) and basic field-filling, including the new
  repeated-sections mechanism, have been confirmed working against a real
  signed-in WorkIt account and a real Workday application. Greenhouse,
  Lever, and any other ATS remain untested — `field-map.js`'s synonym list
  and `findAddButton`'s button-text patterns were only ever checked against
  what Workday actually renders, and real forms vary. The dropdown timing
  heuristics and the label-pairing proximity walk are likewise only as
  tested as what came up along the way, not independently verified. Load
  it unpacked (`chrome://extensions` → Developer mode → Load unpacked) and
  try it against a real Greenhouse or Lever posting next. If the webapp
  session ever stops being found, check the background service worker's
  console (`chrome://extensions` → this extension → "service worker") for
  `webapp-session.js` warnings first.
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
- **One generic classifier, not per-ATS adapters.** `field-map.js` is the
  build plan doc's v1 starting point — a synonym-matching heuristic, not
  Greenhouse- or Lever-specific selectors. Expect it to do well on simple
  forms and need real adapter work (per the build plan's Phase 2) on
  anything more custom.
- **Repeated sections beyond what's been live-tested.** Filling a 2nd/3rd
  education or experience entry (clicking a form's own "Add another"
  control, mapping the *n*th matching field to bank entry *n*) is now
  built — see "Repeated sections" above — but confirmed only against the
  one real Workday application that prompted it and the sample form's own
  demo. `findAddButton`'s button-text regex, and the assumption that a
  form renders repeated blocks' sub-fields in consistent relative order,
  are both still only as tested as that.
- **First/last name is `full_name.split(" ")`**, first and last token —
  wrong for anyone with a multi-word family name. WorkIt's own database
  has no separate first/last name fields to read instead
  (`backend/app/models/profiles.py`'s `Profile.full_name` is one column).
- **No packaging/publishing path yet.** The `key` in `manifest.json` pins a
  stable *local* extension id (so the webapp bridge has something fixed to
  call) — it is not a Chrome Web Store signing key, and publishing for
  real would need its own key and listing.
- **Icon is a placeholder.** `icons/icon.png` is `frontend/public/
  workit-icon.png` copied in at one size, referenced for all three manifest
  sizes (16/48/128) rather than three properly-generated files.

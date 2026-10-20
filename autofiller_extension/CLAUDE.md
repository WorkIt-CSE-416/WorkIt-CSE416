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
HTTP — it adds no new backend routes, no new database tables, no new
migration. Every value it fills comes from `applicant_profiles` and
`resumes.parsed_json`, the same rows the webapp's own profile screen reads
and writes.

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
  the runner to open the next queued application, which job its tab shows,
  and to switch to that tab — nothing more. The job cards' "Autofill ready"
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

## The auto-apply runner (KAN-223): opens the next queued application

`src/background/runner.js` is the runner's first step
(`auto-apply/architecture.md`, "The run"). The Auto Apply page's Start,
and a job card's Auto Apply once it queues the job, send `run/open` over
`externally_connectable`; the runner reads the oldest queued application
from `GET .../applications/next` and opens its `job.apply_url`. It fills
nothing yet: injecting the fill, Submitted/Skip and `POST .../finish` are
the next steps. Two more messages serve the webapp's "Working in
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
- **No new permission.** `chrome.tabs.create`, `chrome.tabs.update`
  (`autoDiscardable` too), `chrome.windows.update` and a tab's load
  `status` need none (only url, title and favicon need `tabs`).
  Injecting the fill into these tabs will: `activeTab` doesn't cover a tab
  the runner opened, so that step adds hiring-system `host_permissions`.
- **`run/open` never reloads the application already open.** When the
  run's tab shows the next application's job posting, it is left as it
  is: a second click (another card, Start again) would otherwise throw
  away what the student typed. The saved job id is what's compared, not
  the URL, which the form's own steps change.
- **`run/open` answers once the page loads** (`status: "complete"`, 30
  seconds at most) or with why nothing opened: `queue_empty`,
  `signed_out`, or an error such as a closed tab. Greenhouse and Ashby draw
  their form after `complete`; the fill step must wait for fields itself.

Still open: a Lever `apply_url` opens the job posting, not the form (that
is at `.../apply`). Whether a Greenhouse form fills in a hidden tab
(dropdowns, file upload) is untested. A tab closed within a second or two
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

## No backend changes, and why that's safe

`src/background/api.js` calls endpoints that already exist for the
webapp: `GET /auth/me`, `GET /applicants/{id}/profile`, `GET
/applicants/{id}/resumes[/...]`, and the runner's `GET
/applicants/{id}/applications/next`. All were already reachable with a
Bearer token before the extension called them.

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
  reaches the resume's actual entry count, polling after each click
  (`dom.waitUntil`) since there's no completion event for a block
  finishing its render. A form that already shows enough blocks (the
  common case: one resume entry, one default block) never calls
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
  a template resolves to resume entry *n*: the first "School" field found
  in DOM order is `education[0]`, the second is `education[1]`. This is
  occurrence-counting, not real container-boundary detection — there's no
  attempt to find each block's actual DOM subtree. It holds as long as a
  form's repeated blocks render their sub-fields in the same relative
  order block-to-block (block 1's School before block 2's School, not
  interleaved) — true of every ATS looked at so far, but a structural
  assumption, not a guarantee. A field beyond the resume's entry count
  (page has 3 blocks, resume has 2) is matched, counted, and then left
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
`ensureRepeatedBlocks` at all when the signed-in applicant's resume has 2+
entries in that group; with exactly one, the default block already
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
  `src/popup/popup.js`'s `CONTENT_SCRIPT_FILES` array — and has to be kept
  in sync by hand if a new content file is added.
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
  control, mapping the *n*th matching field to resume entry *n*) is now
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

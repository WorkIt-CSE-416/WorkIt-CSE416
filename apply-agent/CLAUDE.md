# CLAUDE.md — Apply

Loaded on top of the root `../CLAUDE.md` when you work in `apply-agent/`.

## What Apply is

Apply is a command-line agent that applies to job postings for one person.
It reads a job posting, fills the application form in Chrome through the
Fill engine, writes the answers and essays with Claude, and shows the Apply
window (Start, Needs you, Answers, Accounts). A rehearsal fills the form and never
submits. It runs on the person's own Mac, with their own Chrome and their
own Claude Code login. It is a developer and power-user tool, not a student
feature: students apply through the extension and the connector (KAN-369).

Apply has its own domain language. Read `GLOSSARY.md` and `docs/adr/` here,
not the root ones, for its terms (root `GLOSSARY-MAP.md`). Write each
glossary entry in ASD-STE100 wording: sentences of 25 words or fewer.

## How it differs from `auto-apply/` and the extension

- `auto-apply/` is the design document for WorkIt's auto apply (KAN-223)
  and its rehearsal records. It holds no runnable code.
- `autofiller_extension/` is the Chrome extension that students install. It
  fills forms in the student's own Chrome; Scout and the connector write its
  answers, and the WorkIt backend keeps its state.
- `apply-agent/` is a Python program (uv, Playwright) that runs its own
  Chrome workers. Claude writes its answers. Its state is files in the data
  folder, not the WorkIt database. It calls the WorkIt API only through
  the WorkIt client (next sections), as the signed-in student.

Both Apply and the extension fill forms with the same Fill engine (next
section). A fix to how a field is read, planned from the profile, filled
or read back goes into the engine, not into Apply. Apply's own plan rules
(next section) are Apply-side checks, not fill fixes: they decide what
Claude may draft and what Apply's own read-back accepts, and the extension
has neither.

## Reference by area

These files hold the detail of each area. Read the one that matches your change.

- **Fill engine:** read before you change Apply's plan rules, `fill_engine.py`, or what the plan answers from the Tracker, the Answer bank or a bare date. `docs/fill-engine.md`
- **WorkIt:** read before you change a WorkIt call, `apply login`, `import-sheet`, `clean-tracker`, a Tracker write, the already-applied check or the tailored resume. `docs/workit.md`
- **Held forms:** read before you change verifying, a flag, Resume, Regenerate, Ask Claude, page gates, or how a question reaches Needs you. `docs/held-forms.md`
- **Prompts and gates:** read before you change a prompt, a length, cap or names gate, or the catch-all box rule. `docs/prompts-and-gates.md`
- **Claude fill:** read before you change Claude fill, its Next and profile clicks, its dropdowns, or a Filler's `form_url`. `docs/claude-fill.md`
- **Captchas and bot blocks:** read before you change a captcha wait, a block's handoff, or `captcha.py`. `docs/captchas-and-bot-blocks.md`
- **Sign-in:** read before you change a sign-in page, an Employer account or its password, or the Accounts tab. `docs/sign-in.md`

## Plain Workers: the submit and drive guards (KAN-610)

On a plain Worker's page (a PortPage, `apply-agent/docs/plain-workers/PROTOCOL.md`),
`submit_guard.guard`, `lift`, `rearm`, `renote` and `DriveGuard` hand over to
`apply.plain.guards`. The CDP path is unchanged: its scripts are byte for byte the same.

- **The same scripts, as files.** `apply plain prepare` writes `submit_guard`'s scripts into
  `worker-extension/vendor/guards/` (the rehearsal guard, the four drive guards, LIFTED,
  REARMED). The extension registers one as a MAIN-world content script at `document_start` in
  every frame, so it runs before the page's code with no eval and no user scripts. It refuses
  a file whose sha256 is not Apply's: re-run `prepare` after changing `submit_guard.py`.
- **Below them, declarativeNetRequest.** `guard` puts one session rule per final application
  URL (the guard script's FINAL_URLS, which cover ROUTED) on the tab, the tabs it opens and
  service workers. It blocks a non-GET before it leaves Chrome: page code from another realm,
  a worker, a beacon, or a form's native POST. `lift` takes the rules off and `rearm` puts them
  back.
- **Presses are untrusted.** The plain copy of the guard script (`port=True`) counts as a touch
  the `__apply_touch` the extension sends before each press: Apply's own (`page/dom.js`) and
  Lisul's from the tile (`tile.input` calls `touch()` in `ops/guard.js`, which also sends `guard.touched`
  up the port). It also reports each block as a `guard.said` event, which `PlainDriveGuard.blocked()`
  reads, since no console reaches Apply.
- **Bindings.** `expose_binding` defines `window[name]` in each document of the tab. A call
  comes up as a `binding` event, and the callback runs on its own thread.
- **Live runs.** Nothing here adds a guard to a live run. `filler.submit` clicks Submit only
  where the live-run rules already allow it. DriveGuard lifts only for Claude fill's own submit
  click, as under CDP.
- Tests: `tests/test_plain_guards.py` (Chrome for Testing). A fake job system on 127.0.0.1
  records every POST. A page that sends by script (fetch from a fresh realm, a worker, a beacon,
  requestSubmit, a native POST) sends nothing once guarded, and the rules alone stop it too.
  A tile press shows the blocked note, and a lifted page's Submit goes through and is heard.

## The Apply window

- The status line counts a link as "queued" only until a Worker starts it.
  A rehearsal sends `board.run(queued=...)` each time a link starts.
- When a run or rehearsal ends, its window closes (`Dashboard.__exit__`).
  A window with no server shows a run that is gone.
- A click on Apply in the Dock goes to the window's Chrome, which counts no
  app window as a browser window and opens a New Tab window, every click.
  The window's keeper (`dock_app.keep`) closes it at once and brings the
  window forward. The bundle's launcher starts the keeper beside the
  window's Chrome, so it lives as long as that Chrome. Never move it back
  into the process that opens the window: `apply watch` exits right after.
- `kill <pid>` (SIGTERM) stops Apply as Ctrl-C does: the Worker browsers
  and the window close. Ctrl-C does not reach Apply when it runs in the
  background, so use SIGTERM there.

## Plain Workers' tiles and Fix from the window (KAN-609)

Plain Workers (KAN-606, `apply/plain/`, protocol in
`docs/plain-workers/PROTOCOL.md`) have no CDP, so `CdpFrames` can't reach
them. `apply.plain.tile.PortFrames` is their frame source for the same
`Dashboard`: `Dashboard(n, PortFrames(n, workers.bridge.connection))`.

- **Frames: filmed (KAN-635).** With Screen Recording permission, Apply films
  each Worker's own window with ScreenCaptureKit (`apply.plain.window_capture`):
  `window_capture.swift`, built once by swiftc into `~/Library/Caches/apply/`,
  finds the window of the Worker Chrome's PID (the native host's parent) nearest
  the bounds the extension sends (`tile.shown`), crops it to the tab's viewport,
  and streams 30 fps JPEGs (quality 0.85) at the screen's pixel scale (2560 x
  1626 for a 1280 x 813 viewport). By window ID: nothing is focused, raised or
  moved, and a covered window still streams. Measured live: 29.6 fps through the
  window's `/frames` (`FRAME_GAP` now allows about 60).
- **Frames: without the permission.** The worker extension captures the shown
  tab with `captureVisibleTab`, at most every 500 ms (Chrome's quota is about
  two a second per browser, and only the debugger API, never used here, gets
  past it), JPEG quality 88, at the tab's CSS size, sent only when the picture
  changed: about 2 fps. The tile shows one line (`PortFrames.notice`, the
  caption's `capture`): "Live tile off: turn on <app> in System Settings >
  Privacy & Security > Screen & System Audio Recording, then quit and reopen
  <app>". macOS gives the permission to the app at the top of Apply's process
  chain (Terminal, iTerm, Paradev, Apply.app). Apply only looks
  (`CGPreflightScreenCaptureAccess`); it never asks for or changes it: Lisul
  turns it on himself. `APPLY_TILE_CAPTURE=extension` forces this path. Tile
  frames and `page.screenshot` share one gate (`ops/shared.js: capture`), so
  neither hits the quota error.
- **Never blank (KAN-643).** A filmed tile with no frame within 3 s of
  `tile.start` (`FIRST_FRAME`: an extension too old to send `tile.shown`, or a
  helper that never aimed, as when ScreenCaptureKit waits on a macOS prompt),
  or with none for 20 s after a `tile.shown` (`STALLED`), stops being filmed:
  `tile.start` again with `native: false`, and the extension's frames show.
  Apply prints one line saying why. Clicks map by the frame's own size
  (`page/tile.js` scales by `width` x `height`), so a 2x filmed frame and a 1x
  extension frame both land on the element under the pointer.
- **Out-of-date extensions (KAN-643).** The hello's `features` says what the
  loaded extension's code can do (`bridge.FEATURES`, 2). An older one with
  `extension.reload`, in a profile with Developer mode on, is reloaded in place
  before its welcome (`chrome.runtime.reload()`: tabs, pages and sign-ins stay).
  Still older, it is welcomed as `stale`: Apply prints one line and the tile says
  "Worker extension is out of date: quit Apply and start it again". The run goes
  on. Never reload from chrome://extensions or raise a Worker's window.
- **Covered windows still stream** because of
  `--disable-backgrounding-occluded-windows`. A minimized window doesn't:
  never minimize a plain Worker.
- **Input.** The window's events go to `tile.input`, which replays them as
  synthetic DOM events (`page/tile.js`). It handles press, release, move,
  wheel, keys, text, copy, and choosing from a `<select>` menu, and it
  reaches into iframes, cross-origin ones too. Keys reuse `page/dom.js`'s
  `press`, which now moves the caret for Arrow, Home and End.
- **Files.** An untrusted click opens no file picker. The extension marks
  the input a click asked for: an input or its label, or a page script's
  `input.click()` or `showPicker()`. The tile then asks Lisul for the file,
  and `chooser.set` gives it to the input through DataTransfer. The hook acts
  only without user activation, so Lisul's real mouse in the Worker's window
  still gets the real picker. `PortPage.expect_file_chooser` and
  `PortPage.mouse` use the same ops (`attach.py`'s upload behind a button
  works on a plain Worker).
- **Never take Lisul's focus.** Plain Workers start with `open -g -n`
  (`launcher.start_in_background`) with `--no-startup-window`, then the
  extension opens the window unfocused (`windows.create`), 1280 x 900 (readable at 100%),
  shrunk to the main screen's visible area, at its top-left corner. Only his Show brings one forward. Tests share one Worker and
  stop it when they end.
- **Wired into runs (S8, KAN-614).** `cli._dashboard` builds `PortFrames` when
  `worker_mode: plain`, and `EitherFrames` (each Worker's current kind) when `protected`.
- **Live check.** `uv run apply plain tile lever-immuta` fills a saved form
  in a plain Worker and prints the window's address. Click the tile and type.
  The tests are in `tests/test_plain_tile.py`: they need Chrome for Testing,
  each run takes about 30 s, and they use their own socket. The `frames`
  fixture is the extension's path; `filmed` (`-k filmed`) needs Screen
  Recording for the app pytest runs in, else it skips.

## Rehearsal records

A Workday link is named from the Feed; one the Feed lacks is named by
Workday's job API, its legal entity trimmed to the company
(`workday.company_of`: "ASML US, LP. (US30)" is ASML). Unnamed, ASML's
Record was headed "# : " in a folder named `company-...`.

Every rehearsal outcome writes its Record (`rehearsals/<date>/`), a Handoff or
a failure too, not only a filled form. A step Workday won't leave keeps what
was planned and what each field showed up to there
(`WorkdayFiller.shown_so_far`); an outcome before any form opened keeps a
screenshot of the page it stopped on.

## Plain Workers: Records, Needs you, Resume and the emailed code (KAN-611)

A plain Worker is a Chrome with no CDP, driven by the worker extension
(`docs/plain-workers/PROTOCOL.md`). On its page (`apply.plain.page.PortPage`):

- **Full-page screenshot.** `page.screenshot(full_page=True)` scrolls the page
  one viewport at a time and joins the strips (`tabs.fullScreenshot`). Fixed
  and sticky elements show once, at the top. The image has 1 px for each CSS
  px, and it covers at most `FULL_PAGE_MAX` (20000) CSS px of the page.
  Each strip takes about 0.55 s (captureVisibleTab allows about 2 a second).
  The page scrolls in its window for that time, then goes back to where it was.
  `worker._screenshot` and `_Kept.screenshot` take the whole page for a plain
  page. A CDP page keeps its old screenshot.
- **Page HTML in a Record.** A plain page's Record has `page.html`
  (`Filled.html`, from `PortPage.record_html()`). It has each field's value as
  the page shows it, but no scripts, no Apply note and no password value. It
  has a `<base>`, so it opens with its styles. `records.record_files` replaces
  each secret question's answer with REDACTED. A CDP page's Record has no
  `page.html`: `worker.page_html` gives "" for it.
- **Fixed page functions.** On a plain page, `evaluate(code)` needs eval. A
  page whose CSP forbids eval refuses it in Chrome for Testing, where
  Allow User Scripts can't be turned on. So the page functions that the held
  page runs on each turn are fixed extension code: `on_page.FIELD` (Go to
  question and the Watch), `stuck.FIELD_ERROR` (Resume), and
  `email_code.WORDS`, `ARM` and `DISARM`. `apply.plain.fixed` lists them.
  `apply plain prepare` writes them into `vendor/fixed.js` from these same
  strings. `PortPage.evaluate` and `Locator.evaluate` run the fixed copy when
  they get one of these strings (the `fixed.call` op). Thus `on_page`,
  `stuck` and `email_code` don't change, and one source serves both kinds of
  Worker. To run new page code on each turn of a held plain page, add its
  string to `apply.plain.fixed`. Do not use eval for it.
- **Focus.** Go to question focuses the field. The Worker's window is behind
  Lisul's apps, so `:focus` doesn't match. `document.activeElement` is set,
  and that is what the Watch reads.
- The window's own field-error read (`CdpFrames._read_errors`) needs CDP.
  For a plain Worker, the window reads `stuck.field_error(page)` over the
  port, from its own thread (S3's frames).

`tests/test_plain_records.py` proves all of it on a page whose CSP forbids
eval. It includes a held rehearsal in a plain Worker: the fill pauses, Lisul
presses Resume, he uses Go to question, and his answer typed on the page is
taken. The Record has a full-page `form.png` and `page.html`. Until S4
(KAN-610) puts the submit guard on PortPage, that test turns the guard off.

## Plain Workers: Workday's accounts (KAN-613)

What Workday's Create Account, Sign In and steps need from a plain Worker's
page (`docs/plain-workers/PROTOCOL.md`, S7):

- **Frame locators.** `frame_locator` and `Locator.content_frame` work on a
  plain page, also for a frame on another origin.
- **Locator handlers.** `add_locator_handler` clears an overlay before each
  action and before each retry, as Playwright's does.
- **Requests and responses.** `page.on("request" | "response" | ...)` works.
  A response's body is read only for a fetch or XHR call that isn't a GET.
  That covers Workday's Create Account answer, which is how
  `exists_quietly` and `hides_errors` refusals are read.
- **Blocked pop-ups.** A synthetic click gives no user activation, so Chrome
  blocks the page's `window.open`. The extension then opens that URL in a new
  tab, with the page as its opener, and `page.on("popup")` fires.
- **Navigation mid-call.** A page call whose document goes away (Workday's
  Save and Continue inside `engine.call next`) fails as `Navigated` rather
  than hanging, and `fill_engine.call` retries it.

`tests/plain_fakes.py` runs a fake site's handler from an HTTPS server on
127.0.0.1 and points every host there with test-only Chrome for Testing
switches (`PlainWorkers(test_flags=...)`, refused for branded Chrome). Pages
keep their real URLs. One server and one Worker serve the whole test run.
Each fake opens a new tab. `FakeWorkdayServer(plain=True)`, the default when
`APPLY_TEST_PLAIN` is set, runs the Workday tests on that Worker:
`APPLY_TEST_PLAIN=1 uv run pytest tests/test_workday_filler.py -k ...`.
`tests/test_plain_accounts.py` covers the four S7 features.

## Plain Workers in runs and rehearsals: `worker_mode` (KAN-614)

`policies.yaml: worker_mode` picks the Worker each form opens in (`apply.plain.site.live_site`):

- `cdp` (the default): CDP Workers, as before.
- `plain`: every form on a plain Worker (`PlainSite`). `apply rehearse` and `apply run` use it.
- `protected`: plain only for `plain_worker_hosts` (jobs.lever.co, smartrecruiters.com,
  apply.workable.com, and their subdomains) and the hosts in `APPLY_HOME/plain-hosts.json`, which
  `captcha.blocked` writes. A block itself is always handed off to the student. The other forms use
  CDP Workers (`RoutedSite`).

What changes on a plain Worker:

- **One Chrome per Worker, reused.** It starts on its Worker's first form and stays up for the next.
  Each reuse calls `guards.reset(worker)` and closes the last form's tabs. After each form, one blank
  tab stays, so the window stays. The run or rehearsal stops each Chrome by its PID as it ends
  (`cli._close_workers`, before the rehearsal's `os._exit`).
- **The tile** uses `PortFrames`, which reads the field error for the stuck detector over the port
  (`stuck.field_error(page)`) on the window's own thread.
- **Go to question never raises a plain Worker** (`Dashboard(quiet=site.plain)`). It scrolls and
  focuses the field, and the tile shows it. Only Lisul's own Show brings the window forward.
- **Claude fill and Rescue** run on a plain Worker as on a CDP one: `claude_cli.drive` gives Claude
  Apply's own MCP server (S6, KAN-612) when the page is a PortPage, so a run or rehearsal in `plain`
  or `protected` mode needs no other wiring.
- **The production seed.** `uv run apply plain seed` opens branded Chrome on `APPLY_PROFILES/plain-seed`
  and prints Lisul's steps: Developer mode, Remove an old card, Load unpacked with the profiles
  folder's own copy of the extension (`APPLY_PROFILES/worker-extension`, next section), Details,
  Allow User Scripts, then quit (`launcher.seed_steps`). `plain_chrome: chrome` (the
  default) then copies that seed to each Worker. `plain_chrome: testing` (Chrome for Testing) needs no
  seed, but Allow User Scripts can't be turned on there.
- **Held Submit and the already-applied note** (KAN-629, KAN-621) work on plain pages:
  `submit_guard.lift(held=, dismiss=)`, `renote(held=)`, `warn_applied` and `applied_dismissed`
  hand over to `apply.plain.guards` (`guard.lift`'s `held` and `onlyLifted`, `guard.applied`). A
  `renote` of a page still guarded leaves it guarded.
- Tests: `tests/test_plain_routing.py`. Its live test rehearses the fake Greenhouse form twice in
  one reused plain Worker. `tests/test_plain_guards.py -k "held_submit or already_applied"`.

## One sign-in per job site: `apply rehearse --into` (KAN-645)

Job sites keep their sign-in only for the browser's session. A new Worker Chrome signs in again,
and a restart signs Lisul out. So **agents send each next posting into the running Worker that is
signed in to its site, never into a new rehearsal**:

```
uv run apply rehearse <first link>               # starts the window and its plain Worker
uv run apply rehearse --into 54321 <next link>   # the window's port: Browser 1
uv run apply rehearse --into 54321:2 <link>      # Browser 2 of that window
uv run apply rehearse --into <application id> <link>  # the Worker that fills that Application
```

- `apply.into` finds the window by the notes in `APPLY_PROFILES/windows/` (`ask.register`, 0600)
  and POSTs `/rehearse {url, worker?, application?}` with its `X-Apply-Token`. It then waits for
  the new tile to stop filling and prints how it stopped. Ctrl-C stops the wait, not the fill.
- The rehearsal (`rehearsal.rehearse`'s `into`, via `Dashboard.taking`) fills it in that Worker's
  running Chrome, in a tab of its own, with its own tile (`Dashboard.add_tile`: the tile shows
  that Worker's window), its own Record and the same guards. It never submits. A run's window
  takes it as a Request for that Worker, once that Worker is free.
- A form still open in the Worker (held, paused or filling) keeps its tab: no guard reset, no
  reload, no close (`PlainSite.open`). Only blank tabs go. Only a plain Worker that is running
  takes a link (409 otherwise): CDP Workers start a new browser per form.
- Before each posting, `fill_engine.fresh()` restarts the long-lived Node if the bundle on disk
  changed, and `PlainWorkers.refresh` writes a new vendor set (`vendor.use`) and reloads the
  Worker's extension when its code changed and no other form is open in it. So a merged engine
  fix needs no Chrome restart.
- Tests: `tests/test_into.py` (in CI). The live check is in the PR: one rehearsal, a second
  posting sent in, one Chrome PID, the job site's session cookie on the second form's requests.

## The worker extension's copy and vendor sets (KAN-645)

Chrome restarts an MV3 service worker from disk. A Worker that loads a shared checkout (the
old seed loaded `wt/sync`) runs whatever that folder holds after a pull, and a guard file that
differs from its Apply's crashed the page guard. So:

- **Each profiles folder has its own copy**, `APPLY_PROFILES/worker-extension/`
  (`extension.install`, with `.apply-code`, the code's hash). Chrome for Testing's
  `--load-extension` and the seed's Load unpacked name it. Apply replaces it only while none of
  that folder's Workers runs (`PlainWorkers.idle`; one Apply process drives a profiles folder,
  KAN-634), whole, by a rename. A `git pull` in any checkout never reaches a running Worker.
- **Generated files are write-once sets**: `vendor/sets/<id>/` (`extension.vendor_set`; the
  engine bundle, injected script, fixed functions and guards, `<id>` a hash of their bytes). The
  welcome names this Apply's set (`vendor`); the extension reads every generated file from it
  (`ops/shared.js: vendor`). A set is never changed, so Workers of another Apply on the same
  folder keep theirs. Sets unused for 7 days go.
- A reload keeps the guards (KAN-657). `extension.reload`, by `bridge.reload` or at hello, writes the
  registered scripts, session rules, lifts, held notes and bindings to `chrome.storage.local` first, and the
  code that starts next puts them back and a new relay in each open document. A held page's Submit stays
  blocked. A document that loads in the moment between the two has only what Chrome keeps: none of it.
- An older Worker on a shared folder: the bridge reloads it at hello when it can (KAN-643),
  before any engine check. If it still reads no sets and its guard files are another Apply's,
  `launch` stops it with `launcher.OutOfDate` (a SetupError: the rehearsal's line says how to fix
  it), never a crash. Its refusal for another engine names the folder to update.
- Rolling it out: no running Worker is touched. When no plain Worker runs, `uv run apply plain
  seed` once, and Load unpacked the copy it names. New Worker profiles copy that seed; an
  existing idle `plain-<k>` profile keeps its old registration until it is deleted.

## The data folder (`APPLY_HOME`)

**Personal data is never in the repo.** WorkIt is a public repo. All of a
person's data is in one folder, `APPLY_HOME` (default `~/.config/apply/`):

- the applicant profile, answer bank, story bank, voice and story map;
- the company briefs and stock answers;
- a `policies.yaml` that overrides `policies.default.yaml` key by key.
- the WorkIt login (`workit-login.json`), after `apply login`.
- Apply's Tracker (`tracker.json`) and the writes that wait for WorkIt
  (`workit-queue.json`).
- the tailored resumes that Apply gave to forms (`tailored/`, KAN-547).

Apply also writes its output there: rehearsal records, Repairs, Traces and
the Chrome worker profiles (`APPLY_PROFILES`, under `APPLY_HOME` by
default). `src/apply/home.py` derives every data path from `APPLY_HOME`.

The repo holds only generic inputs: the answering guides (`answering/`),
`policies.default.yaml` (with `live_runs` off) and the profile template.
When `APPLY_HOME` has no profile, Apply copies the Test Person sample data
into it and the window shows "Sample data".

- Never commit a data file. `.gitignore` here lists each data file name.
- For a test run, set `APPLY_HOME` and `APPLY_PROFILES` to a scratch folder,
  so the run does not write into your real data folder.

## Testing

- **Never run the full test suite (`uv run pytest` over all of `tests/`)
  for a small change.** It takes more than 20 minutes. Run it only for a
  major change that touches many modules, and say why.
- Run only the tests that the change touches, with `-k`. For example,
  `tests/test_workday_filler.py` alone takes about 5 minutes; do not run
  the whole file again after each small fix.
- Run `uv run ruff check .` here before you commit. It uses the backend's
  ruff config. `pyproject.toml` lists the findings that Apply keeps on
  purpose, each with its reason.
- CI (the `apply` job in `../.github/workflows/ci.yml`) runs ruff and only
  a fixed list of fast test files: the files that need no browser, no
  network and no `claude` CLI. When you add a test file that needs none of
  them, add it to that list. CI never runs the Filler tests
  (`test_*_filler.py`, `test_claude_fill.py` and the other files that open
  Chromium). Run the ones that your change touches on your Mac, with `-k`.
- **Prove a fix on the real form.** Rehearse the job posting that showed the
  bug (`uv run apply rehearse <url>`) and read its record. A rehearsal never
  submits. A unit test that passes is not the check that matters; the live
  form is.
- **Never press Submit** on a form, and never turn on `live_runs` for a
  test. A rehearsal leaves the browser open on the last page; leave it
  there.
- **Never press a button after an Emailed code.** On a page held for Lisul,
  `email_code.py` types the code that a job system emails after his own
  Submit, and nothing more (`test_email_code.py` checks that it has no click
  or key press). Test it on the fakes only: never press Submit on a real
  posting to make a code come. Two held pages whose lookups overlap on the
  same senders type neither code (`_join`, `CROSSED`): Greenhouse mails
  every company's code from one sender, and the newest mail after each press
  could be the other page's.
- Kill only the processes you started, by PID. Other people's rehearsals
  can run on the same Mac.

## Repairs

A Repair is Claude's fix to Apply's own code for a fill bug (`GLOSSARY.md`,
`docs/adr/0002`). Repairs are off: `policies.default.yaml` sets
`repair.max_per_day: 0`. When you turn them on in your data folder, a Repair
merges into the branch Apply runs from (or `repair.branch`) and pushes to
this checkout's `origin`, the WorkIt repo. It also moves the engine pointer
`autofiller_extension/fill-engine` on that branch, which is the extension's
pointer too. A Repair never runs on `main` (`repair_waiting` refuses it):
its pushes would move fill-engine's `main` and WorkIt's `main` to code
Claude wrote, and only WorkIt's `main` is protected.

## The privacy gate

`scripts/privacy_gate.py` scans the files for personal data (phone numbers,
email addresses, street addresses, student IDs, links to private repos) and
for secrets (API keys, GitHub and Slack tokens, private keys, cookies).
The identifiers it looks for come from a local file outside the repo
(`private-identifiers.txt`), never from the repo.

Run it before you push any file that you copied from a personal checkout.
If it finds something, remove it; do not push and fix later. A pushed file
stays in the public history.

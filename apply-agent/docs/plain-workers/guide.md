# Plain Workers in Apply

Reference for Apply, reached from `apply-agent/CLAUDE.md`. Paths are relative to `apply-agent/`. A change in this area updates this file in the same PR.

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
- **Only its own window and tab (KAN-717).** A tile shows its own Worker's
  window only. A Connection whose Chrome (the host's parent) isn't the one that
  has Worker k's profile open (`chrome_pid`), or whose Chrome PID can't be told,
  shows nothing on tile k and takes none of its input; it is looked at again each
  turn. The helper films a window of that PID only while macOS lists exactly one
  of its windows with the shown tab's title (`tile.shown`'s `title`;
  `window_capture.title_matches`). A page sets its own title, so the rule is
  strict: Chrome's " - Google Chrome" suffix only at the end, and a title cut
  with a middle "…" must keep 8 characters of each end. With no such window, or
  two, it says `mismatch`, sends nothing, and the tile takes the extension's
  frames. Each tile also shows its own form's tab: `--into` tiles share one
  Worker, so `Dashboard.showing(tile, tab)` makes `PortFrames` give that tile only
  the frames that showed its tab, and send its clicks, keys and files there.
  `PlainSite.open` tells the tab as soon as it exists, before its first load
  (`site.telling`, from the rehearsal's `_Kept.open`). Until then, a tile that
  shares its Worker shows nothing and takes no input (`Dashboard.blind`). A file
  request is kept by the tab that asked, so a file picked on one tile never
  reaches another form. A form's own pop-ups and the tabs its page opens (their
  `tab.created` opener, or `popup.blocked`) show on its tile too: it shows and
  presses whichever of them showed last, and goes back when one closes. A tile
  whose tab isn't the window's active one keeps its last frame of that tab.
  Filmed frames within `SETTLE` (0.25 s) of a tab switch go to neither tab.
  Tests: `tests/test_plain_tile_identity.py` (two fake Workers) and
  `tests/test_review_kan717_hostile.py` (forged presses, loading tiles, files,
  titles, unknown PIDs, pop-ups).
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
  Nor does the page hear any focus events: `focus()`, `blur()`, a Tab or a
  click elsewhere fire no `blur` or `focusout`. Workday's text boxes keep a
  value only as they are left (React's onBlur), so each focus move the
  extension makes (page/dom.js `leaving`, also the tile's presses) and the
  Fill engine's `leave` tell the box left by hand when it went unheard
  (KAN-709, `tests/test_plain_focus.py`).
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
- **An engine call has 60 s** (`bridge.CALL_TIMEOUT`). The engine's Workday `fill` ends inside it: past
  45 s, the field still going fails as a FillError that names it (KAN-702). A field whose call still
  times out (`PortTimeoutError`) goes to the Rescue, as a FillError does
  (`WorkdayFiller._put_or_rescue`). Without a Rescue, it becomes a FillError naming the field, which a
  rehearsal skips.
- **The production seed.** `uv run apply plain seed` is a guided setup of `APPLY_PROFILES/plain-seed`
  (`apply.plain.seed_setup`, KAN-677). `plain_chrome: chrome` (the default) then copies that seed to each
  Worker. `plain_chrome: testing` (Chrome for Testing) needs no seed, but Allow User Scripts can't be turned
  on there. See "The seed's guided setup" below.
- **`apply doctor`** checks the Workers `worker_mode` runs: the CDP Worker profiles for `cdp`, the
  "Plain seed" line for `plain` (the seed exists, Load unpacked registered the worker extension in it,
  and Developer mode is on), and both for `protected`. With `plain_chrome: testing` the seed line is ok.
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
  seed` once: it shows the copy to load and checks it. New Worker profiles copy that seed; an
  existing idle `plain-<k>` profile keeps its old registration until it is deleted.

## The seed's guided setup: `apply plain seed` (KAN-677)

Branded Chrome takes the worker extension only by the user's own clicks. `apply.plain.seed_setup.Wizard`
helps with each click and confirms it. It refuses to start while a plain Worker of the folder runs.

- **What Apply does.** It opens branded Chrome on the seed at `chrome://extensions`. At Load unpacked it
  puts the copy's path on the clipboard (`pbcopy`) and shows the copy in Finder (`open -R`), so the user
  can drag it onto the page or paste it in the picker. At Allow User Scripts it opens
  `chrome://extensions/?id=<EXTENSION_ID>`, where the switch is.
- **What Apply never does.** It never clicks a `chrome://` page, never changes a Chrome setting and never
  writes the seed's preference files. Those clicks are the user's. It only launches Chrome with normal
  switches and reads files.
- **How it sees each step.** It reads `Default/Secure Preferences` (then `Preferences`) once a second
  (`read_state`): `extensions.ui.developer_mode`, `extensions.settings.<id>.path`, its `disable_reasons`
  and `user_scripts_enabled`. Chrome writes a click to disk about 10 s after it (measured on Chrome for
  Testing 157). `first_problem` gives the first step not saved, with one message for each problem: no
  extension, wrong folder (names both folders: Remove that card), card turned off, user scripts off.
  A step that is saved and then goes back says "did not stick". A step still unsaved after 45 s gets a
  nudge, and the path goes on the clipboard again.
- **Quit.** When all steps show, Apply quits the seed's Chrome itself, with SIGTERM to the PID that holds
  the seed's SingletonLock (checked with `ps`: its command line names the seed). A SIGTERM saves pending
  changes; a SIGKILL loses them (measured on both Chromes), so Apply never kills it. If Chrome is still up
  after 15 s (a dialog or the folder picker open), Apply says so and waits. Ctrl-C quits it the same way.
  After the quit, Apply reads the files again. A step that a clean exit didn't save is named and shown again.
- **Done only after a real hello.** Apply starts one Worker from the seed on a new `plain-<k>` profile (so an
  old Worker profile can't answer for the seed) and needs its hello with `userScripts: true`. Then that
  profile goes. No hello, a refused hello or user scripts off is not done: Apply opens the Details page
  and asks the user to press Return to try again.
- **Old Worker profiles** keep their own registration. The wizard lists them; delete them to copy the seed again.
- Tests: `tests/test_plain_seed_setup.py` (in CI), with fixture preference files and a fake Chrome and Worker.
  A live run with Chrome for Testing on a scratch `APPLY_PROFILES` needs a stand-in for the user's clicks,
  since the wizard makes none. Branded Chrome needs a person for the three clicks and the folder picker.

# Apply's Workers as plain Chromes driven through the extension

**Status (2026-11-05):** Plain Workers are built, and `worker_mode` selects them. The source for the current protocol is [`../plain-workers/PROTOCOL.md`](../plain-workers/PROTOCOL.md). This note holds the design reasons and the S0 evidence. Its build plan is history.

Design, build plan and S0 spike results, 2026-11-04. Code read at WorkIt `origin/main` 0fd4d8b5 (fill-engine 5156f46). The S0 spike code was throwaway and is in no repo.

**Superseded.** The first draft of this note ran Apply's fill in the user's own everyday Chrome. The user rejected it because it lost live tiles, fixing from the window, unattended live submit, parallel background Workers, full-page screenshots, Claude fill and Rescue. This version keeps all of them.

## What a plain Worker is

A Worker is a normal Chrome with its own profile, started as a plain process. No CDP client connects to it. The WorkIt extension in that profile does the work through the ordinary extension APIs.

## Architecture

```
Apply process ──────────────── Unix socket (APPLY_HOME/workers.sock, 0600) ─────────────┐
  Worker loop, Fillers, Claude,                                                          │
  window, Records (unchanged)                                                            │
  PortPage: a Playwright-shaped page over the port                                       │
                                                                                         │
Worker k = a plain Chrome process (Apply starts it, kills it by PID)                     │
  --user-data-dir=APPLY_PROFILES/worker-k  --no-first-run --no-default-browser-check     │
  --disable-backgrounding-occluded-windows  --hide-crash-restore-bubble                  │
  profile: WorkIt extension (Apply-worker mode) + NativeMessagingHosts/ (in the profile) │
     service worker ── connectNative ──> host relay (Chrome starts it) ──────────────────┘
     executes ops: chrome.scripting / chrome.userScripts / tabs / webNavigation /
                   declarativeNetRequest / captureVisibleTab
```

- **One Chrome per Worker, as today.** Each has its own profile under `APPLY_PROFILES` and its own window, and they run in parallel. Apply starts the binary itself (`subprocess.Popen`), not through Playwright, and stops it by PID.
- **The host lives in the Worker's profile.** The spike confirmed that Chrome reads `NativeMessagingHosts/` inside a custom `--user-data-dir`. The host's manifest names only the extension's ID. The user's own Chrome folder is never touched.
- **One long-lived port per Worker.** The extension connects on start-up, and the open port keeps the MV3 service worker alive. The spike's worker stayed up through runs of several minutes with its port open. The relay tags each message with the Worker number, and Apply multiplexes over a socket readable only by the user.
- **PortPage is the seam.** Every Filler, the Worker loop, the guards, Claude fill and the window talk to a Playwright `Page` today. PortPage implements the part of the sync Playwright API that Apply uses (inventory below) as port ops. Most Fillers then run unchanged.
- **Arbitrary page JS (`page.evaluate(str)`, `add_init_script`)** goes through `chrome.userScripts`. `execute()` runs a code string in the MAIN world, `register()` runs one at `document_start` in every frame, and page CSP doesn't apply. This is the MV3 API built for exactly this. It needs the per-extension **Allow User Scripts** toggle, a one-time click in the seed profile (spike: `chrome.userScripts` is undefined until it's on). Locators use **Playwright's own injected selector engine** (playwright-core's `injectedScriptSource`, Apache-2.0), loaded the same way. `get_by_role`, `get_by_text`, `get_by_label` and `ariaSnapshot` then behave as they do today.
- **The extension.** It is the WorkIt extension's dev build (the same ID, from `manifest.json`'s `key`) with an Apply-worker mode. That mode turns on only when its host answers, and its extra permissions (`userScripts`, `<all_urls>`, `webNavigation`, `declarativeNetRequestWithHostAccess`) are optional permissions granted once in the seed profile. The Store build that students get doesn't change. See open question 3.

### Getting the extension into a Worker profile (S0 finding)

- **Branded Google Chrome 157 ignores `--load-extension`.** The spike tried it alone and with `--disable-features=DisableLoadExtensionCommandLineSwitch`. The extension never started, and the profile's `extensions.settings` stayed empty. Google removed the switch from branded builds in Chrome 137.
- **Chrome for Testing 156** (the build Playwright installs) still loads it. The spike ran there: both extensions loaded (`installType: development`).
- Two options:
  - **A. Branded Chrome with a seed profile (recommended).** Once, the user installs the extension in `worker-seed` (Load unpacked, or the Web Store once it's listed), grants its optional permissions and turns on Allow User Scripts. Apply copies the seed to each Worker profile (`WorkerBrowsers.share` already copies profiles). The browser is then the same branded Chrome the Workers use today. **Not yet checked:** that a copied branded profile keeps the extension and the toggle. That is S0b's first check.
  - **B. Chrome for Testing.** It needs no manual step, but it is not the browser the Workers use today. Use it only if A fails.
- Rejected: enterprise policy (`ExtensionInstallForcelist`), because it would apply to the user's own Chrome too. Rejected: writing `Secure Preferences` by hand, which is tampering.

## S0 results (live, 2026-11-04, made-up identity "Testy McTestface", nothing submitted)

Run on Chrome for Testing 156 as a plain process, with no CDP, a temp profile, the WorkIt extension plus a throwaway spike extension, and a results server on 127.0.0.1. Fills came from `chrome.scripting.executeScript` in the MAIN world, the way the engine runs.

| Check | Result |
|---|---|
| **Workable** (one public `/apply` form) | Filled first name, last name, email, phone and city, and the page showed each value. The résumé upload wasn't exercised (the spike's matcher didn't find Workable's input), so S0b redoes it with the engine. |
| **SmartRecruiters** (one public `?oga=true` form) | Filled 7 fields through the shadow roots (name, email, confirm email, city, phone, LinkedIn). |
| **Lever** (one public `/apply` form) | Filled name, email, phone, location and LinkedIn. |
| Synthetic DOM actions (for Fix from the window) | Untrusted click on a checkbox → checked. Select change → shown. Per-key typing into a React field → "Acme" shown. `button.click()` on Lever's cookie Deny → banner gone (the page saw `isTrusted: false` and still acted). |
| `captureVisibleTab`, window behind other apps, **no flag** | Returns a **stale** frame. The page was `visibilityState: hidden` with 0 animation frames, so the fields filled but the image showed them empty. SmartRecruiters' covered window failed with "image readback failed". Scroll-and-stitch gave 11 copies of one stale frame. |
| The same with **`--disable-backgrounding-occluded-windows`** | **Live frames.** The page stays `visible` with about 31 animation frames in 1.5 s, and covered (occluded) captures show the newest marker, the typed text and the dismissed banner. |
| Minimized window | `hidden`, and `captureVisibleTab` never answered (8 s timeout). **Never minimize a Worker.** |
| Off-screen window | `chrome.windows.update` refuses it: "Bounds must be at least 50% within visible screen space". Workers sit on-screen, behind the user's apps. |
| `captureVisibleTab` rate | One call, then "exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota" for the next 5 within about 0.1 s. **About 2 frames a second per Worker browser.** Each Worker is its own browser, so each has its own quota. |
| `tabCapture.getMediaStreamId` (30 fps video) | Refused: "Extension has not been invoked for the current page (see activeTab permission)". It needs a user gesture in that tab, so it **can't be used unattended**. |
| Full-page screenshot by scroll and stitch (flag on) | Correct: 7145 CSS px page, 11 strips about 0.6 s apart (rate limit), stitched to 2000 x 14290 in an `OffscreenCanvas`. Flaw: Lever's sticky header repeats in each strip, so fixed and sticky elements must be hidden after the first strip. |
| Native messaging from a custom profile | Works: `{"echo": {"ping": 1}, "argv": ["chrome-extension://<id>/"]}`. |
| `chrome.userScripts` | Undefined until the user toggles Allow User Scripts (expected). It must be turned on once in the seed profile. |

## Feature by feature: kept, and how

| Feature today | Kept? | How, on a plain Worker |
|---|---|---|
| Parallel background Workers | **Kept** | N plain Chromes, each with its own profile and window, behind the user's apps on-screen. `--disable-backgrounding-occluded-windows` keeps them painting and their timers unthrottled (S0). `FocusKeeper` already hands focus back when a Chrome comes forward. Workers are real windows, not headless. |
| Live tile | **Kept, at about 2 fps** | Change-driven `captureVisibleTab`. A content script marks the tab dirty on DOM mutations, scroll and input, and the service worker captures at most every 500 ms (the quota) and sends JPEGs up the port to `CdpFrames`' replacement. Measured: live frames from covered windows with the flag. **Lower frame rate than the CDP screencast.** `tabCapture`, which would give 30 fps, needs a gesture in each tab (S0). Within extension APIs, about 2 fps is the ceiling. Outside them, macOS ScreenCaptureKit can capture a covered window by ID at full rate, with the Screen Recording permission (open question 2). |
| Fix it from the window (click, wheel, keys, paste, select, file) | **Kept** | Tile events go up the port, and the content script maps (x, y) through the tile's scale and `devicePixelRatio`. Clicks use `elementFromPoint` plus pointerdown, mousedown, pointerup, mouseup and click. Keys use `KeyboardEvent` with the native value setter (the engine's `typeKeys`). A paste uses `execCommand("insertText")`, and the wheel uses `scrollBy`. Cmd+A uses `select()`. Copy uses `getSelection()`. The tile already draws its own `<select>` menu (`PRESSED_SELECT`, `CHOOSE`), which works the same way. A file goes through the tile's file flow to `DataTransfer` on the input under the press, because an untrusted click opens no picker. S0 showed checkbox, select, typing and button clicks taking effect. |
| Unattended live submit | **Kept, not yet proven live** | `filler.submit(page)` runs unchanged on PortPage, and its click is a synthetic click on the submit button. Rehearsals never call it, and the guards block it anyway (next rows). Its first proof is a real application the user chooses (S0b-4). A spike must not submit. |
| Captcha wait (ntfy, the user solves, Apply resumes) | **Kept** | `captcha.Waiter` is unchanged. `captcha.shows` and `blocks` run through PortPage. The user presses Show, and `KEEPER.bring(pid)` brings that Worker's Chrome forward. The user solves it with their real mouse, which is trusted input. Apply goes on when the challenge frame is gone, or when the user presses Resume. |
| Rehearsal never submits (submit guard) | **Kept** | The guard's JS (`submit_guard.SCRIPT`) is registered as a `document_start` user script in the MAIN world in all frames, the same code as `add_init_script` today. The Playwright route that aborts submit requests becomes a `declarativeNetRequest` session rule on that `tabId`, which blocks before page code and also covers Workers' requests. `expose_binding` (the user pressed Submit, Fill again) becomes `postMessage` to the content script and then up the port. `lift` and `rearm` swap the registered scripts and rules. |
| Drive guard (Claude fill, Rescue) | **Kept** | The same mechanism with the drive guard's script. |
| Full-page screenshots | **Kept** | Scroll and stitch (S0), with fixed and sticky elements hidden after the first strip. It costs about 0.55 s per viewport height. `_screenshot`'s 15 s timeout grows with page height. |
| Claude fill | **Kept** | Apply runs its own MCP server (stdio, started by `claude -p`) with **the same server name and tool names as Playwright MCP** (`browser_snapshot`, `browser_click`, `browser_type`, `browser_fill_form`, `browser_select_option`, `browser_file_upload`, `browser_press_key`, `browser_hover`, `browser_wait_for`, `browser_handle_dialog`, `browser_navigate`, `browser_navigate_back`, `browser_tabs`). Each tool calls PortPage. The snapshot is Playwright's own `ariaSnapshot` with refs from the injected script, so Claude sees the same format. `claude_cli.BROWSER_TOOLS`, `NO_BROWSER_TOOLS` and the `send_click` hook (`mcp__playwright__browser_click`) don't change. Haiku chooses and the extension executes. |
| Rescue | **Kept** | The same MCP server, scoped to one field, under the drive guard. |
| Fillers' plain-code steps (Workday sign-in, Create Account, Save and Continue, Oracle, account pages, Greenhouse security code, Workable's fresh form) | **Kept** | They run on PortPage unchanged. Their `click`, `fill` and `press` become synthetic DOM actions (inventory below). |
| Engine fills, read-back, replan, MoreQuestions, Verify, Pre-submit review, essays | **Kept** | `fill_engine.call` is `page.evaluate` of `FillEngine.call(...)`. On PortPage that runs through `userScripts.execute`, which loads the engine bundle once per page as today. The engine's events were already synthetic in the Worker. |
| File uploads (résumé, transcript, letter) | **Kept** | The engine's `DataTransfer` path, the same as today. Bytes go down the port in 512 KB chunks, since messages from the host to Chrome are capped at 1 MB. `set_input_files` (`attach.py`, Claude fill) uses the same `DataTransfer`. |
| Records (Filled, Readback, Verification, after-submit, Pauses, Trace) | **Kept** | The same writers, with screenshots from the stitch. Sent files stay under `sent/`. |
| Needs you card, answer → filled on the page | **Kept** | `_fill_answer`'s Rescue runs on the MCP above. |
| Resume (pause, stuck watch, field errors) | **Kept** | `stuck.FIELD_ERROR` runs through `userScripts.execute` every 2 s over the port, in place of the window's own CDP connection. The window no longer needs one: the port is independent of the Worker thread, as `CdpFrames` is today. |
| Go to question | **Kept** | `locator.scroll_into_view_if_needed()` plus focus, through PortPage. Then Show if the user wants the window. |
| Regenerate with context (planned) | **Kept** | Apply-side `essays.answer` with their context, then the engine fills that field, then read-back and `verify.check`. |
| Emailed code after the user's Submit (`email_code.py`) | **Kept** | It types through PortPage `fill`. It still has no click and no key press. |
| Workday tenants' trees, Keychain accounts, Gmail codes | **Kept** | Apply-side. |
| `apply login` (WorkIt session through its own Chrome) and the Apply window's own Chrome | **Unchanged** | These aren't Workers and never open a job site. They can keep their DevTools port. |

### What can't be kept exactly, with the evidence

1. **Tile frame rate.** The tile drops from the CDP screencast to about 2 fps, because Chrome caps `captureVisibleTab` per extension (measured: the second call within a second is refused). The only faster extension API, `tabCapture`, needs a user gesture in each tab (measured refusal). The tile is still live and still fixable, but not smooth. The full rate is available only outside extension APIs (ScreenCaptureKit, open question 2).
2. **Trusted input.** Playwright's clicks and keys today are CDP `Input.*` events, which pages see as `isTrusted: true`. An extension can only make untrusted events. S0 found no form that ignored them (Lever's cookie banner took one), but a widget that checks `isTrusted` would refuse it. A Filler step that fails this way becomes a FillError, then a Rescue, and then Needs you, so the user's real click on Show finishes it. No such site is known yet. S7's live rehearsals will show any.
3. **Native dialogs.** `alert`, `confirm` and `prompt` are handled by overrides registered at `document_start`, which record and answer them (`browser_handle_dialog` reads the record). **`beforeunload` dialogs can't be answered by an extension.** Today Playwright can. It matters only if a form blocks navigation away. The Worker can close the tab instead, which needs no dialog.
4. **Headless Workers.** These are gone. Workers are real windows on-screen, behind the user's apps. They show when the user clears the desktop. A separate macOS Space may hide them, but whether a window on another Space keeps painting with the flag is unchecked (S0b-3).

## Inventory: what Apply calls today, and its extension equivalent

Taken from a grep of `src/apply/*.py` for Page, Locator, Frame, Context and CDP calls. Counts are call sites.

| Today (Playwright / CDP) | Where | Extension equivalent |
|---|---|---|
| `launch_persistent_context(..., --remote-debugging-port=0)` | browsers.py | `subprocess.Popen` of Chrome with `--user-data-dir`, no debugging port, then a hello over the port |
| `connect_over_cdp`, `new_cdp_session`, `Page.startScreencast` / `screencastFrameAck` | dashboard.py `CdpFrames` | Frames from `captureVisibleTab` over the port (about 2 fps) |
| `Page.setInterceptFileChooserDialog`, `Page.fileChooserOpened`, `DOM.setFileInputFiles` | dashboard.py | A `document_start` user script hooks file inputs' `click` and `showPicker` and reports the chooser up the port. Files are attached by `DataTransfer` on that input. |
| `expect_file_chooser`, `set_input_files` (4) | attach.py | The same hook plus `DataTransfer` |
| `mouse.move/down/up/wheel`, `keyboard.type/press/insert_text` (6) | dashboard.py `_dispatch` | Synthetic events at `elementFromPoint`, `scrollBy`, and `execCommand("insertText")` |
| `locator` (55), `get_by_role` (21), `get_by_text` (6), `get_by_label` (1), `closest`, `eval_on_selector_all` | all Fillers | Playwright's injected selector engine through `userScripts`. A locator is a selector string resolved in the page on each call, as Playwright resolves it. |
| `click` / `fill` / `press` / `type` / `is_visible` / `is_checked` / `input_value` / `wait_for` | Fillers | Injected script: actionability checks (visible, enabled, stable, hit target), then synthetic events. `fill` uses the native setter plus `input`. `press` uses `KeyboardEvent`, with the default action emulated for Enter (requestSubmit), Tab (next focus) and Escape. |
| `evaluate(str)` (27) | engine, stuck, guards, dashboard | `chrome.userScripts.execute({world: "MAIN", js: [{code}]})` |
| `add_init_script` (5) | submit_guard.py | `chrome.userScripts.register({runAt: "document_start", world: "MAIN", allFrames: true})` |
| `context.route` / `unroute` (submit abort) | submit_guard.py | `declarativeNetRequest.updateSessionRules`, a block rule on `tabIds: [tab]` |
| `expose_binding` (2) | submit_guard.py | `window.postMessage`, then the content script, then the port |
| `page.on("dialog" / "request" / ...)` (13) | various | Dialog overrides at `document_start`; `webRequest` (observe) for requests; `tabs.onCreated` for pop-ups |
| `add_locator_handler` (Workable's cookie banner) | workable.py | A MutationObserver user script that clicks the banner's Decline when it shows |
| `goto`, `reload`, `wait_for_load_state`, `wait_for_timeout`, `url`, `title`, `is_closed`, `close` | everywhere | `chrome.tabs.update/reload/get/remove` and `webNavigation.onCompleted`. The timeout is Apply-side. |
| `frames`, frame locators | captcha.py, embedded.py | `webNavigation.getAllFrames` plus `executeScript` / `userScripts` with `frameIds` (`<all_urls>` covers cross-origin frames) |
| `context.pages`, `new_page` | rehearsal.py, claude_fill | `chrome.tabs.query/create` in that Worker's window |
| `screenshot()` / `screenshot(full_page=True)` | worker.py, rehearsal.py | `captureVisibleTab`, or scroll and stitch |
| `cookies()` | workit.py (`apply login`, not a Worker) | Unchanged, or `chrome.cookies` |
| Playwright MCP over `--cdp-endpoint` | claude_cli.py | Apply's MCP server with the same tool names, over PortPage |

## Which postings run where

The build is staged. At first, plain Workers carry the hosts in `policies.yaml: plain_worker_hosts`, plus learned hosts in `APPLY_HOME/plain-hosts.json`. CDP Workers keep everything else until parity is proven (S8). After that, plain Workers carry everything and the CDP Worker code is deleted. Running one kind of Worker is simpler than two.

## Risks

- **No live submit yet.** The first real application through a plain Worker (S0b-4) is the first proof of the submit path.
- **`--disable-backgrounding-occluded-windows` is needed for painting.** It changes only Chrome's own power-saving. Playwright passes it too. The user should still decide (open question 1).
- **Keychain.** Without Playwright's `--use-mock-keychain`, a Worker uses the real macOS Keychain item for its browser. That is "Chrome Safe Storage" for branded Chrome, the item the user's Chrome already uses, so there should be no prompt. Chrome for Testing has its own item, which may prompt once. Password saving stays off through the profile's preferences (`credentials_enable_service: false`), keeping KAN-592's rule that Worker profiles hold no saved passwords.
- **Timing.**
  - Every Page call now goes through a native-messaging round trip plus `executeScript`, a few ms each. Playwright's auto-waits become polling in the injected script.
  - A long Filler step is unchanged.
  - A navigation mid-call is retried, as `fill_engine.NAVIGATED` does today.
- **Extension updates or a crashed service worker** close the port. Apply then treats the Worker as gone: the Handoff or pause path, the same as a quit browser today.
- **Store policy.** The Apply-worker mode runs code strings (`userScripts`). That is allowed for `userScripts`, but it stays out of the Store build students install (open question 3).

## Build plan: staged slices, each demoable

Every slice ends with a rehearsal on the fakes, and from S5 on also a real posting. Rehearsals never submit.

- **S0. Feasibility spike: done** (above).
- **S0b. The rest of the live checks** (spike, about half a day):
  1. A branded Chrome seed profile (the user installs the extension and toggles Allow User Scripts once) copied to `worker-1`: the extension and toggle stay.
  2. The Workable résumé upload through the engine in a plain Worker.
  3. With the flag, a Worker on another macOS Space keeps painting.
  4. **The first supervised live submit** through a plain Worker, on a posting the user chooses.
- **S1. Plain Worker launcher and bridge.** `browsers.PlainWorkers` (seed, copy, launch, kill by PID, on-screen placement, never minimized), the per-profile host relay, `workers.sock` and the hello. *Demo:* `uv run apply workers check` starts 3 plain Workers. Each reports the extension and engine version, then quits.
- **S2. PortPage core.** `goto`, `reload`, `evaluate` (userScripts), locators (Playwright's injected engine), `click`, `fill`, `press`, `is_visible`, `wait_for`, `screenshot`, and file chunks. *Demo:* a Greenhouse rehearsal on the fake Greenhouse in a plain Worker, Record written, nothing sent.
- **S3. Live tile and Fix from the window.** Change-driven capture at up to 2 fps into the tile, input replay, the tile's select menu and file flow. *Demo:* watch a plain Worker fill, then click and type a field from the tile.
- **S4. Guards and the held page.** The submit and drive guards as `document_start` user scripts, DNR per tab, `expose_binding` through postMessage, and `lift` / `rearm`. *Demo:* the submit-guard tests' fake forms in a plain Worker. Submit is blocked, then lifted, and their press is heard.
- **S5. Records, full page, Needs you, Resume, Go to question, emailed code.** *Demo:* rehearse a real Lever posting to its held page, with a full-page screenshot in the Record, and a Missing fact answered from the window landing on the page.
- **S6. Claude fill and Rescue** over Apply's MCP server, with the same tool names and an aria snapshot. *Demo:* a Claude fill rehearsal on a job system with no Filler, and a Workday Rescue on the fake Workday.
- **S7. Workday and account pages** on PortPage (sign-in, Create Account, Save and Continue, `/register` answer reading through `webRequest` or the page). *Demo:* the fake Workday walk to Review, then one live tenant rehearsal.
- **S8. Routing and the switch-over.** The hosts in `plain_worker_hosts` go to plain Workers, learned hosts follow, and the live submit path runs with captcha wait. Once S5 to S7 are rehearsed live, the default flips and CDP Workers are deleted. *Demo:* `apply run` with Lever, SmartRecruiters and Greenhouse postings, all filled in parallel plain Workers.
- **S9. Regenerate with context**, once the button exists.

**Tests.** The Filler tests open Chromium through Playwright today. A PortPage harness lets the same tests run against a plain Chrome for Testing with the extension loaded, which still accepts `--load-extension` and so suits tests. CI's no-browser list doesn't change.

## Decisions since this note

- `--disable-backgrounding-occluded-windows` is on.
- Plain Workers use their own private extension (`apply-agent/worker-extension`), not a mode of the WorkIt extension.
- Branded Chrome with a seed profile is the default (`plain_chrome: chrome`, `apply plain seed`).
- `worker_mode` stays `cdp` by default until plain Workers reach parity. The switch-over is still open.

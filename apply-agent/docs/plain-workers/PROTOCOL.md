# Plain Workers protocol (v1)

S1 (KAN-607) and S2 (KAN-608) own this; S3 to S7 build on it (S3, KAN-609: the tile ops). Spec: KAN-606. This file
is the source; change it in the PR that changes the protocol.

Hard rule: never evade bot detection. Nothing here hides automation; a plain
Worker simply has none (no CDP, no automation flags, no headless).

## Pieces

```
Apply process                                   Worker k (plain Chrome)
  apply.plain.bridge.Bridge  <── Unix socket ──  host relay  <── native messaging ──  worker extension
  (listens on APPLY_HOME/workers.sock, 0600)     (apply/plain/host.py,                (apply-agent/worker-extension/,
  apply.plain.page.PortPage                       Chrome starts it)                     background.js + ops/*.js)
  apply.plain.launcher.PlainWorkers
```

- **Extension:** `apply-agent/worker-extension/` in WorkIt. Private, never on the
  Store. Its ID is fixed by `manifest.json`'s `key`: `apply.plain.extension.EXTENSION_ID`.
  Generated files go in `worker-extension/vendor/` (gitignored), written by
  `apply plain prepare` (the launcher runs it before every launch):
  - `vendor/engine.js`: the Fill engine bundle, copied from the extension submodule's
    `fill-engine/dist/engine.js` (the same build the WorkIt extension uses).
  - `vendor/engine.json`: `{"version": "0.3.13+7a3a3fc", "sha256": "..."}`.
  - `vendor/injected.js`: Playwright's own injected script (playwright-core's
    `injectedScriptSource`, Apache-2.0, taken from the installed Python package's driver),
    wrapped so it sets `globalThis.__applyPW = new InjectedScript(...)` in the
    extension's isolated world.
- **Host:** `com.workit.apply_worker`. Its manifest is written into each Worker profile's
  own `NativeMessagingHosts/` folder (never Lisul's Chrome folder) and names only the
  worker extension's origin. Its `path` is a per-profile wrapper that runs
  `python3 -I apply/plain/host.py --socket <sock> --worker <k>`. The host is stdlib only.
- **Socket:** `APPLY_HOME/workers.sock`, mode 0600, in a folder only Lisul can read.
  macOS caps a socket path at 104 bytes; when the data folder's path is too long
  (test temp folders), the socket goes to `/tmp/apply-<uid>/<hash>.sock` (folder 0700).
  `Bridge.path` says which.

## Framing

Every message is one JSON object. Chrome ↔ host is Chrome's native messaging framing:
a 4-byte length in native byte order, then that many bytes of UTF-8 JSON. Host ↔ Apply
uses **the same framing** over the stream socket, so the host relays frames verbatim.

Limits: Chrome → host up to 64 MiB a message; **host → Chrome at most 1 MB**. So Apply
splits any message whose JSON is over 512 KiB into `chunk` messages (below); the
extension joins them before handling. The extension never needs to chunk.

## Connection

1. Apply's `Bridge` listens on the socket **before** it launches any Worker.
2. Chrome starts; the extension's service worker calls
   `chrome.runtime.connectNative("com.workit.apply_worker")` at start-up. Chrome starts the host.
   The open port keeps the MV3 service worker alive.
3. Host → Apply, first frame (written by the host itself):
   `{"type": "relay", "protocol": 1, "worker": k, "origin": "chrome-extension://<id>/", "host_pid": n}`
   (`worker` is 0-based everywhere, as `WorkerBrowsers.open(worker=0)`; Worker k's profile is `plain-<k+1>`.)
4. Extension → Apply:
   ```json
   {"type": "hello", "protocol": 1, "extension": "0.1.0",
    "engine": {"version": "0.3.13+7a3a3fc", "sha256": "..."},
    "userScripts": true, "webdriver": false,
    "userAgent": "...", "brands": ["Google Chrome", "..."]}
   ```
5. Apply → extension: `{"type": "welcome", "worker": k, "protocol": 1}`, or
   `{"type": "refuse", "reason": "..."}` and Apply closes the connection.
   Apply refuses: a wrong origin, another protocol, or an engine whose version or
   sha256 differs from Apply's own `fill_engine.ENGINE` (the reason names both and says
   to run `apply plain prepare`).
6. On a closed port the extension reconnects every 2 s (Apply restarted). Apply treats a
   Worker whose connection closed as gone (as a quit browser today).

## Messages after the welcome

Apply → extension:

| Message | Meaning |
|---|---|
| `{"type": "call", "id": n, "op": "<op>", "params": {...}}` | Run one op. `id` is unique per connection. |
| `{"type": "chunk", "id": n, "seq": i, "of": m, "data": "<text>"}` | Piece `i` (0-based) of `m` of one message's JSON text. Joined in order, then handled as that message. |

Extension → Apply:

| Message | Meaning |
|---|---|
| `{"type": "result", "id": n, "value": ...}` | The op's answer (any JSON). |
| `{"type": "error", "id": n, "error": {"name": "...", "message": "..."}}` | The op failed. |
| `{"type": "event", "event": "<name>", ...}` | Unasked news. Apply hands it to subscribers. |

Error names: `TimeoutError`, `Navigated` (the frame or tab went away mid-op: Apply retries
like `fill_engine.NAVIGATED`), `NoTab`, `NoFrame`, `NotFound`, `Strict` (strict-mode
violation: more than one element), `NotActionable` (hidden, disabled, covered; Apply's
auto-wait retries it), `EvalError` (the page's code threw), `UserScriptsOff`,
`BadOp`, `Crash`. On the Python side every error raises `apply.plain.page.PortError`,
a subclass of `playwright.sync_api.Error`, and `TimeoutError` raises
`PortTimeoutError`, a subclass of `playwright.sync_api.TimeoutError`, so existing
`except PlaywrightError` / `except PlaywrightTimeoutError` keep working.

## Ops (S1, S2)

S1 has `ping`, `tabs.query`, `tabs.create`, `tabs.get`, `tabs.close` and `eval`; S2 adds the rest.

Targets: `tab` is a Chrome tab id; `frame` is a webNavigation frame id (0 = top, default).

| Op | Params | Value |
|---|---|---|
| `ping` | | `{"pong": true, "userScripts": bool, "webdriver": bool, "tabs": n}` |
| `tabs.query` | | `[{"tab", "url", "title", "status", "active", "window"}]` |
| `tabs.create` | `url?`, `active?` | that tab's info |
| `tabs.get` | `tab` | `{"tab", "url", "title", "status"}` |
| `tabs.close` | `tab` | `null` |
| `tabs.goto` | `tab`, `url`, `waitUntil` (`load`/`domcontentloaded`/`commit`), `timeout` ms | `{"url", "title"}` |
| `tabs.reload` | `tab`, `waitUntil`, `timeout` | `{"url", "title"}` |
| `tabs.waitForLoad` | `tab`, `state`, `timeout` | `null` |
| `tabs.activate` | `tab` | `null` (also focuses its window, never minimizes) |
| `tabs.screenshot` | `tab`, `format` (`png`/`jpeg`), `quality?` | `{"data": base64}`; activates the tab; waits out the ~2/s quota |
| `frames` | `tab` | `[{"frame", "parent", "url"}]` |
| `eval` | `tab`, `frame?`, `code` | the value of `code` (an expression; promises are awaited), run in the page's MAIN world through `chrome.userScripts.execute`. With user scripts off: `chrome.scripting.executeScript` in MAIN calling indirect `eval` (works where page CSP allows eval: the fakes; real sites need the seed's Allow User Scripts). The value must be JSON-serializable. |
| `engine.load` | `tab`, `frame?` | `true`; injects `vendor/engine.js` into MAIN as a file (no CSP issue), unless `FillEngine` is there |
| `engine.call` | `tab`, `frame?`, `name`, `args` | `FillEngine.call(name, args)`'s answer (`{value}` or `{error}`), run by a fixed function in MAIN through `chrome.scripting` (no eval, no user scripts needed); loads the engine first if the page lacks it |
| `dom` | `tab`, `frame?`, `method`, `args` | `{"ok": value}` or `{"retry": reason}`; runs `page/dom.js`'s `method` in the extension's isolated world with Playwright's injected script (`__applyPW`); see below |

`dom` methods (values below are inside `{"ok": ...}`; "retry" means `{"retry": reason}`, answered while the element is missing or not actionable; all take a Playwright selector string first; selectors are built the way
Playwright's Python client builds them, so `internal:role=...`, `internal:text=...`,
`internal:label=...`, `>> nth=N`, `internal:has-text=...` all work):

| Method | Args | Value |
|---|---|---|
| `count` | `selector` | n |
| `state` | `selector`, `state` (`visible`/`hidden`/`attached`/`detached`/`checked`/`enabled`/`editable`...) | `{"found": n, "value": bool}` (strict: first element; `found` > 1 is `Strict` for actions) |
| `read` | `selector`, `what` (`innerText`/`textContent`/`inputValue`/`attribute:<name>`/`allInnerTexts`/`allTextContents`/`box`) | value |
| `click` | `selector`, `{force?, clickCount?, position?}` | `null`, or `{"retry": reason}` while not actionable |
| `fill` | `selector`, `value`, `{force?}` | `null` / `{"retry"}` |
| `type` | `selector`, `text` | `null` / `{"retry"}` |
| `press` | `selector`, `key` (Playwright key names: `Enter`, `Tab`, `Escape`, `Control+A`, `a`...) | `null` / `{"retry"}` |
| `check` | `selector`, `checked` | `null` / `{"retry"}` |
| `select` | `selector`, `options` (`[{value?, label?, index?}]`) | the selected values, or `{"retry"}` |
| `focus` / `blur` / `hover` / `scroll` | `selector` | `null` / `{"retry"}` |
| `files` | `selector`, `files` (`[{name, mimeType, base64}]`) | `null`; sets `input.files` through `DataTransfer`, fires `input` and `change` |
| `mark` | `selector`, `token` | n; puts `data-apply-mark="<token>"` on each match (for `evaluate` on elements) |
| `unmark` | `token` | `null` |
| `aria` | `selector`, `{mode?}` | Playwright's `ariaSnapshot` text |

## Ops (S3: the live tile and Fix from the window, KAN-609)

In `worker-extension/ops/tile.js` and `page/tile.js`; Apply's side is `apply.plain.tile`.

| Op | Params | Value |
|---|---|---|
| `tile.start` | `interval?` ms (500), `quality?` (70), `maxWidth?` (1280), `maxHeight?` (800) | `null`; from now on the Worker sends `tile.frame` events of its shown tab (the active tab of the window last switched to), at most one per `interval`, only when the picture changed. Calling it again restarts it with the new settings. |
| `tile.stop` | | `null` |
| `tile.input` | `tab?` (default: the shown tab), `event`, `width?`, `height?` | replays one tile event (below) as synthetic DOM events; `null`, `{"menu": {options: [{label, disabled}], selected}}` (a press on a `<select>`), `{"chooser": "selectSingle"\|"selectMultiple", tab, frame}` (a click asked for a file), or `{"text"}` (a copy) |
| `chooser.watch` | `tab` | `null`; clears any file request and hooks every frame of the tab (below) |
| `chooser.get` | `tab` | `{"mode", "frame"}` of the file input a page asked for since the last watch or set, or `null` |
| `chooser.set` | `tab`, `frame?`, `files` (`[{name, mimeType, base64}]`; `[]` cancels) | `true` if the input was there; sets `input.files` through DataTransfer in the MAIN world, fires `input` and `change` (`cancel` for none) |

`tile.input` events are the Apply window's (`dashboard.Frames.input`): `{"type": "down"|"up", x, y,
button, clicks}`, `{"type": "move", x, y}`, `{"type": "wheel", x, y, dx, dy}`, `{"type": "key", key,
modifiers?}`, `{"type": "text", text}` (one character: a key press; more: a paste), `{"type": "copy"}`,
`{"type": "choose", index}` (an option of the last `<select>` pressed). Points are in pixels of a frame
`width` x `height` (the frame Lisul clicked on; the page scales them by `innerWidth / width`), or CSS
pixels of the viewport when `width` is null (`PortPage.mouse`). A point on an `<iframe>`, or a key while
one has the focus, is replayed in that frame (found among `webNavigation.getAllFrames` by its address).
A press focuses what it lands on (the caret at the end of a field's text); a click goes to the nearest
element holding both press and release, as Chrome's does; the wheel dispatches `wheel`, then scrolls the
nearest box under the point that can scroll that way, else the page.

File choosers: an untrusted click opens no picker (no user activation). So a click that would open one
marks the input instead: an isolated-world `click` listener catches a synthetic click reaching a file
input (on it or its label), and a MAIN-world hook on `HTMLInputElement.prototype.click` and
`showPicker` catches a page script's own call (a dropzone's button). The mark is
`data-apply-chooser="<mode>"` on `<html>`, plus `data-apply-chooser-input` on an attached input (a
detached one is kept in the MAIN world). The hook only acts **without** user activation: Lisul's own
mouse in the Worker's window still opens the real picker. `tile.input` hooks the frame before each
press and release; `chooser.watch` hooks all frames (`PortPage.expect_file_chooser`).

Events (S2 sends these; later slices add their own):
`{"event": "tab.created", "tab", "opener"}`, `{"event": "tab.removed", "tab"}`,
`{"event": "navigated", "tab", "frame", "url"}` (committed).
S3: `{"event": "tile.frame", "tab", "url", "data": base64 JPEG, "width", "height"}`, the tab's
viewport at its CSS size (a Retina capture is scaled down), fitted within `maxWidth` x `maxHeight`.

## Adding ops in later slices (S3 to S7)

- **Extension:** put each slice's ops in its own file, `worker-extension/ops/<slice>.js`,
  exporting `export const ops = {"tile.start": async (params, ctx) => ..., ...}`, and add
  one import line to `worker-extension/ops/index.js`. `ctx.send(event, fields)` sends an event.
  Op names are `<area>.<verb>` (`tile.start`, `guard.arm`, `dialog.answer`). Never rename
  an S1/S2 op; add new ones.
- **Apply:** call `page.worker.call("<op>", **params)` (raises `PortError` on an `error`),
  and subscribe with `page.worker.on("<event>", fn)` (`fn(message)` runs on the bridge's
  reader thread: keep it short, hand off to a queue).
- Give each new op a row in this table in your PR.

## The Page API (apply.plain.page)

`PortPage`, `PortFrame` and `PortLocator` copy the sync Playwright API's names, arguments
and defaults (timeouts in ms, default 30000). Covered in S2:

- **PortPage:** `url`, `title()`, `goto(url, wait_until=, timeout=)`, `reload()`,
  `wait_for_load_state(state=)`, `wait_for_timeout(ms)`, `is_closed()`, `close()`,
  `bring_to_front()`, `evaluate(expression, arg=None)`, `locator(selector)`,
  `get_by_role(role, name=, exact=, checked=, ...)`, `get_by_text(text, exact=)`,
  `get_by_label(text, exact=)`, `get_by_placeholder`, `get_by_test_id`,
  `fill/click/check/press/type/select_option/set_input_files/is_visible/is_checked/inner_text/input_value(selector, ...)`,
  `eval_on_selector_all(selector, fn, arg)`, `screenshot(path=, type=, full_page=False)`,
  `frames`, `main_frame`, `context` (a `PortContext` with `pages`, `new_page()`),
  `keyboard.press/type/insert_text` (on the focused element), `on/once/remove_listener`
  (`close`, `popup`, `framenavigated`; other events are accepted and ignored until their
  slice wires them), `worker` (the bridge connection), `tab` (tab id).
- **PortLocator:** `locator`, `get_by_*`, `filter(has_text=, has_not_text=)`, `nth`, `first`,
  `last`, `all()`, `count()`, `click`, `dblclick`, `fill`, `clear`, `type`,
  `press_sequentially`, `press`, `check`, `uncheck`, `set_checked`, `select_option`,
  `set_input_files` (paths, or `{name, mimeType, buffer}`), `focus`, `blur`, `hover`,
  `scroll_into_view_if_needed`, `is_visible`, `is_hidden`, `is_enabled`, `is_disabled`,
  `is_checked`, `is_editable`, `inner_text`, `text_content`, `input_value`,
  `get_attribute`, `all_inner_texts`, `all_text_contents`, `bounding_box`,
  `wait_for(state=, timeout=)`, `evaluate(fn, arg)`, `evaluate_all(fn, arg)`,
  `aria_snapshot()`, `page`.
- **PortFrame:** `url`, `name`, the same locator, `evaluate` and action methods, run in that frame.
- **S3 adds:** `PortPage.mouse` (`move`, `down`, `up`, `click`, `dblclick`, `wheel`, at viewport
  points) and `PortPage.expect_file_chooser(timeout=)`, whose `.value` is a FileChooser
  (`set_files`, `is_multiple`, `page`; no `element`), in `apply.plain.tile`.
- **Not yet (a later slice adds it, in this module):** `add_init_script`, `expose_binding`,
  `route`/`unroute` (S4); `full_page=True` stitching (S5); `add_locator_handler` (S7); frame locators across frames
  (`frame_locator`, `content_frame`) (S5/S7). Each raises `NotImplementedError` naming the slice.

Auto-wait: actions poll their `dom` op every 100 ms while it answers `{"retry": ...}` or
`NotFound`, until the timeout, then raise `PortTimeoutError` with Playwright's wording
("Locator.click: Timeout 30000ms exceeded."). Events are synthetic (`isTrusted: false`):
`fill` focuses, selects all and uses `execCommand("insertText")`, falling back to the
native value setter plus `input`/`change`; `press` emulates the default of Enter, Tab,
Backspace, Delete, Space and (S3) the caret keys ArrowLeft/ArrowRight/Home/End (Shift extends); `click` dispatches pointer and mouse events
at the element's centre on the hit target, then `click`.

## How a Filler calls it

```python
from apply.plain.launcher import PlainWorkers

workers = PlainWorkers()                 # profiles from APPLY_PROFILES; Chrome for Testing in dev/tests
with workers.open(url, worker=0) as page:   # same shape as WorkerBrowsers.open: yields a page
    fill_engine.call(page, "readQuestions", site)   # unchanged: page.evaluate + engine.load
    page.get_by_role("button", name="Next").click()
```

`fill_engine.call` uses `page.engine_call(name, args)` when the page has one (PortPage does): the
`engine.call` op, which loads `vendor/engine.js` as a file. So the 1 MB message cap never meets
the 440 KB bundle, page CSP never blocks it, and the engine needs no user scripts.

User scripts: in Chrome for Testing (tests, dev) nobody can turn on Allow User Scripts, so `eval`
falls back to an indirect eval in MAIN, which works on the fakes but not on a page whose CSP
forbids eval (it raises `PortError` kind `UserScriptsOff`). Prefer a fixed extension function
(like `engine.call` and `dom`) over `eval` for anything a slice runs on real sites.

`PlainWorkers` (S1): `prepare()`, `launch(worker) -> PlainWorker` (pid, profile,
connection), `open(url, worker)`, `stop(worker)` / `stop_all()` (by PID only),
`show(worker)`. Launch flags: `--user-data-dir`, `--no-first-run`,
`--no-default-browser-check`, `--disable-backgrounding-occluded-windows`,
`--hide-crash-restore-bubble`, `--window-position`, `--window-size`, and in dev/tests
`--load-extension=<worker-extension>`. Never `--remote-debugging-port`,
`--enable-automation`, `--headless`. Workers are never minimized and sit on-screen.

`policies.yaml: worker_mode: cdp|plain` (default `cdp`) is read by S8's routing; S1 only adds the key.

## Known limits (found in S1/S2, on Chrome for Testing 156)

- **No user activation.** Synthetic events grant none. A `target=_blank` link opens its tab on a
  synthetic click (the `popup` event fires), but `window.open` called from a synthetic click is
  blocked by Chrome's pop-up blocker, and so is anything else that needs a gesture (file picker,
  fullscreen, clipboard write). Such a step becomes a FillError, then Rescue, then Needs you (S6).
- **No handles.** `evaluate_handle` and `element_handle` raise. `locator.evaluate(fn)` marks the
  element in the isolated world (`data-apply-mark`) and finds it by the mark in MAIN.
- **User scripts are off in Chrome for Testing** (no one can toggle them there). `eval` then works
  only where the page's CSP allows eval. The engine, locators and actions don't use eval.
- **A stored extension service worker survives restarts**, so the launcher deletes the profile's
  `Default/Service Worker` folder before each start (an updated extension would run old code).
- `--load-extension` works only in Chrome for Testing; branded Chrome needs the seed (`apply plain seed`).

## The tile (S3)

`apply.plain.tile.PortFrames(workers, connection)` is the Apply window's frame source
(`dashboard.Frames`) for plain Workers, as `dashboard.CdpFrames` is for CDP ones:
`Dashboard(n, PortFrames(n, workers.bridge.connection))`. Its thread calls `tile.start` on each
Worker's connection as it appears (again after a reconnect), keeps the newest `tile.frame` per Worker,
replays the window's input with `tile.input` (the window sends events one at a time, in order),
answers a file the tile picked with `chooser.set`, and reads the field error (`apply.stuck`) every 2 s
over `eval`. Every capture, the tile's and `tabs.screenshot`'s, goes through one gate in the
extension (`shared.capture`), spaced 520 ms apart: Chrome allows about two a second per browser, so a
screenshot waits at most one tile frame. With `--disable-backgrounding-occluded-windows` a Worker
covered by other windows still sends fresh frames (`test_plain_tile`). A minimized window's capture
never answers: it gives up after 5 s, and Workers are never minimized.

## Demos

- `uv run apply plain ping [--workers N]`: starts N plain Workers, prints each hello
  (extension and engine versions, `navigator.webdriver: false`, no `DevToolsActivePort`), quits them.
- `uv run apply plain fill <saved-form>` (e.g. `lever-immuta`): serves one of the engine's saved
  forms on 127.0.0.1 (POSTs refused), opens it in a plain Worker, reads its questions, plans Test
  Person's answers (the sample's made-up applicant), fills them through `fill_engine.fill` and
  prints the read-back. Never submits. `apply.plain.demo.replay(folder)` is the same server for tests.
- `uv run apply plain tile <saved-form> [--seconds N]` (S3): the same fill, shown live in an Apply
  window tile (it prints the window's address); then the tile stays up N seconds (300) for clicking and
  typing in the form from it. Never submits: the saved form's server refuses every POST.

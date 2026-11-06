# Plain Workers protocol (v1)

S1 (KAN-607) and S2 (KAN-608) own this; S3 to S7 build on it (S3, KAN-609: the tile ops). Spec: KAN-606. This file
is the source; change it in the PR that changes the protocol.

Hard rule: never evade bot detection and never touch a captcha; hand those to
the user. A plain Worker is a Chrome with no CDP, no automation flags and no
headless mode.

## Pieces

```
Apply process                                   Worker k (plain Chrome)
  apply.plain.bridge.Bridge  <── Unix socket ──  host relay  <── native messaging ──  worker extension
  (listens on APPLY_PROFILES/workers.sock, 0600) (apply/plain/host.py,                (apply-agent/worker-extension/,
  apply.plain.page.PortPage                       Chrome starts it)                     background.js + ops/*.js)
  apply.plain.launcher.PlainWorkers
```

- **Extension:** `apply-agent/worker-extension/` in WorkIt. Private, never on the
  Store. Its ID is fixed by `manifest.json`'s `key`: `apply.plain.extension.EXTENSION_ID`.
  Workers load a copy of it, `APPLY_PROFILES/worker-extension/` (KAN-645), which Apply replaces
  only while none of that folder's Workers runs. Its generated files are in `vendor/` and, for
  code at features 3, in a write-once set `vendor/sets/<id>/` that the welcome names (the
  extension then reads each `vendor/<file>` from the set: `ops/shared.js: vendor`). The launcher
  writes them before every launch (`apply plain prepare` writes the checkout's `vendor/`):
  - `vendor/engine.js`: the Fill engine bundle, copied from the extension submodule's
    `fill-engine/dist/engine.js` (the same build the WorkIt extension uses).
  - `vendor/engine.json`: `{"version": "0.3.13+7a3a3fc", "sha256": "..."}`.
  - `vendor/injected.js`: Playwright's own injected script (playwright-core's
    `injectedScriptSource`, Apache-2.0, taken from the installed Python package's driver),
    wrapped so it sets `globalThis.__applyPW = new InjectedScript(...)` in the
    extension's isolated world.
  - `vendor/fixed.js` (S5): Apply's fixed page functions (`apply.plain.fixed`), written from
    the very strings `on_page`, `stuck` and `email_code` evaluate; sets `globalThis.__applyFixed`.
- **Host:** `com.workit.apply_worker`. Its manifest is written into each Worker profile's
  own `NativeMessagingHosts/` folder (never Lisul's Chrome folder) and names only the
  worker extension's origin. Its `path` is a per-profile wrapper that runs
  `python3 -I apply/plain/host.py --socket <sock> --worker <k>`. The host is stdlib only.
- **Socket:** `workers.sock` in the Worker profiles folder (`APPLY_PROFILES`, default
  `APPLY_HOME/profiles`), mode 0600, in a folder only Lisul can read. One Apply process
  drives one profiles folder's Workers; a rehearsal held for Lisul keeps its process up, so
  another rehearsal runs with its own `APPLY_PROFILES` (KAN-634).
  macOS caps a socket path at 104 bytes; when the profiles folder's path is too long
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
   {"type": "hello", "protocol": 1, "extension": "0.2.0", "features": 2,
    "engine": {"version": "0.3.13+7a3a3fc", "sha256": "..."},
    "userScripts": true, "webdriver": false,
    "userAgent": "...", "brands": ["Google Chrome", "..."]}
   ```
5. Apply → extension: `{"type": "welcome", "worker": k, "protocol": 1, "vendor": "vendor/sets/<id>"}`
   (`vendor` only for features 3 or more), or
   `{"type": "refuse", "reason": "..."}` and Apply closes the connection.
   Apply refuses: a wrong origin, another protocol, or an engine whose version or
   sha256 differs from Apply's own `fill_engine.ENGINE` (the reason names both and says
   to run `apply plain prepare`).
   An extension at features 3 or more that gets a `vendor` set is never refused for its engine:
   the set holds Apply's own.
   `features` (KAN-643) is what the extension's code can do: 2 is `tile.shown` and
   `extension.reload`; 3 is the welcome's vendor set and `vendor.use` (KAN-645); none (an
   extension from before KAN-643) counts as 1. Raise
   `FEATURES` in `background.js` and `bridge.FEATURES` together with each new op or event.
   Chrome keeps running the code it loaded, so a Worker can be older than Apply. An older
   one is never refused. When it has `extension.reload` (features 2 or more) and its profile
   has Developer mode on (`launcher.developer_mode`), Apply welcomes it, calls
   `extension.reload`, and waits for the hello its reloaded code sends; once per Worker.
   Without Developer mode Chrome disables a reloaded unpacked extension
   (`unsupportedDeveloperExtension`), so Apply never reloads one there. A Worker still
   older is welcomed with `Connection.stale`: Apply prints one line, and its tile says
   "Worker extension is out of date: quit Apply and start it again".
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
| `extension.reload` | | `null`; then `chrome.runtime.reload()`: the extension loads its files again from its folder, this port closes, and the new code says hello. Its guards come back first: registered scripts, session rules, lifts, held notes and bindings (`keepAcrossReload`, KAN-657). Web tabs, their pages and cookies stay; registered guards and scripts go (KAN-643: Apply calls it only before the welcome, or `Bridge.reload`). |
| `tabs.goto` | `tab`, `url`, `waitUntil` (`load`/`domcontentloaded`/`commit`), `timeout` ms | `{"url", "title"}` |
| `tabs.reload` | `tab`, `waitUntil`, `timeout` | `{"url", "title"}` |
| `tabs.waitForLoad` | `tab`, `state`, `timeout` | `null` |
| `tabs.activate` | `tab` | `null` (also focuses its window, never minimizes) |
| `tabs.screenshot` | `tab`, `format` (`png`/`jpeg`), `quality?` | `{"data": base64}`; activates the tab; waits out the ~2/s quota |
| `frames` | `tab` | `[{"frame", "parent", "url"}]` |
| `eval` | `tab`, `frame?`, `code` | the value of `code` (an expression; promises are awaited), run in the page's MAIN world through `chrome.userScripts.execute`. With user scripts off: `chrome.scripting.executeScript` in MAIN calling indirect `eval` (works where page CSP allows eval: the fakes; real sites need the seed's Allow User Scripts). The value must be JSON-serializable. |
| `vendor.use` | `root` | `{root}`: read Apply's generated files from that vendor set from now (a new engine) |
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
| `tile.start` | `interval?` ms (500), `quality?` (88), `maxWidth?` (1280), `maxHeight?` (900), `native?` (false) | `null`; from now on the Worker sends `tile.frame` events of its shown tab (the active tab of the window last switched to), at most one per `interval`, only when the picture changed. With `native`, Apply films the window itself, and the Worker sends only `tile.shown` events, each time the shown window or tab changes. Calling it again restarts it with the new settings. |
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
KAN-635: `{"event": "tile.shown", "tab", "url", "title", "window": {left, top, width, height, state}, "viewport": {width, height}}`
(points), with `native`: the window `apply.plain.window_capture` films, and the part of it to crop to. `title` (KAN-717)
is the tab's: Apply films the window only while macOS lists it, under the Worker Chrome's PID, with that title, and no
other window of that PID has it (`window_capture.title_matches`). The extension sends it at once on a tab switch, and
drops a `tile.frame` whose window switched tabs during its capture.

## Ops (S4: the submit and drive guards)

`worker-extension/ops/guard.js`, called by `apply.plain.guards` (which `apply.submit_guard`'s
`guard`, `lift`, `rearm`, `renote` and `DriveGuard` hand a PortPage to) and by PortPage's
`add_init_script`, `expose_binding` and `route`. A guard file is one of `vendor/guards/*.js`,
written by `apply plain prepare` from `submit_guard`'s own scripts; an op that takes one refuses
it (`Crash`, "run `uv run apply plain prepare`") unless its sha256 is the `sha256` Apply sends.
A fresh service worker starts with no content scripts, rules or user scripts.

| Op | Params | Value |
|---|---|---|
| `guard.script` | `id`, and `file` + `sha256` (a guard file), or `code` | `{"file"}` / `{"code": true}`; registers the file as a MAIN-world content script at `document_start` in every frame (`matchOriginAsFallback`, not persisted), or the code through `chrome.userScripts` (`UserScriptsOff` when Allow User Scripts is off). Also registers `page/relay.js` |
| `guard.inject` | `tab`, `file`, `sha256` | `null`; runs a guard file in every frame of the tab now |
| `guard.route` | `key`, `tab` (null: every tab), `regexes`, `caseSensitive` | `{"rules": n}`; one declarativeNetRequest session rule per regex blocking a non-GET (`excludedRequestMethods: get, head, options`) of every resource type, main_frame included, on `tabIds` = the tab, the tabs it opens later, and -1 (service and shared workers). Each regex must pass `isRegexSupported` (RE2, 2 KB compiled) |
| `guard.unroute` | `key` | `null` |
| `guard.bind` | `tab` (null: every tab), `name` | `null`; `window[name](...args)` in MAIN, in every frame now and in each document the tab loads, sends a `binding` event |
| `guard.lift` | `tab`, `again`, `warning`, `wrong`, `held` (KAN-629: what holds Submit, `""` for nothing), `onlyLifted?`, `sha256` (of `lifted.js`) | `null`; `submit_guard.LIFTED` with those values in every frame now and in each document the tab (and a tab it opens) loads, until `guard.rearm`. A `held` page keeps its Submit blocked by the guard script under a red note whose Dismiss calls the `__applyDismissHold` binding. With `onlyLifted` (renote), a tab not lifted is left as it is: `false` |
| `guard.applied` | `tab`, `day` (null: dismissed), `sha256` (of `applied.js`) | `null`; KAN-621's "You already applied on <day>" note (`submit_guard.APPLIED_NOTE`) in the top frame now and in each document the tab loads, the guard still on; its second Dismiss press calls `__applyDismissApplied`. `day: null` stops it and marks every frame dismissed |
| `guard.rearm` | `tab`, `sha256` (of `rearmed.js`) | `null`; stops lifting the tab and runs `submit_guard.REARMED` in its frames |
| `guard.flags` | `tab`, `set` (`{"__applyDriveLifted"|"__applyAccountClick"|"__applyRehearsalLifted": bool}`) | `null`; in every frame (DriveGuard's `lift`, `arm`, `let_account_click`) |
| `guard.touch` | `tab`, `frame?`, `by` (`lisul`/`apply`) | `null`; dispatches `__apply_touch` in the frame, which the guard counts as a touch; `by: "lisul"` also sends `guard.touched`. `tile.input` calls the exported `touch()` before each press it replays (`by` its own param: `lisul` from the tile, `apply` from `PortPage.mouse`) |
| `guard.sync` | `tab`, `timeout?` ms | `null` once every frame's earlier `guard.said` messages have reached the service worker |
| `guard.status` | `tab?` | `{"scripts": [ids], "rules": n, "lifted": bool}` |
| `guard.reset` | | `null`; no guard left: every content script, rule, user script, lift and binding goes (`apply.plain.guards.reset(worker)`, for a Worker reused for another Application; a fresh service worker starts so) |

Events: `{"event": "guard.said", "tab", "frame", "text"}` (a guard's "Apply rehearsal blocked ..."
/ "Apply drive guard blocked ...", its console line under CDP), `{"event": "binding", "tab",
"frame", "name", "args"}`, `{"event": "guard.touched", "tab", "frame", "by"}`.

Page channel: the MAIN world and `page/relay.js` (the isolated world) talk through `CustomEvent`s
with string `detail` on the document (`__apply_said`, `__apply_call`); the extension's touch is
`__apply_touch` on window. `page/dom.js` dispatches `__apply_touch` (`by: apply`) before each
`click`, `type`, `press`, `keys` and `check`, as Playwright's trusted input counted as a touch.

## Ops (S5: Records, Needs you, Resume, emailed code; KAN-611)

| Op | Params | Value |
|---|---|---|
| `tabs.fullScreenshot` | `tab`, `format` (`png`/`jpeg`), `quality?`, `clip?` (`{x, y, width, height}` in page px, or with `viewport: true` in viewport px), `scale?` (default 1), `maxHeight?` (CSS px, default 20000) | `{"data": base64, "width", "height", "strips", "cut"}`: the whole page (or `clip`) by scroll and stitch, at `scale` px per CSS px; fixed and sticky elements hidden after the first strip; the scrollbar hidden; the page's scroll put back. A strip a viewport tall about every 0.55 s (the capture quota). `cut`: the page is taller than `maxHeight` |
| `page.html` | `tab`, `frame?`, `snapshot` | the frame's HTML with its doctype. With `snapshot` (a Record's): each field's value as shown (value, checked, selected, a textarea's text), no `<script>`/`<noscript>`, no Apply note (`[id^=apply-]`), no password value, and a `<base href>` |
| `fixed.call` | `tab`, `frame?`, `name`, `world` (`ISOLATED`/`MAIN`), `arg`, `selector?`, `all?` | `{"ok": value}`, `{"retry": reason}` (no element matches `selector` yet), or `{"err": {name, message}}`: runs `vendor/fixed.js`'s function `name` on `arg`, or on the first (`all`: every) element `selector` matches (Playwright's selector engine; ISOLATED only). No eval: page CSP and Allow User Scripts don't matter |

## Ops (S7: Workday's accounts and other account pages; KAN-613)

| Op | Params | Value |
|---|---|---|
| `net.watch` | `tab`, `on` (default true) | `null`; while on, the tab's requests go up as `request`, `response` and `requestfailed` events (webRequest, observe only), and `page/net-main.js` (a fixed file, never eval) goes into each of its frames as it commits, to read fetch and XHR answers and see a `window.open` the pop-up blocker refused |
| `frames.of` | `tab`, `frame?`, `selector` | `{"ok": frameId}` of the `<iframe>` the selector finds in that frame, `{"retry": reason}` while it is missing or has no document, or an error (`Strict`, not an iframe). Matched by its index in `window.frames` (content scripts have no `getFrameId` here), so it works across origins |

Events (S7, from a watched tab): `{"event": "request", "tab", "frame", "url", "method", "resource"}`;
`{"event": "response", "tab", "frame", "url", "method", "resource", "status", "body"?, "truncated"?}`
(a fetch or XHR comes from the page, with `requested` and, for a call that isn't a GET, its `body`, up
to 256 K characters); `{"event": "requestfailed", ..., "error"}`; `{"event": "popup.blocked", "tab",
"url", "popup"}`: the page's `window.open(url)` was refused, so the extension opened `url` in tab
`popup`, with the page as its opener. An event field is never named `type` (`ctx.send` puts
`type: "event"` on each message, and a field of that name would replace it).

A script call (`eval`, `dom`, `fixed.call`, any `inPage`) whose frame commits a new document before it
answers fails as `Navigated` ("Execution context was destroyed..."), and as `NoTab` if its tab closes:
Chrome never settles such a call by itself.

## Ops (S6: Claude fill and Rescue)

KAN-612. In `worker-extension/ops/claude.js`, with `page/modal.js`. They serve Apply's MCP server
(below); fixed functions through `chrome.scripting`, so no eval and no user scripts.

| Op | Params | Value |
|---|---|---|
| `mcp.arm` | `tab` | `null`; registers `page/modal.js` as a content script (MAIN world, `document_start`, all frames, `<all_urls>`, not persisted) once per browser, and injects it into the tab's open frames |
| `mcp.modal` | `tab`, `clear` (`["dialogs"]` default; `"chooser"` too to close the chooser) | `[{"frame", "dialogs": [{"type", "message", "accepted", "at"}], "chooser": {"token", "multiple", "accept", "at"} \| null}]`, one per frame that has `modal.js`; the dialogs are those answered since the last call that cleared them |
| `mcp.answer` | `tab`, `accept`, `promptText?` | `null`; the answer to the next `alert`/`confirm`/`prompt` in any frame of the tab |

`page/modal.js` answers each native dialog at once and records it: `confirm` and `prompt` are
dismissed unless `mcp.answer` said otherwise (as Playwright dismisses a dialog no one handles).
A file input that would open its picker (a click on it or its label, `input.click()`, or
`showPicker()`, also when S3's tile hook kept it) is recorded as the open chooser and marked
`data-apply-mcp-chooser="<token>"`; `dom` `files` on `[data-apply-mcp-chooser="<token>"]` then sets
its files, and the tile's chooser mark is cleared. It adds no events of its own.

### Apply's MCP server

`claude_cli.drive` on a PortPage starts `apply.plain.tools.ToolServer` (a Unix socket of its own
for that drive, 0600 in `/tmp/apply-<uid>/`, 0700) and gives `claude -p` this server as
`playwright`: `python -I -m apply.plain.mcp --socket <path>`. That stdio process (stdlib only)
answers `initialize` and `tools/list` itself (`apply/plain/mcp_tools.json`: @playwright/mcp@0.0.83's
own schemas for `claude_cli.BROWSER_TOOLS`, nothing else) and sends each `tools/call` as one JSON
line `{"name", "arguments"}` over the socket; Apply answers one line `{"content": [...], "isError"?}`.
Tool names, inputs and the `mcp__playwright__` prefix are unchanged, so the prompts, the allowed
and denied tool lists and the submit-click hook (`apply.send_click`) are too. A CDP Worker's drive
is unchanged (Playwright MCP over `--cdp-endpoint`).

Every CDP-only call Claude fill and Rescue made, and what stands in for it:

| Today (Playwright MCP over CDP) | Plain Worker |
|---|---|
| `--cdp-endpoint` from `DevToolsActivePort` (`browsers.cdp_endpoint`) | the drive's ToolServer socket; no endpoint |
| `browser_snapshot`: `_snapshotForAI` with `[ref=eN]`, iframes as `f<n>eN` | `dom` `aria` on `body` with `{mode: "ai"}` in each frame (Playwright's injected script); a child frame's refs are written `f<webNavigation frame id>eN` |
| A ref resolved by the `aria-ref=eN` selector | the same selector through `dom`, in the ref's frame (the injected script keeps each frame's last snapshot) |
| `browser_click` / `type` / `fill_form` / `select_option` / `hover`: CDP `Input.dispatchMouseEvent` / `insertText` (trusted) | `dom` `click` / `fill` / `type` / `check` / `select` / `hover` (synthetic). Only left clicks. |
| `browser_press_key`: `Input.dispatchKeyEvent` | `dom` `keys` on the focused element |
| `browser_handle_dialog`: `Page.javascriptDialogOpening` held open, answered by CDP | `page/modal.js` answers at once; `mcp.answer` sets the next answer; tool replies list answered dialogs under `### Modal state` |
| `browser_file_upload`: `Page.setInterceptFileChooserDialog`, `fileChooserOpened`, `DOM.setFileInputFiles` | the chooser `modal.js` recorded, then `dom` `files` (DataTransfer); paths only inside the drive's folder |
| `browser_navigate` / `navigate_back` | `tabs.goto` / `history.back()` |
| `browser_tabs`: CDP targets | `tabs.query` / `tabs.create` / `tabs.activate` / `tabs.close` |
| `browser_wait_for` | `dom` `state` on `get_by_text` (5 s, as Playwright MCP's), or a sleep of at most 30 s |
| `browser_find` | a text or regex search of the snapshot above |

Claude fill's and Rescue's own Python code runs on the PortPage like any Filler's. The
CDP-only calls it reaches belong to other slices: the drive guard (`DriveGuard`:
`context.add_init_script`, `context.on("console")`) is S4's, and `attach.attach_resume`'s
`expect_file_chooser` is S3's.

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
  `eval_on_selector_all(selector, fn, arg)`, `screenshot(path=, type=, full_page=)` (S5: `full_page=True`
  stitches), `content()` and `record_html()` (S5),
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
  `aria_snapshot()`, `screenshot()` (S5: the element, cut from a stitch), `page`.
- **Fixed functions (S5):** `evaluate` / `Locator.evaluate` given one of the strings in
  `apply.plain.fixed` run its fixed copy (`fixed.call`), not eval. Add a string there for page
  code a held page runs on real sites. S9 (KAN-615) adds regenerate's `OFFER`, `WORKING`, `DONE` and
  `SHOWN` (MAIN world: the button calls the `__applyRegenerate` binding). No new op.
- **PortFrame:** `url`, `name`, the same locator, `evaluate` and action methods, run in that frame.
- **S4:** `add_init_script(script=, path=)` (PortPage's and PortContext's: every page from now),
  `expose_binding(name, callback)` / `expose_function` (PortPage's: that tab; PortContext's: every
  tab; the callback runs on its own thread with `source = {context, page, frame}`), and
  `route(regex, submit_guard._refuse)` / `unroute` (declarativeNetRequest: blocks non-GETs; a glob
  or another handler raises `NotImplementedError`, since no Python handler can run).
- **S3 adds:** `PortPage.mouse` (`move`, `down`, `up`, `click`, `dblclick`, `wheel`, at viewport
  points) and `PortPage.expect_file_chooser(timeout=)`, whose `.value` is a FileChooser
  (`set_files`, `is_multiple`, `page`; no `element`), in `apply.plain.tile`.
- **S7 adds:** `frame_locator` (on a page, frame or locator) and `Locator.content_frame`, as
  `PortFrameLocator`s whose frame is looked up again on each call (`frames.of`), on any origin;
  `add_locator_handler(locator, handler, no_wait_after=, times=)` / `remove_locator_handler`, checked
  before each action and each of its retries; `page.on("request" | "response" | "requestfinished" |
  "requestfailed")` with `PortRequest` and `PortResponse` (no headers; `json()`/`text()`/`body()` only
  for a fetch or XHR that isn't a GET, else `PortError("NoBody")`); and `page.on("popup")` for a
  `window.open` the pop-up blocker refused.

Auto-wait: actions poll their `dom` op every 100 ms while it answers `{"retry": ...}` or
`NotFound`, until the timeout, then raise `PortTimeoutError` with Playwright's wording
("Locator.click: Timeout 30000ms exceeded."). Events are synthetic (`isTrusted: false`):
`fill` focuses, selects all and uses `execCommand("insertText")`, falling back to the
native value setter plus `input`/`change`; a focus move (a click, Tab, `focus`, `blur`, `fill`) that the page didn't hear, as in a window without focus, dispatches `blur` and `focusout` on what it left (KAN-709); `press` emulates the default of Enter, Tab,
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

**Background launch (Lisul, 2026-11-04):** a Worker's Chrome starts through
`/usr/bin/open -g -n -a <Chrome app> --args ...` (`launcher.start_in_background`), never by running
the binary, which macOS brings to the front. Its PID is then read from the profile's
`SingletonLock` (`PlainWorker.process` is a `launcher.Chrome`, stopped by that PID). `open -g` alone is not enough: Chrome activates itself as it shows its first
window, so it starts with `--no-startup-window` and, after the hello, the extension's
`windows.create` op opens the Worker's window with `focused: false`. Windows are
1280 x 900 at the top-left corner (KAN-635), shrunk to the main screen's visible area
(`system.display` work area, `ops/core.js: onScreen`), staggered 20 px a Worker, wholly on-screen. Nothing may bring a
Worker forward except Lisul's own Show (`PlainWorkers.show`): no `chrome.windows.update({focused:
true})`, no AppleScript focus, no full-screen. Tests use one Worker, shared by the module, and stop it
when they end.

`policies.yaml: worker_mode: cdp|plain|protected` (default `cdp`) picks the Worker for each form (S8,
`apply.plain.site`): `plain` puts every form on a plain Worker (`PlainSite`), `protected` only those on
`plain_worker_hosts` (Lever, SmartRecruiters, Workable) and in `APPLY_HOME/plain-hosts.json` (written
by `captcha.blocked`), the rest on CDP Workers (`RoutedSite`).
`PlainSite.open` keeps a Worker's Chrome up across the Applications it carries: on reuse it calls
`guards.reset(worker)` and closes the last one's tabs; after each it leaves one blank tab, so the window
stays. `close()` stops every Chrome it started, by PID, when the run or rehearsal ends.

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
- **Dialogs are answered as they open** (S6). A plain Worker can't hold a native dialog open the way
  CDP does, so `browser_handle_dialog` sets the answer to the next one; a dialog already answered
  is shown in the tool's reply. `beforeunload` prompts can't be answered.
- **Only the file inputs `modal.js` saw open a picker** take a `browser_file_upload`; an input made
  in script and never attached to the page is missed.

- **Guards (S4).** A rule can't fulfill or modify a request, only block it, so `route` takes only
  `submit_guard._refuse`. Rules are tab-scoped; a tab a guarded tab opens joins its rules a moment
  after `tabs.onCreated` (its page's guard script, registered for every tab, covers that moment).
  Lever's 36-character posting id is `[0-9a-f-]+` in its rule (RE2's memory cap); only more is
  blocked. A lifted tab's note and bindings go in at each commit, a moment after the page's first
  script; the guard reads its lifted flag only when something is pressed.

## The tile (S3)

`apply.plain.tile.PortFrames(workers, connection)` is the Apply window's frame source
(`dashboard.Frames`) for plain Workers, as `dashboard.CdpFrames` is for CDP ones:
`Dashboard(n, PortFrames(n, workers.bridge.connection))`. Its thread calls `tile.start` on each
Worker's connection as it appears (again after a reconnect), keeps the newest `tile.frame` per Worker,
replays the window's input with `tile.input` (the window sends events one at a time, in order),
answers a file the tile picked with `chooser.set` (only in the tab that asked), and reads the field error
(`apply.stuck`) every 2 s over `eval`. It reads `tab.created`'s `opener`, `popup.blocked` and `tab.removed` to know
each form's own pop-ups: a tile shows the one of its form's tabs that showed last (KAN-717). With Screen Recording permission (KAN-635) it films each Worker's window instead
(`apply.plain.window_capture`: ScreenCaptureKit, by the window's ID, 30 fps at the screen's pixel scale), and
the extension sends only `tile.shown`. Without it, every capture, the tile's and `tabs.screenshot`'s, goes through one gate in the
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

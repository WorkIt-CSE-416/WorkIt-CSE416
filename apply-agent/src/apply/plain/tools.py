"""Claude's browser tools on a plain Worker (KAN-612): Playwright MCP's tools, run on a PortPage.

Claude fill and Rescue drive the Worker's page with Playwright MCP's tools
(claude_cli.BROWSER_TOOLS). A CDP Worker gives Playwright MCP its DevTools endpoint; a plain
Worker has none. So for a PortPage, claude_cli.drive starts a ToolServer: it listens on a Unix
socket of its own (0600, in a 0700 folder) for that one drive, and `claude -p` starts
apply.plain.mcp as its `playwright` MCP server, which passes each tool call here. The tools'
names and inputs are Playwright MCP's (mcp_tools.json), so the prompts, the allowed and denied
tool lists and the submit-click hook (apply.send_click) don't change.

Each tool runs on the page through the port, as a Filler's code does:
- the snapshot is Playwright's own `ariaSnapshot` in its "ai" mode, from the injected script
  in each frame, so Claude sees the same YAML and `[ref=eN]` refs. A ref resolves through the
  injected script's `aria-ref=` selector against that frame's last snapshot; a child frame's
  refs are written `f<frame>eN`;
- clicks, typing, picks and keys are the dom op's synthetic events (isTrusted: false);
- dialogs and the file chooser, which only CDP could hold open, come from page/modal.js: it
  answers each dialog at once (dismissed unless browser_handle_dialog said otherwise) and
  records a file input that would open its picker, and browser_file_upload sets its files
  through DataTransfer. Only files in the drive's own folder can be attached.

The tools never send the form themselves; the drive guard on the page and the submit-click
hook stand where they stood. They never touch a captcha either (KAN-617): a click, entry, pick,
hover or key on anything in a captcha's frame, or on its frame or widget box in the page, is
refused before it runs, with word to leave it. Lisul does the captcha himself (apply.captcha).
On Ask Claude's drive each act is also judged on the real element first (send_click.judged).
"""

import json
import os
import re
import socket
import threading
import time
import uuid
from pathlib import Path
from typing import Self

from apply import captcha, send_click
from apply.plain.bridge import PortError
from apply.plain.page import PortFrame, PortPage

ACTION_TIMEOUT = 5000  # ms, as Playwright MCP's
REF = re.compile(r"^(?:f(\d+))?(e\d+)$")
REFS = re.compile(r"\[ref=(e\d+)\]")
IN_TARGET = re.compile(r"\[?ref=((?:f\d+)?e\d+)\]?")
WAIT_MOST = 30  # s, browser_wait_for's `time`
CAPTCHA = ("That is a captcha, and Apply never touches one: a person does it. Don't click, tick, type in or solve "
           "it, and don't try another way. Leave it as it is and go on with the rest of the form; if its challenge "
           "covers the form, stop: set blocked and say captcha in why.")
# Whether the element is a captcha's frame or widget box, or in one.
IN_CAPTCHA = "(el, captchas) => !!(el.closest && el.closest(captchas))"
# Whether the focused element, where a key would go, is a captcha's frame or in a widget box.
FOCUS_IN_CAPTCHA = """(captchas) => { const el = document.activeElement; return !!(el && el.closest && el.closest(captchas)); }"""


def socket_folder() -> Path:
    folder = Path("/tmp") / f"apply-{os.getuid()}"
    folder.mkdir(mode=0o700, exist_ok=True)
    os.chmod(folder, 0o700)
    return folder


class ToolError(Exception):
    """A tool that couldn't run, said to Claude as Playwright MCP says it."""


class Tools:
    """Playwright MCP's browser tools on one plain Worker's tabs; `page` is the drive's tab."""

    def __init__(self, page: PortPage, folder: Path, hook: tuple[str, ...] = ()):
        self.page = page
        self._folder = folder.resolve()
        self._ask, self._message = send_click.flags_of(hook)
        page.worker.call("mcp.arm", tab=page.tab)

    def call(self, name: str, arguments: dict) -> dict:
        tool = getattr(self, name, None) if name and name.startswith("browser_") else None
        if tool is None:
            return _text(f"### Error\nTool \"{name}\" not found", error=True)
        try:
            return _text(tool(**arguments))
        except ToolError as error:
            return _text(f"### Error\nError: {error}", error=True)
        except PortError as error:
            return _text(f"### Error\n{type(error).__name__ if error.kind == 'TimeoutError' else 'Error'}: {error}", error=True)
        except TypeError as error:
            return _text(f"### Error\nInvalid arguments for {name}: {error}", error=True)

    # --- the page as Claude sees it

    def _snapshot(self, page: PortPage | None = None, target: str | None = None, depth=None) -> str:
        page = page or self.page
        options = {"mode": "ai", **({"depth": int(depth)} if depth else {})}
        if target:
            frame, selector = self._resolve(target)
            return frame._now("aria", selector, options)
        parts = []
        for frame in page.frames:
            try:
                text = frame._now("aria", "body", options)
            except PortError:
                continue  # a frame that went away, refuses scripts or has no body
            if frame is page or frame._frame == 0:
                parts.insert(0, text)
            elif text.strip():
                text = REFS.sub(lambda m: f"[ref=f{frame._frame}{m[1]}]", text)
                parts.append(f"# frame {frame.url}\n{text}")
        return "\n".join(parts)

    def _page_section(self, snapshot: bool = True) -> str:
        page = self.page
        try:
            info = page.worker.call("tabs.get", tab=page.tab)
        except PortError:
            return "### Page\n- The tab was closed."
        said = [f"### Page\n- Page URL: {info['url']}\n- Page Title: {info['title']}"]
        if modal := self._modal_state():
            said.append(modal)
        if snapshot:
            said.append(f"### Snapshot\n```yaml\n{self._snapshot()}\n```")
        return "\n".join(said)

    def _modal_state(self) -> str:
        try:
            frames = self.page.worker.call("mcp.modal", tab=self.page.tab, clear=["dialogs"])
        except PortError:
            return ""
        lines = []
        for frame in frames:
            for dialog in frame.get("dialogs") or []:
                how = "accepted" if dialog["accepted"] else "dismissed"
                lines.append(f"- \"{dialog['type']}\" dialog with message \"{dialog['message']}\": {how} when it opened. "
                             "browser_handle_dialog sets the answer to the next one.")
        if _chooser(frames):
            lines.append("- [File chooser]: can be handled by browser_file_upload")
        return "### Modal state\n" + "\n".join(lines) if lines else ""

    def _resolve(self, target: str) -> tuple[PortFrame, str]:
        """The frame and Playwright selector of a snapshot ref (eN, f<frame>eN) or a selector."""
        if not target:
            raise ToolError("a target is required: a ref from the page snapshot, such as e12")
        target = target.strip()
        if (named := IN_TARGET.search(target)) and not REF.match(target):
            target = named[1]  # a ref quoted with its snapshot line: 'button "Apply" [ref=e4]'
        found = REF.match(target)
        if not found:
            return self.page, target
        frame = self.page if not found[1] else next((f for f in self.page.frames if f._frame == int(found[1])), None)
        selector = f"aria-ref={found[2]}"
        if frame is None or not frame._now("count", selector):
            raise ToolError(f"Ref {target} not found in the current page snapshot. Try capturing new snapshot.")
        return frame, selector

    def _locator(self, target: str, act: str = ""):
        """The element a tool acts on (`act`: what it does to it); never one in a captcha."""
        frame, selector = self._resolve(target)
        if self._in_captcha(frame, selector):
            raise ToolError(CAPTCHA)
        if self._ask and act:
            self._judge(act, frame.eval_on_selector(selector, send_click.ELEMENT))
        return frame.locator(selector)

    def _judge(self, act: str, facts: dict | None) -> None:
        """On Ask Claude's drive: what the real element is, its text and attributes, decides (send_click.judged)."""
        if facts and (refused := send_click.judged(act, facts, self._message)):
            raise ToolError(refused["hookSpecificOutput"]["permissionDecisionReason"])

    @staticmethod
    def _in_captcha(frame: PortFrame, selector: str) -> bool:
        """Whether the element is in a captcha's own frame, or is (or is in) its frame or widget box on the page.
        An element that can't be read is taken for one: a refusal costs Claude a turn, a tick costs the rule."""
        if captcha.in_frame(frame.url) or any(captcha.in_frame(f.url) for f in _ancestors(frame)):
            return True
        try:
            return bool(frame.eval_on_selector(selector, IN_CAPTCHA, captcha.ELEMENTS))
        except PortError:
            return False  # gone: the action fails on its own

    def _after(self, code: str) -> str:
        time.sleep(0.3)  # let the page react, as Playwright MCP waits for it to settle
        return f"### Ran Playwright code\n```js\n{code}\n```\n{self._page_section()}"

    # --- the tools (Playwright MCP 0.0.83's names and inputs)

    def browser_snapshot(self, target: str | None = None, filename: str | None = None, depth=None, boxes=None) -> str:
        if target:
            return f"### Snapshot\n```yaml\n{self._snapshot(target=target, depth=depth)}\n```"
        page = self._page_section(snapshot=False)
        return f"{page}\n### Snapshot\n```yaml\n{self._snapshot(depth=depth)}\n```"

    def browser_find(self, text: str | None = None, regex: str | None = None, filename: str | None = None) -> str:
        if bool(text) == bool(regex):
            raise ToolError("give either text or regex, not both")
        if regex:
            flags = 0
            if found := re.fullmatch(r"/(.*)/([a-z]*)", regex, re.DOTALL):
                regex, flags = found[1], re.IGNORECASE if "i" in found[2] else 0
            matches = re.compile(regex, flags).search
        else:
            def matches(line: str) -> bool:
                return text.casefold() in line.casefold()
        lines = self._snapshot().splitlines()
        hits = [i for i, line in enumerate(lines) if matches(line)]
        if not hits:
            return f"### Result\nNo matches found for \"{text or regex}\"."
        shown = []
        for i in hits[:20]:
            shown.append("\n".join(lines[max(0, i - 2): i + 3]))
        return "### Result\n" + "\n---\n".join(shown)

    def browser_click(self, target: str, element: str = "", doubleClick: bool = False, button: str = "left",
                      modifiers=None) -> str:
        if button != "left":
            raise ToolError(f"a {button} click can't be made on this page; use a left click")
        locator = self._locator(target, "click")
        if doubleClick:
            locator.dblclick(timeout=ACTION_TIMEOUT)
        else:
            locator.click(timeout=ACTION_TIMEOUT, modifiers=modifiers)
        return self._after(f"await page.locator('{locator._selector}').{'dblclick' if doubleClick else 'click'}();")

    def browser_type(self, target: str, text: str, element: str = "", submit: bool = False, slowly: bool = False) -> str:
        locator = self._locator(target, "type")
        if slowly:
            # The box's text is replaced, as a fill's is: typed after what it held, an iCIMS search box
            # searched "New YorkNew York" and found nothing (AMD's, live: KAN-699).
            locator.fill("", timeout=ACTION_TIMEOUT)
            locator.press_sequentially(text, timeout=ACTION_TIMEOUT)
            code = f"await page.locator('{locator._selector}').fill('');\nawait page.locator('{locator._selector}').pressSequentially({json.dumps(text)});"
        else:
            locator.fill(text, timeout=ACTION_TIMEOUT)
            code = f"await page.locator('{locator._selector}').fill({json.dumps(text)});"
        if submit:
            locator.press("Enter", timeout=ACTION_TIMEOUT)
        return self._after(code)

    def browser_fill_form(self, fields: list[dict]) -> str:
        code = []
        for field in fields:
            kind, value = field.get("type"), str(field.get("value", ""))
            locator = self._locator(field.get("target", ""), "click" if kind in ("checkbox", "radio") else "fill")
            if kind in ("checkbox", "radio"):
                locator.set_checked(value.strip().lower() == "true", timeout=ACTION_TIMEOUT)
                code.append(f"await page.locator('{locator._selector}').setChecked({value.strip().lower()});")
            elif kind == "combobox":
                locator.select_option(value, timeout=ACTION_TIMEOUT)
                code.append(f"await page.locator('{locator._selector}').selectOption({json.dumps(value)});")
            else:
                locator.fill(value, timeout=ACTION_TIMEOUT)
                code.append(f"await page.locator('{locator._selector}').fill({json.dumps(value)});")
        return self._after("\n".join(code))

    def browser_select_option(self, target: str, values: list[str], element: str = "") -> str:
        locator = self._locator(target, "select")
        locator.select_option(list(values), timeout=ACTION_TIMEOUT)
        return self._after(f"await page.locator('{locator._selector}').selectOption({json.dumps(list(values))});")

    def browser_file_upload(self, paths: list[str] | None = None) -> str:
        frames = self.page.worker.call("mcp.modal", tab=self.page.tab, clear=[])
        chooser = _chooser(frames)
        if not chooser:
            raise ToolError('The tool "browser_file_upload" can only be used when there is related modal state present.')
        frame_id, token = chooser
        files = []
        for path in paths or []:
            file = Path(path) if Path(path).is_absolute() else self._folder / path
            file = file.resolve()
            if self._folder not in file.parents or not file.is_file():
                raise ToolError(f"File access denied: {path} is outside the working folder or missing")
            files.append(file)
        self.page.worker.call("mcp.modal", tab=self.page.tab, clear=["chooser"])
        if not files:
            return "### Result\nThe file chooser was cancelled."
        frame = self.page if frame_id == 0 else PortFrame(self.page, frame_id)
        frame.locator(f'[data-apply-mcp-chooser="{token}"]').set_input_files(files, timeout=ACTION_TIMEOUT)
        return self._after(f"await fileChooser.setFiles({json.dumps([f.name for f in files])});")

    def browser_press_key(self, key: str) -> str:
        try:
            focused = self.page.evaluate(FOCUS_IN_CAPTCHA, captcha.ELEMENTS)
        except PortError:
            focused = False
        if focused:
            raise ToolError(CAPTCHA)
        if self._ask and len(key) == 1:  # a character: it would go in the focused field
            self._judge("key", self.page.evaluate(send_click.FOCUSED))
        self.page.keyboard.press(key)
        return self._after(f"// Press {key}\nawait page.keyboard.press('{key}');")

    def browser_hover(self, target: str, element: str = "") -> str:
        locator = self._locator(target)
        locator.hover(timeout=ACTION_TIMEOUT)
        return self._after(f"await page.locator('{locator._selector}').hover();")

    def browser_wait_for(self, time: float | None = None, text: str | None = None, textGone: str | None = None) -> str:
        if time is not None:
            _sleep(min(float(time), WAIT_MOST))
        if textGone:
            self.page.get_by_text(textGone).first.wait_for(state="hidden", timeout=ACTION_TIMEOUT)
        if text:
            self.page.get_by_text(text).first.wait_for(state="visible", timeout=ACTION_TIMEOUT)
        said = f"Waited for {text or textGone or f'{time} seconds'}"
        return f"### Result\n{said}\n{self._page_section()}"

    def browser_handle_dialog(self, accept: bool, promptText: str | None = None) -> str:
        self.page.worker.call("mcp.answer", tab=self.page.tab, accept=bool(accept), promptText=promptText)
        how = "accepted" if accept else "dismissed"
        return (f"### Result\nThe next dialog on this page will be {how}. A dialog that already showed was answered "
                f"when it opened (see Modal state); do again what opened it to answer it this way.\n{self._page_section()}")

    def browser_navigate(self, url: str) -> str:
        self.page.goto(url, wait_until="load")
        self.page.worker.call("mcp.arm", tab=self.page.tab)
        return self._after(f"await page.goto('{url}');")

    def browser_navigate_back(self) -> str:
        self.page.go_back()
        return self._after("await page.goBack();")

    def browser_tabs(self, action: str, index: int | None = None, url: str | None = None) -> str:
        pages = self.page.context.pages
        if action == "new":
            page = self.page.context.page(self.page.worker.call("tabs.create", active=False)["tab"])  # never raised
            if url:
                page.goto(url)
            self.page = page
            self.page.worker.call("mcp.arm", tab=page.tab)
        elif action in ("select", "close"):
            at = int(index) if index is not None else next((i for i, p in enumerate(pages) if p.tab == self.page.tab), 0)
            if not 0 <= at < len(pages):
                raise ToolError(f"Tab {at} not found")
            if action == "select":
                self.page = pages[at]  # Claude's tools follow it; the window is never brought forward
                self.page.worker.call("mcp.arm", tab=self.page.tab)
            else:
                closing = pages[at]
                closing.close()
                if closing.tab == self.page.tab:
                    rest = self.page.context.pages
                    if rest:
                        self.page = rest[0]
        elif action != "list":
            raise ToolError(f"no tab action {action}")
        listed = []
        for i, page in enumerate(self.page.context.pages):
            info = page.worker.call("tabs.get", tab=page.tab)
            current = " (current)" if page.tab == self.page.tab else ""
            listed.append(f"- {i}:{current} [{info['title']}]({info['url']})")
        return "### Result\n" + "\n".join(listed)


def _ancestors(frame: PortFrame) -> list[PortFrame]:
    """The frames that hold `frame`, nearest first."""
    found, at = [], frame
    while (at := at.parent_frame) is not None and len(found) < 10:
        found.append(at)
    return found


def _sleep(seconds: float) -> None:
    time.sleep(seconds)


def _chooser(frames: list[dict]) -> tuple[int, str] | None:
    """The newest open file chooser in the tab: (frame, token)."""
    open_ = [(f["chooser"]["at"], f["frame"], f["chooser"]["token"]) for f in frames if f.get("chooser")]
    return max(open_)[1:] if open_ else None


def _text(text: str, error: bool = False) -> dict:
    return {"content": [{"type": "text", "text": text}], **({"isError": True} if error else {})}


class ToolServer:
    """One drive's tool socket: apply.plain.mcp (started by `claude -p`) connects and passes it
    each tool call, run here on the Worker's page. `mcp_server()` is the `--mcp-config` entry."""

    def __init__(self, page: PortPage, folder: Path, python: str, hook: tuple[str, ...] = ()):
        self.tools = Tools(page, folder, hook)
        self.path = socket_folder() / f"mcp-{uuid.uuid4().hex[:12]}.sock"
        self._python = python
        self._server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self._stopped = threading.Event()

    def mcp_server(self) -> dict:
        return {"command": self._python, "args": ["-I", "-m", "apply.plain.mcp", "--socket", str(self.path)]}

    def __enter__(self) -> Self:
        old = os.umask(0o177)
        try:
            self._server.bind(str(self.path))
        finally:
            os.umask(old)
        self._server.listen(4)
        threading.Thread(target=self._accept, daemon=True, name="claude-tools").start()
        return self

    def __exit__(self, *exc) -> None:
        self._stopped.set()
        try:
            self._server.close()
        finally:
            self.path.unlink(missing_ok=True)

    def _accept(self) -> None:
        while not self._stopped.is_set():
            try:
                connection, _ = self._server.accept()
            except OSError:
                return
            threading.Thread(target=self._serve, args=(connection,), daemon=True, name="claude-tool").start()

    def _serve(self, connection: socket.socket) -> None:
        with connection, connection.makefile("r", encoding="utf-8") as lines:
            for line in lines:
                if self._stopped.is_set():
                    return
                try:
                    asked = json.loads(line)
                    said = self.tools.call(asked.get("name"), asked.get("arguments") or {})
                except Exception as error:  # a tool must answer, whatever broke
                    said = _text(f"### Error\n{type(error).__name__}: {error}", error=True)
                try:
                    connection.sendall((json.dumps(said) + "\n").encode())
                except OSError:
                    return


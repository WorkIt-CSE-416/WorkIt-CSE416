"""PortPage: the part of Playwright's sync Page, Frame and Locator API that Apply uses, over a
plain Worker's port (KAN-608).

Names, arguments, defaults (timeouts in ms, 30 s) and errors follow Playwright's, so a Filler
written for a Playwright Page runs on a PortPage. Selectors are built as Playwright's Python
client builds them and matched in the page by Playwright's own injected script, so
`get_by_role`, `get_by_text` and `get_by_label` find what they find today. Actions are synthetic
DOM events (isTrusted: false). Page code (`evaluate`) runs in the page's MAIN world; the Fill
engine goes through the extension's own `engine.call`, which needs no eval.

Errors raise PortError (a playwright.sync_api.Error) and PortTimeoutError (a
playwright.sync_api.TimeoutError), so `except PlaywrightError` keeps working.

What a later slice adds raises NotImplementedError naming the slice (PROTOCOL.md).
"""

import base64
import hashlib
import inspect
import json
import mimetypes
import re
import threading
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from playwright._impl._locator import (
    get_by_label_selector,
    get_by_placeholder_selector,
    get_by_role_selector,
    get_by_test_id_selector,
    get_by_text_selector,
    get_by_title_selector,
)
from playwright._impl._str_utils import escape_for_text_selector

from apply.plain import fixed
from apply.plain.bridge import Connection, PortError, PortTimeoutError
from apply.plain.script import evaluate as evaluate_in

DEFAULT_TIMEOUT = 30000  # ms, as Playwright's
POLL = 0.1  # s between tries of an action whose element is missing or not actionable
FULL_PAGE_MAX = 20000  # CSS px of a page a full-page screenshot covers, from its top
STRIP_S = 0.6  # s a full-page screenshot takes for each viewport of the page
VIEWPORT = "() => ({width: innerWidth, height: innerHeight})"  # page.viewport_size (a fixed function)
NAVIGATED = re.compile(r"context was destroyed|navigat", re.IGNORECASE)
# Page events read from the tab's requests (ops/accounts.js net.watch), by the port's event each comes from.
WATCHED = {"request": "request", "response": "response", "requestfinished": "response", "requestfailed": "requestfailed"}
ROLE_ARGUMENTS = ("checked", "disabled", "expanded", "include_hidden", "level", "name", "pressed", "selected", "exact",
                  "description")


def file_payloads(files) -> list[dict]:
    """Paths or {name, mimeType, buffer} payloads as the ops take files: [{name, mimeType, base64}]."""
    payloads = []
    for file in files if isinstance(files, (list, tuple)) else [files]:
        if isinstance(file, (str, Path)):
            path = Path(file)
            payloads.append({"name": path.name, "mimeType": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
                             "base64": base64.b64encode(path.read_bytes()).decode()})
        else:
            payloads.append({"name": file["name"], "mimeType": file.get("mimeType") or "application/octet-stream",
                             "base64": base64.b64encode(file["buffer"]).decode()})
    return payloads


def later(what: str, slice_: str):
    raise NotImplementedError(f"{what} on a plain Worker comes in {slice_} (apply-agent/docs/plain-workers/PROTOCOL.md)")


def _role(role: str, **options) -> str:
    known = {("includeHidden" if k == "include_hidden" else k): v for k, v in options.items() if k in ROLE_ARGUMENTS}
    return get_by_role_selector(role, **known)


class _Queries:
    """The get_by_* builders a Frame and a Locator share."""

    def locator(self, selector, **filters) -> "PortLocator":
        raise NotImplementedError

    def get_by_role(self, role: str, **options) -> "PortLocator":
        return self.locator(_role(role, **options))

    def get_by_text(self, text, exact: bool | None = None) -> "PortLocator":
        return self.locator(get_by_text_selector(text, exact=exact))

    def get_by_label(self, text, exact: bool | None = None) -> "PortLocator":
        return self.locator(get_by_label_selector(text, exact=exact))

    def get_by_placeholder(self, text, exact: bool | None = None) -> "PortLocator":
        return self.locator(get_by_placeholder_selector(text, exact=exact))

    def get_by_title(self, text, exact: bool | None = None) -> "PortLocator":
        return self.locator(get_by_title_selector(text, exact=exact))

    def get_by_test_id(self, test_id) -> "PortLocator":
        return self.locator(get_by_test_id_selector("data-testid", test_id))


def _filtered(selector: str, has_text=None, has_not_text=None, has=None, has_not=None, visible=None) -> str:
    if has_text:
        selector += f" >> internal:has-text={escape_for_text_selector(has_text, exact=False)}"
    if has is not None:
        selector += " >> internal:has=" + json.dumps(has._selector, ensure_ascii=False)
    if has_not_text:
        selector += f" >> internal:has-not-text={escape_for_text_selector(has_not_text, exact=False)}"
    if has_not is not None:
        selector += " >> internal:has-not=" + json.dumps(has_not._selector, ensure_ascii=False)
    if visible is not None:
        selector += f" >> visible={'true' if visible else 'false'}"
    return selector


class PortFrame(_Queries):
    """One frame of a Worker's tab (frame 0 is the top)."""

    plain = True  # a plain Worker's: apply.submit_guard guards it through apply.plain.guards

    def __init__(self, page: "PortPage", frame: int = 0, url: str = "", parent: int | None = None):
        self._page, self._frame, self._url, self._parent = page, frame, url, parent

    @property
    def page(self) -> "PortPage":
        return self._page

    @property
    def url(self) -> str:
        if self._frame == 0:
            return self._page.url
        return next((f._url for f in self._page.frames if f._frame == self._frame), self._url)

    @property
    def name(self) -> str:
        return ""

    @property
    def parent_frame(self) -> "PortFrame | None":
        return None if self._parent in (None, -1) else next((f for f in self._page.frames if f._frame == self._parent), None)

    def is_detached(self) -> bool:
        return self._frame != 0 and all(f._frame != self._frame for f in self._page.frames)

    # --- the port

    def _dom(self, method: str, *args) -> dict:
        answer = self._page.worker.call("dom", tab=self._page.tab, frame=self._frame, method=method, args=list(args))
        if not isinstance(answer, dict):
            raise PortError("Crash", f"dom.{method}: no answer")
        if "err" in answer:
            error = answer["err"] or {}
            raise PortError(error.get("name", "Error"), f"{error.get('name', 'Error')}: {error.get('message', '')}")
        return answer

    def _now(self, method: str, *args):
        """A dom method's value, once: a missing element is an error, not a wait."""
        answer = self._dom(method, *args)
        if "retry" in answer:
            raise PortError("NotFound", f"{method}: {answer['retry']}")
        return answer["ok"]

    def _until(self, what: str, method: str, *args, timeout: float | None = None):
        """A dom method's value, trying again while it answers retry (Playwright's auto-wait)."""
        timeout = DEFAULT_TIMEOUT if timeout is None else timeout
        deadline = time.monotonic() + timeout / 1000
        reason = ""
        while True:
            self._page._clear_overlays()
            try:
                answer = self._dom(method, *args)
            except PortError as error:
                if error.kind != "Navigated" or time.monotonic() > deadline:
                    raise
                answer = {"retry": "the page navigated"}
            if "retry" not in answer:
                return answer["ok"]
            reason = answer["retry"]
            if timeout and time.monotonic() > deadline:
                raise PortTimeoutError(f"{what}: Timeout {timeout:.0f}ms exceeded.\nCall log:\n  - {reason}")
            time.sleep(POLL)

    # --- locators and page code

    def locator(self, selector, has_text=None, has_not_text=None, has=None, has_not=None) -> "PortLocator":
        selector = selector._selector if isinstance(selector, PortLocator) else selector
        return PortLocator(self, _filtered(selector, has_text, has_not_text, has, has_not))

    def frame_locator(self, selector: str) -> "PortFrameLocator":
        return PortFrameLocator(self, selector)

    def evaluate(self, expression: str, arg: Any = None) -> Any:
        if found := fixed.lookup(expression):  # Apply's own page function: its fixed copy, no eval (KAN-611)
            return self._fixed(*found, arg)
        return evaluate_in(self._page.worker, self._page.tab, expression, arg, self._frame)

    def _fixed(self, name: str, world: str, arg: Any, selector: str | None = None, every: bool = False,
               timeout: float | None = None) -> Any:
        """Fixed function `name` in this frame, on `arg` (and the element `selector` matches, waited for,
        or every one): its value, or its error raised as PortError."""
        timeout = DEFAULT_TIMEOUT if timeout is None else timeout
        deadline = time.monotonic() + timeout / 1000
        while True:
            answer = self._page.worker.call("fixed.call", tab=self._page.tab, frame=self._frame, name=name, world=world,
                                            arg=arg, selector=selector, all=every)
            if not isinstance(answer, dict):
                raise PortError("EvalError", f"fixed.{name}: no answer")
            if "err" in answer:
                error = answer["err"] or {}
                raise PortError("BadOp" if error.get("name") == "BadOp" else "EvalError",
                                f"{error.get('name', 'Error')}: {error.get('message', '')}")
            if "retry" not in answer:
                return answer.get("ok")
            if timeout and time.monotonic() > deadline:
                raise PortTimeoutError(f"Locator.evaluate: Timeout {timeout:.0f}ms exceeded.\nCall log:\n  - {answer['retry']}")
            time.sleep(POLL)

    def evaluate_handle(self, expression: str, arg: Any = None):
        later("evaluate_handle", "a later slice (no handles over the port)")

    def eval_on_selector_all(self, selector: str, expression: str, arg: Any = None) -> Any:
        return self.locator(selector).evaluate_all(expression, arg)

    def eval_on_selector(self, selector: str, expression: str, arg: Any = None) -> Any:
        return self.locator(selector).evaluate(expression, arg)

    def engine_call(self, name: str, args: list) -> dict:
        """FillEngine.call(name, args) in this frame: {value} or {error} (fill_engine.call uses it)."""
        return self._page.worker.call("engine.call", tab=self._page.tab, frame=self._frame, name=name, args=args)

    def load_engine(self) -> None:
        self._page.worker.call("engine.load", tab=self._page.tab, frame=self._frame)

    # --- Frame's selector shortcuts (strict, as Playwright's)

    def click(self, selector: str, **options) -> None:
        self.locator(selector).click(**options)

    def dblclick(self, selector: str, **options) -> None:
        self.locator(selector).dblclick(**options)

    def fill(self, selector: str, value: str, **options) -> None:
        self.locator(selector).fill(value, **options)

    def type(self, selector: str, text: str, **options) -> None:
        self.locator(selector).type(text, **options)

    def press(self, selector: str, key: str, **options) -> None:
        self.locator(selector).press(key, **options)

    def check(self, selector: str, **options) -> None:
        self.locator(selector).check(**options)

    def uncheck(self, selector: str, **options) -> None:
        self.locator(selector).uncheck(**options)

    def select_option(self, selector: str, value=None, **options) -> list[str]:
        return self.locator(selector).select_option(value, **options)

    def set_input_files(self, selector: str, files, **options) -> None:
        self.locator(selector).set_input_files(files, **options)

    def focus(self, selector: str, **options) -> None:
        self.locator(selector).focus(**options)

    def hover(self, selector: str, **options) -> None:
        self.locator(selector).hover(**options)

    def is_visible(self, selector: str, **_) -> bool:
        return self.locator(selector).is_visible()

    def is_hidden(self, selector: str, **_) -> bool:
        return self.locator(selector).is_hidden()

    def is_checked(self, selector: str, **options) -> bool:
        return self.locator(selector).is_checked(**options)

    def is_enabled(self, selector: str, **options) -> bool:
        return self.locator(selector).is_enabled(**options)

    def inner_text(self, selector: str, **options) -> str:
        return self.locator(selector).inner_text(**options)

    def text_content(self, selector: str, **options) -> str | None:
        return self.locator(selector).text_content(**options)

    def input_value(self, selector: str, **options) -> str:
        return self.locator(selector).input_value(**options)

    def get_attribute(self, selector: str, name: str, **options) -> str | None:
        return self.locator(selector).get_attribute(name, **options)

    def wait_for_selector(self, selector: str, state: str = "visible", timeout: float | None = None) -> None:
        self.locator(selector).first.wait_for(state=state, timeout=timeout)

    def wait_for_timeout(self, timeout: float) -> None:
        time.sleep(timeout / 1000)

    def wait_for_function(self, expression: str, arg: Any = None, timeout: float | None = None, polling: Any = None) -> Any:
        timeout = DEFAULT_TIMEOUT if timeout is None else timeout
        deadline = time.monotonic() + timeout / 1000
        every = polling / 1000 if isinstance(polling, (int, float)) else POLL
        while True:
            try:
                value = self.evaluate(expression, arg)
            except PortError as error:
                if not NAVIGATED.search(str(error)):
                    raise
                value = None
            if value:
                return value
            if timeout and time.monotonic() > deadline:
                raise PortTimeoutError(f"Page.wait_for_function: Timeout {timeout:.0f}ms exceeded.")
            time.sleep(every)


class PortLocator(_Queries):
    """A selector resolved in its frame on every call, as a Playwright Locator is."""

    def __init__(self, frame: PortFrame, selector: str):
        self._frame, self._selector = frame, selector

    def __repr__(self) -> str:
        return f"<PortLocator selector={self._selector!r}>"

    @property
    def page(self) -> "PortPage":
        return self._frame.page

    # --- narrowing

    def locator(self, selector, has_text=None, has_not_text=None, has=None, has_not=None) -> "PortLocator":
        inner = selector._selector if isinstance(selector, PortLocator) else selector
        return PortLocator(self._frame, _filtered(f"{self._selector} >> {inner}", has_text, has_not_text, has, has_not))

    def filter(self, has_text=None, has_not_text=None, has=None, has_not=None, visible=None) -> "PortLocator":
        return PortLocator(self._frame, _filtered(self._selector, has_text, has_not_text, has, has_not, visible))

    def nth(self, index: int) -> "PortLocator":
        return PortLocator(self._frame, f"{self._selector} >> nth={index}")

    @property
    def first(self) -> "PortLocator":
        return self.nth(0)

    @property
    def last(self) -> "PortLocator":
        return self.nth(-1)

    def and_(self, other: "PortLocator") -> "PortLocator":
        return PortLocator(self._frame, f"{self._selector} >> internal:and={json.dumps(other._selector, ensure_ascii=False)}")

    def or_(self, other: "PortLocator") -> "PortLocator":
        return PortLocator(self._frame, f"{self._selector} >> internal:or={json.dumps(other._selector, ensure_ascii=False)}")

    def all(self) -> list["PortLocator"]:
        return [self.nth(i) for i in range(self.count())]

    def count(self) -> int:
        return self._frame._now("count", self._selector)

    @property
    def content_frame(self) -> "PortFrameLocator":
        """The frame of the <iframe> this locator finds, as Playwright's Locator.content_frame."""
        return PortFrameLocator(self._frame, self._selector)

    def frame_locator(self, selector: str) -> "PortFrameLocator":
        return PortFrameLocator(self._frame, f"{self._selector} >> {selector}")

    # --- actions

    def _do(self, action: str, method: str, *args, timeout: float | None = None):
        return self._frame._until(f"Locator.{action}", method, self._selector, *args, timeout=timeout)

    def click(self, force: bool = False, timeout: float | None = None, click_count: int = 1, position=None,
              modifiers=None, **_) -> None:
        self._do("click", "click", {"force": force, "clickCount": click_count, "position": position, "modifiers": modifiers},
                 timeout=timeout)

    def dblclick(self, force: bool = False, timeout: float | None = None, **_) -> None:
        self._do("dblclick", "click", {"force": force, "clickCount": 2}, timeout=timeout)

    def tap(self, **options) -> None:
        self.click(**options)

    def fill(self, value: str, force: bool = False, timeout: float | None = None, **_) -> None:
        self._do("fill", "fill", value, {"force": force}, timeout=timeout)

    def clear(self, force: bool = False, timeout: float | None = None, **_) -> None:
        self.fill("", force=force, timeout=timeout)

    def type(self, text: str, delay: float | None = None, timeout: float | None = None, **_) -> None:
        if delay:
            for character in text:
                self._do("type", "type", character, timeout=timeout)
                time.sleep(delay / 1000)
        else:
            self._do("type", "type", text, timeout=timeout)

    def press_sequentially(self, text: str, delay: float | None = None, timeout: float | None = None, **_) -> None:
        self.type(text, delay=delay, timeout=timeout)

    def press(self, key: str, delay: float | None = None, timeout: float | None = None, **_) -> None:
        self._do("press", "press", key, timeout=timeout)

    def set_checked(self, checked: bool, force: bool = False, timeout: float | None = None, **_) -> None:
        self._do("set_checked", "check", checked, {"force": force}, timeout=timeout)

    def check(self, force: bool = False, timeout: float | None = None, **_) -> None:
        self._do("check", "check", True, {"force": force}, timeout=timeout)

    def uncheck(self, force: bool = False, timeout: float | None = None, **_) -> None:
        self._do("uncheck", "check", False, {"force": force}, timeout=timeout)

    def select_option(self, value=None, index=None, label=None, element=None, force: bool = False,
                      timeout: float | None = None, **_) -> list[str]:
        options: list[dict] = []
        for v in [value] if isinstance(value, (str, dict)) else (value or []):
            options.append(v if isinstance(v, dict) else {"valueOrLabel": v})
        options += [{"index": i} for i in ([index] if isinstance(index, int) else (index or []))]
        options += [{"label": text} for text in ([label] if isinstance(label, str) else (label or []))]
        if element is not None:
            later("select_option(element=...)", "a later slice")
        return self._do("select_option", "select", options, {"force": force}, timeout=timeout)

    def set_input_files(self, files, timeout: float | None = None, **_) -> None:
        """Paths or {name, mimeType, buffer} payloads, set on the input through DataTransfer. The bytes
        go down the port as base64; the bridge chunks a message over 512 KiB."""
        self._do("set_input_files", "files", file_payloads(files), timeout=timeout)

    def focus(self, timeout: float | None = None, **_) -> None:
        self._do("focus", "focus", timeout=timeout)

    def blur(self, timeout: float | None = None, **_) -> None:
        self._do("blur", "blur", timeout=timeout)

    def hover(self, force: bool = False, timeout: float | None = None, **_) -> None:
        self._do("hover", "hover", {"force": force}, timeout=timeout)

    def scroll_into_view_if_needed(self, timeout: float | None = None, **_) -> None:
        self._do("scroll_into_view_if_needed", "scroll", timeout=timeout)

    def dispatch_event(self, type: str, event_init: dict | None = None, timeout: float | None = None) -> None:
        self.evaluate("(e, [type, init]) => e.dispatchEvent(new Event(type, {bubbles: true, ...init}))",
                      [type, event_init or {}])

    def highlight(self) -> None:
        pass

    # --- reads

    def _state(self, state: str) -> bool:
        answer = self._frame._now("state", self._selector, state)
        if answer["found"] > 1:
            raise PortError("Strict", f"strict mode violation: {self._selector} resolved to {answer['found']} elements")
        return answer["value"]

    def is_visible(self, **_) -> bool:
        return self._state("visible")

    def is_hidden(self, **_) -> bool:
        return self._state("hidden")

    def _wait_state(self, state: str, timeout: float | None) -> bool:
        self._do(f"is_{state}", "state", "attached", timeout=timeout)
        return self._state(state)

    def is_enabled(self, timeout: float | None = None, **_) -> bool:
        return self._wait_state("enabled", timeout)

    def is_disabled(self, timeout: float | None = None, **_) -> bool:
        return self._wait_state("disabled", timeout)

    def is_editable(self, timeout: float | None = None, **_) -> bool:
        return self._wait_state("editable", timeout)

    def is_checked(self, timeout: float | None = None, **_) -> bool:
        return self._wait_state("checked", timeout)

    def _read(self, action: str, what: str, timeout: float | None):
        return self._do(action, "read", what, timeout=timeout)

    def inner_text(self, timeout: float | None = None, **_) -> str:
        return self._read("inner_text", "innerText", timeout)

    def text_content(self, timeout: float | None = None, **_) -> str | None:
        return self._read("text_content", "textContent", timeout)

    def input_value(self, timeout: float | None = None, **_) -> str:
        return self._read("input_value", "inputValue", timeout)

    def get_attribute(self, name: str, timeout: float | None = None, **_) -> str | None:
        return self._read("get_attribute", f"attribute:{name}", timeout)

    def inner_html(self, timeout: float | None = None, **_) -> str:
        return self.evaluate("e => e.innerHTML", timeout=timeout)

    def all_inner_texts(self) -> list[str]:
        return self._frame._now("read", self._selector, "allInnerTexts")

    def all_text_contents(self) -> list[str]:
        return self._frame._now("read", self._selector, "allTextContents")

    def bounding_box(self, timeout: float | None = None, **_) -> dict | None:
        return self._frame._now("read", self._selector, "box")

    def aria_snapshot(self, timeout: float | None = None, **options) -> str:
        return self._do("aria_snapshot", "aria", options, timeout=timeout)

    def wait_for(self, state: str = "visible", timeout: float | None = None) -> None:
        """Playwright's Locator.wait_for: until the (single) element is attached, detached, visible or hidden."""
        timeout = DEFAULT_TIMEOUT if timeout is None else timeout
        deadline = time.monotonic() + timeout / 1000
        while True:
            try:
                answer = self._frame._now("state", self._selector, state)
            except PortError as error:
                if error.kind != "Navigated":
                    raise
                answer = {"found": 0, "value": False}
            if answer["found"] > 1:
                raise PortError("Strict", f"strict mode violation: {self._selector} resolved to {answer['found']} elements")
            if answer["value"]:
                return
            if timeout and time.monotonic() > deadline:
                raise PortTimeoutError(f"Locator.wait_for: Timeout {timeout:.0f}ms exceeded.\nCall log:\n"
                                       f"  - waiting for {self._selector} to be {state}")
            time.sleep(POLL)

    # --- page code on elements: marked in the isolated world, found by the mark in MAIN

    def _on_marked(self, expression: str, arg: Any, every: bool, timeout: float | None):
        if found := fixed.lookup(expression):  # Apply's own page function: its fixed copy, no eval (KAN-611)
            return self._frame._fixed(*found, arg, selector=self._selector, every=every, timeout=timeout)
        token = uuid.uuid4().hex
        if every:
            self._frame._now("mark", self._selector, token)
        else:
            self._frame._until("Locator.evaluate", "mark", self._selector, token, timeout=timeout)
        try:
            pick = "[...document.querySelectorAll(" + json.dumps(f'[data-apply-mark="{token}"]') + ")]"
            if not every:
                pick += "[0]"
            code = ("async ([__arg]) => { const __f = (\n" + expression.strip().rstrip(";") + "\n); const __e = " + pick +
                    "; if (" + ("false" if every else "!__e") + ") throw new Error('element is gone'); "
                    "return typeof __f === 'function' ? await __f(__e, __arg) : __f; }")
            return self._frame.evaluate(code, [arg])
        finally:
            try:
                self._frame._dom("unmark", token)
            except PortError:
                pass

    def evaluate(self, expression: str, arg: Any = None, timeout: float | None = None) -> Any:
        return self._on_marked(expression, arg, False, timeout)

    def evaluate_all(self, expression: str, arg: Any = None) -> Any:
        return self._on_marked(expression, arg, True, None)

    def element_handle(self, **_):
        later("element_handle", "a later slice (no handles over the port)")

    def screenshot(self, path: str | Path | None = None, type: str | None = None, quality: int | None = None,
                   timeout: float | None = None, **_) -> bytes:
        """The element, cut from the page by scroll and stitch (it may be taller than the window)."""
        self.scroll_into_view_if_needed(timeout=timeout)
        box = self._frame._now("read", self._selector, "box") if self._frame._frame == 0 else None
        if not box:
            raise PortError("NotFound", f"Locator.screenshot: {self._selector} has no box in the top frame")
        return self.page._full(path, type, quality, timeout, clip={**box, "viewport": True})


class _ElementFrame(PortFrame):
    """The frame of an <iframe> in `parent`, found by `selector` on each call (Chrome keeps a frame's
    id across its navigations, but the element may be replaced): what a FrameLocator's locators run in."""

    def __init__(self, parent: PortFrame, selector: str):
        self._page, self._parent_frame, self._selector, self._url, self._parent = parent._page, parent, selector, "", None

    def _id(self) -> int | None:
        """The frame's id, or None while its <iframe> is missing or has no document yet."""
        parent = self._parent_frame
        answer = parent._page.worker.call("frames.of", tab=parent._page.tab, frame=parent._frame, selector=self._selector)
        return answer.get("ok") if isinstance(answer, dict) else None

    @property
    def _frame(self) -> int:
        found = self._id()
        if found is None:
            raise PortError("NotFound", f"waiting for frame locator('{self._selector}')")
        return found

    @_frame.setter
    def _frame(self, _value) -> None:
        pass

    @property
    def parent_frame(self) -> PortFrame:
        return self._parent_frame

    def _dom(self, method: str, *args) -> dict:
        found = self._id()
        if found is None:
            return {"retry": f"waiting for frame locator('{self._selector}')"}
        answer = self._page.worker.call("dom", tab=self._page.tab, frame=found, method=method, args=list(args))
        if isinstance(answer, dict) and "err" in answer:
            error = answer["err"] or {}
            raise PortError(error.get("name", "Error"), f"{error.get('name', 'Error')}: {error.get('message', '')}")
        return answer


class PortFrameLocator(_Queries):
    """Playwright's FrameLocator: locators inside the frame of the <iframe> `selector` finds in `parent`.
    The frame may be on another origin: the extension scripts every frame (`<all_urls>`)."""

    def __init__(self, parent: PortFrame, selector: str):
        self._parent, self._selector = parent, selector

    def __repr__(self) -> str:
        return f"<PortFrameLocator selector={self._selector!r}>"

    @property
    def _inner(self) -> _ElementFrame:
        return _ElementFrame(self._parent, self._selector)

    def locator(self, selector, has_text=None, has_not_text=None, has=None, has_not=None) -> PortLocator:
        inner = selector._selector if isinstance(selector, PortLocator) else selector
        return PortLocator(self._inner, _filtered(inner, has_text, has_not_text, has, has_not))

    def frame_locator(self, selector: str) -> "PortFrameLocator":
        return PortFrameLocator(self._inner, selector)

    @property
    def owner(self) -> PortLocator:
        return PortLocator(self._parent, self._selector)

    def nth(self, index: int) -> "PortFrameLocator":
        return PortFrameLocator(self._parent, f"{self._selector} >> nth={index}")

    @property
    def first(self) -> "PortFrameLocator":
        return self.nth(0)

    @property
    def last(self) -> "PortFrameLocator":
        return self.nth(-1)


class PortRequest:
    """A request the tab made, as Playwright's Request (from webRequest: no headers or body)."""

    def __init__(self, page: "PortPage", message: dict):
        self._page = page
        self.url: str = message.get("requested") or message.get("url", "")
        self.method: str = message.get("method", "GET")
        self.resource_type: str = {"main_frame": "document", "sub_frame": "document", "xmlhttprequest": "fetch"}.get(
            message.get("resource", ""), message.get("resource", "other"))
        self.failure: str | None = message.get("error")
        self.headers: dict = {}
        self.post_data = None
        self.redirected_from = None
        self._frame = message.get("frame", 0)

    def __repr__(self) -> str:
        return f"<PortRequest {self.method} {self.url}>"

    @property
    def frame(self) -> PortFrame:
        return self._page if not self._frame else PortFrame(self._page, self._frame)

    def is_navigation_request(self) -> bool:
        return self.resource_type == "document"

    def all_headers(self) -> dict:
        return {}


class PortResponse:
    """A response the tab got, as Playwright's Response. Its body is known only for a fetch or XHR
    call that isn't a GET (page/net-main.js reads it): json(), text() and body() raise otherwise."""

    def __init__(self, page: "PortPage", message: dict):
        self.request = PortRequest(page, message)
        self.url: str = message.get("url", "")
        self.status: int = int(message.get("status") or 0)
        self.headers: dict = {}
        self._body: str | None = message.get("body")
        self.frame = self.request.frame

    def __repr__(self) -> str:
        return f"<PortResponse {self.status} {self.url}>"

    @property
    def ok(self) -> bool:
        return self.status == 0 or 200 <= self.status <= 299

    @property
    def status_text(self) -> str:
        return ""

    def all_headers(self) -> dict:
        return {}

    def finished(self) -> None:
        return None

    def text(self) -> str:
        if self._body is None:
            raise PortError("NoBody", f"Response.text: the body of {self.request.method} {self.url} isn't read on a plain Worker "
                                      "(only a fetch or XHR call that isn't a GET)")
        return self._body

    def body(self) -> bytes:
        return self.text().encode()

    def json(self) -> Any:
        return json.loads(self.text())


class Keyboard:
    """page.keyboard: keys and text on whatever has focus in the top frame."""

    def __init__(self, page: "PortPage"):
        self._page = page

    def press(self, key: str, delay: float | None = None) -> None:
        self._page._now("keys", key)

    def down(self, key: str) -> None:
        self._page._now("keys", key)

    def up(self, key: str) -> None:
        pass

    def type(self, text: str, delay: float | None = None) -> None:
        for character in text:
            self._page._now("keys", character)
            if delay:
                time.sleep(delay / 1000)

    def insert_text(self, text: str) -> None:
        self._page._now("insert", text)


def _init_script(worker: Connection, script: str | None, path) -> None:
    """add_init_script: a guard's script goes in as its fixed file (apply.plain.guards); any other
    needs chrome.userScripts, so Allow User Scripts on (PortError UserScriptsOff without)."""
    from apply.plain import guards

    script = Path(path).read_text() if path is not None else script
    if not script:
        raise ValueError("add_init_script needs a script or a path")
    worker.call("guard.script", **guards.init_script(script))


def _bind(worker: Connection, tab: int | None, name: str, callback: Callable, context: "PortContext") -> None:
    """expose_binding: window[name] in every frame of the tab (None: every tab), now and on each
    page it loads; a call of it runs `callback(source, *args)` on its own thread (never the bridge's
    reader, so the callback may call the Worker), and returns nothing to the page."""
    bound = worker.__dict__.setdefault("_bindings", set())
    for scope in (tab, None):
        if (scope, name) in bound:
            raise PortError("Error", f'Function "{name}" has been already registered')
    bound.add((tab, name))

    def heard(message: dict) -> None:
        if message.get("name") != name or (tab is not None and message.get("tab") != tab):
            return
        page = context.page(message["tab"])
        frame = page if message.get("frame", 0) == 0 else PortFrame(page, message["frame"])
        source = {"context": page.context, "page": page, "frame": frame}
        threading.Thread(target=callback, args=(source, *message.get("args", [])), daemon=True).start()
    worker.on("binding", heard)
    worker.call("guard.bind", tab=tab, name=name)


def _route_key(tab: int | None, url) -> tuple[str, list[str], bool]:
    """A route's key and its declarativeNetRequest regexes. Only a compiled regex can be one."""
    from apply.plain import guards

    if not isinstance(url, re.Pattern):
        later(f"route({url!r}) with a glob or a predicate", "a later slice (a plain route takes a compiled regex)")
    key = f"{tab}:{hashlib.sha256(url.pattern.encode()).hexdigest()[:16]}"
    return key, guards.alternatives(url.pattern), not url.flags & re.IGNORECASE


def _route(worker: Connection, tab: int | None, url, handler: Callable) -> None:
    """route: a plain Worker's routes run no Python handler; declarativeNetRequest blocks a non-GET
    request matching `url` before it leaves Chrome, as submit_guard._refuse aborts one. Any other
    handler raises NotImplementedError."""
    from apply import submit_guard

    if handler is not submit_guard._refuse:
        later("route with a handler other than submit_guard's", "a later slice (a plain route can only block)")
    key, regexes, case_sensitive = _route_key(tab, url)
    worker.call("guard.route", key=key, tab=tab, regexes=regexes, caseSensitive=case_sensitive)


def _unroute(worker: Connection, tab: int | None, url) -> None:
    worker.call("guard.unroute", key=_route_key(tab, url)[0])


class PortContext:
    """page.context: the Worker's browser, whose tabs are its pages."""

    def __init__(self, worker: Connection):
        self.worker = worker
        self._pages: dict[int, PortPage] = {}

    def page(self, tab: int) -> "PortPage":
        if tab not in self._pages:
            self._pages[tab] = PortPage(self.worker, tab, self)
        return self._pages[tab]

    @property
    def pages(self) -> list["PortPage"]:
        return [self.page(t["tab"]) for t in self.worker.call("tabs.query")]

    def new_page(self) -> "PortPage":
        return self.page(self.worker.call("tabs.create", active=True)["tab"])

    def add_init_script(self, script: str | None = None, path: str | Path | None = None) -> None:
        _init_script(self.worker, script, path)

    def expose_binding(self, name: str, callback: Callable, handle: bool | None = None) -> None:
        _bind(self.worker, None, name, callback, self)

    def expose_function(self, name: str, callback: Callable) -> None:
        self.expose_binding(name, lambda source, *args: callback(*args))

    def route(self, url, handler: Callable, times: int | None = None) -> None:
        _route(self.worker, None, url, handler)

    def unroute(self, url, handler: Callable | None = None) -> None:
        _unroute(self.worker, None, url)

    def cookies(self, *_, **__):
        later("cookies", "a later slice")

    def close(self) -> None:
        for page in self.pages:
            page.close()


class PortPage(PortFrame):
    """One tab of a plain Worker, shaped as a Playwright Page."""

    def __init__(self, worker: Connection, tab: int, context: PortContext | None = None):
        super().__init__(self, 0)
        self.worker, self.tab = worker, tab
        self.context = context or PortContext(worker)
        self.context._pages.setdefault(tab, self)
        self.keyboard = Keyboard(self)
        self._mouse = None
        self._closed = False
        self._listeners: dict[str, list[tuple[Callable, Callable]]] = {}
        self._overlays: list[dict] = []  # add_locator_handler's, in order
        self._clearing = False  # a locator handler is running: its own actions don't run handlers
        self._watching = 0  # listeners that need the tab watched (request, response, popup)
        worker.on("tab.removed", self._removed)

    @classmethod
    def first(cls, worker: Connection) -> "PortPage":
        """The Worker's first tab (Chrome opens one as it starts), as a page."""
        tabs = worker.call("tabs.query")
        context = PortContext(worker)
        return context.page(tabs[0]["tab"]) if tabs else context.new_page()

    def __repr__(self) -> str:
        return f"<PortPage worker={self.worker.worker + 1} tab={self.tab}>"

    def _removed(self, message: dict) -> None:
        if message.get("tab") == self.tab:
            self._closed = True

    # --- navigation and state

    @property
    def url(self) -> str:
        try:
            return self.worker.call("tabs.get", tab=self.tab)["url"]
        except PortError:
            return ""

    def title(self) -> str:
        return self.worker.call("tabs.get", tab=self.tab)["title"]

    def goto(self, url: str, wait_until: str | None = None, timeout: float | None = None, referer=None) -> None:
        timeout = DEFAULT_TIMEOUT if timeout is None else timeout
        self.worker.call("tabs.goto", tab=self.tab, url=url, waitUntil=wait_until or "load", timeout=timeout)

    def reload(self, wait_until: str | None = None, timeout: float | None = None) -> None:
        timeout = DEFAULT_TIMEOUT if timeout is None else timeout
        self.worker.call("tabs.reload", tab=self.tab, waitUntil=wait_until or "load", timeout=timeout)

    def go_back(self, **_) -> None:
        self.evaluate("() => history.back()")
        self.wait_for_load_state()

    def wait_for_load_state(self, state: str | None = None, timeout: float | None = None) -> None:
        timeout = DEFAULT_TIMEOUT if timeout is None else timeout
        self.worker.call("tabs.waitForLoad", tab=self.tab, state=state or "load", timeout=timeout)

    def wait_for_url(self, url, timeout: float | None = None, wait_until: str | None = None) -> None:
        timeout = DEFAULT_TIMEOUT if timeout is None else timeout
        deadline = time.monotonic() + timeout / 1000
        matches = (lambda u: re.search(url, u)) if isinstance(url, re.Pattern) else \
            url if callable(url) else (lambda u: u == url)
        while not matches(self.url):
            if time.monotonic() > deadline:
                raise PortTimeoutError(f"Page.wait_for_url: Timeout {timeout:.0f}ms exceeded.")
            time.sleep(POLL)
        self.wait_for_load_state(wait_until or "load", timeout=max(1, (deadline - time.monotonic()) * 1000))

    def is_closed(self) -> bool:
        if self._closed or self.worker.closed.is_set():
            return True
        try:
            self.worker.call("tabs.get", tab=self.tab)
        except PortError:
            self._closed = True
        return self._closed

    def close(self, **_) -> None:
        if not self.is_closed():
            self.worker.call("tabs.close", tab=self.tab)
        self._closed = True

    def bring_to_front(self) -> None:
        self.worker.call("tabs.activate", tab=self.tab)

    @property
    def main_frame(self) -> PortFrame:
        return self

    @property
    def frames(self) -> list[PortFrame]:
        return [self if f["frame"] == 0 else PortFrame(self, f["frame"], f["url"], f["parent"])
                for f in self.worker.call("frames", tab=self.tab)]

    def frame(self, name: str | None = None, url=None) -> PortFrame | None:
        for frame in self.frames:
            if url is not None and (re.search(url, frame.url) if isinstance(url, re.Pattern) else
                                    url(frame.url) if callable(url) else frame.url == url):
                return frame
        return None

    def screenshot(self, path: str | Path | None = None, type: str | None = None, quality: int | None = None,
                   full_page: bool = False, timeout: float | None = None, **_) -> bytes:
        """The visible part of the tab (captureVisibleTab, about 2 a second per Worker), or with
        `full_page` the whole page, by scroll and stitch (KAN-611)."""
        if full_page:
            return self._full(path, type, quality, timeout)
        kind = type or ("jpeg" if path and str(path).lower().endswith((".jpg", ".jpeg")) else "png")
        data = base64.b64decode(self.worker.call("tabs.screenshot", tab=self.tab, format=kind, quality=quality)["data"])
        if path:
            Path(path).write_bytes(data)
        return data

    def _full(self, path, type, quality, timeout, clip: dict | None = None) -> bytes:
        """Scroll and stitch: a strip a viewport tall about every 0.55 s (captureVisibleTab's quota), fixed
        and sticky elements shown once, at 1 px per CSS px, at most FULL_PAGE_MAX CSS px tall. Its time
        grows with the page: `timeout` (Playwright's 30 s, or the caller's) is only its floor."""
        kind = type or ("jpeg" if path and str(path).lower().endswith((".jpg", ".jpeg")) else "png")
        wait = max((DEFAULT_TIMEOUT if timeout is None else timeout) / 1000, FULL_PAGE_MAX / 600 * STRIP_S + 10)
        shot = self.worker.call("tabs.fullScreenshot", timeout=wait, tab=self.tab, format=kind, quality=quality, clip=clip,
                                maxHeight=FULL_PAGE_MAX)
        data = base64.b64decode(shot["data"])
        if path:
            Path(path).write_bytes(data)
        return data

    def content(self) -> str:
        """The page's HTML, as Playwright's page.content() gives it."""
        return self.worker.call("page.html", tab=self.tab, frame=0, snapshot=False)

    def record_html(self) -> str:
        """The page's HTML for a Record (KAN-611): each field's value as the page shows it, no scripts, no
        Apply note, no password, and a <base> so it opens with its styles."""
        return self.worker.call("page.html", tab=self.tab, frame=0, snapshot=True)

    def set_default_timeout(self, timeout: float) -> None:
        global DEFAULT_TIMEOUT
        DEFAULT_TIMEOUT = timeout

    @property
    def viewport_size(self) -> dict | None:
        return self.evaluate(VIEWPORT)

    # --- events: close, popup, framenavigated, request, response and requestfailed; others are
    # accepted and ignored until their slice wires them

    def _watch(self, more: int) -> None:
        """Count a listener that needs the tab watched (ops/accounts.js net.watch), and start or stop it."""
        before, self._watching = self._watching, max(0, self._watching + more)
        if (before == 0) != (self._watching == 0) and not self.is_closed():
            try:
                self.worker.call("net.watch", tab=self.tab, on=self._watching > 0)
            except PortError:
                pass  # the tab is going: nothing to watch

    def on(self, event: str, handler: Callable) -> None:
        wired: Callable | None = None
        if event in WATCHED:
            def wired(message):
                if message.get("tab") == self.tab:
                    handler(PortRequest(self, message) if event in ("request", "requestfailed") else
                            PortResponse(self, message).request if event == "requestfinished" else PortResponse(self, message))
            self.worker.on(WATCHED[event], wired)
            self._listeners.setdefault(event, []).append((handler, wired))
            self._watch(+1)
            return
        if event == "close":
            def wired(message):
                if message.get("tab") == self.tab:
                    handler(self)
            self.worker.on("tab.removed", wired)
        elif event == "popup":
            # A target=_blank link's tab, or one window.open asked for and Chrome's pop-up blocker refused
            # (no user activation), which the extension opens by its URL with this page as its opener.
            # The extension's tab has no opener in its tab.created, so its popup.blocked names it.
            seen: set[int] = set()

            def wired(message):
                if "popup" in message:  # popup.blocked
                    opened = message["popup"] if message.get("tab") == self.tab else None
                else:  # tab.created
                    opened = message["tab"] if message.get("opener") == self.tab else None
                if opened is not None and opened not in seen:
                    seen.add(opened)
                    handler(self.context.page(opened))
            self.worker.on("tab.created", wired)
            self.worker.on("popup.blocked", wired)
            self._watch(+1)
        elif event == "framenavigated":
            def wired(message):
                if message.get("tab") == self.tab:
                    handler(self if message.get("frame") == 0 else PortFrame(self, message["frame"], message.get("url", "")))
            self.worker.on("navigated", wired)
        if wired:
            self._listeners.setdefault(event, []).append((handler, wired))

    def once(self, event: str, handler: Callable) -> None:
        def one_time(*args):
            self.remove_listener(event, one_time)
            handler(*args)
        self.on(event, one_time)

    def remove_listener(self, event: str, handler: Callable) -> None:
        names = {"close": "tab.removed", "popup": "tab.created", "framenavigated": "navigated", **WATCHED}
        for pair in list(self._listeners.get(event, [])):
            if pair[0] is handler:
                self._listeners[event].remove(pair)
                self.worker.off(names[event], pair[1])
                if event == "popup":
                    self.worker.off("popup.blocked", pair[1])
                if event in WATCHED or event == "popup":
                    self._watch(-1)

    # --- init scripts, bindings and routes (S4: apply.plain.guards)

    def add_init_script(self, script: str | None = None, path: str | Path | None = None) -> None:
        """For every page from now: the Worker's browser is one context (Playwright's is per page, but
        Apply adds init scripts only to a context or its one page)."""
        _init_script(self.worker, script, path)

    def expose_binding(self, name: str, callback: Callable, handle: bool | None = None) -> None:
        _bind(self.worker, self.tab, name, callback, self.context)

    def expose_function(self, name: str, callback: Callable) -> None:
        self.expose_binding(name, lambda source, *args: callback(*args))

    def route(self, url, handler: Callable, times: int | None = None) -> None:
        _route(self.worker, self.tab, url, handler)

    def unroute(self, url, handler: Callable | None = None) -> None:
        _unroute(self.worker, self.tab, url)

    # --- what a later slice adds

    def expect_file_chooser(self, predicate=None, timeout: float | None = None):
        """What the block does asks for a file; `.value` is then its FileChooser (apply.plain.tile)."""
        from apply.plain.tile import expect_file_chooser
        return expect_file_chooser(self, DEFAULT_TIMEOUT if timeout is None else timeout)

    @property
    def mouse(self):
        """Synthetic pointer and mouse events at viewport points (apply.plain.tile.Mouse)."""
        if self._mouse is None:
            from apply.plain.tile import Mouse
            self._mouse = Mouse(self)
        return self._mouse

    # --- locator handlers: an overlay (a cookie banner) cleared before each action, as Playwright's

    def add_locator_handler(self, locator: PortLocator, handler: Callable, no_wait_after: bool | None = None,
                            times: int | None = None) -> None:
        """Run `handler` (given `locator`, if it takes an argument) whenever `locator` shows before an
        action or one of its retries; then wait until it is hidden, unless `no_wait_after`. `times`:
        at most that many runs. Checked from Apply (one `dom` call per action), not by page code."""
        self._overlays.append({"locator": locator, "handler": handler, "wait": not no_wait_after, "times": times})

    def remove_locator_handler(self, locator: PortLocator) -> None:
        self._overlays = [o for o in self._overlays if o["locator"]._selector != locator._selector]

    def _clear_overlays(self) -> None:
        if not self._overlays or self._clearing:
            return
        self._clearing = True
        try:
            for overlay in list(self._overlays):
                locator = overlay["locator"]
                try:
                    shown = locator._frame._now("state", locator._selector, "visible")["value"]
                except PortError:
                    continue  # its frame navigating: checked again before the next try
                if not shown:
                    continue
                handler = overlay["handler"]
                try:
                    takes = len(inspect.signature(handler).parameters)
                except (TypeError, ValueError):
                    takes = 1
                handler(locator) if takes else handler()
                if overlay["times"] is not None:
                    overlay["times"] -= 1
                    if overlay["times"] <= 0:
                        self._overlays.remove(overlay)
                if overlay["wait"]:
                    locator.first.wait_for(state="hidden")
        finally:
            self._clearing = False

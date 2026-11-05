"""The Trace: what happened in one Application, step by step, so one that
went wrong can be read afterwards instead of guessed at.

Each Application a run or rehearsal carries writes one JSON-lines file,
TRACES/<date>/<application id>.jsonl, on this Mac only (it holds the answers
typed into the form, so never the Records repo). A line is one event: `t` is
seconds since the Application started, `kind` says what it is, the rest is
its detail. The kinds:

- start, result: the Posting, and the Result's status, reason and traceback
- error: an exception that left the Application, with its traceback
- nav: the page's main frame went to a new URL
- console: what the page said on its console (the submit guard's
  "Apply ... blocked ..." notes among them, with the request they stopped)
- pageerror: an uncaught error in the page's own code
- request: a non-GET request the page sent; response: one that came back
  4xx/5xx; failed: one that never got an answer (blockedbyclient is a guard's)
- claude: one event of a Claude fill session (Haiku's words, each browser
  tool it called and what came back, cut short), or one `ask`'s answer
- doing: what a rehearsal's tile says Apply is doing now (apply.stuck)
- stuck: a rehearsal's fill made no progress for STUCK_AFTER seconds, not
  waiting on Claude: what it was doing, and where its thread was (its
  Python stack, innermost first). Written once per stall, from a watcher thread

It costs a run no time: every event is one that Playwright or the claude
stream already delivers, appended to the file as it comes, with no extra
page call or wait. Nothing is traced outside `tracing`, so a test's fake
site writes nothing. Traces older than KEEP_DAYS are deleted when a new one
starts. `apply trace` prints one as a timeline."""

import json
import shutil
import threading
import time
import traceback
from contextlib import contextmanager
from datetime import date, timedelta
from pathlib import Path

from apply.home import HOME

TRACES = HOME / "traces"
KEEP_DAYS = 14
CUT = 2000  # characters kept of a long value: a page snapshot, a console line

_current = threading.local()  # each Worker's thread carries one Application at a time


@contextmanager
def tracing(application_id: str, url: str, folder: Path | None = None, today: date | None = None):
    """Trace the Application carried inside this block, on this thread.
    Yields the trace file's path."""
    folder, today = folder or TRACES, today or date.today()
    _prune(folder, today)
    path = folder / today.isoformat() / f"{_safe(application_id)}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", buffering=1) as file:  # line-buffered: a stuck run's trace is readable as it goes
        _current.file, _current.started = file, time.monotonic()
        try:
            event("start", application_id=application_id, url=url)
            yield path
        except BaseException as error:
            event("error", error=f"{type(error).__name__}: {error}", traceback="".join(traceback.format_exception(error)))
            raise
        finally:
            _current.file = None


def event(kind: str, **fields) -> None:
    """Add one event to this thread's trace; outside `tracing`, nothing."""
    to(here(), kind, **fields)


def here() -> tuple | None:
    """This thread's trace, for another thread to add to (`to`); None outside `tracing`."""
    file = getattr(_current, "file", None)
    return None if file is None else (file, _current.started)


def to(trace: tuple | None, kind: str, **fields) -> None:
    """Add one event to `trace` (`here()` on its own thread); for None, nothing."""
    if trace is None:
        return
    file, started = trace
    line = {"t": round(time.monotonic() - started, 3), "kind": kind, **{k: _cut(v) for k, v in fields.items()}}
    try:
        file.write(json.dumps(line, default=str) + "\n")
    except (OSError, ValueError):
        pass  # a trace must never fail the Application it watches


def result(result) -> None:
    event("result", status=str(result.status), reason=result.reason, traceback=result.traceback or None)


def watch(context) -> None:
    """Trace what a Worker's browser context does: every page it has or
    opens. Its listeners write only while an Application is traced."""
    context.on("console", lambda message: event("console", type=message.type, text=message.text))
    context.on("weberror", lambda error: event("pageerror", error=str(error.error)))
    context.on("request", _request)
    context.on("response", _response)
    context.on("requestfailed", lambda request: event(
        "failed", method=request.method, url=request.url, failure=request.failure))
    context.on("page", _page)
    for page in context.pages:
        _page(page)


def claude(stream_event: dict) -> None:
    """One event of a Claude fill session's stream, kept to what says what
    Claude did: its words, its tool calls and their results, the result."""
    kind = stream_event.get("type")
    if kind in ("assistant", "user"):
        for block in (stream_event.get("message") or {}).get("content") or []:
            if isinstance(block, dict) and block.get("type") in ("text", "tool_use", "tool_result"):
                event("claude", role=kind, **{k: v for k, v in block.items() if k not in ("type", "id", "tool_use_id")},
                      block=block["type"])
    elif kind == "result":
        event("claude", block="result", is_error=stream_event.get("is_error"), result=stream_event.get("result"),
              turns=stream_event.get("num_turns"))
    elif kind == "text":  # a line that wasn't JSON: the CLI's own error
        event("claude", block="stderr", text=stream_event.get("text"))


def _page(page) -> None:
    page.on("framenavigated", lambda frame: frame == page.main_frame and event("nav", url=frame.url))


def _request(request) -> None:
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        event("request", method=request.method, url=request.url, type=request.resource_type)


def _response(response) -> None:
    if response.status >= 400:
        event("response", status=response.status, method=response.request.method, url=response.url)


def _cut(value):
    if isinstance(value, str) and len(value) > CUT:
        return value[:CUT] + f"… ({len(value) - CUT} more)"
    if isinstance(value, list):
        return [_cut(v) for v in value]
    if isinstance(value, dict):
        return {k: _cut(v) for k, v in value.items()}
    return value


def _safe(name: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "-" for c in name)[:120] or "application"


def _prune(folder: Path, today: date) -> None:
    oldest = (today - timedelta(days=KEEP_DAYS)).isoformat()
    for day in folder.glob("????-??-??"):
        if day.name < oldest:
            shutil.rmtree(day, ignore_errors=True)


def latest(query: str = "", folder: Path | None = None) -> Path | None:
    """The newest trace whose start names `query` (part of a Posting link,
    a company, an Application id), or the newest of all."""
    for path in sorted((folder or TRACES).glob("*/*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True):
        if not query or query.lower() in path.name.lower() or query.lower() in _first_line(path).lower():
            return path
    return None


def _first_line(path: Path) -> str:
    with open(path) as file:
        return file.readline()


def timeline(path: Path) -> str:
    """A trace as one line per event, for reading."""
    lines = []
    for raw in path.read_text().splitlines():
        try:
            e = json.loads(raw)
        except json.JSONDecodeError:
            continue
        t, kind = e.pop("t", 0), e.pop("kind", "?")
        detail = " ".join(f"{k}={v}" if not isinstance(v, str) else f"{k}={v!r}" for k, v in e.items() if v is not None)
        lines.append(f"{t:8.2f}s {kind:9} {detail}")
    return "\n".join(lines)

"""Never stuck with no way on (KAN-594). While a rehearsal fills, its tile
says what Apply is doing, and offers Resume whenever Apply is stuck or waits:

- Apply waits on Claude (planning answers, researching the company), in a
  step of the fill that can stop that wait (`stoppable`);
- the open page shows a job system's field error (`FIELD_ERROR`, read by the
  window's own connection to the page, so it is seen while the Worker waits);
- no fill progress for STUCK_AFTER seconds.

Resume there stops the wait (`Stopped`: a `claude -p` call is killed), keeps
what Lisul put on the page as his answers (the Filler's `resumed`,
`_Planned.keep`), and goes on from the page as he left it. Questions Claude
had not answered yet are his: they are left as he filled them, or blank and
listed. It never submits and never asks for a new code.

The Worker reports through this module, on its own thread: `watching` (the
rehearsal), `doing` (the tile's line), `waiting` (a Claude call) and
`pressed` (Lisul's press, given once). Outside `watching`, each does nothing.
"""

import sys
import threading
import time
import traceback
from collections.abc import Callable, Iterator
from contextlib import contextmanager

from apply import trace

# Seconds with no fill progress before the tile offers Resume. A Filler's
# longest single wait is 30 s (Playwright's default timeout, Workday's
# TIMEOUT for a page to answer), so a fill that passes 45 s with no new step,
# plan or answer is retrying or waiting on something that will not come.
STUCK_AFTER = 45.0
WAITING = "Apply is waiting on Claude. Fixed the page yourself? Resume stops the wait and goes on from the page"
NO_PROGRESS = "No progress for {:.0f} s. Fix the page if it needs it, then press Resume: Apply goes on from it"
FIELD = "The page shows an error: '{}'. Fix it on the page, then press Resume: Apply goes on from it"
# What the history says of a Resume pressed while Apply was filling.
RESUMED = "Resumed: you pressed Resume while Apply was {}; Apply went on from the page as you left it"

# The first field error the page shows, as its words; "" for none. Each job system's error shapes, as data:
# Workday's (errorHeading, errorBanner, errorMessage, inputAlert), a field's aria-errormessage or
# aria-describedby text once it is marked invalid, role=alert, and any element whose class says error
# (Greenhouse's helper-text--error, Lever's and Ashby's error messages). Apply's own notes (id apply-*)
# and anything that holds a form control (a whole section, not its message) are not errors.
FIELD_ERROR = r"""() => {
  const said = (e) => (e && e.innerText || '').replace(/\s+/g, ' ').trim();
  const shown = (e) => { const box = e.getBoundingClientRect(), style = getComputedStyle(e);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
  const ok = (e) => e && !e.closest('[id^="apply-"]') && shown(e) && !e.querySelector('input, select, textarea')
    && said(e) && said(e).length <= 300;
  const WORKDAY = '[data-automation-id=errorHeading], [data-automation-id=errorBanner], '
    + '[data-automation-id=errorMessage], [data-automation-id=inputAlert]';
  for (const e of document.querySelectorAll(WORKDAY)) if (ok(e)) return said(e);
  for (const field of document.querySelectorAll('[aria-invalid=true]')) {
    const ids = (field.getAttribute('aria-errormessage') || field.getAttribute('aria-describedby') || '').split(/\s+/);
    for (const id of ids) { const e = id && document.getElementById(id); if (ok(e)) return said(e); }
  }
  for (const e of document.querySelectorAll('[role=alert], [class*=error i]')) if (ok(e)) return said(e);
  return '';
}"""
CUT = 160  # characters of the error the tile says
LOOK_S = 5.0  # how often a stall is looked for, to note it in the trace once (KAN-626)
FRAMES = 10  # the innermost frames of a stalled thread's stack that the trace keeps


class Stopped(Exception):
    """Lisul pressed Resume while Apply waited: the wait stops, and the fill goes on from the page."""


_here = threading.local()  # the rehearsal this thread fills, while `watching`


class _Watch:
    def __init__(self, board, worker: int, on_resume: Callable[[str], None]):
        self.board, self.worker, self.on_resume = board, worker, on_resume
        self.doing = ""
        self.stoppable = 0  # how deep in steps of the fill that can stop a wait
        self.at = time.time()  # the fill's last progress
        self.waiting = False  # on Claude: no stall


def _watch() -> "_Watch | None":
    return getattr(_here, "watch", None)


@contextmanager
def watching(board, worker: int, on_resume: Callable[[str], None] = lambda doing: None) -> Iterator[None]:
    """This thread fills Worker `worker`'s rehearsed form, shown on `board`.
    `on_resume(doing)` hears each Resume pressed while it filled, with what Apply was doing."""
    watch = _Watch(board, worker, on_resume)
    was, _here.watch = _watch(), watch
    done = threading.Event()
    noting = threading.Thread(target=_note_stalls, args=(watch, threading.get_ident(), trace.here(), done), daemon=True)
    noting.start()
    try:
        yield
    finally:
        done.set()
        _here.watch = was


def _note_stalls(watch: _Watch, thread: int, traced: tuple | None, done: threading.Event) -> None:
    """Note each stall of `watch`'s fill in its trace, once: what it was doing, and its thread's stack. A stall
    that the tile shows as "No progress" had left nothing to read afterwards (Applied Materials, 2026-11-04)."""
    noted = None
    while traced and not done.wait(LOOK_S):
        at = watch.at
        if watch.waiting or at == noted or time.time() - at <= STUCK_AFTER:
            continue
        noted = at
        frame = sys._current_frames().get(thread)
        stack = "".join(reversed(traceback.format_stack(frame)[-FRAMES:])) if frame else ""  # innermost first: kept if cut
        trace.to(traced, "stuck", doing=watch.doing, seconds=round(time.time() - at), stack=stack)


def doing(what: str) -> None:
    """Say on the tile what Apply is doing now; it counts as progress."""
    if watch := _watch():
        watch.doing, watch.at = what, time.time()
        watch.board.update(watch.worker, doing=what, progress_at=watch.at)
        trace.event("doing", what=what)


def progress() -> None:
    """The fill moved on (a step, an answer), with no new words for the tile."""
    if watch := _watch():
        watch.at = time.time()
        watch.board.update(watch.worker, progress_at=watch.at)


@contextmanager
def stoppable() -> Iterator[None]:
    """A step of the fill that goes on from the page when Resume stops it (it catches Stopped)."""
    watch = _watch()
    if watch:
        watch.stoppable += 1
    try:
        yield
    finally:
        if watch:
            watch.stoppable -= 1


@contextmanager
def waiting() -> Iterator[None]:
    """Apply waits on Claude: inside a `stoppable` step, the tile offers Resume until the call ends."""
    watch = _watch()
    if not watch or not watch.stoppable:
        yield
        return
    watch.waiting, watch.at = True, time.time()
    watch.board.update(watch.worker, waiting=True, progress_at=watch.at)
    try:
        yield
    finally:
        watch.waiting, watch.at = False, time.time()
        watch.board.update(watch.worker, waiting=False, progress_at=watch.at)


def presses() -> Callable[[], bool] | None:
    """Whether Lisul pressed Resume, for a wait on another thread (claude_cli's,
    which stops its `claude -p`); None outside a `stoppable` step."""
    watch = _watch()
    if not watch or not watch.stoppable:
        return None
    return lambda: bool(watch.board.resumed(watch.worker))


def pressed() -> bool:
    """Whether Lisul pressed Resume (each press is given once), inside a `stoppable` step."""
    check = presses()
    return bool(check and check())


def resumed() -> None:
    """A Resume pressed while filling was taken: the rehearsal's history says so."""
    if watch := _watch():
        watch.on_resume(watch.doing)


class Waits:
    """`claude`, with each ask and research a wait that Resume can stop (`waiting`):
    the live adapter kills its `claude -p` (claude_cli), and raises Stopped.
    Claude fill's drive is the fill itself, not a wait: it goes through as it is."""

    def __init__(self, claude):
        self._claude = claude

    def ask(self, **call) -> dict:
        with waiting():
            return self._claude.ask(**call)

    def research(self, **call):
        with waiting():
            return self._claude.research(**call)

    def __getattr__(self, name: str):
        return getattr(self._claude, name)


def field_error(page) -> str:
    """The first field error `page` shows, in its words (cut short); "" for none, or a page that can't be read."""
    try:
        said = str(page.evaluate(FIELD_ERROR) or "")
    except Exception:
        return ""
    return said if len(said) <= CUT else said[:CUT - 1] + "…"


def why(caption: dict, error: str, now: float) -> str:
    """Why a filling tile offers Resume, or "" when it doesn't: the page's field error,
    a wait on Claude, or no progress for STUCK_AFTER seconds."""
    if error:
        return FIELD.format(error)
    if caption.get("waiting"):
        return WAITING
    at = caption.get("progress_at")
    if isinstance(at, (int, float)) and now - at > STUCK_AFTER:
        return NO_PROGRESS.format(now - at)
    return ""

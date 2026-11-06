"""Email code: on a rehearsal page held open for Lisul, after he presses Submit
himself, a job system can ask for a code that it emails (Greenhouse's security
code). Apply reads that code from Gmail and types it into the code field. It
never presses a button: the Submit or Verify after the code stays his.

- The code field is one that shows after his press and was not on the form
  when Apply handed him the page (so a postal code box is never one), with
  each of its boxes empty (he did not type the code himself).
- The mail is the newest from the job system's senders (else the page's own
  domain) that arrived after his press, read with gmail.sure_code: only a
  code the mail names as one. It is looked for every POLL, for at most WAIT,
  in a thread of its own, so the page stays his meanwhile. Apply never asks
  for another code: that is a button.
- The code goes in only if it fits: one character a box where the code has a
  box per character, else the one box. While Apply types, the submit guard is
  back on, so a page that sends itself once its last box is full sends
  nothing; Lisul's own Submit then sends it.
- No mail, no sure code, or a code that does not fit leaves the field empty
  and tells Lisul in the Apply window (Needs you). Nothing is guessed.
- Two held pages whose code lookups overlap on the same senders (Greenhouse
  mails every company's code from one) can't tell whose mail is whose, so
  neither is typed. A code typed into one page is never typed into another.
- A code step that changes while Apply types leaves the page his.
- What it says names only the sender's domain, never the code or the mail.
"""

import re
import threading
from collections.abc import Callable
from datetime import datetime, timedelta
from urllib.parse import urlsplit

from apply import account_pages, greenhouse, workday
from apply.adapters import Clock, Mailbox
from apply.gmail import MailedCode

WAIT = timedelta(minutes=10)
POLL = timedelta(seconds=5)
# A mail stamped a little before the press still counts: Gmail dates it to the second.
SLACK = timedelta(seconds=5)
# Greenhouse's code boxes first, then any box a code goes in.
FIELDS = f"{greenhouse.SECURITY_BOXES}, {greenhouse.SECURITY_BOX}, {account_pages.CODE_BOX}"
# A box whose words name another code, which is never an emailed one.
NOT_A_CODE = re.compile(r"zip|postal|post_code|country|area|promo|coupon|discount|referr|invite|dial", re.IGNORECASE)
# The words of a box, read in the page: its id, name, label, placeholder and autocomplete.
WORDS = "b => [b.id, b.name, b.getAttribute('aria-label'), b.placeholder, b.autocomplete].join(' ')"
# The submit guards on (typing) and off (the page is Lisul's again), in every frame.
ARM = "window.__applyRehearsalLifted = false; window.__applyDriveLifted = false"
DISARM = "window.__applyRehearsalLifted = true; window.__applyDriveLifted = true"
SETTLE_MS = 1000  # how long the guard stays on after the code is in, for a page that sends itself

FILLED = "Code filled from an email from {sender}. Check it and press Submit yourself"
NO_GMAIL = "The job site asked for the code it emailed you, and {why}. Type the code from your email yourself"
NO_MAIL = ("The job site asked for the code it emailed you, and no code email from {senders} came within "
           "{minutes} minutes. Type the code from your email yourself (check spam too)")
UNSURE = ("The job site asked for the code it emailed you. The email from {sender} came, but Apply wasn't sure "
          "which part of it is the code, or it doesn't fit the field, so it left the field empty. Type it yourself")
CROSSED = ("The job site asked for the code it emailed you, but another application you hold asked {sender} for "
           "one at the same time, so Apply can't tell which code is this one's. Type it yourself from your email")
NOT_TYPED = ("The job site asked for the code it emailed you. The email from {sender} came, but the code field "
             "changed while Apply typed it. Check the field and type the code yourself")

# The lookups going on, by Gmail search, and the codes Apply typed (see the
# module's docstring): shared by every held page in this process.
_LOCK = threading.Lock()
_GOING: dict[str, set["EmailCode"]] = {}
_TYPED: set[str] = set()


def search_for(job_system: str, url: str) -> str:
    """The Gmail search for the code a page's job system mails: Greenhouse's
    and Workday's own senders, else the page's domain and its job system's."""
    host = (urlsplit(url).hostname or "").lower()
    if job_system == "greenhouse" or "greenhouse.io" in host:
        return greenhouse.SECURITY_CODE_SEARCH
    if job_system == "workday" or "myworkday" in host:
        return workday.MAIL_SEARCH
    return account_pages.mail_search(host)


class EmailCode:
    """Watches one held page for a code step after each press of Lisul's.
    `pressed` is called as he presses a button that sends; `tick(page)` on
    the page's own thread, often. `tell(status, why)` puts what happened in
    the Apply window: "code filled", or "needs code" when he must type it.
    The first tick, before the page is his, notes the form's own boxes."""

    def __init__(self, mailbox: Mailbox, clock: Clock, job_system: str, tell: Callable[[str, str], None]):
        self._mailbox, self._clock, self._job_system, self._tell = mailbox, clock, job_system, tell
        self._form: set[str] | None = None  # the code-like boxes on the form as Apply handed it over
        self._press: datetime | None = None
        self._thread: threading.Thread | None = None
        self._found: list[MailedCode | None] = []
        self._search = ""
        self._crossed = False  # another page's lookup on the same senders overlapped this one

    def pressed(self, words: str = "") -> None:
        self._press = self._clock.now()

    def tick(self, page) -> None:
        if self._form is None:
            self._form = {key for key, _ in _boxes(page)}
            return
        if self._thread is None:
            if self._press is None or not (boxes := self._new_boxes(page)):
                return
            since, self._press = self._press - SLACK, None
            if why := self._mailbox.unavailable():
                self._tell("needs code", NO_GMAIL.format(why=why.rstrip(".")))
                return
            self._join(search_for(self._job_system, page.url))
            self._found = []
            self._thread = threading.Thread(target=self._look, args=(since,), daemon=True)
            self._thread.start()
            return
        if self._thread.is_alive():
            return
        self._thread = None
        self._leave()
        found = self._found[0] if self._found else None
        if found is None:
            senders = self._search.removeprefix("from:").strip("()").replace(" OR ", " or ")
            self._tell("needs code", NO_MAIL.format(senders=senders, minutes=int(WAIT.total_seconds() // 60)))
            return
        if not (boxes := self._new_boxes(page)):
            return  # no empty code field left: Lisul typed the code himself meanwhile
        if self._crossed:
            self._tell("needs code", CROSSED.format(sender=found.sender))
            return
        try:
            typed = _type(page, [box for _, box in boxes], found.code)
        except Exception:
            self._tell("needs code", NOT_TYPED.format(sender=found.sender))
            return
        if typed:
            with _LOCK:
                _TYPED.add(found.code)
            self._tell("code filled", FILLED.format(sender=found.sender))
        else:
            self._tell("needs code", UNSURE.format(sender=found.sender))

    def _join(self, search: str) -> None:
        """Starts a lookup on `search`, crossing it with any still going."""
        self._search = search
        with _LOCK:
            going = _GOING.setdefault(search, set())
            for other in going:
                other._crossed = True
            self._crossed = bool(going)
            going.add(self)

    def _leave(self) -> None:
        with _LOCK:
            _GOING.get(self._search, set()).discard(self)

    def _new_boxes(self, page) -> list:
        """The code field that came after the form: its visible boxes, each empty."""
        boxes = [(key, box) for key, box in _boxes(page) if key not in (self._form or set())]
        try:
            return boxes if boxes and all(not box.input_value() for _, box in boxes) else []
        except Exception:
            return []

    def _look(self, since: datetime) -> None:
        until = self._clock.now() + WAIT
        while True:
            try:
                found = self._mailbox.find_mailed_code(search=self._search, since=since)
                with _LOCK:
                    taken = found is not None and found.code in _TYPED
                if found and not taken:  # a taken one is another page's: look again for this page's own
                    self._found.append(found)
                    return
            except Exception:
                pass  # Gmail unreachable for a moment: look again
            if self._clock.now() >= until:
                return
            self._clock.sleep_until(min(until, self._clock.now() + POLL))


def _boxes(page) -> list:
    """Every visible box a code could go in, in the first frame that has one,
    as (a key that names it, its locator)."""
    for n, frame in enumerate(page.frames):
        try:
            found = []
            for box in frame.locator(FIELDS).all():
                words = box.evaluate(WORDS)
                if box.is_visible() and not NOT_A_CODE.search(words):
                    found.append((f"{n}|{words}", box))
        except Exception:
            continue  # a frame gone or going
        if found:
            return found
    return []


def _type(page, boxes: list, code: str) -> bool:
    """Type the code: a character a box where there is a box per character,
    else into the one box if it takes the whole code. False if it doesn't fit.
    Only fill(): no click, no Enter. The submit guard is on meanwhile."""
    if len(boxes) > 1 and len(boxes) != len(code):
        return False
    if len(boxes) == 1:
        limit = boxes[0].get_attribute("maxlength")
        if limit and limit.isdigit() and 0 < int(limit) < len(code):
            return False
    _in_frames(page, ARM)
    try:
        for box, part in zip(boxes, list(code) if len(boxes) > 1 else [code]):
            box.fill(part)
        page.wait_for_timeout(SETTLE_MS)
    finally:
        _in_frames(page, DISARM)
    return True


def _in_frames(page, script: str) -> None:
    for frame in page.frames:
        try:
            frame.evaluate(script)
        except Exception:
            continue

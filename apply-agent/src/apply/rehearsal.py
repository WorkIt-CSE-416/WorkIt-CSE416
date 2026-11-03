"""Rehearsals: `apply rehearse <link>...` takes each link through the real
Application path, as `apply run` takes a Request (the job system, Question
set, planner, Claude's essays, the Filler or Claude fill, the Pre-submit
check and its Sonnet re-plan), and stops on the form's last page. Apply
never submits it.

Two lines of defence keep it so. The Worker, rehearsing, returns before any
Filler's submit; and every page it opens carries the submit guard
(submit_guard.py), which blocks a submit click, a POST form's native
submission and each job system's final application request in the page.
Claude fill hears what it blocked while Claude drove, so a Submit click of
Claude's ends the rehearsal in the Handoff a run would make, unsent.
Once a link has ended, Apply no longer drives its page, so the guard comes
off the page held open for Lisul: he checks it and may press Submit himself.

It signs in as a run does: with Google where a job system offers it, else
with the Keychain password, or by making an Employer account (its password
saved to Keychain first) and reading its code or link from Gmail. A sign-in
whose mail can't be read, Gmail not being set up, stops it: "needs sign-in".

Each link runs on its own thread, in its own Worker profile's browser (link
n in profiles/worker-n), so each page can stay open where it stopped.
"""

import queue
import re
import sys
import threading
import time
import traceback
from collections.abc import Callable
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass, field, replace
from pathlib import Path
from urllib.parse import urlsplit

from apply import ashby, eightfold, embedded, greenhouse, lever, trace, workday
from apply.accounts import NEEDS_SIGN_IN, Accounts
from apply.adapters import Adapters, JobSite, SetupError, Tracker
from apply.model import Posting, Status, one_line
from apply.orchestrator import CALIBRATION, WORKERS, by_filler, keep_repair_requests
from apply.profile import ApplicantProfile
from apply.records import Filled, Record
from apply.request import resolve
from apply.rescue import Rescue
from apply.submit_guard import guard, lift, renote
from apply.tracker import Row
from apply.worker import Result, apply_to, keep_sent, named, sent_folder

# Claude fill's cost, which ends its reason; a rehearsal shows it as tokens.
CLAUDE_FILL_COST = re.compile(r"(^|; )Claude fill: \d+ sessions, [^;]*tokens$")
WHY_LENGTH = 300  # of the why on a summary line
READY = "ready to submit"
SIGN_IN = "needs sign-in"
FAILED = "failed"
# How each job system shows that an application went in; any other, by its words.
CONFIRMED = {"greenhouse": greenhouse.confirmed, "lever": lever.confirmed, "ashby": ashby.confirmed,
             "workday": workday.confirmed, "eightfold": eightfold.confirmed}
THANKS = re.compile(r"thank you for (applying|your application|submitting)|application (has been |was )?(submitted|received)"
                    r"|we['’]ve received your application|successfully submitted", re.IGNORECASE)
# The reason of a Tracker row for an Application Lisul submitted himself from a rehearsal.
SUBMITTED_BY_LISUL = "You submitted it yourself from a rehearsal; Apply filled it"
# How long a confirmed page stays open before its window closes, in case a pop-up follows.
CLOSE_AFTER_S = 10
OUTCOMES = {
    Status.HELD: READY,
    Status.HANDOFF: "handoff",
    Status.NOT_ELIGIBLE: "not eligible",
    Status.CLOSED: "closed",
}


@dataclass
class Rehearsed:
    """How one rehearsed link ended, for its summary line."""

    posting: Posting
    outcome: str
    why: str = ""
    title: str = ""  # the page's title where it stopped, when the link named no role
    filled: int = 0  # questions with an answer on the page
    asked: int = 0  # questions the form asked
    missing: tuple[str, ...] = ()
    tokens: int = 0
    seconds: float = 0.0
    record: str = ""  # where its Record is, once filled
    problems: tuple[str, ...] = ()  # what the Pre-submit check and review found wrong on the form
    files: list[dict] = field(default_factory=list)  # each file the form was given, as its tile lists them
    saved: Record | None = None  # its Record as saved, to save again with what Lisul filled in later

    def warning(self) -> str:
        """What to fix on the held page before submitting it, if anything."""
        found = list(self.problems) + [f"Left blank: {q}" for q in self.missing]
        return "; ".join(one_line(f) for f in found)

    def line(self) -> str:
        p = self.posting
        outcome, why = self.outcome, one_line(self.why)
        if len(why) > WHY_LENGTH:
            why = why[:WHY_LENGTH - 1] + "…"  # the Record has it all
        if why:
            outcome += f" (a run would hold it: {why})" if self.outcome == READY else f": {why}"
        return " | ".join([
            p.company or urlsplit(p.url).hostname or p.url,
            p.title or self.title or "(role not named)",
            p.job_system,
            outcome,
            f"{self.filled}/{self.asked} fields filled",
            "Missing facts: " + ("; ".join(self.missing) or "none"),
            f"{self.tokens:,} tokens",
            f"{self.seconds:.0f} s",
        ])


def rehearse(
    urls: list[str], adapters: Adapters, profile: ApplicantProfile, workers: int = WORKERS,
    keep_open: bool = True, out: Callable[[str], None] = print, on_done: Callable[[], object] = lambda: None,
    submitted_to: Tracker | None = None, together: bool = False,
) -> list[Rehearsed]:
    """Rehearse every link, `workers` at a time, printing a summary line as
    each ends. With `keep_open`, each page then stays open where it stopped,
    Lisul's now, until its window is closed or Ctrl-C is pressed: an
    Application he submits from it is kept in `submitted_to` (the Tracker),
    and its note's Fill again fills the form once more, with a new summary
    line. `on_done` runs once every link has ended, before the pages are
    held. With `together`, every link's form waits, open and planned, until
    each link's form is (or its rehearsal ended) and Lisul presses the
    window's Start button; then all start filling at once, a Worker each:
    for filming. Returns the links' first summaries
    in the order they ended."""
    adapters.board.run(mode="rehearsal", queued=len(urls))
    gate = threading.Semaphore(len(urls) if together else workers)
    start = _Together(len(urls) if together else 0, adapters.board.wait_for_start)
    if together:
        adapters.board.run(start="waiting")
    release = threading.Event()  # set: close every page
    if not keep_open:
        release.set()
    finished: queue.Queue[Rehearsed] = queue.Queue()
    calibration = _Calibration(adapters, profile)
    accounts = _Accounts(adapters, profile)

    writing = threading.Lock()
    waiting = [len(urls)]  # links not started yet: the window's "queued"

    def started() -> None:  # a link got its Worker: one fewer queued
        with writing:
            waiting[0] -= 1
            adapters.board.run(queued=waiting[0])

    def one(n: int, url: str) -> None:
        site = _Kept(adapters.site, n)
        done = None

        def submitted(page) -> None:  # Lisul sent the form from the held page
            with writing:
                note = _keep_submission(submitted_to, done, adapters.clock.now().date())
            note += _keep_confirmation(page, done.record)
            adapters.board.update(n, status="submitted", why=note)
            out(" | ".join([done.posting.company or done.title or url, done.posting.title or done.title, note]))

        def held() -> None:  # its form is open and planned: Ready, then Filling once Start is pressed
            if together:
                adapters.board.update(n, stage="ready")
            start.arrive(n)
            if together:
                adapters.board.update(n, stage="")

        try:
            with gate:
                started()
                done = _rehearse(url, site, adapters, profile, calibration.hold, accounts, n, held,
                                 "getting ready" if together else "")
        except SetupError as error:  # before the form opened (no Fill engine, say): one line, no traceback
            done = Rehearsed(Posting("", "", "", url), FAILED, f"setup: {error}")
        finally:
            start.leave(n)
            done = done or Rehearsed(Posting("", "", "", url), FAILED, "the rehearsal stopped")
            finished.put(done)
            try:
                answers = lambda: [(q, a) for q, a in adapters.board.answered(n) if q in done.missing]
                fill = lambda page, q, a: _fill_answer(page, q, a, adapters, profile, n, done, out)
                while site.hold(release, done.posting.job_system, submitted, done.warning(), bool(done.problems),
                                answers, fill):  # Fill again
                    with gate:
                        done = _rehearse(url, site, adapters, profile, calibration.hold, accounts, n)
                    out(done.line())
            finally:
                site.close()

    threads = [threading.Thread(target=one, args=(n, url), daemon=True) for n, url in enumerate(urls)]
    for thread in threads:
        thread.start()
    ended: list[Rehearsed] = []
    # The waits sleep rather than block on a lock: Ctrl-C landing inside
    # Thread.join() leaves that thread looking finished to a later join.
    try:
        while len(ended) < len(urls):
            try:
                ended.append(finished.get_nowait())
            except queue.Empty:
                time.sleep(0.2)
                continue
            out(ended[-1].line())
        on_done()
        if keep_open and any(thread.is_alive() for thread in threads):
            out("Apply submitted nothing. Each browser stays open on the page it reached, yours now: check it and "
                "press Submit yourself to send it (it goes in the Tracker), or Fill again to redo it; "
                "close the windows, or press Ctrl-C, to end.")
        while any(thread.is_alive() for thread in threads):
            time.sleep(0.5)
    except KeyboardInterrupt:
        release.set()
        for thread in threads:
            thread.join(30)
        out("Closed the browsers.")
    return ended


class _Together:
    """Holds each of `count` links at its first fill until every one has
    arrived there or ended and then `start` (the Start button) returns, so
    their forms fill at once. With no links it holds none. A link waits at
    most `timeout` seconds for the others, and for Start as long as it takes."""

    def __init__(self, count: int, start: Callable[[float], None], timeout: float = 900):
        self._holds = count > 0
        self._left = set(range(count))
        self._changed = threading.Condition()
        self._start, self._asked, self._go = start, False, threading.Event()
        self._timeout = timeout

    def arrive(self, n: int) -> None:
        if not self._holds:
            return
        with self._changed:
            self._left.discard(n)
            self._changed.notify_all()
            self._changed.wait_for(lambda: not self._left, timeout=self._timeout)
            first, self._asked = not self._asked, True
        if first:  # one link asks for Start, for all, and waits for it however long Lisul takes
            try:
                self._start(None)
            finally:
                self._go.set()
        self._go.wait()

    def leave(self, n: int) -> None:
        with self._changed:
            self._left.discard(n)
            self._changed.notify_all()


def _rehearse(url: str, site: "_Kept", adapters: Adapters, profile: ApplicantProfile,
              calibration: Callable[[], str], accounts: "_Accounts", n: int,
              before_fill: Callable[[], None] = lambda: None, stage: str = "") -> Rehearsed:
    claude, board = adapters.claude, adapters.board
    started, spent = time.monotonic(), claude.spent()
    posting, result = resolve(url, site)
    behind = greenhouse.board_behind(posting, site)
    if behind == posting and result is None:
        behind = embedded.form_behind(posting, site)  # a Greenhouse, Lever or Ashby form in the page
    if behind != posting:
        posting = replace(resolve(behind.url, site)[0], id=posting.id)  # named by its job system now
    board.update(n, company=posting.company, role=posting.title, job_system=posting.job_system, posting_url=posting.url,
                 application_id=posting.id, status="filling", files=[], stage=stage)
    files: list[dict] = []

    def on_files(given: list[dict]) -> None:
        files[:] = given
        board.update(n, files=given)
    if result is None:
        with trace.tracing(posting.id, posting.url):
            try:
                result = by_filler(
                    posting, site, profile, claude, lambda: accounts(posting),
                    lambda filler, page_site: apply_to(posting, filler, page_site, profile, claude, calibration,
                                                       rehearse=True, bank=adapters.answer_bank,
                                                       today=adapters.clock.now().date(),
                                                       on_files=on_files,
                                                       on_missing=lambda missing, choices, required: board.update(
                                                           n, missing=list(missing), choices=choices, required=required),
                                                       before_fill=before_fill),
                    signed_in=adapters.signed_in,
                )
            except SetupError as error:  # the Mac's setup, not Apply's code: its one line says how to fix it
                result = Result(Status.FAILED, f"setup: {error}")
            except BaseException as error:
                where = "".join(traceback.format_exception(error))
                result = Result(Status.FAILED, f"{type(error).__name__}: {error}", traceback=where)
                # The line says what failed; the log keeps where, for the fix.
                print(f"{posting.company or url}: {where}", file=sys.stderr, flush=True)
            trace.result(result)
    posting = named(posting, result)
    keep_repair_requests(adapters, posting, result)
    rehearsed = _summary(posting, result, site, claude.spent() - spent, time.monotonic() - started)
    rehearsed.files = list(files)
    # Every outcome has its Record, one that stopped before any form was filled too: what the page showed.
    filled = result.filled or Filled((), {}, {}, site.screenshot())
    try:
        saved = Record(posting, result.status, _record_reason(rehearsed), filled, adapters.clock.now().date(),
                       result.essay, result.drafted, result.named_facts)
        rehearsed.record, rehearsed.saved = adapters.records.save(saved), saved
    except Exception as error:
        rehearsed.why = "; ".join(filter(None, [rehearsed.why, f"Record not saved: {error}"]))
    board.update(n, status=rehearsed.outcome, line=rehearsed.line(), why=one_line(rehearsed.why),
                 filled=rehearsed.filled, asked=rehearsed.asked, missing=list(rehearsed.missing),
                 drafted=[f"{q} → {a}" for q, a in result.drafted], choices=result.choices, required=result.required)
    return rehearsed


def _fill_answer(page, question: str, answer: "str | Path | None", adapters: Adapters, profile: ApplicantProfile, n: int,
                 done: Rehearsed, out: Callable[[str], None]) -> None:
    """Lisul's answer in the window to a Missing fact the rehearsed form left
    blank, filled into that one field of its open page by Claude, as a Rescue
    fills one (under the drive guard: it can't send the form), and says how it went."""
    name = done.posting.company or done.title or done.posting.url
    if answer is None:  # an optional question he skipped: left blank, and no longer waiting on him
        done.missing = tuple(q for q in done.missing if q != question)
        out(f"{name} | left '{one_line(question)}' blank: you skipped it")
        adapters.board.update(n, status=done.outcome, filled=done.filled, missing=list(done.missing),
                              line=done.line(), why=one_line(done.why))
        try:
            renote(page, done.warning(), bool(done.problems))
        except Exception:
            pass  # the page closing: nothing to say on it
        return
    if isinstance(answer, Path):  # attached as Lisul named it, from its copy kept with the Application's other files
        day = done.saved.day if done.saved else adapters.clock.now().date()
        answer = keep_sent(sent_folder(done.posting.company, done.posting.id, day), answer)
    try:
        filled = Rescue(adapters.claude, sms_opt_in=profile.policy("sms_opt_in") is True,
                        marketing_opt_in=profile.policy("marketing_opt_in") is True).field(
            page, question, answer, RuntimeError("left blank: the applicant answered it in the Apply window after the form was filled"))
    except Exception as error:
        filled, why = False, f"{type(error).__name__}: {error}"
    else:
        why = "Claude couldn't find the field or it wouldn't take the answer"
    if filled:
        if isinstance(answer, Path):
            adapters.board.file_given(n)  # Claude's click on the form's Attach asked the window for a file too
            done.files = done.files + [{"label": one_line(question), "name": answer.name, "path": str(answer)}]
        done.missing = tuple(q for q in done.missing if q != question)
        done.filled += 1
        _record_again(done, question, answer, adapters)
        out(f"{name} | filled '{one_line(question)}' with your answer")
    else:
        out(f"{name} | couldn't fill '{one_line(question)}' in place ({one_line(why)}): type it on the page, or press Fill again")
    # Its status again, so the window's item for it (kept when the form ended) shows the field filled too,
    # and the note on the form no longer names it left blank.
    adapters.board.update(n, status=done.outcome, filled=done.filled, missing=list(done.missing), files=done.files,
                          line=done.line(), why=one_line(done.why))
    if filled:
        try:
            renote(page, done.warning(), bool(done.problems))
        except Exception:
            pass  # the page closing: nothing to say on it


def _record_again(done: Rehearsed, question: str, answer: "str | Path", adapters: Adapters) -> None:
    """Save the rehearsal's Record again with Lisul's answer to `question`, filled in on the form after it was saved."""
    if done.saved is None:
        return
    filled = done.saved.filled
    names = [q.name for q in filled.questions if q.label.strip() == question.strip()]
    shown = answer.name if isinstance(answer, Path) else answer
    filled = replace(filled, answers=filled.answers | dict.fromkeys(names, answer),
                     readback=filled.readback | dict.fromkeys(names, shown))
    saved = replace(done.saved, filled=filled, reason=_record_reason(done))
    try:
        done.record, done.saved = adapters.records.save(saved), saved
    except Exception as error:
        done.why = "; ".join(filter(None, [done.why, f"Record not saved again: {error}"]))


def _keep_submission(tracker: Tracker | None, rehearsed: Rehearsed, today) -> str:
    """Keep an Application Lisul submitted from a rehearsal in the Tracker as
    submitted, so no run applies to it again. Returns what to tell him."""
    if tracker is None:
        return "you submitted it; no Tracker to keep it in"
    posting = rehearsed.posting
    fields = {"status": Status.SUBMITTED, "date_applied": today, "reason": SUBMITTED_BY_LISUL, "record": rehearsed.record}
    try:
        if tracker.get(posting.id):
            tracker.update(posting.id, **fields)
        else:
            tracker.add(Row(application_id=posting.id, company=posting.company, role=posting.title or rehearsed.title,
                            posting_url=posting.url, job_system=posting.job_system, **fields))
    except Exception as error:  # the Sheet unreachable: say so, so Lisul adds the row himself
        return f"you submitted it, but it is not in the Tracker ({type(error).__name__}: {error}); add its row yourself"
    return "you submitted it; it is in the Tracker"


def _keep_confirmation(page, record: str) -> str:
    """Save a screenshot of the confirmation in the Record's folder before
    its window closes. Returns what to add to the note."""
    shown = ""
    if record and Path(record).is_dir():
        try:
            page.screenshot(path=Path(record) / "confirmation.png", full_page=True)
            shown = f"; its confirmation is in {Path(record) / 'confirmation.png'}"
        except Exception:
            pass  # the window went first: the Tracker row is what counts
    return f"{shown}; its window closes in {CLOSE_AFTER_S:.0f} s"


def _record_reason(rehearsed: Rehearsed) -> str:
    """What the Record says of a rehearsal: not submitted, and how its Pre-submit check went."""
    if rehearsed.outcome != READY:
        return f"Rehearsal, not submitted: {rehearsed.outcome}: {rehearsed.why}"
    reason = "Rehearsal, not submitted. Pre-submit check: " + ("failed." if "Pre-submit" in rehearsed.why else "passed.")
    if rehearsed.missing:
        reason += f" Missing facts left blank: {'; '.join(rehearsed.missing)}."
    if rehearsed.why:
        reason += f" A run would hold it: {rehearsed.why}"
    return reason


def _summary(posting: Posting, result: Result, site: "_Kept", tokens: int, seconds: float) -> Rehearsed:
    outcome, why = OUTCOMES.get(result.status, FAILED), CLAUDE_FILL_COST.sub("", result.reason)
    if result.status == Status.HANDOFF and why.startswith(NEEDS_SIGN_IN):
        outcome, why = SIGN_IN, why.removeprefix(NEEDS_SIGN_IN)
    filled = result.filled
    answered = [q for q in filled.questions if filled.readback.get(q.name) not in (None, "", [])] if filled else []
    return Rehearsed(
        posting, outcome, why, site.title(),
        len(answered), len(filled.questions) if filled else 0, result.missing, tokens, seconds,
        problems=tuple(map(str, result.problems)),
    )


class _Accounts:
    """Each rehearsed link's Accounts, as a run's: Lisul's Keychain and Gmail,
    a new Employer account listed in the Tracker, and a failed password
    sign-in never tried again by another link."""

    def __init__(self, adapters: Adapters, profile: ApplicantProfile):
        self._adapters = adapters
        self._login = profile.get("identity.email")
        self._failed: set[str] = set()
        self._writing = threading.Lock()

    def __call__(self, posting: Posting) -> Accounts:
        a = self._adapters
        return Accounts(a.keychain, a.mailbox, a.clock, self._login, posting.company, self._add, self._failed)

    def _add(self, account) -> None:
        with self._writing:
            self._adapters.tracker.add_employer_account(account)


class _Calibration:
    """Whether a run would hold each rehearsed Application for the Calibration
    run, counting the Tracker's held and submitted rows and this rehearsal's."""

    def __init__(self, adapters: Adapters, profile: ApplicantProfile):
        self._size = profile.policy("calibration_run") or 0
        self._count = sum(row.status in (Status.HELD, Status.SUBMITTED) for row in adapters.tracker.rows())
        self._lock = threading.Lock()

    def hold(self) -> str:
        with self._lock:
            if self._count >= self._size:
                return ""
            self._count += 1
            return CALIBRATION.format(self._count, self._size)


def _confirmed(page, job_system: str) -> bool:
    """Whether the page shows that the application went in. A page still
    loading, or gone, shows nothing yet."""
    try:
        check = CONFIRMED.get(job_system)
        return check(page) if check else page.get_by_text(THANKS).first.is_visible()
    except Exception:
        return False


class _Kept:
    """The job site as one rehearsed link sees it: every page opens in that
    link's own Worker profile, under the submit guard, and the last one
    stays open after the Application ends, until close()."""

    def __init__(self, site: JobSite, worker: int):
        self._site = site
        self._worker = worker
        self._stack: ExitStack | None = None
        self._page = None
        self._lifted = False  # the page was handed to Lisul: its guard is off

    def fetch(self, url: str, body: bytes | None = None) -> bytes:
        return self._site.fetch(url, body)

    @contextmanager
    def open(self, url: str):
        if self._page is not None and not self._lifted and not self._page.is_closed():
            # A second fill after a misread: the form again in the window already open, not a new one.
            self._page.goto(url)
            yield self._page
            return
        self.close()  # a fresh, guarded page for Fill again: the browser of one Worker profile at a time
        stack = ExitStack()
        self._stack = stack
        self._page = stack.enter_context(self._site.open(url, worker=self._worker))
        guard(self._page)
        yield self._page

    def hold(self, release: threading.Event, job_system: str = "", submitted: Callable[[object], None] = lambda page: None,
             warning: str = "", wrong: bool = True, answers: Callable[[], list[tuple[str, str]]] = list,
             fill: Callable[[object, str, str], None] = lambda page, question, answer: None) -> bool:
        """Each answer Lisul gives in the window meanwhile, of `answers()`,
        `fill(page, question, answer)` puts on the page. Keep the page open where it stopped until `release` is set or its
        window is closed. Apply is done with it, so it is Lisul's: the submit
        guard comes off, and his own Submit goes through. Once he has clicked
        one and `job_system` confirms the application went in, `submitted(page)`
        runs, once, and CLOSE_AFTER_S later the window closes, unless a pop-up
        or another page has opened or the confirmation is gone: then it stays
        his to close. Its note shows `warning`, red when an answer is `wrong`. True when he presses
        Fill again: fill the form anew."""
        if self._page is None or release.is_set():
            return False
        pressed, again = [], []
        try:
            lift(self._page, pressed=pressed.append, again=lambda: again.append(True), warning=warning,
                 wrong=wrong)
        except Exception:
            return False  # its browser was quit
        self._lifted = True
        kept, closing = False, None
        while not release.is_set():
            try:
                if self._page.is_closed():
                    return False
                if again:
                    return True
                for question, answer in answers():
                    fill(self._page, question, answer)
                if pressed and not kept and _confirmed(self._page, job_system):
                    kept = True
                    submitted(self._page)
                    closing = time.monotonic() + CLOSE_AFTER_S
                if closing and time.monotonic() > closing:
                    if len(self._page.context.pages) == 1 and _confirmed(self._page, job_system):
                        return False  # done: its window closes
                    closing = None
                self._page.wait_for_timeout(500)
            except Exception:
                return False  # its browser was quit
        return False

    def title(self) -> str:
        try:
            return self._page.title().strip() if self._page else ""
        except Exception:
            return ""

    def screenshot(self) -> bytes:
        """What the page shows now, for a Record; none once it is gone."""
        try:
            return self._page.screenshot(timeout=15_000) if self._page and not self._page.is_closed() else b""
        except Exception:
            return b""

    def close(self) -> None:
        stack, self._stack, self._page, self._lifted = self._stack, None, None, False
        if stack:
            try:
                stack.close()
            except Exception:
                pass  # its browser was already gone (quit, or Ctrl-C reached it first)

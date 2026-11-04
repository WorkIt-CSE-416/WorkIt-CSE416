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
If the job system then asks for a code it emails, Apply types it in from
Gmail (email_code.py) and presses nothing: the Submit after it is his too.

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

from apply import (
    ashby,
    bot_signals,
    captcha,
    eightfold,
    embedded,
    greenhouse,
    lever,
    on_page,
    regenerate,
    stuck,
    tailored,
    trace,
    workday,
)
from apply.accounts import NEEDS_SIGN_IN, Accounts
from apply.adapters import Adapters, JobSite, SetupError, Tracker
from apply.asking import for_essay
from apply.captcha import Waiter
from apply.email_code import EmailCode
from apply.essays import ASK
from apply.model import Posting, Question, Status, one_line
from apply.orchestrator import CALIBRATION, WORKERS, by_filler, keep_repair_requests
from apply.profile import ApplicantProfile
from apply.records import Filled, Record
from apply.request import resolve
from apply.rescue import Rescue
from apply.submit_guard import guard, lift, rearm, renote
from apply.tracker import Row
from apply.verify import verifying
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
# What the tile says when a job system turned Lisul's own Submit down as a bot's (Lever's "error verifying"):
# sending it again from the Worker's Chrome gets the same answer.
TURNED_DOWN = "Nothing went in. {}; the Record has every answer"
THANKS = re.compile(r"thank you for (applying|your application|submitting)|application (has been |was )?(submitted|received)"
                    r"|we['’]ve received your application|successfully submitted", re.IGNORECASE)
# The reason of a Tracker row for an Application Lisul submitted himself from a rehearsal.
SUBMITTED_BY_LISUL = "You submitted it yourself from a rehearsal; Apply filled it"
# What a held page's hold() ends on, besides "" (closed): Lisul pressed Fill again, or Resume.
AGAIN, RESUME = "again", "resume"
# Why a paused rehearsal can't go on, on its Resume button.
TAB_CLOSED = "The form's tab was closed: start it again"
ENDED = "The rehearsal ended: start it again"
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
    history: tuple[str, ...] = ()  # each pause and Resume, "HH:MM Paused: why" / "HH:MM Resumed: ...", in order
    form: "regenerate.Form | None" = None  # each answer Claude wrote, for Lisul to have one written again
    questions: tuple[Question, ...] = ()  # the form's questions, as its Filler read them: where each Missing fact's field is
    where: dict[str, str] = field(default_factory=dict)  # each Missing fact's context line (apply.asking), by question

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
    accounts = _Accounts(adapters, profile, submitted_to or adapters.tracker)

    writing = threading.Lock()
    waiting = [len(urls)]  # links not started yet: the window's "queued"

    def started() -> None:  # a link got its Worker: one fewer queued
        with writing:
            waiting[0] -= 1
            adapters.board.run(queued=waiting[0])

    def one(n: int, url: str) -> None:
        site = _Kept(adapters.site, n)
        done = None
        first = []  # the link's first summary went to `finished` (at its first pause, else at its end)
        after = []  # how the hold of a pause ended, when Lisul didn't press Resume: AGAIN, or "" (closed)

        def submitted(page) -> None:  # Lisul sent the form from the held page
            with writing:
                note = _keep_submission(submitted_to, done, adapters.clock.now().date())
            note += _keep_confirmation(page, done, adapters)
            adapters.board.update(n, status="submitted", why=note)
            out(" | ".join([done.posting.company or done.title or url, done.posting.title or done.title, note]))

        def held() -> None:  # its form is open and planned: Ready, then Filling once Start is pressed
            if together:
                adapters.board.update(n, stage="ready")
            start.arrive(n)
            if together:
                adapters.board.update(n, stage="")

        tells = Waiter(adapters.board, n, adapters.phone, profile, dict)

        def challenged() -> None:  # a captcha after Lisul's own Submit: his to do; Apply only tells him
            tells.tell(done.posting.company)
            adapters.board.update(n, status="handoff", why=captcha.AFTER_HIS_SUBMIT, captcha=True)
            out(" | ".join([done.posting.company or done.title or url, done.posting.title or done.title,
                            "a captcha came up after your Submit: do the captcha yourself"]))

        def turned_down(said: str) -> None:  # the job system refused Lisul's own Submit: only his own Chrome can send it
            why = TURNED_DOWN.format(captcha.blocked(done.posting.company, done.posting.url, said))
            adapters.board.update(n, status="handoff", why=why, blocked=True, resume=None)
            out(" | ".join([done.posting.company or done.title or url, done.posting.title or done.title, why]))

        answers = lambda: [(q, a) for q, a in adapters.board.answered(n) if q in done.missing]
        fill = lambda page, q, a: _fill_answer(page, q, a, adapters, profile, n, done, out)
        # Each answer Claude wrote has its "Add context and regenerate", on the page and in the window (KAN-599).
        redo = _Redo(lambda: done, adapters, profile, n, site, out)
        watching = {}  # the held page's Watch (apply.on_page), anew for each page held

        def tend(page) -> None:
            """Needs you on the held page: each Go to question pressed, and each answer Lisul typed there."""
            watch = watching.get(id(page))
            if watch is None:
                watching.clear()
                watch = watching[id(page)] = on_page.Watch(done.posting.job_system, done.posting.url)
            for asked, reply in adapters.board.wanted(n):
                q = _field_of(done, asked)
                reply(on_page.go_to(page, q) if q else f"'{one_line(asked)}' waits on you no more")
            fields = {}  # each field waiting on Lisul, with the questions it answers (an essay's, each of its asks)
            for asked in done.missing:
                if q := _field_of(done, asked):
                    fields.setdefault(q.name, (q, []))[1].append(asked)
            for q, value in watch.tick(page, [q for q, _ in fields.values()]):
                _answered_on_page(page, q, fields[q.name][1], value, adapters, n, done, out)

        def paused(stopped: Rehearsed, blocked: Callable[[object], str]) -> bool:
            """The fill stopped mid-form for Lisul: hold its page, his to fix, until he presses Resume
            (True: Apply goes on with it), Fill again, or the page closes."""
            nonlocal done
            done = stopped
            start.leave(n)
            if first:
                out(done.line())
            else:
                first.append(True)
                finished.put(done)

            def wants(page) -> bool:  # Lisul pressed Resume, and the page lets it go on
                if not adapters.board.resumed(n):
                    return False
                if why := blocked(page):
                    adapters.board.update(n, status=done.outcome, resume={"ok": True, "why": why})
                    out(f"{_name(done)} | can't resume yet: {why}")
                    return False
                return True
            gate.release()  # a paused form holds no Worker's turn while it waits on him
            try:
                how = site.hold(release, done.posting.job_system, submitted, done.warning(), bool(done.problems),
                                answers, fill, resume=wants, challenged=challenged, refused=turned_down, redo=redo, tend=tend)
            finally:
                gate.acquire()
            if how == RESUME:
                site.rearm()
                return True
            if not how:
                adapters.board.update(n, status=done.outcome, resume={"ok": False, "why": ENDED if release.is_set()
                                                                     else TAB_CLOSED})
            after.append(how)
            return False

        try:
            with gate:
                started()
                done = _rehearse(url, site, adapters, profile, calibration.hold, accounts, n, held,
                                 "getting ready" if together else "", pause=paused)
        except SetupError as error:  # before the form opened (no Fill engine, say): one line, no traceback
            done = Rehearsed(Posting("", "", "", url), FAILED, f"setup: {error}")
        finally:
            start.leave(n)
            done = done or Rehearsed(Posting("", "", "", url), FAILED, "the rehearsal stopped")
            if not first:
                first.append(True)
                finished.put(done)
            elif not after:  # resumed, and now ended
                out(done.line())

            def told(status: str, why: str) -> None:  # the emailed code after Lisul's Submit: in, or his to type
                adapters.board.update(n, status=status, why=why)
                out(" | ".join([done.posting.company or done.title or url, done.posting.title or done.title, why]))

            try:
                hold = lambda: site.hold(release, done.posting.job_system, submitted, done.warning(),
                                         bool(done.problems), answers, fill,
                                         EmailCode(adapters.mailbox, adapters.clock, done.posting.job_system, told),
                                         challenged=challenged, refused=turned_down, redo=redo, tend=tend)
                how = after.pop() if after else hold()
                while how == AGAIN:  # Fill again
                    with gate:
                        done = _rehearse(url, site, adapters, profile, calibration.hold, accounts, n, pause=paused)
                    if not after:
                        out(done.line())
                    how = after.pop() if after else hold()
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


def _name(rehearsed: Rehearsed) -> str:
    return rehearsed.posting.company or rehearsed.title or rehearsed.posting.url


def _rehearse(url: str, site: "_Kept", adapters: Adapters, profile: ApplicantProfile,
              calibration: Callable[[], str], accounts: "_Accounts", n: int,
              before_fill: Callable[[], None] = lambda: None, stage: str = "",
              pause: Callable[[Rehearsed, Callable[[object], str]], bool] = lambda stopped, blocked: False) -> Rehearsed:
    """One fill of the link. A stop mid-form for Lisul goes to `pause` with its
    summary and why Resume can't go on (apply_to's `on_pause`): True, he
    pressed Resume, and the fill goes on on the same page. Each pause and
    Resume is kept in the summary's history, its tile and its Record."""
    claude, board = adapters.claude, adapters.board
    started, spent = time.monotonic(), claude.spent()
    history: list[str] = []
    shown: list[Rehearsed] = []  # each pause's summary, already handed out: the fill's Record goes on them too
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

    def on_pause(stopped: Result, blocked: Callable[[object], str]) -> bool:
        at = adapters.clock.now().strftime("%H:%M")
        summary = _summary(named(posting, stopped), stopped, site, claude.spent() - spent, time.monotonic() - started)
        summary.files = list(files)
        history.append(f"{at} Paused: {one_line(summary.why) or summary.outcome}")
        summary.history = tuple(history)
        shown.append(summary)
        trace.event("pause", reason=stopped.reason)
        board.update(n, status=summary.outcome, line=summary.line(), why=one_line(summary.why), filled=summary.filled,
                     asked=summary.asked, missing=list(summary.missing), resume={"ok": True}, history=list(history))
        if not pause(summary, blocked):
            return False
        history.append(f"{adapters.clock.now().strftime('%H:%M')} Resumed: you pressed Resume; "
                       "Apply went on from the page as you left it")
        trace.event("resume")
        # Filling again: its caption anew, as a fill's start gives it (filling clears the tile).
        board.update(n, company=posting.company, role=posting.title, job_system=posting.job_system,
                     posting_url=posting.url, application_id=posting.id, status="filling", files=list(files),
                     stage="", history=list(history))
        return True
    caption = lambda: {"company": posting.company, "role": posting.title, "job_system": posting.job_system,
                       "posting_url": posting.url, "application_id": posting.id, "files": list(files),
                       "stage": "", "history": list(history)}
    waits = Waiter(board, n, adapters.phone, profile, caption)

    def on_resumed(doing: str) -> None:
        """Lisul pressed Resume while the form filled (apply.stuck): Apply went on from the page."""
        doing = doing[:1].lower() + doing[1:] if doing else "filling the form"
        history.append(f"{adapters.clock.now().strftime('%H:%M')} {stuck.RESUMED.format(doing)}")
        trace.event("resume", doing=doing)
        board.update(n, history=list(history), waiting=False)

    def on_captcha(why: str, page, company: str) -> bool:
        """A captcha stopped the fill: Lisul does it on the page, and the fill goes on by itself."""
        history.append(f"{adapters.clock.now().strftime('%H:%M')} Paused: do the captcha")
        trace.event("captcha", reason=why)
        board.update(n, history=list(history))
        if not waits(why, page, company):
            history.pop()  # its pause (KAN-551) says it again, with the why
            return False
        history.append(f"{adapters.clock.now().strftime('%H:%M')} Resumed: the captcha is done; "
                       "Apply went on from the page")
        trace.event("resume")
        board.update(n, history=list(history))
        return True
    if result is None:
        with trace.tracing(posting.id, posting.url), stuck.watching(board, n, on_resumed):
            try:
                profile = tailored.resume_for(posting, profile, adapters.tailored)
                waited = stuck.Waits(claude)  # a wait on Claude that Lisul's Resume can stop
                result = by_filler(
                    posting, site, profile, waited, lambda: accounts(posting),
                    lambda filler, page_site: apply_to(posting, filler, page_site, profile, waited, calibration,
                                                       rehearse=True, bank=adapters.answer_bank,
                                                       today=adapters.clock.now().date(),
                                                       on_files=on_files,
                                                       on_missing=lambda missing, choices, required, where: board.update(
                                                           n, missing=list(missing), choices=choices, required=required,
                                                           where=where),
                                                       before_fill=before_fill,
                                                       on_verify=lambda verification: board.update(
                                                           n, **verifying(verification)),
                                                       on_pause=on_pause, on_captcha=on_captcha),
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
    rehearsed.history = tuple(history)
    rehearsed.form = result.regenerable
    # Every outcome has its Record, one that stopped before any form was filled too: what the page showed.
    filled = result.filled or Filled((), {}, {}, site.screenshot())
    try:
        saved = Record(posting, result.status, _record_reason(rehearsed), filled, adapters.clock.now().date(),
                       result.essay, result.drafted, result.named_facts,
                       result.verification.as_json() if result.verification else None, rehearsed.history)
        rehearsed.record, rehearsed.saved = adapters.records.save(saved), saved
        for summary in shown:
            summary.record, summary.saved = rehearsed.record, saved
    except Exception as error:
        rehearsed.why = "; ".join(filter(None, [rehearsed.why, f"Record not saved: {error}"]))
    board.update(n, status=rehearsed.outcome, line=rehearsed.line(), why=one_line(rehearsed.why),
                 filled=rehearsed.filled, asked=rehearsed.asked, missing=list(rehearsed.missing),
                 drafted=[f"{q} → {a}" for q, a in result.drafted], choices=result.choices, required=result.required,
                 where=result.where, history=list(history), blocked=bot_signals.BLOCKED in result.bot_signals,  # Open in my Chrome, on his press
                 written=rehearsed.form.shown() if rehearsed.form else [])
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
        _filled_in(page, question, [question], answer, adapters, n, done)
        out(f"{name} | filled '{one_line(question)}' with your answer")
    else:
        out(f"{name} | couldn't fill '{one_line(question)}' in place ({one_line(why)}): type it on the page, or press Fill again")
        # Its status again, so the window's item for it (kept when the form ended) stays as it is.
        adapters.board.update(n, status=done.outcome, filled=done.filled, missing=list(done.missing), files=done.files,
                              line=done.line(), why=one_line(done.why))


def _filled_in(page, field: str, asked: list[str], answer: "str | Path", adapters: Adapters, n: int,
               done: Rehearsed) -> None:
    """The field labelled `field` now holds Lisul's answer to `asked`: they wait on him no more. The Record
    keeps the answer, the window's item for the form (kept when it ended) shows the field filled, and the
    note on the form no longer names it left blank."""
    done.missing = tuple(q for q in done.missing if q not in asked)
    done.filled += 1
    _record_again(done, field, answer, adapters)
    adapters.board.update(n, status=done.outcome, filled=done.filled, missing=list(done.missing), files=done.files,
                          line=done.line(), why=one_line(done.why))
    try:
        renote(page, done.warning(), bool(done.problems))
    except Exception:
        pass  # the page closing: nothing to say on it


def _field_of(done: Rehearsed, asked: str) -> Question | None:
    """The field on the form where Lisul answers `asked`: a Missing fact's own, or for an Essay fact, its essay's."""
    if asked.startswith(ASK):
        where = done.where.get(asked)
        return next((q for q in done.questions if where and for_essay(q) == where), None)
    return next((q for q in done.questions if q.label.strip() == asked.strip()), None)


def _answered_on_page(page, q: Question, asked: list[str], value: str, adapters: Adapters, n: int,
                      done: Rehearsed, out: Callable[[str], None]) -> None:
    """Lisul typed his answer to `asked` into `q`'s field on the held page himself (apply.on_page.Watch):
    it is saved as his answer in Needs you is (the window's `typed`), and waits on him no more."""
    name = done.posting.company or done.title or done.posting.url
    try:
        said = adapters.board.typed(n, asked, value)
    except Exception as error:  # not saved: still his answer on this form
        said = f"not saved ({type(error).__name__}: {error})"
    _filled_in(page, q.label, asked, value, adapters, n, done)
    out(f"{name} | took your answer to '{one_line(asked[0])}' from the page" + (f": {one_line(said)}" if said else ""))


def _record_again(done: Rehearsed, question: str, answer: "str | Path", adapters: Adapters, **more) -> None:
    """Save the rehearsal's Record again with Lisul's answer to `question`, filled in on the form after it was
    saved, and any `more` of its fields."""
    if done.saved is None:
        return
    filled = done.saved.filled
    names = [q.name for q in filled.questions if q.label.strip() == question.strip()]
    shown = answer.name if isinstance(answer, Path) else answer
    filled = replace(filled, answers=filled.answers | dict.fromkeys(names, answer),
                     readback=filled.readback | dict.fromkeys(names, shown))
    saved = replace(done.saved, filled=filled, reason=_record_reason(done), **more)
    try:
        done.record, done.saved = adapters.records.save(saved), saved
    except Exception as error:
        done.why = "; ".join(filter(None, [done.why, f"Record not saved again: {error}"]))


class _Redo:
    """The "Add context and regenerate" of one rehearsed link's held page
    (apply.regenerate): which answers Claude wrote, the presses in the window,
    and writing one again into its field."""

    def __init__(self, done: Callable[[], "Rehearsed | None"], adapters: Adapters, profile: ApplicantProfile, n: int,
                 site: "_Kept", out: Callable[[str], None]):
        self._done, self._adapters, self._profile, self._n, self._site, self._out = done, adapters, profile, n, site, out

    def written(self) -> list[dict]:
        done = self._done()
        return done.form.shown() if done and done.form else []

    def asked(self) -> list[tuple[str, str]]:
        """The regenerates Lisul asked for in the window since the last look, (question name, context) each."""
        return getattr(self._adapters.board, "regenerations", lambda n: [])(self._n)

    def __call__(self, page, name: str, context: str) -> None:
        """Write the answer to `name` again with `context`, put it in its field and keep it in the Record."""
        done, adapters, n = self._done(), self._adapters, self._n
        written = done.form.get(name) if done and done.form else None
        if written is None:
            return
        label = one_line(written.question.label)
        company = _name(done)
        regenerate.working(page, name)
        written.state, written.why = "working", ""
        adapters.board.update(n, status=done.outcome, written=done.form.shown())
        try:
            redone = regenerate.regenerate(adapters.claude, done.form, name, context, self._profile, adapters.answer_bank,
                                           adapters.clock.now().date(), self._site)
        except Exception as error:  # Claude or the research failing: the old answer stays, and he is told
            redone = regenerate.Redone(written.question, why=f"{type(error).__name__}: {error}")
        at = adapters.clock.now().strftime("%H:%M")
        if redone.text:
            note = "New answer from your context" + (f". Check: {'; '.join(redone.checks)}" if redone.checks else "") \
                + ". Edit it if you like; nothing is sent."
            shows = regenerate.done(page, name, redone.text, note, True)
            written.state = ""
            if shows is None:
                written.why = "; ".join(filter(None, [written.why, "not on the page shown: paste it into its field"]))
            elif shows.strip() != redone.text.strip():
                written.why = "; ".join(filter(None, [written.why, "the field shows it otherwise: check it"]))
            regenerate.offer(page, done.form.shown(), None)  # a page loaded from it later knows the new text
            done.history = done.history + (f"{at} Regenerated '{label}' with your context",)
            kind = written.kind
            _record_again(done, written.question.label, redone.text, adapters, history=done.history,
                          essays=done.form.essay_cell() if kind == regenerate.ESSAY else done.saved.essays if done.saved else "",
                          drafted=tuple((q, redone.text if q == label else a) for q, a in done.saved.drafted)
                          if done.saved else ())
            self._out(f"{company} | regenerated '{label}' with your context"
                      + (" (in the Answer bank too)" if redone.banked else ""))
        else:
            written.state, written.why = "failed", redone.why
            regenerate.done(page, name, "", f"Not regenerated: {redone.why}", False)
            self._out(f"{company} | couldn't regenerate '{label}': {one_line(redone.why)}")
        adapters.board.update(n, status=done.outcome, written=done.form.shown(), history=list(done.history),
                              line=done.line(), why=one_line(done.why))


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


def _keep_confirmation(page, done: Rehearsed, adapters: Adapters) -> str:
    """Save the rehearsal's Record again as submitted by Lisul, with a
    screenshot of the confirmation (`after-submit.png`), before its window
    closes. Returns what to add to the note."""
    shown = ""
    if done.saved is not None:
        try:
            shot = page.screenshot(full_page=True)
        except Exception:
            shot = b""  # the window went first: the Record still says submitted
        saved = replace(done.saved, status=Status.SUBMITTED, reason=SUBMITTED_BY_LISUL,
                        filled=replace(done.saved.filled, after_submit=shot or done.saved.filled.after_submit))
        try:
            done.record, done.saved = adapters.records.save(saved), saved
            shown = "; its Record says submitted" + (f", with the confirmation, in {done.record}" if shot else "")
        except Exception as error:
            shown = f"; its Record was not saved again ({type(error).__name__}: {error})"
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
        problems=tuple(map(str, result.problems)), questions=tuple(filled.questions) if filled else (),
        where=dict(result.where),
    )


class _Accounts:
    """Each rehearsed link's Accounts, as a run's: Lisul's Keychain and Gmail,
    a new Employer account listed in `listed_to` (the Tracker that keeps what
    Lisul submits: a live rehearsal's own is a throwaway, but the account is
    real), and a failed password sign-in never tried again by another link."""

    def __init__(self, adapters: Adapters, profile: ApplicantProfile, listed_to: Tracker):
        self._adapters = adapters
        self._listed_to = listed_to
        self._login = profile.get("identity.email")
        self._failed: set[str] = set()
        self._writing = threading.Lock()

    def __call__(self, posting: Posting) -> Accounts:
        a = self._adapters
        return Accounts(a.keychain, a.mailbox, a.clock, self._login, posting.company, self._add, self._failed,
                        rehearsal=True)

    def _add(self, account) -> None:
        with self._writing:
            self._listed_to.add_employer_account(account)


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
        self._bound = False  # the page has lift()'s bindings, which call this hold's hooks below
        self._offered = False  # the page has the regenerate binding (apply.regenerate)
        # A dict, not methods: a binding that held this object would keep its browser from closing when it goes.
        self._hooks: dict[str, Callable] = {}

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
             fill: Callable[[object, str, str], None] = lambda page, question, answer: None,
             code: EmailCode | None = None, resume: Callable[[object], bool] | None = None,
             challenged: Callable[[], None] = lambda: None, refused: Callable[[str], None] = lambda why: None,
             redo: "_Redo | None" = None,
             tend: Callable[[object], None] = lambda page: None) -> str:
        """Each answer Lisul gives in the window meanwhile, of `answers()`,
        `fill(page, question, answer)` puts on the page. Keep the page open where it stopped until `release` is set or its
        window is closed. Apply is done with it, so it is Lisul's: the submit
        guard comes off, and his own Submit goes through. Once he has clicked
        one and `job_system` confirms the application went in, `submitted(page)`
        runs, once, and CLOSE_AFTER_S later the window closes, unless a pop-up
        or another page has opened or the confirmation is gone: then it stays
        his to close. Its note shows `warning`, red when an answer is `wrong`. When a
        press of his brings a step asking for an emailed code, `code` types it
        in and presses nothing. AGAIN when he presses Fill again: fill the form anew.
        A paused rehearsal passes `resume(page)`, whether Lisul pressed Resume and
        it can go on: then RESUME, with the page still his until rearm().
        A captcha that shows after a press of his calls `challenged()`, once:
        he does it himself, and Apply never touches it. A bot block after a press
        of his (Lever's captcha turning the token down) calls `refused(said)`, once.
        Each answer Claude wrote, of `redo.written()`, gets an "Add context and
        regenerate" button beside its field; each press, there or in the window
        (`redo.asked()`), goes to `redo(page, name, context)`.
        `tend(page)` runs on each turn: Needs you on the page (Go to question, and answers typed there).
        "" when the page closed or `release` was set."""
        if self._page is None or release.is_set():
            return ""
        pressed, again, hooks, regenerates = [], [], self._hooks, []

        def heard(words: str) -> None:
            pressed.append(words)
            if code:
                code.pressed(words)
        hooks |= {"pressed": heard, "again": lambda: again.append(True),
                  "regenerate": lambda name, context: regenerates.append((name, context))}
        try:
            if code:
                code.tick(self._page)  # the form as Apply hands it over, before any press of his
            lift(self._page, pressed=lambda words: hooks["pressed"](words), again=lambda: hooks["again"](),
                 warning=warning, wrong=wrong, bound=self._bound)
        except Exception:
            return ""  # its browser was quit
        self._lifted = self._bound = True
        if redo and (written := redo.written()):
            try:
                regenerate.offer(self._page, written, None if self._offered else
                                 lambda name, context: hooks["regenerate"](name, context))
                self._offered = True
            except Exception:
                pass  # the page closing: the window's button still says so
        kept, closing, told, turned_down = False, None, False, False
        while not release.is_set():
            try:
                if self._page.is_closed():
                    return ""
                if again:
                    return AGAIN
                if resume and not pressed and resume(self._page):
                    return RESUME
                for question, answer in answers():
                    fill(self._page, question, answer)
                if redo:
                    asked, regenerates[:] = regenerates + redo.asked(), []
                    for name, context in asked:
                        redo(self._page, name, context)
                if not pressed:  # once he pressed Submit, the form is his to send: nothing more is read off it
                    tend(self._page)
                if code and not kept:
                    code.tick(self._page)
                if pressed and not kept and not told and captcha.shows(self._page):
                    told = True
                    challenged()
                if pressed and not kept and not turned_down and (why := captcha.blocks(self._page)):
                    turned_down = True
                    refused(why)
                if pressed and not kept and _confirmed(self._page, job_system):
                    kept = True
                    submitted(self._page)
                    closing = time.monotonic() + CLOSE_AFTER_S
                if closing and time.monotonic() > closing:
                    if len(self._page.context.pages) == 1 and _confirmed(self._page, job_system):
                        return ""  # done: its window closes
                    closing = None
                self._page.wait_for_timeout(500)
            except Exception:
                return ""  # its browser was quit
        return ""

    def rearm(self) -> None:
        """Apply drives the held page again (Resume): the submit guard goes back on, with no reload."""
        if self._page is not None:
            rearm(self._page)
        self._lifted = False

    def is_open(self) -> bool:
        try:
            return self._page is not None and not self._page.is_closed()
        except Exception:
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
        stack, self._stack, self._page, self._lifted, self._bound = self._stack, None, None, False, False
        self._offered = False
        self._hooks = {}
        if stack:
            try:
                stack.close()
            except Exception:
                pass  # its browser was already gone (quit, or Ctrl-C reached it first)

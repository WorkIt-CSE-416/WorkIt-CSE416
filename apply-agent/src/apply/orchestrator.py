"""The Orchestrator hands Requests, then Matches, to Workers and is the one
writer of the Tracker."""

import hashlib
import queue as queues
import re
import sys
import threading
import traceback
from collections import Counter, deque
from collections.abc import Callable, Collection, Iterable
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from datetime import date, datetime, timedelta

from apply import (
    already_applied,
    asking,
    bot_signals,
    captcha,
    description,
    embedded,
    fill_engine,
    greenhouse,
    oracle,
    tailored,
    trace,
    walls,
)
from apply.accounts import Accounts, failed_sites
from apply.adapters import (
    Adapters,
    Claude,
    JobSite,
    SetupError,
    UsageLimitHit,
    UsageReading,
)
from apply.answer_bank import Entry
from apply.answer_bank import key as bank_key
from apply.captcha import Waiter
from apply.claude_fill import ClaudeFill, OnePage
from apply.feed import repost_keys
from apply.fillers import FILLERS
from apply.match_queue import match_queue, over_employer_limits
from apply.model import Posting, Status, one_line
from apply.notify import TITLE, WAITING, summary, used_again, waiting
from apply.profile import ApplicantProfile
from apply.records import Record
from apply.repair import requests_for
from apply.request import is_request, resolve
from apply.rescue import Rescue
from apply.tracker import AnswerRow, EmployerAccount, Row, options_cell
from apply.verify import verifying
from apply.worker import Result, apply_to, named

WORKERS = 3
# No Application starts once Lisul's Max plan is this far through a window,
# which leaves the rest for his own Claude work.
FIVE_HOUR_STOP = 0.85
WEEKLY_STOP = 0.70
# How long to wait when usage is too high but Claude didn't say when it resets.
UNKNOWN_RESET_WAIT = timedelta(minutes=30)
# The reason on a Filling row while its form is being submitted. A run that
# finds one was interrupted mid-submit, so it must never submit that form again.
SUBMITTING = "submitting"
INTERRUPTED_SUBMIT = (
    "Apply stopped while submitting this Application, so it may have been submitted. "
    "Check for a confirmation email; Apply won't submit it again."
)
# Rows a new run picks up again: never started, paused at a limit, or
# interrupted before submitting.
UNFINISHED = {Status.QUEUED, Status.PAUSED, Status.FILLING}
# Noted on a Missing fact row once Lisul's answer is used, so an answer is used once.
ANSWER_USED = "Saved your answer {!r}. "
# Starts the reason of an approved Hold held again, with the fingerprint of
# the Essay cell it was filled from. Apply can't untick Approve, so the same
# approval is never tried twice: it is tried again once the Essay cell
# changes, or once a pass sees Approve unticked (which drops this note).
HELD_AGAIN = "Held again after your approval [{}] (edit the Essay, or untick Approve for a pass, to try again): "
# Why an Application is held for the Calibration run: its number, and the run's size.
CALIBRATION = "Calibration run: Application {} of {}, held so you can judge Claude's answers"
# Noted on a Request's row when it goes over an employer's own limit: a Request is applied to anyway.
OVER_LIMIT = "Over an employer limit, applied to anyway as your Request: "
# Said in the run's output when the Daily cap (policies.yaml: daily_cap) stops it taking Matches.
DAILY_CAP_REACHED = (
    "Daily cap reached: {} new Matches applied to today (policies.yaml: daily_cap); "
    "{} more wait for tomorrow. Requests and approved Holds still go ahead."
)
HELD_AGAIN_NOTE = re.compile(re.escape(HELD_AGAIN).replace(r"\{\}", r"(\w+)"))


def run(
    adapters: Adapters, profile: ApplicantProfile, workers: int = WORKERS, matches: bool = True, requests: bool = True,
) -> None:
    """Submit every Hold Lisul approved, then apply to every waiting Request
    unless `requests` is False, then to the Match queue unless `matches` is False.
    Every run, even one for Requests only, takes approvals first, so an
    approval waits no longer than the next 5-minute Requests check."""
    accounts_before = len(adapters.tracker.employer_accounts())
    this_run = _Run(adapters, profile)
    this_run.list_answers()
    this_run.go(workers, matches, requests)
    new_accounts = len(adapters.tracker.employer_accounts()) - accounts_before
    reused = list(this_run.reused.values())
    if reused:
        print(f"Unreviewed drafts used again (review them in the Answers tab): {used_again(reused)}")
    adapters.notifier.notify(TITLE, summary(this_run.statuses, new_accounts, list(this_run.drafted.values()), reused))
    _push(adapters, profile, this_run.waiting)


def _push(adapters: Adapters, profile: ApplicantProfile, applications: list[tuple[Status, str, str, str]]) -> None:
    """One push to Lisul's phone listing the run's new Holds, Handoffs and
    Missing facts, while the phone_push policy is on and an ntfy topic is set
    up. A push that fails is said and the run goes on: the Tracker has them all."""
    if not applications or profile.policy("phone_push") is not True or adapters.phone is None:
        return
    try:
        adapters.phone.notify(*waiting(applications))
    except Exception as failed:
        print(f"Couldn't push the Applications waiting on you to your phone ({failed}); "
              "the Tracker lists them.", file=sys.stderr)


class _Run:
    def __init__(self, adapters: Adapters, profile: ApplicantProfile):
        self._adapters = adapters
        self._profile = profile
        self._writing = threading.Lock()
        self.statuses: Counter = Counter()  # how this run's Applications ended
        self.drafted: dict[str, tuple[str, str]] = {}  # new answers Claude drafted this run, by the bank's key
        self.waiting: list[tuple[Status, str, str, str]] = []  # (status, company, role, reason) left for Lisul
        # unreviewed drafts the bank answered a form with this run, with their latest uses, by the bank's key
        self.reused: dict[str, tuple[str, str, int]] = {}
        self._answers: dict[str, dict[str, str]] = {}  # Lisul's Missing fact answers, by Application ID
        self._calibrating: set[str] = set()  # Applications this run held for the Calibration run
        self._approved: dict[str, str] = {}  # the Essay cell of each Hold Lisul approved, by Application ID
        self._submitting: set[str] = set()  # Applications whose form is being submitted
        # The Tracker is read once; this run's own writes keep what it needs current.
        self._rows = adapters.tracker.rows()
        self._ids = {row.application_id for row in self._rows}
        self._keys: set = set()  # every row's Repost keys
        self._request_keys: set = set()  # Request rows' Repost keys
        self._filled = set()  # rows held or submitted (or being submitted): the Calibration run so far
        self._recorded: dict[str, Row] = {}  # this run's Applications as they ended, for employer limits
        for row in self._rows:
            self._note(row.application_id, row.posting_url, row.status, row.reason)
        # Sites whose password sign-in failed: no Application tries them again.
        self._failed_sign_ins = failed_sites([row.reason for row in self._rows])
        self._listed: set[str] = set()  # Answer bank entries the Answers tab lists, by the bank's key
        # Matches applied to today, in earlier runs and this one, by Application ID: the Daily cap's count.
        today = adapters.clock.now().date()
        self._applied_today = {row.application_id for row in self._rows if _applied_on(today, row)}

    def list_answers(self) -> None:
        """Copy Lisul's edits in the Tracker's Answers tab into the Answer bank,
        then list there every answer in the bank it lacks (drafted in a
        rehearsal, say), so he sees each one."""
        tracker, bank = self._adapters.tracker, self._adapters.answer_bank
        rows = tracker.answers()
        bank.take_edits(rows)
        self._listed = {bank_key(row.question) for row in rows}
        for entry in bank.entries():
            self._list(entry)

    def _list(self, entry: Entry) -> None:
        if bank_key(entry.question) in self._listed:
            return
        shown = "; ".join(entry.answer) if isinstance(entry.answer, list) else entry.answer
        with self._writing:
            self._adapters.tracker.add_answer(AnswerRow(
                entry.question, shown, entry.reviewed, shown, entry.options, entry.company, entry.first_seen,
            ))
        self._listed.add(bank_key(entry.question))

    def go(self, workers: int, matches: bool, with_requests: bool) -> None:
        requests, queue = self._to_apply(matches, with_requests)
        if unchecked := self._adapters.applied_before.problem():  # KAN-621: never a silent pass
            print(already_applied.UNCHECKED.format(unchecked), file=sys.stderr)
            self._adapters.board.run(unchecked=already_applied.UNCHECKED.format(unchecked))
        free = list(range(workers))  # Worker numbers; each Worker has its own Worker profile
        running: dict[Future, tuple[Posting, int]] = {}
        sent_in: queues.SimpleQueue[tuple[str, int]] = queues.SimpleQueue()  # `apply rehearse --into`'s links
        wanted: dict[str, int] = {}  # a link sent in, by Application ID: the Worker it was sent into

        def into(url: str, worker: int) -> dict:
            """A link sent into a run's window (KAN-645): a Request ahead of all, in that Worker's running
            plain Chrome as soon as it is free, so its sign-in serves it."""
            from apply.answers_tab import (
                Refused,  # imported here: answers_tab imports the adapters
            )
            if not getattr(self._adapters.site, "running", lambda k: False)(worker):
                raise Refused(f"Browser {worker + 1} isn't a running plain Worker.", 409)
            sent_in.put((url, worker))
            return {"tile": worker, "worker": worker}
        if taking := getattr(self._adapters.board, "taking", None):
            taking(into)
        with ThreadPoolExecutor(workers) as pool:
            while True:
                while not sent_in.empty():
                    url, worker = sent_in.get_nowait()
                    posting, result = resolve(url, self._adapters.site)
                    if result:
                        self._write(posting, result.status, result.reason)
                        continue
                    self._write(posting, Status.QUEUED)
                    requests.appendleft(posting)
                    wanted[posting.id] = worker
                # The Requests tab is read again whenever a Worker is free, zero
                # tokens, so a Request Lisul pastes mid-run goes ahead of every Match left.
                if with_requests:
                    requests.extend(self._take_requests())
                if queue and self._at_daily_cap():
                    print(DAILY_CAP_REACHED.format(len(self._applied_today), len(queue)))
                    self._adapters.board.run(capped=True, tomorrow=len(queue))
                    self._adapters.board.note("", "", f"today's limit reached; {len(queue)} more go tomorrow")
                    queue.clear()
                self._adapters.board.run(**self._progress(requests, queue))
                if not (requests or queue or running):
                    break
                resume_at = None
                later: list[Posting] = []  # links sent into a busy Worker, first in line again after
                while (requests or queue) and free:
                    resume_at = self._resume_at(self._adapters.usage.reading())
                    if resume_at:
                        break
                    if not requests and self._at_daily_cap(p for p, _ in running.values()):
                        break  # the Matches filling now may take the last slots
                    posting = requests.popleft() if requests else queue.popleft()
                    if not is_request(posting.id) and self._applied_by_request(posting):
                        self._adapters.board.note(posting.company, posting.title, "you already applied to this job",
                                                  posting.url)
                        continue
                    if posting.id in wanted and wanted[posting.id] not in free:
                        later.append(posting)  # sent into a Worker still busy: it waits for that one
                        continue
                    worker = wanted.pop(posting.id) if posting.id in wanted else free[0]
                    free.remove(worker)
                    self._adapters.board.update(worker, company=posting.company, role=posting.title,
                                                job_system=posting.job_system, posting_url=posting.url,
                                                application_id=posting.id, status="filling", line="", why="", files=[])
                    self._write(posting, Status.FILLING)
                    running[pool.submit(self._apply, posting, worker)] = (posting, worker)
                requests.extendleft(reversed(later))
                if not running:
                    if resume_at:  # else every Match left was a Request's already
                        self._adapters.board.run(paused_until=resume_at.isoformat(timespec="minutes"))
                        self._adapters.clock.sleep_until(resume_at)
                        self._adapters.board.run(paused_until=None)
                    continue
                done = set()
                while not done and sent_in.empty():  # a link sent in meanwhile is taken at once
                    done, _ = wait(running, timeout=1, return_when=FIRST_COMPLETED)
                for future in done:
                    posting, worker = running.pop(future)
                    free.append(worker)
                    result = future.result()
                    self._record(posting, result)
                    self._adapters.board.update(worker, status=result.status, why=one_line(result.reason),
                                                line=": ".join(filter(None, [result.status, result.reason])),
                                                drafted=[f"{q} → {a}" for q, a in result.drafted], choices=result.choices,
                                                required=result.required, where=result.where, essay=result.essay)
                    if result.status == Status.PAUSED:
                        # First in line after the reset.
                        (requests if is_request(posting.id) else queue).appendleft(posting)

    def _to_apply(self, matches: bool, requests: bool) -> tuple[deque[Posting], deque[Posting]]:
        """The Requests and the Matches this run applies to. Approved Holds go
        first, with the Requests: those Lisul approved, and approved ones an
        interrupted run left unfinished. Then each lane is led by those whose
        Missing fact Lisul answered, then an interrupted run's unfinished
        Applications, the Matches then by the Match queue. One interrupted
        mid-submit becomes a Handoff instead, so no form is submitted twice. A
        run without Matches (or Requests) leaves them for the next full run."""
        feed = self._adapters.feed.postings() if matches else []
        rows = self._rows
        answered = []
        for row in rows:
            answer = row.answer.strip()
            if row.status == Status.MISSING_FACT and answer and ANSWER_USED.format(answer) not in row.reason:
                self._answers[row.application_id] = {row.missing_fact: answer}
                answered.append(row.posting())
        approved = []
        for row in rows:
            unfinished = row.status in UNFINISHED and row.reason != SUBMITTING
            if row.approve and (unfinished or row.status == Status.HELD and not _tried(row)):
                self._approved[row.application_id] = row.essay
                approved.append(row.posting())
            elif row.status == Status.HELD and not row.approve and HELD_AGAIN_NOTE.match(row.reason):
                with self._writing:  # unticked: ticking Approve again tries it again
                    self._adapters.tracker.update(row.application_id, reason=HELD_AGAIN_NOTE.sub("", row.reason, 1))
        answered_requests = [p for p in answered if is_request(p.id)] if requests else []
        answered_matches = [p for p in answered if not is_request(p.id)] if matches else []
        unfinished = {
            row.application_id: row for row in rows if row.status in UNFINISHED and row.application_id not in self._approved
        }
        waiting = [row.posting() for row in unfinished.values() if is_request(row.application_id)] if requests else []
        fresh = match_queue(feed, rows, self._adapters.clock.now().date(), self._profile.policy("company_cap"),
                            self._profile.policy("employer_limits"),
                            lambda p, why: self._adapters.board.note(p.company, p.title, why, p.url))
        return (
            deque(approved + answered_requests + self._resume(waiting, unfinished)),
            deque(answered_matches + self._resume(feed, unfinished) + fresh),
        )

    def _resume(self, postings: list[Posting], unfinished: dict[str, Row]) -> list[Posting]:
        resumed = []
        for posting in postings:
            row = unfinished.get(posting.id)
            if row and row.reason == SUBMITTING:
                self._write(posting, Status.HANDOFF, INTERRUPTED_SUBMIT)
                self.statuses[Status.HANDOFF] += 1
            elif row:
                resumed.append(posting)
        return resumed

    def _take_requests(self) -> list[Posting]:
        """The Requests waiting in the Requests tab, for Workers to apply to.
        Each gets a row and leaves the tab: Queued, or straight away Failed
        or a Handoff. A Repost of a tracked Application only leaves the tab."""
        tracker = self._adapters.tracker
        taken = []
        for url in tracker.requests():
            posting, result = resolve(url, self._adapters.site)
            if not repost_keys(posting.id, posting.url) & self._keys:
                if result:
                    self._write(posting, result.status, result.reason)
                    self.statuses[result.status] += 1
                    if result.status in WAITING:
                        self.waiting.append((result.status, posting.company, posting.title, result.reason))
                else:
                    self._write(posting, Status.QUEUED)
                    taken.append(posting)
            tracker.remove_request(url)
        return taken

    def _progress(self, requests: deque, queue: deque) -> dict:
        """What the run as a whole is doing, for the window's status bar."""
        return {"mode": "run", "queued": len(requests) + len(queue), "today": len(self._applied_today),
                "cap": self._profile.policy("daily_cap")}

    def _at_daily_cap(self, filling: Iterable[Posting] = ()) -> bool:
        """Whether the Matches applied to today, with the Matches `filling`
        now, reach the Daily cap (policies.yaml: daily_cap; unset, there is none)."""
        cap = self._profile.policy("daily_cap")
        filling_ids = {p.id for p in filling if not is_request(p.id)}
        return cap is not None and len(self._applied_today | filling_ids) >= cap

    def _applied_by_request(self, match: Posting) -> bool:
        """Whether a Request this run has already applied to this Match."""
        return bool(repost_keys(match.id, match.url) & self._request_keys)

    def _resume_at(self, usage: UsageReading) -> datetime | None:
        """None if an Application may start now, else when to look again."""
        if usage.limited:
            resets = [usage.resets_at]
        else:
            resets = [usage.five_hour_resets_at] if usage.five_hour >= FIVE_HOUR_STOP else []
            resets += [usage.weekly_resets_at] if usage.weekly >= WEEKLY_STOP else []
        if not resets:
            return None
        if None in resets:
            return self._adapters.clock.now() + UNKNOWN_RESET_WAIT
        return max(resets)

    def _apply(self, posting: Posting, worker: int) -> Result:
        with trace.tracing(posting.id, posting.url):
            result = self._traced(posting, worker)
            trace.result(result)
        return result

    def _traced(self, posting: Posting, worker: int) -> Result:
        fill_engine.fresh()  # a merged engine fix since the last Application: planned with it, no restart (KAN-645)
        try:
            on_worker = _OnWorker(self._adapters.site, worker)
            # KAN-621: never open or fill a form sent already, here or on the form behind it.
            if applied := self._adapters.applied_before.of(posting):
                return Result(Status.HANDOFF, f"{applied.said()}; Apply didn't open the form")
            fetched = None  # the page as a plain fetch reads it, before form_behind opens it: never fetched twice
            if (behind := greenhouse.board_behind(posting, self._adapters.site)) == posting:
                if posting.job_system == "other":
                    fetched = description.from_link(posting, on_worker)
                behind = embedded.form_behind(posting, on_worker, fetched)  # a Greenhouse, Lever or Ashby form in the page
            if behind != posting and (applied := self._adapters.applied_before.of(behind, posting.url)):
                return Result(Status.HANDOFF, f"{applied.said()}; Apply didn't open the form")
            if behind != posting:
                fetched = None  # the form's own job system's text is read instead
            posting = behind
            profile = tailored.resume_for(posting, self._profile, self._adapters.tailored)
            return by_filler(
                posting, on_worker, profile, self._adapters.claude,
                lambda: self._accounts(posting),
                lambda filler, site: self._apply_with(posting, filler, site, worker, profile, fetched),
                signed_in=self._adapters.signed_in,
            )
        except Exception as error:
            why = f"{type(error).__name__}: {error}"
            if posting.id in self._submitting:  # the form may have gone out: never submit it again
                return Result(Status.HANDOFF, f"{INTERRUPTED_SUBMIT} ({why})")
            if isinstance(error, SetupError):  # the Mac's setup, not Apply's code: no Repair could fix it
                return Result(Status.FAILED, f"setup: {error}")
            return Result(Status.FAILED, why, traceback="".join(traceback.format_exception(error)))

    def _accounts(self, posting: Posting) -> Accounts:
        adapters = self._adapters
        return Accounts(
            adapters.keychain, adapters.mailbox, adapters.clock, self._profile.get("identity.email"),
            posting.company, self._add_account, self._failed_sign_ins,
        )

    def _add_account(self, account: EmployerAccount) -> None:
        """List a new Employer account in its Tracker tab, from a Worker's thread."""
        with self._writing:
            self._adapters.tracker.add_employer_account(account)

    def _apply_with(self, posting: Posting, filler, site, worker: int, profile: ApplicantProfile,
                    fetched: str | None = None) -> Result:
        """`profile` is the run's, with the Posting's tailored resume in place of its resume when it has one.
        `fetched`: the Posting's page as a plain fetch already read it (apply_to)."""
        board = self._adapters.board
        caption = lambda: {"company": posting.company, "role": posting.title, "job_system": posting.job_system,
                           "posting_url": posting.url, "application_id": posting.id}
        return apply_to(
            posting, filler, site, profile, self._adapters.claude,
            lambda: self._before_submit(posting), self._answers.get(posting.id), self._approved.get(posting.id),
            bank=self._adapters.answer_bank, today=self._adapters.clock.now().date(),
            on_files=lambda files: board.update(worker, files=files),
            on_verify=lambda verification: board.update(worker, **verifying(verification)),
            on_captcha=Waiter(board, worker, self._adapters.phone, profile, caption), fetched=fetched,
        )

    def _before_submit(self, posting: Posting) -> str:
        """Once the limit is hit, every Worker is paused: none submits. During
        the Calibration run the Application is held instead (the reason is
        returned). The row says Submitting before the form is sent, so an
        interrupted run is never submitted twice."""
        usage = self._adapters.usage.reading()
        if usage.limited:
            raise UsageLimitHit(usage.resets_at)
        with self._writing:
            hold = "" if posting.id in self._approved else self._calibration_hold(posting)
        if not hold:
            self._write(posting, Status.FILLING, SUBMITTING)
            self._submitting.add(posting.id)
        return hold

    def _calibration_hold(self, posting: Posting) -> str:
        """Why this Application is held for the Calibration run, or "" once the
        first Applications (held or submitted, in any run) are enough."""
        size = self._profile.policy("calibration_run") or 0
        filled = self._filled | self._calibrating
        if len(filled) >= size:
            return ""
        self._calibrating.add(posting.id)
        return CALIBRATION.format(len(filled) + 1, size)

    def _record(self, posting: Posting, result: Result) -> None:
        today = self._adapters.clock.now().date()
        keep_repair_requests(self._adapters, posting, result)
        named_posting = named(posting, result)
        record, reason = keep_record(self._adapters, named_posting, result, today)
        if posting.id in self._answers:
            self._profile.save()  # Lisul's answer joined the profile
            [answer] = self._answers[posting.id].values()
            reason = ANSWER_USED.format(answer) + reason
        if posting.id in self._approved and result.status == Status.HELD:
            reason = HELD_AGAIN.format(_fingerprint(self._approved[posting.id])) + reason
        reason = "; ".join(filter(None, [reason, result.drafted_note()]))
        submitted = result.status == Status.SUBMITTED
        if is_request(posting.id) and result.status in (Status.SUBMITTED, Status.HELD):
            reason = "; ".join(filter(None, [reason, self._over_limits(named_posting, today)]))
        self._recorded[posting.id] = Row(
            posting.id, named_posting.company, named_posting.title, posting.url, posting.job_system, result.status,
            today if submitted else None,
        )
        signals = bot_signals.cell(self._profile.policy("worker_headless") is not False, result.bot_signals) \
            if result.filled or result.bot_signals else ""
        self._write(posting, result.status, reason, today if submitted else None, record, result.missing_fact, result.essay,
                    signals, options_cell(result.choices.get(result.missing_fact)))
        self.statuses[result.status] += 1
        if bot_signals.BLOCKED in result.bot_signals:
            self._to_everyday_chrome(named_posting)
        if result.status in WAITING:
            # A Missing fact's reason starts with "Missing fact": its question says it all.
            # Its context line (apply.asking) follows its question, as in its Tracker reason.
            where = result.where.get(result.missing_fact, "")
            self.waiting.append((result.status, named_posting.company, named_posting.title,
                                 f"{result.missing_fact}; {asking.IN}{where}" if where else result.missing_fact or reason))
        if not is_request(posting.id) and result.status in (Status.SUBMITTED, Status.HELD):
            self._applied_today.add(posting.id)
        for question, answer in result.drafted:  # two Workers may draft one question at once: listed once
            self.drafted.setdefault(bank_key(question), (question, answer))
            if entry := self._adapters.answer_bank.get(question):
                self._list(entry)
        for question, answer, uses in result.reused:
            was = self.reused.get(bank_key(question))
            if not was or was[2] < uses:
                self.reused[bank_key(question)] = (question, answer, uses)

    def _to_everyday_chrome(self, posting: Posting) -> None:
        """A bot block's Handoff (KAN-590): open the posting in Lisul's everyday Chrome, where the extension fills
        it, and push him to finish it there. Once, with no retry; the row stays at Needs you meanwhile."""
        adapters, company = self._adapters, captcha.company_of(posting.company, posting.url)
        try:
            adapters.everyday(posting.url)
        except Exception as failed:
            print(f"Couldn't open {posting.url} in your Chrome ({failed}); open it yourself.", file=sys.stderr)
        if self._profile.policy("phone_push") is not True or adapters.phone is None:
            return
        try:
            adapters.phone.notify(captcha.FINISH_TITLE, captcha.FINISH.format(company))
        except Exception as failed:
            print(f"Couldn't push {company}'s block to your phone ({failed}); the Tracker lists it.", file=sys.stderr)

    def _over_limits(self, request: Posting, today: date) -> str:
        """The note for a Request applied to over an employer's own limit,
        warned of in the run's output, or "" if it is within every one."""
        rows = {row.application_id: row for row in self._rows} | self._recorded
        others = [row for id_, row in rows.items() if id_ != request.id]
        over = over_employer_limits(request.company, others, today, self._profile.policy("employer_limits"))
        if not over:
            return ""
        print(f"Applied to {request.title} at {request.company} over an employer limit, as a Request: "
              f"{'; '.join(over)}", file=sys.stderr)
        return OVER_LIMIT + "; ".join(over)

    def _write(
        self, posting: Posting, status: Status, reason: str = "", date_applied=None, record: str = "", missing_fact: str = "",
        essay: str = "", signals: str = "", options: str = "",
    ) -> None:
        """`essay` is written only with the status that holds the row: once
        held, the essay is Lisul's to edit. `signals` (the Bot signals cell)
        is written once a browser filled the form, and kept till the next fill;
        `options` (what the Missing fact offers to pick from) with the Missing fact."""
        tracker = self._adapters.tracker
        with self._writing:
            self._note(posting.id, posting.url, status, reason)
            if posting.id in self._ids:
                # A write without a Record keeps the link an earlier fill left.
                tracker.update(
                    posting.id, status=status, reason=reason, date_applied=date_applied, missing_fact=missing_fact,
                    missing_fact_options=options,
                    **({"record": record} if record else {}), **({"essay": essay} if essay else {}),
                    **({"bot_signals": signals} if signals else {}),
                )
            else:
                tracker.add(Row(
                    application_id=posting.id,
                    company=posting.company,
                    role=posting.title,
                    posting_url=posting.url,
                    job_system=posting.job_system,
                    status=status,
                    date_applied=date_applied,
                    reason=reason,
                    record=record,
                    missing_fact=missing_fact,
                    missing_fact_options=options,
                    essay=essay,
                    bot_signals=signals,
                ))
                self._ids.add(posting.id)

    def _note(self, application_id: str, url: str, status: Status, reason: str) -> None:
        keys = repost_keys(application_id, url)
        self._keys |= keys
        if is_request(application_id):
            self._request_keys |= keys
        if status in (Status.HELD, Status.SUBMITTED) or reason == SUBMITTING:
            self._filled.add(application_id)


def _applied_on(day: date, row: Row) -> bool:
    """Whether `row` is a Match applied to on `day`, as the Daily cap counts:
    submitted that day, or held with a Record of that day (a Hold has no
    Date applied, and its Record's link starts with its day). Requests don't count."""
    return not is_request(row.application_id) and (
        row.status == Status.SUBMITTED and row.date_applied == day
        or row.status == Status.HELD and f"{day.isoformat()}/" in row.record
    )


def _fingerprint(essay: str) -> str:
    return hashlib.sha1(essay.encode()).hexdigest()[:8]


def _tried(row: Row) -> bool:
    """Whether this approved Hold was already filled from its Essay cell as it stands."""
    tried = HELD_AGAIN_NOTE.match(row.reason)
    return bool(tried) and tried.group(1) == _fingerprint(row.essay)


def by_filler(
    posting: Posting, site: JobSite, profile: ApplicantProfile, claude: Claude, accounts: Callable[[], Accounts],
    apply: Callable[..., Result], signed_in: Collection[str] = (),
) -> Result:
    """One Application, carried by `apply(filler, site)` with the Filler for
    its job system: a Filler, one built with the Application's `accounts()`
    (it signs in, and its form stays open throughout), or Claude fill, whose
    form also stays open between its sessions and whose cost ends the reason.
    A Posting behind a known sign-in wall is a Handoff before Claude fill
    starts where Gmail can't be read, unless its site is one of `signed_in`."""
    filler = FILLERS.get(posting.job_system)
    if isinstance(filler, type):  # with a Rescue: Claude fills a field its own code fails on
        rescue = Rescue(claude, sms_opt_in=profile.policy("sms_opt_in") is True,
                        marketing_opt_in=profile.policy("marketing_opt_in") is True)
        # policies.yaml: workday_sign_in, email (the default) or google.
        options = {"sign_in": profile.policy("workday_sign_in") or "email"} if posting.job_system == "workday" else {}
        with OnePage(site) as page_site:
            return apply(filler(accounts(), rescue, **options), page_site)
    if filler:
        if hasattr(filler, "with_accounts"):  # it reads the Application's mail, yet opens its form afresh each time
            filler = filler.with_accounts(accounts())
        return apply(filler, site)
    signing_in, agree = accounts(), bool(profile.policy("tick_consent_when_true"))
    no_mail = signing_in.mail_unavailable()
    if no_mail and walls.wall(posting.url) and walls.site(posting.url) not in signed_in:
        return Result(Status.HANDOFF, walls.needs_account(posting.url, no_mail))
    cap = profile.policy("claude_fill") or {}
    oracle_sign_in = None
    if posting.job_system == "oracle":  # its emailed one-time code, by plain code
        last_name = profile.get("identity.legal_last_name")
        oracle_sign_in = lambda page: oracle.sign_in(page, signing_in, last_name, agree)

    def sign_in(page) -> None:
        if no_mail:
            walls.check_landing(page, signed_in, no_mail)
        if oracle_sign_in:
            oracle_sign_in(page)

    filler = ClaudeFill(claude, **cap, sign_in=sign_in, resume=profile.get("files.resume_pdf"),
                        sms_opt_in=profile.policy("sms_opt_in") is True,
                        marketing_opt_in=profile.policy("marketing_opt_in") is True,
                        accounts=signing_in, account_facts=account_facts(profile, agree),
                        page_gates=_page_gates(profile.policy("page_gates")),
                        signed_in=oracle.signed_in if oracle_sign_in else None)
    with OnePage(site) as page_site:
        result = apply(filler, page_site)
    result.reason = "; ".join(filter(None, [result.reason, filler.usage()]))
    result.named = filler.names
    return result


def account_facts(profile: ApplicantProfile, agree_to_terms: bool) -> dict:
    """What Claude fill may type on a sign-in or account page: never a password."""
    return {"first_name": profile.get("identity.legal_first_name"), "last_name": profile.get("identity.legal_last_name"),
            "phone": profile.get("identity.phone"), "agree_to_terms": agree_to_terms}


def keep_repair_requests(adapters: Adapters, posting: Posting, result: Result) -> None:
    """Keep what went wrong of Apply's making for a Repair. A request that
    can't be kept never costs the Application its row."""
    try:
        for request in requests_for(posting, result):
            adapters.repairs.add(request)
    except Exception as error:
        print(f"Repair request not kept for {posting.url}: {error}", file=sys.stderr)


def keep_record(adapters: Adapters, posting: Posting, result: Result, today: date) -> tuple[str, str]:
    """Save a filled Application's Record. Returns the Record link and the
    row's reason. The row matters more than its Record (without the row, a
    submitted Application would be applied to again), so a failed save only
    notes itself in the reason."""
    if not result.filled:
        return "", result.reason
    try:
        record = Record(posting, result.status, result.reason, result.filled, today, drafted=result.drafted,
                        named_facts=result.named_facts,
                        verification=result.verification.as_json() if result.verification else None)
        return adapters.records.save(record), result.reason
    except Exception as e:
        return "", " ".join(filter(None, [result.reason, f"Record not saved: {e}"]))


class _OnWorker:
    """The job site as one Worker sees it: forms open in that Worker's own browser."""

    def __init__(self, site: JobSite, worker: int):
        self._site = site
        self._worker = worker

    def fetch(self, url: str, body: bytes | None = None) -> bytes:
        return self._site.fetch(url, body)

    def open(self, url: str):
        return self._site.open(url, worker=self._worker)


def _page_gates(policy) -> bool | str:
    """policies' page_gates: true pauses for Lisul, "note" lists his checks and goes on, else off."""
    return "note" if policy == "note" else policy is True

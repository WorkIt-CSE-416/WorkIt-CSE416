"""A Worker carries one Application: the Posting's own text, Question set, plan, fill, check, submit.

Every file a form is given (the résumé, a cover letter, the transcript) is
also copied to the Application's folder under SENT, on this Mac only (the
transcript holds a student ID, so never to the Records repo), and listed to
`on_files` each time the plan changes, so the Apply window can show Lisul
exactly what was sent."""

import re
import shutil
import subprocess
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import date
from pathlib import Path
from urllib.error import HTTPError

from apply import (
    brief,
    browsers,
    company,
    cover_letter,
    description,
    eligibility,
    essays,
    sameness,
    verify,
)
from apply.adapters import Claude, JobSite, UsageLimitHit
from apply.answer_bank import LISUL, AnswerBank
from apply.fill_engine import (
    company_specific,
    left_blank,
    not_called_for,
    plan,
    posting_ai_trap,
    posting_bans_ai,
    readback_problems,
    remember,
    shows,
    trap_handoff,
)
from apply.fillers import Filler, Handoff, MoreQuestions
from apply.gates import UNTRACED_NUMBER
from apply.home import HOME
from apply.model import (
    NOT_A_POSTING,
    Closed,
    FillError,
    NotAPosting,
    Posting,
    Question,
    Status,
    is_company,
    one_line,
)
from apply.presubmit import replan, review
from apply.profile import ApplicantProfile
from apply.records import SECRET, Filled

SENT = HOME / "sent"


def sent_folder(company: str, application_id: str, day: date) -> Path:
    """The Application's folder under SENT, where a copy of each file its form is given is kept."""
    slug = re.sub(r"[^a-z0-9]+", "-", company.lower()).strip("-") or "company"
    return SENT / day.isoformat() / f"{slug}-{re.sub(r'[^A-Za-z0-9_-]+', '-', application_id)}"


def sent_resume(application_id: str, name: str, sent: Path | None = None) -> str:
    """The resume the Application's form was given, from its newest folder
    under SENT (KAN-544): the file named `name` (the profile's resume), else a
    PDF whose name says resume; "" when none was kept."""
    safe = re.sub(r"[^A-Za-z0-9_-]+", "-", application_id)
    folders = sorted((f for f in (sent or SENT).glob(f"*/*-{safe}") if f.is_dir()), key=lambda f: f.parent.name,
                     reverse=True)
    for folder in folders:
        named = [folder / name] + sorted(f for f in folder.glob("*.pdf") if "resume" in f.name.lower())
        if found := next((f for f in named if f.is_file()), None):
            return str(found)
    return ""


def keep_sent(folder: Path, path: Path) -> Path:
    """A copy of `path` in `folder` (an Application's under SENT) by its own name; another
    file kept there by that name already: the copy's name is numbered before it."""
    folder.mkdir(parents=True, exist_ok=True)
    name, n = path.name, 1
    while (kept := folder / name).is_file() and kept.read_bytes() != path.read_bytes():
        n += 1
        name = f"{n}-{path.name}"
    if not kept.is_file():
        shutil.copyfile(path, kept)
    return kept


# Ends a Handoff's reason when the rest of the form was filled.
FILLED_BUT = "Every other answer was filled in; the Record has them all"


@dataclass
class Result:
    """What a Worker reports to the Orchestrator, which writes the Tracker row."""

    status: Status
    reason: str = ""
    filled: Filled | None = None  # set once the form was filled; kept as the Record
    missing_fact: str = ""  # the question Lisul must answer, when status is Missing fact
    essay: str = ""  # a held Application's Claude-written essays, for Lisul to edit
    missing: tuple[str, ...] = ()  # every Missing fact a rehearsal left blank, in form order
    choices: dict[str, dict] = field(default_factory=dict)  # each Missing fact's options, by question (choices())
    required: dict[str, bool] = field(default_factory=dict)  # whether its form requires each Missing fact, by question
    traceback: str = ""  # where a Failed Application's error came from, for its Repair request
    problems: tuple[str, ...] = ()  # answers the Pre-submit check found wrong, or a rehearsal couldn't fill
    drafted: tuple[tuple[str, str], ...] = ()  # (question, answer) Claude drafted into the Answer bank, in form order
    named_facts: tuple[tuple[str, str], ...] = ()  # (question, Named fact) of each essay that names one, in form order
    named: tuple[str, str] = ("", "")  # the company and role the form's own page named (Claude fill)
    # (question, answer, uses) of each unreviewed draft the Answer bank answered this form with, in form order
    reused: tuple[tuple[str, str, int], ...] = ()
    bot_signals: tuple[str, ...] = ()  # what suggested the job system took the browser for a bot (apply.bot_signals)
    verification: "verify.Verification | None" = None  # how verifying the filled form went (apply.verify)

    def drafted_note(self) -> str:
        """The drafts, as the Tracker row and the Record list them."""
        return "Claude drafted: " + "; ".join(f"{q} → {a}" for q, a in self.drafted) if self.drafted else ""


def apply_to(
    posting: Posting,
    filler: Filler,
    site: JobSite,
    profile: ApplicantProfile,
    claude: Claude,
    before_submit: Callable[[], str] = lambda: "",
    answered: dict[str, str] | None = None,
    approved: str | None = None,
    rehearse: bool = False,
    bank: AnswerBank | None = None,
    today: date | None = None,
    on_files: Callable[[list[dict]], None] = lambda files: None,
    before_fill: Callable[[], None] = lambda: None,
    on_missing: Callable[[tuple[str, ...], dict[str, dict], dict[str, bool]], None] = lambda *heard: None,
    on_verify: Callable[["verify.Verification | None"], None] = lambda verification: None,
    on_pause: Callable[[Result, Callable[[object], str]], bool] = lambda stopped, blocked: False,
) -> Result:
    """`before_submit` runs just before the form is submitted. It returns why
    the Orchestrator holds the Application anyway (the Calibration run), or "";
    it raises UsageLimitHit when the Orchestrator has paused every Worker. `answered`
    holds Lisul's answers to Missing facts, by question; they join the
    Applicant profile first (the Orchestrator saves it). `approved` is the
    Essay cell of a Hold Lisul approved: his essays are sent as he left them,
    Claude writes none, and no Hold rule holds it again; only the Pre-submit
    check can. A Filler that can't finish the form without Lisul raises Handoff.
    `rehearse` fills the form to its last page and stops there: it never
    submits, and the Result is Held with why a run would hold it, if it would.
    A Missing fact doesn't stop a rehearsal: its field is left blank and listed.
    A one-off question is answered from `bank`, the Answer bank, else drafted
    by Claude in the Application's essay call and added to it, first seen `today`.
    `on_files` hears the files the form is given, as {label, name, path} of
    each kept copy, whenever they change. `before_fill` runs once, with the
    form open and its answers planned, just before the first field is filled;
    for a Filler that signs in to read its questions (Workday), before it does.
    `on_missing` hears a rehearsal's Missing facts (each one's options, and
    whether its form requires it)
    whenever the list changes: first as the planner finds them, before Claude
    is asked to draft or write anything, so Lisul can answer them up front.
    A Posting whose own text rules Lisul out (eligibility.py) is Not eligible
    before its Question set is read: no form opens and Claude is never asked.
    That text, the Posting description, is read once (apply.description) and
    every Claude call for the Application gets it. Read from its job system's
    API, else its page with a plain fetch, it is also checked before any form
    opens: one that speaks to AI agents is a Handoff quoting it, and no page
    opens and Claude is never asked.
    Once the form is filled, and before any submit, it is verified
    (apply.verify): `on_verify` hears None as verifying starts, then the
    Verification. A flag that needs Lisul holds a run's Application, unless
    Lisul approved it after he saw the flags, or dismissed that flag for this
    Application before (verify.dismiss); verifying never submits.
    A rehearsal that stops mid-form for Lisul (a Handoff while it signs in
    to read its questions or fills a step) is paused, not ended: `on_pause`
    gets that Handoff's Result and `blocked(page)`, why Resume can't go on
    now ("" when it can), and waits on him. True: he fixed the page and
    pressed Resume, so the fill goes on on the same page, from the step it
    shows, with the values he put there kept as his answers (`resumed`).
    False: the Handoff ends the rehearsal as before."""
    planned = _Planned(posting, site, profile, claude, answered or {}, approved, rehearse, bank or AnswerBank(),
                       today or date.today(), on_files, on_missing)
    try:
        result = _apply(planned, filler, site, before_submit, rehearse, before_fill, on_verify, on_pause)
    except Handoff as handoff:
        result = _handed_off(handoff)
    except Closed as closed:  # skipped before any form is filled
        result = Result(Status.CLOSED, f"Closed: {closed}, so it was skipped")
    except NotAPosting as what:
        result = Result(Status.FAILED, f"{NOT_A_POSTING}: {what}")
    except UsageLimitHit as hit:
        result = Result(Status.PAUSED, f"Max usage limit hit; resumes after {hit.resets_at or 'the reset'}")
    if result.status == Status.SUBMITTED:  # only what an employer was sent: never a fill, a Hold or a rehearsal
        ledger = sameness.Ledger()
        for e in planned.written:
            if e.text:
                ledger.add(planned.posting.company, one_line(e.question.label),
                           e.plan.type if e.plan else essays.question_type(e.question), e.text,
                           story=e.plan.story if e.plan else "")
    result.drafted = tuple((one_line(d.question.label), d.shown) for d in planned.drafted)
    result.reused = tuple(planned.reused)
    result.named_facts = tuple((one_line(e.question.label), e.named) for e in planned.written if e.named)
    return result


def _apply(planned: "_Planned", filler, site, before_submit, rehearse, before_fill=lambda: None,
           on_verify=lambda verification: None, on_pause=lambda stopped, blocked: False) -> Result:
    posting, profile, claude = planned.posting, planned.profile, planned.claude
    read = description.from_api(posting, site)
    if why := eligibility.not_eligible(read):  # before any form opens or Claude is asked
        return Result(Status.NOT_ELIGIBLE, why)
    fetched = read or description.from_link(posting, site)  # no browser yet
    if trap := posting_ai_trap(fetched):  # else Claude fill's Claude would read it on the open page
        return Result(Status.HANDOFF, trap_handoff(trap))
    with tempfile.TemporaryDirectory(prefix="apply-") as scratch:
        planned.scratch = Path(scratch)
        if getattr(filler, "signs_in_to_read", False):  # reading its questions types into the page
            if rehearse:
                with site.open(posting.url):  # its posting shows while it waits, nothing typed
                    before_fill()
            before_fill()
            before_fill = lambda: None
        blocked = getattr(filler, "resume_blocked", lambda page: "")
        while True:
            try:
                questions = filler.question_set(posting.url, site)
                break
            except HTTPError as error:
                if error.code in (404, 410):
                    raise Closed(f"the job system no longer has this Posting (HTTP {error.code})") from error
                raise
            except Handoff as handoff:  # a sign-in Lisul finishes himself, then Resume reads the questions
                if not (rehearse and on_pause(_handed_off(handoff), blocked)):
                    raise
        # No API for it: what the Filler read off the open posting page (Claude fill), else the plain fetch.
        planned.text = read or getattr(filler, "posting_text", "") or fetched
        # A Request on a job system with no Filler: its link named no company, but its open page did
        # (Claude fill). Planned with that name, "why <company>?" is the High-stakes essay it is.
        company, title = getattr(filler, "names", None) or ("", "")
        planned.posting = posting = replace(posting, company=posting.company or company, title=posting.title or title)
        # A rehearsal shows its form while Claude writes its answers; a run opens it only once they're written.
        if not rehearse and (stop := planned.add(questions)):
            return stop
        for attempt in range(2):
            with site.open(posting.url) as page:
                if rehearse and attempt == 0 and (stop := planned.add(questions)):
                    return stop
                before_fill()
                before_fill = lambda: None
                while True:
                    try:
                        readback = filler.fill(page, planned.questions, planned.answers)
                        break
                    except MoreQuestions as more:  # the form's next step asks these
                        if stop := planned.add(more.questions):
                            return stop
                    except FillError as error:
                        # A rehearsal goes on without the field and says so; a run stops.
                        if not (rehearse and planned.skip(error)):
                            raise
                    except Handoff as handoff:  # a rehearsal says which blanks may have stopped it
                        stopped = _handed_off(handoff, missing=planned.missing, choices=planned.choices,
                                              required=planned.required)
                        if not (rehearse and on_pause(stopped, blocked)):
                            return stopped
                        # Resume: what Lisul put on the step it stopped on stays, as his answers.
                        planned.keep(getattr(filler, "resumed", lambda page: {})(page))
                questions, answers, holds = planned.questions, planned.answers, list(planned.holds)
                holds = [f"Not filled: {e}" for e in planned.unfilled] + holds
                filled = Filled(questions, answers, readback, _screenshot(page))
                problems = readback_problems(questions, answers, readback, planned.accepted)
                if problems and attempt == 0:
                    # Perhaps a timing glitch, or the page words it its own way: Sonnet plans
                    # those answers again, and the form is filled once more in a fresh page.
                    if not planned.handoffs:  # a form Lisul finishes gets no Claude call
                        planned.answers = replan(claude, questions, answers, readback, planned.accepted,
                                                 posting, planned.text)
                    continue
                problems += _unasked(filler, page, questions)
                planned.use_bank()
                if planned.handoffs:  # filled but for what only Lisul may answer; no Claude call
                    checked = ["Pre-submit check failed. " + "; ".join(problems)] if problems else []
                    return Result(Status.HANDOFF, "; ".join(planned.handoffs + checked + [FILLED_BUT]), filled)
                holds += planned.overused()
                on_verify(None)  # Verifying: the window shows it while the form is read back and checked
                found = []
                if problems:
                    holds.insert(0, "Pre-submit check failed. " + "; ".join(problems))
                else:
                    # Every answer is checked against his profile: a fact a rule answered from it (Sinhala,
                    # spoken: "Other" on Point72's list) is no fact "no source" holds.
                    drafted = bool(planned.drafted or planned.unbanked or planned.banked)
                    sources = essays.sources(profile, planned.known(), facts=True,
                                              types=[e.plan.type for e in planned.written if e.plan]) \
                        if planned.written or drafted else essays.profile_block(profile)
                    found = review(claude, posting, questions, readback, sources, planned.text, planned.own())
                    holds += [f"Pre-submit review: {p}" for p in found]
                # For Repair requests: a field Claude filled for the Filler (apply.rescue) is its code's to fix.
                rescued = tuple(getattr(filler, "rescued", ()))
                verification = planned.verify(readback, found, rescued)
                on_verify(verification)
                if planned.approved is None:  # once Lisul approved it, he saw them: no flag holds it again
                    holds += [verify.PREFIX + f.line() for f in verification.needs
                              if f.kind not in (verify.READBACK, verify.REVIEW)]  # those two hold it already
                wrong = tuple(planned.unfilled + problems + found) + rescued
                if rehearse:  # on its last page, never submitted
                    holds += filter(None, [before_submit()])
                    return Result(Status.HELD, "; ".join(holds), filled, essay=planned.essay_cell, missing=planned.missing,
                                  choices=planned.choices, required=planned.required, problems=wrong,
                                  verification=verification)
                if holds:
                    return Result(Status.HELD, "; ".join(holds), filled, essay=planned.essay_cell, problems=wrong,
                                  verification=verification)
                hold = before_submit()
                if hold:
                    return Result(Status.HELD, hold, filled, essay=planned.essay_cell, problems=rescued,
                                  verification=verification)
                try:
                    met = filler.submit(page)
                except Handoff as handoff:  # it may have gone: the Record shows where the click left the page
                    return _handed_off(handoff, filled=replace(filled, after_submit=_screenshot(page)))
                return Result(Status.SUBMITTED, filled=replace(filled, after_submit=_screenshot(page)),
                              bot_signals=tuple(met or ()), problems=rescued, verification=verification)


PLACEHOLDER = re.compile(r"^\W*(select|choose|pick)\b.*|^\W*$")  # "Select...", or no words: not an option


def choices(question: Question) -> dict | None:
    """What a Missing fact offers to pick from, for the Inbox: {"kind": "select" or
    "multi_select", "options": [...]}; None for one answered in words, or whose
    options weren't read; {"kind": "file", "options": []} for one that takes a file."""
    if question.kind == "file":
        return {"kind": "file", "options": []}
    options = [o for o in question.options if not PLACEHOLDER.match(o.strip().lower())]
    return {"kind": question.kind, "options": options} if question.kind in ("select", "multi_select") and options else None


def _handed_off(handoff: Handoff, **more) -> Result:
    return Result(Status.HANDOFF, str(handoff), bot_signals=tuple(filter(None, [handoff.bot_signal])), **more)


def _unasked(filler, page, questions: list[Question]) -> list[str]:
    """The required fields on the filled page that the Question set missed, as
    a Pre-submit problem, from a Filler that can tell (one with `unasked`)."""
    missed = filler.unasked(page, questions) if hasattr(filler, "unasked") else []
    return [f"Required on the form but not in the Question set, so left empty: {', '.join(missed)}"] if missed else []


class _Planned:
    """One Application's answers, planned as its form shows its questions:
    all at once, or a step at a time."""

    def __init__(self, posting, site, profile, claude, answered, approved, rehearse: bool, bank: AnswerBank, today: date,
                 on_files: Callable[[list[dict]], None] = lambda files: None,
                 on_missing: Callable[[tuple[str, ...], dict[str, dict], dict[str, bool]], None] = lambda *heard: None):
        self._on_files, self._shown_files = on_files, None
        self._on_missing = on_missing
        self.posting, self._site, self.profile, self.claude = posting, site, profile, claude
        self._answered, self._approved = answered, approved
        self.approved = approved
        self._rehearse, self._bank, self._today = rehearse, bank, today
        self.scratch: Path | None = None  # where cover letters are written, while the form is filled
        self.missing: tuple[str, ...] = ()  # left blank, in a rehearsal
        self.choices: dict[str, dict] = {}  # the options of each of those that offers some, by question
        self.required: dict[str, bool] = {}  # whether its form requires each of those, by question
        self.unfilled: list[str] = []  # why a rehearsal's Filler couldn't fill each answer it left out
        self._skipped: set[str] = set()
        self.left: set[str] = set()  # fields left blank on purpose: an N/A optional, a follow-up not called for
        self.lisuls: dict[str, object] = {}  # what Lisul put on a paused form's step before Resume, by name
        self.questions: list[Question] = []
        self._answers: dict = {}
        self.accepted: dict[str, tuple[str, ...]] = {}  # other wordings Lisul accepts for an answer, by Question name
        self.blanks: dict[str, str] = {}  # fields the engine's plan leaves blank on purpose, by name: why
        self.holds: list[str] = []
        self.handoffs: list[str] = []  # what Lisul must answer himself; the rest is still filled
        self.written: list[essays.Essay] = []
        self.drafted: list[essays.Draft] = []  # one-off answers Claude drafted into the Answer bank
        self.unbanked: list[essays.Draft] = []  # Claude's answers to one-off questions about this company
        self.banked: list[Question] = []  # one-off questions the Answer bank answered
        self.reused: list[tuple[str, str, int]] = []  # the unreviewed drafts among them, with their uses
        self._asked: set[Question] = set()  # one-off questions sent to Claude to draft
        self.material: str | None = None  # the <company> block, read once the form has essays
        self.brief = ""  # the Company brief's facts: web text, so never searched for traps or bans as the material is
        self.text = ""  # the Posting description, read once before any Claude call
        self._posting_text: str | None = None  # the Posting's own text, when no description was read
        if approved is None and _is_target(posting, profile):
            self.holds.append(f"Target company: {posting.company}")

    @property
    def answers(self) -> dict:
        return self._answers

    @answers.setter
    def answers(self, answers: dict) -> None:
        self._answers = answers | self.lisuls  # what Lisul put on the page is the answer, whatever the plan says
        self._keep_files()

    def keep(self, values: dict) -> None:
        """Keep what Lisul put on a paused form before Resume (the Filler's
        `resumed`) as his answers: no plan, Claude or Filler writes over them,
        and a Missing fact he answered there waits on him no more."""
        values = {name: value for name, value in values.items()  # what Apply had put there itself stays Apply's
                  if name not in self._answers or not shows(value, self._answers[name], self.accepted.get(name, ()))}
        if not values:
            return
        self.lisuls |= values
        self.answers = self._answers
        missing = [q for q in self.questions if q.label.strip() in self.missing]
        self._missing(missing, [a for a in self.missing if a.startswith(essays.ASK)])

    def _keep_files(self) -> None:
        """Copy each file the form is given to the Application's folder under
        SENT, and tell `on_files` when the list changed."""
        folder = sent_folder(self.posting.company, self.posting.id, self._today)
        files, taken = [], set()
        for q in self.questions:
            path = self._answers.get(q.name)
            if not isinstance(path, Path) or not path.is_file():
                continue
            name = path.name if path.name not in taken else f"{len(taken) + 1}-{path.name}"
            taken.add(name)
            kept = folder / name
            try:
                folder.mkdir(parents=True, exist_ok=True)
                if not kept.is_file() or kept.read_bytes() != path.read_bytes():
                    shutil.copyfile(path, kept)
            except OSError:
                continue  # the form still gets its file; only the window's copy is missing
            files.append({"label": one_line(q.label), "name": path.name, "path": str(kept)})
        if files != self._shown_files:
            self._shown_files = files
            self._on_files(files)

    @property
    def essay_cell(self) -> str:
        return essays.as_cell(self.written) if self._approved is None else ""  # the Essay cell is Lisul's once held

    def add(self, questions: list[Question]) -> Result | None:
        """Plan the form again with `questions` added. A Result if the
        Application ends here: Not eligible or a Missing fact. A form with
        questions only Lisul may answer (an essay on a form that bans AI
        text, a video) is still filled, without Claude, and then handed off;
        so is one whose Posting description or Company material bans AI text
        or speaks to AI agents, which then never reaches Claude."""
        posting, profile = self.posting, self.profile
        for q in questions:
            if q.label.strip() in self._answered:
                remember(profile, posting, q, self._answered[q.label.strip()])
        for asked, answer in self._answered.items():  # what an essay asked him: its answer joins the Story bank
            if asked.startswith(essays.ASK):
                essays.remember_fact(asked, answer, posting.company, self._today)
        self.questions = self.questions + list(questions)
        planned = plan(self.questions, posting, profile, self._bank, posting_text=self.posting_text,
                       employer_text=f"{self.text}\n{self.material or ''}", today=self._today)
        # A secret (a password the Filler types itself) is never Claude's to draft nor the Answer bank's to keep:
        # it stays blank in the plan (Answer optional questions too had sent an optional one to Claude).
        planned.drafts = [q for q in planned.drafts if not (SECRET.search(q.label) or SECRET.search(q.name))]
        self.banked = planned.banked
        self.accepted = planned.accepted
        self.blanks = planned.blanks
        if planned.not_eligible:
            return Result(Status.NOT_ELIGIBLE, planned.not_eligible)
        if planned.handoffs:  # a form Lisul finishes gets no Claude call: its one-off questions are his too
            yours = [q for q in self.questions if q in planned.missing + planned.drafts]
            self.handoffs = planned.handoffs + [f"Answer '{q.label.strip()}' too" for q in yours]
            self.answers = {n: a for n, a in planned.answers.items() if n not in self._skipped}
            return None
        if stop := self._missing(planned.missing):
            return stop
        done = {essay.question for essay in self.written}
        new = [q for q in planned.essays if q not in done]
        to_draft = [q for q in planned.drafts if q not in self._asked]
        if new and self.material is None:
            self.material = company.gather(posting, new, self._site)
            if posting_ai_trap(self.material) or posting_bans_ai(self.material):
                return self.add([])  # planned again, the material read with the posting: its essays are Lisul's
            self.brief = brief.brief(posting, self._site, self.claude, self._today, self.text, self.questions)
        ask = new if self._approved is None else []
        given = planned.answers | {d.question.name: d.answer for d in self.drafted + self.unbanked}
        answered = {q: given[q.name] for q in self.questions if q.name in given}  # "the area you picked above"
        written, drafted = essays.answer(self.claude, posting, ask, to_draft, profile, self.known(), self.text,
                                         answered=answered) if ask or to_draft else ([], [])
        if self._approved is not None:
            written = essays.from_cell(self._approved, new)
        self.written += written
        self._asked |= set(to_draft)
        for draft in drafted:
            if draft.needs_lisul:
                continue
            if company_specific(draft.question, posting):  # true of this company only: drafted again each time
                self.unbanked.append(draft)
            else:
                self._bank.add(draft.question, draft.answer, posting.company, self._today, list(draft.facts))
                self.drafted.append(draft)
        given = {d.question.name: d.answer for d in self.drafted + self.unbanked}
        # A follow-up to a question Claude just answered ("If yes, ...", answered No) that the answer doesn't call for.
        moot = {q: answer for q in planned.drafts
                for is_moot, answer in [not_called_for(q, self.questions, planned.answers | given)] if is_moot}
        answered = {d.question for d in self.drafted + self.unbanked} | set(moot)
        asks = [asked for essay in self.written if essay.plan for asked in essay.plan.asks]
        if stop := self._missing(planned.missing + [q for q in planned.drafts if q not in answered], asks):
            return stop
        for essay in written:
            self.holds += self._holds(essay, essay.question in planned.high_stakes)
        answers = dict(planned.answers) | {d.question.name: d.answer for d in self.drafted + self.unbanked
                                           if not left_blank(d.question, d.answer) and d.question not in moot}
        answers |= {q.name: answer for q, answer in moot.items() if answer is not None}
        self.left |= {q.name for q in moot} | {d.question.name for d in self.drafted + self.unbanked
                                               if left_blank(d.question, d.answer)}
        for n, essay in enumerate(self.written):
            q = essay.question
            if not essay.text:
                continue
            if q.kind == "file":  # each in its own folder, so the employer still sees its own file name
                folder = self.scratch / str(n)
                folder.mkdir(exist_ok=True)
                answers[q.name] = self._letter_file(essay.text, folder)
            else:
                answers[q.name] = essay.text
        self.answers = {name: answer for name, answer in answers.items() if name not in self._skipped}
        return None

    def verify(self, readback: dict, review: list[str], rescued: tuple[str, ...]) -> "verify.Verification":
        """Verify the filled form (apply.verify), with the Pre-submit review's findings and what Claude guessed."""
        guessed = [(one_line(d.question.label), d.shown) for d in self.drafted + self.unbanked] \
            + [(str(r).split(":", 1)[0], "filled by Claude for the Filler (a Rescue)") for r in rescued]
        return verify.check(
            self.questions, self.answers, readback, self.profile, self.posting, asked=self.missing,
            left=self.left | self._skipped, blanks=self.blanks, accepted=self.accepted, today=self._today, guessed=guessed, review=review,
            essays={e.question.name: e.text for e in self.written if e.text},
            allowed=essays.sources(self.profile, self.known(), facts=True), posting_text=self.text,
            dismissed=verify.dismissed(self.posting.id))

    def _letter_file(self, text: str, folder: Path) -> Path:
        """An essay asked as an upload, as the PDF cover letter; as plain text
        when Chrome can't print one, so the form still gets the letter."""
        path = folder / cover_letter.file_name(self.profile)
        try:
            cover_letter.pdf(text, self.posting, self.profile, path, self._today)
        except (OSError, RuntimeError, subprocess.SubprocessError):
            path = path.with_suffix(".txt")
            path.write_text(text)
        return path

    def own(self) -> set[str]:
        """The questions the form took Lisul's own Answer bank answer for."""
        return {q.name for q in self.banked if (entry := self._bank.get(q.label)) and entry.source == LISUL}

    def use_bank(self) -> None:
        """Count one use of each Answer bank answer the filled form took (a
        rehearsal, which sends nothing, counts none), and note the unreviewed
        drafts among them with their uses, this one included."""
        labels = [q.label for q in self.banked if q.name in self.answers]
        if not self._rehearse:
            self._bank.use(labels, self._today)
        drafts = [entry for label in labels if (entry := self._bank.get(label)) and not entry.reviewed]
        self.reused = [(one_line(e.question), ", ".join(e.answer) if isinstance(e.answer, list) else e.answer,
                        e.uses + self._rehearse) for e in drafts]

    def overused(self) -> list[str]:
        """Why the unreviewed drafts used again too often hold the Application,
        under the max_unreviewed_uses policy (off unless set); never an approved Hold."""
        limit = self.profile.policy("max_unreviewed_uses")
        if not limit or self._approved is not None:
            return []
        return [f"'{q}': unreviewed answer used {n} times: review it in the Answers tab"
                for q, _, n in self.reused if n >= limit]

    def known(self) -> str:
        """What the essays know of the company: the Company material, with the Company brief in it."""
        return company.with_source(self.material or "", brief.SOURCE, self.brief)

    def posting_text(self) -> str:
        """The Posting's own text, read once; "" when it can't be read."""
        if self.text:
            return self.text
        if self._posting_text is None:
            try:
                self._posting_text = company.description(self.posting, self._site)
            except Exception:
                self._posting_text = ""
        return self._posting_text

    def _missing(self, missing: list[Question], asks: list[str] = ()) -> Result | None:
        """A Missing fact Result for the first of `missing`, in form order,
        then of `asks` (what an essay asks Lisul for, apply.essays.ASK); a
        rehearsal lists them all instead and goes on."""
        missing, was = [q for q in self.questions if q in missing and q.name not in self.lisuls], self.missing
        self.missing = tuple(dict.fromkeys([*(q.label.strip() for q in missing), *asks]))
        self.choices = {q.label.strip(): offered for q in missing if (offered := choices(q))}
        # The form's own required flag; what an essay asks him is for a slot the essay needs.
        self.required = {q.label.strip(): q.required for q in missing} | {asked: True for asked in asks}
        if self._rehearse and self.missing != was:
            self._on_missing(self.missing, self.choices, self.required)
        if self.missing and not self._rehearse:
            question = self.missing[0]
            return Result(Status.MISSING_FACT, f"Missing fact: {question}", missing_fact=question,
                          choices={question: self.choices[question]} if question in self.choices else {},
                          required={question: self.required[question]})
        return None

    def skip(self, error: FillError) -> bool:
        """Drop the answer a Filler couldn't fill, named first in its error
        ("<field>: why"), so the rest can be filled. False if it names none."""
        field = str(error).split(":", 1)[0].strip()
        name = next((q.name for q in self.questions if field in (q.name, q.label.strip())), None)
        if name not in self.answers:
            return False
        self._skipped.add(name)
        self.answers = {n: a for n, a in self.answers.items() if n != name}
        self.unfilled.append(str(error))
        return True

    def _holds(self, essay: "essays.Essay", high_stakes: bool) -> list[str]:
        q = essay.question
        if not essay.text and essay.plan and essay.plan.asks:
            asked = "; ".join(a.removeprefix(essays.ASK) for a in essay.plan.asks)
            return [f"'{one_line(q.label)}' is written once you answer: {asked}"]
        if not essay.text:
            writer = "Claude wrote" if self._approved is None else "The approved Essay column has"
            return [f"{writer} nothing for '{one_line(q.label)}'"]
        holds = []
        if high_stakes and self._approved is None:
            holds.append(f"High-stakes essay: '{one_line(q.label)}'")
        if essay.needs_lisul:
            holds.append(f"'{one_line(q.label)}' needs your input beyond the Story bank")
        if essay.unsupported:
            holds.append(f"'{one_line(q.label)}' states {', '.join(essay.unsupported)}, which no source backs")
        if essay.giveaways:
            said = ", ".join(f"'{words}'" for words in essay.giveaways)
            holds.append(f"'{one_line(q.label)}' gives away how it was written ({said}), even drafted again")
        # A number no source backs is said once, above, not again as a failed gate.
        if failed := [f for f in essay.failed
                      if not (f.startswith(UNTRACED_NUMBER) and f.removeprefix(UNTRACED_NUMBER) in essay.unsupported)]:
            holds.append(f"'{one_line(q.label)}' fails its checks: {'; '.join(failed)}")
        return holds


def named(posting: Posting, result: Result) -> Posting:
    """The Posting, with the company and role its form's page named where
    its link named neither (a Request on a job system with no Filler)."""
    company, title = result.named
    return replace(posting, company=posting.company or company, title=posting.title or title)


def _screenshot(page) -> bytes:
    """The filled form, or the page its submit led to, for its Record: the whole page, else what the window
    shows, else none. A capture that hangs (seen live, while another client
    screenshotted the page) never costs the Application. A page in a Worker's
    own window gets only what the window shows: a whole-page capture lays the
    form out at full length in the window Lisul is watching (live, four such
    windows went blank as their forms were filled, and every capture hung)."""
    whole = [] if browsers.headed(page) else [{"full_page": True, "timeout": 15_000}]
    for options in (*whole, {"timeout": 15_000}):
        try:
            return page.screenshot(**options)
        except Exception:
            continue
    return b""


def _is_target(posting: Posting, profile: ApplicantProfile) -> bool:
    return any(is_company(posting.company, name) for name in profile.policy("target_companies") or [])

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
    asking,
    brief,
    browsers,
    captcha,
    company,
    cover_letter,
    description,
    eligibility,
    essays,
    gates,
    regenerate,
    sameness,
    stuck,
    verify,
)
from apply.adapters import Claude, JobSite, UsageLimitHit
from apply.answer_bank import LISUL, AnswerBank
from apply.applicant import as_applicant
from apply.fill_engine import (
    company_specific,
    context_free,
    left_blank,
    not_called_for,
    plan,
    posting_ai_trap,
    posting_bans_ai,
    readback_problems,
    remember,
    shows,
    ticked,
    to_tick,
    trap_handoff,
)
from apply.fillers import Filler, Handoff, MoreQuestions
from apply.gates import UNTRACED_NUMBER
from apply.home import HOME
from apply.model import (
    NOT_A_POSTING,
    Blocked,
    Captcha,
    Closed,
    FillError,
    NotAPosting,
    Posting,
    Question,
    Status,
    host_company,
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
# Why an optional catch-all box ("Additional information") is blank: on purpose, always (KAN-625).
CATCH_ALL_BLANK = "an optional catch-all box, which Apply always leaves blank"


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
    where: dict[str, str] = field(default_factory=dict)  # each Missing fact's context line, by question (apply.asking)
    traceback: str = ""  # where a Failed Application's error came from, for its Repair request
    problems: tuple[str, ...] = ()  # answers the Pre-submit check found wrong, or a rehearsal couldn't fill
    drafted: tuple[tuple[str, str], ...] = ()  # (question, answer) Claude drafted into the Answer bank, in form order
    named_facts: tuple[tuple[str, str], ...] = ()  # (question, Named fact) of each essay that names one, in form order
    named: tuple[str, str] = ("", "")  # the company and role the form's own page named (Claude fill)
    # (question, answer, uses) of each unreviewed draft the Answer bank answered this form with, in form order
    reused: tuple[tuple[str, str, int], ...] = ()
    bot_signals: tuple[str, ...] = ()  # what suggested the job system took the browser for a bot (apply.bot_signals)
    verification: "verify.Verification | None" = None  # how verifying the filled form went (apply.verify)
    # each answer Claude wrote for the form, kept so Lisul can have one written again (apply.regenerate)
    regenerable: "regenerate.Form | None" = None
    # (label, answer) of each answer that came after its step was saved without it (KAN-687): never on the form
    left_behind: tuple[tuple[str, object], ...] = ()

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
    on_missing: Callable[[tuple[str, ...], dict[str, dict], dict[str, bool], dict[str, str]], None] = lambda *heard: None,
    on_verify: Callable[["verify.Verification | None"], None] = lambda verification: None,
    on_pause: Callable[[Result, Callable[[object], str]], bool] = lambda stopped, blocked: False,
    on_captcha: Callable[[str, object, str], bool] = lambda why, page, company: False,
    anyway: bool = False,
    fetched: str | None = None,
    draft: dict | None = None,
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
    `on_missing` hears a rehearsal's Missing facts (each one's options,
    whether its form requires it, and its context line: apply.asking)
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
    False: the Handoff ends the rehearsal as before.
    A captcha that stops the fill (model.Captcha), in a run or a rehearsal,
    goes to `on_captcha` first, with its reason, its page and the company
    that the link or the page names (captcha.Waiter): True, Lisul did it, and the fill goes on on that page.
    False, the time ran out: it is a Handoff (or a rehearsal's pause).
    With `anyway` (Lisul pressed Fill it anyway on a rehearsal that ruled him out), neither the Posting's
    text nor a failed Screener ends it: the form is filled as in any rehearsal.
    `fetched` is the Posting's page as a plain fetch read it, when the caller
    read it already (embedded.form_behind), so it is not fetched again.
    `draft` is what a reopened form held before Apply stopped (`apply reopen`, KAN-720: its Record's answers,
    by field name, each with its question, kept only where the field asks the same question now): before each fill, it and what the job system's own saved draft shows on the step
    (the Filler's `resumed`) are kept, as a Resume keeps Lisul's, so the form comes back as it was."""
    planned = _Planned(posting, site, profile, claude, answered or {}, approved, rehearse, bank or AnswerBank(),
                       today or date.today(), on_files, on_missing)
    planned.anyway = anyway
    try:
        result = _apply(planned, filler, site, before_submit, rehearse, before_fill, on_verify, on_pause, on_captcha,
                        fetched, draft)
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
    result.drafted = tuple((one_line(planned.wording(d.question)), d.shown) for d in planned.drafted)
    result.reused = tuple(planned.reused)
    result.named_facts = tuple((one_line(e.question.label), e.named) for e in planned.written if e.named)
    if rehearse and result.filled is not None:  # a page held for Lisul: each answer Claude wrote has its regenerate
        result.regenerable = regenerate.form_of(planned)
    return result


def _held(draft: dict, questions: list[Question]) -> dict:
    """A reopened form's draft (apply.batch.draft), by field name, where the field asks the same question now."""
    asks = {q.name: one_line(q.label) for q in questions}
    return {name: value for name, (label, value) in draft.items() if asks.get(name) == label}


def _saved_draft(filler, page) -> dict:
    """What the job system's own saved draft shows on the step open now, by field name (the Filler's `resumed`,
    Workday's), for a reopened form; {} for a Filler that can't read it."""
    try:
        return dict(getattr(filler, "resumed", lambda page: {})(page))
    except Exception:
        return {}


class ResumeCheck:
    """A Filler's checks on a paused page: called, why Resume can't go on now ("" when it can; `resume_blocked`);
    `signed_in(page)`, whether the page is past its sign-in (the check its own sign-in makes, so a Fill again signs
    in no more), or None when the Filler has none. A rehearsal paused at a sign-in goes on by itself once it is."""

    def __init__(self, filler):
        self._blocked = getattr(filler, "resume_blocked", None)
        self.signed_in = getattr(filler, "signed_in", None)

    def __call__(self, page) -> str:
        return self._blocked(page) if self._blocked else ""


def _apply(planned: "_Planned", filler, site, before_submit, rehearse, before_fill=lambda: None,
           on_verify=lambda verification: None, on_pause=lambda stopped, blocked: False,
           on_captcha=lambda why, page, company: False, fetched: str | None = None, draft: dict | None = None) -> Result:
    posting, profile, claude = planned.posting, planned.profile, planned.claude
    read = description.from_api(posting, site)
    if (why := eligibility.not_eligible(read)) and not planned.anyway:  # before any form opens or Claude is asked
        return Result(Status.NOT_ELIGIBLE, why)
    fetched = read or (description.from_link(posting, site) if fetched is None else fetched)  # no browser yet
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
        blocked = ResumeCheck(filler)

        def go_on(page) -> None:
            """Lisul pressed Resume while Apply filled (apply.stuck): what he put on the page is his answer."""
            planned.keep(getattr(filler, "resumed", lambda page: {})(page))
            stuck.resumed()
        while True:
            try:
                stuck.doing("Reading the form's questions")
                questions = filler.question_set(posting.url, site)
                break
            except HTTPError as error:
                if error.code in (404, 410):
                    raise Closed(f"the job system no longer has this Posting (HTTP {error.code})") from error
                raise
            except Handoff as stopped:  # a sign-in Lisul finishes himself, then Resume reads the questions
                handoff = captcha.as_block(stopped, getattr(stopped, "page", None), _company(planned.posting, filler),
                                           posting.url)
                if isinstance(handoff, Captcha) and on_captcha(str(handoff), handoff.page, _company(planned.posting, filler)):
                    continue  # he did the captcha: the questions are read again, from the page he left
                if handoff is not stopped:  # a bot block: at once, to his own Chrome, never paused for a Resume that retries
                    raise handoff from stopped
                if isinstance(handoff, Blocked) or not (rehearse and on_pause(_handed_off(handoff), blocked)):
                    raise
        # No API for it: what the Filler read off the open posting page (Claude fill), else the plain fetch.
        planned.text = read or getattr(filler, "posting_text", "") or fetched
        # A Request on a job system with no Filler: its link named no company, but its open page did
        # (Claude fill). Planned with that name, "why <company>?" is the High-stakes essay it is.
        # Else its link's host, when it is a job site known to be one company's (amazon.jobs: Amazon).
        company, title = getattr(filler, "names", None) or ("", "")
        planned.posting = posting = replace(posting, company=posting.company or company or host_company(posting.url),
                                            title=posting.title or title)
        # A rehearsal shows its form while Claude writes its answers; a run opens it only once they're written.
        if not rehearse and (stop := planned.add(questions)):
            return stop
        form_url = getattr(filler, "form_url", lambda url: url)(posting.url)  # where its form is, if not the posting
        replanned = fixed = False  # each is tried once: a fill again after a readback mismatch, and after the review's fixes
        for attempt in range(3):
            with site.open(form_url) as page:
                if rehearse and attempt == 0 and (stop := _plan(planned, questions, filler, page, go_on)):
                    return stop
                before_fill()
                before_fill = lambda: None
                while True:
                    try:
                        with stuck.stoppable():
                            if stuck.pressed():  # a Resume pressed while Apply was busy, not waiting: taken here
                                raise stuck.Stopped("you pressed Resume")
                            stuck.doing(f"Filling {_where(filler)}")
                            if draft is not None:  # a reopened form: what it held, and the site's saved draft (KAN-720)
                                planned.keep(_held(draft, planned.questions) | _saved_draft(filler, page))
                            readback = filler.fill(page, planned.questions, planned.answers)
                        break
                    except stuck.Stopped:  # Resume, while Apply waited inside the fill
                        go_on(page)
                    except MoreQuestions as more:  # the form's next step asks these
                        if stop := _plan(planned, more.questions, filler, page, go_on):
                            return stop
                    except FillError as error:
                        # A rehearsal goes on without the field and says so; a run stops.
                        if not (rehearse and planned.skip(error)):
                            raise
                    except Handoff as handoff:  # a rehearsal says which blanks may have stopped it
                        handoff = captcha.as_block(handoff, page, _company(planned.posting, filler), posting.url)
                        if isinstance(handoff, Captcha) and on_captcha(str(handoff), handoff.page, _company(planned.posting, filler)):
                            continue  # he did the captcha: the fill goes on from the page he left
                        # What it planned and what the page showed so far, for its Record: a step Workday won't
                        # leave is read from it.
                        shown = dict(getattr(filler, "shown_so_far", {}))
                        stopped = _handed_off(handoff, missing=planned.missing, choices=planned.choices,
                                              left_behind=_left_behind(filler),
                                              required=planned.required, where=planned.where,
                                              filled=Filled(planned.questions, planned.answers, shown, _screenshot(page),
                                                            html=page_html(page)))
                        if isinstance(handoff, Blocked) or not (rehearse and on_pause(stopped, blocked)):
                            return stopped  # a bot block is never paused: Resume would only try again
                        # Resume: what Lisul put on the step it stopped on stays, as his answers.
                        planned.keep(getattr(filler, "resumed", lambda page: {})(page), getattr(filler, "paused", None))
                questions, answers, holds = planned.questions, planned.answers, list(planned.holds)
                behind = _left_behind(filler)
                holds = ([f"Not filled: {e}" for e in planned.unfilled] + holds
                         + [f"Not filled: {label} ({LEFT_BEHIND})" for label, _ in behind] + planned.to_tick)
                filled = Filled(questions, answers, readback, _screenshot(page), html=page_html(page))
                problems = readback_problems(questions, answers, readback, planned.accepted)
                if problems and not replanned and attempt < 2:
                    # Perhaps a timing glitch, or the page words it its own way: Sonnet plans
                    # those answers again, and the form is filled once more in a fresh page.
                    replanned = True
                    if not planned.handoffs:  # a form Lisul finishes gets no Claude call
                        stuck.doing("Planning again the answers the page showed otherwise")
                        try:
                            with stuck.stoppable():
                                planned.answers = replan(claude, questions, answers, readback, planned.accepted,
                                                         posting, planned.text)
                        except stuck.Stopped:  # Resume: the answers stay as planned, and his from the page
                            go_on(page)
                    continue
                problems += _unasked(filler, page, questions)
                planned.use_bank()
                if planned.handoffs:  # filled but for what only Lisul may answer; no Claude call
                    checked = ["Pre-submit check failed. " + "; ".join(problems)] if problems else []
                    return Result(Status.HANDOFF, "; ".join(planned.handoffs + checked + planned.to_tick + [FILLED_BUT]), filled)
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
                    found = review(as_applicant(claude, profile), posting, questions, readback, sources, planned.text,
                                   planned.own())  # its reasons say the applicant's own pronouns
                    if not fixed and attempt < 2 and planned.fix(found.fixes, readback):
                        # The review named the right answer for a wrong one (an internship start in a school's
                        # From): it is filled in its place, and the form filled and reviewed again, before
                        # Lisul sees it as ready.
                        fixed = True
                        continue
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
                                  choices=planned.choices, required=planned.required, where=planned.where, problems=wrong,
                                  verification=verification, left_behind=behind)
                if holds:
                    return Result(Status.HELD, "; ".join(holds), filled, essay=planned.essay_cell, problems=wrong,
                                  verification=verification)
                hold = before_submit()
                if hold:
                    return Result(Status.HELD, hold, filled, essay=planned.essay_cell, problems=rescued,
                                  verification=verification)
                try:
                    # A captcha after the click: Lisul does it, and the confirmation is waited for again.
                    with captcha.at_submit(lambda page: on_captcha(captcha.AT_SUBMIT, page,
                                                                   _company(planned.posting, filler))):
                        met = filler.submit(page)
                except Handoff as handoff:  # it may have gone: the Record shows where the click left the page
                    handoff = captcha.as_block(handoff, page, _company(planned.posting, filler), posting.url)
                    return _handed_off(handoff, filled=replace(filled, after_submit=_screenshot(page)))
                return Result(Status.SUBMITTED, filled=replace(filled, after_submit=_screenshot(page)),
                              bot_signals=tuple(met or ()), problems=rescued, verification=verification)


def _where(filler) -> str:
    """The step the form shows, for the tile ("'Application Questions'"), when its Filler names it; else "the form"."""
    step = getattr(filler, "step", "")
    return f"'{step}'" if step else "the form"


def _plan(planned: "_Planned", questions: list[Question], filler, page, go_on: Callable[[object], None]) -> "Result | None":
    """Plan the form's `questions`. A Resume pressed while Apply waits on Claude
    for them stops that wait (apply.stuck): they are Lisul's, as he left them on the page."""
    where = _where(filler)
    stuck.doing(f"Planning answers for {where}")
    try:
        with stuck.stoppable():
            return planned.add(questions, where)
    except stuck.Stopped:
        go_on(page)
        return None


PLACEHOLDER = re.compile(r"^\W*(select|choose|pick)\b.*|^\W*$")  # "Select...", or no words: not an option


def choices(question: Question) -> dict | None:
    """What a Missing fact offers to pick from, for the Inbox: {"kind": "select" or
    "multi_select", "options": [...]}; None for one answered in words, or whose
    options weren't read; {"kind": "file", "options": []} for one that takes a file."""
    if question.kind == "file":
        return {"kind": "file", "options": []}
    options = [o for o in question.options if not PLACEHOLDER.match(o.strip().lower())]
    return {"kind": question.kind, "options": options} if question.kind in ("select", "multi_select") and options else None


def _company(posting: Posting, filler) -> str:
    """The company the link names, else the one its open page names (Claude fill), else its known host's."""
    return posting.company or (getattr(filler, "names", None) or ("", ""))[0] or host_company(posting.url)


# Why a left-behind answer is not on the form (KAN-687).
LEFT_BEHIND = "its answer came after the form saved its step without it"


def _left_behind(filler) -> tuple[tuple[str, object], ...]:
    """The answers a Filler found no field for, since their step had gone by (ClaudeFill's `left_behind`)."""
    return tuple(getattr(filler, "left_behind", None) or ())


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
                 on_missing: Callable[[tuple[str, ...], dict[str, dict], dict[str, bool], dict[str, str]], None] = lambda *heard: None):
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
        self.where: dict[str, str] = {}  # each one's context line, by question (apply.asking)
        self.found: dict[str, str] = {}  # what Apply already held for a field it would have asked, by name (asking.known)
        self.unfilled: list[str] = []  # why a rehearsal's Filler couldn't fill each answer it left out
        self._skipped: set[str] = set()
        self.left: set[str] = set()  # fields left blank on purpose: an N/A optional, a follow-up not called for
        self.lisuls: dict[str, object] = {}  # what Lisul put on a paused form's step before Resume, by name
        self._yours: set[Question] = set()  # questions a Resume stopped Claude from answering: Lisul's, on the page
        self.questions: list[Question] = []
        self.anyway = False  # Lisul pressed Fill it anyway: a failed Screener doesn't end it
        self._answers: dict = {}
        self.accepted: dict[str, tuple[str, ...]] = {}  # other wordings Lisul accepts for an answer, by Question name
        self.blanks: dict[str, str] = {}  # fields the engine's plan leaves blank on purpose, by name: why
        self.attestations: dict[str, str] = {}  # attestations and signatures, by name: their wording, Lisul's to tick
        self.filed: dict[str, str | None] = {}  # each bare date's Answer bank wording, by name (fill_engine.Plan.filed)
        self.sections: dict[str, str] = {}  # each bare date's section, by name (fill_engine.Plan.sections)
        self.fixes: dict[str, object] = {}  # the Pre-submit review's fixes, by name: no plan writes over them
        self.fixed: list[tuple[str, str]] = []  # (question, answer) of each, for Verifying to list
        self.kept_blank: dict[str, str] = {}  # optional catch-all boxes Apply leaves blank on purpose, by name: why
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
        # What Apply already held is the answer to a field it would have asked; the review's fix wins over the
        # plan; what Lisul put on the page wins over both.
        # An attestation is never Apply's to answer, from any of them: only what Lisul ticked himself (KAN-676).
        self._answers = {n: a for n, a in (answers | self.found | self.fixes).items() if n not in self.attestations} | self.lisuls
        self._keep_files()

    @property
    def to_tick(self) -> list[str]:
        """The Check before Submit lines for the attestations Lisul has not ticked on a paused step: "Yours to tick: ..."."""
        return [to_tick(wording) for name, wording in self.attestations.items() if name not in self.lisuls]

    def keep(self, values: dict, paused: dict | None = None) -> None:
        """Keep what Lisul put on a paused form before Resume (the Filler's
        `resumed`) as his answers: no plan, Claude or Filler writes over them,
        and a Missing fact he answered there waits on him no more. An
        attestation is his only once he ticked it himself: a tick other than
        what the page showed at the pause (`paused`, the Filler's read of it).
        Unread at the pause, or untouched, it stays on his list (KAN-676)."""
        by_name = {q.name: q for q in self.questions}
        values = {name: value for name, value in values.items()  # what Apply had put there itself stays Apply's
                  if (name not in self._answers or not shows(value, self._answers[name], self.accepted.get(name, ())))
                  and (name not in self.attestations or (paused is not None and name in paused and value != paused[name]
                                                         and ticked(value, by_name.get(name))))}
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

    def add(self, questions: list[Question], where: str = "the form") -> Result | None:
        """Plan the form again with `questions` added. A Result if the
        Application ends here: Not eligible or a Missing fact. A form with
        questions only Lisul may answer (an essay on a form that bans AI
        text, a video) is still filled, without Claude, and then handed off;
        so is one whose Posting description or Company material bans AI text
        or speaks to AI agents, which then never reaches Claude. A Resume
        pressed while Claude is asked (apply.stuck.Stopped) leaves the questions
        Claude had not answered to Lisul, and raises Stopped again."""
        posting, profile = self.posting, self.profile
        for q in questions:
            # A bare date's answer (From, To) is one section's: it is this form's alone, never kept by its wording.
            if q.label.strip() in self._answered and not context_free(q.label):
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
        self.attestations = planned.attestations
        self.filed, self.sections = planned.filed, planned.sections
        for q in self.questions:  # Lisul's answer to a bare date on this form, as he gave it
            if q.name in planned.filed and (given := self._answered.get(q.label.strip())) is not None:
                planned.answers[q.name] = given
                planned.missing = [m for m in planned.missing if m.name != q.name]
                planned.drafts = [d for d in planned.drafts if d.name != q.name]
        if planned.not_eligible and not self.anyway:
            return Result(Status.NOT_ELIGIBLE, planned.not_eligible)
        if planned.handoffs:  # a form Lisul finishes gets no Claude call: its one-off questions are his too
            yours = [q for q in self.questions if q in planned.missing + planned.drafts]
            self.handoffs = planned.handoffs + [f"Answer '{q.label.strip()}' too"
                                                + (f" ({line})" if (line := asking.where(q, self.questions)) else "")
                                                for q in yours]
            self.answers = {n: a for n, a in planned.answers.items() if n not in self._skipped}
            return None
        if stop := self._missing(planned.missing):
            return stop
        # An optional catch-all box ("Additional information", "Anything else?") stays blank on purpose, always:
        # Claude never drafts it and Lisul is never asked it (Lisul, 2026-11-04). A required one is answered.
        self.kept_blank |= {q.name: CATCH_ALL_BLANK for q in planned.essays + planned.drafts if essays.catch_all(q)}
        done = {essay.question for essay in self.written}
        new = [q for q in planned.essays if q not in done and q not in self._yours and q.name not in self.kept_blank]
        to_draft = [q for q in planned.drafts if q not in self._asked and q.name not in self.kept_blank]
        name = posting.company or "the company"
        try:
            if new and self.material is None:
                stuck.doing(f"Reading {name}'s pages for an essay")
                self.material = company.gather(posting, new, self._site)
                if posting_ai_trap(self.material) or posting_bans_ai(self.material):
                    return self.add([], where)  # planned again, the material read with the posting: its essays are Lisul's
                stuck.doing(f"Researching {name} for an essay")
                self.brief = brief.brief(posting, self._site, self.claude, self._today, self.text, self.questions)
            ask = new if self._approved is None else []
            given = planned.answers | {d.question.name: d.answer for d in self.drafted + self.unbanked}
            answered = {q: given[q.name] for q in self.questions if q.name in given}  # "the area you picked above"
            if ask or to_draft:
                stuck.doing(f"Writing answers for {where}")
            written, drafted = essays.answer(self.claude, posting, ask, to_draft, profile, self.known(), self.text,
                                             answered=answered, sections=self.sections) if ask or to_draft else ([], [])
        except stuck.Stopped:
            self._to_lisul(planned.answers, planned.missing, new + to_draft)
            raise
        if self._approved is not None:
            written = essays.from_cell(self._approved, new)
        self.written += written
        self._asked |= set(to_draft)
        for draft in drafted:
            if draft.needs_lisul:
                continue
            # True of this company only, or a bare date no section places: drafted again each time, never banked.
            if company_specific(draft.question, posting) or self.filed.get(draft.question.name, "") is None:
                self.unbanked.append(draft)
            else:
                self._bank.add(draft.question, draft.answer, posting.company, self._today, list(draft.facts),
                               wording=self.wording(draft.question))
                self.drafted.append(draft)
        given = {d.question.name: d.answer for d in self.drafted + self.unbanked}
        # A follow-up to a question Claude just answered ("If yes, ...", answered No) that the answer doesn't call for.
        # One the engine held for that answer (Plan.waiting) is decided the same way: blank when not called for,
        # asked of Lisul with the form's own label when it is, and still waiting while its question is unanswered.
        waiting = [q for q in self.questions if q.name in planned.waiting]
        moot = {q: answer for q in planned.drafts + waiting
                for is_moot, answer in [not_called_for(q, self.questions, planned.answers | given)] if is_moot}
        called_for = [q for q in waiting if q not in moot and planned.waiting[q.name] in planned.answers | given]
        self.left |= {q.name for q in waiting if q not in moot and q not in called_for}
        answered = {d.question for d in self.drafted + self.unbanked} | set(moot) \
            | {q for q in planned.drafts if q.name in self.kept_blank}
        asks = [asked for essay in self.written if essay.plan for asked in essay.plan.asks]
        if stop := self._missing(planned.missing + [q for q in planned.drafts if q not in answered] + list(self._yours)
                                 + called_for, asks):
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
            if long := gates.over_cap(essay.text, q):
                if (hold := f"'{one_line(q.label)}' is left off the form: {long[0]}") not in self.holds:
                    self.holds.append(hold)  # never sent over its limit, Claude's or Lisul's
                continue
            if q.kind == "file":  # each in its own folder, so the employer still sees its own file name
                folder = self.scratch / str(n)
                folder.mkdir(exist_ok=True)
                answers[q.name] = self._letter_file(essay.text, folder)
            else:
                answers[q.name] = essay.text
        self.answers = {name: answer for name, answer in answers.items() if name not in self._skipped}
        return None

    def _to_lisul(self, answers: dict, missing: list[Question], questions: list[Question]) -> None:
        """A Resume stopped Claude before it answered `questions`: they are
        Lisul's, as he fills them on the page, and listed as Missing facts till
        he does; the plan's other answers, and Claude's from before, stay."""
        self._yours |= set(questions)
        self._asked |= set(questions)
        before = {n: a for n, a in self._answers.items() if n not in answers}
        self.answers = {n: a for n, a in (answers | before).items() if n not in self._skipped}
        self._missing(missing + list(self._yours))

    def verify(self, readback: dict, review: list[str], rescued: tuple[str, ...]) -> "verify.Verification":
        """Verify the filled form (apply.verify), with the Pre-submit review's findings and what Claude guessed."""
        guessed = [(one_line(d.question.label), d.shown) for d in self.drafted + self.unbanked
                   if d.question.name not in self.fixes] \
            + [(question, f"{answer} (the Pre-submit review's fix, filled in place of the plan's)")
               for question, answer in self.fixed] \
            + [(str(r).split(":", 1)[0], "filled by Claude for the Filler (a Rescue)") for r in rescued]
        return verify.check(
            self.questions, self.answers, readback, self.profile, self.posting, asked=self.missing,
            left=self.left | self._skipped, blanks=self.blanks | self.kept_blank, accepted=self.accepted, today=self._today, guessed=guessed, review=review,
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
        return {q.name for q in self.banked if (entry := self._bank.get(self.wording(q))) and entry.source == LISUL}

    def wording(self, q: Question) -> str:
        """The wording the Answer bank files `q`'s answer under: a bare date's section and label, else its label."""
        return self.filed.get(q.name) or q.label

    def fix(self, fixes: dict[str, str], readback: dict) -> bool:
        """Fill the Pre-submit review's `fixes` (its right answer, by the question's label on one line) in
        place of Claude's guesses: its drafts, and its earlier drafts the Answer bank answered with. Never over
        an answer the plan took from the profile (General Motors' degree, live: the review called "Bachelor
        Degree" wrong), Lisul's own answer (on the page or in the Answer bank), an essay, a file or a secret,
        nor an answer that isn't one of the question's options. So no plan writes over them, and a draft it
        fixes leaves the Answer bank: the bank never keeps an answer known wrong. True if any answer changed.
        A legal or eligibility question (verify.LEGAL: U.S. Person, work authorization, age...) is the one
        exception to the profile's: the review read it against the profile and found it wrong (Saronic's U.S.
        Person "No", live), so its fix, one of the question's options, is filled there too, and reviewed again."""
        own, essays_asked = self.own(), {e.question.name for e in self.written}
        guessed = {d.question.name for d in self.drafted + self.unbanked} | {q.name for q in self.banked if q.name not in own}
        legal = {q.name for q in self.questions if q.options and verify.LEGAL.search(q.label) and q.name not in own}
        changed = False
        for q in self.questions:
            answer = fixes.get(one_line(q.label))
            if (answer is None or q.name not in guessed | legal or q.kind in ("file", "multi_select") or q.name in self.lisuls
                    or q.name in self.attestations
                    or q.name in essays_asked or SECRET.search(q.label) or SECRET.search(q.name)
                    or (q.options and answer not in q.options) or shows(readback.get(q.name, ""), answer)):
                continue
            for draft in [d for d in self.drafted if d.question.name == q.name]:
                entry = self._bank.get(self.wording(q))
                if entry and entry.source != LISUL and not entry.reviewed:
                    self._bank.delete(self.wording(q))
                self.drafted.remove(draft)
            self.fixes[q.name] = answer
            self.fixed.append((one_line(q.label), answer))
            changed = True
        if changed:
            self.answers = self._answers
        return changed

    def use_bank(self) -> None:
        """Count one use of each Answer bank answer the filled form took (a
        rehearsal, which sends nothing, counts none), and note the unreviewed
        drafts among them with their uses, this one included."""
        labels = [self.wording(q) for q in self.banked if q.name in self.answers]
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
        rehearsal lists them all instead and goes on. A question Apply already
        holds the answer to (apply.asking.known) never reaches him: a text
        field gets that answer, and an ask is dropped. Each one asked has its
        context line (apply.asking): its step, the question it follows and its
        pair, or the essay it is for."""
        missing, was = [q for q in self.questions if q in missing and q.name not in self.lisuls], self.missing
        found = {q.name: asking.value(facts) for q in missing if q.kind in ("text", "textarea") and q.name not in self.found
                 and (facts := asking.known(q.label, self.profile, self._bank))}
        if found:
            self.found |= found
            self.answers = self._answers
        missing = [q for q in missing if q.name not in self.found]
        asks = [asked for asked in asks if not asking.known(asked, self.profile, self._bank)]
        self.missing = tuple(dict.fromkeys([*(q.label.strip() for q in missing), *asks]))
        self.choices = {q.label.strip(): offered for q in missing if (offered := choices(q))}
        # The form's own required flag, for what an essay asks him too: its essay's (Saronic's optional
        # follow-up showed Required, live 2026-11-04).
        essay_of = {asked: e.question for e in self.written if e.plan for asked in e.plan.asks}
        self.required = {q.label.strip(): q.required for q in missing} \
            | {asked: essay_of[asked].required if asked in essay_of else True for asked in asks}
        self.where = {q.label.strip(): line for q in missing if (line := asking.where(q, self.questions))} \
            | {asked: asking.for_essay(essay_of[asked]) for asked in asks if asked in essay_of}
        if self._rehearse and self.missing != was:
            self._on_missing(self.missing, self.choices, self.required, self.where)
        if self.missing and not self._rehearse:
            question = self.missing[0]
            where = self.where.get(question, "")
            return Result(Status.MISSING_FACT, f"Missing fact: {question}" + (f"; {asking.IN}{where}" if where else ""),
                          missing_fact=question,
                          choices={question: self.choices[question]} if question in self.choices else {},
                          required={question: self.required[question]}, where={question: where} if where else {})
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
    return replace(posting, company=posting.company or company or host_company(posting.url),
                   title=posting.title or title)


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


def page_html(page) -> str:
    """The page's HTML for its Record, from a plain Worker's page (KAN-611); "" from any other page,
    or one that can't be read."""
    record_html = getattr(page, "record_html", None)
    if record_html is None:
        return ""
    try:
        return record_html()
    except Exception:
        return ""


def _is_target(posting: Posting, profile: ApplicantProfile) -> bool:
    return any(is_company(posting.company, name) for name in profile.policy("target_companies") or [])

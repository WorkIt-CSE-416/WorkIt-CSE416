"""
Layer 2, written answers (KAN-377, KAN-379, KAN-380, KAN-385): the
questions a batch tab's form needs written, the answers the student's
Claude (through the connector) or the student (on the Written Answers
page) saves for them, each checked by checks.py first, and the answer bank
the extension's Plan fills later forms from. pipeline.py names each of
these steps too, for its callers. Each checks the stage it needs and owns
its transaction, as every layer-2 step does.
"""

import dataclasses
import uuid
from collections.abc import Collection, Iterable, Sequence
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.auto_apply import briefs, checks
from app.auto_apply.queries import (
    drop_written,
    fetch_answered,
    fetch_application_companies,
    fetch_brought_answers,
    fetch_next_to_write,
    fetch_posting_text,
    fetch_saved_answers,
    fetch_stage,
    fetch_unanswered,
    fetch_written,
    put_questions,
    save_own_written,
    save_written,
)
from app.auto_apply.stages import NotFound, get_application, open_application
from app.queries import writing
from app.schemas.applications import (
    AnsweredQuestion,
    Application,
    NamedFact,
    OwnAnswer,
    PostingAnswers,
    PostingQuestions,
    SavedAnswer,
    WrittenAnswer,
    WrittenQuestion,
)
from app.services.bank import Bank, load_bank


async def ask_questions(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, questions: Sequence[WrittenQuestion]
) -> list[WrittenAnswer]:
    """
    Keeps the questions a batch tab's form needs written (KAN-377), for the
    student's Claude to answer through the connector, and answers every
    question the application has, with the answers saved so far. The tab
    sends the form's own limit, which a question read early lacked: each
    saved answer of their Claude's is checked again against it (and the
    rest of checks.py but the copy check, which its save ran: a sample the
    student pasted themselves stays), and one that fails is dropped, never
    filled, for their Claude to write again. Only a queued or needs_you application:
    NotFound / WrongStage otherwise.
    """
    await open_application(db, applicant_id, job_id)
    await put_questions(db, applicant_id, job_id, questions)
    asked = {q.name for q in questions}
    answered = [q for q in await fetch_written(db, applicant_id, job_id) if q.answer and q.name in asked]
    if answered:
        sources, employers, _ = await _check_material(db, applicant_id, job_id)
        await drop_written(db, applicant_id, job_id, [
            q.name for q in answered
            if (picked(q, q.answer)[1] if q.kind else checks.problems(q.answer, checks.Context(
                sources=(*sources, q.label), employers=employers, limit=q.max_length, question=q.label,
            )))
        ])
    await db.commit()
    return await fetch_written(db, applicant_id, job_id)


async def written_answers(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> list[WrittenAnswer]:
    """An application's questions that need writing, with the answers saved
    so far (the open tab fills each new one). NotFound with no application."""
    if await fetch_stage(db, applicant_id, job_id) is None:
        raise NotFound("No application for that job.")
    return await fetch_written(db, applicant_id, job_id)


async def unanswered_questions(db: AsyncSession, applicant_id: uuid.UUID) -> list[PostingQuestions]:
    """
    Every question the student's open applications need written and have
    no answer for, under its job posting, oldest application first: the
    Written Answers page (KAN-385), for a student without Claude. Each
    answer pasted there is saved through save_answers, as the connector's.
    """
    return [
        PostingQuestions(job_id=job_id, company=company, title=title, questions=questions)
        for job_id, company, title, questions in await fetch_unanswered(db, applicant_id)
    ]


async def answered_questions(db: AsyncSession, applicant_id: uuid.UUID) -> list[PostingAnswers]:
    """
    Every written question the student's applications have an answer for,
    under its job posting, newest application first, each with the brief
    fact it names (KAN-369): the Written Answers page's record of what was
    sent, so the student can read up on each fact before an interview.
    """
    return [
        PostingAnswers(job_id=job_id, company=company, title=title, questions=[
            AnsweredQuestion(
                name=r.name, label=r.label, answer=r.answer or "", own=r.own,
                named_fact=NamedFact(**r.named_fact) if r.named_fact else None,
            )
            for r in rows
        ])
        for job_id, company, title, rows in await fetch_answered(db, applicant_id)
    ]


class Refused(Exception):
    """A save refused whole, with the reason for the student's Claude (or
    the student, on the Written Answers page) to fix it by. Nothing was
    saved. `reasons`: each refused answer's reasons, by question name."""

    def __init__(self, message: str, reasons: dict[str, list[str]] | None = None) -> None:
        super().__init__(message)
        self.reasons = reasons or {}


@dataclasses.dataclass(frozen=True)
class ToWrite:
    """One application's material for the student's Claude (KAN-377): only
    that application's job posting and questions, and the student's bank."""

    application: Application
    posting: str | None
    questions: list[WrittenAnswer]
    bank: Bank


async def next_to_write(
    db: AsyncSession, applicant_id: uuid.UUID, skip: Collection[uuid.UUID] = ()
) -> ToWrite | None:
    """The connector's next application: the oldest open one with a
    question still unanswered, other than the jobs in `skip` (those the chat
    was given already), its unanswered questions in the form's order. None
    when nothing is left to write."""
    found = await fetch_next_to_write(db, applicant_id, skip)
    if found is None:
        return None
    job_id, posting = found
    questions = [q for q in await fetch_written(db, applicant_id, job_id) if q.answer is None]
    return ToWrite(
        application=await get_application(db, applicant_id, job_id),
        posting=posting,
        questions=questions,
        bank=await load_bank(db, applicant_id),
    )


async def save_answers(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, answers: dict[str, str],
    *, by: Literal["claude", "student"] = "claude", named: dict[str, str] | None = None,
    reviews: dict[str, "Review"] | None = None,
) -> int:
    """
    Saves the student's Claude's answers to one application's questions
    (KAN-377), or the ones the student pasted on the Written Answers page
    (KAN-385): one save and one set of checks for both, so a pasted answer
    reaches the tab exactly as Claude's does. All or none, and answers how
    many of its questions are still unanswered. Each name must be one of
    the application's questions,
    and each answer must pass every check in app/auto_apply/checks.py
    (KAN-380), the form's own limit among them: a failing one is refused
    with every reason, for Claude to fix, so it never reaches the tab.
    `by` is who put the text there: "student" for a paste on the Written
    Answers page, which skips only the copy check against the student's
    own writing samples (it stops their Claude parroting them; the student
    may use their own words), every other check kept, since the paste may
    come from any AI. `named` gives, by question name, the company brief
    fact an answer uses (KAN-369), its sentence as the brief words it: it
    must be one of the brief's facts, and is saved with the answer, which
    names none without it. Claude's answer written in words also needs its
    Review (KAN-369, `reviews` by name), kept with it: a missing one, one
    rated under GOOD, or a cut claim still in the answer is refused. A paste
    needs none. Raises NotFound / WrongStage for an application that isn't
    open, Refused otherwise.
    """
    await open_application(db, applicant_id, job_id)
    questions = {q.name: q for q in await fetch_written(db, applicant_id, job_id)}
    if not answers:
        raise Refused("No answers to save.")
    for name, answer in answers.items():
        if name not in questions:
            raise Refused(
                f"The application has no question named {name!r}. Use the names get_next_application gave.",
                {name: ["The application has no such question."]},
            )
        if not answer.strip():
            raise Refused(f"The answer to {name!r} is empty.", {name: ["The answer is empty."]})
    facts = await _named_facts(db, job_id, named or {})
    sources, employers, samples = await _check_material(db, applicant_id, job_id)
    if by == "student":
        samples = ()
    kept: dict[str, str] = {}
    failing: dict[str, list[str]] = {}
    for name, answer in answers.items():
        q = questions[name]
        if q.kind:
            # A choice is the form's options, not words: only whether it is among them is checked.
            kept[name], found = picked(q, answer)
        else:
            kept[name], found = answer.strip(), checks.problems(answer.strip(), checks.Context(
                sources=(*sources, q.label), samples=samples, employers=employers, limit=q.max_length, question=q.label,
            ))
            if by == "claude":
                found += _review_problems(kept[name], (reviews or {}).get(name))
        if found:
            failing[name] = found
    if failing:
        raise Refused("Nothing was saved. Fix these answers and save them all again:\n" + "\n".join(
            f"- {name!r}: {' '.join(found)}" for name, found in failing.items()
        ), failing)
    await save_written(db, applicant_id, job_id, kept, facts, {
        name: dataclasses.asdict(review) for name, review in (reviews or {}).items()
        if by == "claude" and name in kept and not questions[name].kind
    })
    await db.commit()
    return sum(1 for name, q in questions.items() if q.answer is None and name not in answers)


# The rating (1-10) the reader's review must give an answer before it is
# saved, as in Apply: what a judge gives a standout answer.
GOOD = 8


@dataclasses.dataclass(frozen=True)
class Review:
    """The passes the student's Claude ran on one written answer (the
    prompt's steps 2-4): the reader's review's last rating, 1-10, and the
    claims the claim check listed, each quoted from the draft, which the
    edit cut (empty when it found none)."""
    rating: int
    unsupported: list[str]


def _review_problems(answer: str, review: Review | None) -> list[str]:
    """What keeps an answer of Claude's from saving on its review: none
    given, a rating under GOOD, or a claim the check cut still in it. A
    model-free server can't redo the passes; this makes skipping one, or
    saving what they found weak, a refusal rather than silence."""
    if review is None:
        return [("It has no review: give the rating your last review round gave it and the claims "
                 "the claim check listed (an empty list when it found none).")]
    if review.rating < GOOD:
        return [(f"Its review rated it {review.rating} of 10, under {GOOD}: review and rewrite it again, or "
                 "leave the question out and tell the student what it needs.")]
    text = " ".join(answer.casefold().split())
    left = [claim for claim in review.unsupported if (c := " ".join(claim.casefold().split())) and c in text]
    return [f"A claim the check listed is still in it: {claim!r}. Cut it, or say only what the sources support."
            for claim in left]


async def _named_facts(db: AsyncSession, job_id: uuid.UUID, named: dict[str, str]) -> dict[str, NamedFact]:
    """Each named fact as the company's brief has it, by question name,
    matched with case, punctuation and spacing folded. Refused for one that
    is not among the brief's facts."""
    if not named:
        return {}
    company, _, _ = await fetch_posting_text(db, job_id)
    brief = {briefs._plain(f["fact"]): f for f in await briefs.brief_for(db, company)}
    found: dict[str, NamedFact] = {}
    for name, fact in named.items():
        match = brief.get(briefs._plain(fact))
        if match is None:
            raise Refused(
                f"The named_fact for {name!r} is not one of the company_brief's facts. Copy one from "
                "company_brief as get_next_application gave it, or leave named_fact out.",
                {name: ["The named fact is not one of the company brief's facts."]},
            )
        found[name] = NamedFact(fact=match["fact"], url=match["url"])
    return found


async def _check_material(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...]]:
    """What an application's answers are checked against (checks.Context):
    the texts their facts may come from (the student's bank, the posting,
    the company's kept brief, whose facts were checked on their pages), the
    companies of the student's other applications that this posting and the
    places the student worked or studied don't name, and the student's
    writing samples. A company named only in a skill or a bullet is still
    another application's: a tool called "Notion" is no reason to name
    Notion the employer on another company's form."""
    company, title, posting = await fetch_posting_text(db, job_id)
    bank = await load_bank(db, applicant_id)
    sources = (*bank_sources(bank), company or "", title or "", posting or "")
    theirs = (*places(bank), company or "", title or "", posting or "")
    employers = tuple(
        name for name in await fetch_application_companies(db, applicant_id)
        if name.strip().casefold() != (company or "").strip().casefold()
        and not any(checks.names(source, name) for source in theirs)
    )
    # The brief only widens the number check: a name in it doesn't exempt another employer.
    sources += tuple(str(f[k]) for f in await briefs.brief_for(db, company) for k in ("fact", "published") if f.get(k))
    return sources, employers, tuple(await writing_samples(db, applicant_id))


# How a "choices" answer joins its options, as the Fill engine reads one (fit.ts).
JOIN = "; "


def picked(question: WrittenAnswer, answer: str) -> tuple[str, list[str]]:
    """A choice question's answer in the form's own wording (an option, or
    for "choices" one or more joined by JOIN, in any case or spacing), and
    what is wrong with it: empty when every part is one of its options."""
    wording = {_wording(o): o for o in question.options or ()}
    text = answer.strip()
    parts = [text] if question.kind == "choice" or _wording(text) in wording else text.split(JOIN.strip())
    parts = [p.strip() for p in parts if p.strip()]
    unknown = [p for p in parts if _wording(p) not in wording]
    if unknown or not parts:
        options = "; ".join(repr(o) for o in question.options or ())
        how = "one of" if question.kind == "choice" else f'one or more, joined by "{JOIN}", of'
        found = [f"{', '.join(repr(p) for p in unknown) or 'Nothing'} is not an option. Answer with {how} {options}."]
        return text, found
    return JOIN.join(dict.fromkeys(wording[_wording(p)] for p in parts)), []


def bank_sources(bank: Bank) -> list[str]:
    """Every fact of the student's bank as text, for the number check: each
    entry's fields, its months' years and its bullets, and the skills."""
    texts: list[str] = []
    for entry in bank.entries:
        row = entry.row
        texts += [str(v) for v in (
            row.title, row.organization, row.location, row.degree, row.field_of_study, row.gpa, row.gpa_scale,
            row.honors, row.issuer, *(row.coursework or ()),
            *(d.year for d in (row.start_month, row.end_month, row.award_date) if d),
        ) if v is not None]
        texts += [b.text for b in entry.bullets]
    texts += [s.name for s in bank.skills]
    return texts


def places(bank: Bank) -> list[str]:
    """Where the student worked or studied: each entry's organization, and an
    education entry's title (its school)."""
    return [
        name for entry in bank.entries
        for name in (entry.row.organization, entry.row.title if entry.row.section == "education" else None) if name
    ]


async def writing_samples(db: AsyncSession, applicant_id: uuid.UUID) -> list[str]:
    """The student's own writing samples (KAN-384), which the copying check
    reads: their text, oldest first, empty when they gave none."""
    return list(await writing.sample_texts(db, applicant_id))


async def answer_bank(db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID) -> dict[str, SavedAnswer]:
    """
    The answers the student has saved on other applications that may be
    offered on this one's form, by question wording: for each wording the
    student's own (KAN-379), else the newest. A wording counts once in any
    case or spacing, as the Fill engine matches it. An answer about one
    company (checks.company_specific) is offered only on that company's
    forms, never on another's (KAN-380), and one of their Claude's only if
    it passes this application's checks (checks.py: its posting's numbers,
    the student's other applications' companies; not the copy check, which
    its save ran, so a sample the student pasted is offered); the form's own length
    limit is the Fill engine's to check, on the page. The extension gives it to the
    engine's Plan as its Answer bank (`own`: the student's words), so a
    question answered before is filled without the student's Claude.
    Raises NotFound with no application for the job.
    """
    if await fetch_stage(db, applicant_id, job_id) is None:
        raise NotFound("No application for that job.")
    company, _, _ = await fetch_posting_text(db, job_id)
    same = (company or "").strip().casefold()
    sources, employers, _ = await _check_material(db, applicant_id, job_id)
    bank: dict[str, SavedAnswer] = {}
    seen: set[str] = set()
    written = await fetch_saved_answers(db, applicant_id, exclude=job_id)
    # Their own words on applications first, then the answers they brought
    # (`fill_answers`, all their own), then their Claude's.
    saved_answers = [
        *(s for s in written if s.own), *await fetch_brought_answers(db, applicant_id), *(s for s in written if not s.own),
    ]
    for saved in saved_answers:
        theirs = (saved.company or "").strip().casefold()
        said = "; ".join(saved.answer) if isinstance(saved.answer, list) else saved.answer
        if checks.company_specific(saved.question, said, saved.company) and not (same and theirs == same):
            continue
        if not saved.own and not saved.choice and checks.problems(saved.answer, checks.Context(
            sources=(*sources, saved.question), employers=employers, question=saved.question,
        )):
            continue
        if (wording := _wording(saved.question)) not in seen:
            seen.add(wording)
            bank[saved.question] = SavedAnswer(answer=saved.answer, own=saved.own)
    return bank


def _wording(question: str) -> str:
    """A question's wording as the Fill engine's Answer bank matches it
    (fit.ts, `norm`): case, spacing, curly quotes and a required field's
    asterisk don't count."""
    text = question.lower().replace("\u2019", "'").replace("\u201c", '"').replace("\u201d", '"')
    return " ".join(text.split()).strip(" *")


async def save_own_answer(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, own: OwnAnswer
) -> None:
    """
    The student's words for a written question in a batch tab (KAN-379).
    Their own (`own.own`: written into a field WorkIt didn't fill, or
    replacing what it filled) replace the application's answer unchecked,
    so their Claude is not asked for it and its later save never replaces
    it, and answer_bank offers it first on later forms, even on a form
    that bans AI text. An edit of an answer WorkIt filled (their Claude's,
    or a saved one) stays that answer's: checked as their Claude's save is
    (checks.py, the form's limit among them) and kept as not their own.
    Raises NotFound with no application, Refused for an empty answer or a
    failing edit (with its reasons).
    """
    if await fetch_stage(db, applicant_id, job_id) is None:
        raise NotFound("No application for that job.")
    answer = own.answer.strip()
    if not answer:
        raise Refused("The answer is empty.")
    asked = {q.name: q for q in await fetch_written(db, applicant_id, job_id)}.get(own.name)
    # A choice the student picked on the form is the form's own option: nothing to check.
    if not own.own and not (asked and asked.kind):
        sources, employers, samples = await _check_material(db, applicant_id, job_id)
        found = checks.problems(answer, checks.Context(
            sources=(*sources, own.label), samples=samples, employers=employers, question=own.label,
            limit=asked.max_length if asked else None,
        ))
        if found:
            raise Refused(f"Not saved: {' '.join(found)}", {own.name: found})
    await save_own_written(db, applicant_id, job_id, own.name, own.label.strip(), answer, own.own)
    await db.commit()


async def read_first(db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, names: Iterable[str]) -> list[str]:
    """Which of `names`, an application's saved written answers, the student
    reads before pressing Submit (`checks.high_stakes`: about this company,
    or about what isn't on their resume). Apply holds such an essay for its
    student; WorkIt never submits, so it saves and fills it, and its Claude
    names it to the student. A choice is never one."""
    company, _, _ = await fetch_posting_text(db, job_id)
    asked = set(names)
    return [q.name for q in await fetch_written(db, applicant_id, job_id)
            if q.name in asked and q.answer and not q.kind and checks.high_stakes(q.label, company)]

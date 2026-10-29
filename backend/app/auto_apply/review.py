"""
Layer 2: the pre-submit review of an application's written answers
(KAN-369). Once all of an application's written questions are answered,
the connector offers them to the student's Claude for a re-read
(get_review_task); the answers it reports wrong (save_review) are kept as
the application's one review, and its batch tab shows each as needing the
student, with the reason, before they press Submit.

The review is a snapshot (job_applications.answer_review): the answers it
read and the reasons it gave. "Read" means as handed out: each answer
goes out with its version (answer_version), and an answer whose text
changed before save_review came back is left out of the snapshot. A flag holds only while its answer is still
the one read, so an edit or a new save clears it, and an application with
an answer not the student's own that the review didn't read is offered
again. The student's own words are given to the review but never make it
due: the student wrote them.

The tab's flag card (KAN-369) answers a flag in one of three ways. Keep
(keep) records the answer as the student's choice (`kept`), so no later
review flags that same text again. Rewrite with Claude (rewrite) clears the
answer for the student's Claude to write again, and keeps the flag (`rewrite`)
for get_next_application to hand over with the question. Edit myself needs
nothing here: the edited answer is no longer the one read.
"""

import dataclasses
import hashlib
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.auto_apply.queries import (
    drop_written,
    fetch_next_to_review,
    fetch_review,
    fetch_stage,
    set_answer_review,
)
from app.auto_apply.stages import NotFound, get_application, open_application
from app.auto_apply.written import Refused
from app.schemas.applications import Application, WrittenAnswer
from app.services.bank import Bank, load_bank


def answer_version(answer: str) -> str:
    """An answer's version: a hash of its text, which get_review_task hands
    out with it and save_review takes back, so a review keeps only the
    answers it read as they still stand."""
    return hashlib.sha256(answer.encode()).hexdigest()[:16]


@dataclasses.dataclass(frozen=True)
class Flag:
    """What the review found wrong with one answer: the reason, the sentence
    it means (word for word from the answer, or None), and whether it names
    the wrong company (a hard flag)."""

    reason: str
    quote: str | None = None
    hard: bool = False


def _marked(review: dict | None, rows: list[tuple[WrittenAnswer, bool]]) -> list[tuple[WrittenAnswer, bool]]:
    """Each row with whether the review read its answer (always, for the
    student's own words) and its flag while that answer is the one read
    and the student hasn't kept it."""
    review = review or {}
    read, flags, kept = review.get("answers", {}), review.get("flags", {}), review.get("kept", {})
    marked = []
    for answer, own in rows:
        same = answer.answer is not None and read.get(answer.name) == answer.answer
        flag = flags.get(answer.name) if same and kept.get(answer.name) != answer.answer else None
        marked.append((answer.model_copy(update={
            "reviewed": answer.answer is not None and (own or same),
            "flag": flag,
            "flag_quote": review.get("quotes", {}).get(answer.name) if flag else None,
            "flag_hard": bool(flag) and answer.name in review.get("hard", []),
        }), own))
    return marked


async def reviewed_answers(db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID) -> list[WrittenAnswer]:
    """GET .../questions: the application's questions that need writing,
    their answers, and what the review found. NotFound with no application."""
    if await fetch_stage(db, applicant_id, job_id) is None:
        raise NotFound("No application for that job.")
    review, rows = await fetch_review(db, applicant_id, job_id)
    return [answer for answer, _ in _marked(review, rows)]


@dataclasses.dataclass(frozen=True)
class ToReview:
    """One application's answers for the student's Claude to re-read, with
    what they may draw on: the job posting and the student's bank."""

    application: Application
    posting: str | None
    answers: list[tuple[WrittenAnswer, bool]]
    bank: Bank


async def next_to_review(db: AsyncSession, applicant_id: uuid.UUID) -> ToReview | None:
    """The oldest open application whose answers are all in and not yet
    reviewed as they stand; None when none is."""
    found = await fetch_next_to_review(db, applicant_id)
    if found is None:
        return None
    job_id, posting = found
    _, rows = await fetch_review(db, applicant_id, job_id)
    return ToReview(
        application=await get_application(db, applicant_id, job_id),
        posting=posting,
        answers=rows,
        bank=await load_bank(db, applicant_id),
    )


async def save_review(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, problems: dict[str, Flag],
    versions: dict[str, str],
) -> tuple[int, list[str]]:
    """Keeps the review of the answers it read: `versions` holds each
    answer's version as get_review_task handed it out, and `problems` names
    each answer found wrong, with the reason. An answer whose text has
    changed since (or that wasn't read) is left out, flag and all, so it
    stays due. Replaces any earlier review. Answers how many answers it
    flagged and the names left out as changed. An answer the student kept
    as it stands is never flagged again. Raises NotFound / WrongStage
    for an application that isn't open, Refused for a name that isn't one
    of its answered questions, an empty reason, or a quote not in the answer."""
    await open_application(db, applicant_id, job_id)
    earlier, rows = await fetch_review(db, applicant_id, job_id)
    answers = {a.name: a.answer for a, _ in rows if a.answer is not None}
    for name, flag in problems.items():
        if name not in answers:
            raise Refused(f"The application has no answered question named {name!r}. Use the names get_review_task gave.")
        if not flag.reason.strip():
            raise Refused(f"Say why the answer to {name!r} is wrong.")
        if flag.quote is not None and flag.quote.strip() not in answers[name]:
            raise Refused(f"The quote for {name!r} isn't in its answer. Quote the sentence word for word, or leave it out.")
    read = {name: text for name, text in answers.items() if versions.get(name) == answer_version(text)}
    changed = [name for name in answers if name in versions and name not in read]
    kept = {name: text for name, text in (earlier or {}).get("kept", {}).items() if answers.get(name) == text}
    flags = {name: flag for name, flag in problems.items() if name in read and kept.get(name) != read[name]}
    await set_answer_review(db, applicant_id, job_id, {
        "answers": read,
        "flags": {name: flag.reason.strip() for name, flag in flags.items()},
        "quotes": {name: flag.quote.strip() for name, flag in flags.items() if flag.quote and flag.quote.strip()},
        "hard": [name for name, flag in flags.items() if flag.hard],
        "kept": kept,
    })
    await db.commit()
    return len(flags), changed


async def _flagged(db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, name: str) -> tuple[dict, WrittenAnswer, bool]:
    """The application's review and the row of its answer `name`, which the
    review flagged (and whether it is the student's own). The flag still
    counts after the student's edit: the tab keeps it while the flagged
    sentence is in the field. Raises NotFound / WrongStage for an
    application that isn't open, Refused when the review didn't flag that
    question or it has no answer."""
    await open_application(db, applicant_id, job_id)
    review, rows = await fetch_review(db, applicant_id, job_id)
    reason = (review or {}).get("flags", {}).get(name)
    for answer, own in rows:
        if answer.name == name and answer.answer is not None and reason:
            return review, answer.model_copy(update={"flag": reason, "flag_quote": review.get("quotes", {}).get(name)}), own
    raise Refused("That answer isn't flagged.")


async def keep(db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, name: str) -> None:
    """The student keeps a flagged answer as it stands (the tab's Keep): its
    flag clears, and no later review flags that text again."""
    review, answer, _ = await _flagged(db, applicant_id, job_id, name)
    await set_answer_review(db, applicant_id, job_id, {**review, "kept": {**review.get("kept", {}), name: answer.answer}})
    await db.commit()


async def rewrite(db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, name: str) -> None:
    """The student sends a flagged answer back to their Claude (the tab's
    Rewrite with Claude): the answer is cleared, so get_next_application
    hands the question out again, with the flag (`rewrite`). Refused for
    the student's own words, which are theirs to change."""
    review, answer, own = await _flagged(db, applicant_id, job_id, name)
    if own:
        raise Refused("That answer is your own words. Edit it in the form.")
    sent = {"reason": answer.flag, "quote": answer.flag_quote, "answer": answer.answer}
    await set_answer_review(db, applicant_id, job_id, {**review, "rewrite": {**review.get("rewrite", {}), name: sent}})
    await drop_written(db, applicant_id, job_id, [name])
    await db.commit()


async def redo(db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, name: str, steer: str | None) -> None:
    """The student asks their Claude for another version of an answer it
    wrote, flagged or not (the batch tab's Rewrite, KAN-424), with how to
    change it (`steer`), if they said. As rewrite: the answer is cleared, so
    get_next_application hands the question out again with the request as
    its `rewrite`. Refused for the student's own words, and for a question
    with no answer yet."""
    await open_application(db, applicant_id, job_id)
    review, rows = await fetch_review(db, applicant_id, job_id)
    for answer, own in rows:
        if answer.name != name or answer.answer is None:
            continue
        if own:
            raise Refused("That answer is your own words. Edit it in the form.")
        ask = steer.strip() if steer else ""
        reason = f"The student asked for another version: {ask}" if ask else "The student asked for another version."
        sent = {"reason": reason, "quote": None, "answer": answer.answer}
        review = review or {}
        await set_answer_review(db, applicant_id, job_id, {**review, "rewrite": {**review.get("rewrite", {}), name: sent}})
        await drop_written(db, applicant_id, job_id, [name])
        await db.commit()
        return
    raise Refused("That question has no answer to rewrite.")


async def rewrites(db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID) -> dict[str, dict]:
    """The answers the student sent back to their Claude, by question name:
    the flag's reason, its quote and the answer it was about."""
    review, _ = await fetch_review(db, applicant_id, job_id)
    return (review or {}).get("rewrite", {})

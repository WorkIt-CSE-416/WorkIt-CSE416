"""
Layer 2: the pre-submit review of an application's written answers
(KAN-369). Once all of an application's written questions are answered,
the connector offers them to the student's Claude for a re-read
(get_review_task); the answers it reports wrong (save_review) are kept as
the application's one review, and its batch tab shows each as needing the
student, with the reason, before they press Submit.

The review is a snapshot (job_applications.answer_review): the answers it
read and the reasons it gave. A flag holds only while its answer is still
the one read, so an edit or a new save clears it, and an application with
an answer not the student's own that the review didn't read is offered
again. The student's own words are given to the review but never make it
due: the student wrote them.
"""

import dataclasses
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.auto_apply.queries import (
    fetch_next_to_review,
    fetch_review,
    fetch_stage,
    set_answer_review,
)
from app.auto_apply.stages import NotFound, get_application, open_application
from app.auto_apply.written import Refused
from app.schemas.applications import Application, WrittenAnswer
from app.services.bank import Bank, load_bank


def _marked(review: dict | None, rows: list[tuple[WrittenAnswer, bool]]) -> list[tuple[WrittenAnswer, bool]]:
    """Each row with whether the review read its answer (always, for the
    student's own words) and its flag while that answer is the one read."""
    read = (review or {}).get("answers", {})
    flags = (review or {}).get("flags", {})
    marked = []
    for answer, own in rows:
        same = answer.answer is not None and read.get(answer.name) == answer.answer
        marked.append((answer.model_copy(update={
            "reviewed": answer.answer is not None and (own or same),
            "flag": flags.get(answer.name) if same else None,
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
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, problems: dict[str, str]
) -> int:
    """Keeps the review of the application's answers as they stand now:
    `problems` names each answer found wrong, with the reason. Replaces any
    earlier review. Answers how many answers it flagged. Raises NotFound /
    WrongStage for an application that isn't open, Refused for a name that
    isn't one of its answered questions or an empty reason."""
    await open_application(db, applicant_id, job_id)
    _, rows = await fetch_review(db, applicant_id, job_id)
    answers = {a.name: a.answer for a, _ in rows if a.answer is not None}
    for name, reason in problems.items():
        if name not in answers:
            raise Refused(f"The application has no answered question named {name!r}. Use the names get_review_task gave.")
        if not reason.strip():
            raise Refused(f"Say why the answer to {name!r} is wrong.")
    await set_answer_review(db, applicant_id, job_id, {
        "answers": answers, "flags": {name: reason.strip() for name, reason in problems.items()},
    })
    await db.commit()
    return len(problems)

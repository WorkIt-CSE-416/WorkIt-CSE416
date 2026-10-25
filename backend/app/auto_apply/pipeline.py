"""
Layer 2: the auto apply steps a caller can ask for, each calling layer-1
functions in order (auto-apply/architecture.md, "The function layers").
Each is safe to call alone: it checks the stage it needs and owns its
transaction. None checks ownership: the layer-3 route that calls it does.
"""

import dataclasses
import logging
import sys
import uuid
from collections.abc import Sequence
from typing import Any, Literal

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auto_apply.queries import (
    ResumeChoice,
    chosen_resume,
    fetch_application,
    fetch_applications,
    fetch_next_application,
    fetch_next_to_write,
    fetch_stage,
    fetch_written,
    link_resume,
    pick_resume,
    put_questions,
    queue_applications,
    remove_queued,
    save_written,
    set_stage,
)
from app.auto_apply.rules import pick_batch
from app.models.dto import application_stage
from app.queries.jobs.filters import JobFilters
from app.routers.jobs import EmptyBank, fetch_recommended
from app.schemas.applications import (
    ANSWER_MAX,
    Application,
    WrittenAnswer,
    WrittenQuestion,
)
from app.schemas.auth import AuthenticatedAccount
from app.schemas.jobs import ScoredJob
from app.schemas.sent_resume import SentResumeDownload, SentResumeResponse
from app.services import sent_resumes
from app.services.bank import Bank, load_bank
from app.services.bank import NotFound as ResumeNotFound
from app.services.resume_render import TectonicUnavailable

logger = logging.getLogger(__name__)

# The lowest score auto apply takes ("Match (built)"). It moves with the
# matching weights: retune it when they change.
MIN_MATCH = 60
# One click of Start Auto Apply ("The batch", why 10).
BATCH_SIZE = 10

# What each way a fill can end moves the application to ("The run").
OUTCOME_STAGE = {
    "submitted": application_stage.applied,
    "skipped": application_stage.skipped,
    "failed": application_stage.needs_you,
}
# The stages a fill can end from: queued, or needs_you when the student
# finishes a failed form by hand.
FINISHABLE = (application_stage.queued, application_stage.needs_you)
# Batch apply (KAN-370): how a tab's fill left the form, on the stage. A
# ready tab waits for the student's submit, so it stays queued (the batch
# skips the jobs it has open); a tab with anything unfilled needs them.
FILL_STAGE = {
    "ready": application_stage.queued,
    "needs_you": application_stage.needs_you,
}


class NotFound(Exception):
    """No such job posting open, or no application for it. The route answers 404."""


class WrongStage(Exception):
    """The application is not in the stage this step needs. The message names
    the step to call first. The route answers 409."""


class FileFailed(Exception):
    """Storage refused the resume's file or its link. Nothing was kept. The
    route answers 502."""


async def _matches(
    db: AsyncSession,
    account: AuthenticatedAccount,
    filters: JobFilters,
    min_match: int,
    size: int,
) -> list[ScoredJob]:
    """get_matches and start_batch's shared reading of the matches."""
    scored = await fetch_recommended(
        db,
        account,
        # Every job with an application at any stage stays out, so a batch
        # never queues a job twice, nor one the student skipped, nor one they
        # only saved (KAN-261: a save never queues by itself); and only
        # job postings the extension can fill come in (hosts.py).
        filters=dataclasses.replace(
            filters, no_application_by=account.id, auto_apply_only=True
        ),
        min_match=min_match,
        # Every match, not a page: pick_batch drops repeats before it takes
        # `size`, and fetch_recommended scores every job whatever the limit.
        limit=sys.maxsize,
    )
    return pick_batch(scored, size)


async def get_matches(
    db: AsyncSession,
    account: AuthenticatedAccount,
    *,
    filters: JobFilters = JobFilters(),
    min_match: int = MIN_MATCH,
    size: int = BATCH_SIZE,
) -> list[ScoredJob]:
    """
    The applicant's best `size` matches, best first, each a ScoredJob: the
    Jobs page's own listing (title, company, logo, apply_url...) plus `match`
    and `highlights`. Reads only; start_batch queues them.

    Only job postings on a hiring system auto apply fills (Greenhouse for
    now, app/auto_apply/hosts.py). Leaves out every job posting the
    applicant has an application for (queued, skipped, needs_you or applied)
    and repeats of one company and title (pick_batch). Raises EmptyBank (routers/jobs.py) when the applicant's
    experience bank is empty.
    """
    return await _matches(db, account, filters, min_match, size)


async def start_batch(
    db: AsyncSession,
    account: AuthenticatedAccount,
    *,
    filters: JobFilters = JobFilters(),
    min_match: int = MIN_MATCH,
    size: int = BATCH_SIZE,
) -> list[str]:
    """
    Start Auto Apply: queues the applicant's best `size` matches (as
    get_matches reads them) in one commit, and answers their job ids, best
    first. Fewer when fewer matches are left. Raises EmptyBank.
    """
    matches = await _matches(db, account, filters, min_match, size)
    queued = await queue_applications(db, account.id, [uuid.UUID(m.id) for m in matches])
    await db.commit()
    return [m.id for m in matches if uuid.UUID(m.id) in queued]


async def queue_job(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> application_stage:
    """
    A job's Auto Apply button: queues this one job posting, and answers its
    stage. A saved job is queued: the click is the student's own. A job that
    already has an application at
    any other stage keeps it, and answers that
    stage: a second click changes nothing. Raises NotFound for a job posting
    that isn't open, or isn't on a hiring system auto apply fills
    (queue_applications saves neither).
    """
    if await queue_applications(db, applicant_id, [job_id]):
        await db.commit()
        return application_stage.queued
    stage = await fetch_stage(db, applicant_id, job_id)
    if stage is None:
        raise NotFound("That job isn't open, or Auto Apply can't fill its hiring system yet.")
    return stage


async def dequeue_job(db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID) -> None:
    """
    Takes a queued job posting out of the queue: its application goes, and
    the job is as it was before it was queued (no stage; the next batch may
    pick it again). Raises NotFound when there is no application, WrongStage
    when it is past queued: a needs_you, skipped or applied one is a record
    of what happened, not a plan.
    """
    if await remove_queued(db, applicant_id, job_id):
        await db.commit()
        return
    stage = await fetch_stage(db, applicant_id, job_id)
    if stage is None:
        raise NotFound("That job isn't in your queue.")
    raise WrongStage(f"That application is {stage}, so it is no longer in the queue.")


async def list_applications(
    db: AsyncSession,
    applicant_id: uuid.UUID,
    stages: Sequence[application_stage] = (),
    *,
    score_for: AuthenticatedAccount | None = None,
) -> list[Application]:
    """
    The applicant's applications in `stages` (all when empty), newest
    first: the Auto Apply page's Live Activity and the Applications page.

    With `score_for` (the applicant's own account), each open job posting
    gets the Jobs page's `match` and its `highlights`, from the same scoring (fetch_recommended),
    so a card's score never differs from the feed's (KAN-256). A closed job
    posting has none, and none has one while the experience bank is empty.
    Only on request: it can embed the bank, which the queue's reads never
    need.
    """
    applications = await fetch_applications(db, applicant_id, stages)
    open_ids = [uuid.UUID(a.job.id) for a in applications if a.open]
    if score_for is None or not open_ids:
        return applications
    try:
        scored = await fetch_recommended(
            db, score_for, filters=JobFilters(job_ids=open_ids), limit=sys.maxsize
        )
    except EmptyBank:
        return applications
    by_id = {job.id: job for job in scored}
    return [
        a.model_copy(update={"match": job.match, "highlights": job.highlights})
        if (job := by_id.get(a.job.id))
        else a
        for a in applications
    ]


async def get_application(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> Application:
    """The applicant's application for one job posting: its listing, stage
    and dates. Raises NotFound when they have none."""
    application = await fetch_application(db, applicant_id, job_id)
    if application is None:
        raise NotFound("No application for that job.")
    return application


async def next_application(
    db: AsyncSession, applicant_id: uuid.UUID, skip: Sequence[uuid.UUID] = ()
) -> Application | None:
    """What the extension fills next: the oldest queued application whose job
    posting is open and isn't in `skip` (the jobs batch apply already has in
    its tabs). None when the queue is empty, and the run goes idle."""
    return await fetch_next_application(db, applicant_id, skip)


async def record_fill(
    db: AsyncSession,
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    state: Literal["ready", "needs_you"],
) -> application_stage:
    """
    Records how a batch tab's fill left the form (FILL_STAGE) and answers the
    new stage: needs_you while anything is unfilled, back to queued once the
    student has answered it. Only a queued or needs_you application takes
    one: raises NotFound when there is none, WrongStage when it is skipped or
    applied already.
    """
    stage = await fetch_stage(db, applicant_id, job_id)
    if stage is None:
        raise NotFound("No application for that job. Queue it first.")
    if stage not in FINISHABLE:
        raise WrongStage(f"That application is {stage}, so its form is no longer open.")
    new = FILL_STAGE[state]
    await set_stage(db, applicant_id, job_id, new)
    await db.commit()
    return new


async def _open_application(db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID) -> None:
    """Raises NotFound with no application, WrongStage once it is past
    the form (skipped or applied)."""
    stage = await fetch_stage(db, applicant_id, job_id)
    if stage is None:
        raise NotFound("No application for that job. Queue it first.")
    if stage not in FINISHABLE:
        raise WrongStage(f"That application is {stage}, so its form is no longer open.")


async def ask_questions(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, questions: Sequence[WrittenQuestion]
) -> list[WrittenAnswer]:
    """
    Keeps the questions a batch tab's form needs written (KAN-377), for the
    student's Claude to answer through the connector, and answers every
    question the application has, with the answers saved so far. Only a
    queued or needs_you application: NotFound / WrongStage otherwise.
    """
    await _open_application(db, applicant_id, job_id)
    await put_questions(db, applicant_id, job_id, questions)
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


class Refused(Exception):
    """A save the connector refuses whole, with the reason for the student's
    Claude to fix it by. Nothing was saved."""


@dataclasses.dataclass(frozen=True)
class ToWrite:
    """One application's material for the student's Claude (KAN-377): only
    that application's job posting and questions, and the student's bank."""

    application: Application
    posting: str | None
    questions: list[WrittenAnswer]
    bank: Bank


async def next_to_write(db: AsyncSession, applicant_id: uuid.UUID) -> ToWrite | None:
    """The connector's next application: the oldest open one with a
    question still unanswered, its unanswered questions in the form's
    order. None when nothing is left to write."""
    found = await fetch_next_to_write(db, applicant_id)
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
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, answers: dict[str, str]
) -> int:
    """
    Saves the student's Claude's answers to one application's questions
    (KAN-377), all or none, and answers how many of its questions are
    still unanswered. Each name must be one of the application's questions,
    and each answer must fit the form's own limit. Raises NotFound /
    WrongStage for an application that isn't open, Refused otherwise.
    """
    await _open_application(db, applicant_id, job_id)
    questions = {q.name: q for q in await fetch_written(db, applicant_id, job_id)}
    if not answers:
        raise Refused("No answers to save.")
    for name, answer in answers.items():
        question = questions.get(name)
        if question is None:
            raise Refused(f"The application has no question named {name!r}. Use the names get_next_application gave.")
        limit = question.max_length or ANSWER_MAX
        if not answer.strip():
            raise Refused(f"The answer to {name!r} is empty.")
        if len(answer) > limit:
            raise Refused(f"The answer to {name!r} is {len(answer)} characters; the form takes at most {limit}.")
    await save_written(db, applicant_id, job_id, {name: answer.strip() for name, answer in answers.items()})
    await db.commit()
    return sum(1 for name, q in questions.items() if q.answer is None and name not in answers)


async def finish_application(
    db: AsyncSession,
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    outcome: Literal["submitted", "skipped", "failed"],
) -> application_stage:
    """
    Records how a fill ended (OUTCOME_STAGE) and answers the new stage.
    Only a queued or needs_you application can finish: raises NotFound when
    there is none, WrongStage when it is skipped or applied already.
    """
    stage = await fetch_stage(db, applicant_id, job_id)
    if stage is None:
        raise NotFound("No application for that job. Queue it first.")
    if stage not in FINISHABLE:
        raise WrongStage(
            f"That application is {stage}, so it can't be finished. Queue a new job instead."
        )
    new = OUTCOME_STAGE[outcome]
    await set_stage(db, applicant_id, job_id, new)
    await db.commit()
    return new


async def choose_resume(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, choice: ResumeChoice
) -> SentResumeResponse:
    """
    The student picks the resume one queued application goes out with (the
    Auto Apply page's Up Next, KAN-359), in place of pick_resume's rule. It
    is kept as Apply keeps a pick: a sent resume from that resume, linked to
    the job posting and named by the application (`link_resume`), so the
    pick is stored where the run already reads what an application sends,
    with no column of its own (architecture.md rejected a
    `job_applications.resume_id` for repeating it). prepare_resume reads it
    back (chosen_resume) and sends that resume again, so an edit made since
    goes out. A repeat with unchanged content returns the same sent resume.

    Only a queued or needs_you application takes one: raises NotFound when
    there is none, or the resume is not the applicant's or the job posting
    closed, WrongStage when it is skipped or applied. A built resume's send
    renders its PDF, so TectonicUnavailable comes up when that fails.
    """
    stage = await fetch_stage(db, applicant_id, job_id)
    if stage is None:
        raise NotFound("No application for that job. Queue it first.")
    if stage not in FINISHABLE:
        raise WrongStage(f"That application is {stage}, so its resume is already decided.")
    try:
        if choice.built_resume_id is not None:
            sent = await sent_resumes.send_built(
                db, applicant_id, choice.built_resume_id, job_posting_id=job_id
            )
        else:
            sent = await sent_resumes.send_uploaded(
                db, applicant_id, choice.uploaded_resume_id, job_posting_id=job_id
            )
    except ResumeNotFound as exc:
        raise NotFound("That resume or job isn't available any more.") from exc
    await link_resume(db, applicant_id, job_id, sent.row.id)
    try:
        await db.commit()
    except SQLAlchemyError:
        await db.rollback()
        raise
    return SentResumeResponse.from_row(sent.row)


async def prepare_resume(
    db: AsyncSession, storage: Any, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> SentResumeDownload | None:
    """
    The resume one application sends, ready to attach: the student's own
    choice for it (choose_resume, read back by chosen_resume), else
    pick_resume's (the resume tailored to the job posting, else the default),
    kept as a sent
    resume linked to the job posting, as Apply keeps one, with its file: the
    PDF itself (`data`) for a built resume, kept as a snapshot (KAN-267), or
    a 5-minute link (`url`) for an uploaded one. None when the student has no such resume:
    the form is filled without one. Never tailors.

    Only a queued or needs_you application gets one: raises NotFound when
    there is none or its job posting closed, WrongStage when it is skipped or
    applied. A repeat with unchanged content returns the same sent resume, so
    a run that starts again keeps nothing new. The application names the
    sent resume (`link_resume`, KAN-267). Raises TectonicUnavailable
    when the PDF cannot be made, FileFailed when Storage cannot sign the link.
    """
    stage = await fetch_stage(db, applicant_id, job_id)
    if stage is None:
        raise NotFound("No application for that job. Queue it first.")
    if stage not in FINISHABLE:
        raise WrongStage(
            f"That application is {stage}, so it gets no resume. Queue a new job instead."
        )
    choice = await chosen_resume(db, applicant_id, job_id) or await pick_resume(
        db, applicant_id, job_id
    )
    if choice is None:
        return None

    try:
        if choice.built_resume_id is not None:
            sent = await sent_resumes.send_built(
                db, applicant_id, choice.built_resume_id, job_posting_id=job_id
            )
        else:
            sent = await sent_resumes.send_uploaded(
                db, applicant_id, choice.uploaded_resume_id, job_posting_id=job_id
            )
    except ResumeNotFound as exc:
        # The job posting closed (or its resume went) after the pick.
        raise NotFound("That job isn't open any more.") from exc

    # The application names what it goes out with (KAN-267), a repeat's
    # sent resume too, in the same commit. A failed commit leaves nothing to
    # clean up: a send stores no file.
    await link_resume(db, applicant_id, job_id, sent.row.id)
    try:
        await db.commit()
    except SQLAlchemyError:
        await db.rollback()
        raise

    try:
        file = await sent_resumes.open_file(db, storage, sent.row, pdf=sent.pdf)
    except TectonicUnavailable:
        raise
    except Exception as exc:
        logger.exception("Failed to sign an auto apply resume's URL")
        raise FileFailed("The resume's link could not be made. Try again.") from exc
    return SentResumeDownload.of(sent.row, file, sent.missing_characters)



"""
Layer 2: the auto apply steps a caller can ask for, each calling layer-1
functions in order (auto-apply/architecture.md, "The function layers").
Each is safe to call alone: it checks the stage it needs and owns its
transaction. None checks ownership: the layer-3 route that calls it does.
"""

import asyncio
import dataclasses
import logging
import sys
import uuid
from collections.abc import Sequence
from typing import Any, Literal

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auto_apply.queries import (
    fetch_application,
    fetch_applications,
    fetch_next_application,
    fetch_stage,
    pick_resume,
    queue_applications,
    remove_queued,
    set_stage,
)
from app.auto_apply.rules import pick_batch
from app.models.dto import application_stage
from app.queries.jobs.filters import JobFilters
from app.routers.jobs import EmptyBank, fetch_recommended
from app.schemas.applications import Application
from app.schemas.auth import AuthenticatedAccount
from app.schemas.jobs import ScoredJob
from app.schemas.sent_resume import SentResumeDownload, SentResumeResponse
from app.services import sent_resumes
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


async def next_application(db: AsyncSession, applicant_id: uuid.UUID) -> Application | None:
    """What the extension fills next: the oldest queued application whose job
    posting is open. None when the queue is empty, and the run goes idle."""
    return await fetch_next_application(db, applicant_id)


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


async def prepare_resume(
    db: AsyncSession, storage: Any, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> SentResumeDownload | None:
    """
    The resume one application sends, ready to attach: pick_resume's choice
    (the resume tailored to the job posting, else the default) kept as a sent
    resume linked to the job posting, as Apply keeps one, with a link that
    downloads it for 5 minutes. None when the student has no such resume:
    the form is filled without one. Never tailors.

    Only a queued or needs_you application gets one: raises NotFound when
    there is none or its job posting closed, WrongStage when it is skipped or
    applied. A repeat with unchanged content returns the same sent resume, so
    a run that starts again keeps nothing new. Raises TectonicUnavailable
    when the PDF cannot be made, FileFailed when Storage refuses it.
    """
    stage = await fetch_stage(db, applicant_id, job_id)
    if stage is None:
        raise NotFound("No application for that job. Queue it first.")
    if stage not in FINISHABLE:
        raise WrongStage(
            f"That application is {stage}, so it gets no resume. Queue a new job instead."
        )
    choice = await pick_resume(db, applicant_id, job_id)
    if choice is None:
        return None

    try:
        if choice.built_resume_id is not None:
            sent = await sent_resumes.send_built(
                db, storage, applicant_id, choice.built_resume_id, job_posting_id=job_id
            )
        else:
            sent = await sent_resumes.send_uploaded(
                db, applicant_id, choice.uploaded_resume_id, job_posting_id=job_id
            )
    except ResumeNotFound as exc:
        # The job posting closed (or its resume went) after the pick.
        raise NotFound("That job isn't open any more.") from exc
    except (SQLAlchemyError, TectonicUnavailable):
        raise
    except Exception as exc:
        logger.exception("Storage upload of an auto apply resume failed")
        raise FileFailed("The resume could not be saved. Try again.") from exc

    if sent.created:
        try:
            await db.commit()
        except SQLAlchemyError:
            await db.rollback()
            # An uploaded resume's file is not this row's to remove.
            if sent.row.uploaded_resume_id is None:
                await _remove_file(storage, sent.row.storage_path)
            raise

    try:
        url = await sent_resumes.file_url(storage, sent.row)
    except Exception as exc:
        logger.exception("Failed to sign an auto apply resume's URL")
        raise FileFailed("The resume's link could not be made. Try again.") from exc
    return SentResumeDownload(
        **SentResumeResponse.from_row(sent.row).model_dump(),
        url=url,
        missing_characters=list(sent.missing_characters),
    )


async def _remove_file(storage: Any, path: str) -> None:
    # After a failed commit: a failure here orphans a file but loses no record.
    try:
        await asyncio.to_thread(storage.from_(sent_resumes.BUCKET).remove, [path])
    except Exception:
        logger.exception("Failed to remove an auto apply resume file", extra={"storage_path": path})

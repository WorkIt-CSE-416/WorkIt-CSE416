"""
Layer 2: the auto apply steps a caller can ask for, each calling layer-1
functions in order (auto-apply/architecture.md, "The function layers").
Each is safe to call alone: it checks the stage it needs and owns its
transaction. None checks ownership: the layer-3 route that calls it does.
"""

import dataclasses
import sys
import uuid
from collections.abc import Sequence
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.auto_apply.queries import (
    fetch_application,
    fetch_applications,
    fetch_next_application,
    fetch_stage,
    queue_applications,
    set_stage,
)
from app.auto_apply.rules import pick_batch
from app.models.dto import application_stage
from app.queries.jobs.filters import JobFilters
from app.routers.jobs import fetch_recommended
from app.schemas.applications import Application
from app.schemas.jobs import ScoredJob

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


async def _matches(
    db: AsyncSession,
    applicant_id: uuid.UUID,
    filters: JobFilters,
    min_match: int,
    size: int,
) -> list[ScoredJob]:
    """get_matches and start_batch's shared reading of the matches."""
    scored = await fetch_recommended(
        db,
        applicant_id,
        # Every job with an application at any stage stays out, so a batch
        # never queues a job twice, nor one the student skipped.
        filters=dataclasses.replace(filters, no_application_by=applicant_id),
        min_match=min_match,
        # Every match, not a page: pick_batch drops repeats before it takes
        # `size`, and fetch_recommended scores every job whatever the limit.
        limit=sys.maxsize,
    )
    return pick_batch(scored, size)


async def get_matches(
    db: AsyncSession,
    applicant_id: uuid.UUID,
    *,
    filters: JobFilters = JobFilters(),
    min_match: int = MIN_MATCH,
    size: int = BATCH_SIZE,
) -> list[ScoredJob]:
    """
    The applicant's best `size` matches, best first, each a ScoredJob: the
    Jobs page's own listing (title, company, logo, apply_url...) plus `match`
    and `highlights`. Reads only; start_batch queues them.

    Leaves out every job posting the applicant has an application for (queued,
    skipped, needs_you or applied) and repeats of one company and title
    (pick_batch). Raises NoResume (routers/jobs.py) when the applicant has no
    parsed primary resume.
    """
    return await _matches(db, applicant_id, filters, min_match, size)


async def start_batch(
    db: AsyncSession,
    applicant_id: uuid.UUID,
    *,
    filters: JobFilters = JobFilters(),
    min_match: int = MIN_MATCH,
    size: int = BATCH_SIZE,
) -> list[str]:
    """
    Start Auto Apply: queues the applicant's best `size` matches (as
    get_matches reads them) in one commit, and answers their job ids, best
    first. Fewer when fewer matches are left. Raises NoResume.
    """
    matches = await _matches(db, applicant_id, filters, min_match, size)
    queued = await queue_applications(db, applicant_id, [uuid.UUID(m.id) for m in matches])
    await db.commit()
    return [m.id for m in matches if uuid.UUID(m.id) in queued]


async def queue_job(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> application_stage:
    """
    A job's Auto Apply button: queues this one job posting, and answers its
    stage. A job that already has an application keeps it, and answers that
    stage: a second click changes nothing. Raises NotFound for a job posting
    that isn't open.
    """
    if await queue_applications(db, applicant_id, [job_id]):
        await db.commit()
        return application_stage.queued
    stage = await fetch_stage(db, applicant_id, job_id)
    if stage is None:
        raise NotFound("That job isn't open any more.")
    return stage


async def list_applications(
    db: AsyncSession,
    applicant_id: uuid.UUID,
    stages: Sequence[application_stage] = (),
) -> list[Application]:
    """The applicant's applications in `stages` (all when empty), newest
    first: the Auto Apply page's Live Activity."""
    return await fetch_applications(db, applicant_id, stages)


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

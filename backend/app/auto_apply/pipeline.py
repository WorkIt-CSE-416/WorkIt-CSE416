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

from app.auto_apply.hosts import refusal
from app.auto_apply.plans import (  # noqa: F401 (re-exported for the connector)
    Backed,
    Plan,
)
from app.auto_apply.queries import (
    fetch_applications,
    fetch_next_application,
    fetch_open_apply_url,
    fetch_stage,
    queue_applications,
    remove_queued,
    set_stage,
)
from app.auto_apply.resume import (  # noqa: F401 (re-exported: callers name these steps as pipeline's)
    FileFailed,
    choose_resume,
    prepare_resume,
)
from app.auto_apply.review import (  # noqa: F401 (re-exported: callers name these steps as pipeline's)
    Flag,
    ToReview,
    answer_version,
    keep,
    next_to_review,
    reviewed_answers,
    rewrite,
    rewrites,
    save_review,
)
from app.auto_apply.rules import pick_batch
from app.auto_apply.stages import (  # noqa: F401 (get_application re-exported)
    FINISHABLE,
    NotFound,
    WrongStage,
    get_application,
)
from app.auto_apply.written import (  # noqa: F401 (re-exported: callers name these steps as pipeline's)
    Refused,
    ToWrite,
    answer_bank,
    answer_fact,
    answered_questions,
    ask_fact,
    ask_questions,
    drop_own_answer,
    led_before,
    next_to_write,
    read_first,
    save_answers,
    save_own_answer,
    unanswered_questions,
    writing_samples,
    written_answers,
)
from app.models.dto import application_stage
from app.queries.jobs.filters import JobFilters
from app.routers.jobs import EmptyBank, fetch_recommended
from app.schemas.applications import Application
from app.schemas.auth import AuthenticatedAccount
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
# Batch apply (KAN-370): how a tab's fill left the form, on the stage. A
# ready tab waits for the student's submit, so it stays queued (the batch
# skips the jobs it has open); a tab with anything unfilled needs them.
FILL_STAGE = {
    "ready": application_stage.queued,
    "needs_you": application_stage.needs_you,
}


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
    (queue_applications saves neither), with the reason: a job board's
    posting that names no employer form (KAN-376) says so.
    """
    if await queue_applications(db, applicant_id, [job_id]):
        await db.commit()
        return application_stage.queued
    stage = await fetch_stage(db, applicant_id, job_id)
    if stage is None:
        apply_url = await fetch_open_apply_url(db, job_id)
        raise NotFound(refusal(apply_url) if apply_url else "That job isn't open any more.")
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

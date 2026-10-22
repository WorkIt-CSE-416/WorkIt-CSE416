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
    approve_review,
    claim_approved,
    claim_queued,
    fetch_application,
    fetch_applications,
    fetch_desktop,
    fetch_next_application,
    fetch_review,
    fetch_stage,
    link_resume,
    move_stage,
    pick_resume,
    queue_applications,
    remove_queued,
    requeue_stale,
    save_beat,
    save_review,
    strand_submitting,
)
from app.auto_apply.rules import pick_batch
from app.models.dto import application_stage
from app.queries.jobs.filters import JobFilters
from app.routers.jobs import EmptyBank, fetch_recommended
from app.schemas.applications import (
    Application,
    DesktopBeat,
    DesktopStatus,
    Review,
    ReviewAnswer,
)
from app.schemas.auth import AuthenticatedAccount
from app.schemas.jobs import ScoredJob
from app.schemas.sent_resume import SentResumeDownload
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
# finishes a failed form by hand, or any of WorkIt Desktop's (KAN-323):
# filling (it failed or was skipped), review (the student skipped it),
# approved and submitting (Desktop submitted it, or its fill ended).
FINISHABLE = (
    application_stage.queued,
    application_stage.needs_you,
    application_stage.filling,
    application_stage.review,
    application_stage.approved,
    application_stage.submitting,
)
# The stages that get a resume: a fill's, and Desktop's two fills, the
# first (filling) and the one with the approved answers (approved, then
# submitting once a Desktop takes it).
RESUMABLE = (
    application_stage.queued,
    application_stage.needs_you,
    application_stage.filling,
    application_stage.approved,
    application_stage.submitting,
)
# The most applications one claim takes: one per Desktop Worker.
MAX_CLAIM = 10


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

    Only job postings on a hiring system auto apply fills
    (app/auto_apply/hosts.py). Leaves out every job posting the
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
    note: str | None = None,
) -> application_stage:
    """
    Records how a fill ended (OUTCOME_STAGE) and answers the new stage.
    Only an application in FINISHABLE can finish: raises NotFound when there
    is none, WrongStage when it is saved, skipped or applied already.
    Desktop's `note` (why it ended) goes to the log only: no column keeps it.
    """
    new = OUTCOME_STAGE[outcome]
    if not await move_stage(db, applicant_id, job_id, new, FINISHABLE):
        stage = await fetch_stage(db, applicant_id, job_id)
        if stage is None:
            raise NotFound("No application for that job. Queue it first.")
        raise WrongStage(
            f"That application is {stage}, so it can't be finished. Queue a new job instead."
        )
    if note:
        logger.info("Auto apply fill of job %s ended %s: %s", job_id, outcome, note)
    await db.commit()
    return new


async def prepare_resume(
    db: AsyncSession, storage: Any, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> SentResumeDownload | None:
    """
    The resume one application sends, ready to attach: pick_resume's choice
    (the resume tailored to the job posting, else the default) kept as a sent
    resume linked to the job posting, as Apply keeps one, with its file: the
    PDF itself (`data`) for a built resume, kept as a snapshot (KAN-267), or
    a 5-minute link (`url`) for an uploaded one. None when the student has no such resume:
    the form is filled without one. Never tailors.

    Only an application in RESUMABLE gets one (queued, needs_you, or
    Desktop's filling and approved): raises NotFound when there is none or
    its job posting closed, WrongStage when it is saved, in review, skipped
    or applied. A repeat with unchanged content returns the same sent resume, so
    a run that starts again keeps nothing new. The application names the
    sent resume (`link_resume`, KAN-267). Raises TectonicUnavailable
    when the PDF cannot be made, FileFailed when Storage cannot sign the link.
    """
    stage = await fetch_stage(db, applicant_id, job_id)
    if stage is None:
        raise NotFound("No application for that job. Queue it first.")
    if stage not in RESUMABLE:
        raise WrongStage(
            f"That application is {stage}, so it gets no resume. Queue a new job instead."
        )
    choice = await pick_resume(db, applicant_id, job_id)
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




# --- WorkIt Desktop (KAN-323, auto-apply/desktop.md) ---


async def claim_applications(
    db: AsyncSession, applicant_id: uuid.UUID, n: int
) -> list[Application]:
    """
    A Desktop's claim: up to `n` (at most MAX_CLAIM) of the applicant's
    oldest queued applications whose job posting is open, moved to filling
    in one commit, oldest first; [] when none is left. First sends back to
    queued any filling application whose Desktop stopped beating 10 minutes
    ago (requeue_stale), so a crash never strands one. Two claims at once
    never answer the same application (claim_queued).
    """
    await requeue_stale(db, applicant_id)
    claimed = await claim_queued(db, applicant_id, min(n, MAX_CLAIM))
    await db.commit()
    return claimed


async def claim_approved_applications(
    db: AsyncSession, applicant_id: uuid.UUID, n: int
) -> list[Application]:
    """
    A Desktop's claim of approved applications to submit: up to `n` (at most
    MAX_CLAIM), oldest first, moved to submitting and leased to the beating
    Desktop in one commit; [] when none is approved. First moves to needs_you
    every submitting application its Desktop no longer holds
    (strand_submitting): its form may have gone, so it is never submitted
    again. Two claims at once never answer the same application.
    """
    await strand_submitting(db, applicant_id)
    claimed = await claim_approved(db, applicant_id, min(n, MAX_CLAIM))
    await db.commit()
    return claimed


async def submit_review(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, review: Review
) -> application_stage:
    """
    Desktop filled the form to its last page and stopped before Submit: keeps
    its review and moves the application to review, in one commit. Only a
    filling application takes one: raises NotFound when there is none,
    WrongStage at any other stage (claim it first).
    """
    moved = await move_stage(
        db, applicant_id, job_id, application_stage.review, [application_stage.filling]
    )
    if not moved:
        stage = await fetch_stage(db, applicant_id, job_id)
        if stage is None:
            raise NotFound("No application for that job. Queue it first.")
        raise WrongStage(
            f"That application is {stage}, so it can't be reviewed. Claim it first."
        )
    await save_review(db, applicant_id, job_id, review)
    await db.commit()
    return application_stage.review


async def get_review(db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID) -> Review:
    """The application's review: what Desktop filled, with the approved
    answers once the student approved it. Raises NotFound when it has none."""
    review = await fetch_review(db, applicant_id, job_id)
    if review is None:
        raise NotFound("That application has no review.")
    return review


async def approve_application(
    db: AsyncSession,
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    answers: Sequence[ReviewAnswer] = (),
) -> application_stage:
    """
    The student approves an application in review, with their edited
    `answers` or, when empty, the review's own: keeps them and moves it to
    approved in one commit, for Desktop to fill again and submit. Raises
    NotFound when there is no application, WrongStage when it isn't in
    review.
    """
    moved = await move_stage(
        db, applicant_id, job_id, application_stage.approved, [application_stage.review]
    )
    if not moved:
        stage = await fetch_stage(db, applicant_id, job_id)
        if stage is None:
            raise NotFound("No application for that job. Queue it first.")
        raise WrongStage(f"That application is {stage}, so there is nothing to approve.")
    if not await approve_review(db, applicant_id, job_id, answers):
        # A review row always comes with the review stage (submit_review).
        await db.rollback()
        raise NotFound("That application has no review.")
    await db.commit()
    return application_stage.approved


async def desktop_beat(
    db: AsyncSession, applicant_id: uuid.UUID, beat: DesktopBeat
) -> DesktopStatus:
    """Records a Desktop heartbeat (every 15 s) in one commit and answers the
    status it makes: online."""
    status = await save_beat(db, applicant_id, beat)
    await db.commit()
    return status


async def desktop_status(db: AsyncSession, applicant_id: uuid.UUID) -> DesktopStatus:
    """Whether the applicant's Desktop is running: online with a beat in the
    last 45 s. Offline with no counts when it never beat."""
    status = await fetch_desktop(db, applicant_id)
    if status is None:
        return DesktopStatus(online=False, last_seen=None, workers=0, busy=0, usage=None)
    return status

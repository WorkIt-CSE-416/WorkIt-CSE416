"""
Layer 2, the resume an application goes out with: the student's own pick
(choose_resume, KAN-359) and the file a fill attaches (prepare_resume),
each kept as a sent resume through services/sent_resumes.py, under Apply's
rules. pipeline.py names both steps too, for its callers.
"""

import logging
import uuid
from typing import Any

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auto_apply.queries import (
    ResumeChoice,
    chosen_resume,
    fetch_stage,
    link_resume,
    pick_resume,
)
from app.auto_apply.stages import FINISHABLE, NotFound, WrongStage
from app.schemas.sent_resume import SentResumeDownload, SentResumeResponse
from app.services import sent_resumes
from app.services.bank import NotFound as ResumeNotFound
from app.services.resume_render import TectonicUnavailable

logger = logging.getLogger(__name__)


class FileFailed(Exception):
    """Storage refused the resume's file or its link. Nothing was kept. The
    route answers 502."""


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

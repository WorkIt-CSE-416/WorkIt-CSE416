"""
What every auto apply step checks before it acts (layer 2,
auto-apply/architecture.md, "The function layers"): that the application
exists, and that its form is still open. pipeline.py, written.py and
resume.py raise these errors; app/main.py answers NotFound with 404 and
WrongStage with 409, so a route lets them through.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.auto_apply.queries import fetch_application, fetch_stage
from app.models.dto import application_stage
from app.schemas.applications import Application

# The stages a fill can end from: queued, or needs_you when the student
# finishes a failed form by hand.
FINISHABLE = (application_stage.queued, application_stage.needs_you)


class NotFound(Exception):
    """No such job posting open, or no application for it. The route answers 404."""


class WrongStage(Exception):
    """The application is not in the stage this step needs. The message names
    the step to call first. The route answers 409."""


async def get_application(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> Application:
    """The applicant's application for one job posting: its listing, stage
    and dates. Raises NotFound when they have none."""
    application = await fetch_application(db, applicant_id, job_id)
    if application is None:
        raise NotFound("No application for that job.")
    return application


async def open_application(db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID) -> None:
    """Raises NotFound with no application, WrongStage once it is past
    the form (skipped or applied)."""
    stage = await fetch_stage(db, applicant_id, job_id)
    if stage is None:
        raise NotFound("No application for that job. Queue it first.")
    if stage not in FINISHABLE:
        raise WrongStage(f"That application is {stage}, so its form is no longer open.")

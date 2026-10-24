"""GET and PUT for an applicant's saved job preferences (KAN-231).

    GET /applicants/{applicant_id}/preferences
        The saved preferences, or empty ones (every list empty, no pay, no
        visa) when the applicant has saved none.

    PUT /applicants/{applicant_id}/preferences
        Replaces them whole with the body (schemas/preferences.py) and marks
        onboarding complete if it was not already: saving preferences is what
        finishing onboarding means. 422 names any role slug job_roles lacks,
        and any place code the location tables lack.

The fields are GET /jobs' query parameters, so the Jobs page applies a saved
set as its filters with no conversion. Roles are rows in applicant_job_roles
and places rows in applicant_locations, for their foreign keys; the rest is
one applicant_preferences row.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import assert_applicant_owns, get_current_account
from app.queries.preferences import fetch_preferences, save_preferences, unknown_codes
from app.schemas.auth import AuthenticatedAccount
from app.schemas.preferences import JobPreferences

logger = logging.getLogger(__name__)

router = APIRouter()

_PATH = "/applicants/{applicant_id}/preferences"


@router.get(_PATH, response_model=JobPreferences)
async def get_preferences(
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
) -> JobPreferences:
    assert_applicant_owns(account, applicant_id)
    return await fetch_preferences(session, applicant_id) or JobPreferences()


@router.put(_PATH, response_model=JobPreferences)
async def put_preferences(
    applicant_id: uuid.UUID,
    body: JobPreferences,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
) -> JobPreferences:
    assert_applicant_owns(account, applicant_id)

    if body.role or body.location:
        unknown = await unknown_codes(session, body.role, body.location)
        if unknown:
            raise HTTPException(422, f"Unknown role or place: {', '.join(unknown)}")

    try:
        await save_preferences(session, applicant_id, body)
    except IntegrityError:
        # Two saves at once can collide on applicant_job_roles' or
        # applicant_locations' key between the delete and the insert; the
        # later one is simply retried.
        await session.rollback()
        raise HTTPException(409, "Your preferences changed while saving. Try again.")
    except Exception:
        await session.rollback()
        logger.exception("Saving preferences failed", extra={"applicant_id": str(applicant_id)})
        raise HTTPException(500, "Failed to save preferences")

    return body

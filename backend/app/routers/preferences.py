"""
GET and PUT for an applicant's saved job preferences (KAN-231).

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

import datetime
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import Text, delete, func, insert, select, union_all, update
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import assert_applicant_owns, get_current_account
from app.models.job_roles import Job_Role
from app.models.locations import Country, State
from app.models.preferences import (
    Applicant_Job_Role,
    Applicant_Location,
    Applicant_Preferences,
)
from app.models.profiles import Applicant_Profile
from app.schemas.auth import AuthenticatedAccount
from app.schemas.preferences import JobPreferences
from app.services.location_resolver import Place

logger = logging.getLogger(__name__)

router = APIRouter()

_PATH = "/applicants/{applicant_id}/preferences"

# A saved place as its filter code (Place.code): the state's, else the country's.
_PLACE_CODE = func.coalesce(Applicant_Location.state, Applicant_Location.country)


def _picked(column, where):
    """The applicant's picks from one child table as a text[], '{}' when none:
    ARRAY(subquery), so the GET reads the row and both lists in one query."""
    return func.array(
        select(column).where(where).order_by(column).scalar_subquery(), type_=ARRAY(Text)
    )


async def _unknown(session: AsyncSession, roles: list[str], places: list[str]) -> list[str]:
    """The role slugs and place codes the database lacks, in the order given.
    Checked before writing, so the answer is a 422 that names them rather than
    a 500 from a foreign key."""
    wanted = [Place.from_code(code) for code in places]
    found = set((await session.scalars(union_all(
        select(Job_Role.slug).where(Job_Role.slug.in_(roles)),
        select(Country.code).where(Country.code.in_({p.country for p in wanted})),
        select(State.code).where(State.code.in_({p.state for p in wanted if p.state})),
    ))).all())
    return [slug for slug in roles if slug not in found] + [
        p.code for p in wanted if p.country not in found or (p.state and p.state not in found)
    ]


@router.get(_PATH, response_model=JobPreferences)
async def get_preferences(
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
) -> JobPreferences:
    assert_applicant_owns(account, applicant_id)
    found = (await session.execute(
        select(
            Applicant_Preferences,
            _picked(Applicant_Job_Role.role_slug, Applicant_Job_Role.applicant_id == applicant_id),
            _picked(_PLACE_CODE, Applicant_Location.applicant_id == applicant_id),
        ).where(Applicant_Preferences.applicant_id == applicant_id)
    )).one_or_none()
    # A PUT writes the row with the picks, so no row means nothing is saved.
    if found is None:
        return JobPreferences()
    row, roles, places = found
    return JobPreferences(
        location=places,
        work_style=row.work_styles,
        role=roles,
        experience=row.levels,
        job_type=row.job_types,
        min_pay=row.min_pay,
        max_pay=row.max_pay,
        pay_per=row.pay_per,
        start_term=row.start_terms,
        visa=row.visa,
    )


@router.put(_PATH, response_model=JobPreferences)
async def put_preferences(
    applicant_id: uuid.UUID,
    body: JobPreferences,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
) -> JobPreferences:
    assert_applicant_owns(account, applicant_id)

    if body.role or body.location:
        unknown = await _unknown(session, body.role, body.location)
        if unknown:
            raise HTTPException(422, f"Unknown role or place: {', '.join(unknown)}")

    values = {
        "work_styles": [style.value for style in body.work_style],
        "levels": body.experience,
        "job_types": body.job_type,
        "start_terms": body.start_term,
        "min_pay": body.min_pay,
        "max_pay": body.max_pay,
        "pay_per": body.pay_per,
        "visa": body.visa,
    }
    try:
        # One transaction: the row, the roles, the places and the onboarding
        # stamp land together or not at all.
        await session.execute(
            pg_insert(Applicant_Preferences)
            .values(applicant_id=applicant_id, **values)
            .on_conflict_do_update(
                index_elements=[Applicant_Preferences.applicant_id],
                set_={**values, "updated_at": func.now()},
            )
        )
        await session.execute(
            delete(Applicant_Job_Role).where(Applicant_Job_Role.applicant_id == applicant_id)
        )
        if body.role:
            await session.execute(insert(Applicant_Job_Role), [
                {"applicant_id": applicant_id, "role_slug": slug} for slug in body.role
            ])
        await session.execute(
            delete(Applicant_Location).where(Applicant_Location.applicant_id == applicant_id)
        )
        if body.location:
            await session.execute(insert(Applicant_Location), [
                {"applicant_id": applicant_id, "country": p.country, "state": p.state}
                for p in map(Place.from_code, body.location)
            ])
        # Stamped once: a later edit of the preferences keeps the first date.
        await session.execute(
            update(Applicant_Profile)
            .where(
                Applicant_Profile.id == applicant_id,
                Applicant_Profile.onboarding_completed_at.is_(None),
            )
            .values(onboarding_completed_at=datetime.datetime.now(datetime.UTC))
        )
        await session.commit()
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

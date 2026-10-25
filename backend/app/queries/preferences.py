"""Preferences queries: the database work behind routers/preferences.py."""

import datetime
import uuid

from sqlalchemy import Text, delete, func, insert, select, union_all, update
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job_roles import Job_Role
from app.models.locations import Country, State
from app.models.preferences import (
    Applicant_Job_Role,
    Applicant_Location,
    Applicant_Preferences,
)
from app.models.profiles import Applicant_Profile
from app.schemas.preferences import JobPreferences
from app.services.location_resolver import Place

# A saved place as its filter code (Place.code): the state's, else the country's.
_PLACE_CODE = func.coalesce(Applicant_Location.state, Applicant_Location.country)


def picked_array(column, where):
    """The applicant's picks from one child table as a text[], '{}' when none:
    ARRAY(subquery), so the GET reads the row and both lists in one query."""
    return func.array(
        select(column).where(where).order_by(column).scalar_subquery(), type_=ARRAY(Text)
    )


async def unknown_codes(session: AsyncSession, roles: list[str], places: list[str]) -> list[str]:
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


async def fetch_preferences(session: AsyncSession, applicant_id: uuid.UUID) -> JobPreferences | None:
    """The saved preferences, or None when the applicant has saved none."""
    found = (await session.execute(
        select(
            Applicant_Preferences,
            picked_array(Applicant_Job_Role.role_slug, Applicant_Job_Role.applicant_id == applicant_id),
            picked_array(_PLACE_CODE, Applicant_Location.applicant_id == applicant_id),
        ).where(Applicant_Preferences.applicant_id == applicant_id)
    )).one_or_none()
    # A PUT writes the row with the picks, so no row means nothing is saved.
    if found is None:
        return None
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


async def save_preferences(
    session: AsyncSession, applicant_id: uuid.UUID, body: JobPreferences
) -> None:
    """Write the preferences, roles, places and onboarding stamp in one
    transaction: they land together or not at all. Two saves at once can
    collide on applicant_job_roles' or applicant_locations' key between the
    delete and the insert; the commit then raises IntegrityError, and the
    route answers 409 so the later one is simply retried."""
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

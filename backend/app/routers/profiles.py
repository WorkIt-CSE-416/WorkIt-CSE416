"""GET and PATCH for the applicant's own profile fields."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import assert_applicant_owns, get_current_account
from app.models.profiles import Applicant_Profile
from app.schemas.auth import AuthenticatedAccount
from app.schemas.profile import ApplicantProfileResponse, ApplicantProfileUpdate

router = APIRouter()


@router.get(
    "/applicants/{applicant_id}/profile",
    response_model=ApplicantProfileResponse,    # serialize the return value through this Pydantic schema
)
async def get_profile(
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
) -> ApplicantProfileResponse:
    assert_applicant_owns(account, applicant_id)
    profile = await session.get(Applicant_Profile, applicant_id)    # gets the table and attach the applicant id
    if profile is None:
        raise HTTPException(404, "Profile not found")
    return ApplicantProfileResponse.model_validate(profile)         # makes sure response follows schema

# partial update
@router.patch(
    "/applicants/{applicant_id}/profile",
    response_model=ApplicantProfileResponse,    
)
async def update_profile(
    applicant_id: uuid.UUID,
    body: ApplicantProfileUpdate,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
) -> ApplicantProfileResponse:
    assert_applicant_owns(account, applicant_id)
    profile = await session.get(Applicant_Profile, applicant_id)
    if profile is None:
        raise HTTPException(404, "Profile not found")

    for field in body.model_fields_set:
        setattr(profile, field, getattr(body, field))

    try:
        await session.commit()
    except Exception:
        await session.rollback()
        raise HTTPException(500, "Failed to save profile changes")

    await session.refresh(profile)
    return ApplicantProfileResponse.model_validate(profile)

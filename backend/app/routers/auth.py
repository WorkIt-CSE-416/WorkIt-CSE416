"""
Auth routes: signup and /me. Login has no route here — the Next server signs
in against Supabase Auth directly, then calls /me with the access token to
learn which account it got (backend/CLAUDE.md's Auth section)
"""

import asyncio
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from supabase_auth.errors import AuthError

from app.db import get_session, get_supabase
from app.deps import get_current_account
from app.models.dto import company_role, profile_status
from app.models.profiles import Applicant_Profile, Company_Membership, Company_Profile
from app.schemas.auth import (
    AccountType,
    AuthenticatedAccount,
    CompanySignup,
    SignupRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

_EMAIL_TAKEN = HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists.")


def _signup_error(exc: AuthError) -> HTTPException:
    """Turns a Supabase Auth failure into what the signup form shows. A taken
    address and a weak password are the user's to fix, so their message goes
    back; anything else is ours, and gets a generic 502 with the detail
    logged rather than echoed."""
    if exc.code in ("email_exists", "user_already_exists"):
        return _EMAIL_TAKEN
    if exc.code == "weak_password":
        return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, exc.message)

    logger.error("Supabase Auth rejected signup: %s (%s)", exc.message, exc.code)
    return HTTPException(status.HTTP_502_BAD_GATEWAY, "Couldn't create the account. Please try again.")


def _create_company(company_info:CompanySignup)->Company_Profile:
    '''
    function to create a company given the json information file
    '''
    # Set here rather than left to the column default, which SQLAlchemy only
    # applies at flush — the membership needs this id before then.
    company_id = uuid.uuid4()
    new_company= Company_Profile(
        id = company_id, 
        company_name = company_info.name, 
        website_url= company_info.website_url,
        contact_email= company_info.contact_email,
        phone_number= company_info.contact_phone,
        size_range=company_info.size_range
    )
    return new_company



@router.post(
    "/signup",
    response_model=AuthenticatedAccount,
    status_code=status.HTTP_201_CREATED,
)
async def signup(
    body: SignupRequest,
    db: AsyncSession = Depends(get_session),
) -> AuthenticatedAccount:
    '''
    central sign up function for both applicants and companies 
    for applicants, create applicant_profile and return attributes same as sign up
    for companies, generate company_id, create company_profile, and return login attributes 
    '''
    account_type = body.account_type
    supabase = get_supabase()

    # Supabase first: each profile's id is its auth.users id, and a foreign
    # key to that table, so the auth user has to exist before any row here.
    # The admin API is synchronous; to_thread keeps it off the event loop.
    try:
        created = await asyncio.to_thread(
            supabase.auth.admin.create_user,
            {
                "email": body.email,
                "password": body.password,
                "email_confirm": True,
                "app_metadata": {"account_type": account_type.value},
            },
        )
    except AuthError as exc:
        raise _signup_error(exc) from exc

    user_id = uuid.UUID(created.user.id)
    company_id= None 
    try:
        if account_type is AccountType.APPLICANT:
            profile = Applicant_Profile(
                id=user_id,
                email=body.email,
                full_name=body.full_name,
            )
        else:   
            new_company = _create_company(body.company)
            company_id = new_company.id
            db.add(new_company)
            await db.flush()    # first insert the company to make sure bug-free

            # whoever creates the company owns it
            profile = Company_Membership(
                id=user_id,
                company_id=company_id,
                email=body.email,
                full_name=body.full_name,
                role=company_role.owner,
                status=profile_status.active,
            )
        db.add(profile)
        await db.commit()
    except Exception as exc:
        await db.rollback()
        try:
            await asyncio.to_thread(supabase.auth.admin.delete_user, created.user.id)
        except AuthError:
            logger.exception("Orphaned Supabase auth user %s after a failed signup", created.user.id)
        if isinstance(exc, IntegrityError):
            raise _EMAIL_TAKEN from exc
        raise

    return AuthenticatedAccount(
        id=profile.id,
        email=profile.email,
        full_name=profile.full_name,
        account_type=account_type,
        onboarding_completed=False,
        company_id=company_id,
    )


@router.get("/me", response_model=AuthenticatedAccount)
async def me(account: AuthenticatedAccount = Depends(get_current_account)) -> AuthenticatedAccount:
    '''
    after front end signs in with supabase, this function returns the user information
    '''
    return account

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
from app.models.profiles import Applicant_Profile
from app.schemas.auth import AccountType, AuthenticatedAccount, SignupRequest

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


@router.post(
    "/signup",
    response_model=AuthenticatedAccount,
    status_code=status.HTTP_201_CREATED,
)
async def signup(
    body: SignupRequest,
    db: AsyncSession = Depends(get_session),
) -> AuthenticatedAccount:
    if body.account_type is AccountType.COMPANY:
        raise HTTPException(
            status.HTTP_501_NOT_IMPLEMENTED,
            "Company signup isn't wired up yet — no screen collects a company name.",
        )

    # create supabase 
    supabase = get_supabase()

    # The admin API is synchronous; to_thread keeps it off the event loop
    try:
        created = await asyncio.to_thread(
            supabase.auth.admin.create_user,
            {
                "email": body.email,
                "password": body.password,
                "email_confirm": True,
                "app_metadata": {"account_type": AccountType.APPLICANT.value},
            },
        )
    except AuthError as exc:
        raise _signup_error(exc) from exc

    # once account is created in supabase, manually create our profile info
    profile = Applicant_Profile(
        id=uuid.UUID(created.user.id),
        email=body.email,
        full_name=body.full_name,
    )
    db.add(profile)
    try:
        await db.commit()
    except Exception as exc:
        # if db has errors, failed to store to db, delete the user from supabase auth
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
        account_type=AccountType.APPLICANT,
        onboarding_completed=False,
    )


@router.get("/me", response_model=AuthenticatedAccount)
async def me(account: AuthenticatedAccount = Depends(get_current_account)) -> AuthenticatedAccount:
    '''
    after front end signs in with supabase, this function returns the user information
    '''
    return account

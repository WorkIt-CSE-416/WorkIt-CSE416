"""
Auth routes: signup, /me, and OAuth completion. Login has no route here —
the Next server signs in against Supabase Auth directly, then calls /me with
the access token to learn which account it got (backend/CLAUDE.md's Auth
section).

Google/LinkedIn sign-in is the same idea bent slightly: Supabase creates the
auth.users row itself, so account_type and the profile row are both missing
afterward. /oauth/status tells the Next server whether that's the case for
the identity it just got a session for, and /oauth/account-type is where the
user's choice (Applicant or Company) fills them in — the OAuth equivalent of
this file's own signup().
"""

import asyncio
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from supabase_auth.errors import AuthError

from app.db import get_session, get_supabase
from app.deps import get_current_account, get_verified_identity, load_account
from app.models.dto import company_role, profile_status
from app.models.profiles import Applicant_Profile, Company_Membership, Company_Profile
from app.schemas.auth import (
    AccountType,
    AccountTypeSelection,
    AuthenticatedAccount,
    CompanySignup,
    OAuthStatus,
    SignupRequest,
    VerifiedIdentity,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# A function, not a shared instance: see _not_authenticated in app/deps.py.
def _email_taken() -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists.")


def _signup_error(exc: AuthError) -> HTTPException:
    """Turns a Supabase Auth failure into what the signup form shows. A taken
    address and a weak password are the user's to fix, so their message goes
    back; anything else is ours, and gets a generic 502 with the detail
    logged rather than echoed."""
    if exc.code in ("email_exists", "user_already_exists"):
        return _email_taken()
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
            raise _email_taken() from exc
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


@router.get("/oauth/status", response_model=OAuthStatus)
async def oauth_status(
    identity: VerifiedIdentity = Depends(get_verified_identity),
    db: AsyncSession = Depends(get_session),
) -> OAuthStatus:
    '''
    What the Next server checks right after exchanging a Google/LinkedIn
    redirect for a session, to decide between sending the user straight into
    the app (an account_type and profile row already exist) or to Choose
    Account Type (a first-time OAuth sign-in, neither exists yet).
    '''
    if identity.account_type is None:
        return OAuthStatus(needs_account_type=True)

    account = await load_account(db, identity.id, identity.account_type)
    if account is None:
        # account_type made it into app_metadata but the profile row didn't —
        # an earlier /oauth/account-type call crashed between the two
        # writes. Send them back through it rather than a dead end.
        return OAuthStatus(needs_account_type=True)

    return OAuthStatus(needs_account_type=False, account=account)


@router.post("/oauth/account-type", response_model=AuthenticatedAccount)
async def complete_oauth_account_type(
    body: AccountTypeSelection,
    identity: VerifiedIdentity = Depends(get_verified_identity),
    db: AsyncSession = Depends(get_session),
) -> AuthenticatedAccount:
    '''
    Fills in the one thing a Google/LinkedIn sign-in can't supply on its own:
    which kind of account this is. Supabase creates the auth.users row for an
    OAuth sign-in itself, bypassing signup() above entirely, so
    app_metadata.account_type and the profile row both start out missing —
    this sets them the same way signup() does, minus a password to set.
    '''
    supabase = get_supabase()

    if identity.account_type is not None:
        # Already completed — a repeat visit to the screen, two tabs racing.
        # Hand back what's there instead of erroring a second time.
        existing = await load_account(db, identity.id, identity.account_type)
        if existing is not None:
            return existing
        # account_type is set but the profile row isn't — a previous attempt
        # crashed between the two writes below. Fall through and retry.

    try:
        await asyncio.to_thread(
            supabase.auth.admin.update_user_by_id,
            str(identity.id),
            {"app_metadata": {"account_type": body.account_type.value}},
        )
    except AuthError as exc:
        logger.error("Supabase Auth rejected account-type update: %s (%s)", exc.message, exc.code)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Couldn't finish setting up the account. Please try again."
        ) from exc

    # Best-effort — the identity provider's claimed name, trimmed to what the
    # profile column allows, falling back to the email's local part on an
    # OAuth app that never sent a name at all.
    full_name = (identity.full_name or identity.email.split("@")[0])[:50]
    company_id = None
    try:
        if body.account_type is AccountType.APPLICANT:
            profile = Applicant_Profile(id=identity.id, email=identity.email, full_name=full_name)
        else:
            new_company = _create_company(body.company)
            company_id = new_company.id
            db.add(new_company)
            await db.flush()

            profile = Company_Membership(
                id=identity.id,
                company_id=company_id,
                email=identity.email,
                full_name=full_name,
                role=company_role.owner,
                status=profile_status.active,
            )
        db.add(profile)
        await db.commit()
    except Exception as exc:
        await db.rollback()
        # Unlike signup(), there's no fresh auth user to delete here — this
        # person's Google/LinkedIn session is real and stays. Only the
        # half-applied account_type needs undoing, so /oauth/status sends
        # them back through this endpoint instead of treating it as done.
        try:
            await asyncio.to_thread(
                supabase.auth.admin.update_user_by_id,
                str(identity.id),
                {"app_metadata": {"account_type": None}},
            )
        except AuthError:
            logger.exception(
                "Couldn't roll back account_type for %s after a failed OAuth account setup",
                identity.id,
            )
        if isinstance(exc, IntegrityError):
            raise _email_taken() from exc
        raise

    return AuthenticatedAccount(
        id=profile.id,
        email=profile.email,
        full_name=profile.full_name,
        account_type=body.account_type,
        onboarding_completed=False,
        company_id=company_id,
    )

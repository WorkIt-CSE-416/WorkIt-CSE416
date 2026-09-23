"""
Auth routes: signup, login, and /me — the last one exists mainly to give
get_current_account (app/deps.py) a real HTTP consumer, and doubles as what
a frontend calls on load to ask "is there a valid session, and whose is it."
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.deps import get_current_account
from app.models.profiles import Applicant_Profile, Company_Membership
from app.schemas.auth import AccountType, AuthenticatedAccount, LoginRequest, SignupRequest
from app.security import (
    ACCESS_TOKEN_TTL,
    SESSION_COOKIE_NAME,
    create_access_token,
    hash_password,
    needs_rehash,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _issue_token(
    account: Applicant_Profile | Company_Membership,
    account_type: AccountType,
    company_id: uuid.UUID | None,
) -> str:
    """Builds the signed access token for a freshly authenticated account.
    Pure function of the account's already-known fields — no DB write,
    unlike the old sessions-table design's INSERT.

    Claims are kept to the minimum needed to identify the account and its
    authorization scope (sub, account_type, company_id) — no email or name,
    so the token itself carries no PII. get_current_account (app/deps.py)
    re-reads the rest from the database rather than trusting the token for
    it, which also means onboarding_completed there can no longer go stale
    the way a claim fixed at issue time could."""
    return create_access_token(
        {
            "sub": str(account.id),
            "account_type": account_type.value,
            "company_id": str(company_id) if company_id else None,
        }
    )


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        max_age=int(ACCESS_TOKEN_TTL.total_seconds()),
        httponly=True,
        secure=True,
        samesite="lax",
    )


@router.post(
    "/signup",
    response_model=AuthenticatedAccount,
    status_code=status.HTTP_201_CREATED,
)
async def signup(
    body: SignupRequest,
    response: Response,
    db: AsyncSession = Depends(get_session),
) -> AuthenticatedAccount:
    get_settings().jwt_signing_key  # fail before writing anything if JWT_SECRET is unset

    if body.account_type is AccountType.COMPANY:
        # db/auth_methodology.md §2 decision 4: company_profiles.company_name
        # and .size_range are NOT NULL with no default, and no screen collects
        # either yet — onboarding/company is still a stub, so there is nowhere
        # to send a new company account even if this endpoint could create one.
        # Fail loudly instead of guessing placeholder values or half-creating
        # an account with no company behind it.
        raise HTTPException(
            status.HTTP_501_NOT_IMPLEMENTED,
            "Company signup isn't wired up yet — no screen collects a company name.",
        )

    profile = Applicant_Profile(
        email=body.email,
        full_name=body.full_name,
        password_hash=await hash_password(body.password),
    )
    db.add(profile)
    try:
        # Flush rather than commit: this assigns profile.id (needed for the
        # token below) and surfaces the email-uniqueness violation without
        # ending the transaction.
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "An account with this email already exists."
        )

    await db.commit()
    await db.refresh(profile)

    token = _issue_token(profile, AccountType.APPLICANT, None)
    _set_session_cookie(response, token)

    return AuthenticatedAccount(
        id=profile.id,
        email=profile.email,
        full_name=profile.full_name,
        account_type=AccountType.APPLICANT,
        onboarding_completed=profile.onboarding_completed_at is not None,
        company_id=None,
    )


@router.post("/login", response_model=AuthenticatedAccount)
async def login(
    body: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_session),
) -> AuthenticatedAccount:
    get_settings().jwt_signing_key  # fail before writing anything if JWT_SECRET is unset

    # Unlike signup, login has no company-side gap: a company_memberships row
    # only needs to already exist, not to be created by this request, so both
    # account types are handled the same way here.
    model = Applicant_Profile if body.account_type is AccountType.APPLICANT else Company_Membership
    account = (
        await db.execute(select(model).where(model.email == body.email))
    ).scalar_one_or_none()

    # Same message either way — telling "no such email" apart from "wrong
    # password" lets an attacker enumerate registered addresses.
    invalid_credentials = HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password.")

    if account is None or not await verify_password(body.password, account.password_hash):
        raise invalid_credentials

    # The only time the plaintext password is on hand to re-hash with — see
    # needs_rehash()'s docstring.
    if needs_rehash(account.password_hash):
        account.password_hash = await hash_password(body.password)

    await db.commit()

    company_id = account.company_id if body.account_type is AccountType.COMPANY else None
    token = _issue_token(account, body.account_type, company_id)
    _set_session_cookie(response, token)

    return AuthenticatedAccount(
        id=account.id,
        email=account.email,
        full_name=account.full_name,
        account_type=body.account_type,
        onboarding_completed=account.onboarding_completed_at is not None,
        company_id=company_id,
    )


@router.get("/me", response_model=AuthenticatedAccount)
async def me(account: AuthenticatedAccount = Depends(get_current_account)) -> AuthenticatedAccount:
    return account

"""
Auth routes: signup, login, and /me — the last one exists mainly to give
get_current_account (app/deps.py) a real HTTP consumer, and doubles as what
a frontend calls on load to ask "is there a valid session, and whose is it."
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_current_account
from app.models.profiles import Applicant_Profile, Company_Membership
from app.models.sessions import Session as SessionModel
from app.schemas.auth import AccountType, AuthenticatedAccount, LoginRequest, SignupRequest
from app.security import (
    DUMMY_PASSWORD_HASH,
    SESSION_COOKIE_NAME,
    SESSION_TTL,
    generate_session_token,
    hash_password,
    hash_session_token,
    needs_rehash,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


async def _issue_session(
    db: AsyncSession,
    *,
    applicant_id: uuid.UUID | None = None,
    company_membership_id: uuid.UUID | None = None,
) -> str:
    """Adds a session row to `db` and returns the raw token to hand the
    browser. Not committed here — the caller's transaction covers it, so a
    session is never persisted for an account that didn't actually get
    created. Exactly one of the two ids must be set, mirroring `sessions`'
    own CHECK constraint (app/models/sessions.py)."""
    token = generate_session_token()
    db.add(
        SessionModel(
            token_hash=hash_session_token(token),
            applicant_id=applicant_id,
            company_membership_id=company_membership_id,
            expires_at=datetime.now(timezone.utc) + SESSION_TTL,
        )
    )
    return token


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        max_age=int(SESSION_TTL.total_seconds()),
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
        password_hash=hash_password(body.password),
    )
    db.add(profile)
    try:
        # Flush rather than commit: this assigns profile.id (needed for the
        # session row below) and surfaces the email-uniqueness violation
        # without ending the transaction, so the whole signup — profile plus
        # its first session — commits or rolls back together.
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "An account with this email already exists."
        )

    token = await _issue_session(db, applicant_id=profile.id)
    await db.commit()
    await db.refresh(profile)

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

    if account is None:
        # Burn the same CPU time a real verify would, so the response isn't
        # measurably faster for an email that was never registered.
        verify_password(body.password, DUMMY_PASSWORD_HASH)
        raise invalid_credentials

    if not verify_password(body.password, account.password_hash):
        raise invalid_credentials

    # The only time the plaintext password is on hand to re-hash with — see
    # needs_rehash()'s docstring.
    if needs_rehash(account.password_hash):
        account.password_hash = hash_password(body.password)

    if body.account_type is AccountType.APPLICANT:
        token = await _issue_session(db, applicant_id=account.id)
    else:
        token = await _issue_session(db, company_membership_id=account.id)
    await db.commit()

    _set_session_cookie(response, token)

    return AuthenticatedAccount(
        id=account.id,
        email=account.email,
        full_name=account.full_name,
        account_type=body.account_type,
        onboarding_completed=account.onboarding_completed_at is not None,
        company_id=account.company_id if body.account_type is AccountType.COMPANY else None,
    )


@router.get("/me", response_model=AuthenticatedAccount)
async def me(account: AuthenticatedAccount = Depends(get_current_account)) -> AuthenticatedAccount:
    return account

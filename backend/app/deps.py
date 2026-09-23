"""
Shared FastAPI dependencies. Currently just get_current_account — the
token-verification dependency backend/CLAUDE.md's Auth section requires:
"whoever acts on a token verifies its signature... this is our signing key
and our verification dependency — one place, used by every protected route."

Verifying means checking the JWT's signature and expiry (app/security.py's
decode_access_token). The token's own claims (sub, account_type, company_id)
are kept deliberately minimal — no email or name, so no PII sits in a token
that can't be revoked early — so building the rest of AuthenticatedAccount
does cost one lookup against whichever table account_type points at. That
lookup is also what keeps onboarding_completed live instead of stuck at
whatever it was when the token was issued.

A separate module rather than living in app/routers/auth.py: every future
router (jobs, applications, ...) will depend on this, and importing it
shouldn't also import auth's route registrations.
"""

import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models.profiles import Applicant_Profile, Company_Membership
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.security import SESSION_COOKIE_NAME, decode_access_token

# One instance, one message: whether the cookie is missing, the token is
# malformed, it's expired, or the account it names is gone, the caller gets
# the same 401 — none of those distinctions are the client's business, and
# folding the branches keeps a future edit (adding a fifth rejection reason)
# from picking a different wording by accident.
_NOT_AUTHENTICATED = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated.")


async def get_current_account(
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> AuthenticatedAccount:
    """Resolves the session cookie into the account that owns it, or raises
    401. Every protected route depends on this rather than trusting anything
    the client sends — backend/CLAUDE.md: 'never trust a client-supplied
    company_id, profile_id or role.' `account_type` and `company_id` come
    only from claims this API itself signed, never from anything the client
    could edit; `sub` picks which row to load the rest from."""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token is None:
        raise _NOT_AUTHENTICATED

    try:
        claims = decode_access_token(token)
    except jwt.InvalidTokenError:
        raise _NOT_AUTHENTICATED

    account_type = AccountType(claims["account_type"])
    model = Applicant_Profile if account_type is AccountType.APPLICANT else Company_Membership
    account = (
        await db.execute(select(model).where(model.id == claims["sub"]))
    ).scalar_one_or_none()
    if account is None:
        raise _NOT_AUTHENTICATED

    return AuthenticatedAccount(
        id=account.id,
        email=account.email,
        full_name=account.full_name,
        account_type=account_type,
        onboarding_completed=account.onboarding_completed_at is not None,
        company_id=claims.get("company_id"),
    )

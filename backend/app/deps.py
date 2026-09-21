"""
Shared FastAPI dependencies. Currently just get_current_account — the
token-verification dependency backend/CLAUDE.md's Auth section requires:
"whoever acts on a token verifies its signature... this is our signing key
and our verification dependency — one place, used by every protected route."

There's no signature to check — sessions are opaque tokens, not JWTs, by the
Stage 2 decision in db/auth_implementation_log.md — so "verifying" means
hashing the cookie and looking it up in `sessions`, same primitive
app/routers/auth.py already uses to issue one.

A separate module rather than living in app/routers/auth.py: every future
router (jobs, applications, ...) will depend on this, and importing it
shouldn't also import auth's route registrations.
"""

from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models.profiles import Applicant_Profile, Company_Membership
from app.models.sessions import Session as SessionModel
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.security import SESSION_COOKIE_NAME, hash_session_token

# One instance, one message: whether the cookie is missing, the hash matches
# no row, or the row is expired, the caller gets the same 401 — none of those
# distinctions are the client's business, and folding the branches keeps a
# future edit (adding a fourth rejection reason) from picking a different
# wording by accident.
_NOT_AUTHENTICATED = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated.")


async def get_current_account(
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> AuthenticatedAccount:
    """Resolves the session cookie into the account that owns it, or raises
    401. Every protected route depends on this rather than trusting anything
    the client sends — backend/CLAUDE.md: 'never trust a client-supplied
    company_id, profile_id or role.' Everything on the returned
    AuthenticatedAccount, company_id included, comes only from what the
    token resolves to server-side."""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token is None:
        raise _NOT_AUTHENTICATED

    session_row = (
        await db.execute(select(SessionModel).where(SessionModel.token_hash == hash_session_token(token)))
    ).scalar_one_or_none()
    if session_row is None:
        raise _NOT_AUTHENTICATED

    if session_row.expires_at <= datetime.now(timezone.utc):
        # Delete rather than just reject, so an expired row doesn't sit
        # around to make the next request hit this same branch again.
        await db.execute(delete(SessionModel).where(SessionModel.id == session_row.id))
        await db.commit()
        raise _NOT_AUTHENTICATED

    if session_row.applicant_id is not None:
        account = await db.get(Applicant_Profile, session_row.applicant_id)
        account_type = AccountType.APPLICANT
        company_id = None
    else:
        account = await db.get(Company_Membership, session_row.company_membership_id)
        account_type = AccountType.COMPANY
        company_id = account.company_id if account is not None else None

    if account is None:
        # sessions.applicant_id / company_membership_id are ON DELETE CASCADE
        # (app/models/sessions.py), so a live session pointing at no account
        # shouldn't be reachable outside a race with the account being
        # deleted mid-request. Fail the same way as any other invalid
        # session rather than 500.
        raise _NOT_AUTHENTICATED

    return AuthenticatedAccount(
        id=account.id,
        email=account.email,
        full_name=account.full_name,
        account_type=account_type,
        onboarding_completed=account.onboarding_completed_at is not None,
        company_id=company_id,
    )

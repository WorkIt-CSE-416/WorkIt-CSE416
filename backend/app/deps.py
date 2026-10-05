"""
Shared FastAPI dependencies. get_current_account is the token-verification
dependency backend/CLAUDE.md's Auth section requires: "whoever acts on a token
verifies its signature... one place, used by every protected route."
get_company_member builds on it for company-scoped routes.

The token is a Supabase access token, sent as `Authorization: Bearer`. Its
`sub` is the auth.users id, which is also the profile row's primary key, and
`app_metadata.account_type` says which of the two account tables that row is
in. app_metadata is writable only with the service-role key (routers/auth.py
sets it at signup); user_metadata is writable by the user and is never read.

Everything else — email, name, onboarding state, company_id — comes from the
profile row, one lookup per request. That keeps the token free of anything
that could go stale between refreshes.

A separate module rather than living in app/routers/auth.py: every future
router (jobs, applications, ...) will depend on this, and importing it
shouldn't also import auth's route registrations.
"""

import uuid

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models.dto import profile_status
from app.models.profiles import Applicant_Profile, Company_Membership
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.security import decode_access_token


# One message: whether the header is missing, the token is malformed, it's
# expired, or the account it names is gone, the caller gets the same 401 —
# none of those distinctions are the client's business, and folding the
# branches keeps a future edit (adding a fifth rejection reason) from picking
# a different wording by accident.
#
# A function, not a shared instance: raising an exception object again appends
# that request's frames to its __traceback__, so a module-level one would keep
# every failed request's frames (session included) alive for good.
def _not_authenticated() -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated.")

# auto_error=False so a missing header lands on the same 401 as every other
# failure, instead of HTTPBearer's own 403 with a different message.
_bearer = HTTPBearer(auto_error=False)


async def get_current_account(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_session),
) -> AuthenticatedAccount:
    ''' 
    resolve bearer token to get account information
    '''
    if credentials is None:
        raise _not_authenticated()

    try:
        claims = await decode_access_token(credentials.credentials)
        account_type = AccountType(claims.get("app_metadata", {}).get("account_type"))
        account_id = uuid.UUID(claims["sub"])
    except (jwt.InvalidTokenError, ValueError):
        # ValueError: no account_type, one this API doesn't know, or a `sub`
        # that isn't a uuid. A user created outside /auth/signup (the
        # dashboard, say) has no account_type and no profile row either, so
        # this is the same "not an account here" as a bad token.
        raise _not_authenticated()

    # retrieve user from corresponding table 
    model = Applicant_Profile if account_type is AccountType.APPLICANT else Company_Membership
    account = (
        await db.execute(select(model).where(model.id == account_id))
    ).scalar_one_or_none()
    if account is None:
        raise _not_authenticated()

    return AuthenticatedAccount(
        id=account.id,
        email=account.email,
        full_name=account.full_name,
        account_type=account_type,
        onboarding_completed=account.onboarding_completed_at is not None,
        company_id=account.company_id if isinstance(account, Company_Membership) else None,
        membership_status=account.status if isinstance(account, Company_Membership) else None,
    )


def _not_a_company_member() -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, "Only active company members can do this.")


async def get_company_member(
    account: AuthenticatedAccount = Depends(get_current_account),
) -> AuthenticatedAccount:
    '''
    for company-scoped routes: the caller must be a company account whose
    membership is active. An invited or disabled member still holds a valid
    token, so get_current_account alone would let them through. The status
    comes from the row get_current_account already loaded, not a second query.
    '''
    if account.account_type is not AccountType.COMPANY:
        raise _not_a_company_member()
    if account.membership_status != profile_status.active:
        raise _not_a_company_member()

    return account

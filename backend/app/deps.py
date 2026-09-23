"""
Shared FastAPI dependencies. Currently just get_current_account — the
token-verification dependency backend/CLAUDE.md's Auth section requires:
"whoever acts on a token verifies its signature... this is our signing key
and our verification dependency — one place, used by every protected route."

Verifying means checking the JWT's signature and expiry (app/security.py's
decode_access_token), then building the response straight from its claims —
no database call. See security.py's own docstring for what that trades away
(no early revocation, claims fixed at issue time).

A separate module rather than living in app/routers/auth.py: every future
router (jobs, applications, ...) will depend on this, and importing it
shouldn't also import auth's route registrations.
"""

import jwt
from fastapi import HTTPException, Request, status

from app.schemas.auth import AccountType, AuthenticatedAccount
from app.security import SESSION_COOKIE_NAME, decode_access_token

# One instance, one message: whether the cookie is missing, the token is
# malformed, or it's expired, the caller gets the same 401 — none of those
# distinctions are the client's business, and folding the branches keeps a
# future edit (adding a fourth rejection reason) from picking a different
# wording by accident.
_NOT_AUTHENTICATED = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated.")


async def get_current_account(request: Request) -> AuthenticatedAccount:
    """Resolves the session cookie into the account that owns it, or raises
    401. Every protected route depends on this rather than trusting anything
    the client sends — backend/CLAUDE.md: 'never trust a client-supplied
    company_id, profile_id or role.' Everything on the returned
    AuthenticatedAccount, company_id included, comes only from claims this
    API itself signed, never from anything the client could edit."""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token is None:
        raise _NOT_AUTHENTICATED

    try:
        claims = decode_access_token(token)
    except jwt.InvalidTokenError:
        raise _NOT_AUTHENTICATED

    return AuthenticatedAccount(
        id=claims["sub"],
        email=claims["email"],
        full_name=claims["full_name"],
        account_type=AccountType(claims["account_type"]),
        onboarding_completed=claims["onboarding_completed"],
        company_id=claims.get("company_id"),
    )

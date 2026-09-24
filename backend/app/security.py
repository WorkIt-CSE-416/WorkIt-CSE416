"""
Password hashing and access tokens. Argon2id via argon2-cffi for passwords —
a vetted KDF, never hand-rolled. Tokens are signed JWTs (PyJWT, HS256), not
an opaque value backed by a database-side sessions table — verifying one is
a signature check, not a DB round trip, and issuing one is a pure function
of the account's own fields, nothing written anywhere. See backend/CLAUDE.md's
Auth section for why this API owns both at all.

Trade-off that comes with dropping the sessions table, worth knowing before
touching this file again: a JWT can't be revoked early. There's no row to
delete, so logout can only clear the cookie client-side — a token that's
already out there stays valid until it expires. And the claims below are
fixed at issue time, so `onboarding_completed` can go stale until the next
login/signup re-issues a token.
"""

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHash, VerificationError, VerifyMismatchError

from app.config import get_settings

# One hasher, module-level: it holds the cost parameters (time/memory/parallelism),
# and constructing it per call would re-read those defaults every time for no reason.
_hasher = PasswordHasher()


async def hash_password(password: str) -> str:
    """Encodes algorithm + parameters + salt + hash into one string — the
    whole value is what `password_hash` stores. Never store the raw password.

    Async even though it does no I/O: argon2 is deliberately slow and
    `_hasher.hash()` itself is a blocking, synchronous call. Calling it
    directly from an async route would freeze the whole event loop — every
    other concurrent request — for the duration of one hash.
    `asyncio.to_thread` runs it on a worker thread instead, so the loop stays
    free to handle other requests while this one hashes."""
    return await asyncio.to_thread(_hasher.hash, password)


async def verify_password(password: str, password_hash: str) -> bool:
    """True only if `password` is the one `password_hash` was made from.

    Catches the three ways argon2-cffi reports "no": a wrong password
    (VerifyMismatchError), a hash argon2 can't process at all — corrupt or
    truncated (VerificationError), and a string that isn't a valid argon2
    hash to begin with (InvalidHash). Anything else propagates, since that
    would be a real bug rather than "this login attempt failed."

    Async for the same reason as hash_password() — `_hasher.verify()` does
    the same blocking KDF work, just in the other direction.
    """
    try:
        await asyncio.to_thread(_hasher.verify, password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHash):
        return False
    return True


def needs_rehash(password_hash: str) -> bool:
    """True if `password_hash` was made with weaker parameters than
    `_hasher`'s current ones. Call after a successful verify_password() and
    re-hash+save if true — the only time a plaintext password is on hand to
    do it with. Lets the cost parameters be tuned up later without a mass
    password reset."""
    return _hasher.check_needs_rehash(password_hash)


ACCESS_TOKEN_TTL = timedelta(days=7)
"""How long an access token is valid before its owner has to log in again.
Fixed rather than configurable — there's no "remember me" control on the
login screen yet, so a per-request choice has nothing to read it from."""

SESSION_COOKIE_NAME = "session_token"
"""Name of the httpOnly cookie carrying create_access_token()'s output. One
constant so the name can't drift between whatever sets it (the signup/login
routes) and whatever reads it (app/deps.py's get_current_account). Kept as
"session_token" rather than renamed to "access_token" — the frontend already
hardcodes this exact string (frontend/src/lib/auth.ts), and the two halves
share no code to keep that in sync automatically."""

_JWT_ALGORITHM = "HS256"


def create_access_token(claims: dict[str, Any]) -> str:
    """Signs `claims` into a JWT, adding `iat`/`exp`. No I/O — a token is a
    pure function of what the caller passes in, unlike the old sessions-table
    design where issuing one meant an INSERT. Whatever's in `claims` (email,
    account_type, onboarding_completed, ...) is what get_current_account will
    see on every later request without touching the database again, so pass
    everything a protected route might need."""
    now = datetime.now(UTC)
    payload = {**claims, "iat": now, "exp": now + ACCESS_TOKEN_TTL}
    return jwt.encode(payload, get_settings().jwt_signing_key, algorithm=_JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """Verifies `token`'s signature and expiry, returns its claims. Raises
    `jwt.InvalidTokenError` (or a subclass — `jwt.ExpiredSignatureError` for
    an expired one) on anything wrong; callers turn that into a 401 rather
    than catching specific subclasses, since none of the ways a token can be
    invalid are the caller's business to distinguish."""
    return jwt.decode(token, get_settings().jwt_signing_key, algorithms=[_JWT_ALGORITHM])

"""
Password hashing and session tokens. Argon2id via argon2-cffi for passwords —
a vetted KDF, never hand-rolled — and secrets/hashlib for session tokens, a
different problem with a different right tool (see the note on
hash_session_token). See backend/CLAUDE.md's Auth section for why this API
owns both at all.
"""

import hashlib
import secrets
from datetime import timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHash, VerificationError, VerifyMismatchError

# One hasher, module-level: it holds the cost parameters (time/memory/parallelism),
# and constructing it per call would re-read those defaults every time for no reason.
_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    """Encodes algorithm + parameters + salt + hash into one string — the
    whole value is what `password_hash` stores. Never store the raw password."""
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """True only if `password` is the one `password_hash` was made from.

    Catches the three ways argon2-cffi reports "no": a wrong password
    (VerifyMismatchError), a hash argon2 can't process at all — corrupt or
    truncated (VerificationError), and a string that isn't a valid argon2
    hash to begin with (InvalidHash). Anything else propagates, since that
    would be a real bug rather than "this login attempt failed."
    """
    try:
        _hasher.verify(password_hash, password)
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


DUMMY_PASSWORD_HASH = hash_password(secrets.token_hex(32))
"""A valid argon2 hash of a value nobody will ever type, computed once at
import time. Login should run verify_password() against this when no account
matches the submitted email, so "no such email" and "wrong password" cost the
same CPU time — otherwise the faster response on a nonexistent email lets an
attacker enumerate registered addresses one timing sample at a time."""


SESSION_TTL = timedelta(days=30)
"""How long a session cookie is valid before its owner has to log in again.
Fixed rather than configurable — there's no "remember me" control on the
login screen yet, so a per-request choice has nothing to read it from."""

SESSION_COOKIE_NAME = "session_token"
"""Name of the httpOnly cookie carrying generate_session_token()'s output.
One constant so the name can't drift between whatever sets it (the signup/
login routes) and whatever will read it (the Stage 7 verification dependency)."""


def generate_session_token() -> str:
    """A high-entropy, URL-safe random value — this, not a hash of it, is
    what goes in the browser's httpOnly cookie. 32 bytes (256 bits) of
    randomness, well beyond brute-force range."""
    return secrets.token_urlsafe(32)


def hash_session_token(token: str) -> str:
    """SHA-256, not argon2. argon2 is deliberately slow to make guessing a
    *low-entropy* human password expensive; a session token is already 256
    bits of randomness with nothing to guess, so a slow KDF here only adds
    latency to every authenticated request for no security benefit. Hex
    digest is 64 characters, matching `sessions.token_hash`'s column."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# # if __name__ == "__main__":
#     # ponytail: the one runnable check for this module's branches.
# h = hash_password("correct horse battery staple")
# assert verify_password("correct horse battery staple", h), "right password must verify"
# assert not verify_password("wrong password", h), "wrong password must not verify"
# assert not verify_password("correct horse battery staple", "not-a-real-hash"), (
#         "a malformed hash must fail closed, not raise"
#     )
# assert not needs_rehash(h), "a hash just made with current params needs no rehash"

# t1, t2 = generate_session_token(), generate_session_token()
# assert t1 != t2, "two generated tokens must not collide"
# assert hash_session_token(t1) == hash_session_token(t1), "hashing must be deterministic"
# assert len(hash_session_token(t1)) == 64, "sha256 hex digest is always 64 chars"

# print("app/security.py: all checks passed")

"""
Verifying Supabase access tokens. Supabase Auth owns passwords and issues the
tokens (see backend/CLAUDE.md's Auth section); this API never hashes a
password or signs a token, it only checks the ones Supabase signed.

Two signing schemes exist on Supabase and a project is on one of them:

- Asymmetric signing keys (ES256/RS256), the default for new projects. The
  public keys are published as a JWKS; PyJWKClient fetches it once and caches
  it, so verifying a token is a local signature check, not a network call.
- The legacy shared secret (HS256). Set SUPABASE_JWT_SECRET for this one.

The token's `alg` header picks which path runs, but each path only accepts
its own algorithms — so a token can't talk its way from one to the other
(the classic "alg confusion" attack signs an HS256 token with a public key).
"""

import asyncio
from functools import lru_cache
from typing import Any

import jwt

from app.config import get_settings

_ASYMMETRIC_ALGORITHMS = ["ES256", "RS256"]
_LEGACY_ALGORITHM = "HS256"

# Every signed-in user's token carries this audience. An anon-key JWT carries
# none, so checking it keeps a bare anon key from passing as a session.
_AUDIENCE = "authenticated"


@lru_cache
def _jwks_client() -> jwt.PyJWKClient:
    """One client per process, so the fetched keys are cached across
    requests. PyJWKClient refetches on its own when it meets a `kid` it hasn't
    seen, which is what makes a key rotation in the dashboard just work."""
    url = f"{get_settings().supabase_auth_url}/.well-known/jwks.json"
    return jwt.PyJWKClient(url, cache_keys=True)


async def decode_access_token(token: str) -> dict[str, Any]:
    """Verifies `token`'s signature, audience, issuer and expiry, and returns
    its claims. Raises `jwt.InvalidTokenError` (or a subclass) on anything
    wrong; callers turn that into a 401 rather than telling the reasons apart.

    Async because the first call — and any call carrying an unknown `kid` —
    fetches the JWKS over blocking urllib. `asyncio.to_thread` keeps that off
    the event loop, the same reason Storage uploads use it."""
    settings = get_settings()
    options = {"require": ["exp", "sub", "aud", "iss"]}
    issuer = settings.supabase_auth_url

    if jwt.get_unverified_header(token).get("alg") == _LEGACY_ALGORITHM:
        if not settings.supabase_jwt_secret:
            raise jwt.InvalidTokenError("HS256 token but SUPABASE_JWT_SECRET is not set")
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=[_LEGACY_ALGORITHM],
            audience=_AUDIENCE,
            issuer=issuer,
            options=options,
        )

    try:
        signing_key = await asyncio.to_thread(_jwks_client().get_signing_key_from_jwt, token)
    except jwt.PyJWKClientError as exc:
        # Unknown kid, or the JWKS couldn't be fetched. Either way this token
        # can't be verified, which is an invalid token to the caller.
        raise jwt.InvalidTokenError(str(exc)) from exc

    return jwt.decode(
        token,
        signing_key.key,
        algorithms=_ASYMMETRIC_ALGORITHMS,
        audience=_AUDIENCE,
        issuer=issuer,
        options=options,
    )

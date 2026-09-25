"""
Verifying Supabase access tokens. Supabase Auth owns passwords and issues the
tokens (see backend/CLAUDE.md's Auth section); this API never hashes a
password or signs a token, it only checks the ones Supabase signed.

The project signs with asymmetric keys (ES256, or RS256 if configured so):
Supabase holds the private key, and the public keys are published as a JWKS.
PyJWKClient fetches that once and caches it, so verifying a token is a local
signature check, not a network call — and this API holds no secret that
could mint a token.

Supabase's legacy shared-secret scheme (HS256) is deliberately unsupported.
The algorithm allow-list below never includes it, which also blocks the
"alg confusion" attack: an HS256 token signed using the public key as if it
were the secret.
"""

import asyncio
from functools import lru_cache
from typing import Any

import jwt

from app.config import get_settings

_ALGORITHMS = ["ES256", "RS256"]

# Every signed-in user's token carries this audience. An anon-key JWT carries
# none, so checking it keeps a bare anon key from passing as a session.
_AUDIENCE = "authenticated"


@lru_cache
def _jwks_client() -> jwt.PyJWKClient:
    # hardcode the path to supabase's token 
    url = f"{get_settings().supabase_auth_url}/.well-known/jwks.json"
    return jwt.PyJWKClient(url, cache_keys=True)


async def decode_access_token(token: str) -> dict[str, Any]:
    '''
    Verifies `token`'s signature, audience, issuer and expiry
    '''
    try:
        signing_key = await asyncio.to_thread(_jwks_client().get_signing_key_from_jwt, token)
    except jwt.PyJWKClientError as exc:
        # Unknown kid, or the JWKS couldn't be fetched. Either way this token
        # can't be verified, which is an invalid token to the caller.
        raise jwt.InvalidTokenError(str(exc)) from exc

    return jwt.decode(
        token,
        signing_key.key,
        algorithms=_ALGORITHMS,
        audience=_AUDIENCE,
        issuer=get_settings().supabase_auth_url,
        options={"require": ["exp", "sub", "aud", "iss"]},
    )

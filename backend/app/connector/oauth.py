"""
The connector's sign-in (KAN-377): WorkIt is the OAuth 2.1 authorization
server for the MCP clients a student connects, their own Claude. The MCP
SDK serves the endpoints (/authorize, /token, /register, /revoke and the
metadata, app/connector/server.py); this module is the provider they call,
keeping clients, sign-ins and tokens in Postgres (models/connector.py).

The student approves on the webapp's consent page (/connect/claude), signed
in with their normal Supabase session: /authorize sends the browser there
with a request id, and the page's Allow calls `approve` (routers/connector.py),
which gives the code back to Claude's redirect URI. Why WorkIt's own server
and not Supabase Auth's OAuth server: auto-apply/architecture.md, 14.2.

Tokens are random, not JWTs, and only their sha256 is stored. A connector
token reaches /mcp only: every other route still takes a Supabase session.
"""

import datetime
import hashlib
import secrets
import uuid

from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    RefreshToken,
    TokenError,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_sessionmaker
from app.models.connector import Connector_Client, Connector_Request, Connector_Token

# The one scope: read the student's next application, save its answers.
SCOPE = "applications"
REQUEST_TTL = datetime.timedelta(minutes=10)
ACCESS_TTL = datetime.timedelta(hours=1)
# A student connects once; Claude refreshes, rotating both tokens.
REFRESH_TTL = datetime.timedelta(days=90)


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)


class NotPending(Exception):
    """No sign-in waiting under that id: never made, answered or expired."""


class Provider:
    """The MCP SDK's OAuthAuthorizationServerProvider, on Postgres."""

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        async with get_sessionmaker()() as db:
            info = await db.scalar(select(Connector_Client.info).where(Connector_Client.client_id == client_id))
        return OAuthClientInformationFull.model_validate(info) if info else None

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        async with get_sessionmaker()() as db:
            db.add(Connector_Client(client_id=client_info.client_id, info=client_info.model_dump(mode="json")))
            await db.commit()

    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        """Keeps the sign-in and sends the browser to the consent page."""
        async with get_sessionmaker()() as db:
            # Sign-ins nobody finished go here, rather than on a schedule.
            await db.execute(delete(Connector_Request).where(Connector_Request.expires_at < _now()))
            request = Connector_Request(
                id=uuid.uuid4(), client_id=client.client_id,
                params=params.model_dump(mode="json"), expires_at=_now() + REQUEST_TTL,
            )
            db.add(request)
            await db.commit()
        return f"{get_settings().connector_web_url.rstrip('/')}/connect/claude?request={request.id}"

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        async with get_sessionmaker()() as db:
            request = await db.scalar(select(Connector_Request).where(
                Connector_Request.code_hash == _hash(authorization_code),
                Connector_Request.client_id == client.client_id,
            ))
        if request is None or request.applicant_id is None:
            return None
        params = AuthorizationParams.model_validate(request.params)
        return AuthorizationCode(
            code=authorization_code, scopes=params.scopes or [SCOPE], expires_at=request.expires_at.timestamp(),
            client_id=client.client_id, code_challenge=params.code_challenge, redirect_uri=params.redirect_uri,
            redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
            resource=params.resource, subject=str(request.applicant_id),
        )

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        async with get_sessionmaker()() as db:
            # A code is used once: its sign-in goes with it.
            used = await db.scalar(
                delete(Connector_Request)
                .where(Connector_Request.code_hash == _hash(authorization_code.code))
                .returning(Connector_Request.id)
            )
            if used is None:
                raise TokenError(error="invalid_grant", error_description="The code was already used.")
            token = await _give_tokens(
                db, client.client_id, uuid.UUID(authorization_code.subject),
                authorization_code.scopes, authorization_code.resource,
            )
            await db.commit()
        return token

    async def load_refresh_token(self, client: OAuthClientInformationFull, refresh_token: str) -> RefreshToken | None:
        row = await _live_token(refresh_token, "refresh")
        if row is None or row.client_id != client.client_id:
            return None
        return RefreshToken(
            token=refresh_token, client_id=row.client_id, scopes=row.scopes,
            expires_at=int(row.expires_at.timestamp()), resource=row.resource, subject=str(row.applicant_id),
        )

    async def exchange_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: RefreshToken, scopes: list[str]
    ) -> OAuthToken:
        async with get_sessionmaker()() as db:
            grant = await db.scalar(
                select(Connector_Token.grant_id).where(Connector_Token.token_hash == _hash(refresh_token.token))
            )
            await db.execute(delete(Connector_Token).where(Connector_Token.grant_id == grant))
            token = await _give_tokens(
                db, client.client_id, uuid.UUID(refresh_token.subject),
                scopes or refresh_token.scopes, refresh_token.resource,
            )
            await db.commit()
        return token

    async def load_access_token(self, token: str) -> AccessToken | None:
        row = await _live_token(token, "access")
        if row is None:
            return None
        return AccessToken(
            token=token, client_id=row.client_id, scopes=row.scopes,
            expires_at=int(row.expires_at.timestamp()), resource=row.resource, subject=str(row.applicant_id),
        )

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        async with get_sessionmaker()() as db:
            grant = await db.scalar(
                select(Connector_Token.grant_id).where(Connector_Token.token_hash == _hash(token.token))
            )
            if grant is not None:
                await db.execute(delete(Connector_Token).where(Connector_Token.grant_id == grant))
                await db.commit()

    async def exchange_identity_assertion(self, client, params) -> OAuthToken:
        raise TokenError(error="unsupported_grant_type", error_description="Not supported.")


async def _live_token(token: str, kind: str) -> Connector_Token | None:
    async with get_sessionmaker()() as db:
        return await db.scalar(select(Connector_Token).where(
            Connector_Token.token_hash == _hash(token),
            Connector_Token.kind == kind,
            Connector_Token.expires_at > _now(),
        ))


async def _give_tokens(
    db: AsyncSession, client_id: str, applicant_id: uuid.UUID, scopes: list[str], resource: str | None
) -> OAuthToken:
    """An access and a refresh token for one student, as one grant. Flushes."""
    grant = uuid.uuid4()
    access, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    for secret, kind, ttl in ((access, "access", ACCESS_TTL), (refresh, "refresh", REFRESH_TTL)):
        db.add(Connector_Token(
            token_hash=_hash(secret), kind=kind, grant_id=grant, client_id=client_id,
            applicant_id=applicant_id, scopes=scopes, resource=resource, expires_at=_now() + ttl,
        ))
    await db.flush()
    return OAuthToken(
        access_token=access, expires_in=int(ACCESS_TTL.total_seconds()),
        scope=" ".join(scopes), refresh_token=refresh,
    )


async def added(db: AsyncSession, applicant_id: uuid.UUID) -> bool:
    """Whether a client the student approved can still reach /mcp: it holds
    a refresh token that is neither expired nor revoked (revoking deletes it)."""
    return await db.scalar(select(Connector_Token.token_hash).where(
        Connector_Token.applicant_id == applicant_id,
        Connector_Token.kind == "refresh",
        Connector_Token.expires_at > _now(),
    ).limit(1)) is not None


# --- The consent page's side (routers/connector.py) ---


async def _pending(db: AsyncSession, request_id: uuid.UUID) -> Connector_Request:
    request = await db.scalar(select(Connector_Request).where(
        Connector_Request.id == request_id,
        Connector_Request.applicant_id.is_(None),
        Connector_Request.expires_at > _now(),
    ))
    if request is None:
        raise NotPending("That sign-in is over. Start again from Claude.")
    return request


async def client_name(db: AsyncSession, request_id: uuid.UUID) -> str:
    """Who asks, for the consent page: the name the client registered."""
    request = await _pending(db, request_id)
    info = await db.scalar(select(Connector_Client.info).where(Connector_Client.client_id == request.client_id))
    return (info or {}).get("client_name") or "An MCP client"


async def approve(db: AsyncSession, request_id: uuid.UUID, applicant_id: uuid.UUID) -> str:
    """The student allowed it: gives the sign-in a code and answers where
    the browser goes next, the client's redirect URI with the code."""
    request = await _pending(db, request_id)
    code = secrets.token_urlsafe(32)
    request.applicant_id = applicant_id
    request.code_hash = _hash(code)
    # The client has this long to trade the code.
    request.expires_at = _now() + datetime.timedelta(minutes=5)
    await db.commit()
    params = AuthorizationParams.model_validate(request.params)
    return construct_redirect_uri(str(params.redirect_uri), code=code, state=params.state)


async def deny(db: AsyncSession, request_id: uuid.UUID) -> str:
    """The student refused: the sign-in goes, and the client hears why."""
    request = await _pending(db, request_id)
    params = AuthorizationParams.model_validate(request.params)
    await db.delete(request)
    await db.commit()
    return construct_redirect_uri(str(params.redirect_uri), error="access_denied", state=params.state)

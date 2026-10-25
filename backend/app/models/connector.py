'''
the connector's sign-in (KAN-377): WorkIt is the OAuth authorization server
for the MCP clients a student connects (their Claude), so it keeps the
clients that registered, the sign-ins waiting on the student's consent, and
the tokens it gave out. app/connector/oauth.py is the one writer.
ex: Claude registered as client c1; Sam approved it; c1 holds Sam's token
'''
import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Connector_Client(Base):
    '''
    an MCP client that registered itself (OAuth dynamic client registration,
    RFC 7591): `info` is its registration as the MCP SDK shapes it, the
    redirect URIs and its secret included
    '''
    __tablename__ = "connector_clients"
    client_id: Mapped[str] = mapped_column(Text, primary_key=True)
    info: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())


class Connector_Request(Base):
    '''
    one sign-in, from /authorize until the client trades its code: what the
    client asked for (`params`: redirect URI, PKCE challenge, state, scopes),
    then who approved it and the hash of the code given out. Deleted when
    the code is used, or refused once it expires.
    '''
    __tablename__ = "connector_requests"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    client_id: Mapped[str] = mapped_column(
        ForeignKey("connector_clients.client_id", ondelete="CASCADE"))
    params: Mapped[dict] = mapped_column(JSONB)
    # NULL until the student approves it on the consent page
    applicant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"))
    code_hash: Mapped[str | None] = mapped_column(Text, unique=True)
    expires_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))


class Connector_Token(Base):
    '''
    a token given to a client for one student: only its sha256 is kept, so a
    leaked table signs no one in. An access and a refresh token given
    together share `grant_id`, and revoking one revokes both.
    '''
    __tablename__ = "connector_tokens"
    token_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    kind: Mapped[str] = mapped_column(Text)  # "access" or "refresh"
    grant_id: Mapped[uuid.UUID] = mapped_column(index=True)
    client_id: Mapped[str] = mapped_column(
        ForeignKey("connector_clients.client_id", ondelete="CASCADE"))
    applicant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"), index=True)
    scopes: Mapped[list[str]] = mapped_column(ARRAY(Text))
    resource: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())

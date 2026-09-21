'''
session tokens for authenticated logins — the opaque-token half of the
password + session design decided in db/auth_methodology.md.
'''
import datetime
import uuid

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import BaseModel


class Session(BaseModel):
    '''
    One row per logged-in session. The opaque token handed to the browser (in
    an httpOnly cookie) is never stored here — only its SHA-256 hash, so a
    read of this table alone can't be replayed as a valid session. Same
    reason passwords are hashed rather than stored plain; see app/security.py.

    Exactly one of applicant_id / company_membership_id is set, mirroring
    Profile's own split in profiles.py: there is no shared identity table, so
    a session belongs to one specific account table, not to an "account" in
    the abstract. Both are nullable and CASCADE on delete, so removing an
    account removes its sessions without a separate cleanup step.
    '''
    __tablename__ = "sessions"
    __table_args__ = (
        CheckConstraint(
            "(applicant_id IS NOT NULL) <> (company_membership_id IS NOT NULL)",
            name="sessions_exactly_one_account",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # SHA-256 hex digest of the token, never the token itself — see
    # app/security.py's hash_session_token(). 64 chars, matching a hex digest
    # exactly, not rounded up for headroom the way password_hash's 255 is.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)

    applicant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"), index=True
    )
    company_membership_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("company_memberships.id", ondelete="CASCADE"), index=True
    )

    expires_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))

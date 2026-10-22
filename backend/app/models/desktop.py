'''
WorkIt Desktop's heartbeat (KAN-323, auto-apply/desktop.md): the app on the
student's own computer that claims, fills and submits their applications.
ex: applicant 7's Desktop was last seen 10 s ago with 4 Workers, 2 busy
'''
import datetime
import uuid

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, false, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Desktop_Heartbeat(Base):
    '''
    one row per applicant, overwritten by every heartbeat (every 15 s). Online
    means a beat in the last 45 s; a claim sends a `filling` application back
    to `queued` once its Desktop has been silent 10 minutes
    (auto_apply/queries.py, requeue_stale). One row rather than a log: only
    the latest beat is ever read.
    '''
    __tablename__ = "desktop_heartbeats"
    applicant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"), primary_key=True
    )
    workers: Mapped[int]
    busy: Mapped[int]
    # The student's Claude usage, {"five_hour": 0.4, "weekly": 0.1}; NULL
    # when Desktop could not read it.
    usage: Mapped[dict | None] = mapped_column(JSONB)
    version: Mapped[str]
    # The running Desktop, new each time it starts; NULL from a Desktop too old to send one.
    instance: Mapped[uuid.UUID | None]
    # Desktop takes nothing new (near the Claude plan limit), and why.
    paused: Mapped[bool] = mapped_column(server_default=false())
    paused_reason: Mapped[str | None]
    # The database's clock, never Desktop's: online and stale compare it to now().
    last_seen: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "workers >= 0 AND busy >= 0 AND busy <= workers",
            name="desktop_heartbeats_counts",
        ),
    )

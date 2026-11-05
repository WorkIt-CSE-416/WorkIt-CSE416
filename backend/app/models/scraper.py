"""SQLAlchemy models for the backend-owned scraper worker.

Three tables: scraper_schedules (board catalog), scraper_tasks (per-board work
items with leases), job_sources (which boards list which jobs, for two-read
closure detection). The worker uses these to checkpoint per board, track source
relationships, and recover from interruption.
"""

import datetime
import uuid

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, BaseModel


class Scraper_Schedule(BaseModel):
    """Board catalog with read history and health. One row per (ats, token)."""

    __tablename__ = "scraper_schedules"
    __table_args__ = (UniqueConstraint("ats", "token"),)

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    ats: Mapped[str] = mapped_column(Text)
    token: Mapped[str] = mapped_column(Text)
    company: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true")
    )
    last_read_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    prior_read_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    missing_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    consecutive_failures: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0")
    )
    rest_until: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True)
    )


class Scraper_Task(Base):
    """Per-board work item with a lease. No updated_at: tasks are short-lived."""

    __tablename__ = "scraper_tasks"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    schedule_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("scraper_schedules.id", ondelete="CASCADE"),
        index=True,
    )
    status: Mapped[str] = mapped_column(
        Text, default="pending", server_default=text("'pending'")
    )
    claimed_by: Mapped[str | None] = mapped_column(Text)
    claimed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    lease_expires_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    started_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    finished_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    boards_s: Mapped[float | None] = mapped_column(Float)
    pages_s: Mapped[float | None] = mapped_column(Float)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
    )


class Job_Source(Base):
    """Which boards list which jobs. One row per (schedule, apply_url).

    The two-read closure rule: a job whose last_seen_at < its board's
    prior_read_at was missing from the last two complete reads of that board.
    When every enabled board that ever listed a job reports it stale, and no
    other enabled board still supports it, the job closes.

    CASCADE on schedule_id: deleting a schedule drops its source rows, so
    detect_and_close can no longer see that the board ever listed those jobs.
    Accepted: a deleted schedule is a disabled board removed from the catalog,
    and its votes should stop counting.  If a board must stop voting without
    losing history, disable it (enabled=False) instead of deleting it.
    """

    __tablename__ = "job_sources"
    __table_args__ = (UniqueConstraint("schedule_id", "apply_url"),)

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    schedule_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("scraper_schedules.id", ondelete="CASCADE"),
    )
    apply_url: Mapped[str] = mapped_column(Text, index=True)
    first_seen_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
    )
    last_seen_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
    )

"""SQLAlchemy models for the backend-owned scraper worker.

Three tables: scraper_schedules (board catalog), scraper_tasks (per-board work
items with leases), scraper_observations (per-posting versioned state). The
worker uses these to checkpoint per board and recover from interruption.
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
from sqlalchemy.dialects.postgresql import JSONB
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


class Scraper_Observation(BaseModel):
    """Per-posting versioned state. One row per (schedule_id, external_id)."""

    __tablename__ = "scraper_observations"
    __table_args__ = (UniqueConstraint("schedule_id", "external_id"),)

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    schedule_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("scraper_schedules.id", ondelete="CASCADE"),
        index=True,
    )
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("scraper_tasks.id", ondelete="SET NULL"),
    )
    external_id: Mapped[str] = mapped_column(Text)
    apply_url: Mapped[str] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(Text)
    company: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    posted_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    first_seen_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    page_version: Mapped[int | None] = mapped_column(Integer)
    facts: Mapped[dict | None] = mapped_column(JSONB)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)

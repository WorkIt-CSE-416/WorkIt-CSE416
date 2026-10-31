import datetime
import uuid

from sqlalchemy import DateTime, Index, Integer, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Fill_Event(Base):
    """
    One fill's numbers (KAN-476, decided in KAN-454): what the extension
    sends after every fill, single or batch, so the team sees how often each
    job system fills. The job system, the engine's and the extension's
    versions, how many fields the fill had and how many were filled, guessed,
    left needing the student and failed, the failed fields' error names with
    a count each, and how long the fill took. Never a field's value, an
    answer, the posting's link or the account (the daily cap per account
    counts in daily_counts, services/daily_caps.py). Kept 90 days
    (services/retention.py RETENTION, KAN-482's daily purge). Shape checked
    in app/schemas/fill_events.py.
    """

    __tablename__ = "fill_events"
    __table_args__ = (Index("ix_fill_events_created_at", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())
    job_system: Mapped[str] = mapped_column(String(24))
    engine_version: Mapped[str] = mapped_column(String(64))
    extension_version: Mapped[str] = mapped_column(String(32))
    # "single" (the panel's Autofill on a page) or "batch" (one of batch apply's tabs).
    mode: Mapped[str] = mapped_column(String(8))
    fields: Mapped[int] = mapped_column(Integer)
    filled: Mapped[int] = mapped_column(Integer)
    guessed: Mapped[int] = mapped_column(Integer)
    needs_you: Mapped[int] = mapped_column(Integer)
    failed: Mapped[int] = mapped_column(Integer)
    # {"Readback": 2, "FillError": 1}: the failed fields' error names (schemas' ErrorName), a count each.
    errors: Mapped[dict] = mapped_column(JSONB)
    duration_ms: Mapped[int] = mapped_column(Integer)

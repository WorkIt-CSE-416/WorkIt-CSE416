import datetime
import uuid

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, deferred, mapped_column

from app.db import Base


class Fill_Report(Base):
    """
    A problem report a student sent from the extension's panel (KAN-403,
    KAN-369's fix reports): the job system, the posting's public link, the
    Fill engine's version, each field's structure and what the fill did with
    it (never its value), the fill's timeline, the form's HTML with every
    value taken out in the student's browser, and their note. It names the
    student who sent it (they list their own; it goes with their account).
    The team triages it (status, admin_note) and exports it as a fix brief
    for a coding agent (app/services/fill_brief.py). Shape checked in
    app/schemas/fill_reports.py.
    """

    __tablename__ = "fill_reports"
    __table_args__ = (
        CheckConstraint("status IN ('new', 'triaged', 'fixed')", name="fill_reports_status_check"),
        Index("ix_fill_reports_created_at", text("created_at DESC")),
        Index("ix_fill_reports_account_id", "account_id"),
        Index("ix_fill_reports_signature", "signature"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())
    # Null on reports sent before KAN-369's fix reports, which named no one.
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE", name="fill_reports_account_id_fkey"))
    job_system: Mapped[str] = mapped_column(String(24))
    posting_url: Mapped[str] = mapped_column(Text)
    engine_version: Mapped[str] = mapped_column(String(64))
    # The report's group, "<job system>:<field kind>:<error>" (schemas' signature_of, KAN-478).
    signature: Mapped[str] = mapped_column(String(80))
    # [{"kind", "label_shape", "error", ...FillReportField's other parts}], as the panel previewed them.
    fields: Mapped[list] = mapped_column(JSONB)
    note: Mapped[str | None] = mapped_column(Text)
    # What opened the card: menu, error, readback, edited, row (schemas' Trigger).
    trigger: Mapped[str | None] = mapped_column(String(16))
    context: Mapped[dict | None] = mapped_column(JSONB)
    timeline: Mapped[list | None] = mapped_column(JSONB)
    # Up to half a megabyte: loaded only when a query asks for it.
    html: Mapped[str | None] = deferred(mapped_column(Text))
    status: Mapped[str] = mapped_column(String(16), server_default="new")
    admin_note: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    # When an admin alert named this report's group (app/services/fill_report_alerts.py, KAN-478).
    alerted_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))

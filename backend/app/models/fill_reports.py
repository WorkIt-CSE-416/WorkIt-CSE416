import datetime
import uuid

from sqlalchemy import DateTime, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Fill_Report(Base):
    """
    A problem report a student sent from the extension's panel (KAN-403):
    the job system, the posting's public link, the Fill engine's version,
    each failed field's kind, label shape and error name, and their note.
    No account, answer or page text: it feeds the team's engine repair loop
    (research: repair-feasibility, design b). Shape checked in
    app/schemas/fill_reports.py.
    """

    __tablename__ = "fill_reports"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())
    job_system: Mapped[str] = mapped_column(String(24))
    posting_url: Mapped[str] = mapped_column(Text)
    engine_version: Mapped[str] = mapped_column(String(64))
    # [{"kind", "label_shape", "error"}], as the panel previewed them.
    fields: Mapped[list] = mapped_column(JSONB)
    note: Mapped[str | None] = mapped_column(Text)

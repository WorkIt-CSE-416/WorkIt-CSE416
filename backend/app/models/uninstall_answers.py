import datetime
import uuid

from sqlalchemy import CheckConstraint, DateTime, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# The survey's choices, as the webapp's /uninstalled page offers them (KAN-471).
UNINSTALL_REASONS = ("bad_fills", "missing_sites", "found_job", "other_tool", "privacy", "other")


class Uninstall_Answer(Base):
    """
    One answer to the uninstall survey (KAN-471): why a student removed the
    extension, an optional line of their own, and the version removed. No
    account, address or browser: the page asks no sign-in, and the cap on
    senders is kept in memory (app/routers/uninstall_answers.py), never here.
    The team counts rows by reason.
    """

    __tablename__ = "uninstall_answers"
    __table_args__ = (
        CheckConstraint(
            "reason IN (" + ", ".join(f"'{r}'" for r in UNINSTALL_REASONS) + ")",
            name="uninstall_answers_reason_check",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    # Indexed for the per-day cap's count.
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True)
    reason: Mapped[str] = mapped_column(String(32))
    detail: Mapped[str | None] = mapped_column(String(500))
    extension_version: Mapped[str | None] = mapped_column(String(32))

"""
What WorkIt's notice emails need to remember (KAN-483), written only by
app/services/notices.py:

- `email_sends`: one row per address a notice reached, keyed by the
  notice's own name (`campaign`), so a re-run of the same broadcast skips
  every address already in it. A row is written before the send and
  removed if SES refuses it, so a run that dies mid-send never mails that
  address twice.
- `email_suppressions`: addresses that bounced or complained, copied from
  SES's account suppression list. No notice or job alert goes to one.
"""
import datetime

from sqlalchemy import DateTime, Identity, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Email_Send(Base):
    __tablename__ = "email_sends"
    __table_args__ = (UniqueConstraint("campaign", "email", name="email_sends_campaign_email_key"),)

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    campaign: Mapped[str] = mapped_column(String(100))
    # Lowercased: the same person typed two ways is one address.
    email: Mapped[str] = mapped_column(String(320))
    sent_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Email_Suppression(Base):
    __tablename__ = "email_suppressions"

    email: Mapped[str] = mapped_column(String(320), primary_key=True)
    # SES's own reason: BOUNCE or COMPLAINT.
    reason: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

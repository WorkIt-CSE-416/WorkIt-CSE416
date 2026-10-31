import datetime
import uuid

from sqlalchemy import Date, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Daily_Count(Base):
    """
    How many writes of one kind (a fix report, a job system request) one
    account made on one UTC day, for the per-account daily caps
    (app/services/daily_caps.py, KAN-478). Goes with the account.
    """

    __tablename__ = "daily_counts"

    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE"), primary_key=True)
    kind: Mapped[str] = mapped_column(String(24), primary_key=True)
    day: Mapped[datetime.date] = mapped_column(Date, primary_key=True)
    count: Mapped[int]

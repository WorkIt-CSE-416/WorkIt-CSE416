import datetime
import uuid

from sqlalchemy import BigInteger, Date, ForeignKey, Identity, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AI_Usage_Counter(Base):
    """
    How many times one account, or the global pool, used one AI feature on
    one UTC day. A NULL account_id is the pool row: every student's uses of
    that feature that day. app/services/usage.py reads and writes these.
    """

    __tablename__ = "ai_usage_counters"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE")
    )
    feature: Mapped[str] = mapped_column(String(16))
    day: Mapped[datetime.date] = mapped_column(Date)
    count: Mapped[int]

    # NULLS NOT DISTINCT: the pool row (account_id NULL) is one row per
    # feature and day too, so the upsert's ON CONFLICT finds it.
    __table_args__ = (
        UniqueConstraint(
            "account_id", "feature", "day", postgresql_nulls_not_distinct=True
        ),
    )

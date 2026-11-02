import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Disabled_Job_System(Base):
    """
    A job system WorkIt has turned off (KAN-467): its handler broke on the
    job system's new markup, and a fix waits on a Chrome Web Store review.
    One row per job system, by the Fill engine's id ("workday"; hosts.py
    JOB_SYSTEMS); no row, it is on. The extension stops filling it (GET
    /extension/config) and no batch or Auto Apply click queues its postings.
    Only WorkIt's admins add or remove a row (routers/extension_config.py).
    """

    __tablename__ = "disabled_job_systems"

    job_system: Mapped[str] = mapped_column(String(24), primary_key=True)
    disabled_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())
    # The admin who turned it off, by sign-in email.
    disabled_by: Mapped[str] = mapped_column(String(320))

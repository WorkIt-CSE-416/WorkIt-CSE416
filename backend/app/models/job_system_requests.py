import datetime
import uuid

from sqlalchemy import DateTime, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Job_System_Request(Base):
    """
    One press of the extension popup's Request this job system (KAN-369), on
    a job page WorkIt can't fill: the page's host and when. No account, link,
    page text or answer. The team counts rows by host to pick the next job
    systems to build (research: SYSTEMS-gap, proposal 7). Shape checked in
    app/schemas/job_system_requests.py.
    """

    __tablename__ = "job_system_requests"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())
    host: Mapped[str] = mapped_column(String(253), index=True)

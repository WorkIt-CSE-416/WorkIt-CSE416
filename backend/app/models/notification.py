'''
a notification the student sees in the top bar's bell (KAN-298) -- one row
per digest, not per job: a day's ten best-matching jobs are one entry
("Your 10 Best Matches Today"), never ten rows flooding the bell.
`app/services/job_alerts.py` is the only writer; `routers/notifications.py`
reads and marks them read. models/CLAUDE.md, "notifications", has the design.
'''
import datetime
import uuid

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import BaseModel


class Notification(BaseModel):
    '''
    one notification for one applicant. `data` holds the digest's own jobs
    ({"job_id", "title", "company", "match"} per entry), so the bell renders
    each as a link with no second query. `read_at` is null until the
    applicant opens the bell (routers/notifications.py marks every unread
    row read at once, matching the bell's own "You're All Caught Up" copy).
    '''
    __tablename__ = "notifications"
    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    applicant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"), index=True
    )
    # A free column, not an enum: a second notification type later needs no
    # migration, same reasoning autofill_answers' JSONB bank already gives
    # (models/CLAUDE.md).
    type: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(100))
    body: Mapped[str] = mapped_column(String(200))
    data: Mapped[list] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    read_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        # A reader indexes into it by position; an object here would answer
        # nothing where a list of jobs is expected.
        CheckConstraint("jsonb_typeof(data) = 'array'", name="notifications_data_array"),
    )

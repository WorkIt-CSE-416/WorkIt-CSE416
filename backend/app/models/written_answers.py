'''
the questions a batch apply tab's form needs written, and the answer the
student's own Claude saved for each through the connector (KAN-377)
ex: applicant 7's application to job 3 asks "Why Acme?" (question_7); their
Claude saved an answer, which the open tab filled
'''
import datetime
import uuid

from sqlalchemy import DateTime, ForeignKeyConstraint, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import BaseModel


class Written_Answer(BaseModel):
    '''
    one row per question an application's form needs written. The extension
    writes the question when its tab plans the form; the connector's save
    writes the answer. A row per question, not JSONB on the application: the
    connector reads "the oldest application with a question left" in SQL,
    and an answer saves without rewriting the others.
    '''
    __tablename__ = "written_answers"
    applicant_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    job_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    # the form field's name, as the Fill engine's Question set has it: what
    # the tab fills the answer into
    name: Mapped[str] = mapped_column(Text, primary_key=True)
    label: Mapped[str] = mapped_column(Text)
    required: Mapped[bool]
    # its place on the form, so the connector and the tab read them in order
    position: Mapped[int] = mapped_column(Integer)
    # the form's own limit in characters, when it has one
    max_length: Mapped[int | None] = mapped_column(Integer)
    # NULL until the student's Claude saves one
    answer: Mapped[str | None] = mapped_column(Text)
    answered_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        # The application's questions go with it: dequeued, or the account deleted.
        ForeignKeyConstraint(
            ["applicant_id", "job_id"], ["job_applications.applicant_id", "job_applications.job_id"],
            ondelete="CASCADE", name="written_answers_application_fkey",
        ),
    )

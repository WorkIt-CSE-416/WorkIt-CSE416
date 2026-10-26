'''
the questions a batch apply tab's form needs written, and the answer the
student's own Claude saved for each through the connector (KAN-377)
ex: applicant 7's application to job 3 asks "Why Acme?" (question_7); their
Claude saved an answer, which the open tab filled
'''
import datetime
import uuid

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Integer,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, QueryableAttribute, mapped_column

from app.db import BaseModel


def is_text(kind):
    """Whether a written question of `kind` is asked in words (a text
    question): its kind is NULL, where "choice" and "choices" pick options.
    Given the `Written_Answer.kind` column, the same as a SQL condition."""
    return kind.is_(None) if isinstance(kind, QueryableAttribute) else kind is None


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
    # a one-off choice nothing else fills (KAN-369): "choice" takes one of
    # `options`, "choices" one or more; NULL for a question written in words
    kind: Mapped[str | None] = mapped_column(Text)
    # the choice's options as the form words them; NULL for a written question
    options: Mapped[list[str] | None] = mapped_column(JSONB(none_as_null=True))
    # NULL until the student's Claude saves one. A choice's answer is its
    # option, or its options joined by "; ", in the form's own wording
    answer: Mapped[str | None] = mapped_column(Text)
    answered_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    # the student's own words (KAN-379): an edit in the tab, or their answer
    # before their Claude's. Their Claude's save never replaces it, and it is
    # the answer later forms reuse for the same question
    own: Mapped[bool] = mapped_column(server_default=text("false"))
    # what the student's Claude's passes found on the answer it saved here
    # (KAN-369): {"plan": its Essay plan (type, story, company_fact, angle,
    # slots: {slot: [quotes]}), "unsupported": the claims the claim check
    # listed and the edit cut}. NULL for a choice, a pasted answer or the
    # student's own words
    review: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
    # the company brief fact the answer uses, {"fact", "url"} as the brief
    # had it when saved, so the student can read up on it before an
    # interview; NULL when it names none (KAN-369)
    named_fact: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))

    __table_args__ = (
        CheckConstraint(
            "(kind IS NULL AND options IS NULL) OR (kind IN ('choice', 'choices') AND jsonb_typeof(options) = 'array')",
            name="written_answers_kind_options",
        ),
        CheckConstraint("review IS NULL OR jsonb_typeof(review) = 'object'", name="written_answers_review_object"),
        CheckConstraint("named_fact IS NULL OR jsonb_typeof(named_fact) = 'object'", name="written_answers_named_fact_object"),
        # The application's questions go with it: dequeued, or the account deleted.
        ForeignKeyConstraint(
            ["applicant_id", "job_id"], ["job_applications.applicant_id", "job_applications.job_id"],
            ondelete="CASCADE", name="written_answers_application_fkey",
        ),
    )

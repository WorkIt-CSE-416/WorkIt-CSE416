'''
one dated thing on one application: an interview, an assessment's due
date, an offer, a rejection (KAN-413, docs/email_tracker.md). The student
types them on the Applications Tracker; later the email tracker proposes
them from Gmail into the same table
ex: applicant 7's Stripe application had a technical interview on 2026-11-04
at 2:00 PM Eastern
'''
import datetime
import uuid as _uuid

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import BaseModel
from app.models import dto


class Application_Event(BaseModel):
    '''
    WHEN IT HAPPENS IS ONE OF TWO (`application_events_one_when`): `at`, an
    instant, for something at a time (an interview), or `on_day`, a date,
    for something due on a day (an assessment due Nov 3). The tracker's
    TrackerEvent draws the two differently, an instant in the viewer's zone
    and a date as is, so a date must not be stored as midnight UTC, which
    reads as the day before in the Americas.

    job_id is null only for an email that matched no application (a later
    step); the composite foreign key then checks nothing, and applicant_id's
    own still ties the row to its student. Deleting an application (Unsave,
    taking it out of the queue) deletes its events
    '''
    __tablename__ = "application_events"
    __table_args__ = (
        CheckConstraint("num_nonnulls(at, on_day) = 1", name="application_events_one_when"),
        # An end only on a timed event, and after its start (KAN-429)
        CheckConstraint(
            "ends_at IS NULL OR (at IS NOT NULL AND ends_at > at)",
            name="application_events_ends_after_start",
        ),
        ForeignKeyConstraint(
            ["applicant_id", "job_id"],
            ["job_applications.applicant_id", "job_applications.job_id"],
            ondelete="CASCADE",
            name="application_events_application_fkey",
        ),
        # One application's events, and through applicant_id first, one
        # student's (the Calendar's read)
        Index("application_events_application_idx", "applicant_id", "job_id"),
    )

    id: Mapped[_uuid.UUID] = mapped_column(
        primary_key=True, default=_uuid.uuid4, server_default=text("gen_random_uuid()"))
    applicant_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"))
    job_id: Mapped[_uuid.UUID | None]
    kind: Mapped[dto.application_event_kind]
    status: Mapped[dto.application_event_status]
    source: Mapped[dto.application_event_source]
    # "Technical Interview", "CodeSignal Assessment": what the tracker prints
    title: Mapped[str]
    at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    # When a timed event ends (KAN-429): the Calendar's Day and Week grid
    # draws it from `at` to here, and an hour long when null
    ends_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    on_day: Mapped[datetime.date | None] = mapped_column(Date)
    # The student's own note, or a one-line summary of an email
    note: Mapped[str | None]
    # A Zoom, Meet or Teams link, when there is one
    meeting_url: Mapped[str | None]
    # When the student accepted or dismissed it; null while proposed
    decided_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    # When the student first read the email (KAN-427): opening it, Mark as
    # Read, or accepting or dismissing it; null is unread, and Mark as
    # Unread sets it back. Meaningless on an event the student typed
    read_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))

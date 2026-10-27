"""
The Applications Tracker's own writes (KAN-413, docs/email_tracker.md): an
application's stage set by hand, and the dated events on it, behind
routers/tracker.py. job_applications' other queries are in
applications.py (Save, Applied) and auto_apply/queries.py (the queue).
"""

import datetime
import uuid
from typing import NamedTuple

from sqlalchemy import DateTime, cast, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.application_events import Application_Event
from app.models.applications import Job_Application
from app.models.dto import (
    APPLIED_STAGES,
    application_event_kind,
    application_event_source,
    application_event_status,
    application_stage,
)

# How far along each stage is. An event moves its application only forward
# (`advance`): a late "thanks for applying" must not undo an interview.
# Rejected is last, so a rejection moves any stage, and nothing but the
# student's own stage menu moves a rejected application again.
_RANK = {
    application_stage.saved: 0,
    application_stage.queued: 0,
    application_stage.needs_you: 0,
    application_stage.skipped: 0,
    application_stage.applied: 1,
    application_stage.interviewing: 2,
    application_stage.offer: 3,
    application_stage.rejected: 4,
}

# The stage each kind of event means. An assessment, a confirmation or
# anything else leaves the stage as it is.
_STAGE_OF = {
    application_event_kind.interview: application_stage.interviewing,
    application_event_kind.offer: application_stage.offer,
    application_event_kind.rejection: application_stage.rejected,
}


class NewEvent(NamedTuple):
    kind: application_event_kind
    title: str
    at: datetime.datetime | None
    on_day: datetime.date | None
    note: str | None
    meeting_url: str | None


async def fetch_stage(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> application_stage | None:
    '''the application's stage, or None when the applicant has none for
    this job'''
    return await db.scalar(
        select(Job_Application.stage).where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.job_id == job_id,
        )
    )


async def _move(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, stage: application_stage
) -> None:
    # Every stage set here is applied or later, so it is dated: the day it
    # was first applied, else now (a job saved, then interviewing).
    await db.execute(
        update(Job_Application)
        .where(Job_Application.applicant_id == applicant_id, Job_Application.job_id == job_id)
        .values(stage=stage, applied_at=func.coalesce(Job_Application.applied_at, func.now()))
    )


async def set_stage(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, stage: application_stage
) -> application_stage | None:
    '''
    the stage menu: moves the application to `stage`, any direction, and
    answers it; None when there is no application. `stage` is applied or
    later (the schema allows nothing else): a record never goes back to a
    bookmark
    '''
    assert stage in APPLIED_STAGES
    if await fetch_stage(db, applicant_id, job_id) is None:
        return None
    await _move(db, applicant_id, job_id, stage)
    await db.commit()
    return stage


def advance(current: application_stage, kind: application_event_kind) -> application_stage | None:
    '''the stage an event of `kind` moves an application at `current` to,
    or None when it stays: only forward, never back'''
    target = _STAGE_OF.get(kind)
    if target is None or _RANK[target] <= _RANK[current]:
        return None
    return target


async def add_event(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, new: NewEvent
) -> tuple[Application_Event, application_stage] | None:
    '''
    Add Event: keeps one the student typed (accepted from the start) and
    moves the application forward when the event says so (an interview to
    interviewing). Answers the event and the application's stage after it;
    None when there is no application
    '''
    current = await fetch_stage(db, applicant_id, job_id)
    if current is None:
        return None
    event = Application_Event(
        applicant_id=applicant_id,
        job_id=job_id,
        kind=new.kind,
        status=application_event_status.accepted,
        source=application_event_source.manual,
        title=new.title,
        at=new.at,
        on_day=new.on_day,
        note=new.note,
        meeting_url=new.meeting_url,
        decided_at=func.now(),
    )
    db.add(event)
    stage = advance(current, new.kind)
    if stage is not None:
        await _move(db, applicant_id, job_id, stage)
    await db.commit()
    await db.refresh(event)
    return event, stage or current


async def fetch_events(
    db: AsyncSession,
    applicant_id: uuid.UUID,
    status: application_event_status = application_event_status.accepted,
) -> list[Application_Event]:
    '''
    the applicant's events in `status`. Accepted ones (the timeline, the
    Calendar, the Dashboard) come soonest first; proposed ones (the Updates
    strip, unmatched included) newest first, the order they arrived in
    '''
    query = select(Application_Event).where(
        Application_Event.applicant_id == applicant_id,
        Application_Event.status == status,
    )
    if status == application_event_status.proposed:
        return list((await db.scalars(query.order_by(Application_Event.created_at.desc()))).all())
    # A day sorts at its start in UTC, ahead of that day's interviews, as
    # the tracker's own sortKey orders them
    when = func.coalesce(Application_Event.at, cast(Application_Event.on_day, DateTime(timezone=True)))
    return list((await db.scalars(query.order_by(when, Application_Event.created_at))).all())


class NotProposed(Exception):
    '''the event was accepted or dismissed already'''


class NoApplication(Exception):
    '''the event names no application, or one the applicant does not have'''


async def _proposed(
    db: AsyncSession, applicant_id: uuid.UUID, event_id: uuid.UUID
) -> Application_Event | None:
    event = await db.scalar(
        select(Application_Event).where(
            Application_Event.id == event_id, Application_Event.applicant_id == applicant_id
        )
    )
    if event is not None and event.status != application_event_status.proposed:
        raise NotProposed
    return event


async def accept_event(
    db: AsyncSession, applicant_id: uuid.UUID, event_id: uuid.UUID, job_id: uuid.UUID | None
) -> tuple[Application_Event, application_stage] | None:
    '''
    an update's Accept: puts a proposed event on the tracker, on `job_id`
    when given (Wrong Job?, or Couldn't Match's pick) else the application
    it was matched to, and moves that application forward as Add Event
    does. None when the applicant has no such event; NotProposed when it
    was decided already; NoApplication when it names no application the
    applicant has
    '''
    event = await _proposed(db, applicant_id, event_id)
    if event is None:
        return None
    target = job_id or event.job_id
    current = await fetch_stage(db, applicant_id, target) if target else None
    if current is None:
        raise NoApplication
    event.job_id = target
    event.status = application_event_status.accepted
    event.decided_at = func.now()
    stage = advance(current, event.kind)
    if stage is not None:
        await _move(db, applicant_id, target, stage)
    await db.commit()
    await db.refresh(event)
    return event, stage or current


async def dismiss_event(db: AsyncSession, applicant_id: uuid.UUID, event_id: uuid.UUID) -> bool:
    '''an update's Not Right, or Couldn't Match's Dismiss: keeps the event
    off the tracker. False when the applicant has no such event;
    NotProposed when it was decided already'''
    event = await _proposed(db, applicant_id, event_id)
    if event is None:
        return False
    event.status = application_event_status.dismissed
    event.decided_at = func.now()
    await db.commit()
    return True


async def delete_event(db: AsyncSession, applicant_id: uuid.UUID, event_id: uuid.UUID) -> bool:
    '''deletes one of the applicant's events; False when they have no such
    event. The application's stage stays where it is: the student sets it
    from the stage menu'''
    removed = await db.scalar(
        delete(Application_Event)
        .where(Application_Event.id == event_id, Application_Event.applicant_id == applicant_id)
        .returning(Application_Event.id)
    )
    if removed is None:
        return False
    await db.commit()
    return True

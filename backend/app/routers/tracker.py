"""
The Applications Tracker's own writes (KAN-413, docs/email_tracker.md,
build step 1): an application's stage set by hand, and the dated events on
it. The tracker's read of the applications themselves is auto apply's list,
GET /applicants/{id}/applications (routers/auto_apply.py).

PUT    /applicants/{id}/applications/{job_id}/stage  {"stage": "interviewing"}
       The stage menu: applied, interviewing, offer or rejected, any
       direction (a saved or queued job can go straight to one). Answers
       StageSet. An application with no applied date gets today's. 404 with
       no application.
GET    /applicants/{id}/events
       Every accepted event on the applicant's applications, soonest first,
       as EventResponses: the timeline, the Calendar and the Dashboard read
       them, joined to the applications by job_id.
POST   /applicants/{id}/applications/{job_id}/events  EventCreate
       Add Event: 201 with EventAdded, the event and the stage after it. An
       interview, offer or rejection moves the application forward (an
       interview takes applied to interviewing), never back. 404 with no
       application; 422 without exactly one of `at` (a time with its zone)
       and `on_day` (a date).
DELETE /applicants/{id}/events/{event_id}
       204; the stage stays. 404 for an event not the applicant's.

Applicant accounts only, and only their own id (owned_applicant).
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import owned_applicant
from app.models.dto import application_event_kind, application_stage
from app.queries.tracker import (
    NewEvent,
    add_event,
    delete_event,
    fetch_events,
    set_stage,
)
from app.schemas.tracker import (
    EventAdded,
    EventCreate,
    EventResponse,
    StageChange,
    StageSet,
)

router = APIRouter(prefix="/applicants/{applicant_id}", tags=["tracker"])

NO_APPLICATION = "You have no application for that job."


@router.put("/applications/{job_id}/stage", response_model=StageSet)
async def put_stage(
    job_id: uuid.UUID,
    body: StageChange,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    db: AsyncSession = Depends(get_session),
) -> StageSet:
    """Moves one application to the stage the student picked."""
    stage = await set_stage(db, applicant_id, job_id, application_stage(body.stage))
    if stage is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NO_APPLICATION)
    return StageSet(job_id=job_id, stage=stage)


@router.get("/events", response_model=list[EventResponse])
async def list_events(
    applicant_id: uuid.UUID = Depends(owned_applicant),
    db: AsyncSession = Depends(get_session),
) -> list[EventResponse]:
    """The applicant's events, soonest first."""
    return [EventResponse.model_validate(e, from_attributes=True) for e in await fetch_events(db, applicant_id)]


@router.post(
    "/applications/{job_id}/events", response_model=EventAdded, status_code=status.HTTP_201_CREATED
)
async def post_event(
    job_id: uuid.UUID,
    body: EventCreate,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    db: AsyncSession = Depends(get_session),
) -> EventAdded:
    """Adds an event the student typed to one application."""
    added = await add_event(db, applicant_id, job_id, NewEvent(
        kind=application_event_kind(body.kind),
        title=body.title,
        at=body.at,
        on_day=body.on_day,
        note=body.note,
        meeting_url=body.meeting_url,
    ))
    if added is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NO_APPLICATION)
    event, stage = added
    return EventAdded(event=EventResponse.model_validate(event, from_attributes=True), stage=stage)


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_event(
    event_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    db: AsyncSession = Depends(get_session),
) -> Response:
    """Deletes one of the applicant's events."""
    if not await delete_event(db, applicant_id, event_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That event isn't yours or is gone.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)

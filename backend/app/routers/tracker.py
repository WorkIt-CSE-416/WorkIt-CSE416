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
PUT    /applicants/{id}/applications/{job_id}/apply-by  {"apply_by": "2026-11-10"}
       A saved job's Apply by (KAN-429), the student's own day to apply by,
       or null to clear it: 204. 404 with no application.
GET    /applicants/{id}/events?status=accepted
       The applicant's events in one status, as EventResponses. accepted
       (the default): every event on the tracker, soonest first; the
       timeline, the Calendar and the Dashboard read them, joined to the
       applications by job_id. proposed: Email Updates, newest first,
       with job_id null for one that matched no application (Couldn't
       Match).
POST   /applicants/{id}/applications/{job_id}/events  EventCreate
       Add Event: 201 with EventAdded, the event and the stage after it;
       `ends_at`, after `at`, gives a timed event its end (KAN-429). An
       interview, offer or rejection moves the application forward (an
       interview takes applied to interviewing), never back. 404 with no
       application; 422 without exactly one of `at` (a time with its zone)
       and `on_day` (a date).
DELETE /applicants/{id}/events/{event_id}
       204; the stage stays. 404 for an event not the applicant's.
GET    /applicants/{id}/emails
       The Inbox: every event read from email, whatever its status (an
       accepted or left-off one stays a record), newest first by when it
       was read, as EventResponses. Proposed ones need review
       (queries/tracker.py, needs_review).
PUT    /applicants/{id}/emails/read  {"ids": [...], "read": true}
       The Inbox's Mark as Read and Mark as Unread (KAN-427), all or none:
       204. Read keeps the time it was first read; unread clears it. 404
       when any id is not one of the applicant's emails. Opening an email
       sends it with that one id.
POST   /applicants/{id}/events/{event_id}/accept  {"job_id": null}
       An update's Accept: the proposed event goes on the tracker, on
       `job_id` when the body names one (an email that matched none), else
       on the application it matched, which it moves forward as Add Event
       does. Answers EventAdded. 404 for an event not the applicant's; 409
       when it was accepted or dismissed already; 422 when it names no
       application the applicant has.
POST   /applicants/{id}/events/{event_id}/dismiss
       The dismiss cross: 204, and it stays off the
       tracker. 404 for an event not the applicant's; 409 when decided
       already.

Applicant accounts only, and only their own id (owned_applicant).
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import owned_applicant
from app.models.dto import (
    application_event_kind,
    application_event_status,
    application_stage,
)
from app.queries.tracker import (
    NewEvent,
    NoApplication,
    NotProposed,
    accept_event,
    add_event,
    delete_event,
    dismiss_event,
    fetch_emails,
    fetch_events,
    mark_read,
    set_apply_by,
    set_stage,
)
from app.schemas.tracker import (
    ApplyByChange,
    EmailsRead,
    EventAccept,
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


@router.put("/applications/{job_id}/apply-by", status_code=status.HTTP_204_NO_CONTENT)
async def put_apply_by(
    job_id: uuid.UUID,
    body: ApplyByChange,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    db: AsyncSession = Depends(get_session),
) -> Response:
    """Sets or clears a saved job's Apply by."""
    if not await set_apply_by(db, applicant_id, job_id, body.apply_by):
        raise HTTPException(status.HTTP_404_NOT_FOUND, NO_APPLICATION)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/events", response_model=list[EventResponse])
async def list_events(
    event_status: application_event_status = Query(application_event_status.accepted, alias="status"),
    applicant_id: uuid.UUID = Depends(owned_applicant),
    db: AsyncSession = Depends(get_session),
) -> list[EventResponse]:
    """The applicant's events in one status."""
    events = await fetch_events(db, applicant_id, event_status)
    return [EventResponse.model_validate(e, from_attributes=True) for e in events]


@router.get("/emails", response_model=list[EventResponse])
async def list_emails(
    applicant_id: uuid.UUID = Depends(owned_applicant),
    db: AsyncSession = Depends(get_session),
) -> list[EventResponse]:
    """The applicant's emails, newest first."""
    return [EventResponse.model_validate(e, from_attributes=True) for e in await fetch_emails(db, applicant_id)]


@router.put("/emails/read", status_code=status.HTTP_204_NO_CONTENT)
async def put_emails_read(
    body: EmailsRead,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    db: AsyncSession = Depends(get_session),
) -> Response:
    """Marks the emails picked read or unread."""
    if not await mark_read(db, applicant_id, body.ids, body.read):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "One of those emails isn't yours or is gone.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
        ends_at=body.ends_at,
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
    """Deletes one of the events the applicant added by hand."""
    if not await delete_event(db, applicant_id, event_id):
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "That event isn't yours, is gone, or came from an email.",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


DECIDED = "That update was already accepted or dismissed."


@router.post("/events/{event_id}/accept", response_model=EventAdded)
async def post_accept(
    event_id: uuid.UUID,
    body: EventAccept | None = None,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    db: AsyncSession = Depends(get_session),
) -> EventAdded:
    """Puts a proposed event on the tracker."""
    try:
        accepted = await accept_event(db, applicant_id, event_id, body.job_id if body else None)
    except NotProposed as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, DECIDED) from exc
    except NoApplication as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Pick one of your applications for it."
        ) from exc
    if accepted is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That update isn't yours or is gone.")
    event, stage = accepted
    return EventAdded(event=EventResponse.model_validate(event, from_attributes=True), stage=stage)


@router.post("/events/{event_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def post_dismiss(
    event_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    db: AsyncSession = Depends(get_session),
) -> Response:
    """Keeps a proposed event off the tracker."""
    try:
        found = await dismiss_event(db, applicant_id, event_id)
    except NotProposed as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, DECIDED) from exc
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That update isn't yours or is gone.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)

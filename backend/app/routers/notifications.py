"""
GET and POST for the top bar's bell (KAN-298).

    GET /applicants/{applicant_id}/notifications?limit=20
        Newest first, plus unread_count in the same response (one round
        trip for the bell's list and its badge).

    POST /applicants/{applicant_id}/notifications/read
        Marks every unread row read. The bell's own copy already treats
        "opened it" as "caught up" (notifications-menu.tsx's "You're All
        Caught Up"), so this is the only mark-read shape there is.

The only writer is app/services/job_alerts.py; nothing here creates a
notification.
"""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import owned_applicant
from app.queries.notifications import fetch_notifications, mark_all_read
from app.schemas.notification import NotificationList

router = APIRouter()

_PATH = "/applicants/{applicant_id}/notifications"


@router.get(_PATH, response_model=NotificationList)
async def get_notifications(
    limit: int = Query(20, ge=1, le=100),
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> NotificationList:
    rows, unread_count = await fetch_notifications(session, applicant_id, limit)
    return NotificationList(notifications=rows, unread_count=unread_count)


@router.post(_PATH + "/read", response_model=NotificationList)
async def read_notifications(
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> NotificationList:
    await mark_all_read(session, applicant_id)
    await session.commit()
    rows, unread_count = await fetch_notifications(session, applicant_id, limit=20)
    return NotificationList(notifications=rows, unread_count=unread_count)

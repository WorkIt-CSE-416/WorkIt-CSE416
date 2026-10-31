"""
Fill numbers (KAN-476, decided in KAN-454): the extension sends one event
after every fill, single or batch, unless the student turned Send fill
numbers off in its settings. No value, answer or link: only the job system,
the versions, the field counts, the error names and the duration.

POST /fill-events  FillEventRequest (app/schemas/fill_events.py)
     Stores it (naming no account) and answers {"id"} (201). 422 for any key
     or text outside the shape, 429 past FILL_EVENT_DAILY_CAP events from the
     account a UTC day (services/daily_caps.py, KAN-478). Kept 90 days: the daily purge
     (services/retention.py, KAN-482) deletes older ones.
GET  /admin/fill-health  ?days=1..90 (default 14)&engine_version=
     Per job system per day (UTC): fills, the share with no failed field,
     the needs-you rate (needs-you fields over all fields) and the top error
     names, plus every engine version the period names. Admins only
     (WORKIT_ADMINS, 403 to anyone else), as /admin/fill-reports.
"""

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_admin, get_current_account
from app.queries.fill_events import fill_health, store_event
from app.schemas.auth import AuthenticatedAccount
from app.schemas.fill_events import FillEventRequest, FillEventStored, FillHealth
from app.services.daily_caps import Capped, take_daily

router = APIRouter(tags=["fill-events"])


@router.post("/fill-events", response_model=FillEventStored, status_code=status.HTTP_201_CREATED)
async def store_fill_event(
    body: FillEventRequest,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> FillEventStored:
    """Stores one fill's numbers from the signed-in account."""
    await take_daily(db, account.id, Capped.FILL_EVENT)
    return FillEventStored(id=str(await store_event(db, body.model_dump())))


@router.get("/admin/fill-health", response_model=FillHealth)
async def admin_fill_health(
    days: int = Query(default=14, ge=1, le=90),
    engine_version: str | None = Query(default=None, max_length=64),
    _admin: AuthenticatedAccount = Depends(get_admin),
    db: AsyncSession = Depends(get_session),
) -> FillHealth:
    rows, versions = await fill_health(db, days=days, engine_version=engine_version)
    return FillHealth(rows=rows, engine_versions=versions)

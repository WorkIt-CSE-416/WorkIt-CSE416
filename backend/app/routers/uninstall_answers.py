"""
The uninstall survey (KAN-471): removing the extension opens the webapp's
/uninstalled page (the extension's chrome.runtime.setUninstallURL), and its
one question comes here.

POST /uninstall-answers  {"reason", "detail"?, "version"?}
     Stores it and answers {} (201). 422 for any other key or a reason the
     survey doesn't offer (app/schemas/uninstall_answers.py). No sign-in: a
     student who removed the extension may well be signed out, and the
     answer is anonymous. The row names no account and no address.
     429 past either cap:
     - PER_SENDER_PER_DAY from one sender. The sender is the address the
       webapp's server forwards (x-workit-client-ip, from Cloudflare's
       cf-connecting-ip), else this request's own. It is counted in memory
       only, as a hash, and forgotten each day, so nothing about it is
       stored; a caller that sets the header itself can get round it.
     - PER_DAY from everyone, counted in the table: the bound that holds
       whatever the header says, so the table grows by at most PER_DAY rows
       a day.
"""

import datetime
import hashlib

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.queries.uninstall_answers import add_answer, count_answered_since
from app.schemas.uninstall_answers import UninstallAnswer

router = APIRouter(tags=["uninstall-answers"])

PER_SENDER_PER_DAY = 5
PER_DAY = 500

# The day the counts are for, and each sender's count that day, by hash.
_sender_day: datetime.date | None = None
_sender_counts: dict[str, int] = {}


def reset_sender_counts() -> None:
    """Forgets every sender's count (the day's turn, and tests)."""
    global _sender_day
    _sender_day = None
    _sender_counts.clear()


def _sender(request: Request) -> str:
    address = (
        request.headers.get("x-workit-client-ip")
        or request.headers.get("cf-connecting-ip")
        or (request.client.host if request.client else "")
    )
    return hashlib.sha256(address.strip().encode()).hexdigest()


def _take_sender_turn(request: Request) -> bool:
    """Counts one answer from this request's sender today; False past the cap."""
    global _sender_day
    today = datetime.datetime.now(datetime.UTC).date()
    if _sender_day != today:
        reset_sender_counts()
        _sender_day = today
    sender = _sender(request)
    if _sender_counts.get(sender, 0) >= PER_SENDER_PER_DAY:
        return False
    _sender_counts[sender] = _sender_counts.get(sender, 0) + 1
    return True


@router.post("/uninstall-answers", status_code=status.HTTP_201_CREATED)
async def answer_uninstall_survey(
    body: UninstallAnswer,
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Stores one answer to Why did you remove WorkIt?, with no account."""
    today = datetime.datetime.now(datetime.UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    if await count_answered_since(db, today) >= PER_DAY or not _take_sender_turn(request):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many answers today. Thanks, we have yours.")
    add_answer(db, reason=body.reason, detail=body.detail, extension_version=body.version)
    await db.commit()
    return {}

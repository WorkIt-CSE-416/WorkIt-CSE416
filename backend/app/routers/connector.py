"""
The connector's consent page (KAN-377): the webapp's /connect/claude calls
these with the student's Supabase session, while Claude waits on its sign-in
to WorkIt (app/connector/oauth.py). `id` is the request id /authorize put in
the page's link.

GET  /connector/requests/{id}
     Who asks: {"client_name": "Claude"}. 404 once the sign-in is answered
     or over (10 minutes).
POST /connector/requests/{id}/approve
     The student's Allow: answers {"redirect_to": ...}, the client's
     redirect URI with a code it trades for a token at /token. 404 as above.
POST /connector/requests/{id}/deny
     The student's Deny: answers {"redirect_to": ...} with
     error=access_denied. 404 as above.

Student accounts only (403 for a company account): the connector reads a
student's applications.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.connector import oauth
from app.db import get_session
from app.deps import get_current_account
from app.schemas.auth import AccountType, AuthenticatedAccount

router = APIRouter(prefix="/connector/requests", tags=["connector"])


class ConsentRequest(BaseModel):
    client_name: str


class Redirect(BaseModel):
    redirect_to: str


def _student(account: AuthenticatedAccount) -> uuid.UUID:
    if account.account_type is not AccountType.APPLICANT:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only a student account can connect Claude.")
    return account.id


@router.get("/{request_id}", response_model=ConsentRequest)
async def consent_request(
    request_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> ConsentRequest:
    _student(account)
    try:
        return ConsentRequest(client_name=await oauth.client_name(db, request_id))
    except oauth.NotPending as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


@router.post("/{request_id}/approve", response_model=Redirect)
async def approve(
    request_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> Redirect:
    applicant_id = _student(account)
    try:
        return Redirect(redirect_to=await oauth.approve(db, request_id, applicant_id))
    except oauth.NotPending as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


@router.post("/{request_id}/deny", response_model=Redirect)
async def deny(
    request_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> Redirect:
    _student(account)
    try:
        return Redirect(redirect_to=await oauth.deny(db, request_id))
    except oauth.NotPending as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc

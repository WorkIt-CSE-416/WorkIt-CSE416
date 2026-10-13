"""The experience bank's API (KAN-206): one student's entries, bullets and
skills. Every route checks the token's account owns `applicant_id` first;
a row of another applicant answers 404. The rules (embedding clearing, the
duplicate check, bullet order) live in `app/services/bank.py`.

Months are "YYYY-MM". An entry's `end_kind` is "month", "present" or
"expected"; present has no `end_month`, the others need one. Section fields
(Education: degree, field_of_study, gpa, gpa_scale, coursework, honors;
Projects: link; Certifications: issuer; Awards: award_date) must be empty on
entries of other sections, or the request answers 422.

GET    /applicants/{id}/bank                     -> BankResponse
POST   /applicants/{id}/bank/entries             EntryCreate -> 201 EntryResponse
       409 {detail, duplicate: EntryResponse} when section, title and
       organization match an entry, ignoring case; ?allow_duplicate=true
       saves it anyway ("Save as new").
PATCH  /applicants/{id}/bank/entries/{entry_id}  EntryUpdate -> EntryResponse
DELETE /applicants/{id}/bank/entries/{entry_id}  -> 204 (its bullets too)
POST   /applicants/{id}/bank/entries/{entry_id}/bullets  BulletCreate -> 201 BulletResponse (appended)
PATCH  /applicants/{id}/bank/bullets/{bullet_id} BulletUpdate -> BulletResponse
DELETE /applicants/{id}/bank/bullets/{bullet_id} -> 204
POST   /applicants/{id}/bank/skills              SkillCreate -> 201 SkillResponse (409 if the name exists)
PATCH  /applicants/{id}/bank/skills/{skill_id}   SkillUpdate -> SkillResponse (409 if the name exists)
DELETE /applicants/{id}/bank/skills/{skill_id}   -> 204
"""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import assert_applicant_owns, get_current_account
from app.schemas.auth import AuthenticatedAccount
from app.schemas.bank import (
    BankResponse,
    BulletCreate,
    BulletResponse,
    BulletUpdate,
    DuplicateEntry,
    EntryCreate,
    EntryFields,
    EntryResponse,
    EntryUpdate,
    SkillCreate,
    SkillResponse,
    SkillUpdate,
)
from app.services import bank as service

router = APIRouter(prefix="/applicants/{applicant_id}/bank", tags=["bank"])


async def owned_applicant(
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
) -> uuid.UUID:
    assert_applicant_owns(account, applicant_id)
    return applicant_id


def entry_response(entry: service.Entry) -> EntryResponse:
    fields = {name: getattr(entry.row, name) for name in EntryFields.model_fields}
    return EntryResponse.model_validate(
        {**fields, "id": entry.row.id, "bullets": [BulletResponse.model_validate(b) for b in entry.bullets]}
    )


@asynccontextmanager
async def _writing(session: AsyncSession) -> AsyncIterator[None]:
    """Commit on success; turn the service's errors into HTTP answers."""
    try:
        yield
        await session.commit()
    except service.NotFound:
        await session.rollback()
        raise HTTPException(404, "Not found in your experience bank")
    except service.DuplicateSkillError:
        await session.rollback()
        raise HTTPException(409, "That skill is already in your experience bank")
    except ValidationError as exc:
        await session.rollback()
        raise RequestValidationError(exc.errors(include_url=False, include_context=False))
    except SQLAlchemyError:
        await session.rollback()
        raise HTTPException(500, "Failed to save your experience bank")


@router.get("", response_model=BankResponse)
async def get_bank(
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> BankResponse:
    bank = await service.load_bank(session, applicant_id)
    return BankResponse(
        entries=[entry_response(e) for e in bank.entries],
        skills=[SkillResponse.model_validate(s) for s in bank.skills],
    )


@router.post(
    "/entries",
    status_code=201,
    response_model=EntryResponse,
    responses={409: {"model": DuplicateEntry}},
)
async def create_entry(
    body: EntryCreate,
    allow_duplicate: bool = False,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
):
    try:
        async with _writing(session):
            entry = await service.create_entry(
                session, applicant_id, body, body.bullets, allow_duplicate=allow_duplicate
            )
    except service.DuplicateEntryError as exc:
        await session.rollback()
        payload = DuplicateEntry(detail=str(exc), duplicate=entry_response(exc.existing))
        return JSONResponse(status_code=409, content=payload.model_dump(mode="json"))
    return entry_response(entry)


@router.patch("/entries/{entry_id}", response_model=EntryResponse)
async def update_entry(
    entry_id: uuid.UUID,
    body: EntryUpdate,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> EntryResponse:
    async with _writing(session):
        entry = await service.update_entry(
            session, applicant_id, entry_id, body.model_dump(include=body.model_fields_set)
        )
    return entry_response(entry)


@router.delete("/entries/{entry_id}", status_code=204)
async def delete_entry(
    entry_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> Response:
    async with _writing(session):
        await service.delete_entry(session, applicant_id, entry_id)
    return Response(status_code=204)


@router.post("/entries/{entry_id}/bullets", status_code=201, response_model=BulletResponse)
async def add_bullet(
    entry_id: uuid.UUID,
    body: BulletCreate,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> BulletResponse:
    async with _writing(session):
        bullet = await service.add_bullet(session, applicant_id, entry_id, body.text)
    return BulletResponse.model_validate(bullet)


@router.patch("/bullets/{bullet_id}", response_model=BulletResponse)
async def update_bullet(
    bullet_id: uuid.UUID,
    body: BulletUpdate,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> BulletResponse:
    async with _writing(session):
        bullet = await service.update_bullet(
            session, applicant_id, bullet_id, text=body.text, position=body.position
        )
    return BulletResponse.model_validate(bullet)


@router.delete("/bullets/{bullet_id}", status_code=204)
async def delete_bullet(
    bullet_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> Response:
    async with _writing(session):
        await service.delete_bullet(session, applicant_id, bullet_id)
    return Response(status_code=204)


@router.post("/skills", status_code=201, response_model=SkillResponse)
async def add_skill(
    body: SkillCreate,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> SkillResponse:
    async with _writing(session):
        skill = await service.add_skill(session, applicant_id, body.name, body.group)
    return SkillResponse.model_validate(skill)


@router.patch("/skills/{skill_id}", response_model=SkillResponse)
async def update_skill(
    skill_id: uuid.UUID,
    body: SkillUpdate,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> SkillResponse:
    async with _writing(session):
        skill = await service.update_skill(
            session, applicant_id, skill_id, body.model_dump(include=body.model_fields_set)
        )
    return SkillResponse.model_validate(skill)


@router.delete("/skills/{skill_id}", status_code=204)
async def delete_skill(
    skill_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> Response:
    async with _writing(session):
        await service.delete_skill(session, applicant_id, skill_id)
    return Response(status_code=204)

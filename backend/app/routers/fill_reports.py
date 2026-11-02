"""
Report a problem (KAN-403) and fix reports (KAN-369): the extension's panel
sends a report the student previewed and pressed Send for; the student
lists their own; WorkIt's admins list, triage and export them as a fix brief
for a coding agent. docs/fill-reports.md describes the brief.

POST /fill-reports  FillReportRequest (app/schemas/fill_reports.py)
     Stores it with its sender and answers {"id"} (201). 429 past the
     account's daily cap (FILL_REPORT_DAILY_CAP, app/services/daily_caps.py). 413 past BODY_MAX
     bytes (read in chunks, never whole), 422 for any key or value outside
     the shape: posting_url is http or https with no sign-in or fragment, and
     its query only the params that name the posting (POSTING_PARAMS). What
     still looks like an email or a phone number in a free text is replaced
     (schemas' scrub).
GET  /fill-reports/mine              the signed-in account's reports, newest first
GET  /fill-reports/{id}              one, whole: its sender's or an admin's; 404 to anyone else
GET  /admin/fill-reports             ?job_system=&status=&engine_version=&signature=&limit=&offset=,
     newest first (admins only, 403)
GET  /admin/fill-report-groups       ?job_system=&status=&engine_version=: the matching reports by signature
     (job system + field kind + error, schemas' signature_of), each with its count, newest group first
GET  /admin/fill-reports/{id}        one, whole
PATCH /admin/fill-reports/{id}       {"status": new|triaged|fixed, "admin_note"}
GET  /admin/fill-reports/{id}/brief  the fix brief, text/markdown (curl it with an admin's token)
GET  /admin/fill-reports/{id}/fixture  the form's HTML, values out, as a text/plain download:
     never served as HTML, since it is an employer page's markup.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_admin, get_current_account, is_admin
from app.models.fill_reports import Fill_Report
from app.queries.fill_reports import (
    get_report,
    list_groups,
    list_reports,
    store_report,
    triage_report,
)
from app.schemas.auth import AuthenticatedAccount
from app.schemas.fill_reports import (
    BODY_MAX,
    FillReportDetail,
    FillReportGroups,
    FillReportList,
    FillReportRequest,
    FillReportStored,
    FillReportSummary,
    FillReportTriage,
    Status,
)
from app.services.daily_caps import Capped, take_daily
from app.services.fill_brief import fix_brief, fixture_name

router = APIRouter(tags=["fill-reports"])


async def _report_body(request: Request) -> FillReportRequest:
    """The request's report, read at most BODY_MAX bytes (413 past it, whatever Content-Length says)."""
    if int(request.headers.get("content-length") or 0) > BODY_MAX:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "A report is at most 1 MB.")
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > BODY_MAX:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "A report is at most 1 MB.")
    try:
        return FillReportRequest.model_validate_json(bytes(body))
    except ValidationError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error.errors(include_url=False, include_input=False, include_context=False)) from None


def _summary(row: Fill_Report) -> dict:
    return {
        "id": str(row.id), "created_at": row.created_at, "job_system": row.job_system, "posting_url": row.posting_url,
        "engine_version": row.engine_version, "status": row.status, "trigger": row.trigger, "note": row.note,
        "signature": row.signature, "field_count": len(row.fields or []),
        "marked": [f.get("name") or f.get("label_shape") or "" for f in row.fields or [] if f.get("marked")],
    }


def _detail(row: Fill_Report) -> FillReportDetail:
    return FillReportDetail(
        **_summary(row), fields=row.fields or [], context=row.context, timeline=row.timeline, html=row.html,
        admin_note=row.admin_note, updated_at=row.updated_at,
    )


async def _found(db: AsyncSession, report_id: uuid.UUID) -> Fill_Report:
    row = await get_report(db, report_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such report.")
    return row


@router.post("/fill-reports", response_model=FillReportStored, status_code=status.HTTP_201_CREATED)
async def store_fill_report(
    request: Request,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> FillReportStored:
    """Stores one problem report from the signed-in account."""
    body = await _report_body(request)
    await take_daily(db, account.id, Capped.FILL_REPORT)
    return FillReportStored(id=str(await store_report(db, body.scrubbed(), account.id)))


@router.get("/fill-reports/mine", response_model=FillReportList)
async def my_fill_reports(
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> FillReportList:
    rows, total = await list_reports(db, account_id=account.id, limit=100)
    return FillReportList(reports=[FillReportSummary(**_summary(r)) for r in rows], total=total)


@router.get("/fill-reports/{report_id}", response_model=FillReportDetail)
async def one_fill_report(
    report_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> FillReportDetail:
    row = await get_report(db, report_id)
    # Another student's report is "not found", never "forbidden": its id says nothing.
    if row is None or (row.account_id != account.id and not is_admin(account)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such report.")
    return _detail(row)


@router.get("/admin/fill-reports", response_model=FillReportList)
async def all_fill_reports(
    job_system: str | None = Query(default=None, max_length=24),
    status_: Status | None = Query(default=None, alias="status"),
    engine_version: str | None = Query(default=None, max_length=64),
    signature: str | None = Query(default=None, max_length=80),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _admin: AuthenticatedAccount = Depends(get_admin),
    db: AsyncSession = Depends(get_session),
) -> FillReportList:
    rows, total = await list_reports(
        db, job_system=job_system, status=status_, engine_version=engine_version, signature=signature, limit=limit, offset=offset,
    )
    return FillReportList(reports=[FillReportSummary(**_summary(r)) for r in rows], total=total)


@router.get("/admin/fill-report-groups", response_model=FillReportGroups)
async def fill_report_groups(
    job_system: str | None = Query(default=None, max_length=24),
    status_: Status | None = Query(default=None, alias="status"),
    engine_version: str | None = Query(default=None, max_length=64),
    _admin: AuthenticatedAccount = Depends(get_admin),
    db: AsyncSession = Depends(get_session),
) -> FillReportGroups:
    return FillReportGroups(groups=await list_groups(db, job_system=job_system, status=status_, engine_version=engine_version))


@router.get("/admin/fill-reports/{report_id}", response_model=FillReportDetail)
async def admin_fill_report(
    report_id: uuid.UUID,
    _admin: AuthenticatedAccount = Depends(get_admin),
    db: AsyncSession = Depends(get_session),
) -> FillReportDetail:
    return _detail(await _found(db, report_id))


@router.patch("/admin/fill-reports/{report_id}", response_model=FillReportDetail)
async def triage_fill_report(
    report_id: uuid.UUID,
    body: FillReportTriage,
    _admin: AuthenticatedAccount = Depends(get_admin),
    db: AsyncSession = Depends(get_session),
) -> FillReportDetail:
    row = await triage_report(db, report_id, body.model_dump(exclude_unset=True))
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such report.")
    return _detail(row)


@router.get("/admin/fill-reports/{report_id}/brief")
async def fill_report_brief(
    report_id: uuid.UUID,
    _admin: AuthenticatedAccount = Depends(get_admin),
    db: AsyncSession = Depends(get_session),
) -> Response:
    """The fix brief, Markdown for a coding agent (docs/fill-reports.md)."""
    detail = _detail(await _found(db, report_id)).model_dump(mode="json")
    return Response(fix_brief(detail), media_type="text/markdown; charset=utf-8")


@router.get("/admin/fill-reports/{report_id}/fixture")
async def fill_report_fixture(
    report_id: uuid.UUID,
    _admin: AuthenticatedAccount = Depends(get_admin),
    db: AsyncSession = Depends(get_session),
) -> Response:
    row = await _found(db, report_id)
    if not row.html:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This report has no form snapshot.")
    return Response(
        row.html, media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fixture_name(str(row.id))}"', "X-Content-Type-Options": "nosniff"},
    )
